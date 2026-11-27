// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/run-attribution`
 * Purpose: A graph-tool write records the run's acting identity (`principalId`) and the run; a run with no acting identity writes nothing.
 * Scope: This node's binding of the package builders over a real execution scope. Does not touch stores or routes.
 * Side-effects: none
 * Links: src/bootstrap/run-attribution.ts, task.0175
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  type ExecutionScope,
  runInScope,
} from "@/adapters/server/ai/execution-scope";
import { runAttribution } from "@/bootstrap/run-attribution";

const scope = (extra: Partial<ExecutionScope>): ExecutionScope =>
  ({ billing: {}, llmService: {}, usageSource: "litellm", ...extra }) as ExecutionScope;

describe("run attribution binding", () => {
  it("names catalog actor separately from requester and scheduled run", () => {
    const attribution = runInScope(
      scope({ principalId: "agent-1", actorUserId: "human-1", subjectUserId: "human-1", runId: "run-1", runKind: "system_scheduled" }),
      () => runAttribution()
    );
    expect(attribution).toEqual({
      actor: "agent-1",
      requestedBy: "human-1",
      run: { id: "run-1", kind: "system_scheduled" },
    });
  });

  it("a run with no acting identity writes nothing", () => {
    expect(() =>
      runInScope(scope({ actorUserId: "requester", subjectUserId: "requester", runId: "run-1", runKind: "user_immediate" }), () =>
        runAttribution()
      )
    ).toThrow(/no acting principal/);
  });
});
