// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/knowledge.read-principal`
 * Purpose: Lock in KNOWLEDGE_READ_REQUIRES_PRINCIPAL — bearer-token agents may
 *   read the knowledge plane (list, single entry, citation graph, domain
 *   registry) just like cookie-session humans. Regression guard for the v0
 *   guard that 403'd every bearer browse request.
 * Scope: Exercises the four GET read routes with an `Authorization: Bearer`
 *   header against a seeded fake store. Does not test write/contribution paths.
 * Invariants: a bearer-bearing read returns 200 (never 403); link-pulling
 *   (graph edges) is reachable by agents.
 * Side-effects: none (container + auth mocked, fake in-memory store)
 * Links: src/app/api/v1/knowledge, docs/spec/knowledge-syntropy.md
 * @internal
 */

import { KnowledgeRowSchema } from "@cogni/node-contracts";
import { KnowledgeRowSchema as CanonicalKnowledgeRowSchema } from "@cogni/knowledge-store/contracts";
import { FakeKnowledgeStoreAdapter } from "@cogni/knowledge-store/adapters/fake";
import { TEST_SESSION_USER_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fresh fake store per test (reassigned in beforeEach); the container mock
// hands the current instance to every route. Lazy factory => reads latest value.
let mockStore: FakeKnowledgeStoreAdapter;
// The real route door over a fake SQL tag: answers the role lookup from `roles` ("<principal>|<scope>").
const grants = vi.hoisted(() => ({
  roles: new Set<string>(),
  authority: undefined as unknown,
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    log: {
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    clock: { now: vi.fn(() => new Date("2026-01-01T00:00:00Z")) },
    config: { unhandledErrorPolicy: "rethrow" },
    knowledgeStorePort: mockStore,
    agentAuthority: grants.authority,
  })),
}));

// A resolved session user models a *successful bearer-token auth*: the real
// resolveRequestIdentity returns a SessionUser for a valid `cogni_ag_sk_v1_`
// token. We send a Bearer header on every request so the old guard — which
// keyed off that header — would have returned 403.
vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn().mockResolvedValue(TEST_SESSION_USER_1),
}));

import { LEVELUP_CORE_TOOL_BUNDLE } from "@/bootstrap/ai/evaluation-baseline";
import {
  type AgentAuthoritySql,
  createAgentToolAuthority,
} from "@/bootstrap/agent-authority";
import * as entryHandler from "@/app/api/v1/knowledge/[id]/route";
import * as domainItemHandler from "@/app/api/v1/knowledge/domains/[domain]/route";
import * as domainsHandler from "@/app/api/v1/knowledge/domains/route";
import * as graphHandler from "@/app/api/v1/knowledge/graph/route";
import * as listHandler from "@/app/api/v1/knowledge/route";

const BEARER = { authorization: "Bearer cogni_ag_sk_v1_test.signature" };

async function seedStore(store: FakeKnowledgeStoreAdapter) {
  await store.registerDomain({ id: "eng", name: "Engineering" });
  await store.withWrite({ operationId: "test.seed", message: "Seed knowledge read fixture" }, async (write) => {
  await write.upsertKnowledge({
    id: "entry-a",
    domain: "eng",
    title: "Entry A",
    content: "alpha",
    sourceType: "agent",
  });
  await write.upsertKnowledge({
    id: "entry-b",
    domain: "eng",
    title: "Entry B",
    content: "beta",
    sourceType: "agent",
  });
  // Citation edge so the graph route proves agent link-pulling, not just nodes.
  await write.addCitation({
    citingId: "entry-a",
    citedId: "entry-b",
    citationType: "extends",
  });
  });
}

function fakeSql(): AgentAuthoritySql {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.join("?").includes("FROM agent_roles") &&
    grants.roles.has(`${values[0]}|${values[1]}`)
      ? [{ ok: 1 }]
      : []) as unknown as AgentAuthoritySql;
  (tag as unknown as { begin: unknown }).begin = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tag);
  return tag;
}

