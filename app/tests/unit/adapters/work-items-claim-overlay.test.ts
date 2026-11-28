// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Exercise the real released lease composer over the node's injected authorities. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const { content, leases, ContentAdapter, LeaseAdapter } = vi.hoisted(() => {
  const content = { get: vi.fn(), list: vi.fn(), listSummaries: vi.fn(), listBoardColumns: vi.fn() };
  const leases = { getMany: vi.fn(), claim: vi.fn(), heartbeat: vi.fn(), release: vi.fn() };
  return { content, leases,
    ContentAdapter: vi.fn(class { constructor() { Object.assign(this, content); } }),
    LeaseAdapter: vi.fn(class { constructor() { Object.assign(this, leases); } }),
  };
});
vi.mock("@cogni/work-items/adapters/doltgres", async (original) => ({
  ...await original<object>(), DoltgresWorkItemAdapter: ContentAdapter,
}));
vi.mock("@cogni/work-items/adapters/postgres", () => ({ PostgresWorkItemLeaseAdapter: LeaseAdapter }));
import { createLevelUpWorkItemStore } from "@/adapters/server/db/doltgres/shared-work-items-adapter";
const item = (id: string) => ({ id, title: id, type: "task", status: "needs_implement", claimedByRun: "stale-dolt-owner" });
const create = () => createLevelUpWorkItemStore({ pool: "content" } as never, { pool: "service" } as never, undefined);

describe("LevelUp released lease composition", () => {
  beforeEach(() => { vi.clearAllMocks(); leases.getMany.mockResolvedValue(new Map()); });
  it("retains bridge content fencing and injects the service-role lease client", () => {
    create();
    expect(ContentAdapter).toHaveBeenCalledWith({ pool: "content" }, expect.objectContaining({ writerLockProtocol: "bridge", idFloor: 1 }));
    expect(LeaseAdapter).toHaveBeenCalledWith({ pool: "service" }, {});
  });
  it("projects one bounded batch, strips stale Dolt claims and never exposes tokens", async () => {
    content.list.mockResolvedValue({ items: [item("task.1"), item("task.2")], pageInfo: { hasMore: false, endCursor: null } });
    leases.getMany.mockResolvedValue(new Map([["task.1", { active: true, runId: "new-owner", claimedAt: "now", lastCommand: "read", leaseToken: "owner-secret" }]]));
    const page = await create().list({ limit: 2 });
    expect(leases.getMany).toHaveBeenCalledExactlyOnceWith(["task.1", "task.2"]);
    expect(page.items[0]).toMatchObject({ claimedByRun: "new-owner" });
    expect(page.items[1]).not.toHaveProperty("claimedByRun");
    expect(page.items[0]).not.toHaveProperty("leaseToken");
  });
  it("summary and board reads preserve budgets without reading leases", async () => {
    const store = create(); const signal = new AbortController().signal;
    await store.listSummaries({ limit: 25 }, { signal, maxScanRows: 500 });
    await store.listBoardColumns?.({ limit: 20 }, ["needs_design"], 20, { signal });
    expect(content.listSummaries).toHaveBeenCalledWith({ limit: 25 }, { signal, maxScanRows: 500 });
    expect(content.listBoardColumns).toHaveBeenCalledWith({ limit: 20 }, ["needs_design"], 20, { signal });
    expect(leases.getMany).not.toHaveBeenCalled();
  });
  it("heartbeat and release pass owner tokens straight to the sole authority without content reads", async () => {
    const store = create(); const input = { id: "task.1", principalId: "principal", runId: "run", leaseToken: "owner-token" } as never;
    const receipt = { active: false, leaseToken: "owner-token" };
    leases.release.mockResolvedValue(receipt);
    await store.heartbeat(input);
    expect(await store.release(input)).toBe(receipt);
    expect(leases.heartbeat).toHaveBeenCalledWith(input);
    expect(leases.release).toHaveBeenCalledWith(input);
    expect(content.get).not.toHaveBeenCalled();
  });
});

import { workItemsHeartbeatOperation, workItemsReleaseOperation } from "@cogni/node-contracts";
it("refuses tokenless heartbeat/release at the wire boundary", () => {
  const oldRequest = { id: "task.1", runId: "run" };
  expect(workItemsHeartbeatOperation.input.safeParse(oldRequest).success).toBe(false);
  expect(workItemsReleaseOperation.input.safeParse(oldRequest).success).toBe(false);
});
