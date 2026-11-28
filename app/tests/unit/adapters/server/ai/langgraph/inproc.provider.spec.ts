// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/langgraph/inproc.provider`
 * Purpose: Wiring tests for LangGraphInProcProvider - adapter integration and error handling.
 * Scope: Verifies adapter.executeCompletionUnit is called correctly and events reflect adapter stream. Does NOT test actual graph execution or LLM calls.
 * Invariants:
 *   - Valid graphId: events reflect adapter stream
 *   - Invalid graphId: emits client error (not_found), done is last
 * Side-effects: none (all mocked)
 * Links: inproc.provider.ts, https://node-template.cognidao.org/knowledge/graph-execution-invariants
 * @internal
 */

import type { AiEvent, ToolSourcePort } from "@cogni/ai-core";
import {
  CORE_TOOL_BUNDLE,
  TOOL_CATALOG,
  toBoundToolRuntime,
} from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG as PRODUCT_CATALOG } from "@cogni/langgraph-graphs";
import {
  LANGGRAPH_CATALOG,
  LEVELUP_TOOL_IDS,
} from "@cogni/node-template-graphs";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runInScope } from "@/adapters/server/ai/execution-scope";
import type { CompletionUnitAdapter } from "@/adapters/server/ai/langgraph/inproc.provider";
import { LangGraphInProcProvider } from "@/adapters/server/ai/langgraph/inproc.provider";
import { LangGraphInProcAgentCatalogProvider } from "@/adapters/server/ai/langgraph/inproc-agent-catalog.provider";
import { LEVELUP_CORE_TOOL_BUNDLE } from "@/bootstrap/ai/evaluation-baseline";
import { routeLangGraphProvider } from "@/bootstrap/langgraph-routing";
import type { GraphRunRequest, LlmService } from "@/ports";

