// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Dev execution is permitted only for plain read-only graphs. The published predicate owns the decision. */
import { LANGGRAPH_CATALOG } from "@cogni/node-template-graphs";
import { requiresInProcess } from "@cogni/shared-langgraph-graphs/inproc";
import { LEVELUP_CORE_TOOL_BUNDLE } from "@/bootstrap/ai/evaluation-baseline";
import type { GraphExecutorPort } from "@/ports";

export function routeLangGraphProvider(
  inproc: GraphExecutorPort,
  dev?: GraphExecutorPort,
): GraphExecutorPort & { readonly providerId: "langgraph" } {
  return {
    providerId: "langgraph",
    runGraph(req, ctx) {
      const entry = LANGGRAPH_CATALOG[req.graphId.slice("langgraph:".length)];
      const target =
        dev && entry && !requiresInProcess(entry, LEVELUP_CORE_TOOL_BUNDLE)
          ? dev
          : inproc;
      return target.runGraph(req, ctx);
    },
  };
}
