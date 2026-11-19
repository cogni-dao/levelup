// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/write-attribution`
 * Purpose: A graph-tool write records the run's acting identity and the run; a route write records its caller.
 * Scope: Pure builders over a hand-made execution scope. Does not touch stores or routes.
 * Invariants: ACTOR_IS_THE_RUN_IDENTITY (fails closed), UNKNOWN_RUN_NEVER_BLOCKS, EDO tool writes are attributed at call time.
 * Side-effects: none
 * Links: src/bootstrap/write-attribution.ts, task.0175
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import type { ExecutionScope } from "@/adapters/server/ai/execution-scope";
import {
  bindEdoToolCapability,
  routeAttribution,
  runAttribution,
} from "@/bootstrap/write-attribution";

const scope = (extra: Partial<ExecutionScope>): ExecutionScope =>
  ({ billing: {}, llmService: {}, usageSource: "litellm", ...extra }) as ExecutionScope;

describe("write attribution", () => {
  it("a route write names its caller and nothing else", () => {
    expect(routeAttribution("user-1")).toEqual({ actor: "user-1" });
  });

  it("a run write names the acting identity and the run", () => {
    expect(
      runAttribution(scope({ actorUserId: "agent-1", runId: "run-1", runKind: "system_scheduled" }))
    ).toEqual({ actor: "agent-1", run: { id: "run-1", kind: "system_scheduled" } });
  });

  it("a run with no record still writes as the actor, with no run", () => {
    expect(runAttribution(scope({ actorUserId: "agent-1", runId: "run-1" }))).toEqual({
      actor: "agent-1",
    });
  });

  it("a run with no acting identity writes nothing", () => {
    expect(() => runAttribution(scope({ runId: "run-1", runKind: "user_immediate" }))).toThrow(
      /no acting principal/
    );
  });

  it("an EDO tool write is attributed per call, from the run", async () => {
    const hypothesize = vi.fn(async () => ({}) as never);
    const attribution = vi
      .fn()
      .mockReturnValueOnce({ actor: "a1" })
      .mockReturnValueOnce({ actor: "a2" });
    const tool = bindEdoToolCapability(
      { hypothesize, decide: vi.fn(), recordOutcome: vi.fn(), getChain: vi.fn() } as never,
      attribution
    );
    await tool.hypothesize({ id: "h" } as never);
    await tool.hypothesize({ id: "h" } as never);
    expect(hypothesize.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { actor: "a1" },
      { actor: "a2" },
    ]);
  });
});
