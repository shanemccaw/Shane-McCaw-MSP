/**
 * policy-compliance-graph.ts — real per-tenant Graph reads backing the
 * `mailbox_attribute` compliance evaluator (#1553).
 *
 * THE OU-MEMBERSHIP GAP THIS WORKS AROUND
 * ────────────────────────────────────────
 * `active_directory_ous` (the #1547 attachment point a standing policy binds
 * to) is a bare id+name container with NO object-membership model — confirmed
 * by three independent, explicit prior notes across #1547/#1549/the OU CRUD
 * route ("no object-to-OU membership model", "policy semantics explicitly
 * undefined per Shane, reserved for a future version"). #1490's own settled
 * architecture comment says the model "needs no teaching because it is AD's
 * own" — i.e. don't invent a stored membership table.
 *
 * The real, documented Entra field that carries that exact concept for a
 * cloud-only tenant is `department` on `/users` — this session's own
 * resolution, disclosed rather than silently assumed (see the filed finding
 * and the #1553 bookend). A standing policy's OU `name` is matched against
 * each candidate tenant's real `department` value. This is a genuine
 * engineering decision, not a forced one; revisit if Shane settles on a
 * different real OU-sync model later.
 *
 * MANUAL OVERRIDE (#1952)
 * ─────────────────────────
 * Shane confirmed from real usage that most tenants don't populate `department`
 * at all, and where it is set it's often stale — the department-match guess
 * above stays as the primary/automatic resolution, but `active_directory_ou_assignments`
 * (Drizzle: `activeDirectoryOuAssignmentsTable`) now lets an admin explicitly
 * place a real Graph object in an OU. A manual row for an object ALWAYS wins:
 * it is included in its assigned OU's membership regardless of that object's
 * `department` value, and excluded from the department-match guess for every
 * OTHER OU (an object can only really belong to one OU at a time). An object
 * with no manual row falls through to the department-match guess unchanged.
 *
 * `group_membership` (#1953) reads real membership via Graph's own
 * `POST /users/{id}/checkMemberGroups` — one call per OU member, asking
 * Graph directly which of the policy's declared group ids that member is
 * actually (transitively) a member of. This is the correct-shaped Graph API
 * for exactly this question, rather than paging every declared group's
 * `/members` and intersecting client-side.
 *
 * `service_policy` still has no reader here — it likely needs Exchange
 * Online PowerShell (ps-execution) rather than a pure Graph read, and that
 * model hasn't been scoped for this config surface yet.
 * `policy-compliance.ts`'s `EVALUABLE_TARGET_KINDS` is the honest boundary.
 */

import { eq, and } from "drizzle-orm";
import { db, activeDirectoryOuAssignmentsTable } from "@workspace/db";
import { graphFetchForTenant } from "./graph";
import { isCsvReportResponse, parseCsvReport } from "./monitor-executor";
import { logger } from "./logger";
import type { MailboxComplianceObservation, GroupMembershipComplianceObservation } from "./policy-compliance";

const log = logger.child({ channel: "engine.dashboard" });

/** OData string literal escaping — a literal `'` inside the filter value must be doubled. */
function odataStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

interface OuMember {
  readonly id: string;
  readonly userPrincipalName: string;
  readonly displayName: string | null;
}

/** Every object manually assigned to THIS ou, for this customer's tenant (#1952). */
async function resolveManualOuMembers(ouId: number, customerId: number): Promise<OuMember[]> {
  const rows = await db
    .select({
      objectId: activeDirectoryOuAssignmentsTable.objectId,
      objectUpn: activeDirectoryOuAssignmentsTable.objectUpn,
      objectDisplayName: activeDirectoryOuAssignmentsTable.objectDisplayName,
    })
    .from(activeDirectoryOuAssignmentsTable)
    .where(and(eq(activeDirectoryOuAssignmentsTable.ouId, ouId), eq(activeDirectoryOuAssignmentsTable.customerId, customerId)));
  return rows.map((r) => ({ id: r.objectId, userPrincipalName: r.objectUpn, displayName: r.objectDisplayName ?? null }));
}

/** Every object manually assigned to ANY ou for this customer — excluded from every OTHER ou's department guess. */
async function resolveManuallyAssignedObjectIds(customerId: number): Promise<Set<string>> {
  const rows = await db
    .select({ objectId: activeDirectoryOuAssignmentsTable.objectId })
    .from(activeDirectoryOuAssignmentsTable)
    .where(eq(activeDirectoryOuAssignmentsTable.customerId, customerId));
  return new Set(rows.map((r) => r.objectId));
}

/**
 * Real members of the OU: manual assignments (#1952) first, then the
 * department-match guess for every object with no manual row at all.
 */
