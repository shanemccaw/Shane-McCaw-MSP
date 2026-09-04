import { db, tenantsTable, mspsTable, usersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { sendAdminSms } from "./sms.ts";
import { convertLeadForClient } from "./crm-pipeline.ts";
import { createNotificationForAllAdmins } from "./notification-center.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.portal" });

/**
 * Extracted from portal.ts (#175, portal.ts route decommission) — this
 * direct-business tenant/account provisioning cluster is consumed externally
 * by consent.ts's OAuth callback (resolveOrCreateDirectTenant,
 * provisionProspectAccount) in addition to portal-onboarding.ts and the
 * (now-dead, dropped with portal.ts) Stripe webhook path. Kept together as
 * one module since the functions call each other.
 */

export async function ensureClientAccount(
  email: string,
  name?: string,
  scope?: { tenantId: number; mspId: number | null; mspRole: "Assessment" | "CustomerUser" },
): Promise<{ id: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  // Atomic upsert — if the email already exists the ON CONFLICT clause returns
  // the existing row without modifying anything, making this race-safe under
  // concurrent Stripe webhook + success-page double-firing.
  const [upserted] = await db
    .insert(usersTable)
    .values({
      email: normalizedEmail,
      role: "client",
      name: name?.trim() || undefined,
      ...(scope ? { tenantId: scope.tenantId, mspId: scope.mspId, mspRole: scope.mspRole } : {}),
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: { email: sql`EXCLUDED.email` }, // no-op — forces RETURNING to yield the existing row
    })
    .returning({ id: usersTable.id });
  return { id: upserted.id };
}

/**
 * Resolve-or-create the `tenants` row for a direct-business customer, keyed by
 * the real M365 tenant GUID. tenants.tenant_id is NOT NULL UNIQUE — a tenant
 * row CANNOT exist without a consented GUID, which is the schema-level form of
 * the consent-first rule (no account/tenant creation before M365 consent; #95).
 *
 * Business rule (unchanged): anyone who buys directly from the public website
 * is "active" immediately — there is no "onboarding" stage for direct
 * customers. (Contrast with MSP-channel customers, who start "onboarding" and
 * flip to "active" only once M365 consent is granted — see consent.ts.)
 *
 * Returns { id, mspId } of the tenants row, or null only in the genuine
 * no-isDirectBusiness-MSP-configured case (nothing to attach to).
 *
 * Exported for consent.ts's OAuth callback: consent now lives ON the tenants
 * row (tenants.consent jsonb, #99), so the row has to exist before a grant can
 * be stamped. The callback therefore calls this the moment Microsoft confirms
 * the GUID, and provisionProspectAccount's own call below then finds it — one
 * tenant-creation door, still consent-first.
 */
export async function resolveOrCreateDirectTenant(
  tenantGuid: string,
  fallbackCustomerName: string,
  industry?: string | null,
): Promise<{ id: number; mspId: number } | null> {
  const [existingByTenant] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantGuid))
    .limit(1);
  if (existingByTenant) return existingByTenant;

  const [directMsp] = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.isDirectBusiness, true))
    .limit(1);
  if (!directMsp) return null; // no MSP flagged isDirectBusiness=true — nothing to attach to

  const [created] = await db.insert(tenantsTable).values({
    mspId: directMsp.id,
    customerName: fallbackCustomerName,
    industry: industry ?? null,
    tenantId: tenantGuid,
    status: "active",
  })
    .onConflictDoNothing({ target: tenantsTable.tenantId }) // race-safe under the UNIQUE tenant_id
    .returning({ id: tenantsTable.id, mspId: tenantsTable.mspId });
  if (created) return created;

  // Conflict path: another request inserted this GUID between lookup and insert.
  const [raced] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantGuid))
    .limit(1);
  return raced ?? null;
}

/**
 * Resolves the tenants row for a direct-business buyer. Idempotent, in order:
 *   1. If this user is already linked to a tenant (users.tenantId), reuse it.
 *   2. Else if tenantId (M365 GUID) is provided, resolve-or-create the tenants
 *      row for it (e.g. from a retried/duplicate purchase attempt).
 *
 * A tenant can no longer be created WITHOUT a consented GUID (tenants.tenant_id
 * is NOT NULL UNIQUE — consent-first, #95/#103). Callers that used to reach
 * this with no GUID and get a bare "active" msp_customers row now get null;
 * the account-creation paths that relied on that were removed in Phase 2b.
 *
 * Returns the resolved/created tenants.id, or null when the user has no link
 * and no GUID was provided (or no isDirectBusiness MSP is configured).
 *
 * Must be called BEFORE ensureClientMspUser so its own tenantId lookup finds this row.
 */
