// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/readyz/_lib/error-fields`
 * Purpose: Classify wrapped readiness failures without logging database payloads.
 * Scope: Reads own data properties in a bounded cause chain; does not log payloads or perform IO.
 * Invariants: Only closed categories leave this module; no messages, SQL, or credentials.
 * Side-effects: none
 * Links: ../route.ts
 * @internal
 */

const CATEGORIES = {
  "42P01": "db_undefined_table",
  "42703": "db_undefined_column",
  "3D000": "db_undefined_database",
  "28P01": "db_auth_failed",
  "28000": "db_auth_failed",
  "42501": "db_permission_denied",
  "08001": "db_connection_unavailable",
  "08003": "db_connection_unavailable",
  "08006": "db_connection_unavailable",
  "57P03": "db_connection_unavailable",
  "53300": "db_connection_limit",
  "57014": "db_query_canceled",
  ECONNREFUSED: "db_connection_refused",
  ETIMEDOUT: "db_connection_timeout",
  CONNECT_TIMEOUT: "db_connection_timeout",
  ECONNRESET: "db_connection_closed",
  CONNECTION_CLOSED: "db_connection_closed",
  CONNECTION_ENDED: "db_connection_closed",
  CONNECTION_DESTROYED: "db_connection_closed",
  ENOTFOUND: "db_dns_failed",
  EAI_AGAIN: "db_dns_failed",
} as const;

type ErrorCategory = (typeof CATEGORIES)[keyof typeof CATEGORIES] | "unknown";

function ownData(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Drizzle wraps the driver error in cause; never inspect or echo its query. */
export function readinessErrorFields(error: unknown): {
  reason: "INTERNAL_ERROR";
  errorCategory: ErrorCategory;
} {
  let current = error;
  let errorCategory: ErrorCategory = "unknown";
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== "object") break;
    const code = ownData(current, "code");
    if (typeof code === "string" && Object.hasOwn(CATEGORIES, code)) {
      errorCategory = CATEGORIES[code as keyof typeof CATEGORIES];
      break;
    }
    current = ownData(current, "cause");
  }
  return { reason: "INTERNAL_ERROR", errorCategory };
}
