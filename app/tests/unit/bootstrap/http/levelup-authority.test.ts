// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** A2 regression: real route exports + verifier + wrapper + published host/SQL mechanism.
 * Only persistence/IO is doubled here. Existing real-PG lifecycle tests remain separate and unchanged.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentAuthoritySql,
  createAgentToolAuthority,
} from "@cogni/agent-grants/host";
import { runSameDoorParity } from "@cogni/agent-grants/same-door-parity";
import type { Container } from "@/bootstrap/container";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEVELUP_AGENT_ROUTES,
  LEVELUP_PERMISSIONS,
} from "@/bootstrap/agent-permissions";
import { LEVELUP_SHARED_TOOL_BUNDLE } from "@/bootstrap/ai/evaluation-baseline";

const h = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  session: null as Record<string, unknown> | null,
  container: {} as Container,
  origin: "https://levelup.cognidao.org",
  bootFails: false,
  storeFails: false,
  roles: new Set<string>(),
  wallets: new Map<string, string>(),
  names: new Set<string>(),
  principals: new Map<string, string>(),
  writes: vi.fn(),
  createContribution: vi.fn(),
  edoContribution: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  admin: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => h.requestHeaders }));
vi.mock("@/lib/auth/server", () => ({
  getServerSessionUser: async () => h.session,
}));
vi.mock("@/shared/env", () => ({
  serverEnv: () => ({
    APP_BASE_URL: h.origin,
    AUTH_SECRET: "http-test-secret",
  }),
}));
vi.mock("@/shared/env/server", () => ({
  serverEnv: () => ({
    APP_BASE_URL: h.origin,
    AUTH_SECRET: "http-test-secret",
  }),
}));
vi.mock("@/bootstrap/container", () => ({
  getContainer: () => {
    if (h.bootFails) throw new Error("store unavailable");
    return h.container;
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/app/(admin)/AdminShell", () => ({ AdminShell: "admin-shell" }));
vi.mock("@/shared/config/repoSpec.server", () => ({
  getNodeName: () => "LevelUp",
  getNodeHook: () => "Learn",
  getNodeMission: () => "Education",
  getNodeBrandColor: () => "#000000",
  getNodeBrandIcon: () => "circle",
  getNodeThumbnail: () => null,
}));
vi.mock("@/bootstrap/otel", () => ({
  withRootSpan: (_name: string, _attrs: unknown, fn: (context: { traceId: string; span: { setAttribute: ReturnType<typeof vi.fn> } }) => Promise<unknown>) =>
    fn({ traceId: "trace", span: { setAttribute: vi.fn() } }),
}));
vi.mock("@/shared/observability", async (original) => ({
  ...(await original<typeof import("@/shared/observability")>()),
  makeLogger: () => h.log,
  createRequestContext: () => ({ reqId: "req", routeId: "test", log: h.log }),
  logRequestStart: vi.fn(),
  logRequestEnd: vi.fn(),
  logRequestError: vi.fn(),
  httpRequestsTotal: { inc: vi.fn() },
  httpRequestDurationMs: { observe: vi.fn() },
}));
vi.mock("@/app/_facades/work/items.server", () => ({
  createWorkItem: h.writes,
  patchWorkItem: h.writes,
  claimWorkItem: h.writes,
  releaseWorkItem: h.writes,
  heartbeatWorkItem: h.writes,
  getWorkItem: vi.fn(),
  listWorkItems: vi.fn(),
  InvalidCursorError: class extends Error {},
  WorkItemForbiddenError: class extends Error {},
  WorkItemNotFoundError: class extends Error {},
  WorkItemLeaseConflictError: class extends Error {},
  WorkItemsBackendNotReadyError: class extends Error {},
  NodeAdminRequiredError: class extends Error {},
}));

import { issueAgentApiKey } from "@/app/_lib/auth/request-identity";
import { getSessionUser } from "@/app/_lib/auth/session";
import * as admin from "@/app/api/v1/admin/ai-access/route";
import * as asks from "@/app/api/v1/agent/access-requests/route";
import * as me from "@/app/api/v1/agent/me/route";
import * as registration from "@/app/api/v1/agent/register/route";
import * as edo from "@/app/api/v1/edo/hypothesize/route";
import * as contributions from "@/app/api/v1/knowledge/contributions/route";
import * as knowledge from "@/app/api/v1/knowledge/index/route";
import * as artifacts from "@/app/api/v1/work/items/[id]/artifacts/route";
import * as claims from "@/app/api/v1/work/items/[id]/claims/route";
import * as heartbeat from "@/app/api/v1/work/items/[id]/heartbeat/route";
import * as item from "@/app/api/v1/work/items/[id]/route";
import * as work from "@/app/api/v1/work/items/route";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

const actor = "10000000-0000-4000-a000-000000000001";
const context = { params: Promise.resolve({ id: "task.0001" }) };
const itemDto = {
  id: "task.0001",
  type: "task",
  title: "HTTP test",
  status: "needs_triage",
  revision: 0,
  assignees: [],
  externalRefs: [],
  labels: [],
  specRefs: [],
  deployVerified: false,
  createdAt: "now",
  updatedAt: "now",
};

// This is a unit SQL fixture, not a second adapter or evidence of live migration/SQL conformance.
const sql = Object.assign(
  async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (h.storeFails) throw new Error("fixture store outage");
    const query = parts.join("?");
    if (query.includes("SELECT 1 AS ok FROM agent_roles"))
      return h.roles.has(`${values[0]}:${values[1]}`) ? [{ ok: 1 }] : [];
    if (query.includes("SELECT external_id FROM user_bindings"))
      return h.wallets.has(String(values[0]))
        ? [{ external_id: h.wallets.get(String(values[0])) }]
        : [];
    if (query.includes("SELECT kind FROM agent_principals"))
      return h.principals.has(String(values[0]))
        ? [{ kind: h.principals.get(String(values[0])) }]
        : [];
    if (query.includes("SELECT 1 AS taken"))
      return h.names.has(String(values[0])) ? [{ taken: 1 }] : [];
    if (query.includes("INSERT INTO users")) {
      h.names.add(String(values[1]));
      return [];
    }
    if (query.includes("INSERT INTO agent_principals")) {
      h.principals.set(String(values[0]), "external");
      return [];
    }
    if (query.includes("SELECT scope, approved_by")) return [];
    throw new Error(`Unexpected unit SQL: ${query}`);
  },
  { begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql) },
);

function request(
  method = "POST",
  body: unknown = { type: "task", title: "HTTP test" },
  credential = "bearer",
  origin?: string,
) {
  const headers = new Headers();
  if (credential === "bearer")
    headers.set(
      "authorization",
      `Bearer ${issueAgentApiKey({ userId: actor, displayName: "outside" })}`,
    );
  else if (credential === "invalid")
    headers.set("authorization", "Bearer invalid");
  if (origin !== undefined) headers.set("origin", origin);
  headers.set("host", "levelup.cognidao.org");
  headers.set("content-type", "application/json");
  h.requestHeaders = headers;
  return new NextRequest(
    `${h.origin || "https://levelup.cognidao.org"}/api/v1/test`,
    {
      method,
      headers,
      ...(!["GET", "HEAD"].includes(method)
        ? { body: JSON.stringify(body) }
        : {}),
    },
  );
}
const role = (scope: string) => h.roles.add(`${actor}:${scope}`);
const user = {
  id: actor,
  via: "session",
  walletAddress: null,
  displayName: "human",
  avatarColor: null,
};
const noStore = (r: Response, status: number) => {
  expect(r.status).toBe(status);
  expect(r.headers.get("cache-control")).toBe("no-store");
};

beforeEach(() => {
  vi.clearAllMocks();
  h.roles.clear();
  h.wallets.clear();
  h.names.clear();
  h.principals.clear();
  h.session = null;
  h.origin = "https://levelup.cognidao.org";
  h.bootFails = false;
  h.storeFails = false;
  h.admin.mockImplementation(async ({ walletAddress }) =>
    walletAddress === "dao-wallet"
      ? { ok: true }
      : { ok: false, errorCode: "authz_denied" },
  );
  const authority = createAgentToolAuthority({
    sql: sql as unknown as AgentAuthoritySql,
    log: h.log,
    nodeAdmin: { check: h.admin },
    tools: LEVELUP_SHARED_TOOL_BUNDLE.map(({ contract }) => ({
      id: contract.name,
      requires: contract.requires,
    })),
    graphs: [],
    systemUserIds: [],
  });
  h.container = {
    agentAuthority: authority,
    config: { unhandledErrorPolicy: "rethrow" },
    log: h.log,
    clock: { now: () => new Date() },
    serviceAccountService: {
      getOrCreateBillingAccountForUser: vi.fn(async () => ({
        id: "billing-1",
      })),
    },
    knowledgeStorePort: { listDomains: vi.fn(async () => []) },
    knowledgeContributionService: {
      create: h.createContribution,
      createEdoHypothesisContribution: h.edoContribution,
    },
  } as unknown as Container;
  h.writes.mockResolvedValue(itemDto);
  h.createContribution.mockResolvedValue({
    contributionId: "contrib-http",
    branch: "contrib/http",
    state: "open",
  });
  h.edoContribution.mockResolvedValue({
    contributionId: "contrib-edo",
    branch: "contrib/edo",
    state: "open",
    baseCommit: "base",
    headCommit: null,
  });
});

runSameDoorParity({
  describe,
  it,
  expect,
  contracts: LEVELUP_SHARED_TOOL_BUNDLE.map(({ contract }) => contract),
  routes: LEVELUP_AGENT_ROUTES,
  options: {
    absentBaseline: [
      "core__account_credits_read",
      "core__sandbox_shell",
      "core__vcs_create_branch",
      "core__vcs_merge_pr",
      "core__vcs_flight_candidate",
    ],
  },
});

describe("LevelUp actual HTTP doors", () => {
  it("refuses no-role and revoked bearer before the actual writer, allows approved caller with its own attribution", async () => {
    noStore(await work.POST(request()), 403);
    expect(h.writes).not.toHaveBeenCalled();
    role("work_item:transition");
    expect((await work.POST(request())).status).toBe(201);
    expect(h.writes).toHaveBeenCalledWith(
      expect.anything(),
      { id: actor, walletAddress: null },
      expect.objectContaining({ actor: actor }),
    );
    h.writes.mockClear();
    h.roles.clear();
    noStore(await work.POST(request()), 403);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it.each([
    ["patch", item.PATCH, "PATCH", 400],
    ["claim", claims.POST, "POST", 400],
    ["release", claims.DELETE, "DELETE", 400],
    ["heartbeat", heartbeat.POST, "POST", 400],
    ["artifact", artifacts.POST, "POST", 503],
  ] as const)("gates actual %s export before body or facade", async (_name, handler, method, expectedStatus) => {
    noStore(await handler(request(method), context), 403);
    expect(h.writes).not.toHaveBeenCalled();
    role("work_item:transition");
    const response = await handler(request(method, {}), context);
    expect(response.status).toBe(expectedStatus); // Exact product refusal, after the door.
    expect(h.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "agent_tool.authz",
        decision: "allow",
        principal: actor,
      }),
      "agent_tool.authz",
    );
  });

  it("permitted PATCH and lease HTTP calls preserve the authenticated principal and fencing token", async () => {
    role("work_item:transition");
    expect(
      (
        await item.PATCH(
          request("PATCH", {
            set: { title: "updated" },
            reason: "HTTP authority regression",
            expectedRevision: 0,
          }),
          context,
        )
      ).status,
    ).toBe(200);
    const leaseToken = "10000000-0000-4000-a000-000000000002";
    h.writes.mockResolvedValue({
      id: "task.0001",
      runId: "run-http",
      leaseToken,
      claimedAt: "now",
      expiresAt: "later",
      lastCommand: "test",
      active: true,
    });
    expect(
      (
        await claims.POST(
          request("POST", { runId: "run-http", command: "test" }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(h.writes).toHaveBeenLastCalledWith({
      id: "task.0001",
      runId: "run-http",
      command: "test",
      principalId: actor,
    });
    expect(
      (
        await heartbeat.POST(
          request("POST", { runId: "run-http", leaseToken }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(h.writes).toHaveBeenLastCalledWith({
      id: "task.0001",
      runId: "run-http",
      leaseToken,
      principalId: actor,
    });
    const req = request("DELETE");
    const release = new NextRequest(
      `${req.url}?runId=run-http&leaseToken=${leaseToken}`,
      { method: "DELETE", headers: req.headers },
    );
    expect((await claims.DELETE(release, context)).status).toBe(200);
    expect(h.writes).toHaveBeenLastCalledWith({
      id: "task.0001",
      runId: "run-http",
      leaseToken,
      principalId: actor,
    });
  });

  it("does not turn an invalid bearer plus valid cookie into a session writer", async () => {
    h.session = user;
    role("work_item:transition");
    expect(
      (await work.POST(request("POST", {}, "invalid", h.origin))).status,
    ).toBe(401);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("keeps session member writes and requires exact configured Origin, even with matching attacker Host", async () => {
    h.session = user;
    for (const origin of [
      undefined,
      "null",
      "http://levelup.cognidao.org",
      "https://evil.example",
    ]) {
      const req = request("POST", undefined, "session", origin);
      if (origin === "https://evil.example") {
        req.headers.set("host", "evil.example");
        h.requestHeaders = req.headers;
      }
      noStore(await work.POST(req), 403);
    }
    expect(
      (await work.POST(request("POST", undefined, "session", h.origin))).status,
    ).toBe(201);
    expect(h.writes).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503/no-store on missing configuration, authority throw, SQL outage or boot failure", async () => {
    role("work_item:transition");
    h.storeFails = true;
    noStore(await work.POST(request()), 503);
    h.storeFails = false;
    vi.spyOn(h.container.agentAuthority, "authorizeRoute").mockRejectedValue(
      new Error("outage"),
    );
    noStore(await work.POST(request()), 503);
    h.bootFails = true;
    noStore(await work.POST(request()), 503);
    h.bootFails = false;
    h.session = user;
    h.origin = "";
    noStore(
      await work.POST(
        request("POST", undefined, "session", "https://levelup.cognidao.org"),
      ),
      503,
    );
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("gates real knowledge read and contribution calls without rewriting their principal", async () => {
    noStore(await knowledge.GET(request("GET")), 403);
    role("knowledge:read");
    expect((await knowledge.GET(request("GET"))).status).toBe(200);
    const body = { message: "Propose HTTP fixture" };
    noStore(await contributions.POST(request("POST", body)), 403);
    expect(h.createContribution).not.toHaveBeenCalled();
    role("knowledge:contribute");
    expect((await contributions.POST(request("POST", body))).status).toBe(201);
    expect(h.createContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ id: actor, kind: "agent" }),
      }),
    );
    h.roles.clear();
    noStore(await knowledge.GET(request("GET")), 403);
  });

  it("gates actual EDO HTTP writes and preserves the outside-agent contribution path", async () => {
    const body = {
      id: "http-hypothesis",
      domain: "meta",
      title: "HTTP hypothesis",
      content: "A falsifiable claim",
      evaluateAt: "2026-12-10T00:00:00Z",
    };
    noStore(await edo.POST(request("POST", body)), 403);
    expect(h.edoContribution).not.toHaveBeenCalled();
    role("edo:write");
    expect((await edo.POST(request("POST", body))).status).toBe(201);
    expect(h.edoContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ id: actor, kind: "agent" }),
      }),
    );
    h.roles.clear();
    noStore(await edo.POST(request("POST", body)), 403);
  });

  it("uses the same composed door on every offered schedule and metric twin; undeclared writes are denied", async () => {
    for (const [tool, declaration] of Object.entries(
      LEVELUP_AGENT_ROUTES.sameDoorRoutes,
    )) {
      if (
        !LEVELUP_SHARED_TOOL_BUNDLE.some(
          ({ contract }) => contract.name === tool,
        )
      )
        continue;
      for (const routeId of declaration.routes) {
        const effect = vi.fn(async () => NextResponse.json({ user: actor }));
        const handler = wrapRouteHandlerWithLogging(
          { routeId, auth: { mode: "required", getSessionUser } },
          effect,
        );
        h.roles.clear();
        noStore(await handler(request()), 403);
        expect(effect).not.toHaveBeenCalled();
        role(declaration.scope);
        expect((await handler(request())).status).toBe(200);
        expect(effect).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ id: actor, via: "bearer" }),
          undefined,
        );
      }
    }
    const effect = vi.fn();
    const undeclared = wrapRouteHandlerWithLogging(
      {
        routeId: "knowledge.undeclared",
        auth: { mode: "required", getSessionUser },
      },
      effect,
    );
    noStore(await undeclared(request()), 403);
    expect(effect).not.toHaveBeenCalled();
  });

  it("mounts the ask/list/me published cores with verified kind; 0.11.0 session refusal remains a release dependency", async () => {
    const authority = h.container.agentAuthority;
    const ask = vi
      .spyOn(authority, "requestAccess")
      .mockResolvedValue({
        state: "pending",
        created: true,
        approvalPath: "/admin/ai-access#agent-request=fixture",
      });
    const res = await asks.POST(
      request("POST", {
        scope: "work_item:transition",
        principalUserId: "forged",
      }),
    );
    noStore(res, 201);
    expect(ask).toHaveBeenCalledWith({
      principalUserId: actor,
      scope: "work_item:transition",
    });
    expect((await res.json()).approvalUrl).toMatch(
      /^https:\/\/levelup.cognidao.org\/admin\/ai-access/,
    );
    noStore(await asks.GET(request("GET")), 200);
    noStore(await me.GET(request("GET")), 200);
    h.session = user;
    noStore(await asks.GET(request("GET", undefined, "session")), 404);
    noStore(
      await asks.POST(
        request("POST", { scope: "work_item:transition" }, "session", h.origin),
      ),
      404,
    );
    h.session = null;
    ask.mockRejectedValue(new Error("offline"));
    noStore(
      await asks.POST(request("POST", { scope: "work_item:transition" })),
      503,
    );
    h.storeFails = true;
    noStore(await asks.GET(request("GET")), 503);
    noStore(await me.GET(request("GET")), 503);
  });

  it("registers the external principal through the published transaction, with no roles", async () => {
    noStore(
      await registration.POST(
        request("POST", { name: "outside-fixture" }, "anonymous"),
      ),
      201,
    );
    expect([...h.principals.values()]).toEqual(["external"]);
    expect(h.roles.size).toBe(0);
    noStore(
      await registration.POST(
        request("POST", { name: "outside-fixture" }, "anonymous"),
      ),
      409,
    );
    h.storeFails = true;
    noStore(
      await registration.POST(
        request("POST", { name: "another-fixture" }, "anonymous"),
      ),
      503,
    );
  });

  it("admin API uses the canonical user-ID bound-wallet gate for either credential, including wallet-null sessions", async () => {
    const authority = h.container.agentAuthority;
    vi.spyOn(authority, "listNodeAi").mockResolvedValue({
      permissions: [],
      more: 0,
    });
    const grant = vi
      .spyOn(authority, "grantRole")
      .mockResolvedValue({ principalUserId: "other", created: true });
    const body = { principal: "prioritizer", scope: "work_item:transition" };
    noStore(await admin.POST(request("POST", body)), 403);
    h.wallets.set(actor, "dao-wallet");
    noStore(await admin.POST(request("POST", body)), 200);
    h.session = user;
    noStore(await admin.POST(request("POST", body, "session", h.origin)), 200);
    expect(h.admin).toHaveBeenCalledWith({
      userId: actor,
      walletAddress: "dao-wallet",
    });
    expect(grant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        me: { userId: actor, admin: { userId: actor } },
      }),
    );
    h.storeFails = true;
    noStore(await admin.GET(request("GET")), 503);
  });

  it("admin page and API admit the same wallet-null canonical user and fail closed without its DAO binding", async () => {
    const { default: layout } = await import("@/app/(admin)/layout");
    h.session = user;
    await expect(layout({ children: null })).rejects.toThrow(
      "redirect:/dashboard",
    );
    h.wallets.set(actor, "dao-wallet");
    expect(await layout({ children: null })).toBeTruthy();
    expect(h.admin).toHaveBeenLastCalledWith({
      userId: actor,
      walletAddress: "dao-wallet",
    });
    h.storeFails = true;
    await expect(layout({ children: null })).rejects.toThrow();
  });

  it("live discovery exposes the actual published request/list/me contracts and composed permission catalog", async () => {
    const { GET } = await import("@/app/.well-known/agent.json/route");
    const body = await (
      await GET(new Request(`${h.origin}/.well-known/agent.json`))
    ).json();
    expect(body.endpoints.accessRequests).toBe(
      `${h.origin}/api/v1/agent/access-requests`,
    );
    expect(body.endpoints.agentMe).toBe(`${h.origin}/api/v1/agent/me`);
    expect(body.actions.requestAccess.inputSchema.required).toEqual(["scope"]);
    expect(body.actions.listAccessRequests.outputSchema.required).toEqual([
      "requests",
    ]);
    expect(body.actions.agentMe.outputSchema.required).toContain("via");
    expect(body.permissions).toEqual(h.container.agentAuthority.permissions);
  });

  it("all offered declaration twins refer to real wrapper route IDs, and admin page shares the API authority", () => {
    const root = resolve("src/app/api/v1");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(resolve(dir, d.name)) : [resolve(dir, d.name)],
      );
    const source = files(root)
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const [toolId, declaration] of Object.entries(
      LEVELUP_AGENT_ROUTES.sameDoorRoutes,
    )) {
      if (
        !LEVELUP_SHARED_TOOL_BUNDLE.some(
          ({ contract }) => contract.name === toolId,
        )
      )
        continue;
      for (const id of declaration.routes) expect(source).toContain(`"${id}"`);
    }
    expect(
      readFileSync(resolve("src/app/(admin)/layout.tsx"), "utf8"),
    ).toContain("agentAuthority.adminCheck(user.id)");
    expect(
      LEVELUP_PERMISSIONS.permissions.some(
        (p) => p.scope === "work_item:transition",
      ),
    ).toBe(true);
  });
});
