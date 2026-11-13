// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/langgraph/inproc.provider.authority`
 * Purpose: Tool authority at the provider seam (task.5456, V4 V5 V7), adapted to the graphs LevelUp ships (brain is the only one that names a principal): the catalog principal, the guard
 *   around every createToolRunner site, and the principal/subject binding the tools observe.
 * Scope: Real provider + real guard + real ai-core tool runner over an in-memory role store. The graph runner is
 *   stubbed: it only hands back `createToolExecFn`. No database, no LLM.
 * Invariants: SCOPED_TOOL_NEEDS_PRINCIPAL, SUBJECT_ONLY_NARROWS, GUARD_COVERS_EVERY_RUNNER_SITE.
 * Side-effects: none
 * Links: inproc.provider.ts, packages/agent-grants
 */

import type { AgentGrantsStore, GuardDeps } from "@cogni/agent-grants";
import type { AiEvent, ToolSourcePort } from "@cogni/ai-core";
import {
  CORE_TOOL_BUNDLE,
  type CatalogBoundTool,
  toBoundToolRuntime,
} from "@cogni/ai-tools";
import { describe, expect, it, vi } from "vitest";

import {
  getExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import { runGraphWithScope } from "@/bootstrap/graph-executor.factory";
import {
  LangGraphInProcProvider,
  type ProviderAgentAuthority,
} from "@/adapters/server/ai/langgraph/inproc.provider";

const captured = vi.hoisted(() => ({
  /** "abort": the stub graph waits for the run's abort signal, then reports it as the real runner does (error + done). */
  mode: "finish" as "finish" | "abort",
  options: [] as Array<{
    request: { abortSignal?: AbortSignal; messages: Array<{ role: string; content: string }>; configurable: { toolIds: string[] } };
    toolContracts: Array<{ name: string }>;
    completionFn: (params: { model: string; messages: unknown[] }) => { final: Promise<unknown> };
    createToolExecFn: (
      emit: (e: AiEvent) => void,
    ) => (
      name: string,
      args: unknown,
      id?: string,
    ) => Promise<{ ok: boolean; [k: string]: unknown }>;
  }>,
}));
vi.mock("@cogni/node-template-graphs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cogni/node-template-graphs")>();
  return {
    ...actual,
    createInProcGraphRunner: (options: (typeof captured.options)[number]) => {
      captured.options.push(options);
      if (captured.mode === "abort") {
        const signal = options.request.abortSignal;
        const aborted = new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          stream: (async function* () {
            await aborted;
            // The real graph needs a moment to unwind after the abort; a looping graph may call the model in that window.
            await new Promise((r) => setTimeout(r, 25));
            yield { type: "error" as const, error: "aborted" };
            yield { type: "done" as const };
          })(),
          final: aborted.then(() => new Promise((r) => setTimeout(r, 25))).then(() => ({ ok: false as const, error: "aborted" })),
        };
      }
      return {
        stream: (async function* () {
          yield { type: "done" as const };
        })(),
        final: Promise.resolve({ ok: true as const }),
      };
    },
  };
});

const REACHED = "stub_tool_reached";
const reached = (r: { ok: boolean; safeMessage?: unknown }) =>
  !r.ok && r.safeMessage === REACHED;

const PRIORITIZER_USER = "user-prioritizer";
const NODE_AI_USER = "user-node-ai";
const ADMIN = "human-admin";
const MEMBER = "human-member";
const AGENT = "bearer-agent"; // an authenticated machine caller: a subject like any other, with no wallet

function store(roles: Array<[string, string]>): AgentGrantsStore {
  return {
    hasLiveRole: async (p, s) => roles.some(([rp, rs]) => rp === p && rs === s),
    liveScopes: async (p, scopes) => scopes.filter((s) => roles.some(([rp, rs]) => rp === p && rs === s)),
    listLiveRoles: async () => [],
    findInternalPrincipal: async () => null,
    insertRole: async () => true,
    revokeRole: async () => true,
  };
}

function authority(opts: {
  principals: Record<string, string>;
  roles: Array<[string, string]>;
}): ProviderAgentAuthority & { events: unknown[] } {
  const events: unknown[] = [];
  const s = store(opts.roles);
  const deps: Omit<GuardDeps, "runAs"> = {
    withStore: (fn) => fn(s),
    // Only the DAO admin's wallet passes; humans without one and agents (no wallet) are denied.
    adminCheck: async (id) => (id === ADMIN ? "allow" : "denied"),
    onDecision: (e) => events.push(e),
  };
  return {
    events,
    resolvePrincipal: async (slug) => opts.principals[slug] ?? null,
    guardDeps: deps,
  };
}

/** Real contracts and runtimes, with recording stub implementations that return schema-valid output. */
function toolSource(seen: Array<{ tool: string; scope: unknown }>): {
  source: ToolSourcePort;
  bundle: CatalogBoundTool[];
} {
  const bundle = CORE_TOOL_BUNDLE.map((tool) => ({
    contract: tool.contract,
    implementation: {
      execute: async () => {
        seen.push({ tool: tool.contract.name, scope: { ...getExecutionScope() } });
        // The tool body is out of scope here: reaching it is the "allowed" signal.
        throw new Error(REACHED);
      },
    },
  })) as CatalogBoundTool[];
  const runtimes = new Map(bundle.map((t) => [t.contract.name, toBoundToolRuntime(t)]));
  return {
    bundle,
    source: {
      getBoundTool: (id) => runtimes.get(id),
      listToolSpecs: () => [...runtimes.values()].map((r) => r.spec),
      hasToolId: (id) => runtimes.has(id),
    },
  };
}

