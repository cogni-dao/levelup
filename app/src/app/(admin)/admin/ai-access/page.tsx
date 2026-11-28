// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

"use client";

import { AgentAccessSection } from "@cogni/knowledge-base-ui";

/** Node-wide approvals stay in Admin and render only through the published view. */
export default function AiAccessPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <h1 className="font-bold text-2xl">AI access</h1>
      <AgentAccessSection endpoints={{ roles: "/api/v1/admin/ai-access" }} />
    </main>
  );
}
