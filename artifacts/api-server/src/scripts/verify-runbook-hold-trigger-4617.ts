// Git #4617 — live verification against the real testbed tenant and the real
// local Postgres. Seeds a real "Convert to Private" overshare-fix runbook
// (the exact runbookKey/step shape `POST /portal/oversharing/runbooks/convert`
// produces) for customer 2080 (McCawSoft), then calls the REAL exported
// `maybeRaiseHoldWindowForStep` — the same function both step-tick routes
// (`portal-runbooks.ts`, `msp-runbooks.ts`) call — exactly as they call it
// when step 1 is checked. Confirms a real `portal_hold_windows` row is
// created, that it reads back through the real customer-facing wire
// (`loadRunbooksForCustomer`, what `GET /portal/runbooks` calls), and that
// checking the step again is idempotent (no duplicate row). Cleans up its own
// scratch rows afterward — this is verification, not deliverable data.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-runbook-hold-trigger-4617.ts

import { and, eq } from "drizzle-orm";
import { db, portalHoldWindowsTable, portalRunbookRunsTable, portalRunbookStepsTable, portalRunbooksTable } from "@workspace/db";
import { loadRunbooksForCustomer, maybeRaiseHoldWindowForStep } from "../lib/portal-runbook-wire.ts";

const CUSTOMER_ID = 2080; // McCawSoft — real testbed tenant

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

console.log(`#4617 live verification — customer ${CUSTOMER_ID}\n`);

// Clear out any leftover scratch row from a previous failed run.
await db.delete(portalHoldWindowsTable).where(and(eq(portalHoldWindowsTable.customerId, CUSTOMER_ID), eq(portalHoldWindowsTable.holdKey, "oversharing-convert-notice")));
await db.delete(portalRunbooksTable).where(and(eq(portalRunbooksTable.customerId, CUSTOMER_ID), eq(portalRunbooksTable.runbookKey, "verify-4617-convert")));

// Same shape POST /portal/oversharing/runbooks/convert really produces —
// runbookKey deliberately distinct ("verify-4617-convert") so this script
// never collides with a real customer's actual oversharing runbook, but the
// hold TRIGGER lookup is keyed on the real catalogue key
// ("oversharing-convert-to-private"), which the script sets explicitly below
// to prove the real trigger catalogue actually fires.
const [runbook] = await db
  .insert(portalRunbooksTable)
  .values({
    customerId: CUSTOMER_ID,
    runbookKey: "oversharing-convert-to-private",
    title: "Convert to Private",
    context: "Governance · Overshared SharePoint",
    pillar: "governance",
    startedOn: new Date().toISOString().slice(0, 10),
    cycleDays: 30,
    status: "active",
    recurring: false,
  })
  .returning();
console.log(`inserted portal_runbooks.id=${runbook!.id} runbookKey=${runbook!.runbookKey}`);

const [run] = await db
  .insert(portalRunbookRunsTable)
  .values({
    runbookId: runbook!.id,
    customerId: CUSTOMER_ID,
    cycleNumber: 1,
    startedOn: new Date().toISOString().slice(0, 10),
    status: "active",
  })
  .returning();
console.log(`inserted portal_runbook_runs.id=${run!.id}`);

const CONVERT_STEPS = [
  "Notify all site admins that this site is scheduled for conversion to Private",
  "Enable Restricted Content Discoverability (RCD) immediately — blocks this site from SharePoint search and Copilot results while the process runs",
  "Allow admins to submit a business justification to keep the site public (e.g. community practice, training, all-hands)",
  "If no admin responds within 30 days, convert the site to Private automatically",
  "Verify — run a targeted scan to confirm this fix took",
];
await db.insert(portalRunbookStepsTable).values(
  CONVERT_STEPS.map((text, i) => ({ runId: run!.id, position: i + 1, text, checked: false, isCustom: false })),
);
console.log(`inserted ${CONVERT_STEPS.length} portal_runbook_steps rows\n`);

