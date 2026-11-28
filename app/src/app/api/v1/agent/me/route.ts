// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** The published self-only identity and live grants probe. */
import { agentMeHttp } from "@cogni/agent-grants/http";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { requestCredentialKind } from "@/shared/authenticated-identity";
import { agentHttpDeps, agentHttpResponse } from "../respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = wrapRouteHandlerWithLogging(
  { routeId: "agent.me", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, user) =>
    agentHttpResponse(
      await agentMeHttp(agentHttpDeps(ctx.log), {
        userId: user.id,
        via: requestCredentialKind(user),
        authority: getContainer().agentAuthority,
      }),
    ),
);
