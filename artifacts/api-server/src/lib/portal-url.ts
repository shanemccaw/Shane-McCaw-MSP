/**
 * Returns the canonical base URL for the client portal (no trailing slash).
 *
 * Priority:
 *   1. PORTAL_BASE_URL env var — explicit override, always wins
 *   2. REPLIT_DOMAINS — prefer custom domain > .replit.app > .replit.dev
 *   3. REPLIT_DEV_DOMAIN — last resort (dev workspace)
 *
 * Never use REPLIT_DEV_DOMAIN as the primary source: it is the permanent
 * workspace URL and is set in ALL environments (dev and production), so it
 * would produce dev links even when deployed.
 */
export function getPortalBaseUrl(): string {
  if (process.env.PORTAL_BASE_URL) return process.env.PORTAL_BASE_URL;

  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) return `https://${custom}/crm`;

  const replitApp = domains.find((d) => d.endsWith(".replit.app"));
  if (replitApp) return `https://${replitApp}/crm`;

  const replitDev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) return `https://${replitDev}/crm`;

  return "/crm";
}

/**
 * Domain selection shared by getPortalBaseUrl()/getMspPortalBaseUrl() — same
 * priority order, but WITHOUT an artifact suffix (/crm or /portal) appended.
 */
function getDomainBase(): string {
  if (process.env.PORTAL_BASE_URL) {
    return process.env.PORTAL_BASE_URL.replace(/\/crm\/?$/, "");
  }

  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) return `https://${custom}`;

  const replitApp = domains.find((d) => d.endsWith(".replit.app"));
  if (replitApp) return `https://${replitApp}`;

  const replitDev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) return `https://${replitDev}`;

  return "";
}

/**
 * Returns the base URL for the msp-portal artifact (/portal), NOT the CRM
 * artifact (/crm) that getPortalBaseUrl() targets. Use this for any link
 * meant to land a customer/client user in msp-portal — e.g. share links
 * for documents, SOWs, presentations.
 */
export function getMspPortalBaseUrl(): string {
  return `${getDomainBase()}/portal`;
}

/**
 * Returns the msp-portal artifact's URL WITH a trailing slash — for direct
 * browser navigation to the portal root (window.open, <a href>, redirect
 * Location). msp-portal's Vite dev server is configured with base="/portal/"
 * (BASE_PATH, see artifacts/msp-portal/.replit-artifact/artifact.toml) and its
 * base middleware only matches paths that already carry that trailing slash;
 * a request for the bare "/portal" (no further path segment) fails
 * `pathname.startsWith(base)` and gets Vite's own 404 ("did you mean to visit
 * /portal/ instead?") instead of the app (Git #622).
 *
 * getMspPortalBaseUrl() deliberately has NO trailing slash because nearly
 * every caller concatenates a further path (`${getMspPortalBaseUrl()}/security`),
 * where a trailing slash here would double up. Use this function instead only
 * when the URL itself is the final destination, with nothing appended.
 */
export function getMspPortalLandingUrl(): string {
  return `${getMspPortalBaseUrl()}/`;
}

/**
 * Builds the account-setup URL that lands in the msp-portal artifact
 * (/portal/account-setup), NOT in the CRM artifact (/crm).
 *
 * Do NOT use getPortalBaseUrl() for this — it always appends /crm and would
 * send new customers to the wrong artifact.
 */
export function buildAccountSetupUrl(token: string): string {
  return `${getMspPortalBaseUrl()}/account-setup?setup_token=${token}`;
}

/**
 * Git #415 — the live, authenticated Document Viewer URL headless Chromium
 * navigates for the real PDF export pipeline (see insight-pdf.ts's
 * `renderLiveDocumentToPdf`). `printToken` is single-use and consumed by
 * `AuthProvider`'s boot effect (msp-portal's auth-context.tsx) the same way
 * `?impersonation_token=...` is — there is no cookie-based session here to
 * bypass server-side, so the token must reach the SPA itself.
 */
export function buildPrintDocumentUrl(slug: string, documentId: number, printToken: string): string {
  return `${getMspPortalBaseUrl()}/${slug}/copilot-readiness/documents/${documentId}?printToken=${encodeURIComponent(printToken)}`;
}

/**
 * Git #1043 (Epic #660, Phase 1) — buildPrintDocumentUrl's sibling for a
 * live-rendered document (JOURNEY_LIVE_DOCUMENTS), which has no numeric id to
 * key the route on. `docPrintToken` is a deliberately distinct query param
 * from `printToken` (not a reused name) so AuthProvider's boot effect
 * (msp-portal's auth-context.tsx) can tell which token table to exchange
 * against without guessing from the URL shape.
 */
export function buildLiveDocumentPrintUrl(slug: string, docType: string, printToken: string): string {
  return `${getMspPortalBaseUrl()}/${slug}/copilot-readiness/documents/${encodeURIComponent(docType)}?docPrintToken=${encodeURIComponent(printToken)}`;
}
