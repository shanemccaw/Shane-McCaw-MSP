// EngageBay base API client (EngageBay Integration Foundation, #104).
//
// Generic layer every EngageBay operation (this phase's contacts/tags/sequences,
// later the webhook receiver and workflow nodes in #105) builds on. Unlike
// zoho-client.ts there is no OAuth lifecycle here: EngageBay auth is a single
// static API key (github.com/engagebay/restapi confirms no expiry, no refresh),
// stored in Azure Key Vault under engagebay_connection.keyVaultSecretName and
// nowhere else. A 401 here means the stored key itself is bad — mark the
// connection "error" and throw, do not retry (there is nothing to refresh to).
//
// No contact/tag/sequence-specific UI logic belongs in this file.

import { db, engagebayConnectionTable, type EngageBayConnection } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSecretValue } from "./azure-keyvault.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.engagebay" });

export const ENGAGEBAY_API_BASE = process.env.ENGAGEBAY_API_BASE_URL ?? "https://app.engagebay.com";

/** The single MSP this integration serves today (single-tenant, shaped for later). */
export const ENGAGEBAY_DEFAULT_MSP_ID = 1;

/** Deterministic Key Vault secret name for an MSP's EngageBay API key. */
export function engagebayApiKeySecretName(mspId: number): string {
  return `msp-${mspId}-engagebay-api-key`;
}

export class EngageBayNotConnectedError extends Error {
  constructor(message = "EngageBay is not connected — POST an API key to /api/engagebay/connect first") {
    super(message);
    this.name = "EngageBayNotConnectedError";
  }
}

export class EngageBayApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `EngageBay API responded ${status}`);
    this.name = "EngageBayApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Endpoint the #104 audit could not confirm against github.com/engagebay/restapi
 * or EngageBay's docs — no sequence-list or sequence-membership-read endpoint
 * appears anywhere in the reference. Rather than hardcode a guessed path, calls
 * fail loudly with this error until a real endpoint is verified (live test call
 * or an updated API reference) and the method is implemented for real.
 */
export class EngageBayUnverifiedEndpointError extends Error {
  constructor(operation: string) {
    super(
      `EngageBay ${operation} has no confirmed REST endpoint — verify against a live account or ` +
        `an updated github.com/engagebay/restapi reference before implementing`,
    );
    this.name = "EngageBayUnverifiedEndpointError";
  }
}

export async function getEngageBayConnection(
  mspId: number = ENGAGEBAY_DEFAULT_MSP_ID,
): Promise<EngageBayConnection | null> {
  const [row] = await db
    .select()
    .from(engagebayConnectionTable)
    .where(eq(engagebayConnectionTable.mspId, mspId))
    .limit(1);
  return row ?? null;
}

