// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/loading`
 * Purpose: Shared loading indicator inside the chat viewport.
 * Scope: Server component and route Suspense fallback.
 * Invariants: Matches client readiness gates.
 * Side-effects: none
 * Links: ./layout.tsx, ./view.tsx,
 *   src/features/ai/chat/components/ChatThreadsSidebarGroup.tsx
 * @public
 */

import { BrainLoading } from "@/components/kit/feedback/BrainLoading";

export default function ChatLoading() {
  return <BrainLoading />;
}
