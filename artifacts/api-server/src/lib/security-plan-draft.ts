/**
 * security-plan-draft.ts — the Security Plan's frozen-state draft (#1566, part of
 * #1495/#1485).
 *
 * #1566 fixes the authoring sequence: freeze assembled state -> write/revise prose
 * against that frozen state -> seal and sign as one version. "Not: write prose over a
 * live view and hope nothing moved." This module is that frozen holding pen — one
 * draft row per Security Plan `(mspId, customerId)`:
 *
 *   freezeSecurityPlanDraft   — assembles NOW (optionally scoped) and (re)captures the
 *                                frozen snapshot. First freeze for a plan also seeds
 *                                the carry-forward baseline from the plan's last
 *                                version's prose; a later re-freeze refreshes only
 *                                `frozenContent`, never touching `prose`/`baselineProse`
 *                                — an in-progress edit can never be clobbered by
 *                                refreshing the underlying assembly.
 *   getSecurityPlanDraft      — the current draft, or null if nothing has been frozen.
 *   updateSecurityPlanDraftProse — edits one section, diffed against `baselineProse`
 *                                (#1566: "mark what was edited in this version").
 *   deleteSecurityPlanDraft   — called by the seal route once a draft has been
 *                                consumed into a sealed version.
 */
import {
  db,
  mspSecurityPlanDraftsTable,
  type MspSecurityPlanDraft,
  type SecurityPlanContent,
  type SecurityPlanScope,
  type SecurityPlanProseSection,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { assembleSecurityPlan } from "./security-plan-assembly.ts";
import { getCurrentSecurityPlanVersion } from "./security-plan-versioning.ts";
import { carryForwardLegacyOrProse, applyProseEdit } from "./security-plan-prose.ts";
import type { TenantScope } from "./portal-customer-scope.ts";

/**
 * Freezes the assembled document into the plan's draft row, creating the draft if none
 * exists yet. On CREATE, seeds `baselineProse`/`prose` by carrying forward the plan's
 * current sealed version's prose (or an empty baseline if nothing has ever been
 * sealed). On an existing draft, only `frozenContent`/`frozenAt` are refreshed — the
 * author's in-progress prose (and its baseline) is left exactly as it was.
 */
export async function freezeSecurityPlanDraft(
  tenant: TenantScope,
  scope: SecurityPlanScope,
): Promise<MspSecurityPlanDraft> {
  // Freeze always assembles the HONEST document underneath so the frozen snapshot
  // itself carries no prose (prose lives in the draft's own prose columns, never
  // inside frozenContent) — assembleSecurityPlan's prose param defaults to null.
  const frozenContent: SecurityPlanContent = await assembleSecurityPlan(tenant, scope);
  const frozenAt = new Date();

  const [existing] = await db
    .select({ id: mspSecurityPlanDraftsTable.id })
    .from(mspSecurityPlanDraftsTable)
    .where(and(eq(mspSecurityPlanDraftsTable.mspId, tenant.mspId), eq(mspSecurityPlanDraftsTable.customerId, tenant.customerId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(mspSecurityPlanDraftsTable)
      .set({ frozenContent, frozenAt, updatedAt: frozenAt })
      .where(eq(mspSecurityPlanDraftsTable.id, existing.id))
      .returning();
    return updated;
  }

  const currentVersion = await getCurrentSecurityPlanVersion(tenant.mspId, tenant.customerId);
  const baselineProse = carryForwardLegacyOrProse(currentVersion?.content.prose ?? null);

  const [inserted] = await db
    .insert(mspSecurityPlanDraftsTable)
    .values({
      mspId: tenant.mspId,
      customerId: tenant.customerId,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      frozenContent,
      frozenAt,
      baselineProse,
      prose: baselineProse,
    })
    .returning();
  return inserted;
}

/** The current draft for a plan, or null if nothing has been frozen yet. */
export async function getSecurityPlanDraft(mspId: number, customerId: number): Promise<MspSecurityPlanDraft | null> {
  const [row] = await db
    .select()
    .from(mspSecurityPlanDraftsTable)
    .where(and(eq(mspSecurityPlanDraftsTable.mspId, mspId), eq(mspSecurityPlanDraftsTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

/**
 * Edits one prose section on the draft. `editedInThisVersion` is computed by
 * `applyProseEdit` against `baselineProse` — the carry-forward snapshot fixed at draft
 * creation — never against the section's own most recent edit. Returns null if no
 * draft exists yet (the caller must freeze first).
 */
export async function updateSecurityPlanDraftProse(
  mspId: number,
  customerId: number,
  section: SecurityPlanProseSection,
  text: string,
): Promise<MspSecurityPlanDraft | null> {
  const draft = await getSecurityPlanDraft(mspId, customerId);
  if (!draft) return null;

  const prose = applyProseEdit(draft.prose, draft.baselineProse, section, text);
  const [updated] = await db
    .update(mspSecurityPlanDraftsTable)
    .set({ prose, updatedAt: new Date() })
    .where(eq(mspSecurityPlanDraftsTable.id, draft.id))
    .returning();
  return updated;
}

/** Deletes the plan's draft. Called once a draft has been consumed into a sealed
 * version — the next authoring cycle starts from a fresh freeze. */
export async function deleteSecurityPlanDraft(mspId: number, customerId: number): Promise<void> {
  await db
    .delete(mspSecurityPlanDraftsTable)
    .where(and(eq(mspSecurityPlanDraftsTable.mspId, mspId), eq(mspSecurityPlanDraftsTable.customerId, customerId)));
}
