// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Thin compatibility constructor. The published provider owns guards, execution and denial. */
import type { ToolSourcePort } from "@cogni/ai-core";
import type { CatalogBoundTool } from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/node-template-graphs";
import {
  type CompletionUnitPort,
  createLangGraphInProcProvider,
  type InProcProviderDeps,
} from "@cogni/shared-langgraph-graphs/inproc";
import { trace } from "@opentelemetry/api";
import {
  getExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import type {
  ExecutionContext,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
  LlmToolDefinition,
} from "@/ports";
import { makeLogger } from "@/shared/observability";

export const LANGGRAPH_PROVIDER_ID = "langgraph" as const;
export type CompletionUnitAdapter = CompletionUnitPort<LlmToolDefinition>;
type ProviderOptions = Pick<
  InProcProviderDeps<LlmToolDefinition>,
  | "authority"
  | "sourceContext"
  | "persistence"
  | "isChildModelAllowed"
  | "createRunner"
>;

/** Capture each run's scope; only the published guard binds its acting principal. */
export const providerRunScope: InProcProviderDeps["scope"] = {
  current() {
    const scope = getExecutionScope();
    return {
      subjectUserId: scope.subjectUserId,
      accountId: scope.billing.billingAccountId,
      abortSignal: scope.abortSignal,
      runAs(identity, fn) {
        return runInScope(
          {
            ...scope,
            principalId: identity.principalId,
            subjectUserId: identity.subjectUserId,
            runId: identity.runId,
          },
          fn,
        );
      },
    };
  },
};

export class LangGraphInProcProvider implements GraphExecutorPort {
  readonly providerId = LANGGRAPH_PROVIDER_ID;
  private readonly delegate: ReturnType<
    typeof createLangGraphInProcProvider<LlmToolDefinition>
  >;

  constructor(
    completion: CompletionUnitAdapter,
    tools: ToolSourcePort,
    mcpTools: () => Promise<ToolSourcePort | null> = () =>
      Promise.resolve(null),
    toolBundle: readonly CatalogBoundTool[] = [],
    catalog: InProcProviderDeps["catalog"] = LANGGRAPH_CATALOG,
    options: ProviderOptions = {},
  ) {
    this.delegate = createLangGraphInProcProvider({
      catalog,
      completion,
      tools,
      toolBundle,
      scope: providerRunScope,
      log: makeLogger({ component: "LangGraphInProcProvider" }),
      mcpTools,
      traceId: () => trace.getActiveSpan()?.spanContext().traceId,
      ...options,
    });
  }

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const { runKind } = getExecutionScope();
    return this.delegate.runGraph(req, {
      ...ctx,
      ...(runKind && runKind !== "user_immediate" ? { unattended: true } : {}),
    });
  }
}
