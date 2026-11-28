// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/http/wrapRouteHandlerWithLogging`
 * Purpose: Route wrapper to eliminate boilerplate for request logging envelope and metrics.
 * Scope: Bootstrap-layer utility. Handles ctx creation, timing, envelope logging, and Prometheus metrics. Does not implement route-specific business logic.
 * Invariants: Always logs request start/end exactly once; always measures duration; catches unhandled errors; always records metrics (even on 5xx).
 * Side-effects: IO (creates request context, emits structured log entries, records Prometheus metrics). Container loaded via dynamic import to avoid Turbopack per-route module duplication.
 * Notes: Use this wrapper for all instrumented routes. Domain events go in facades/features, not here.
 *        logRequestEnd runs exactly once in the finally block for all paths (success, 401, 5xx).
 *        For unhandled errors: logs error, then rethrows in dev/test (APP_ENV != production) for diagnosis.
 *        In production, converts to 500 for safety.
 *        Metrics are recorded in a finally block to ensure all paths are captured.
 * Links: Used by route handlers; delegates to shared/observability helpers; records to shared/observability/server/metrics.
 * @public
 */

import { bearerWriteRefusal, SAFE_METHODS } from "@cogni/agent-grants";
import type { SessionUser } from "@cogni/node-shared";
import { type NextRequest, NextResponse } from "next/server";
import { routeAuthorityId } from "@/bootstrap/agent-permissions";
import type { Container } from "@/bootstrap/container";
import { withRootSpan } from "@/bootstrap/otel";
import { requestCredentialKind } from "@/shared/authenticated-identity";
import { serverEnv } from "@/shared/env";
import {
  createRequestContext,
  httpRequestDurationMs,
  httpRequestsTotal,
  logRequestEnd,
  logRequestError,
  logRequestStart,
  makeLogger,
  type RequestContext,
  statusBucket,
} from "@/shared/observability";

type AuthRequiredHandler<TContext = unknown> = (
  ctx: RequestContext,
  request: NextRequest,
  sessionUser: SessionUser,
  context?: TContext,
) => Promise<NextResponse>;

type AuthOptionalHandler<TContext = unknown> = (
  ctx: RequestContext,
  request: NextRequest,
  sessionUser: SessionUser | null,
  context?: TContext,
) => Promise<NextResponse>;

type AuthRequiredOptions = {
  routeId: string;
  /** Caller-owned operation with an existing product authorization check. */
  bearerWrite?: string;
  auth: {
    mode: "required";
    getSessionUser: () => Promise<SessionUser | null>;
  };
};

type AuthOptionalOptions = {
  routeId: string;
  /** Caller-owned operation with an existing product authorization check. */
  bearerWrite?: string;
  auth: {
    mode: "optional";
    getSessionUser: () => Promise<SessionUser | null>;
  };
};

type AuthNoneOptions = {
  routeId: string;
  /** Caller-owned operation with an existing product authorization check. */
  bearerWrite?: string;
  auth?: { mode: "none" };
};

type WrapOptions = AuthRequiredOptions | AuthOptionalOptions | AuthNoneOptions;

/**
 * Wraps a route handler with consistent request logging envelope.
 * Handles ctx creation, session check, timing, logRequestStart/End/Error automatically.
 *
 * @param options - Configuration for route logging
 * @param options.routeId - Route identifier for logging (e.g., "payments.intents")
 * @param options.auth - Session authentication config: { mode: "required"|"optional"|"none", getSessionUser }
 * @param handler - Route handler that receives (ctx, request, sessionUser, context?)
 * @returns Next.js route handler function (supports both static and dynamic routes)
 *
 * @example
 * // Static route with required session — sessionUser is guaranteed non-null
 * export const POST = wrapRouteHandlerWithLogging(
 *   { routeId: "payments.intents", auth: { mode: "required", getSessionUser } },
 *   async (ctx, request, sessionUser) => {
 *     const body = await request.json();
 *     const input = paymentIntentOperation.input.parse(body);
 *     const result = await createPaymentIntentFacade({ sessionUser, ...input }, ctx);
 *     return NextResponse.json(paymentIntentOperation.output.parse(result));
 *   }
 * );
 *
 * @example
 * // Dynamic route (Next.js 15 with async params and typed context)
 * export const GET = wrapRouteHandlerWithLogging<{ params: Promise<{ id: string }> }>(
 *   { routeId: "payments.attempt_status", auth: { mode: "required", getSessionUser } },
 *   async (ctx, request, sessionUser, context) => {
 *     if (!context) throw new Error("context required for dynamic routes");
 *     const { id } = await context.params;
 *     const result = await getPaymentStatusFacade({ sessionUser, attemptId: id }, ctx);
 *     return NextResponse.json(paymentStatusOperation.output.parse(result));
 *   }
 * );
 */
