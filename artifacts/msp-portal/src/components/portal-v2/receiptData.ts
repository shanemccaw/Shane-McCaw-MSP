/**
 * receiptData.ts — the Receipt page fixture (Part 12).
 *
 * EXTRACTED from the prototype's `BILL_ONETIME` (Customer Portal Shell.dc.html
 * 15645-15653) and `RC_DETAIL` (15716-15738), evaluated rather than retyped.
 * Every string is the design's, verbatim.
 *
 * ── One receipt at a time ───────────────────────────────────────────────────
 * The prototype reaches this view with a `receiptId` and falls back to
 * `rcpt_1Q2fA1` when none is set (15739). The page reads the id off its route
 * and defaults the same way, so the standalone `/portal-v2/receipt` renders the
 * Preservation-Lock receipt exactly as the design's default does.
 *
 * UI-only: design content for the fictional Halden Materials tenant. A later
 * pass wires it to real Stripe receipts; keeping the fixture in one module is
 * what makes that a single-file change.
 */

export type ReceiptStatus = "Paid" | "Pending";

/** One purchased one-time item — prototype `BILL_ONETIME` row. */
export interface OneTimeCharge {
  date: string;
  item: string;
  origin: string;
  amount: number;
  receipt: string;
  status: ReceiptStatus;
}

/** prototype 15645-15653. */
export const BILL_ONETIME: readonly OneTimeCharge[] = [
  { date: "12 March 2026", item: "Copilot Readiness Assessment", origin: "Assessment · full six-pillar scan and report", amount: 4500, receipt: "rcpt_1P4kX2", status: "Paid" },
  { date: "19 March 2026", item: "Remediation SOW · Phase 1 of 4", origin: "Statement of work SOW-2026-014", amount: 8200, receipt: "rcpt_1P7mB9", status: "Paid" },
  { date: "2 August 2026", item: "Apply Preservation Lock", origin: "Compliance · CMP-03 write action", amount: 180, receipt: "rcpt_1Q2fA1", status: "Paid" },
  { date: "2 August 2026", item: "Flatten SPF and switch to -all", origin: "Security · Email security write action", amount: 180, receipt: "rcpt_1Q2fA2", status: "Paid" },
  { date: "9 August 2026", item: "Known Folder Move rollout", origin: "Adoption · ADP-02 staged rollout", amount: 450, receipt: "rcpt_1Q6hD7", status: "Paid" },
  { date: "14 August 2026", item: "Entra Connect upgrade and standby build", origin: "Health · HLT-02, 2 of 3 stages", amount: 1350, receipt: "rcpt_1Q9jK4", status: "Paid" },
  { date: "18 August 2026", item: "Teams Phone rollout scoping", origin: "Adoption · ADP-04 scoping only", amount: 600, receipt: "—", status: "Pending" },
];

/** One line on a receipt — prototype `RC_DETAIL[*].lines`. */
export interface ReceiptLineSeed {
  name: string;
  detail: string;
  qty: string;
}

/** The prose + line items + trace behind one receipt — prototype `RC_DETAIL`. */
export interface ReceiptDetail {
  narrative: string;
  lines: readonly ReceiptLineSeed[];
  /** [label, value] pairs — prototype's tuple `trace`. */
  trace: readonly (readonly [string, string])[];
}

