// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Node-owned catalog composition (story.0090). LevelUp runs only the published core graphs: the shared
 * `cogni` coordinator and `work-prioritizer`. It has no local graphs and no sandbox.
 */
import {
  LANGGRAPH_CATALOG as SHARED_CATALOG,
  LANGGRAPH_PROVIDER_ID,
  NODE_LANGGRAPH_CATALOG,
} from "@cogni/shared-langgraph-graphs";

const sharedPrioritizer = SHARED_CATALOG["work-prioritizer"];
if (!sharedPrioritizer) throw new Error("Published baseline lacks work-prioritizer");
// Read-only on this node: the in-proc runner does not pass `program`, so the released prioritizer would
// hold the full-schema item writers with no triage guard or receipt.
const READ_ONLY_DROPPED = new Set(["core__work_item_update", "core__work_item_artifact_record"]);
const prioritizer = {
  ...sharedPrioritizer,
  toolIds: sharedPrioritizer.toolIds.filter((id) => !READ_ONLY_DROPPED.has(id)),
  systemPrompt: `${sharedPrioritizer.systemPrompt} READ-ONLY ON THIS NODE: triage writes are off, so core__work_item_update and core__work_item_artifact_record are not available. Do not try to change any item. Read as above, then report in your final answer the routes, scores and cancels you would make, one line per item, with the reason for each. Reporting them satisfies the run; ignore the instruction to write.`,
};

// The shared coordinator runs through the provider's guarded shared runtime, which never offers the
// sandbox shell on this node.
const cogni = NODE_LANGGRAPH_CATALOG.cogni;
if (!cogni) throw new Error("Published baseline lacks cogni");

const sharedCogni = { ...cogni, sharedRuntime: true };
export type NodeCatalogEntry = typeof sharedCogni | typeof prioritizer;
export const LANGGRAPH_CATALOG: Readonly<Record<string, NodeCatalogEntry>> = {
  cogni: sharedCogni,
  "work-prioritizer": prioritizer,
};
export const LANGGRAPH_GRAPH_IDS = {
  cogni: `${LANGGRAPH_PROVIDER_ID}:cogni`,
  "work-prioritizer": `${LANGGRAPH_PROVIDER_ID}:work-prioritizer`,
} as const;
export type LangGraphGraphId = (typeof LANGGRAPH_GRAPH_IDS)[keyof typeof LANGGRAPH_GRAPH_IDS];
export const DEFAULT_LANGGRAPH_GRAPH_ID: LangGraphGraphId = LANGGRAPH_GRAPH_IDS.cogni;
export { LANGGRAPH_PROVIDER_ID };

// The shared graph and runner must resolve through the same package instance.
export type { InProcRunnerOptions as SharedRunnerOptions } from "@cogni/shared-langgraph-graphs";
export {
  createInProcGraphRunner,
  createInProcGraphRunner as createSharedInProcGraphRunner,
  NODE_LANGGRAPH_CATALOG as SHARED_NODE_CATALOG,
} from "@cogni/shared-langgraph-graphs";