const adapter = { executeCompletionUnit: vi.fn() };

async function start(
  graph: string,
  auth: ProviderAgentAuthority | undefined,
  subjectUserId: string | undefined,
  seen: Array<{ tool: string; scope: unknown }> = [],
  ctxExtra: { requestIntent?: "answer" | "decide" } = {},
  logged?: Array<Record<string, unknown>>,
) {
  captured.options.length = 0;
  const { source, bundle } = toolSource(seen);
  const provider = new LangGraphInProcProvider(
    adapter,
    source,
    undefined,
    bundle,
    undefined,
    auth,
  );
  if (logged)
    (provider as unknown as { log: unknown }).log = {
      debug: () => {}, info: () => {}, error: () => {},
      warn: (fields: Record<string, unknown>) => logged.push(fields),
    };
  const scope = {
    billing: { billingAccountId: "payer-1", virtualKeyId: "vk" },
    usageSource: "litellm" as const,
    llmService: {} as never,
    ...(subjectUserId ? { subjectUserId } : {}),
  };
  const events: AiEvent[] = [];
  const result = runInScope(scope, () =>
    provider.runGraph(
      {
        runId: `run-${graph}`,
        graphId: `langgraph:${graph}`,
        messages: [{ role: "user", content: "go" }],
        modelRef: { providerKey: "platform", modelId: "m" },
      },
      { actorUserId: subjectUserId ?? "unused-for-authority", ...ctxExtra },
    ),
  );
  for await (const event of result.stream) events.push(event);
  const options = captured.options[0];
  return {
    final: await result.final,
    events,
    options,
    exec: (name: string, args: unknown) =>
      runInScope(scope, () => options!.createToolExecFn(() => {})(name, args, "c1")),
  };
}

/** The `agent_tool.authz` events for one tool, so a test can ignore the run-start `not_offered` lines for other tools. */
const forTool = (events: unknown[], tool: string) =>
  (events as Array<{ tool: string }>).filter((e) => e.tool === tool);


describe("V4: a graph whose principal has no seed row is denied before any tool runs", () => {
  it("fails the run and never builds a tool runner", async () => {
    const auth = authority({ principals: {}, roles: [] });
    const run = await start("brain", auth, undefined);
    expect(run.events).toEqual([{ type: "error", error: "internal" }, { type: "done" }]);
    expect(run.options).toBeUndefined();
  });

  it("fails the run when no authority is wired at all", async () => {
    const run = await start("brain", undefined, undefined);
    expect(run.options).toBeUndefined();
  });
});

describe("a principal-store outage is authz_unavailable and is logged", () => {
  it("logs agent_tool.authz (unavailable / principal_lookup_failed), fails the run closed and builds no runner", async () => {
    captured.options.length = 0;
    const { source, bundle } = toolSource([]);
    const down: ProviderAgentAuthority = {
      resolvePrincipal: async () => {
        throw new Error("connection refused");
      },
      guardDeps: authority({ principals: {}, roles: [] }).guardDeps,
    };
    const provider = new LangGraphInProcProvider(adapter, source, undefined, bundle, undefined, down);
    const logged: Array<Record<string, unknown>> = [];
    (provider as unknown as { log: unknown }).log = {
      debug: () => {}, info: () => {}, warn: () => {},
      error: (fields: Record<string, unknown>) => logged.push(fields),
    };
    const scope = { billing: { billingAccountId: "payer-1", virtualKeyId: "vk" }, usageSource: "litellm" as const, llmService: {} as never };
    const result = runInScope(scope, () =>
      provider.runGraph(
        { runId: "run-down", graphId: "langgraph:brain", messages: [{ role: "user", content: "go" }], modelRef: { providerKey: "platform", modelId: "m" } },
        { actorUserId: MEMBER },
      ),
    );
    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);
    expect(events).toEqual([{ type: "error", error: "internal" }, { type: "done" }]);
    expect(captured.options).toHaveLength(0);
    expect(logged).toEqual([
      expect.objectContaining({
        event: "agent_tool.authz",
        runId: "run-down",
        principal: "node-ai",
        decision: "unavailable",
        code: "authz_unavailable",
        reason: "principal_lookup_failed",
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("connection refused");
  });
});

describe("DENIAL_IS_TERMINAL (1/2): the model is offered only tools whose principal lock opens", () => {
  it("withholds the write tools brain lists when node-ai holds no role, and keeps the read tools", async () => {
    const a = authority({ principals: { "node-ai": NODE_AI_USER }, roles: [] });
    const run = await start("brain", a, MEMBER);
    const offered = run.options!.request.configurable.toolIds;
    expect(offered).toContain("core__knowledge_search");
    expect(offered).not.toContain("core__knowledge_write");
    expect(offered).not.toContain("core__schedule_manage");
    expect(forTool(a.events, "core__knowledge_write")).toEqual([
      expect.objectContaining({ decision: "deny", code: "policy_denied", reason: "not_offered:no_role" }),
    ]);
  });

  it("offers a write tool once node-ai holds its role", async () => {
    const a = authority({ principals: { "node-ai": NODE_AI_USER }, roles: [[NODE_AI_USER, "schedule:manage"]] });
    const run = await start("brain", a, MEMBER);
    const offered = run.options!.request.configurable.toolIds;
    expect(offered).toContain("core__schedule_manage");
    expect(offered).not.toContain("core__knowledge_write");
  });
});
