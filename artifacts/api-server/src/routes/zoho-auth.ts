// Zoho OAuth routes (Zoho Integration Foundation, #82).
//
//   GET /api/zoho/auth/start    — admin-gated; redirects to Zoho's consent URL
//   GET /api/zoho/auth/callback — exchanges code for tokens; refresh token goes
//                                 to Key Vault, access token to the row cache
//   GET /api/zoho/auth/status   — connection status for the Admin Panel
//                                 (never returns token values)
//
// Single-tenant: everything binds to MSP #1 (ZOHO_DEFAULT_MSP_ID).
// The callback is a plain browser redirect from Zoho and cannot carry a Bearer
// token, so it is gated by a single-use `state` nonce minted by the admin-gated
// /start route instead.
//
// Env: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI,
//      optional ZOHO_OAUTH_SCOPES / ZOHO_ACCOUNTS_BASE_URL / ZOHO_API_BASE_URL.

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, zohoConnectionTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { setSecretValue } from "../lib/azure-keyvault.ts";
import {
  ZOHO_ACCOUNTS_BASE,
  ZOHO_API_BASE,
  ZOHO_DEFAULT_MSP_ID,
  zohoCredentialsPresent,
  zohoRefreshTokenSecretName,
} from "../lib/zoho-client.ts";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.zoho" });

const router: IRouter = Router();

// #1162: the connection was originally authorized with CRM-only scopes, so
// every Zoho Desk call 403'd with SCOPE_MISMATCH once the base-URL bug (fixed
// same issue) stopped masking it as a 404. First attempt at this used a
// "ZohoDesk." prefix (matching ZohoCRM/ZohoBooks/ZohoProjects) and Zoho
// rejected it outright as "Invalid OAuth Scope" -- Desk breaks that
// convention and uses a bare "Desk." prefix instead (confirmed against
// Zoho's own Desk OAuth SDK docs). Desk.tickets.ALL covers ticket
// create/read/comment, Desk.contacts.ALL covers contact find-or-create,
// Desk.basic.READ covers /organizations, Desk.search.READ covers the
// contacts/search lookup zoho-desk.ts's findDeskContactByEmail() uses.
//
// Same gap confirmed live for Books and Projects while fixing Desk: neither
// was ever granted its own scope either (zoho_connection.zoho_books_org_id
// has never been populated; 18 real zoho_books_create_expense jobs on file,
// none have ever reached a real Zoho Books API call to prove/disprove scope
// -- they've all short-circuited on the separate, unrelated missing
// ZOHO_BOOKS_AI_EXPENSE_ACCOUNT_ID env var). Adding both scopes now so a
// single re-consent covers CRM/Desk/Books/Projects instead of yet another
// round trip whenever Books' env var gets configured and this would
// otherwise resurface as its own SCOPE_MISMATCH.
const DEFAULT_SCOPES =
  "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.org.READ," +
  "Desk.tickets.ALL,Desk.contacts.ALL,Desk.basic.READ,Desk.search.READ," +
  "ZohoBooks.fullaccess.all,ZohoProjects.projects.ALL";

// Single-use CSRF nonces minted by /start; the callback consumes them. The
// admin gate on /start is what makes possession of a live nonce an
// authorization proof on the (Bearer-less) callback redirect.
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, number>();

function mintState(): string {
  // Opportunistic sweep so abandoned flows don't accumulate forever.
  const now = Date.now();
  for (const [state, createdAt] of pendingStates) {
    if (now - createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, now);
  return state;
}

function consumeState(state: string | undefined): boolean {
  if (!state || !pendingStates.has(state)) return false;
  const createdAt = pendingStates.get(state)!;
  pendingStates.delete(state);
  return Date.now() - createdAt <= STATE_TTL_MS;
}

router.get("/zoho/auth/start", requireAdmin, (req: Request, res: Response) => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(503).json({ error: "ZOHO_CLIENT_ID and ZOHO_REDIRECT_URI must be configured" });
    return;
  }

  const url = new URL(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", process.env.ZOHO_OAUTH_SCOPES ?? DEFAULT_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  // offline + consent is what makes Zoho issue a refresh token
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", mintState());

  log.info({ userId: req.user?.id }, "zoho-auth: starting OAuth consent flow");

  // The Admin Panel calls this route via fetch (which must carry a Bearer
  // token, since requireAdmin has no cookie fallback) rather than a bare
  // <a href>, so it can't just be redirected to by the browser directly. It
  // asks for JSON and does the navigation itself with the URL below.
  if (req.headers.accept?.includes("application/json")) {
    res.json({ authUrl: url.toString() });
    return;
  }
  res.redirect(url.toString());
});

