// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Node-owned catalog composition; preserve base graphs and defaults. */
import { LANGGRAPH_CATALOG as BASE_CATALOG, LANGGRAPH_GRAPH_IDS as BASE_GRAPH_IDS } from "@cogni/langgraph-graphs";
import { LANGGRAPH_CATALOG as SHARED_CATALOG } from "@cogni/shared-langgraph-graphs";
const prioritizer = SHARED_CATALOG["work-prioritizer"];
if (!prioritizer) throw new Error("Published baseline lacks work-prioritizer");
export const LANGGRAPH_CATALOG = { ...BASE_CATALOG, "work-prioritizer": prioritizer };
export const LANGGRAPH_GRAPH_IDS = { ...BASE_GRAPH_IDS, workPrioritizer: "langgraph:work-prioritizer" } as const;
export { DEFAULT_LANGGRAPH_GRAPH_ID } from "@cogni/langgraph-graphs";
export * from "@cogni/langgraph-graphs/graphs";

// Published wrapper resolves its public ai-tools peer here; app keeps its local tool package.
export { createInProcGraphRunner } from "@cogni/shared-langgraph-graphs";