async function ensureDirectCustomerRecord(userId: number, tenantId?: string | null): Promise<number | null> {
  const [buyer] = await db
    .select({ tenantId: usersTable.tenantId, name: usersTable.name, company: usersTable.company })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (buyer?.tenantId != null) return buyer.tenantId;

  if (!tenantId) return null;

  const tenant = await resolveOrCreateDirectTenant(
    tenantId,
    buyer?.company?.trim() || buyer?.name?.trim() || "Direct Customer",
  );
  return tenant?.id ?? null;
}

/**
 * Ensures the given client user's own row carries its tenant/MSP scope.
 * (msp_users was absorbed into `users` — Tenant/User Refactor #92 — so the old
 * "create the msp_users row" step is now "fill in the scope columns on the
 * user's own row".) Idempotent — a user already tenant-linked is never
 * re-pointed here.
 *
 * Scope resolution order (unchanged from the msp_users era):
 *   1. If explicitCustomerId (a tenants.id) is provided, use it directly (and
 *      look up its real owning mspId) — takes precedence over tenantId.
 *   2. Else if tenantId (M365 GUID) is provided and a tenants row matches it,
 *      use that tenant's id and mspId.
 *   3. Otherwise NO tenant is resolvable — and since tenant-scoped roles
 *      require users.tenant_id (users_role_scope_check), nothing can be
 *      linked. The old "default to mspId=1 with no customerId" bare bridge is
 *      gone on purpose: log at error level (consent-first was skipped
 *      upstream) and leave the user unscoped.
 *
 * desiredRole is applied only when the row is still at its wholly-unbridged
 * default (mspRole "Free", no mspId, no tenantId — i.e. what used to be "no
 * msp_users row exists yet"); an account already carrying an explicit role or
 * link is never role-patched here (promoteMspUserToCustomer owns upgrades).
 * Defaults to "CustomerUser", keeping the historical behavior.
 */
