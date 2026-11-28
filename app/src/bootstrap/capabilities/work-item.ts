// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/work-item`
 * Purpose: Factory for WorkItemCapability — bridges ai-tools interface to WorkItemQueryPort + the authoritative Dolt patch.
 * Scope: Creates WorkItemCapability that delegates to hexagonal ports. Does not implement transport.
 * Invariants:
 *   - PORTS_ARE_AUTHORITY: All operations delegate to WorkItemQueryPort/WorkItemCommandPort
 *   - TRANSITION_TABLE_ENFORCED: the released Dolt patch validates status moves
 *   - PATCH_REASON_AND_CITES (task.0086): the required `reason` and the optional `cites` are forwarded to the Doltgres store, the one enforcer;
 *     an absent durable writer refuses rather than writing through the markdown fallback.
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
} from "@cogni/ai-tools";
import type {
  ActorKind,
  WorkItemQueryPort,
  WorkItemStatus,
  WorkItemType,
  WriteAttribution,
} from "@cogni/work-items";
import type {
  EnvelopeDegradedEvent,
  ItemArtifactsPort,
  createWorkItemWriters,
  ItemRefPorts,
  ItemLinksPort,
  MoveReadingPort,
} from "@cogni/work-items";
import {
  composeItemEnvelope,
  recordWorkItemArtifact,
  artifactsNotConfigured,
  judgeMoveSummaries,
  toWorkItemDto as toWorkItemInfo,
  toWorkItemId,
  toWorkItemsPatchInput,
} from "@cogni/work-items";
import { WorkItemPatchConflictError } from "@cogni/ai-tools";
import { WorkItemRevisionConflictError } from "@cogni/work-items/adapters/doltgres";
import type { WorkItemsDoltgresPort } from "@/ports/server";

/**
 * Dependencies for creating the work item capability.
 */
export interface WorkItemCapabilityDeps {
  readonly workItemQuery: WorkItemQueryPort;
  readonly backlogReader?: Pick<WorkItemQueryPort, "list">;
  /** Reads the metrics a single item moves; absent means no metrics service (every move reads `unknown`). */
  readonly moveReadings?: MoveReadingPort | undefined;
  /** First page of an item's citation links (`read` with `includeLinks`); absent reads `unavailable`. */
  readonly links?: ItemLinksPort | undefined;
  /** The latest artifact of each kind (task.0028); absent: the item reads without `artifacts`. */
  readonly artifacts?: ItemArtifactsPort | undefined;
  /** One event per degraded envelope part (chain or links). */
  readonly refs?: ItemRefPorts | undefined;
  readonly artifactWriter?: ReturnType<typeof createWorkItemWriters>["artifacts"] | undefined;
  readonly log?: ((event: EnvelopeDegradedEvent) => void) | undefined;
  readonly backlogWriter?: {
    readonly store: Pick<WorkItemsDoltgresPort, "patch">;
    /** Host-built at invocation: the run's acting identity and the run (task.0133). */
    readonly attribution: () => WriteAttribution;
    /** One terminal refusal when the attribution could not be built (a run with no acting identity): nothing was written. */
    readonly attributionDenied?: (event: { workItemId: string; error: unknown }) => void;
  };
}

/**
 * Create a WorkItemCapability backed by hexagonal ports.
 */
export function createWorkItemCapability(
  deps: WorkItemCapabilityDeps
): WorkItemCapability {
  const { workItemQuery, artifactWriter } = deps;

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
    async read(id, options) {
      const result = await list({ ids: [id], limit: 1 });
      const item = result.items
        .map(toWorkItemInfo)
        .find((entry) => entry.id === id);
      if (!item) return null;
      // ONE_COMPOSITION: the same `composeItemEnvelope` the HTTP facade calls.
      return composeItemEnvelope(
        item,
        { readings: deps.moveReadings, links: deps.links, artifacts: deps.artifacts, ...deps.refs, log: deps.log },
        { ...options }
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

    ...(artifactWriter ? { recordArtifact: async (input: { id: string; body: unknown }) => {
      const writer = artifactWriter;
      const store = writer.deps();
      if (!store) return artifactsNotConfigured(input.id, "write");
      const attribution = writer.attribution();
      const result = await recordWorkItemArtifact(store, input.id, attribution, input.body);
      writer.log(result.log, attribution);
      return result;
    } } : {}),

    async patch(input): Promise<WorkItemInfo> {
      const writer = deps.backlogWriter;
      if (writer) {
        let attribution: WriteAttribution;
        try {
          attribution = writer.attribution();
        } catch (error) {
          // Fail closed, and say so in one terminal event.
          writer.attributionDenied?.({ workItemId: input.id, error });
          throw error;
        }
        try {
          const updated = await writer.store.patch(
            toWorkItemsPatchInput({
              id: input.id,
              expectedRevision: input.expectedRevision,
              reason: input.reason,
              cites: input.cites,
              set: input.set,
            }),
            attribution
          );
          return toWorkItemInfo(updated);
        } catch (error) {
          if (error instanceof WorkItemRevisionConflictError) {
            throw new WorkItemPatchConflictError(error.id, error.expectedRevision, error.currentRevision);
          }
          throw error;
        }
      }
      throw new Error("Doltgres backlog writer unavailable");
    },
  };
}
