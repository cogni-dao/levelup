// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Composition only: Dolt content retains bridge fencing; PostgreSQL is the sole lease authority.
 * Activation requires applied schema, terminated legacy producers and proven expiry.
 */
import { withWorkItemLeases } from "@cogni/work-items";
import { DoltgresWorkItemAdapter, type DoltgresWorkItemAdapterOptions } from "@cogni/work-items/adapters/doltgres";
import { PostgresWorkItemLeaseAdapter } from "@cogni/work-items/adapters/postgres";
import type { Sql } from "postgres";

export { WorkItemAuthorizationError, WorkItemLeaseConflictError, WorkItemsBusyError } from "@cogni/work-items/adapters/doltgres";

export function createLevelUpWorkItemStore(
  contentSql: Sql,
  serviceSql: Sql,
  logger: DoltgresWorkItemAdapterOptions["logger"],
  options: Omit<DoltgresWorkItemAdapterOptions, "idFloor" | "logger" | "writerLockProtocol"> = {},
) {
  const content = new DoltgresWorkItemAdapter(contentSql, {
    ...options, idFloor: 1, writerLockProtocol: "bridge", ...(logger ? { logger } : {}),
  });
  return withWorkItemLeases(content, new PostgresWorkItemLeaseAdapter(serviceSql, {
    ...(logger ? { logger } : {}),
  }));
}
