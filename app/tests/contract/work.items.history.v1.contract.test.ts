// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/contract/work.items.history.v1.contract`
 * Purpose: Validates the patch `reason` and the re-exported history operations (story.0023).
 * Scope: Pure Zod schema validation. The history logic is owned and tested by the packages.
 * Invariants: reason is one line of 1-512 chars; both history operations are exported by node-contracts.
 * Side-effects: none
 * Links: packages/node-contracts/src/history.v1.contract.ts
 * @internal
 */

import {
  knowledgeHistoryOperation,
  workItemsHistoryOperation,
  workItemsPatchOperation,
} from "@cogni/node-contracts";
import { describe, expect, it } from "vitest";

const set = { title: "t" };

describe("work.items.patch.v1 reason", () => {
  it("accepts a reason and keeps it on the parsed input", () => {
    const parsed = workItemsPatchOperation.input.parse({
      id: "task.0001",
      reason: "why it changed",
      set,
    });
    expect(parsed.reason).toBe("why it changed");
  });

  it("stays optional", () => {
    expect(
      workItemsPatchOperation.input.safeParse({ id: "task.0001", set }).success
    ).toBe(true);
  });

  it("rejects an empty reason and one over 512 characters", () => {
    for (const reason of ["", "x".repeat(513)]) {
      expect(
        workItemsPatchOperation.input.safeParse({ id: "task.0001", reason, set })
          .success
      ).toBe(false);
    }
  });
});

describe("history operations", () => {
  it("re-exports the package operations for work items and knowledge", () => {
    expect(workItemsHistoryOperation.input).toBeDefined();
    expect(knowledgeHistoryOperation.output).toBeDefined();
  });
});
