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

type DomainRouteHandler = Parameters<
  typeof wrapRouteHandlerWithLogging<DomainContext>
>[1];

const handleItem: DomainRouteHandler = async (
  ctx,
  request,
  sessionUser,
  context
) => {
  if (!context) throw new Error("context required for dynamic routes");
  const { domain } = await context.params;
  const response = await handleDomainItem(request, domain, sessionUser);
  ctx.log.info(
    { domainId: domain, status: response.status },
    "knowledge.domains.item_complete"
  );
  return response;
};

// One wrapper per method, each route id literally beside its door: the same-door enumeration test reads them.
export const GET = wrapRouteHandlerWithLogging<DomainContext>(
  {
    routeId: "knowledge.domains.get",
    sameDoor: "knowledge.read",
    auth: { mode: "required", getSessionUser },
  },
  handleItem
);

export const PATCH = wrapRouteHandlerWithLogging<DomainContext>(
  {
    routeId: "knowledge.domains.update",
    auth: { mode: "required", getSessionUser },
  },
  handleItem
);

export const DELETE = wrapRouteHandlerWithLogging<DomainContext>(
  {
    routeId: "knowledge.domains.delete",
    auth: { mode: "required", getSessionUser },
  },
  handleItem
);
