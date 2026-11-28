// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import type { SessionUser } from "@cogni/node-shared";

/** Credential kind is set only by the canonical credential verifier. */
export type AuthenticatedIdentity = SessionUser & {
  readonly via: "bearer" | "session";
};

export function requestCredentialKind(
  user: SessionUser,
): AuthenticatedIdentity["via"] {
  if ("via" in user && (user.via === "bearer" || user.via === "session"))
    return user.via;
  throw new Error("verified_credential_kind_missing");
}
