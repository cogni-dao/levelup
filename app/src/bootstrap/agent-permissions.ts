// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Node composition only: published declarations drive discovery and the HTTP doors. */
import { composeAgentRoutes } from "@cogni/agent-grants";
import {
  buildPermissionCatalog,
  buildRequiresById,
} from "@cogni/agent-grants/host";
import { LEVELUP_SHARED_TOOL_BUNDLE } from "./ai/evaluation-baseline";

export const LEVELUP_AGENT_ROUTES = composeAgentRoutes();
export const LEVELUP_REQUIRES = buildRequiresById(
  LEVELUP_SHARED_TOOL_BUNDLE.map(({ contract }) => ({
    id: contract.name,
    requires: contract.requires,
  })),
);
export const LEVELUP_PERMISSIONS = buildPermissionCatalog(LEVELUP_REQUIRES);

/** A baseline twin is mounted only when LevelUp offers its tool. No permission is copied here. */
export function routeAuthorityId(routeId: string): string | undefined {
  for (const [toolId, declaration] of Object.entries(
    LEVELUP_AGENT_ROUTES.sameDoorRoutes,
  )) {
    if (!declaration.routes.includes(routeId) || !LEVELUP_REQUIRES[toolId])
      continue;
    if (LEVELUP_REQUIRES[toolId]?.scope !== declaration.scope)
      throw new Error("route_scope_mismatch");
    return toolId;
  }
  for (const [id, declaration] of Object.entries(
    LEVELUP_AGENT_ROUTES.routeOnlyCapabilities,
  )) {
    if (declaration.routes.includes(routeId)) return id;
  }
  return undefined;
}
