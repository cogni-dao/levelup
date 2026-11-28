// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Thin node-only approval door: existing identity, bound-wallet DAO check, then published HTTP core. */
import {
  type AdminAiAccessCall,
  type AdminAiAccessCalls,
  adminAiAccessHttp,
} from "@cogni/agent-grants/http";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function handler(call: AdminAiAccessCall) {
  return wrapRouteHandlerWithLogging(
    {
      routeId: `admin.ai-access.${call}`,
      auth: { mode: "required", getSessionUser },
    },
    async (ctx, request, user) => {
      const respond = (body: unknown, status: number) =>
        NextResponse.json(body, {
          status,
          headers: { "cache-control": "no-store" },
        });
      if (!user) return respond({ error: "unauthorized" }, 401);
      const bearer = request.headers
        .get("authorization")
        ?.toLowerCase()
        .startsWith("bearer ");
      const publicOrigin = serverEnv().APP_BASE_URL;
      if (
        call !== "list" &&
        !bearer &&
        (!publicOrigin ||
          request.headers.get("origin") !== new URL(publicOrigin).origin)
      ) {
        return respond({ error: "forbidden" }, 403);
      }
      const authority = getContainer().agentAuthority;
      let admin: Awaited<ReturnType<typeof authority.adminCheck>>;
      try {
        admin = await authority.adminCheck(user.id);
      } catch {
        return respond({ error: "authz_unavailable" }, 503);
      }
      if (admin === "unavailable")
        return respond({ error: "authz_unavailable" }, 503);
      if (admin !== "allow")
        return call === "list"
          ? respond({ canManage: false, permissions: [], more: 0 }, 200)
          : respond({ error: "forbidden" }, 403);
      // Mint the admin proof only after the same bound-wallet authority check for either credential.
      const me = { userId: user.id, admin: { userId: user.id } };
      const calls: AdminAiAccessCalls = {
        list: () => authority.listNodeAi(),
        on: async ({ ref, scope }) => {
          const r = await authority.grantRole({ ...ref, scope, me });
          return { principalUserId: r.principalUserId, changed: r.created };
        },
        off: async ({ ref, scope }) => {
          const r = await authority.revokeRole({ ...ref, scope, me });
          return { principalUserId: r.principalUserId, changed: r.revoked };
        },
        dismiss: async ({ ref, scope }) => {
          const r = await authority.denyRequest({ ...ref, scope, me });
          return { principalUserId: r.principalUserId, changed: r.denied };
        },
        preview: (token) => authority.previewAsk({ token, resource: "node" }),
      };
      const body =
        call === "list"
          ? undefined
          : await request.json().catch(() => undefined);
      const result = await adminAiAccessHttp(
        {
          onUnavailable: (routeId) =>
            ctx.log.error(
              { event: EVENT_NAMES.AGENT_ROLES_UNAVAILABLE, routeId },
              EVENT_NAMES.AGENT_ROLES_UNAVAILABLE,
            ),
        },
        call,
        { calls, body },
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: result.headers,
      });
    },
  );
}
export const GET = handler("list");
export const POST = handler("on");
export const DELETE = handler("off");