interface ZohoTokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_domain?: string;
  error?: string;
}

router.get("/zoho/auth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!consumeState(state)) {
    res.status(403).json({ error: "Invalid or expired OAuth state — restart from /api/zoho/auth/start" });
    return;
  }
  if (!code) {
    res.status(400).json({ error: `Zoho returned no authorization code${req.query.error ? ` (${String(req.query.error)})` : ""}` });
    return;
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(503).json({ error: "Zoho OAuth env vars are not configured" });
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as ZohoTokenExchangeResponse;

    if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) {
      const reason = tokens.error ?? `HTTP ${tokenRes.status}`;
      log.error({ status: tokenRes.status, reason }, "zoho-auth: code exchange failed");
      res.status(502).json({ error: `Zoho token exchange failed: ${reason}` });
      return;
    }

    // Refresh token (long-lived, sensitive) → Key Vault only.
    const secretName = zohoRefreshTokenSecretName(ZOHO_DEFAULT_MSP_ID);
    try {
      await setSecretValue(secretName, tokens.refresh_token, {
        mspId: String(ZOHO_DEFAULT_MSP_ID),
        purpose: "zoho-refresh-token",
      });
    } catch (err) {
      log.error({ err }, "zoho-auth: failed to store refresh token in Key Vault");
      res.status(503).json({ error: "Could not store the Zoho refresh token in Azure Key Vault. Connection was not saved." });
      return;
    }

    // Zoho's org id is not in the token response — fetch it best-effort with
    // the fresh access token; a null org id never fails the connect.
    let zohoOrgId: string | null = null;
    try {
      const orgRes = await fetch(`${ZOHO_API_BASE}/crm/v8/org`, {
        headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
      });
      if (orgRes.ok) {
        const orgBody = (await orgRes.json()) as { org?: Array<{ zgid?: string; id?: string }> };
        const org = orgBody.org?.[0];
        zohoOrgId = org?.zgid ?? (org?.id != null ? String(org.id) : null);
      }
    } catch (err) {
      log.warn({ err }, "zoho-auth: could not fetch Zoho org id (non-fatal)");
    }

    const now = new Date();
    const accessTokenExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    await db
      .insert(zohoConnectionTable)
      .values({
        mspId: ZOHO_DEFAULT_MSP_ID,
        zohoOrgId,
        keyVaultSecretName: secretName,
        accessTokenCache: tokens.access_token,
        accessTokenExpiresAt,
        status: "connected",
        connectedAt: now,
        lastRefreshedAt: now,
        lastErrorMessage: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: zohoConnectionTable.mspId,
        set: {
          zohoOrgId,
          keyVaultSecretName: secretName,
          accessTokenCache: tokens.access_token,
          accessTokenExpiresAt,
          status: "connected",
          connectedAt: now,
          lastRefreshedAt: now,
          lastErrorMessage: null,
          updatedAt: now,
        },
      });

    log.info({ mspId: ZOHO_DEFAULT_MSP_ID, zohoOrgId }, "zoho-auth: Zoho connected");
    res
      .status(200)
      .type("html")
      .send("<html><body><h2>Zoho connected</h2><p>You can close this tab and return to the Admin Panel.</p></body></html>");
  } catch (err) {
    log.error({ err }, "zoho-auth: callback failed");
    res.status(500).json({ error: "Zoho OAuth callback failed" });
  }
});

router.get("/zoho/auth/status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({
        status: zohoConnectionTable.status,
        zohoOrgId: zohoConnectionTable.zohoOrgId,
        connectedAt: zohoConnectionTable.connectedAt,
        lastRefreshedAt: zohoConnectionTable.lastRefreshedAt,
        lastErrorMessage: zohoConnectionTable.lastErrorMessage,
        accessTokenExpiresAt: zohoConnectionTable.accessTokenExpiresAt,
      })
      .from(zohoConnectionTable)
      .where(eq(zohoConnectionTable.mspId, ZOHO_DEFAULT_MSP_ID))
      .limit(1);

    res.json({
      credentialsConfigured: zohoCredentialsPresent(),
      connection: row ?? { status: "disconnected" },
    });
  } catch (err) {
    log.error({ err }, "zoho-auth: status read failed");
    res.status(500).json({ error: "Could not read Zoho connection status" });
  }
});

export default router;
