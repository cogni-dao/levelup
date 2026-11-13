// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/domains/[domain]/route`
 * Purpose: Read, rename, and delete an empty domain using the existing registry auth.
 * Scope: HTTP composition only; domain behavior belongs to knowledge-store.
 * Invariants: AUTH_VIA_GETSESSIONUSER, VALIDATE_IO, DOMAIN_ID_IS_IMMUTABLE.
 * Side-effects: IO via the injected domain port.
 * Links: contracts/knowledge.domains.v1.contract
 * @public
 */
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { handleDomainItem } from "../_handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DomainContext = { params: Promise<{ domain: string }> };

function itemRoute(routeId: string) {
  return wrapRouteHandlerWithLogging<DomainContext>(
    { routeId, auth: { mode: "required", getSessionUser } },
    async (ctx, request, sessionUser, context) => {
      if (!context) throw new Error("context required for dynamic routes");
      const { domain } = await context.params;
      const response = await handleDomainItem(request, domain, sessionUser);
      ctx.log.info(
        { domainId: domain, status: response.status },
        "knowledge.domains.item_complete"
      );
      return response;
    }
  );
}

export const GET = itemRoute("knowledge.domains.get");
export const PATCH = itemRoute("knowledge.domains.update");
export const DELETE = itemRoute("knowledge.domains.delete");
