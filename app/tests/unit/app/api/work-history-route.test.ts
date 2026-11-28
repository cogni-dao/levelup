// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { expect, it, vi } from "vitest";

vi.mock("@/bootstrap/http", () => ({
	wrapRouteHandlerWithLogging: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("@/app/_lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/bootstrap/container", () => ({ getContainer: vi.fn() }));

import { GET } from "@/app/api/v1/work/items/[id]/history/route";
import { getContainer } from "@/bootstrap/container";

it("passes history refs pagination through the released handler while preserving legacy history", async () => {
	const entry = (commit: string) => ({
		version: commit,
		commit,
		at: "2026-11-01T00:00:00.000Z",
		actor: null,
		reason: "Updated",
		cites: [],
		changed: ["title"],
		diff: { title: { before: "old", after: "new", truncated: false } },
	});
	const newest = entry("abc123");
	const older = entry("def456");
	const history = vi.fn().mockResolvedValue([newest, older]);
	const historyPage = vi
		.fn()
		.mockImplementation(async (_id, { cursor }) =>
			cursor === undefined
				? { entries: [newest], nextCursor: newest.commit }
				: { entries: [older], nextCursor: null },
		);
	vi.mocked(getContainer).mockReturnValue({
		doltgresWorkItems: {
			get: vi.fn().mockResolvedValue({}),
			history,
			historyPage,
		},
	} as never);
	const ctx = {
		log: { info: vi.fn(), warn: vi.fn() },
		reqId: "req",
		routeId: "history",
	};
	const handler = GET as unknown as (
		ctx: unknown,
		request: Request,
		user: unknown,
		context: unknown,
	) => Promise<Response>;
	const get = (query: string) =>
		handler(
			ctx,
			new Request(`http://localhost/api/v1/work/items/task.1/history${query}`),
			{ id: "user" },
			{ params: Promise.resolve({ id: "task.1" }) },
		);

	const first = await get("?view=refs");
	expect(first.status).toBe(200);
	const firstBody = await first.json();
	expect(firstBody).toMatchObject({
		refs: [{ commit: "abc123" }],
		nextCursor: "abc123",
	});
	expect(firstBody.refs[0]).not.toHaveProperty("diff");
	const second = await get(`?view=refs&cursor=${firstBody.nextCursor}`);
	expect(second.status).toBe(200);
	expect(await second.json()).toMatchObject({
		refs: [{ commit: "def456" }],
		nextCursor: null,
	});
	expect(historyPage).toHaveBeenNthCalledWith(1, "task.1", {
		cursor: undefined,
		limit: 20,
	});
	expect(historyPage).toHaveBeenNthCalledWith(2, "task.1", {
		cursor: "abc123",
		limit: 20,
	});

	const legacy = await get("");
	expect(legacy.status).toBe(200);
	expect(await legacy.json()).toEqual({ items: [newest, older] });
	expect(history).toHaveBeenCalledOnce();
});