// Overload: mode "required" → handler receives SessionUser (non-null)
export function wrapRouteHandlerWithLogging<TContext = unknown>(
  options: AuthRequiredOptions,
  handler: AuthRequiredHandler<TContext>,
): (request: NextRequest, context?: TContext) => Promise<NextResponse>;
// Overload: mode "optional" or "none" → handler receives SessionUser | null
export function wrapRouteHandlerWithLogging<TContext = unknown>(
  options: AuthOptionalOptions | AuthNoneOptions,
  handler: AuthOptionalHandler<TContext>,
): (request: NextRequest, context?: TContext) => Promise<NextResponse>;
// Implementation
export function wrapRouteHandlerWithLogging<TContext = unknown>(
  options: WrapOptions,
  handler: AuthRequiredHandler<TContext> | AuthOptionalHandler<TContext>,
): (request: NextRequest, context?: TContext) => Promise<NextResponse> {
  return async (
    request: NextRequest,
    context?: TContext,
  ): Promise<NextResponse> => {
    // Dynamic import: breaks Turbopack's per-route static module graph tracing
    // of the entire DI composition root (spike.0203 — was causing 6GB RSS in dev).
    let container: Container;
    let unhandledErrorPolicy: "rethrow" | "respond_500";

    try {
      const mod = await import("@/bootstrap/container");
      container = mod.getContainer();
      unhandledErrorPolicy = container.config.unhandledErrorPolicy;
    } catch (bootError) {
      // Container init failed (env validation, missing secrets, etc.)
      // Return structured 503 so /readyz never returns an empty 500.
      const fallbackLog = makeLogger({ component: "wrapRouteHandler" });
      fallbackLog.error(
        {
          errorCode: "CONTAINER_INIT_FAILED",
          err:
            bootError instanceof Error ? bootError.message : String(bootError),
        },
        "container initialization failed — returning 503",
      );
      return new NextResponse(
        JSON.stringify({
          status: "error",
          reason: "CONTAINER_INIT_FAILED",
          message:
            bootError instanceof Error
              ? bootError.message
              : "Unknown container initialization error",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    }

    // Fetch session based on auth mode
    let sessionUser: SessionUser | null;
    try {
      sessionUser =
        options.auth && options.auth.mode !== "none"
          ? await options.auth.getSessionUser()
          : null;
    } catch {
      return NextResponse.json(
        { error: "authz_unavailable" },
        {
          status: 503,
          headers: { "cache-control": "no-store" },
        },
      );
    }

    // Wrap entire request in OTel root span for distributed tracing
    // Per AI_SETUP_SPEC.md: root span bound to context via context.with()
    return withRootSpan(
      `${request.method} ${options.routeId}`,
      { route_id: options.routeId },
      async ({ traceId, span }) => {
        const ctx = createRequestContext(
          { baseLog: container.log, clock: container.clock },
          request,
          {
            routeId: options.routeId,
            traceId,
            session: sessionUser ?? undefined,
          },
        );

        // Per AI_SETUP_SPEC.md: request_id must be on root span for trace-log correlation
        span.setAttribute("request_id", ctx.reqId);

        logRequestStart(ctx.log);
        const start = performance.now();

        // Track response for metrics/logging (captured in try/catch, used in finally)
        let responseStatus = 500;
        let response: NextResponse;

        try {
          // Check session requirement before calling handler
          if (options.auth?.mode === "required" && !sessionUser) {
            responseStatus = 401;
            response = NextResponse.json(
              { error: "Session required" },
              {
                status: responseStatus,
                headers: { "cache-control": "no-store" },
              },
            );
            return response;
          }

          const refuse = (error: string, status: number, reason?: string) => {
            responseStatus = status;
            return NextResponse.json(
              { error, ...(reason ? { reason } : {}) },
              {
                status,
                headers: { "cache-control": "no-store" },
              },
            );
          };
          if (sessionUser) {
            let via: "bearer" | "session";
            try {
              via = requestCredentialKind(sessionUser);
            } catch {
              return refuse("authz_unavailable", 503);
            }
            const mutation = !SAFE_METHODS.has(request.method.toUpperCase());
            if (via === "session" && mutation) {
              let origin: string;
              try {
                origin = new URL(serverEnv().APP_BASE_URL ?? "").origin;
              } catch {
                return refuse("authz_unavailable", 503);
              }
              if (request.headers.get("origin") !== origin)
                return refuse("forbidden", 403);
            }
            const toolId = routeAuthorityId(options.routeId);
            const undeclared = bearerWriteRefusal({
              method: request.method,
              via,
              doorRuns: !!toolId,
              routeId: options.routeId,
              bearerWrite: options.bearerWrite,
            });
            if (undeclared) return refuse(undeclared.code, 403);
            if (toolId) {
              try {
                const decision = await container.agentAuthority.authorizeRoute({
                  toolId,
                  routeId: options.routeId,
                  userId: sessionUser.id,
                  via,
                });
                if (decision.decision !== "allow")
                  return refuse(
                    decision.code,
                    decision.code === "authz_unavailable" ? 503 : 403,
                    decision.reason,
                  );
              } catch {
                return refuse("authz_unavailable", 503);
              }
            }
          }

          // Safe cast: for mode "required", the guard above returns 401 if null.
          // For mode "optional"/"none", handlers accept null. Either way, this is sound.
          response = await (handler as AuthOptionalHandler<TContext>)(
            ctx,
            request,
            sessionUser,
            context,
          );
          responseStatus = response.status;
          if (response.status === 503)
            response.headers.set("cache-control", "no-store");
          return response;
        } catch (error) {
          // Wrapper only catches unhandled errors - route should handle domain errors
          responseStatus = 500;
          logRequestError(ctx.log, error, "INTERNAL_SERVER_ERROR");

          if (unhandledErrorPolicy === "rethrow") {
            throw error;
          }

          // respond_500: convert to 500 for production safety
          response = NextResponse.json(
            { error: "Internal server error" },
            { status: responseStatus },
          );
          return response;
        } finally {
          // Always log request end exactly once and record metrics
          const durationMs = performance.now() - start;

          logRequestEnd(ctx.log, { status: responseStatus, durationMs });

          // Skip metrics recording for scraper endpoint to avoid polluting user traffic metrics
          if (options.routeId !== "meta.metrics") {
            httpRequestsTotal.inc({
              route: options.routeId,
              method: request.method,
              status: statusBucket(responseStatus),
            });
            httpRequestDurationMs.observe(
              { route: options.routeId, method: request.method },
              durationMs,
            );
          }
        }
      },
    );
  };
}
