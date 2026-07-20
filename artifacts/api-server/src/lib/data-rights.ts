/**
 * data-rights.ts
 *
 * Single source of truth for recording a right-to-erasure (deletion) request,
 * shared by two entry points that must never drift from each other:
 *   - portal.ts POST /portal/deletion-request — customer self-service
 *   - msp-data-rights.ts POST /msp/data-rights/:customerId/deletion-request —
 *     MSP-admin-initiated, for when a customer contacts the MSP directly
 *     instead of using self-service
 *
 * Behavior-preserving extraction: this is the exact same audit_logs write +
 * admin notification email portal.ts always sent, parameterized by actor.
 * The retention/manual-fulfillment procedure it describes is unchanged and
 * lives in docs/runbooks/data-subject-rights.md — this file does not
 * reimplement or alter that policy, only records that a request happened.
 */
import { db, usersTable, mspCustomersTable, mspDiagnosticRunsTable, mspDiagnosticFindingsTable, mspSowsTable, mspDocumentsTable, tenantEngineSnapshotsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { createAuditLog } from "./audit.ts";
import { sendEmail } from "./mailer.ts";

export interface CurrentSchemaSummary {
  customerId: number;
  mspId: number | null;
  customerName: string | null;
  diagnosticRuns: number;
  diagnosticFindings: number;
  sows: number;
  mspDocuments: number;
  engineSnapshots: number;
}

export interface DeletionRequestActor {
  actorRole: "client" | "admin";
  actorUserId: number;
  actorName: string;
}

type TargetUser = { id: number; name: string | null; email: string; company: string | null };

/**
 * Resolves the current-schema (MSP tenant) footprint for a customer, if any —
 * the data NOT reached by the legacy CRM → Delete Client cascade.
 */
export async function resolveCurrentSchemaSummary(customerId: number | undefined): Promise<CurrentSchemaSummary | null> {
  if (typeof customerId !== "number") return null;
  const [mspCustomer] = await db
    .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId, name: mspCustomersTable.name })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);
  if (!mspCustomer) return null;

  const [[runs], [findings], [sowCount], [docCount], [snapCount]] = await Promise.all([
    db.select({ n: count() }).from(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, customerId)),
    db.select({ n: count() }).from(mspDiagnosticFindingsTable).where(eq(mspDiagnosticFindingsTable.customerId, customerId)),
    db.select({ n: count() }).from(mspSowsTable).where(eq(mspSowsTable.customerId, customerId)),
    db.select({ n: count() }).from(mspDocumentsTable).where(eq(mspDocumentsTable.customerId, customerId)),
    db.select({ n: count() }).from(tenantEngineSnapshotsTable).where(eq(tenantEngineSnapshotsTable.customerId, customerId)),
  ]);

  return {
    customerId,
    mspId: mspCustomer.mspId ?? null,
    customerName: mspCustomer.name ?? null,
    diagnosticRuns: runs?.n ?? 0,
    diagnosticFindings: findings?.n ?? 0,
    sows: sowCount?.n ?? 0,
    mspDocuments: docCount?.n ?? 0,
    engineSnapshots: snapCount?.n ?? 0,
  };
}

function currentSchemaEmailBlock(summary: CurrentSchemaSummary | null): string {
  if (!summary) {
    return `<p style="margin-top:16px;color:#64748b;">No current-schema (MSP tenant) record is linked to this account — legacy portal records only.</p>`;
  }
  return `
    <p style="margin-top:16px;"><strong>Current-schema (MSP tenant) data — NOT reached by CRM → Delete Client today:</strong></p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><td style="padding:6px 0;color:#64748b;">Customer ID (msp_customers.id)</td><td style="padding:6px 0;">${summary.customerId}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">MSP ID</td><td style="padding:6px 0;">${summary.mspId ?? "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Customer name</td><td style="padding:6px 0;">${summary.customerName ?? "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Diagnostic runs</td><td style="padding:6px 0;">${summary.diagnosticRuns}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Diagnostic findings</td><td style="padding:6px 0;">${summary.diagnosticFindings}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">SOWs (retain if signed)</td><td style="padding:6px 0;">${summary.sows}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">MSP documents</td><td style="padding:6px 0;">${summary.mspDocuments}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Engine snapshots</td><td style="padding:6px 0;">${summary.engineSnapshots}</td></tr>
    </table>
    <p style="color:#b45309;"><strong>Manual step required:</strong> this current-schema data must be erased separately (by customer_id above), preserving signed SOWs per legal retention — CRM → Delete Client only clears the legacy portal records.</p>`;
}

