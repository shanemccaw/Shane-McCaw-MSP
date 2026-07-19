/**
 * first-login-provisioning.ts
 *
 * The general "first-company-login provisioning" bundle. This is deliberately
 * role-agnostic: it is the single place a customer's one-time, account-level
 * setup fires when they first reach the portal, and is meant to be called from
 * any first-login context (the Assessment wizard today; other roles' first-login
 * flows later) — not inlined into one page.
 *
 * Firing rule (enforced by the caller): payment OR first login, whichever
 * happens first — never on consent alone. The existing payment path
 * (portal.ts → provisionOnboardingProject) already calls provisionClientSite on
 * checkout.session.completed; this module provides the *first-login* trigger for
 * that same provisioning, so a Free Assessment customer who never pays still
 * gets a site the moment they log in.
 *
 * Idempotency has two layers:
 *   1. Persistent — provisionClientSite() itself no-ops when the user already has
 *      users.sharepointSiteUrl set. This survives restarts and covers the case
 *      where payment already provisioned the site.
 *   2. In-flight — provisionClientSite() takes ~60s (Graph group creation + site
 *      polling) before it writes sharepointSiteUrl, so layer 1 cannot yet see it.
 *      A burst of first-login requests (React double-mount, rapid reloads, a
 *      background poll racing the mount) would each pass layer 1 and kick off a
 *      duplicate provisioning. The in-flight set below collapses that burst to a
 *      single run per user within this process's lifetime.
 *
 * Note: mandatory MFA enrollment — the other half of the first-login bundle — is
 * a user-driven action gated in the wizard UI against the existing MFA enrollment
 * endpoints (Authenticator + Passkey), not an automated server step, so it is not
 * fired here. This module owns the automated provisioning half.
 */

import { logger } from "./logger";

const log = logger.child({ channel: "tenant.provisioning" });

/** Users currently mid-provision in this process — see the in-flight idempotency note above. */
const inFlight = new Set<number>();

export interface FirstLoginProvisioningOpts {
  /** users.id of the customer logging in for the first time. */
  userId: number;
  /** Human-readable name for the SharePoint site (falls back handled by caller). */
  displayName: string;
}

/**
 * Run the first-login provisioning bundle for a user. Safe to call on every
 * first-login attempt — it collapses to at most one real provisioning run per
 * user thanks to the two idempotency layers described above. Never throws:
 * provisioning is best-effort and must not block the login/landing flow.
 */
export async function runFirstLoginProvisioning(opts: FirstLoginProvisioningOpts): Promise<void> {
  const { userId, displayName } = opts;

  if (inFlight.has(userId)) {
    log.info({ userId }, "first-login provisioning already in flight — skipping duplicate kick");
    return;
  }
  inFlight.add(userId);

  try {
    // Dynamic import mirrors the payment-path call site (portal.ts) and avoids a
    // static route→lib→route cycle at module load.
    const { provisionClientSite } = await import("../routes/admin-sharepoint.js");
    await provisionClientSite(userId, displayName, log);
    log.info({ userId }, "first-login provisioning completed");
  } catch (err) {
    // Best-effort: a provisioning failure must never break first login.
    log.warn({ err, userId }, "first-login provisioning failed (non-fatal)");
  } finally {
    inFlight.delete(userId);
  }
}
