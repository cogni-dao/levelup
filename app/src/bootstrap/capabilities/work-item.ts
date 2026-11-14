// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/work-item`
 * Purpose: Factory for WorkItemCapability — bridges ai-tools interface to WorkItemQueryPort + WorkItemCommandPort.
 * Scope: Creates WorkItemCapability that delegates to hexagonal ports. Does not implement transport.
 * Invariants:
 *   - PORTS_ARE_AUTHORITY: All operations delegate to WorkItemQueryPort/WorkItemCommandPort
 *   - TRANSITION_TABLE_ENFORCED: CommandPort validates transitions
 *   - PATCH_REASON_AND_CITES (task.0086): the required `reason` and the optional `cites` are forwarded to the Doltgres store, the one enforcer;
 *     the markdown fallback (development only) has no history and ignores both, though the tool schema still requires a reason.
 *   - MOVES_READ_AT_READ_TIME (story.0033): a read that returns exactly one item (core__work_item_read) adds each move's baseline,
 *     current reading and verdict from `moveReadings`; a list read returns the stored moves only, so a page costs no metric lookup.
 *   - ONE_ITEM_ENVELOPE (task.0118): `read` is the single-item envelope: it also adds each move's metric, KPI and goal (`moveReadings.context`) and, on request, the first page of citation links (`links`); both through the package's `composeItemEnvelope`; `query` and `queryPage` never do.
 * Side-effects: none (factory only)
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/development-lifecycle.md
 * @internal
 */

import type {
  WorkItemCapability,
  WorkItemInfo,
  WorkItemQueryParams,
  WorkItemTransitionResult,
} from "@cogni/shared-ai-tools";
import type {
  ActorKind,
  WorkItemCommandPort,
  WorkItemQueryPort,
  WorkItemStatus,
  WorkItemType,
} from "@cogni/work-items";
import type {
  EnvelopeDegradedEvent,
  ItemLinksPort,
  MoveReadingPort,
} from "@cogni/work-items";
import {
  composeItemEnvelope,
  judgeMoveSummaries,
  toWorkItemDto as toWorkItemInfo,
  toWorkItemId,
  toWorkItemsPatchInput,
} from "@cogni/work-items";
import { WorkItemPatchConflictError } from "@cogni/shared-ai-tools";
import type { WorkItemsDoltgresPort } from "@/ports/server";

/** The patch `set` without explicit-undefined keys (the route facade drops them the same way). */
const definedOnly = (set: object): object =>
  Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));

/**
 * Dependencies for creating the work item capability.
 */
export interface WorkItemCapabilityDeps {
  readonly workItemQuery: WorkItemQueryPort;
  readonly workItemCommand: WorkItemCommandPort;
  readonly backlogReader?: Pick<WorkItemQueryPort, "list">;
  /** Reads the metrics a single item moves; absent means no metrics service (every move reads `unknown`). */
  readonly moveReadings?: MoveReadingPort | undefined;
  /** First page of an item's citation links (`read` with `includeLinks`); absent reads `unavailable`. */
  readonly links?: ItemLinksPort | undefined;
  /** One event per degraded envelope part (chain or links). */
  readonly log?: ((event: EnvelopeDegradedEvent) => void) | undefined;
  readonly backlogWriter?: { readonly store: Pick<WorkItemsDoltgresPort, "patch">; readonly principalId: () => string };
}

/**
 * Create a WorkItemCapability backed by hexagonal ports.
 */