async function resolveOuMembers(tenantId: string, ouName: string, ouId: number, customerId: number): Promise<OuMember[]> {
  const [manualMembers, manuallyAssignedElsewhere] = await Promise.all([
    resolveManualOuMembers(ouId, customerId),
    resolveManuallyAssignedObjectIds(customerId),
  ]);

  const filter = `department eq '${odataStringLiteral(ouName)}'`;
  const res = await graphFetchForTenant(
    tenantId,
    `/users?$filter=${encodeURIComponent(filter)}&$select=id,userPrincipalName,displayName`,
    { headers: { ConsistencyLevel: "eventual" } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph /users department-filter error ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = (await res.json()) as { value?: Array<{ id: string; userPrincipalName: string; displayName: string | null }> };
  const departmentMembers = (body.value ?? [])
    .filter((u) => !manuallyAssignedElsewhere.has(u.id))
    .map((u) => ({ id: u.id, userPrincipalName: u.userPrincipalName, displayName: u.displayName ?? null }));

  if (manualMembers.length > 0) {
    log.info({ tenantId, ouId, ouName, manualCount: manualMembers.length }, "policy compliance: manual OU assignment(s) took precedence over department match");
  }

  return [...manualMembers, ...departmentMembers];
}

/**
 * Real mailbox size, per UPN, from Microsoft's own usage report
 * (`/reports/getMailboxUsageDetail`) — the same CSV-report contract
 * `monitor-executor.ts` already parses elsewhere in this codebase.
 */
async function resolveMailboxSizesByUpn(tenantId: string): Promise<Map<string, number>> {
  const res = await graphFetchForTenant(tenantId, `/reports/getMailboxUsageDetail(period='D7')`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph mailbox usage report error ${res.status}: ${text.slice(0, 500)}`);
  }
  const bodyText = await res.text();
  if (!isCsvReportResponse(res.headers.get("content-type"), bodyText)) {
    throw new Error("Graph mailbox usage report did not return a CSV body — cannot parse mailbox sizes");
  }
  const rows = parseCsvReport(bodyText);
  const byUpn = new Map<string, number>();
  for (const row of rows) {
    const upn = row["User Principal Name"];
    const bytesRaw = row["Storage Used (Byte)"];
    if (!upn || !bytesRaw) continue;
    const bytes = Number(bytesRaw);
    if (!Number.isFinite(bytes)) continue;
    byUpn.set(upn.toLowerCase(), Math.round(bytes / (1024 * 1024)));
  }
  return byUpn;
}

/**
 * Real observed mailbox sizes for every member of the OU named `ouName` on
 * this tenant. A member present in the OU but absent from the usage report
 * (no mailbox, or report lag) is simply omitted — never a fabricated 0.
 * `ouId`/`customerId` let membership resolution check manual assignments
 * (#1952) ahead of the department-match guess.
 */
export async function observeOuMailboxSizes(tenantId: string, ouName: string, ouId: number, customerId: number): Promise<MailboxComplianceObservation[]> {
  const [members, sizesByUpn] = await Promise.all([
    resolveOuMembers(tenantId, ouName, ouId, customerId),
    resolveMailboxSizesByUpn(tenantId),
  ]);

  const observations: MailboxComplianceObservation[] = [];
  for (const member of members) {
    const observedSizeMb = sizesByUpn.get(member.userPrincipalName.toLowerCase());
    if (observedSizeMb === undefined) {
      log.info({ tenantId, ouName, upn: member.userPrincipalName }, "policy compliance: OU member has no mailbox usage row yet — skipped, not fabricated");
      continue;
    }
    observations.push({ userPrincipalName: member.userPrincipalName, displayName: member.displayName, observedSizeMb });
  }
  return observations;
}

/**
 * Real, Graph-confirmed subset of `groupIds` that `userId` actually belongs
 * to (including transitive membership) — Graph's own `checkMemberGroups`
 * action, the correct API for "which of these specific groups is this user
 * in" rather than paging full group rosters.
 */
async function resolveMemberGroupIds(tenantId: string, userId: string, groupIds: readonly string[]): Promise<string[]> {
  const res = await graphFetchForTenant(tenantId, `/users/${encodeURIComponent(userId)}/checkMemberGroups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupIds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph checkMemberGroups error ${res.status} for user ${userId}: ${text.slice(0, 500)}`);
  }
  const body = (await res.json()) as { value?: string[] };
  return body.value ?? [];
}

/**
 * Real observed group memberships for every member of the OU named `ouName`
 * on this tenant, restricted to the policy's own declared `groupIds` — never
 * a fabricated membership, only what Graph itself confirms. `ouId`/
 * `customerId` let membership resolution check manual assignments (#1952)
 * ahead of the department-match guess, same as `observeOuMailboxSizes`.
 */
export async function observeOuGroupMemberships(
  tenantId: string,
  ouName: string,
  ouId: number,
  customerId: number,
  groupIds: readonly string[],
): Promise<GroupMembershipComplianceObservation[]> {
  const members = await resolveOuMembers(tenantId, ouName, ouId, customerId);

  const observations: GroupMembershipComplianceObservation[] = [];
  for (const member of members) {
    const memberGroupIds = await resolveMemberGroupIds(tenantId, member.id, groupIds);
    observations.push({ userPrincipalName: member.userPrincipalName, displayName: member.displayName, memberGroupIds });
  }
  return observations;
}
