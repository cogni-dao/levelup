// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** LevelUp uses the released contracts, including their schemas and authorization requirements. */
import { type CatalogBoundTool, CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import { LEVELUP_TOOL_IDS } from "@cogni/node-template-graphs";

const hostTools = new Set<string>(LEVELUP_TOOL_IDS);
export const LEVELUP_CORE_TOOL_BUNDLE = CORE_TOOL_BUNDLE.filter((tool) =>
  hostTools.has(tool.contract.name),
);
export const LEVELUP_LOCAL_TOOL_BUNDLE: readonly CatalogBoundTool[] = [];
export const LEVELUP_SHARED_TOOL_BUNDLE = LEVELUP_CORE_TOOL_BUNDLE;
export type LevelupCatalogBoundTool = CatalogBoundTool;
