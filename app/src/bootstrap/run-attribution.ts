// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/run-attribution`
 * Purpose: This node's one binding of `@cogni/work-items` `createRunAttribution`: the run scope it reads and the logger it writes to.
 * Scope: Composition only. The builders (`actingPrincipal`, `routeAttribution`, `runAttribution`, `attributionFields`) live in the package.
 * Invariants:
 *   - ACTOR_IS_THE_RUN_IDENTITY: the catalog principal is distinct from the requester; missing principal fails closed.
 * Side-effects: none at import
 * @internal
 */

import { createRunAttribution, type RunAttributionScope } from "@cogni/work-items";
import { getExecutionScope } from "@/adapters/server/ai/execution-scope";
import { makeLogger } from "@/shared/observability";

/** The run facts the package builds an attribution from, read from the current execution scope. */
export function runAttributionScope(): RunAttributionScope {
  const { principalId, subjectUserId, runId, runKind } = getExecutionScope();
  return { principalId, subjectUserId, runId, runKind };
}

/** The attribution of a write made by a graph tool: the current run's acting identity and run. */
export const runAttribution = createRunAttribution({
  scope: runAttributionScope,
  log: makeLogger({ component: "write-attribution" }),
});
