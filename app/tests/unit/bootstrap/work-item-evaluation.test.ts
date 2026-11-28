// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
import { describe, expect, it, vi } from "vitest";
import {
  WorkItemDtoSchema,
  toWorkItemDto,
  rankScore, toWorkItemId, type WorkItem, type WorkItemQueryPort,
} from "@cogni/work-items";
import { WorkItemRevisionConflictError } from "@cogni/work-items/adapters/doltgres";
import { WorkItemDtoSchema as HttpWorkItemDtoSchema } from "@cogni/node-contracts";
import { createWorkItemQueryImplementation, createWorkItemUpdateImplementation } from "@cogni/ai-tools";
import { LEVELUP_LOCAL_TOOL_BUNDLE, LEVELUP_SHARED_TOOL_BUNDLE } from "@/bootstrap/ai/evaluation-baseline";
import { createBoundToolSource } from "@/bootstrap/ai/tool-source.factory";
import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";

const scores = { goal: { v: 3 }, time: { v: 2 }, unblocks: { v: 3 }, ease: { v: 3 }, confidence: { v: 3 }, agent: { v: 3 },
};
const item: WorkItem = { id: toWorkItemId("task.9500"), type: "task", title: "Baseline", status: "needs_implement", node: "levelup", actor: "either", assignees: [], externalRefs: [], labels: [], specRefs: [], revision: 3, deployVerified: false, createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z", scores,
};
function fixture() {
  let actor = "actor-a";
  const patch = vi.fn().mockResolvedValue(item);
  const list = vi.fn().mockResolvedValue({ items: [item], nextCursor: "next", pageInfo: { endCursor: "next", hasMore: true },
    });
  const capability = createWorkItemCapability({
    workItemQuery: { list: vi.fn().mockRejectedValue(new Error("Markdown reader must remain unused")), get: vi.fn().mockResolvedValue(item),
    } as unknown as WorkItemQueryPort,
    backlogReader: { list },
    backlogWriter: { store: { patch }, attribution: () => ({ actor }) },
  });
  return { capability, patch, list, setActor: (value: string) => { actor = value; },
  };
}
describe("shared evaluation capability", () => {
  it("forwards scores/CAS and attributes to the authenticated actor for every call", async () => {
    const f = fixture();
    const first = await f.capability.patch({ id: item.id, expectedRevision: 2, reason: "Qualify shared evaluation", set: { scores },
    });
    expect(f.patch).toHaveBeenLastCalledWith({ id: item.id, expectedRevision: 2, reason: "Qualify shared evaluation", set: { scores } }, { actor: "actor-a" });
    expect(first).toMatchObject({ scores, revision: 3, rankScore: rankScore(scores),
    });
    f.setActor("actor-b");
    await f.capability.patch({ id: item.id, expectedRevision: 3, reason: "Qualify shared evaluation", set: { scores: null },
    });
    expect(f.patch).toHaveBeenLastCalledWith({ id: item.id, expectedRevision: 3, reason: "Qualify shared evaluation", set: { scores: null } }, { actor: "actor-b" });
  });
  it("preserves conflicts and paginated score-bearing readback", async () => {
    const f = fixture();
    f.patch.mockRejectedValue(new WorkItemRevisionConflictError(item.id, 2, 3));
    await expect(f.capability.patch({ id: item.id, expectedRevision: 2, reason: "Qualify shared evaluation", set: { scores } })).rejects.toMatchObject({ name: "WorkItemPatchConflictError", expectedRevision: 2, currentRevision: 3,
    });
    expect(await f.capability.queryPage?.({ ids: [item.id], cursor: "prior", limit: 5,
      })).toMatchObject({ items: [{ scores, revision: 3 }], nextCursor: "next" });
    expect(f.list).toHaveBeenCalledWith({ ids: [item.id], cursor: "prior", limit: 5,
    });
  });
  it("carries the canonical envelope through the published tool and retains query filters", async () => {
    const f = fixture();
    const impl = createWorkItemQueryImplementation({
      workItemCapability: f.capability,
      nodePublicOrigin: "https://levelup.cognidao.org",
    });
    const result = await impl.execute({
      ids: [item.id],
      labels: ["education"],
      labelPrefix: "lane:",
      scored: false,
      limit: 5,
    });
    expect(HttpWorkItemDtoSchema.safeParse(toWorkItemDto(item)).success).toBe(true);
    const read = result.items[0];
    for (const key of Object.keys(WorkItemDtoSchema.shape)) {
      if (key in toWorkItemDto(item)) expect(read).toHaveProperty(key);
    }
    expect(read).toMatchObject({
      revision: 3,
      deployVerified: false,
      createdAt: item.createdAt,
      node: "levelup",
    });
    expect(f.list).toHaveBeenCalledWith({
      ids: [item.id],
      labels: ["education"],
      labelPrefix: "lane:",
      scored: false,
      limit: 5,
    });
  });
  it("forwards cancellation CAS/reason/cites and preserves canonical gate refusals", async () => {
    const f = fixture();
    const tool = createWorkItemUpdateImplementation({ workItemCapability: f.capability });
    const input = { id: item.id, expectedRevision: 3, reason: "Cancel superseded work", cites: [{ id: "work-gate-enforcement" }], set: { status: "cancelled" as const } };
    f.patch.mockResolvedValue({ ...item, status: "cancelled", revision: 4 });
    expect(await tool.execute(input)).toMatchObject({ id: item.id, status: "cancelled", revision: 4 });
    expect(f.patch).toHaveBeenCalledWith(input, { actor: "actor-a" });
    for (const [name, code] of [["WorkItemGateUnmetError", "gate_unmet"], ["WorkItemGateFactsUnavailableError", "gate_facts_unavailable"]]) {
      f.patch.mockRejectedValue(Object.assign(new Error("Gate refuses before mutation"), { name, from: "needs_implement", to: "needs_implementation_review", missing: "pr" }));
      expect(await tool.execute({ ...input, set: { status: "needs_implementation_review" } })).toMatchObject({ success: false, code, from: "needs_implement", to: "needs_implementation_review", missing: "pr" });
    }
  });
  it("compiles released schemas without a private tool catalog", () => {
    const tools = [...LEVELUP_LOCAL_TOOL_BUNDLE, ...LEVELUP_SHARED_TOOL_BUNDLE];
    const bindings = Object.fromEntries(tools.map(({ contract }) => [contract.name, { execute: async () => ({}) }]));
    const source = createBoundToolSource(LEVELUP_LOCAL_TOOL_BUNDLE, bindings, LEVELUP_SHARED_TOOL_BUNDLE);
    expect(source.size).toBe(tools.length);
    const work = source.getBoundTool("core__work_item_query");
    expect(work?.spec.inputSchema).toMatchObject({ type: "object", properties: { scored: { type: "boolean" } } });
    for (const { contract } of LEVELUP_LOCAL_TOOL_BUNDLE) expect(source.hasToolId(contract.name)).toBe(true);
  });

});

import { runInScope, type ExecutionScope } from "@/adapters/server/ai/execution-scope";
import { runAttribution } from "@/bootstrap/run-attribution";
describe("catalog attribution boundary", () => {
  it("separates catalog actor, authenticated requester and scheduled run", () => {
    const scope = { billing: {}, llmService: {}, usageSource: "litellm", principalId: "catalog-agent", actorUserId: "requester", subjectUserId: "requester", runId: "run-1", runKind: "system_scheduled" } as unknown as ExecutionScope;
    expect(runInScope(scope, runAttribution)).toEqual({ actor: "catalog-agent", requestedBy: "requester", run: { id: "run-1", kind: "system_scheduled" } });
    const { principalId: _actor, ...unbound } = scope;
    expect(() => runInScope(unbound, runAttribution)).toThrow(/no acting principal/);
  });
});
