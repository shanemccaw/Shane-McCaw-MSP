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