/** prototype 15716-15738. */
export const RC_DETAIL: Readonly<Record<string, ReceiptDetail>> = {
  rcpt_1P4kX2: {
    narrative: "The full six-pillar Copilot readiness assessment: 150+ signals read from your tenant through Microsoft Graph, scored against the framework, and written up as nine documents. Fixed fee, quoted before any data was collected.",
    lines: [{ name: "Copilot Readiness Assessment", detail: "Full tenant scan across governance, security, compliance, licensing, adoption and health. Nine documents issued.", qty: "1" }],
    trace: [
      ["Deliverables", "Nine documents, all issued 3 August 2026"],
      ["Scope", "Whole tenant, 1,240 seats, no sampling"],
      ["Authorisation", "Signed engagement letter, 10 March 2026"],
      ["Evidence", "Raw Graph responses retained for 12 months and available on request"],
    ],
  },
  rcpt_1P7mB9: {
    narrative: "Phase 1 of the remediation statement of work: the eight fixes that cleared the Copilot gate from 41 to 68, each executed under a change request with a snapshot taken first.",
    lines: [{ name: "Remediation SOW · Phase 1 of 4", detail: "Eight fixes across governance, security and compliance. Gate movement 41 → 68, verified by rescan.", qty: "1" }],
    trace: [
      ["Change requests", "CR-2026-0142 through CR-2026-0149, all approved before execution"],
      ["Verification", "Rescan 20 March 2026 confirmed all eight closed"],
      ["Rollback", "Snapshots retained 30 days, none required"],
      ["Milestone", "Milestone 1 of 4 released against SOW-2026-014"],
    ],
  },
  rcpt_1Q2fA1: {
    narrative: "A single write action against the tenant: preservation lock applied to the retention policy covering statutory records. Irreversible by design, which is why it was quoted, approved and snapshotted separately.",
    lines: [{ name: "Apply Preservation Lock", detail: "Compliance · CMP-03. Locks the retention policy so it cannot be weakened or deleted, including by us.", qty: "1" }],
    trace: [
      ["Finding", "CMP-03 · Preservation Lock not enabled"],
      ["Change request", "CR-2026-0176 · normal change, approved by Jordan Diaz"],
      ["Window", "2 August 2026, 19:00–20:00 UTC"],
      ["Evidence", "Before and after policy export, filed against the finding"],
      ["Reversible", "No — preservation lock cannot be removed by anyone, by design"],
    ],
  },
  rcpt_1Q2fA2: {
    narrative: "SPF flattening and a move to a hard fail. Two DNS changes, sequenced so mail flow was verified between them.",
    lines: [{ name: "Flatten SPF and switch to -all", detail: "Security · email authentication. Lookup count reduced from 13 to 7, policy moved from ~all to -all.", qty: "1" }],
    trace: [
      ["Finding", "SEC-07 · SPF exceeds the 10-lookup limit and fails open"],
      ["Change request", "CR-2026-0177 · normal change, approved by Jordan Diaz"],
      ["Window", "2 August 2026, 20:00–21:00 UTC"],
      ["Verification", "48-hour mail flow watch, no legitimate senders affected"],
      ["Evidence", "DNS before and after, plus the sender inventory used to flatten"],
    ],
  },
  rcpt_1Q6hD7: {
    narrative: "Known Folder Move rolled out in stages to 1,240 devices, held at each ring until the failure rate stayed at zero.",
    lines: [{ name: "Known Folder Move rollout", detail: "Adoption · ADP-02. Desktop, Documents and Pictures redirected to OneDrive across four rings.", qty: "1" }],
    trace: [
      ["Finding", "ADP-02 · 412 devices with unprotected local data"],
      ["Change request", "CR-2026-0179 · standard change, pre-approved pattern"],
      ["Rings", "Pilot 25, then 200, then 500, then remainder"],
      ["Result", "1,238 of 1,240 devices redirected; 2 held for hardware replacement"],
    ],
  },
  rcpt_1Q9jK4: {
    narrative: "Entra Connect upgraded to the supported build and a standby server built alongside it. Two of three stages complete; the failover test is the remaining stage and is not billed until it passes.",
    lines: [
      { name: "Entra Connect upgrade", detail: "Health · HLT-02, stage 1. Upgraded from an unsupported build with staging mode used for the cutover.", qty: "1" },
      { name: "Standby server build", detail: "Health · HLT-02, stage 2. Second server in staging mode, ready to promote.", qty: "1" },
    ],
    trace: [
      ["Finding", "HLT-02 · Entra Connect single point of failure on an unsupported build"],
      ["Change request", "CR-2026-0182 · normal change, approved by Jordan Diaz"],
      ["Stages billed", "2 of 3 — failover test is scheduled and unbilled"],
      ["Evidence", "Build versions, staging mode confirmation and sync cycle logs"],
    ],
  },
};

/** The prototype's default when no `receiptId` is set — shell 15739. */
export const RECEIPT_DEFAULT_ID = "rcpt_1Q2fA1";

/** Fixed header copy — shell 6025-6027. */
export const RECEIPT_ISSUER = "Shane McCaw · Tenant Monitoring";
export const RECEIPT_ISSUER_INITIALS = "SM";
export const RECEIPT_INTRO =
  "Receipt for a one-time action against your tenant. Every line here traces to a finding, a change request and filed evidence.";
/** Fixed "Billed to" line — shell 20550. */
export const RECEIPT_BILLED_TO = "Halden Materials · Jordan Diaz";
