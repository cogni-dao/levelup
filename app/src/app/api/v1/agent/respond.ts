// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import type {
  AgentHttpDeps,
  AgentHttpResponse,
} from "@cogni/agent-grants/http";
import { NextResponse } from "next/server";
import { EVENT_NAMES, type RequestContext } from "@/shared/observability";

export const agentHttpDeps = (log: RequestContext["log"]): AgentHttpDeps => ({
  onUnavailable: (routeId) =>
    log.error(
      { event: EVENT_NAMES.AGENT_ROLES_UNAVAILABLE, routeId },
      EVENT_NAMES.AGENT_ROLES_UNAVAILABLE,
    ),
});
export const agentHttpResponse = (result: AgentHttpResponse) =>
  NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
