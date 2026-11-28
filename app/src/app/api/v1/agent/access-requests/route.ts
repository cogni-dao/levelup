// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Thin host mount. 0.11.0 still refuses sessions; parent must adopt qualified 0.11.1 before flight. */
import {
  accessRequestCreateHttp,
  accessRequestListHttp,
} from "@cogni/agent-grants/http";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { requestCredentialKind } from "@/shared/authenticated-identity";
import { serverEnv } from "@/shared/env";
import { agentHttpDeps, agentHttpResponse } from "../respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "agent.access.requests.list",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, user) =>
    agentHttpResponse(
      await accessRequestListHttp(agentHttpDeps(ctx.log), {
        via: requestCredentialKind(user),
        principalUserId: user.id,
        authority: getContainer().agentAuthority,
      }),
    ),
);
export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "agent.access.requests.create",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, user) => {
    let origin: string;
    try {
      origin = new URL(serverEnv().APP_BASE_URL ?? "").origin;
    } catch {
      return agentHttpResponse({
        status: 503,
        body: { error: "authz_unavailable" },
        headers: { "cache-control": "no-store" },
      });
    }
    return agentHttpResponse(
      await accessRequestCreateHttp(agentHttpDeps(ctx.log), {
        via: requestCredentialKind(user),
        principalUserId: user.id,
        body: await request.json().catch(() => undefined),
        origin,
        authority: getContainer().agentAuthority,
      }),
    );
  },
);