export function createWorkItemCapability(
  deps: WorkItemCapabilityDeps
): WorkItemCapability {
  const { workItemQuery, workItemCommand } = deps;

  function list(params: WorkItemQueryParams) {
    return (deps.backlogReader ?? workItemQuery).list({
      ...(params.sortBy && { sortBy: params.sortBy }),
      ...(params.sortDirection && { sortDirection: params.sortDirection }),
      ...(params.labels && { labels: params.labels }),
      ...(params.labelPrefix && { labelPrefix: params.labelPrefix }),
      ...(params.scored !== undefined && { scored: params.scored }),
      ...(params.ids && { ids: params.ids.map(toWorkItemId) }),
      ...(params.cursor && { cursor: params.cursor }),
      ...(params.statuses && {
        statuses: params.statuses as readonly WorkItemStatus[],
      }),
      ...(params.types && {
        types: params.types as readonly WorkItemType[],
      }),
      ...(params.text && { text: params.text }),
      ...(params.actor && { actor: params.actor as ActorKind }),
      ...(params.rankMin !== undefined && { rankMin: params.rankMin }),
      ...(params.rankMax !== undefined && { rankMax: params.rankMax }),
      ...(params.projectIds && {
        projectIds: params.projectIds.map(toWorkItemId),
      }),
      ...(params.projectId && {
        projectId: toWorkItemId(params.projectId),
      }),
      ...(params.limit && { limit: params.limit }),
    });
  }

  /** A one-item read gets each move judged from its observations (bounded: at most 3 moves). */
  async function withMoveReadings(
    items: readonly WorkItemInfo[]
  ): Promise<readonly WorkItemInfo[]> {
    const only = items.length === 1 ? items[0] : undefined;
    if (!only?.moves?.length) return items;
    return judgeMoveSummaries([only], deps.moveReadings);
  }

  return {
    /**
     * THE single-item envelope (task.0118), the same shape `GET /api/v1/work/items/{id}` serves: the
     * item with each move's readings, verdict and metric → KPI → goal chain, and with `includeLinks`
     * the first page of citation links.
     */
    async read(id, options): Promise<WorkItemInfo | null> {
      const result = await list({ ids: [id], limit: 1 });
      const item = result.items
        .map(toWorkItemInfo)
        .find((entry) => entry.id === id);
      if (!item) return null;
      // ONE_COMPOSITION: the same `composeItemEnvelope` the HTTP facade calls.
      return composeItemEnvelope(
        item,
        { readings: deps.moveReadings, links: deps.links, log: deps.log },
        { includeLinks: options?.includeLinks === true }
      );
    },

    async query(params): Promise<readonly WorkItemInfo[]> {
      const result = await list(params);
      return withMoveReadings(result.items.map(toWorkItemInfo));
    },

    /** Paginated read: a complete backlog snapshot follows `nextCursor` to the end. */
    async queryPage(params) {
      const result = await list(params);
      return {
        items: result.items.map(toWorkItemInfo),
        ...(result.nextCursor !== undefined && {
          nextCursor: result.nextCursor,
        }),
      };
    },

    async transitionStatus(input): Promise<WorkItemTransitionResult> {
      const current = await workItemQuery.get(toWorkItemId(input.id));
      if (!current) {
        throw new Error(`Work item not found: ${input.id}`);
      }

      const updated = await workItemCommand.transitionStatus({
        id: toWorkItemId(input.id),
        expectedRevision: String(current.revision),
        toStatus: input.toStatus as WorkItemStatus,
        ...(input.reason && { reason: input.reason }),
      });

      return {
        id: updated.id,
        previousStatus: current.status,
        newStatus: updated.status,
        revision: updated.revision as number,
      };
    },

    async patch(input): Promise<WorkItemInfo> {
      const writer = deps.backlogWriter;
      if (writer) {
        try {
          const updated = await writer.store.patch(
            toWorkItemsPatchInput({
              id: input.id,
              expectedRevision: input.expectedRevision,
              reason: input.reason,
              cites: input.cites,
              set: input.set,
            }),
            writer.principalId()
          );
          return toWorkItemInfo(updated);
        } catch (error) {
          if ((error as Error)?.name === "WorkItemRevisionConflictError") {
            const conflict = error as { id: string; expectedRevision: number; currentRevision: number };
            throw new WorkItemPatchConflictError(conflict.id, conflict.expectedRevision, conflict.currentRevision);
          }
          throw error;
        }
      }
      if (input.expectedRevision !== undefined) throw new Error("Doltgres backlog writer unavailable");
      const current = await workItemQuery.get(toWorkItemId(input.id));
      if (!current) {
        throw new Error(`Work item not found: ${input.id}`);
      }

      const updated = await workItemCommand.patch({
        id: toWorkItemId(input.id),
        expectedRevision: String(current.revision),
        set: definedOnly(input.set) as NonNullable<
          Parameters<typeof workItemCommand.patch>[0]["set"]
        >,
      });

      return toWorkItemInfo(updated);
    },
  };
}
