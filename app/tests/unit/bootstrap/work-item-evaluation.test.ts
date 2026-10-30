// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
import { describe, expect, it, vi } from "vitest";
import {
  WorkItemDtoSchema,
  toWorkItemDto,
  rankScore, toWorkItemId, type WorkItem, type WorkItemCommandPort, type WorkItemQueryPort,
} from "@cogni/work-items";
import { WorkItemRevisionConflictError } from "@cogni/work-items/adapters/doltgres";
import { WorkItemDtoSchema as HttpWorkItemDtoSchema } from "@cogni/node-contracts";
import { createWorkItemQueryImplementation } from "@cogni/shared-ai-tools";
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
    workItemCommand: {} as WorkItemCommandPort,
    backlogReader: { list },
    backlogWriter: { store: { patch }, principalId: () => actor },
  });
  return { capability, patch, list, setActor: (value: string) => { actor = value; },
  };
}
describe("shared evaluation capability", () => {
  it("forwards scores/CAS and resolves authenticated principal for every call", async () => {
    const f = fixture();
    const first = await f.capability.patch({ id: item.id, expectedRevision: 2, set: { scores },
    });
    expect(f.patch).toHaveBeenLastCalledWith({ id: item.id, expectedRevision: 2, set: { scores } }, "actor-a");
    expect(first).toMatchObject({ scores, revision: 3, rankScore: rankScore(scores),
    });
    f.setActor("actor-b");
    await f.capability.patch({ id: item.id, expectedRevision: 3, set: { scores: null },
    });
    expect(f.patch).toHaveBeenLastCalledWith({ id: item.id, expectedRevision: 3, set: { scores: null } }, "actor-b");
  });
  it("preserves conflicts and paginated score-bearing readback", async () => {
    const f = fixture();
    f.patch.mockRejectedValue(new WorkItemRevisionConflictError(item.id, 2, 3));
    await expect(f.capability.patch({ id: item.id, expectedRevision: 2, set: { scores } })).rejects.toMatchObject({ name: "WorkItemPatchConflictError", expectedRevision: 2, currentRevision: 3,
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
    expect(HttpWorkItemDtoSchema).toBe(WorkItemDtoSchema);
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
  it("compiles published Zod4 and retained local Zod3 tools with their owning runtimes", () => {
    const tools = [...LEVELUP_LOCAL_TOOL_BUNDLE, ...LEVELUP_SHARED_TOOL_BUNDLE];
    const bindings = Object.fromEntries(tools.map(({ contract }) => [contract.name, { execute: async () => ({}) }]));
    const source = createBoundToolSource(LEVELUP_LOCAL_TOOL_BUNDLE, bindings, LEVELUP_SHARED_TOOL_BUNDLE);
    expect(source.size).toBe(tools.length);
    const work = source.getBoundTool("core__work_item_query");
    expect(work?.spec.inputSchema).toMatchObject({ type: "object", properties: { scored: { type: "boolean" } } });
    for (const { contract } of LEVELUP_LOCAL_TOOL_BUNDLE) expect(source.hasToolId(contract.name)).toBe(true);
  });

});
