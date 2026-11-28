// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/work/items/[id]/route`
 * Purpose: HTTP endpoints for getting, patching, and deleting a single work item by ID.
 * Scope: Auth-protected GET (node-local Doltgres first, markdown fallback), PATCH (Doltgres only), and DELETE (retired, HTTP410 with revisioned cancellation advice).
 * Invariants: VALIDATE_IO, CONTRACTS_ARE_TRUTH, AUTH_VIA_GETSESSIONUSER, PATCH_ALLOWLIST, DELETE_PRESERVES_CONTENT_AND_HISTORY.
 * Write errors (task.0097): `workItemWriteErrorResponse` from @cogni/work-items answers every write-contract error below; this route keeps only auth, 403, 404, node-admin and backend-unavailable.
 * Reason + cites (task.0086): a missing or over-cap reason is HTTP 400 `invalid input` with an issue at `reason`; an unknown cite id or a closed inbox is HTTP 400 `cite_unresolved`; cites with no resolver wired is HTTP 400 `cites_unsupported`; a resolver failure is HTTP 503. Nothing is written in each case.
 * Moves (story.0033): `set.moves` with an unknown or deprecated metric id is HTTP 400 `cite_unresolved` with an issue at `set.moves`; a bad list is HTTP 400 `invalid input`; a non-empty list with no metric wiring is HTTP 400 `moves_unsupported`; a resolver failure is HTTP 503 `cite_resolver_unavailable`; a baseline failure is HTTP 503 `metric_baseline_unavailable`. The client never sets a baseline: the server pins it.
 * Envelope (task.0118): GET returns each `moves` entry with its metric, KPI and goal; `?include=links` adds the first page of citation links (same read as /api/v1/citations/{id}); an unknown include is HTTP 400.
 * Read core (story.0085): `handleWorkItemGet` from @cogni/work-items parses `include`/`artifact`, refuses 400/404 and returns the one
 *   terminal event; this route keeps only auth and the store read.
 * Side-effects: IO (HTTP response, filesystem read via port, Doltgres read/write)
 * Links: contracts/work.items.{get,patch,delete}.v1.contract
 * @public
 */

import {
  workItemsGetOperation,
  workItemsPatchOperation,
} from "@cogni/node-contracts";
import {
  handleWorkItemGet,
  handleWorkItemPatch,
  routeAttribution,
} from "@cogni/work-items";
import { NextResponse } from "next/server";

import {
  getWorkItem,
  patchWorkItem,
  WorkItemForbiddenError,
  WorkItemNotFoundError,
  NodeAdminRequiredError,
} from "@/app/_facades/work/items.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/work/items/:id — Get a single work item by ID from node-local
 * Doltgres, falling back to the legacy markdown port when not imported.
 */
export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.get", auth: { mode: "required", getSessionUser } },
  async (ctx, request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;

    // The package owns the `include`/`artifact` parse, the 400/404/503/499 refusals and the one terminal event (story.0085).
    const result = await handleWorkItemGet(id, {
      searchParams: new URL(request.url).searchParams,
      signal: request.signal,
      read: (itemId, options) => getWorkItem(itemId, { signal: request.signal, ...options }),
      toBody: (item) => workItemsGetOperation.output.parse(item),
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/**
 * PATCH /api/v1/work/items/:id — Patch a work item (Doltgres only).
 *
 * The immutable authenticated principal must match the creator stamped when
 * the row was inserted. The path id remains authoritative over request data.
 */
export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.patch", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    // The package owns parse, refusals and the one terminal event (bug.0063); this route keeps auth, the actor and node errors.
    const attribution = routeAttribution(sessionUser.id);
    const result = await handleWorkItemPatch(id, {
      readJson: () => request.json(),
      parse: (body) => workItemsPatchOperation.input.safeParse(body),
      write: (input) =>
        patchWorkItem(
          input,
          {
            id: sessionUser.id,
            walletAddress: sessionUser.walletAddress,
          },
          attribution
        ),
      attribution,
      toBody: (patched) => workItemsPatchOperation.output.parse(patched),
      mapNodeError: (e) => {
        if (e instanceof WorkItemNotFoundError)
          return { status: 404, errorCode: "not_found", body: { error: e.message } };
        if (e instanceof WorkItemForbiddenError)
          return { status: 403, errorCode: "forbidden", body: { error: e.message } };
        if (e instanceof NodeAdminRequiredError)
          return {
            status: e.status,
            errorCode: e.errorCode,
            body: { error: e.message, errorCode: e.errorCode, action: e.action },
          };
        return undefined;
      },
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/** Retired: cancel with PATCH, a reason and the current expectedRevision. */
export const DELETE = wrapRouteHandlerWithLogging<{ params: Promise<{ id: string }> }>(
  { routeId: "work.items.delete", bearerWrite: "Retired endpoint returns 410 without mutation", auth: { mode: "required", getSessionUser } },
  async () => NextResponse.json({
    error: "Work-item deletion is retired; use PATCH with set.status=cancelled, reason and expectedRevision.",
    errorCode: "work_item_delete_retired",
  }, { status: 410 }),
);
