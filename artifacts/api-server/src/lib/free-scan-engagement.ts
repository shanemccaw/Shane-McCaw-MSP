/**
 * free-scan-engagement.ts — Git #1374 (Phase of Feature #1352, Free Scan).
 *
 * The server side of the Review step's persisted state: one
 * `free_scan_engagements` row per Free Scan Prospect (`tenants.id`), carrying
 * their scope selection, their signature and their payment lifecycle.
 *
 * ── Why the row is keyed on customerId, not on a checkout session ────────────
 * A Prospect reaches the Review screen through two real doors, and they are the
 * same engagement:
 *
 *   • the live flow, identified by the checkout `sessionId` the browser already
 *     holds (#1358's results route resolves identity the same way); and
 *   • the emailed return link (#1359), which has no checkout session at all.
 *
 * Keying on the checkout session would give one Prospect two engagements the
 * moment they came back through the emailed link. `checkoutSessionId` is
 * recorded when the live door is used, because Stripe metadata binds to it.
 *
 * ── The scope lock ───────────────────────────────────────────────────────────
 * Scope persists BEFORE signature — a Prospect sets scope, closes the tab, and
 * comes back to it. At signature the scope locks: `signedAt` non-null makes
 * every scope write a 409. That is enforced here, server-side, not by the
 * rail's own disabled state.
 *
 * ── What is never trusted from the caller ────────────────────────────────────
 * Prices. The request says WHICH phases and WHICH add-on tiers; every cent is
 * re-resolved from the Products Catalog by `buildFreeScanSow` on each read and
 * again at payment time. There is no amount field on any request body here.
 */

import {
  db,
  freeScanEngagementsTable,
  tenantsTable,
  checkoutSessionsTable,
  usersTable,
  type FreeScanEngagement,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  buildFreeScanSow,
  buildSowReference,
  FREE_SCAN_SOW_PHASES,
  FREE_SCAN_SOW_PHASE_SLUGS,
  type FreeScanSow,
  type FreeScanSowResult,
  type SowSelection,
} from "./free-scan-sow.ts";

/** The one Prospect a Review-step request is acting for, whichever door they came in by. */
export interface FreeScanActor {
  customerId: number;
  /** The live flow's checkout session, when that is the door used. */
  checkoutSessionId: string | null;
  /** Billing/receipt address. Never echoed back on any public response. */
  email: string | null;
  fullName: string | null;
  company: string | null;
}

/**
 * Resolve the billing identity behind a customerId for the return-link door,
 * which carries no checkout session. The Prospect's own shell user row (#1355,
 * `users.tenant_id = customerId`, `msp_role = 'free'`) is the only real source.
 */
export async function resolveProspectContact(
  customerId: number,
): Promise<{ email: string | null; fullName: string | null }> {
  const [user] = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.tenantId, customerId))
    .limit(1);
  return { email: user?.email ?? null, fullName: user?.name ?? null };
}

/** The checkout session's own billing details, for the live door. */
export async function resolveSessionContact(
  checkoutSessionId: string,
): Promise<{ email: string | null; fullName: string | null; company: string | null }> {
  const [row] = await db
    .select({
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
    })
    .from(checkoutSessionsTable)
    .where(eq(checkoutSessionsTable.id, checkoutSessionId))
    .limit(1);
  return { email: row?.email ?? null, fullName: row?.fullName ?? null, company: row?.company ?? null };
}

/**
 * Load this Prospect's engagement, creating it on first touch.
 *
 * The default scope is every phase selected — the document opens on full scope
 * and the Prospect narrows it, which is what the rail's "6 of 6 phases" default
 * states. Add-ons default to none taken: an add-on is an addition the customer
 * makes, never one they have to notice and remove.
 */
