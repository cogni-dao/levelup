// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Published host + provider over the node's actual migration, with app/service roles kept separate. */
import { randomUUID } from "node:crypto";
import {
  NODE_AI_PRINCIPAL_USER_ID,
  PRIORITIZER_PRINCIPAL_USER_ID,
} from "@cogni/agent-grants";
import { runAgentWalletGuardConformance } from "@cogni/agent-grants/grants-conformance";
import {
  type AgentAuthoritySql,
  createAgentToolAuthority,
} from "@cogni/agent-grants/host";
import { type AiEvent, createStaticToolSource } from "@cogni/ai-core";
import {
  CORE_TOOL_BUNDLE,
  contractToRuntime,
  createWorkItemUpdateImplementation,
  workItemUpdateContract,
} from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/node-template-graphs";
import {
  type InProcProviderDeps,
  resolveNodeSourceContext,
} from "@cogni/shared-langgraph-graphs/inproc";
import type { WorkItemQueryPort } from "@cogni/work-items";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import { LangGraphInProcProvider } from "@/adapters/server/ai/langgraph/inproc.provider";
import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";
import { runAttribution } from "@/bootstrap/run-attribution";
import type { LlmService } from "@/ports";
import type { WorkItemsDoltgresPort } from "@/ports/server";

const adminId = randomUUID();
const subjectId = randomUUID();
const wallet = `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let sql: Sql;
let appSql: Sql;
let authority: ReturnType<typeof createAgentToolAuthority>;
const tool = CORE_TOOL_BUNDLE.find(
  ({ contract }) => contract.name === workItemUpdateContract.name,
);
if (!tool) throw new Error("Released work-item tool missing");
const tools = [
  {
    id: workItemUpdateContract.name,
    requires: workItemUpdateContract.requires,
  },
];

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_SERVICE_URL)
    throw new Error("Role-separated test database required");
  sql = postgres(process.env.DATABASE_SERVICE_URL, { max: 2 });
  appSql = postgres(process.env.DATABASE_URL, { max: 1 });
  await sql`INSERT INTO users (id, name) VALUES (${adminId}, 'levelup-provider-test-admin'), (${subjectId}, 'levelup-provider-test-subject')`;
  await sql`INSERT INTO user_bindings (id, user_id, provider, external_id) VALUES (${randomUUID()}, ${adminId}, 'wallet', ${wallet})`;
  authority = createAgentToolAuthority({
    sql: sql as unknown as AgentAuthoritySql,
    log,
    tools,
    nodeAdmin: {
      check: async (actor) =>
        actor.walletAddress === wallet
          ? { ok: true }
          : { ok: false, errorCode: "authz_denied" },
    },
    graphs: Object.values(LANGGRAPH_CATALOG),
    systemUserIds: [],
  });
});
afterAll(async () => {
  if (sql) {
    await sql`DELETE FROM agent_roles WHERE principal_user_id IN (${PRIORITIZER_PRINCIPAL_USER_ID}, ${NODE_AI_PRINCIPAL_USER_ID}) OR approved_by = ${adminId}`;
    await sql`DELETE FROM user_bindings WHERE user_id IN (${adminId}, ${subjectId})`;
    await sql`DELETE FROM users WHERE id IN (${adminId}, ${subjectId})`;
    await sql.end({ timeout: 5 });
  }
  if (appSql) await appSql.end({ timeout: 5 });
});

describe("LevelUp node-only authority migration", () => {
  it("uses real app/service roles, seeds identities without roles or credentials", async () => {
    expect(
      (
        await appSql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`
      )[0],
    ).toMatchObject({ rolbypassrls: false, rolsuper: false });
    expect(
      (
        await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`
      )[0]?.rolbypassrls,
    ).toBe(true);
    expect(await authority.resolvePrincipal("prioritizer")).toBe(
      PRIORITIZER_PRINCIPAL_USER_ID,
    );
    expect(await authority.resolvePrincipal("node-ai")).toBe(
      NODE_AI_PRINCIPAL_USER_ID,
    );
    expect(await authority.resolvePrincipal("missing")).toBeNull();
    expect(await sql`SELECT id FROM agent_roles`).toHaveLength(0);
    expect(await sql`SELECT id FROM agent_credentials`).toHaveLength(0);
    expect(await authority.adminCheck(adminId)).toBe("allow");
    expect(await authority.adminCheck(subjectId)).toBe("denied");
  });

  it("forces app-role RLS and refuses non-node grants and org principals", async () => {
    const tables =
      await sql`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('agent_roles', 'agent_principals', 'agent_credentials')`;
    expect(tables).toHaveLength(3);
    for (const table of tables)
      expect(table).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    expect(await appSql`SELECT id FROM agent_roles`).toHaveLength(0);
    await expect(
      appSql`INSERT INTO agent_roles (principal_user_id, scope) VALUES (${PRIORITIZER_PRINCIPAL_USER_ID}, 'work_item:transition')`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`INSERT INTO agent_roles (principal_user_id, scope, resource) VALUES (${PRIORITIZER_PRINCIPAL_USER_ID}, 'account:read', 'account')`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "levelup_agent_roles_node_only",
    });
    await expect(
      sql`INSERT INTO agent_principals (kind, user_id, owner_source_kind, owner_source_ref) VALUES ('org', ${subjectId}, 'repo-spec', 'fixture')`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "levelup_agent_principals_no_org",
    });
    await expect(
      sql`INSERT INTO agent_credentials (user_id, token_hash, created_from, expires_at, renew_until) VALUES (${PRIORITIZER_PRINCIPAL_USER_ID}, 'fixture', 'rotation', now() + interval '1 hour', now() + interval '2 hours')`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "agent_credentials_external_principal_only",
    });
  });

  it("rejects self approval through the published host", async () => {
    await expect(
      authority.grantRole({
        principalUserId: PRIORITIZER_PRINCIPAL_USER_ID,
        scope: "work_item:transition",
        me: { userId: PRIORITIZER_PRINCIPAL_USER_ID, admin: {} },
      }),
    ).rejects.toThrow();
    expect(await sql`SELECT id FROM agent_roles`).toHaveLength(0);
  });
});

runAgentWalletGuardConformance({
  describe,
  it,
  expect,
  sql: (...args) => sql(...args),
  leafTables: ["epoch_distribution_leaves", "distribution_settlement_leaves"],
});

describe("published catalog writer with real SQL authority", () => {
  it("denies, permits an attributed scheduled write after independent approval, then denies after revoke", async () => {
    const patch = vi.fn(async (input) => ({
      id: input.id,
      type: "task",
      title: "Local fixture",
      status: "needs_triage",
      revision: 2,
      node: "levelup",
      actor: "either",
      assignees: [],
      externalRefs: [],
      specRefs: [],
      labels: [],
      deployVerified: false,
      createdAt: "2026-11-28T00:00:00Z",
      updatedAt: "2026-11-28T00:00:00Z",
      ...input.set,
    }));
    const recorded: unknown[] = [];
    const capability = createWorkItemCapability({
      workItemQuery: {} as WorkItemQueryPort,
      backlogWriter: {
        store: {
          patch: async (input, attribution) => {
            recorded.push(attribution);
            return patch(input);
          },
        } as Pick<WorkItemsDoltgresPort, "patch">,
        attribution: runAttribution,
      },
    });
    const runtime = contractToRuntime(
      workItemUpdateContract,
      createWorkItemUpdateImplementation({ workItemCapability: capability }),
    );
    const completion = { executeCompletionUnit: vi.fn() };
    let result: unknown;
    let observedOptions:
      | Parameters<
          NonNullable<
            InProcProviderDeps<
              import("@/ports").LlmToolDefinition
            >["createRunner"]
          >
        >[0]
      | undefined;
    const provider = new LangGraphInProcProvider(
      completion,
      createStaticToolSource([runtime]),
      undefined,
      [tool],
      LANGGRAPH_CATALOG,
      {
        authority,
        sourceContext: (required) =>
          resolveNodeSourceContext(
            required,
            "levelup-test-fixture",
            "https://levelup.example",
            "Learn with sources",
            "test-sha",
            { listGoverningIndex: async () => [] },
          ),
        // Test seam replaces only graph reasoning: filtering, guard, schema compiler, tool implementation,
        // node capability and attribution below it remain the actual published/consuming path.
        createRunner(options) {
          observedOptions = options;
          const final = (async () => {
            result = await options.createToolExecFn(() => {})(
              "core__work_item_update",
              {
                id: "task.0001",
                expectedRevision: 1,
                reason: "The observed fixture warrants scoring",
                set: { scores: { goal: { v: 2 } } },
              },
            );
            return { ok: true, content: "fixture completed" };
          })();
          return {
            stream: (async function* () {
              await final;
              yield { type: "done" as const };
            })(),
            final,
          };
        },
      },
    );
    async function run() {
      return runInScope(
        {
          billing: {
            billingAccountId: "fixture-payer",
            virtualKeyId: "fixture-key",
          },
          llmService: {} as LlmService,
          usageSource: "litellm",
          subjectUserId: subjectId,
          actorUserId: subjectId,
          runId: "fixture-run",
          runKind: "system_scheduled",
        },
        async () => {
          const r = provider.runGraph(
            {
              runId: "fixture-run",
              graphId: "langgraph:work-prioritizer",
              messages: [],
              modelRef: { providerKey: "platform", modelId: "fixture-model" },
            },
            { actorUserId: subjectId },
          );
          const events: AiEvent[] = [];
          for await (const e of r.stream) events.push(e);
          return { final: await r.final, events };
        },
      );
    }
    const denied = await run();
    expect(denied.final.ok).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    expect(observedOptions).toBeUndefined();
    expect(completion.executeCompletionUnit).not.toHaveBeenCalled();
    const me = { userId: adminId, admin: { userId: adminId } };
    await authority.grantRole({
      principalSlug: "prioritizer",
      scope: "work_item:transition",
      me,
    });
    expect(
      await authority.guardDeps.withStore((store) =>
        store.hasLiveRole(
          PRIORITIZER_PRINCIPAL_USER_ID,
          "work_item:transition",
        ),
      ),
    ).toBe(true);
    expect(
      await authority.guardDeps.withStore((store) =>
        store.liveScopes(PRIORITIZER_PRINCIPAL_USER_ID, [
          "work_item:transition",
        ]),
      ),
    ).toEqual(["work_item:transition"]);
    const allowed = await run();
    expect(allowed.final.ok).toBe(true);
    expect(
      result,
      JSON.stringify({
        result,
        allowed,
        decisions: [
          ...log.info.mock.calls,
          ...log.warn.mock.calls,
          ...log.error.mock.calls,
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([
      {
        actor: PRIORITIZER_PRINCIPAL_USER_ID,
        requestedBy: subjectId,
        run: { id: "fixture-run", kind: "system_scheduled" },
      },
    ]);
    expect(observedOptions?.program).toBe("work-review");
    expect(observedOptions?.createGraph).toBe(
      LANGGRAPH_CATALOG["work-prioritizer"]?.graphFactory,
    );
    expect(observedOptions?.interactive).toBe(false);
    expect(getExecutionScope).toThrow();
    await authority.revokeRole({
      principalSlug: "prioritizer",
      scope: "work_item:transition",
      me,
    });
    await run();
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

it.each(["epoch_distribution_leaves", "distribution_settlement_leaves"])(
  "refuses an agent wallet on %s before a payout foreign key can mask the guard",
  async (table) => {
    const agentWallet = "0x1111111111111111111111111111111111111111";
    await sql`INSERT INTO user_bindings (id, user_id, provider, external_id) VALUES (${randomUUID()}, ${NODE_AI_PRINCIPAL_USER_ID}, 'wallet', ${agentWallet})`;
    try {
      const write =
        table === "epoch_distribution_leaves"
          ? () =>
              sql`INSERT INTO epoch_distribution_leaves (node_id, manifest_id, epoch_id, leaf_index, claimant_key, account, account_lower, amount, leaf_hash, proof_json) VALUES (${randomUUID()}, ${randomUUID()}, 1, 0, 'fixture', ${agentWallet}, ${agentWallet}, 1, 'fixture', '[]')`
          : () =>
              sql`INSERT INTO distribution_settlement_leaves (revision_id, leaf_index, claimant_key, account, account_lower, cumulative_amount, delta_amount, receipt_ids_json, leaf_hash, proof_json) VALUES (${randomUUID()}, 0, 'fixture', ${agentWallet}, ${agentWallet}, 1, 1, '[]', 'fixture', '[]')`;
      await expect(write()).rejects.toMatchObject({
        code: "23514",
        constraint_name: "agent_wallet_is_not_a_payee",
      });
    } finally {
      await sql`DELETE FROM user_bindings WHERE user_id = ${NODE_AI_PRINCIPAL_USER_ID} AND external_id = ${agentWallet}`;
    }
  },
);
