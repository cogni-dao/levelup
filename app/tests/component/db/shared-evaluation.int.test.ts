// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Real Doltgres 0.57.3 acceptance for the deployed work-item mutation flow.
 *
 * Exercises the node-owned composition of two immutable published adapters.
 * No copied adapter implementation and no model evaluation.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toWorkItemId } from "@cogni/work-items";
import postgres, { type Sql } from "postgres";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DoltgresLevelUpWorkItemAdapter } from "@/adapters/server/db/doltgres/shared-work-items-adapter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MIGRATE_SCRIPT = path.resolve(
	REPO_ROOT,
	"scripts/db/migrate-doltgres.mjs",
);
const MIGRATIONS_DIR = path.resolve(
	REPO_ROOT,
	"app/src/adapters/server/db/doltgres-migrations",
);
const DOLTGRES_IMAGE = "dolthub/doltgresql:0.57.3";
const DB_NAME = "knowledge_levelup_test";
const PASSWORD = "doltgres";

describe("Doltgres 0.57.3 work-item acceptance", () => {
	let container: StartedTestContainer;
	let sql: Sql;
	let dbUrl: string;
	const stageLogger = {
		info: (fields: unknown, message?: string) =>
			console.info(message, JSON.stringify(fields)),
		warn: (fields: unknown, message?: string) =>
			console.warn(message, JSON.stringify(fields)),
		error: (fields: unknown, message?: string) =>
			console.error(message, JSON.stringify(fields)),
	};

	beforeAll(async () => {
		container = await new GenericContainer(DOLTGRES_IMAGE)
			.withEnvironment({ DOLTGRES_PASSWORD: PASSWORD })
			.withExposedPorts(5432)
			.withWaitStrategy(
				Wait.forLogMessage(/server (started|listening)/i, 1).withStartupTimeout(
					60_000,
				),
			)
			.start();

		const host = container.getHost();
		const port = container.getMappedPort(5432);
		const baseUrl = `postgresql://postgres:${PASSWORD}@${host}:${port}/postgres`;
		dbUrl = `postgresql://postgres:${PASSWORD}@${host}:${port}/${DB_NAME}`;
		const bootstrap = postgres(baseUrl, { max: 1, fetch_types: false });
		try {
			await bootstrap.unsafe(`CREATE DATABASE ${DB_NAME}`);
		} finally {
			await bootstrap.end({ timeout: 5 });
		}

		execFileSync(process.execPath, [MIGRATE_SCRIPT, MIGRATIONS_DIR], {
			env: { ...process.env, DATABASE_URL: dbUrl, NODE_NAME: "levelup-test" },
			encoding: "utf8",
			stdio: "pipe",
		});
		sql = postgres(dbUrl, { max: 1, fetch_types: false });
	}, 180_000);

	afterAll(async () => {
		if (sql) await sql.end({ timeout: 5 });
		if (container) await container.stop();
	});

  it("composes published scores and v1 leases without changing protected content", async () => {
    const pools: Sql[] = [];
    const client = () => {
      const pool = postgres(dbUrl, { max: 1, fetch_types: false });
      pools.push(pool);
      return pool;
    };
    const adapter = new DoltgresLevelUpWorkItemAdapter(client(), stageLogger, { legacyClient: client(), recreateClient: client });
    const id = toWorkItemId("task.9598");
    const owner = "baseline-owner";
    const collaborator = "baseline-collaborator";
    const scores = { goal: { v: 3 }, time: { v: 2 }, unblocks: { v: 3 }, ease: { v: 4, ev: "https://example.org/proof?q=1#section" }, confidence: { v: 3 }, agent: { v: 3 } };
    try {
      const created = await adapter.create({ id, type: "task", title: "Shared evaluation composition" }, owner);
      const scored = await adapter.patch({ id, expectedRevision: created.revision, set: { scores } }, collaborator);
      expect(scored.scores).toEqual(scores);
      await expect(adapter.patch({ id, expectedRevision: created.revision, set: { scores: null } }, collaborator)).rejects.toMatchObject({ name: "WorkItemRevisionConflictError" });
      await expect(adapter.patch({ id, set: { title: "Foreign content", scores: null } }, collaborator)).rejects.toMatchObject({ name: "WorkItemAuthorizationError" });
      expect(await adapter.get(id)).toMatchObject({ title: "Shared evaluation composition", scores, revision: scored.revision });
      const claimed = await adapter.claim({ id, runId: "baseline-run", command: "/baseline", principalId: owner });
      expect(claimed.claimedByRun).toBe("baseline-run");
      expect(claimed.scores).toEqual(scores);
      expect(claimed.revision).toBeGreaterThan(scored.revision);
      expect((await adapter.get(id))?.claimedByRun).toBe("baseline-run");
      expect((await adapter.list({ ids: [id] })).items[0]).toMatchObject({ scores, claimedByRun: "baseline-run" });
      await expect(adapter.claim({ id, runId: "intruder", command: "/baseline", principalId: collaborator })).rejects.toMatchObject({ name: "WorkItemLeaseConflictError" });
      const beat = await adapter.heartbeat({ id, runId: "baseline-run", principalId: owner });
      expect(beat.scores).toEqual(scores);
      const released = await adapter.release({ id, runId: "baseline-run", principalId: owner });
      expect(released.claimedByRun).toBeUndefined();
      expect(released.scores).toEqual(scores);
      const cleared = await adapter.patch({ id, expectedRevision: released.revision, set: { scores: null } }, collaborator);
      expect(cleared.scores).toBeUndefined();
      await expect(adapter.delete(id, owner)).resolves.toBe(true);
    } finally {
      await Promise.all(pools.map((pool) => pool.end({ timeout: 0 }).catch(() => undefined)));
    }
  }, 60_000);

});
