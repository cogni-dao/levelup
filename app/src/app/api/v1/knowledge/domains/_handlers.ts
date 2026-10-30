// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/domains/_handlers`
 * Purpose: HTTP handlers for the knowledge domain registry — list and register, mapping typed errors to HTTP statuses.
 * Scope: Node-local HTTP wiring only. Does not contain business logic, validation, or storage I/O — those live in the port/adapter.
 * Invariants: VALIDATE_IO, AUTH_VIA_GETSESSIONUSER, DOMAIN_LIST_REQUIRES_PRINCIPAL
 *   (any authenticated principal — session human or bearer agent — may list
 *   domains, mirroring KNOWLEDGE_READ_REQUIRES_PRINCIPAL on /knowledge),
 *   DOMAIN_REGISTER_BEARER_OR_SESSION (federation: external bearer agents may
 *   register a domain on-demand so that downstream writes — knowledge
 *   contributions, EDO hypothesize/decide/record-outcome — can proceed against
 *   the DOMAIN_FK_ENFORCED_AT_WRITE adapter invariant without requiring a UI
 *   roundtrip).
 * Side-effects: IO (HTTP response, Doltgres read/write via container port)
 * Links: docs/spec/knowledge-domain-registry.md, docs/spec/knowledge-syntropy.md
 * @internal
 */

import { BASE_DOMAIN_SEEDS } from "@cogni/knowledge-base";
import {
  DomainAlreadyRegisteredError,
  DomainNotEmptyError,
  DomainNotRegisteredError,
  KnowledgeBusyError,
  KnowledgeWriteConflictError,
  KnowledgeWriteOutcomeUnknownError,
  KnowledgeWriteScopeRequiredError,
} from "@cogni/knowledge-store";
import {
  DomainsCreateRequestSchema,
  DomainsCreateResponseSchema,
  type DomainsErrorResponse,
  DomainsErrorResponseSchema,
  domainsDeleteOperation,
  domainsGetOperation,
  domainsUpdateOperation,
} from "@cogni/node-contracts";
import type { SessionUser } from "@cogni/node-shared";
import { NextResponse } from "next/server";

import { loadDomains } from "@/app/(app)/knowledge/_server/loaders";
import { getContainer } from "@/bootstrap/container";

function port() {
  return getContainer().knowledgeStorePort ?? null;
}

export async function handleList(
  _request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Any authenticated principal may list domains (DOMAIN_LIST_REQUIRES_PRINCIPAL).
  // Bearer agents need the registry to recall + target writes, mirroring
  // KNOWLEDGE_READ_REQUIRES_PRINCIPAL on /knowledge.
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );
  return NextResponse.json(await loadDomains(p));
}

export async function handleCreate(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Bearer agents may register a domain on-demand to satisfy
  // DOMAIN_FK_ENFORCED_AT_WRITE before downstream writes
  // (knowledge contributions + EDO hypothesize/decide/record-outcome).
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = DomainsCreateRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  try {
    const domain = await p.registerDomain({
      id: parsed.data.id,
      name: parsed.data.name,
      ...(parsed.data.description != null
        ? { description: parsed.data.description }
        : {}),
    });
    return NextResponse.json(DomainsCreateResponseSchema.parse(domain), {
      status: 201,
    });
  } catch (e: unknown) {
    if (e instanceof DomainAlreadyRegisteredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}

function domainError(status: number, body: DomainsErrorResponse): NextResponse {
  return NextResponse.json(DomainsErrorResponseSchema.parse(body), { status });
}

function domainFailure(error: unknown): NextResponse {
  if (error instanceof DomainNotRegisteredError)
    return domainError(404, {
      error: error.message,
      errorCode: "domain_not_found",
    });
  if (error instanceof DomainNotEmptyError)
    return domainError(409, {
      error: error.message,
      errorCode: "domain_not_empty",
      entryCount: error.entryCount,
    });
  if (error instanceof KnowledgeWriteOutcomeUnknownError)
    return domainError(409, {
      error: error.message,
      errorCode: "knowledge_write_outcome_unknown",
      retryable: false,
      operationId: error.operationId,
      branch: error.branch,
      commitHash: error.commitHash ?? null,
    });
  if (error instanceof KnowledgeWriteScopeRequiredError)
    return domainError(500, {
      error: error.message,
      errorCode: "knowledge_write_scope_required",
      retryable: false,
    });
  if (error instanceof KnowledgeWriteConflictError)
    return domainError(409, {
      error: error.message,
      errorCode: "knowledge_write_conflict",
      retryable: false,
      entryId: error.entryId,
    });
  if (error instanceof KnowledgeBusyError)
    return NextResponse.json(
      DomainsErrorResponseSchema.parse({
        error: error.message,
        errorCode: "knowledge_busy",
        retryable: true,
      }),
      { status: 503, headers: { "Retry-After": "2" } }
    );
  throw error;
}

/** Thin item adapter: auth and wire validation stay local; mutation policy stays in the domain. */
export async function handleDomainItem(
  request: Request,
  domain: string,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return domainError(401, {
      error: "unauthorized",
      errorCode: "unauthorized",
    });
  const p = port();
  if (!p)
    return domainError(503, {
      error: "knowledge store not configured",
      errorCode: "store_not_configured",
    });
  const id = domainsGetOperation.input.safeParse({ domain });
  if (!id.success)
    return domainError(400, {
      error: "invalid domain id",
      errorCode: "invalid_input",
      issues: id.error.issues,
    });
  try {
    if (request.method === "GET") {
      const row = await p.getDomain(id.data.domain);
      if (!row)
        return domainError(404, {
          error: `domain '${domain}' not registered`,
          errorCode: "domain_not_found",
        });
      return NextResponse.json(domainsGetOperation.output.parse(row));
    }
    if (request.method === "PATCH") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return domainError(400, {
          error: "invalid JSON body",
          errorCode: "invalid_json",
        });
      }
      const input = domainsUpdateOperation.input.safeParse({ domain, body });
      if (!input.success)
        return domainError(400, {
          error: "invalid input",
          errorCode: "invalid_input",
          issues: input.error.issues,
        });
      const patch = input.data.body;
      const row = await p.updateDomain(domain, {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && {
          description: patch.description,
        }),
      });
      return NextResponse.json(domainsUpdateOperation.output.parse(row));
    }
    if (BASE_DOMAIN_SEEDS.some((seed) => seed.id === domain))
      return domainError(409, {
        error: `domain '${domain}' is a baseline domain and cannot be deleted`,
        errorCode: "domain_protected",
      });
    await p.deleteDomain(domain);
    return NextResponse.json(
      domainsDeleteOperation.output.parse({ id: domain, deleted: true })
    );
  } catch (error) {
    return domainFailure(error);
  }
}