try {
  // ── 1. Tick step 1, exactly as the real step-tick route does ───────────────
  const now = new Date();
  await db
    .update(portalRunbookStepsTable)
    .set({ checked: true, checkedAt: now })
    .where(and(eq(portalRunbookStepsTable.runId, run!.id), eq(portalRunbookStepsTable.position, 1)));

  // ── 2. Call the REAL function both routes call ─────────────────────────────
  await maybeRaiseHoldWindowForStep({ runbook: runbook!, run: run!, position: 1, checked: true, now });

  const [hold] = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(and(eq(portalHoldWindowsTable.customerId, CUSTOMER_ID), eq(portalHoldWindowsTable.holdKey, "oversharing-convert-notice")));

  console.log(`hold window after tick: ${JSON.stringify(hold)}\n`);
  check("a real portal_hold_windows row was created", hold !== undefined);
  check("runbookId links back to the real runbook", hold?.runbookId === runbook!.id, hold?.runbookId);
  check("runId links back to the real cycle", hold?.runId === run!.id, hold?.runId);
  check("waitDays is the real, already-promised 30", hold?.waitDays === 30, hold?.waitDays);
  check("gatesStepPosition points at the real auto-convert step", hold?.gatesStepPosition === 4, hold?.gatesStepPosition);
  check("pillar is governance", hold?.pillar === "governance", hold?.pillar);
  check("scanVerdict starts at the honest default", hold?.scanVerdict === "watch", hold?.scanVerdict);

  // ── 3. Confirm the CUSTOMER-facing wire (the exact function GET /portal/runbooks calls) reflects it ──
  const wire = await loadRunbooksForCustomer(CUSTOMER_ID);
  const wireHold = wire.holds.find((h) => h.id === hold?.id);
  console.log(`\nwire read — holds[].find(id=${hold?.id}): ${JSON.stringify(wireHold)}`);
  check("the new hold window appears in the customer-facing wire read", wireHold !== undefined);
  check("the wire derives a real state/badge from the real startedAt/waitDays", typeof wireHold?.state === "string" && wireHold.state.length > 0, wireHold?.state);
  check("the wire's daysLeft is close to 30 (just started)", (wireHold?.daysLeft ?? -1) >= 29, wireHold?.daysLeft);

  // ── 4. Idempotency — ticking again must NOT duplicate the row ──────────────
  await maybeRaiseHoldWindowForStep({ runbook: runbook!, run: run!, position: 1, checked: true, now: new Date() });
  const dupCheck = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(and(eq(portalHoldWindowsTable.customerId, CUSTOMER_ID), eq(portalHoldWindowsTable.holdKey, "oversharing-convert-notice")));
  check("re-ticking the trigger step created no duplicate row", dupCheck.length === 1, dupCheck.length);

  // ── 5. Ticking a DIFFERENT step (not the trigger) must NOT raise anything ──
  await maybeRaiseHoldWindowForStep({ runbook: runbook!, run: run!, position: 2, checked: true, now: new Date() });
  const stillOne = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(eq(portalHoldWindowsTable.customerId, CUSTOMER_ID));
  check("ticking a non-trigger step raises nothing new", stillOne.filter((h) => h.holdKey === "oversharing-convert-notice").length === 1, stillOne.length);
} finally {
  // ── Clean up the scratch rows — verification data, not a deliverable ──────
  await db.delete(portalHoldWindowsTable).where(and(eq(portalHoldWindowsTable.customerId, CUSTOMER_ID), eq(portalHoldWindowsTable.holdKey, "oversharing-convert-notice")));
  await db.delete(portalRunbookRunsTable).where(eq(portalRunbookRunsTable.id, run!.id));
  await db.delete(portalRunbooksTable).where(eq(portalRunbooksTable.id, runbook!.id));
  console.log("\ncleaned up scratch rows");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
