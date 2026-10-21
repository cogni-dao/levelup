// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/readyz-error-fields`
 * Purpose: Verify readiness diagnosis preserves privacy for wrapped driver errors.
 * Scope: Tests pure classification; does not connect to a database or mock routes.
 * Invariants: SQL, parameters, credentials, and arbitrary codes never enter log fields.
 * Side-effects: none
 * Links: src/app/(infra)/readyz/_lib/error-fields.ts
 * @internal
 */

import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { readinessErrorFields } from "@/app/(infra)/readyz/_lib/error-fields";

describe("readiness error fields", () => {
  it.each([
    ["42P01", "db_undefined_table"],
    ["42703", "db_undefined_column"],
    ["28P01", "db_auth_failed"],
    ["42501", "db_permission_denied"],
    ["ECONNREFUSED", "db_connection_refused"],
    ["CONNECT_TIMEOUT", "db_connection_timeout"],
    ["ETIMEDOUT", "db_connection_timeout"],
    ["ENOTFOUND", "db_dns_failed"],
  ])("classifies %s without returning its payload", (code, errorCategory) => {
    expect(readinessErrorFields({ code })).toEqual({
      reason: "INTERNAL_ERROR",
      errorCategory,
    });
  });

  it("extracts a real Drizzle wrapper's PostgresError-shaped cause without private fields", () => {
    const privateData =
      "postgres://user:secret@private/db SELECT secret WHERE id=$1";
    const driverError = Object.assign(new Error(privateData), {
      name: "PostgresError",
      code: "42P01",
      detail: privateData,
      query: privateData,
      parameters: [privateData],
    });
    const wrapped = new DrizzleQueryError(
      privateData,
      [privateData],
      driverError
    );
    const fields = readinessErrorFields(wrapped);
    expect(fields).toEqual({
      reason: "INTERNAL_ERROR",
      errorCategory: "db_undefined_table",
    });
    expect(JSON.stringify(fields)).not.toContain(privateData);
  });

  it.each([
    "__proto__",
    "constructor",
    "arbitrary secret",
    "42P02",
  ])("does not echo unknown or inherited category %s", (code) => {
    expect(readinessErrorFields({ code, message: "private" })).toEqual({
      reason: "INTERNAL_ERROR",
      errorCategory: "unknown",
    });
  });

  it("bounds cycles and depth", () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(readinessErrorFields(cycle).errorCategory).toBe("unknown");
    let chain: unknown = { code: "42P01" };
    for (let i = 0; i < 5; i++) chain = { cause: chain };
    expect(readinessErrorFields(chain).errorCategory).toBe("unknown");
  });

  it("does not execute getters or expose throwing proxy errors", () => {
    const value = Object.defineProperties(
      {},
      {
        code: {
          get: () => {
            throw new Error("private code getter");
          },
        },
        cause: {
          get: () => {
            throw new Error("private cause getter");
          },
        },
      }
    );
    expect(readinessErrorFields(value).errorCategory).toBe("unknown");
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("private");
        },
      }
    );
    expect(readinessErrorFields(proxy).errorCategory).toBe("unknown");
    expect(
      readinessErrorFields(Object.create({ code: "42P01" })).errorCategory
    ).toBe("unknown");
  });
});