export async function ensureClientMspUser(
  userId: number,
  tenantId?: string | null,
  explicitCustomerId?: number | null,
  desiredRole?: "CustomerUser" | "Assessment",
): Promise<void> {
  // Resolve target mspId + tenants.id — explicitCustomerId takes precedence over tenantId.
  let mspId: number | null = null;
  let customerId: number | undefined = undefined;
  if (explicitCustomerId != null) {
    const [tenant] = await db
      .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, explicitCustomerId))
      .limit(1);
    if (tenant) {
      mspId = tenant.mspId;
      customerId = tenant.id;
    }
  } else if (tenantId) {
    const [tenant] = await db
      .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantId))
      .limit(1);
    if (tenant) {
      mspId = tenant.mspId;
      customerId = tenant.id;
    }
  }

  const [existing] = await db
    .select({ existingCustomerId: usersTable.tenantId, existingMspId: usersTable.mspId, existingRole: usersTable.mspRole })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!existing) return; // no users row at all — nothing to scope
  if (existing.existingCustomerId != null) return; // already tenant-linked — done

  if (customerId == null) {
    // No tenants row resolvable. users_role_scope_check makes a tenant-scoped
    // role without users.tenant_id impossible, so there is no bare-bridge
    // fallback anymore — a customer account reaching here means the
    // consent-first flow (provisionProspectAccount at M365-consent time) was
    // skipped upstream. Loud and greppable, never routine.
    log.error(
      { userId, tenantId: tenantId ?? null, explicitCustomerId: explicitCustomerId ?? null },
      "ensureClientMspUser: no tenants row resolvable — cannot link user to a tenant (consent-first flow skipped upstream?); leaving user unscoped",
    );
    return;
  }

  // Cross-MSP boundary backstop (defense in depth — the consent-time check in
  // consent.ts should reject this before payment; see "Reject cross-MSP tenant
  // consent conflicts"). If the resolved tenant belongs to a DIFFERENT MSP
  // than this user's existing msp_id, patching would link the user across the
  // tenant boundary and leak the other MSP's engine history/findings/SOWs
  // (confirmed live pre-refactor: user 92 mspId 89 → customer 1 mspId 1).
  // Refuse the patch, leave the tenant link untouched (null), and log at error
  // level for manual admin follow-up. This should never fire if the
  // consent-time guard is intact — treat any occurrence as a gap in that guard.
  if (existing.existingMspId != null && existing.existingMspId !== mspId) {
    log.error(
      {
        userId,
        tenantId,
        conflictingCustomerId: customerId,
        existingMspId: existing.existingMspId,
        resolvedMspId: mspId,
      },
      "ensureClientMspUser: REFUSED cross-MSP customerId patch — tenantId resolves to a customer under a different MSP than the user's existing msp_users row; leaving customerId unchanged (payment already succeeded, manual admin follow-up required)",
    );
    return;
  }

  // What used to be "no msp_users row yet → insert with desiredRole": post-
  // merge, a wholly-unbridged row (all three scope columns at their defaults)
  // is that same state, so it takes desiredRole; anything else keeps its role.
  const stillAtUnbridgedDefault = existing.existingRole === "Free" && existing.existingMspId == null;
  await db
    .update(usersTable)
    .set({
      tenantId: customerId,
      mspId: existing.existingMspId ?? mspId,
      ...(stillAtUnbridgedDefault ? { mspRole: desiredRole ?? "CustomerUser" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

/**
 * Provision a real, recoverable "Prospect" account at M365-consent time for the
 * direct-business self-service funnel — created BEFORE the customer sets a
 * password and BEFORE the free/paid split, so the account exists (and is
 * admin-recoverable via /auth/forgot-password) the instant consent is granted.
 *
 * Creates, idempotently and in order:
 *   1. a `tenants` row keyed by the consented tenant GUID (tenants.tenant_id
 *      is NOT NULL UNIQUE — the tenant must exist BEFORE the account can,
 *      because users_role_scope_check forbids a tenant-scoped users row with
 *      no tenant link; this is the schema-level consent-first rule), then
 *   2. a `users` row (role "client", passwordHash left NULL — no usable
 *      password yet; the customer sets one via the account-setup / password
 *      flow) stamped inline with tenantId/mspId and `role` — "Assessment" for
 *      the assessment funnel (promoted to "CustomerUser" on payment; see
 *      promoteMspUserToCustomer), else "CustomerUser".
 * It also converts the funnel-entry lead (name+email capture) new → converted.
 *
 * Reuses ensureClientAccount / ensureDirectCustomerRecord / ensureClientMspUser so
 * the downstream free-checkout (provisionFreeOnboarding) and paid Stripe webhook
 * paths find this account already linked and their own ensure* calls no-op. The
 * consent-time cross-MSP guard (consent.ts) has already rejected any tenant owned
 * by a different MSP before this runs, so the tenantId lookup here is safe.
 *
 * Returns { userId, customerId } or null only when email is missing.
 */
export async function provisionProspectAccount(opts: {
  email: string;
  fullName?: string | null;
  company?: string | null;
  industry?: string | null;
  tenantId?: string | null;
  role: "Assessment" | "CustomerUser";
}): Promise<{ userId: number; customerId: number | null } | null> {
  const email = opts.email?.toLowerCase().trim();
  if (!email) return null;

  // Consent-first inversion (#103): resolve/create the tenants row BEFORE the
  // users row, so a genuinely-new account can be inserted with its tenant
  // scope inline — users_role_scope_check rejects a bare row outright.
  // Company first (the tenant IS the company), personal name only as fallback.
  const tenant = opts.tenantId
    ? await resolveOrCreateDirectTenant(
        opts.tenantId,
        opts.company?.trim() || opts.fullName?.trim() || "Direct Customer",
        opts.industry,
      )
    : null;

  const acct = await ensureClientAccount(
    email,
    opts.fullName ?? undefined,
    tenant ? { tenantId: tenant.id, mspId: tenant.mspId, mspRole: opts.role } : undefined,
  );
  const userId = acct.id;

  let customerId: number | null = null;
  try {
    customerId = await ensureDirectCustomerRecord(userId, opts.tenantId ?? undefined);
    await ensureClientMspUser(userId, opts.tenantId ?? undefined, customerId, opts.role);
  } catch (err) {
    // error (not warn): a swallowed failure here leaves a users row with NO
    // tenant link — a fully non-functional account that can still complete a
    // paid checkout (confirmed live pre-refactor: "Seven Hundred",
    // users.id=21). The caller keeps going (idempotent retry happens on the
    // payment webhook, which verifies and alerts), but this is never routine.
    log.error({ err, userId, tenantId: opts.tenantId }, "provisionProspectAccount: ensure customer/msp_user FAILED — user exists without a customer bridge");
  }
  if (customerId == null) {
    log.error(
      { userId, tenantId: opts.tenantId },
      "provisionProspectAccount: no tenants id resolved for Prospect — account has no tenant link yet",
    );
  }

  // Funnel-entry lead (captured at name+email) transitions new → converted here.
  void convertLeadForClient(userId, email, opts.fullName ?? undefined);

  return { userId, customerId };
}

/**
 * Promote a funnel Prospect from the low-privilege "Assessment"/"Free" role up to
 * "CustomerUser" once payment is confirmed — this is what unlocks the full portal
 * (CustomerUser is the floor for the main portal; Assessment/Free sit below it).
 *
 * Idempotent and guarded: only rows currently at "Assessment" or "Free" are
 * touched, so an existing CustomerUser / MSPAdmin / etc. is never downgraded or
 * re-stamped, and re-delivered webhooks are safe. Non-fatal.
 */
export async function promoteMspUserToCustomer(userId: number): Promise<void> {
  try {
    await db
      .update(usersTable)
      .set({ mspRole: "CustomerUser", updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId), inArray(usersTable.mspRole, ["Assessment", "Free"])));
  } catch (err) {
    log.warn({ err, userId }, "promoteMspUserToCustomer: role promotion failed (non-fatal)");
  }
}

/**
 * Post-purchase verification that the msp_customers/msp_users bridge actually
 * exists for a buyer — the backstop that makes a silent bridge failure
 * impossible.
 *
 * Context: two real paid signups ("Jane Smith" users.id=9, "Seven Hundred"
 * users.id=21) completed real payment while every provisioning attempt
 * (consent-time provisionProspectAccount AND the webhook's ensure* calls)
 * failed with only warn-level logs — leaving a users row with no
 * msp_customers/msp_users record and a portal that shows "no data" everywhere.
 *
 * This function never throws and never blocks the purchase (the money has
 * already moved) — but when the bridge is missing it:
 *   1. logs at ERROR level with a stable, greppable message,
 *   2. creates a bell notification for every admin, and
 *   3. sends an admin SMS,
 * so a broken paid account is discovered in minutes, not on the customer's
 * first empty dashboard.
 *
 * Returns { ok, customerId } so callers can branch if they want to.
 */
export async function verifyCustomerBridge(
  userId: number,
  context: string,
): Promise<{ ok: boolean; customerId: number | null }> {
  try {
    const [link] = await db
      .select({ customerId: usersTable.tenantId, mspId: usersTable.mspId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (link?.customerId != null) return { ok: true, customerId: link.customerId };

    log.error(
      { userId, context, hasMspUsersRow: !!link, mspId: link?.mspId ?? null },
      "verifyCustomerBridge: completed signup has NO msp_customers/msp_users bridge — account is non-functional; manual admin repair required",
    );

    try {
      await createNotificationForAllAdmins({
        title: "URGENT: customer bridge missing after purchase",
        body: `User #${userId} completed ${context} but has no msp_customers/msp_users record — their portal will show no data. Manual repair required.`,
        category: "system",
        severity: "critical",
        linkPath: "/dashboard",
      });
    } catch (notifyErr) {
      log.error({ err: notifyErr, userId }, "verifyCustomerBridge: failed to create admin notifications for missing bridge");
    }

    sendAdminSms(
      `URGENT: user #${userId} completed ${context} with NO customer bridge - their portal is broken. Manual repair needed.`,
    ).catch((smsErr) => log.warn({ err: smsErr, userId }, "verifyCustomerBridge: SMS alert failed (bell notification + error log still fired)"));

    return { ok: false, customerId: null };
  } catch (err) {
    log.error({ err, userId, context }, "verifyCustomerBridge: verification query itself failed");
    return { ok: false, customerId: null };
  }
}
