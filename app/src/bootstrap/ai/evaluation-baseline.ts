// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Published evaluation behavior composed with LevelUp's existing product policy. */
import { type CatalogBoundTool, CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import { CORE_TOOL_BUNDLE as SHARED_TOOL_BUNDLE,
  type CatalogBoundTool as SharedCatalogBoundTool,
} from "@cogni/shared-ai-tools";

const baselineIds = new Set([
  "core__goal_list", "core__work_item_query", "core__work_item_transition",
  "core__knowledge_search",
  "core__knowledge_read",
  "core__knowledge_write",
  "core__edo_hypothesize",
  "core__edo_decide",
  "core__edo_record_outcome", "core__get_current_time",
]);
const localById = new Map(CORE_TOOL_BUNDLE.map((tool) => [tool.contract.name, tool]));
export const LEVELUP_SHARED_TOOL_BUNDLE = SHARED_TOOL_BUNDLE.filter((tool) => baselineIds.has(tool.contract.name)).map((shared) => {
  const local = localById.get(shared.contract.name);
  return local ? { ...shared, contract: { ...local.contract, ...shared.contract } } : shared;
});
export const LEVELUP_LOCAL_TOOL_BUNDLE = CORE_TOOL_BUNDLE.filter((tool) => !baselineIds.has(tool.contract.name));
export type LevelupCatalogBoundTool = CatalogBoundTool | SharedCatalogBoundTool;
export const LEVELUP_CORE_TOOL_BUNDLE: readonly LevelupCatalogBoundTool[] = [
  ...LEVELUP_LOCAL_TOOL_BUNDLE, ...LEVELUP_SHARED_TOOL_BUNDLE,
];