export async function loadOrCreateEngagement(actor: FreeScanActor): Promise<FreeScanEngagement> {
  const [existing] = await db
    .select()
    .from(freeScanEngagementsTable)
    .where(eq(freeScanEngagementsTable.customerId, actor.customerId))
    .limit(1);

  if (existing) {
    // Record the live door's session the first time it is seen, so a payment
    // started from the live flow can bind its Stripe metadata to a real session.
    if (actor.checkoutSessionId && existing.checkoutSessionId !== actor.checkoutSessionId) {
      const [updated] = await db
        .update(freeScanEngagementsTable)
        .set({ checkoutSessionId: actor.checkoutSessionId, updatedAt: new Date() })
        .where(eq(freeScanEngagementsTable.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [tenant] = await db
    .select({ customerName: tenantsTable.customerName })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, actor.customerId))
    .limit(1);

  const reference = buildSowReference(tenant?.customerName?.trim() || "your tenant", new Date());

  const [created] = await db
    .insert(freeScanEngagementsTable)
    .values({
      customerId: actor.customerId,
      checkoutSessionId: actor.checkoutSessionId,
      sowReference: reference,
      selectedPhaseSlugs: [...FREE_SCAN_SOW_PHASE_SLUGS],
      selectedAddons: [],
      paymentPlan: "full",
    })
    .onConflictDoNothing({ target: freeScanEngagementsTable.customerId })
    .returning();

  if (created) return created;

  // Lost a race with a concurrent first touch — read the winner's row.
  const [raced] = await db
    .select()
    .from(freeScanEngagementsTable)
    .where(eq(freeScanEngagementsTable.customerId, actor.customerId))
    .limit(1);
  if (!raced) throw new Error("free-scan engagement: row vanished immediately after an insert conflict");
  return raced;
}

/** The selection an engagement row holds, normalised for `buildFreeScanSow`. */
export function selectionFromRow(row: FreeScanEngagement): SowSelection {
  const stored = Array.isArray(row.selectedPhaseSlugs) ? row.selectedPhaseSlugs : [];
  const phaseSlugs = FREE_SCAN_SOW_PHASE_SLUGS.filter((slug) => stored.includes(slug));
  // Phase 1 is required and is re-asserted here as well as in the builder: a row
  // hand-edited in the database must not be able to produce a SOW without it.
  const required = FREE_SCAN_SOW_PHASES[0]!.slug;
  if (!phaseSlugs.includes(required)) phaseSlugs.unshift(required);
  const addons = Array.isArray(row.selectedAddons) ? row.selectedAddons : [];
  return {
    phaseSlugs,
    addons: addons.filter(
      (a): a is { key: string; serviceSlug: string } =>
        !!a && typeof a.key === "string" && typeof a.serviceSlug === "string",
    ),
    paymentPlan: row.paymentPlan === "phased" ? "phased" : "full",
  };
}

/**
 * The SOW for one engagement row.
 *
 * Once signed, the document is READ BACK from `signedSowSnapshot` rather than
 * recomputed — a later scan, or a catalog price edit, must not silently restate
 * a document the customer has already signed. Only the payment lifecycle
 * (`status`) is refreshed over the snapshot.
 */
export async function sowForEngagement(row: FreeScanEngagement): Promise<FreeScanSowResult> {
  const signature = {
    signed: row.signedAt !== null,
    signedAt: row.signedAt ? row.signedAt.toISOString() : null,
    signerName: row.signerName,
    signerRole: row.signerRole,
  };

  if (row.signedAt && row.signedSowSnapshot) {
    const snapshot = row.signedSowSnapshot as FreeScanSow;
    return { status: "ready", sow: { ...snapshot, signature, status: row.status } };
  }

  return buildFreeScanSow(row.customerId, selectionFromRow(row), {
    reference: row.sowReference,
    signature,
    status: row.status,
  });
}

/** Validate a requested scope against the real catalog structure. */
export function normaliseRequestedSelection(input: {
  phaseSlugs: string[];
  addons: Array<{ key: string; serviceSlug: string }>;
  paymentPlan: "full" | "phased";
}): { phaseSlugs: string[]; addons: Array<{ key: string; serviceSlug: string }>; paymentPlan: "full" | "phased" } {
  const required = FREE_SCAN_SOW_PHASES[0]!.slug;
  const phaseSlugs = FREE_SCAN_SOW_PHASE_SLUGS.filter(
    (slug) => slug === required || input.phaseSlugs.includes(slug),
  );
  // Deduplicate by add-on key — one tier per add-on, last write wins.
  const byKey = new Map<string, string>();
  for (const a of input.addons) byKey.set(a.key, a.serviceSlug);
  return {
    phaseSlugs,
    addons: [...byKey].map(([key, serviceSlug]) => ({ key, serviceSlug })),
    paymentPlan: input.paymentPlan,
  };
}

/** The Stripe idempotency-key seed for an engagement's charge. */
export function chargeShapeKey(row: FreeScanEngagement, amountCents: number, hasCustomer: boolean): string {
  return [
    row.id,
    row.paymentPlan,
    amountCents,
    hasCustomer ? "cust" : "anon",
    (row.selectedPhaseSlugs ?? []).join("+"),
    (row.selectedAddons ?? []).map((a) => `${a.key}:${a.serviceSlug}`).join("+"),
  ].join("|");
}