vi.mock("@/shared/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/observability")>()),
  makeLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const TEST_SCOPE = {
  llmService: {} as LlmService,
  billing: {
    billingAccountId: "test-billing",
    virtualKeyId: "test-vkey",
  },
  usageSource: "litellm" as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all events from stream into array.
 */
async function collectEvents(
  stream: AsyncIterable<AiEvent>,
): Promise<AiEvent[]> {
  return runInScope(TEST_SCOPE, async () => {
    const events: AiEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  });
}

/**
 * Create a mock CompletionUnitAdapter with controlled event stream.
 */
function createMockAdapter(options?: {
  events?: AiEvent[];
  finalResult?: {
    ok: boolean;
    requestId?: string;
    usage?: { promptTokens: number; completionTokens: number };
    finishReason?: string;
    error?: string;
  };
}): CompletionUnitAdapter {
  const events = options?.events ?? [
    { type: "text_delta" as const, delta: "Test" },
  ];

  const finalResult = options?.finalResult ?? {
    ok: true,
    requestId: "test-req",
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: "stop",
  };

  return {
    executeCompletionUnit: vi.fn().mockReturnValue({
      stream: (async function* () {
        for (const event of events) {
          yield event;
        }
      })(),
      final: Promise.resolve(finalResult),
    }),
  };
}

/**
 * Create a mock ToolSourcePort that wraps TOOL_CATALOG with stub implementations.
 *
 * NOTE: This uses TOOL_CATALOG stubs intentionally for unit test isolation.
 * The stack test (tests/stack/ai/metrics-tool.stack.test.ts) validates real
 * capability bindings via container.toolSource with injected MetricsCapability.
 */
function createMockToolSource(): ToolSourcePort {
  // Build runtime map from catalog
  const runtimeMap = new Map(
    Object.entries(TOOL_CATALOG).map(([id, tool]) => [
      id,
      toBoundToolRuntime(tool),
    ]),
  );

  return {
    getBoundTool: (toolId: string) => runtimeMap.get(toolId),
    listToolSpecs: () => Array.from(runtimeMap.values()).map((t) => t.spec),
    hasToolId: (toolId: string) => runtimeMap.has(toolId),
  };
}

/**
 * Create a minimal GraphRunRequest for testing.
 */
function createTestRequest(
  overrides?: Partial<GraphRunRequest>,
): GraphRunRequest {
  return {
    runId: "test-run-id",
    messages: [{ role: "user", content: "Hello" }],
    modelRef: { providerKey: "platform", modelId: "test-model" },
    graphId: "langgraph:poet",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiring Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("LangGraphInProcProvider", () => {
  describe("valid graphId", () => {
    it("calls adapter.executeCompletionUnit and emits events reflecting adapter stream", async () => {
      await runInScope(TEST_SCOPE, async () => {
        const adapterEvents: AiEvent[] = [
          { type: "text_delta", delta: "Hello " },
          { type: "text_delta", delta: "World" },
        ];
        const mockAdapter = createMockAdapter({ events: adapterEvents });
        const mockToolSource = createMockToolSource();
        const provider = new LangGraphInProcProvider(
          mockAdapter,
          mockToolSource,
        );

        const request = createTestRequest({ graphId: "langgraph:poet" });
        const { stream, final } = provider.runGraph(request);

        const events = await collectEvents(stream);
        const result = await final;

        // Adapter should be called
        expect(mockAdapter.executeCompletionUnit).toHaveBeenCalled();

        // Events should flow from adapter through runner
        // Note: runner adds assistant_final and done
        const textDeltas = events.filter((e) => e.type === "text_delta");
        expect(textDeltas.length).toBeGreaterThan(0);

        // Terminal events present
        const assistantFinals = events.filter(
          (e) => e.type === "assistant_final",
        );
        const dones = events.filter((e) => e.type === "done");
        expect(assistantFinals).toHaveLength(1);
        expect(dones).toHaveLength(1);

        // done is last
        expect(events[events.length - 1]).toEqual({ type: "done" });

        // Result reflects success
        expect(result.ok).toBe(true);
      });
    });
  });

  describe("invalid graphId", () => {
    it("emits not_found error then done for unknown graph (REQ1)", async () => {
      await runInScope(TEST_SCOPE, async () => {
        const mockAdapter = createMockAdapter();
        const mockToolSource = createMockToolSource();
        const provider = new LangGraphInProcProvider(
          mockAdapter,
          mockToolSource,
        );

        // Request with graph not in catalog
        const request = createTestRequest({
          graphId: "langgraph:nonexistent_graph",
        });
        const { stream, final } = provider.runGraph(request);

        const events = await collectEvents(stream);
        const result = await final;

        // Should NOT call adapter
        expect(mockAdapter.executeCompletionUnit).not.toHaveBeenCalled();

        // Should emit error (client error, not 'internal')
        const errors = events.filter((e) => e.type === "error");
        expect(errors).toHaveLength(1);
        // Per REQ1: assert client error code, not 'internal'
        expect(errors[0]).toEqual({ type: "error", error: "not_found" });

        // done must be last
        const dones = events.filter((e) => e.type === "done");
        expect(dones).toHaveLength(1);
        expect(events[events.length - 1]).toEqual({ type: "done" });

        // Result reflects failure
        expect(result.ok).toBe(false);
        expect(result.error).toBe("not_found");
      });
    });

    it("emits invalid_request error for malformed graphId", async () => {
      await runInScope(TEST_SCOPE, async () => {
        const mockAdapter = createMockAdapter();
        const mockToolSource = createMockToolSource();
        const provider = new LangGraphInProcProvider(
          mockAdapter,
          mockToolSource,
        );

        // Request with wrong provider prefix
        const request = createTestRequest({
          graphId: "wrong_provider:poet",
        });
        const { stream, final } = provider.runGraph(request);

        const events = await collectEvents(stream);
        const result = await final;

        // Should NOT call adapter
        expect(mockAdapter.executeCompletionUnit).not.toHaveBeenCalled();

        // Should emit error
        const errors = events.filter((e) => e.type === "error");
        expect(errors).toHaveLength(1);
        // Per REQ1: client error for malformed input
        expect(errors[0]).toEqual({ type: "error", error: "invalid_request" });

        // done must be last
        expect(events[events.length - 1]).toEqual({ type: "done" });

        // Result reflects failure
        expect(result.ok).toBe(false);
      });
    });
  });
});

describe("LevelUp catalog and routing", () => {
  it("preserves every product graph and the exact tool allowlist, with one discovery catalog", () => {
    for (const [id, product] of Object.entries(PRODUCT_CATALOG)) {
      expect(LANGGRAPH_CATALOG[id]?.graphFactory).toBe(product.graphFactory);
      expect(LANGGRAPH_CATALOG[id]?.toolIds).toEqual(product.toolIds);
    }
    expect(LEVELUP_CORE_TOOL_BUNDLE.map((t) => t.contract.name).sort()).toEqual(
      CORE_TOOL_BUNDLE.filter((t) =>
        new Set<string>(LEVELUP_TOOL_IDS).has(t.contract.name),
      )
        .map((t) => t.contract.name)
        .sort(),
    );
    expect(LANGGRAPH_CATALOG["work-prioritizer"]).toMatchObject({
      principal: "prioritizer",
      program: "work-review",
    });
    expect(LANGGRAPH_CATALOG["work-closeout"]).toBeUndefined();
    expect(
      LANGGRAPH_CATALOG.cogni?.toolIds.every((id) =>
        new Set<string>(LEVELUP_TOOL_IDS).has(id),
      ),
    ).toBe(true);
    const discovered = new LangGraphInProcAgentCatalogProvider(
      LANGGRAPH_CATALOG,
    )
      .listAgents()
      .map((a) => a.graphId)
      .sort();
    expect(discovered).toEqual(
      Object.keys(LANGGRAPH_CATALOG)
        .map((id) => `langgraph:${id}`)
        .sort(),
    );
    for (const graphId of Object.keys(LANGGRAPH_CATALOG))
      expect(LANGGRAPH_CATALOG.cogni?.systemPrompt).toContain(graphId);
  });

  it("keeps programs and product writers in process even with dev configured", () => {
    const result = {
      stream: (async function* () {})(),
      final: Promise.resolve({ ok: true, runId: "r", requestId: "r" }),
    };
    const inproc = { runGraph: vi.fn(() => result) };
    const dev = { runGraph: vi.fn(() => result) };
    const router = routeLangGraphProvider(inproc, dev);
    for (const id of [
      "cogni",
      "work-prioritizer",
      "brain",
      "autoresearch-single-lane",
    ])
      router.runGraph(createTestRequest({ graphId: `langgraph:${id}` }));
    expect(inproc.runGraph).toHaveBeenCalledTimes(4);
    expect(dev.runGraph).not.toHaveBeenCalled();
    router.runGraph(createTestRequest({ graphId: "langgraph:poet" }));
    expect(dev.runGraph).toHaveBeenCalledTimes(1);
  });
});

it("runs the retained product graph with native model-facing schemas through the published provider", async () => {
  const adapter = createMockAdapter();
  const provider = new LangGraphInProcProvider(
    adapter,
    createMockToolSource(),
    undefined,
    LEVELUP_CORE_TOOL_BUNDLE,
    LANGGRAPH_CATALOG,
    {
      authority: {
        resolvePrincipal: async () => "fixture-principal",
        guardDeps: {
          withStore: async (fn) =>
            fn({
              liveScopes: async () => [],
            } as unknown as import("@cogni/agent-grants").AgentGrantsStore),
          adminCheck: async () => "denied",
        },
      },
    },
  );
  await runInScope(
    { ...TEST_SCOPE, subjectUserId: "fixture-subject" },
    async () => {
      const run = provider.runGraph(
        createTestRequest({ graphId: "langgraph:brain" }),
      );
      for await (const _event of run.stream) {
        /* consume the billed execution */
      }
      expect((await run.final).ok).toBe(true);
    },
  );
  const parameters = vi.mocked(adapter.executeCompletionUnit).mock
    .calls[0]?.[0];
  const knowledgeRead = parameters?.tools?.find(
    (tool) => tool.function.name === "core__knowledge_read",
  );
  expect(knowledgeRead?.function.parameters).toMatchObject({
    type: "object",
    properties: { id: { type: "string" } },
  });
  expect(
    parameters?.tools?.some(
      (tool) => tool.function.name === "core__knowledge_write",
    ),
  ).toBe(false);
});

// The shared HTTP core is real; these fakes stand only at the node's authentication and authority ports.
describe("node-only Admin approval door", () => {
  const authority = {
    adminCheck: vi.fn(),
    listNodeAi: vi.fn(async () => ({ permissions: [], more: 0 })),
    grantRole: vi.fn(async (_input: unknown) => ({
      principalUserId: "fixture-principal",
      created: true,
    })),
    revokeRole: vi.fn(async () => ({
      principalUserId: "fixture-principal",
      revoked: true,
    })),
    denyRequest: vi.fn(),
    previewAsk: vi.fn(),
  };
  let routes: typeof import("@/app/api/v1/admin/ai-access/route");
  const caller = { id: "fixture-admin", via: "session" as "session" | "bearer" };

  beforeAll(async () => {
    vi.doMock("@/bootstrap/container", () => ({
      getContainer: () => ({
        agentAuthority: authority,
        config: { unhandledErrorPolicy: "rethrow" },
        clock: { now: () => new Date("2026-11-28T00:00:00Z") },
        log: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
      }),
    }));
    vi.doMock("@/app/_lib/auth/session", () => ({ getSessionUser: async () => caller }));
    vi.doMock("@/shared/env", () => ({
      serverEnv: () => ({ APP_BASE_URL: "https://levelup.example" }),
    }));
    routes = await import("@/app/api/v1/admin/ai-access/route");
  });

  function request(
    via: "session" | "bearer",
    origin = "https://levelup.example",
  ) {
    caller.via = via;
    return new NextRequest("https://levelup.example/api/v1/admin/ai-access", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(via === "bearer" ? { authorization: "Bearer fixture" } : {}),
      },
      body: JSON.stringify({
        principalUserId: "fixture-principal",
        scope: "work_item:transition",
      }),
    });
  }

  it("refuses non-admins with either credential before any grant call", async () => {
    authority.adminCheck.mockResolvedValue("denied");
    authority.grantRole.mockClear();
    for (const via of ["session", "bearer"] as const)
      expect((await routes.POST(request(via))).status).toBe(403);
    expect(authority.grantRole).not.toHaveBeenCalled();
  });

  it("uses the same checked approver for both credentials and refuses cross-origin sessions", async () => {
    authority.adminCheck.mockResolvedValue("allow");
    authority.grantRole.mockClear();
    expect(
      (await routes.POST(request("session", "https://elsewhere.example")))
        .status,
    ).toBe(403);
    expect(authority.grantRole).not.toHaveBeenCalled();
    for (const via of ["session", "bearer"] as const) {
      const response = await routes.POST(request(via));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(authority.grantRole).toHaveBeenCalledTimes(2);
    expect(authority.grantRole.mock.calls[0]?.[0]).toMatchObject({
      me: { userId: caller.id },
      principalUserId: "fixture-principal",
      scope: "work_item:transition",
    });
  });

  it("reports unavailable authority as 503 without attempting an approval", async () => {
    authority.adminCheck.mockResolvedValue("unavailable");
    authority.grantRole.mockClear();
    expect((await routes.POST(request("session"))).status).toBe(503);
    expect(authority.grantRole).not.toHaveBeenCalled();
  });
});

it("pins node event names to the actual published provider and host", async () => {
  const { INPROC_EVENTS } = await import(
    "@cogni/shared-langgraph-graphs/inproc"
  );
  const { AGENT_HOST_EVENTS } = await import("@cogni/agent-grants/host");
  const { EVENT_NAMES } = await import("@/shared/observability");
  for (const [key, value] of Object.entries(INPROC_EVENTS))
    expect(EVENT_NAMES[key as keyof typeof EVENT_NAMES]).toBe(value);
  for (const value of Object.values(AGENT_HOST_EVENTS))
    expect(Object.values(EVENT_NAMES)).toContain(value);
});
