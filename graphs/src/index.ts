// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Node-owned catalog composition; preserve base graphs and defaults. */
import { LANGGRAPH_CATALOG as BASE_CATALOG, LANGGRAPH_GRAPH_IDS as BASE_GRAPH_IDS } from "@cogni/langgraph-graphs";
import { LANGGRAPH_CATALOG as SHARED_CATALOG, NODE_LANGGRAPH_CATALOG } from "@cogni/shared-langgraph-graphs";
const sharedPrioritizer = SHARED_CATALOG["work-prioritizer"];
if (!sharedPrioritizer) throw new Error("Published baseline lacks work-prioritizer");
// Read-only on this node, as before: the in-proc runner does not pass `program`, so the released
// prioritizer would hold the full-schema item writers with no triage guard or receipt.
const READ_ONLY_DROPPED = new Set(["core__work_item_update", "core__work_item_artifact_record"]);
const prioritizer = {
  ...sharedPrioritizer,
  toolIds: sharedPrioritizer.toolIds.filter((id) => !READ_ONLY_DROPPED.has(id)),
  systemPrompt: `${sharedPrioritizer.systemPrompt} READ-ONLY ON THIS NODE: triage writes are off, so core__work_item_update and core__work_item_artifact_record are not available. Do not try to change any item. Read as above, then report in your final answer the routes, scores and cancels you would make, one line per item, with the reason for each. Reporting them satisfies the run; ignore the instruction to write.`,
};
// The shared coordinator runs through the provider's guarded shared runtime. LevelUp has no sandbox:
// the provider never offers its shell tool.
const cogni = NODE_LANGGRAPH_CATALOG.cogni;
if (!cogni) throw new Error("Published baseline lacks cogni");
export const LANGGRAPH_CATALOG = {
  ...BASE_CATALOG,
  cogni: { ...cogni, sharedRuntime: true },
  "work-prioritizer": prioritizer,
};
export const LANGGRAPH_GRAPH_IDS = {
  ...BASE_GRAPH_IDS,
  cogni: "langgraph:cogni",
  workPrioritizer: "langgraph:work-prioritizer",
} as const;
export { DEFAULT_LANGGRAPH_GRAPH_ID } from "@cogni/langgraph-graphs";
export * from "@cogni/langgraph-graphs/graphs";

// Published wrapper resolves its public ai-tools peer here; app keeps its local tool package.
// The shared graph and runner must resolve through the same package instance.
export type { InProcRunnerOptions as SharedRunnerOptions } from "@cogni/shared-langgraph-graphs";
export {
  createInProcGraphRunner,
  createInProcGraphRunner as createSharedInProcGraphRunner,
  NODE_LANGGRAPH_CATALOG as SHARED_NODE_CATALOG,
} from "@cogni/shared-langgraph-graphs";
