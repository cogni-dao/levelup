// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** LevelUp uses the released contracts, including their schemas and authorization requirements. */
import { CORE_TOOL_BUNDLE, type CatalogBoundTool } from "@cogni/ai-tools";
const hostTools = new Set([
  "core__get_current_time", "core__goal_list", "core__work_item_query", "core__work_item_read",
  "core__work_item_update", "core__work_item_artifact_record",
  "core__knowledge_search", "core__knowledge_read", "core__knowledge_write",
  "core__edo_hypothesize", "core__edo_decide", "core__edo_record_outcome",
  "core__metrics_query", "core__web_search", "core__repo_list", "core__repo_open", "core__repo_search",
  "core__schedule_list", "core__schedule_manage",
  "core__vcs_get_ci_status", "core__vcs_list_prs", "core__goal_progress",
  "core__metric_list", "core__metric_read", "core__metric_history", "core__metric_compute",
]);
export const LEVELUP_CORE_TOOL_BUNDLE = CORE_TOOL_BUNDLE.filter(tool => hostTools.has(tool.contract.name));
export const LEVELUP_LOCAL_TOOL_BUNDLE: readonly CatalogBoundTool[] = [];
export const LEVELUP_SHARED_TOOL_BUNDLE = LEVELUP_CORE_TOOL_BUNDLE;
export type LevelupCatalogBoundTool = CatalogBoundTool;