/** The one place the audit_logs write + admin notification email are built. */
async function recordDeletionRequest(
  targetUser: TargetUser,
  actor: DeletionRequestActor,
  currentSchemaSummary: CurrentSchemaSummary | null,
): Promise<void> {
  void createAuditLog({
    actorUserId: actor.actorUserId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    actionType: "deletion_request_submitted",
    entityType: "user",
    entityId: targetUser.id,
    clientId: targetUser.id,
    metadata: {
      requestedAt: new Date().toISOString(),
      currentSchema: currentSchemaSummary,
      submittedByAdmin: actor.actorRole === "admin",
    },
  });

  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    const html = `
      <p>${actor.actorRole === "admin" ? `MSP staff (<strong>${actor.actorName}</strong>) recorded a <strong>data deletion request</strong> on behalf of a customer who contacted them directly.` : `A client has submitted a <strong>data deletion request</strong>.`}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Name</td><td style="padding:6px 0;">${targetUser.name ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;">${targetUser.email}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Company</td><td style="padding:6px 0;">${targetUser.company ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">User ID</td><td style="padding:6px 0;">${targetUser.id}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Requested at</td><td style="padding:6px 0;">${new Date().toUTCString()}</td></tr>
      </table>
      ${currentSchemaEmailBlock(currentSchemaSummary)}
      <p style="margin-top:16px;">
        <strong>Action required within 30 days:</strong> process this deletion via the Admin Panel (CRM → Clients → Delete Client), erase the current-schema data listed above by customer_id, retain signed contracts, invoices, and signed SOWs per legal requirements, then send the client the standard retention notice.
      </p>
      <p>See the <a href="https://shanemccaw.com/admin-panel">Admin Panel</a> and the <code>data-subject-rights.md</code> runbook for the full procedure.</p>
    `;
    void sendEmail(adminEmailAddr, `Data Deletion Request — ${targetUser.name ?? targetUser.email}`, html);
  }
}

/**
 * Self-service entry point: the requester IS the target account. Caller
 * already has `targetUser` and `req.user.customerId` on hand from the JWT.
 */
export async function submitSelfServiceDeletionRequest(
  targetUser: TargetUser,
  customerId: number | undefined,
): Promise<CurrentSchemaSummary | null> {
  const currentSchemaSummary = await resolveCurrentSchemaSummary(customerId);
  await recordDeletionRequest(targetUser, { actorRole: "client", actorUserId: targetUser.id, actorName: targetUser.name ?? targetUser.email }, currentSchemaSummary);
  return currentSchemaSummary;
}

/**
 * MSP-admin-initiated entry point: an MSP admin records a request on behalf
 * of `targetUserId` after the customer contacted them directly instead of
 * using self-service. `mspCustomerId` is the msp_customers.id the caller has
 * already validated (via assertCustomerAccess) belongs to their own book.
 */
export async function submitAdminInitiatedDeletionRequest(
  targetUserId: number,
  mspCustomerId: number,
  actor: DeletionRequestActor,
): Promise<{ ok: true; currentSchemaSummary: CurrentSchemaSummary | null } | { error: "user_not_found" }> {
  const [targetUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);
  if (!targetUser) return { error: "user_not_found" };

  const currentSchemaSummary = await resolveCurrentSchemaSummary(mspCustomerId);
  await recordDeletionRequest(targetUser, actor, currentSchemaSummary);
  return { ok: true, currentSchemaSummary };
}
