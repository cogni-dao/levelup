// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Published authority schema over LevelUp's own foreign-key targets. Migration and seeds stay local. */
import { defineAgentAuthoritySchema } from "@cogni/agent-grants/schema";
import { billingAccounts, users } from "./refs";
export const { agentPrincipals, agentRoles, agentCredentials } =
  defineAgentAuthoritySchema({ users, billingAccounts });