describe("knowledge read routes — KNOWLEDGE_READ_NEEDS_GRANT", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks keeps the default session user (no `via`: the strict bearer branch).
    grants.roles = new Set([`${TEST_SESSION_USER_1.id}|knowledge:read`]);
    const noop = () => undefined;
    const quiet = { info: noop, warn: noop, error: noop, debug: noop };
    grants.authority = createAgentToolAuthority({
      sql: fakeSql(),
      nodeAdmin: {
        check: async () => ({ ok: false, errorCode: "authz_denied" }),
      },
      log: quiet as never,
      toolBundle: LEVELUP_CORE_TOOL_BUNDLE as never,
    });
    mockStore = new FakeKnowledgeStoreAdapter();
    await seedStore(mockStore);
  });

  it("GET /knowledge returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: listHandler,
      url: "/api/v1/knowledge",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.items).toHaveLength(2);
        expect(body.domains).toContain("eng");
      },
    });
  });

  it("GET /knowledge/[id] returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: entryHandler,
      params: { id: "entry-a" },
      url: "/api/v1/knowledge/entry-a",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe("entry-a");
        expect(KnowledgeRowSchema).toBe(CanonicalKnowledgeRowSchema);
        for (const key of Object.keys(CanonicalKnowledgeRowSchema.shape)) expect(body).toHaveProperty(key);
      },
    });
  });

  it.each([
    { id: "entry-a", useWhen: "Use when reviewing this entry." },
    { id: "entry-b", useWhen: null },
  ])("serializes the retrieval trigger for $id at the read boundary", async ({
    id,
    useWhen }) => {
    const entry = await mockStore.getKnowledge(id);
    if (!entry) throw new Error("Seeded entry is missing");
    const getKnowledge = vi.spyOn(mockStore, "getKnowledge");
    // The immutable 0.3.3 fake write path omits useWhen. Supply its typed
    // read result only for projection coverage, not persistence proof.
    if (useWhen !== null) {
      getKnowledge.mockResolvedValueOnce({ ...entry, useWhen });
    }
    try {
      await testApiHandler({
        appHandler: entryHandler,
        params: { id },
        url: `/api/v1/knowledge/${id}`,
        async test({ fetch }) {
          const res = await fetch({ method: "GET", headers: BEARER });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.id).toBe(id);
          expect(body.useWhen).toBe(useWhen);
        },
      });
      expect(getKnowledge).toHaveBeenCalledTimes(1);
      expect(getKnowledge).toHaveBeenCalledWith(id);
    } finally {
      getKnowledge.mockRestore();
    }
  });

  it("GET /knowledge/graph returns 200 + edges for a bearer agent (link-pulling)", async () => {
    await testApiHandler({
      appHandler: graphHandler,
      url: "/api/v1/knowledge/graph",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.nodes).toHaveLength(2);
        expect(body.edges).toEqual([
          expect.objectContaining({
            source: "entry-a",
            target: "entry-b",
            citationType: "extends",
          }),
        ]);
      },
    });
  });

  it("GET /knowledge/domains returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: domainsHandler,
      url: "/api/v1/knowledge/domains",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domains.map((d: { id: string }) => d.id)).toContain("eng");
      },
    });
  });
  it("uses existing bearer auth for domain CRUD and refuses invalid/nonempty/protected deletes", async () => {
    await mockStore.registerDomain({ id: "scratch", name: "Scratch" });
    await testApiHandler({
      appHandler: domainItemHandler,
      params: { domain: "scratch" },
      url: "/api/v1/knowledge/domains/scratch",
      async test({ fetch }) {
        expect((await fetch({ method: "GET", headers: BEARER })).status).toBe(
          200
        );
        const patch = await fetch({
          method: "PATCH",
          headers: { ...BEARER, "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed", description: null }),
        });
        expect(patch.status).toBe(200);
        expect(await patch.json()).toMatchObject({
          id: "scratch",
          name: "Renamed",
          description: null,
        });
        const invalid = await fetch({
          method: "PATCH",
          headers: { ...BEARER, "content-type": "application/json" },
          body: "{}",
        });
        expect(invalid.status).toBe(400);
        expect(
          (await fetch({ method: "DELETE", headers: BEARER })).status
        ).toBe(200);
        expect((await fetch({ method: "GET", headers: BEARER })).status).toBe(
          404
        );
      },
    });
    for (const [domain, errorCode] of [
      ["eng", "domain_not_empty"],
      ["meta", "domain_protected"],
    ]) {
      await testApiHandler({
        appHandler: domainItemHandler,
        params: { domain },
        url: `/api/v1/knowledge/domains/${domain}`,
        async test({ fetch }) {
          const response = await fetch({ method: "DELETE", headers: BEARER });
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({ errorCode });
        },
      });
    }
    expect(await mockStore.getKnowledge("entry-a")).not.toBeNull();
  });

  it("a bearer agent without the knowledge:read role gets 403 policy_denied before any read", async () => {
    grants.roles = new Set();
    await testApiHandler({
      appHandler: listHandler,
      url: "/api/v1/knowledge",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("policy_denied");
      },
    });
  });
});
