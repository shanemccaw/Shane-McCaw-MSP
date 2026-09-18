// Git #4550 — live, end-to-end verification against the real testbed tenant
// and the real local Postgres. Inserts one real portal_runbooks +
// portal_runbook_runs + portal_hold_windows row for customer 2080 (McCawSoft,
// the real testbed tenant), runs the new ca_policy_hold_window_scan node
// handler for real (a genuine HTTPS call to Microsoft Graph, no mocking),
// confirms the row's scan_verdict/scan_line/scan_at actually change in
// Postgres, then calls the exact function GET /portal/runbooks calls and
// confirms the new values are what the customer-facing wire returns. Cleans
// up its own scratch rows afterward — this is verification, not deliverable
// data.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-hold-window-scan-4550.ts

import { eq } from "drizzle-orm";
import { db, portalHoldWindowsTable, portalRunbookRunsTable, portalRunbooksTable } from "@workspace/db";
import { handleCaPolicyHoldWindowScan } from "../lib/ca-hold-window-scan.ts";
import { loadRunbooksForCustomer } from "../lib/portal-runbook-wire.ts";

const CUSTOMER_ID = 2080; // McCawSoft — real testbed tenant, tenants.tenant_id c4c814d4-3afe-441e-9145-62461d0a4fd3
// Well-formed CA policy GUID. The live listCaPoliciesForTenant call earlier this
// session confirmed the testbed tenant currently has ZERO Conditional Access
// policies, so this id genuinely does not exist on the tenant — the real,
// honest state this session found. That is itself a real case the writer must
// handle without dropping data: a live Graph read, a real "not found" result.
const POLICY_ID = "4550a000-0000-4000-8000-000000004550";

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

console.log(`#4550 live verification — customer ${CUSTOMER_ID}, policyId ${POLICY_ID}\n`);

const [runbook] = await db
  .insert(portalRunbooksTable)
  .values({
    customerId: CUSTOMER_ID,
    runbookKey: "verify-4550-ca-hold",
    title: "Git #4550 verification runbook",
    context: "Verification · scratch row, deleted at the end of this script",
    pillar: "security",
    startedOn: new Date().toISOString().slice(0, 10),
    cycleDays: 7,
    status: "active",
  })
  .returning({ id: portalRunbooksTable.id });
console.log(`inserted portal_runbooks.id=${runbook!.id}`);

const [run] = await db
  .insert(portalRunbookRunsTable)
  .values({
    runbookId: runbook!.id,
    customerId: CUSTOMER_ID,
    cycleNumber: 1,
    startedOn: new Date().toISOString().slice(0, 10),
    status: "active",
  })
  .returning({ id: portalRunbookRunsTable.id });
console.log(`inserted portal_runbook_runs.id=${run!.id}`);

const [hold] = await db
  .insert(portalHoldWindowsTable)
  .values({
    customerId: CUSTOMER_ID,
    runbookId: runbook!.id,
    runId: run!.id,
    holdKey: "verify-4550-ca01",
    policyId: POLICY_ID,
    title: "Git #4550 verification — CA policy report-only window",
    gates: "Gates step 1 — verification only",
    gatesStepPosition: 1,
    pillar: "security",
    startedAt: new Date(),
    waitDays: 7,
    extendedDays: 0,
    // Deliberately WRONG values, to prove the scan below actually overwrites
    // them rather than the read path just echoing whatever was seeded.
    scanVerdict: "clear",
    scanLine: "PRE-SCAN PLACEHOLDER — must not still read this after the scan runs.",
    scanSource: "placeholder",
    scanAt: null,
    why: "Git #4550 live verification.",
  })
  .returning();
console.log(`inserted portal_hold_windows.id=${hold!.id} (pre-scan scanVerdict=${hold!.scanVerdict}, scanAt=${hold!.scanAt})\n`);

try {
  // ── 1. Run the real node handler — real DB read, real Graph call ──────────
  const scanSummary = await handleCaPolicyHoldWindowScan({}, {});
  console.log(`scan summary: ${JSON.stringify(scanSummary)}\n`);
  check("scan pass considered at least our seeded window", scanSummary.windowsConsidered >= 1, scanSummary.windowsConsidered);

  // ── 2. Confirm the row itself actually changed in Postgres ────────────────
  const [afterScan] = await db.select().from(portalHoldWindowsTable).where(eq(portalHoldWindowsTable.id, hold!.id));
  console.log(`post-scan row: scanVerdict=${afterScan?.scanVerdict} scanSource=${afterScan?.scanSource} scanAt=${afterScan?.scanAt}`);
  console.log(`post-scan scanLine: ${afterScan?.scanLine}\n`);
  check("scan_verdict was overwritten by the real scan (not left as the placeholder)", afterScan?.scanVerdict !== "clear" || afterScan?.scanLine !== "PRE-SCAN PLACEHOLDER — must not still read this after the scan runs.", afterScan?.scanVerdict);
  check("scan_line no longer reads the pre-scan placeholder", afterScan?.scanLine !== "PRE-SCAN PLACEHOLDER — must not still read this after the scan runs.", afterScan?.scanLine);
  check("scan_source was written by the real writer", afterScan?.scanSource === "Report-only sign-in logs", afterScan?.scanSource);
  check("scan_at was stamped", afterScan?.scanAt !== null, afterScan?.scanAt);

  // ── 3. Confirm the CUSTOMER-facing wire (the exact function GET /portal/runbooks calls) reflects it ──
  const wire = await loadRunbooksForCustomer(CUSTOMER_ID);
  const wireHold = wire.holds.find((h) => h.id === hold!.id);
  console.log(`\nwire read — holds[].find(id=${hold!.id}): ${JSON.stringify(wireHold)}`);
  check("the new hold window appears in the customer-facing wire read", wireHold !== undefined);
  check("the wire's scanLine matches what the writer just persisted (no drop between write and read)", wireHold?.scanLine === afterScan?.scanLine, wireHold?.scanLine);
  check("the wire's scanVerdict matches what the writer just persisted", wireHold?.scanVerdict === afterScan?.scanVerdict, wireHold?.scanVerdict);
} finally {
  // ── Clean up the scratch rows — verification data, not a deliverable ──────
  await db.delete(portalHoldWindowsTable).where(eq(portalHoldWindowsTable.id, hold!.id));
  await db.delete(portalRunbookRunsTable).where(eq(portalRunbookRunsTable.id, run!.id));
  await db.delete(portalRunbooksTable).where(eq(portalRunbooksTable.id, runbook!.id));
  console.log("\ncleaned up scratch rows");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