async function markConnectionError(mspId: number, message: string): Promise<void> {
  await db
    .update(engagebayConnectionTable)
    .set({ status: "error", lastErrorMessage: message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(engagebayConnectionTable.mspId, mspId))
    .catch((err: unknown) => {
      log.warn({ err, mspId }, "engagebay-client: failed to record connection error state (non-fatal)");
    });
}

// The key is static, so there is nothing to refresh — this cache only exists
// to avoid a Key Vault round trip on every single API call.
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const apiKeyCache = new Map<number, { key: string; cachedAt: number }>();

export function clearEngageBayApiKeyCache(mspId?: number): void {
  if (mspId === undefined) apiKeyCache.clear();
  else apiKeyCache.delete(mspId);
}

async function getEngageBayApiKey(mspId: number): Promise<string> {
  const cached = apiKeyCache.get(mspId);
  if (cached && Date.now() - cached.cachedAt < API_KEY_CACHE_TTL_MS) {
    return cached.key;
  }

  const connection = await getEngageBayConnection(mspId);
  if (!connection || connection.status === "disconnected") {
    throw new EngageBayNotConnectedError();
  }

  let key: string;
  try {
    key = await getSecretValue(connection.keyVaultSecretName);
  } catch (err) {
    await markConnectionError(mspId, `Key Vault read failed: ${String(err)}`);
    throw new Error(`Could not read EngageBay API key from Key Vault (${connection.keyVaultSecretName}): ${String(err)}`);
  }

  apiKeyCache.set(mspId, { key, cachedAt: Date.now() });
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EngageBayRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  mspId?: number;
  /** Content-Type for the request body; EngageBay's tag endpoints want form-encoded. */
  bodyEncoding?: "json" | "form";
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Low-level request against app.engagebay.com. `path` starts with `/` (e.g.
 * `/dev/api/panel/tags`). Retries on 429/5xx with exponential backoff up to
 * MAX_RETRY_ATTEMPTS; a 401 marks the connection "error" and throws immediately
 * (a bad key never becomes good by retrying).
 */
export async function engagebayFetch(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: EngageBayRequestOptions = {},
): Promise<unknown> {
  const mspId = opts.mspId ?? ENGAGEBAY_DEFAULT_MSP_ID;
  const key = await getEngageBayApiKey(mspId);

  const url = new URL(`${ENGAGEBAY_API_BASE}${path}`);
  for (const [k, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(k, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: key,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    if (opts.bodyEncoding === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.body as Record<string, string>).toString();
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }

  let lastErr: EngageBayApiError | undefined;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url.toString(), { method, headers, body });

    if (res.status === 401) {
      const responseBody = await res.json().catch(() => ({}));
      await markConnectionError(mspId, `EngageBay rejected the stored API key (401)`);
      clearEngageBayApiKeyCache(mspId);
      log.warn({ mspId, path }, "engagebay-client: 401 — stored API key is invalid");
      throw new EngageBayApiError(401, responseBody, `EngageBay ${method} ${path} failed: invalid API key`);
    }

    if (res.status === 204) return {};

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRY_ATTEMPTS) {
      const responseBody = await res.json().catch(() => ({}));
      lastErr = new EngageBayApiError(res.status, responseBody, `EngageBay ${method} ${path} failed with ${res.status}`);
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      log.warn({ mspId, path, status: res.status, attempt, delay }, "engagebay-client: retryable failure — backing off");
      await sleep(delay);
      continue;
    }

    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.warn({ mspId, path, status: res.status }, "engagebay-client: API request failed");
      throw new EngageBayApiError(res.status, responseBody, `EngageBay ${method} ${path} failed with ${res.status}`);
    }
    return responseBody;
  }

  throw lastErr ?? new EngageBayApiError(0, null, `EngageBay ${method} ${path} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
}

export async function engagebayGet(
  path: string,
  query?: Record<string, string | number | undefined>,
  mspId?: number,
): Promise<unknown> {
  return engagebayFetch("GET", path, { query, mspId });
}

export async function engagebayPost(
  path: string,
  body: unknown,
  mspId?: number,
  bodyEncoding: "json" | "form" = "json",
): Promise<unknown> {
  return engagebayFetch("POST", path, { body, mspId, bodyEncoding });
}

export async function engagebayPut(
  path: string,
  body: unknown,
  mspId?: number,
): Promise<unknown> {
  return engagebayFetch("PUT", path, { body, mspId });
}

// ── Contacts ──────────────────────────────────────────────────────────────────
// Paths confirmed against github.com/engagebay/restapi (README.md, §1.x).

export interface EngageBayContactInput {
  email: string;
  name?: string;
  properties?: Record<string, unknown>;
  tags?: Array<{ tag: string }>;
}

/** POST /dev/api/panel/subscribers/subscriber — create a contact. */
export async function createContact(input: EngageBayContactInput, mspId?: number): Promise<unknown> {
  return engagebayPost("/dev/api/panel/subscribers/subscriber", input, mspId);
}

/**
 * PUT /dev/api/panel/subscribers/update-partial — update a contact.
 * EngageBay's own docs note this cannot update lead score, star value, or
 * tags — those go through their own dedicated endpoints (addTag below).
 */
export async function updateContact(
  input: EngageBayContactInput & { id: string | number },
  mspId?: number,
): Promise<unknown> {
  return engagebayPut("/dev/api/panel/subscribers/update-partial", input, mspId);
}

/** GET /dev/api/panel/subscribers/{id} — fetch one contact by id. */
export async function getContact(contactId: string | number, mspId?: number): Promise<unknown> {
  return engagebayGet(`/dev/api/panel/subscribers/${encodeURIComponent(String(contactId))}`, undefined, mspId);
}

/** GET /dev/api/panel/subscribers/contact-by-email/{email} — fetch one contact by email. */
export async function getContactByEmail(email: string, mspId?: number): Promise<unknown> {
  return engagebayGet(`/dev/api/panel/subscribers/contact-by-email/${encodeURIComponent(email)}`, undefined, mspId);
}

/** GET /dev/api/search?q=&type=Subscriber — search/list contacts. */
export async function listContacts(query: string, mspId?: number): Promise<unknown> {
  return engagebayGet("/dev/api/search", { q: query, type: "Subscriber" }, mspId);
}

/** Alias of listContacts — EngageBay's search endpoint is the same for list and search. */
export async function searchContacts(query: string, mspId?: number): Promise<unknown> {
  return listContacts(query, mspId);
}

// ── Tags ──────────────────────────────────────────────────────────────────────

/** POST /dev/api/panel/subscribers/contact/tags/add2/{contactId} — add a tag to a contact. */
export async function addTag(contactId: string | number, tag: string, mspId?: number): Promise<unknown> {
  return engagebayPost(
    `/dev/api/panel/subscribers/contact/tags/add2/${encodeURIComponent(String(contactId))}`,
    { tags: [{ tag }] },
    mspId,
  );
}

/** GET /dev/api/panel/tags — list all tags in the account. */
export async function listTags(mspId?: number): Promise<unknown> {
  return engagebayGet("/dev/api/panel/tags", undefined, mspId);
}

// ── Sequences ─────────────────────────────────────────────────────────────────

/**
 * POST /dev/api/panel/subscribers/add-subscriber-to-sequence/{email}/{sequenceId}
 * — enrolls a contact into a sequence. Confirmed via the repo's worked curl
 * example (the section header renders the two path segments without a slash,
 * but the example itself is slash-separated — treated as authoritative).
 */
export async function startSequence(email: string, sequenceId: string | number, mspId?: number): Promise<unknown> {
  return engagebayPost(
    `/dev/api/panel/subscribers/add-subscriber-to-sequence/${encodeURIComponent(email)}/${encodeURIComponent(String(sequenceId))}`,
    undefined,
    mspId,
  );
}

/**
 * UNVERIFIED — no sequence-list endpoint exists in github.com/engagebay/restapi.
 * "Tracks" (`/dev/api/panel/tracks`) is a distinct deal-pipeline resource, not
 * marketing sequences; do not substitute it. Verify against a live account
 * before implementing.
 */
export async function listSequences(_mspId?: number): Promise<never> {
  throw new EngageBayUnverifiedEndpointError("listSequences");
}

/**
 * UNVERIFIED — no read-side counterpart to startSequence's "add to sequence"
 * exists in github.com/engagebay/restapi. Verify against a live account
 * before implementing.
 */
export async function getSequenceMembership(_contactId: string | number, _mspId?: number): Promise<never> {
  throw new EngageBayUnverifiedEndpointError("getSequenceMembership");
}
