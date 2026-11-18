// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/work-item-pr-facts`
 * Purpose: The work-items `PrFactsPort` (task.0122): a PR's current head and merge state for the code gates, read over unauthenticated GitHub REST.
 * Scope: One GET per call. The 5 s timeout and the 60 s cache per PR URL belong to the work-items adapter, not to this wiring.
 * Invariants:
 *   - NO_NEW_SECRETS: the node holds no GitHub credential; the read is the public one.
 *   - FAILURE_THROWS: any non-2xx, an unparseable URL or an unreadable head throws; the gate answers 503 and writes nothing.
 * Side-effects: IO (one GitHub REST read per call)
 * Links: hub work-cicd-gates-design
 * @internal
 */

import {
  parsePullRequestUrl,
  type PrFactsPort,
  resolvePrRepoPin,
} from "@cogni/work-items";

/** `WORK_ITEMS_PR_REPO` as the gate takes it; the one reader lives with the gate predicate in `@cogni/work-items`. */
export const resolveWorkItemsPrRepos = resolvePrRepoPin;

export function createPrFactsPort(fetchFn: typeof fetch = fetch): PrFactsPort {
  return {
    async read(url, signal) {
      const parsed = parsePullRequestUrl(url);
      if (!parsed) throw new Error("not a GitHub pull request URL");
      const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${parsed.number}`;
      const res = await fetchFn(`https://api.github.com${path}`, {
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cogni-node",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status} for GET ${path}`);
      const pr = (await res.json()) as {
        head?: { sha?: string };
        merged?: boolean;
        merged_at?: string | null;
      };
      const head = (pr.head?.sha ?? "").toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("unreadable PR head");
      return { head, merged: pr.merged ?? (pr.merged_at ?? null) !== null };
    },
  };
}
