// Zoho base API client (Zoho Integration Foundation, #82).
//
// Generic layer every Zoho product integration (CRM #83, Projects, Books,
// Tickets) builds on. Owns access-token lifecycle: the long-lived refresh
// token lives in Azure Key Vault (name on zoho_connection.keyVaultSecretName),
// the hourly access token is cached on the zoho_connection row itself and
// refreshed here when expired. On a 401 the request is retried exactly once
// after a forced refresh, then the error is thrown.
//
// No CRM-specific logic belongs in this file.

import { db, zohoConnectionTable, type ZohoConnection } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSecretValue } from "./azure-keyvault.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.zoho" });

export const ZOHO_API_BASE = process.env.ZOHO_API_BASE_URL ?? "https://www.zohoapis.com";
export const ZOHO_ACCOUNTS_BASE = process.env.ZOHO_ACCOUNTS_BASE_URL ?? "https://accounts.zoho.com";

/** The single MSP this integration serves today (single-tenant, shaped for later). */
export const ZOHO_DEFAULT_MSP_ID = 1;

/** Deterministic Key Vault secret name for an MSP's Zoho refresh token. */
export function zohoRefreshTokenSecretName(mspId: number): string {
  return `msp-${mspId}-zoho-refresh-token`;
}

export function zohoCredentialsPresent(): boolean {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

export class ZohoNotConnectedError extends Error {
  constructor(message = "Zoho is not connected — complete the OAuth flow at /api/zoho/auth/start first") {
    super(message);
    this.name = "ZohoNotConnectedError";
  }
}

export class ZohoApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Zoho API responded ${status}`);
    this.name = "ZohoApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Pure expiry check for the cached access token. A skew window (default 60s)
 * treats tokens about to expire as already expired so an in-flight request
 * never presents a token that dies mid-call.
 */
export function isZohoAccessTokenExpired(
  expiresAt: Date | null,
  nowMs: number,
  skewMs = 60_000,
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - skewMs <= nowMs;
}

export async function getZohoConnection(
  mspId: number = ZOHO_DEFAULT_MSP_ID,
): Promise<ZohoConnection | null> {
  const [row] = await db
    .select()
    .from(zohoConnectionTable)
    .where(eq(zohoConnectionTable.mspId, mspId))
    .limit(1);
  return row ?? null;
}

interface ZohoTokenResponse {
  access_token?: string;
  expires_in?: number;
  api_domain?: string;
  error?: string;
}

/**
 * Refreshes the access token using the Key Vault refresh token, updates the
 * connection row's cache, and returns the fresh access token. Marks the
 * connection status "error" (with lastErrorMessage) on failure, "connected"
 * on success.
 */
async function refreshZohoAccessToken(connection: ZohoConnection): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set");
  }

  let refreshToken: string;
  try {
    refreshToken = await getSecretValue(connection.keyVaultSecretName);
  } catch (err) {
    await markConnectionError(connection.mspId, `Key Vault read failed: ${String(err)}`);
    throw new Error(`Could not read Zoho refresh token from Key Vault (${connection.keyVaultSecretName}): ${String(err)}`);
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const body = (await res.json().catch(() => ({}))) as ZohoTokenResponse;
  if (!res.ok || !body.access_token) {
    const reason = body.error ?? `HTTP ${res.status}`;
    await markConnectionError(connection.mspId, `Token refresh failed: ${reason}`);
    log.error({ mspId: connection.mspId, status: res.status, reason }, "zoho-client: access token refresh failed");
    throw new ZohoApiError(res.status, body, `Zoho token refresh failed: ${reason}`);
  }

  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
  await db
    .update(zohoConnectionTable)
    .set({
      accessTokenCache: body.access_token,
      accessTokenExpiresAt: expiresAt,
      lastRefreshedAt: new Date(),
      status: "connected",
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(zohoConnectionTable.mspId, connection.mspId));

  log.info({ mspId: connection.mspId, expiresAt }, "zoho-client: access token refreshed");
  return body.access_token;
}

async function markConnectionError(mspId: number, message: string): Promise<void> {
  await db
    .update(zohoConnectionTable)
    .set({ status: "error", lastErrorMessage: message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(zohoConnectionTable.mspId, mspId))
    .catch((err: unknown) => {
      log.warn({ err, mspId }, "zoho-client: failed to record connection error state (non-fatal)");
    });
}

/**
 * Returns a valid access token for the MSP's Zoho connection, refreshing via
 * the Key Vault refresh token when the cached one is expired (or when
 * forceRefresh is set, e.g. after a 401).
 */
export async function getZohoAccessToken(
  mspId: number = ZOHO_DEFAULT_MSP_ID,
  forceRefresh = false,
): Promise<string> {
  const connection = await getZohoConnection(mspId);
  if (!connection || connection.status === "disconnected") {
    throw new ZohoNotConnectedError();
  }
  if (
    !forceRefresh &&
    connection.accessTokenCache &&
    !isZohoAccessTokenExpired(connection.accessTokenExpiresAt, Date.now())
  ) {
    return connection.accessTokenCache;
  }
  return refreshZohoAccessToken(connection);
}

export interface ZohoRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  mspId?: number;
}

/**
 * Low-level request against www.zohoapis.com. `path` starts with `/` (e.g.
 * `/crm/v8/Leads`). On a 401 the token is force-refreshed and the request
 * retried exactly once; any further failure throws ZohoApiError.
 */
export async function zohoFetch(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: ZohoRequestOptions = {},
): Promise<Record<string, unknown>> {
  const mspId = opts.mspId ?? ZOHO_DEFAULT_MSP_ID;

  const url = new URL(`${ZOHO_API_BASE}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const doRequest = async (token: string): Promise<Response> =>
    fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  let token = await getZohoAccessToken(mspId);
  let res = await doRequest(token);

  if (res.status === 401) {
    log.info({ mspId, path }, "zoho-client: 401 — refreshing token and retrying once");
    token = await getZohoAccessToken(mspId, true);
    res = await doRequest(token);
  }

  // Zoho returns 204 for empty result sets on list/search endpoints.
  if (res.status === 204) return {};

  const responseBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    log.warn({ mspId, path, status: res.status }, "zoho-client: API request failed");
    throw new ZohoApiError(res.status, responseBody, `Zoho ${method} ${path} failed with ${res.status}`);
  }
  return responseBody;
}

export async function zohoGet(
  path: string,
  query?: Record<string, string | number | undefined>,
  mspId?: number,
): Promise<Record<string, unknown>> {
  return zohoFetch("GET", path, { query, mspId });
}

export async function zohoPost(
  path: string,
  body: unknown,
  mspId?: number,
): Promise<Record<string, unknown>> {
  return zohoFetch("POST", path, { body, mspId });
}

export async function zohoPut(
  path: string,
  body: unknown,
  mspId?: number,
): Promise<Record<string, unknown>> {
  return zohoFetch("PUT", path, { body, mspId });
}
