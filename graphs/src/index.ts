// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** One composed catalog for execution, discovery and coordinator guidance. */
import { CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import {
  LANGGRAPH_CATALOG as PRODUCT_CATALOG,
  LANGGRAPH_GRAPH_IDS as PRODUCT_GRAPH_IDS,
} from "@cogni/langgraph-graphs";
import { LANGGRAPH_CATALOG as SHARED_CATALOG } from "@cogni/shared-langgraph-graphs";
import { createNodeCatalog } from "@cogni/shared-langgraph-graphs/inproc";
import { LEVELUP_TOOL_IDS } from "./tool-policy";

const cogni = SHARED_CATALOG.cogni;
const prioritizer = SHARED_CATALOG["work-prioritizer"];
if (!cogni || !prioritizer)
  throw new Error("Published catalog lacks required programs");
const scopedToolIds = new Set(
  CORE_TOOL_BUNDLE.filter(
    ({ contract }) => contract.requires || contract.effect !== "read_only",
  ).map(({ contract }) => contract.name),
);
const hostedTools = new Set<string>(LEVELUP_TOOL_IDS);
export const LANGGRAPH_CATALOG = createNodeCatalog(
  { cogni, "work-prioritizer": prioritizer },
  {
    // Keep every product factory, prompt and tool list. Roles remain OFF until independently approved.
    add: Object.fromEntries(
      Object.entries(PRODUCT_CATALOG).map(([id, entry]) => [
        id,
        entry.toolIds.some((tool) => scopedToolIds.has(tool))
          ? { ...entry, principal: "node-ai" }
          : entry,
      ]),
    ),
    narrow: {
      cogni: {
        removeToolIds: cogni.toolIds.filter((id) => !hostedTools.has(id)),
      },
    },
  },
);
export const LANGGRAPH_GRAPH_IDS = {
  ...PRODUCT_GRAPH_IDS,
  cogni: "langgraph:cogni",
  workPrioritizer: "langgraph:work-prioritizer",
} as const;
export { DEFAULT_LANGGRAPH_GRAPH_ID } from "@cogni/langgraph-graphs";
export * from "@cogni/langgraph-graphs/graphs";
export { createInProcGraphRunner } from "@cogni/shared-langgraph-graphs";
export { LEVELUP_TOOL_IDS } from "./tool-policy";
