/**
 * portal-change-control.ts — the pure derivations behind the customer-facing
 * Change Control page (`/portal-v2/change-control`).
 *
 * Everything here is a total function over a stored `msp_change_requests` row.
 * It lives apart from the route so it can be unit-tested without a database,
 * which matters more than usual here: two of these functions decide what a
 * customer is *allowed to do* to their own tenant, and one of them
 * (`computeRiskLevel`) is deliberately a server-side recomputation of something
 * the prototype computed in the browser.
 *
 * ── Why risk is recomputed here and not accepted from the client ────────────
 * The prototype's `ccRiskComputed` (proto 15107-15113) runs in the page and its
 * result is written straight into the submitted CR. That is fine in a design
 * file and wrong in a product: risk level decides how many approvals a change
 * needs, so a client that can name its own risk can name its way past the gate.
 * The rule below is the prototype's rule, character for character — it is just
 * evaluated where the client cannot reach it. The route ignores any `risk` in
 * the request body.
 *
 * ── The status vocabulary is 7 labels over 6 stored values ──────────────────
 * The prototype's `CC_STATUSES` (proto 14946) lists seven display statuses;
 * `msp_change_requests.status` stores six. BUILD_PLAN §3.5 reads the six-value
 * column as already modelling the design, which is true of every value except
 * one: there is no stored `approved`.
 *
 * Rather than widen the column for a value nothing writes, `Approved` is
 * DERIVED — `pending_approval` with a non-null `approvedBy`. That is not a
 * workaround, it is what the two columns already mean together: the approvals
 * are recorded, and the change has not been booked or started. The mapping is
 * total over the six stored values, so no row can ever fall through to a blank
 * status chip.
 *
 * ── `category` is widened, and that needs no migration ──────────────────────
 * `msp_change_requests.category`'s Drizzle enum listed five workloads;
 * the prototype's `CC_WORKLOADS` (proto 14947) lists eight. The three missing
 * ones — SharePoint, Purview, Teams — are not exotic: the prototype's own first
 * two seed rows are a SharePoint sharing-link revert and a Purview retention
 * lock, so a customer raising the design's flagship example could not have been
 * stored. Verified live against the database before widening: the column is
 * plain `text` carrying no CHECK constraint (`pg_constraint` on the table
 * returns only the primary key and the `msp_id` foreign key), so the Drizzle
 * `enum` is a TypeScript-level type and widening it is a compile-time change
 * with no DDL. See `lib/db/src/schema/msp.ts`.
 */

import type { M365Touches } from "@workspace/db";

/** The stored `msp_change_requests.status` values, in the schema's own order. */
export const CHANGE_REQUEST_STORED_STATUSES = [
  "pending_approval",
  "scheduled",
  "in_progress",
  "completed",
  "rolled_back",
  "rejected",
] as const;
export type ChangeRequestStoredStatus = typeof CHANGE_REQUEST_STORED_STATUSES[number];

/**
 * The prototype's seven display statuses (proto 14946), minus its leading
 * "All" filter sentinel. Order is the prototype's.
 */
export const CHANGE_REQUEST_DISPLAY_STATUSES = [
  "Pending approval",
  "Approved",
  "Scheduled",
  "In window",
  "Implemented",
  "Rejected",
  "Rolled back",
] as const;
export type ChangeRequestDisplayStatus = typeof CHANGE_REQUEST_DISPLAY_STATUSES[number];

/** The prototype's eight workloads (proto 14947), minus its "All" sentinel. */
export const CHANGE_REQUEST_WORKLOADS = [
  "Conditional Access",
  "Exchange / mail",
  "Identity",
  "Intune",
  "Defender",
  "SharePoint",
  "Purview",
  "Teams",
] as const;
export type ChangeRequestWorkload = typeof CHANGE_REQUEST_WORKLOADS[number];

/**
 * The stored `msp_change_requests.category` values, after the widening
 * described in the header. Declared as a literal union rather than `string` so
 * the insert in the route type-checks against the real column type with NO
 * cast — a cast would compile whether or not the schema had actually been
 * widened, which is exactly the kind of illusory safety this file exists to
 * avoid.
 */
export const CHANGE_REQUEST_CATEGORIES = [
  "ConditionalAccess",
  "Exchange",
  "Identity",
  "Intune",
  "Defender",
  "SharePoint",
  "Purview",
  "Teams",
] as const;
export type ChangeRequestCategory = typeof CHANGE_REQUEST_CATEGORIES[number];

/** Stored `category` ⟷ the prototype's workload label. One entry per stored value. */
const WORKLOAD_BY_CATEGORY: Record<string, ChangeRequestWorkload> = {
  ConditionalAccess: "Conditional Access",
  Exchange: "Exchange / mail",
  Identity: "Identity",
  Intune: "Intune",
  Defender: "Defender",
  SharePoint: "SharePoint",
  Purview: "Purview",
  Teams: "Teams",
};

const CATEGORY_BY_WORKLOAD: Record<ChangeRequestWorkload, ChangeRequestCategory> = {
  "Conditional Access": "ConditionalAccess",
  "Exchange / mail": "Exchange",
  Identity: "Identity",
  Intune: "Intune",
  Defender: "Defender",
  SharePoint: "SharePoint",
  Purview: "Purview",
  Teams: "Teams",
};

/**
 * Unknown stored categories fall back to Identity rather than throwing — the
 * column is free text at the database level, so a value written before this
 * mapping existed must still render a row rather than 500 the whole register.
 */
export function workloadForCategory(category: string): ChangeRequestWorkload {
  return WORKLOAD_BY_CATEGORY[category] ?? "Identity";
}

export function categoryForWorkload(workload: ChangeRequestWorkload): ChangeRequestCategory {
  return CATEGORY_BY_WORKLOAD[workload] ?? "Identity";
}

/**
 * Stored status (+ whether approvals are recorded) → the prototype's display
 * label. Total over the six stored values; see the header for why `Approved`
 * is derived rather than stored.
 */
export function displayStatus(
  status: string,
  approvedBy: string | null,
): ChangeRequestDisplayStatus {
  switch (status) {
    case "pending_approval":
      return approvedBy && approvedBy.trim() ? "Approved" : "Pending approval";
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      return "In window";
    case "completed":
      return "Implemented";
    case "rejected":
      return "Rejected";
    case "rolled_back":
      return "Rolled back";
    default:
      // A value written outside this vocabulary still has to render as
      // something a customer can read, and "Pending approval" is the only
      // label that cannot overstate what has happened to their tenant.
      return "Pending approval";
  }
}

/** The prototype's three change classes, display-cased (proto 14945). */
export const CHANGE_CLASSES = ["Standard", "Normal", "Emergency"] as const;
export type ChangeClass = typeof CHANGE_CLASSES[number];

export function displayChangeClass(changeClass: string): ChangeClass {
  switch (changeClass) {
    case "standard":
      return "Standard";
    case "emergency":
      return "Emergency";
    default:
      return "Normal";
  }
}

/** The stored `change_class` values — a literal union for the same no-cast reason as `CHANGE_REQUEST_CATEGORIES`. */
export type StoredChangeClass = "standard" | "normal" | "emergency";

export function storedChangeClass(changeClass: ChangeClass): StoredChangeClass {
  switch (changeClass) {
    case "Standard":
      return "standard";
    case "Emergency":
      return "emergency";
    default:
      return "normal";
  }
}

/**
 * The intake axis (#1534) — how an automatically-routed Microsoft change enters
 * the register, i.e. what the customer can actually do about it. Stored lowercase
 * on `msp_change_requests.intake`; NULL for every wizard-/drift-raised CR (which
 * has no Microsoft intake), so this maps null → null and the page shows no chip.
 */
export const CHANGE_INTAKE_LABELS = {
  informed: "Informed",
  approval: "Approval",
  advisory: "Advisory",
} as const;
export type ChangeIntakeDisplay = (typeof CHANGE_INTAKE_LABELS)[keyof typeof CHANGE_INTAKE_LABELS];

export function displayIntake(intake: string | null | undefined): ChangeIntakeDisplay | null {
  switch (intake) {
    case "informed":
      return "Informed";
    case "approval":
      return "Approval";
    case "advisory":
      return "Advisory";
    default:
      return null;
  }
}

/**
 * Who implements a change. For an auto-routed Microsoft change this is
 * "Microsoft" — the headline of #1534: the tenant cannot refuse it, so Microsoft,
 * not the MSP, is the implementer. NULL (the pre-routing default) reads as the
 * ordinary internal case and shows no chip rather than asserting "MSP".
 */
export function displayImplementer(implementer: string | null | undefined): string | null {
  switch (implementer) {
    case "microsoft":
      return "Microsoft";
    case "customer":
      return "Your team";
    case "msp":
      return "Managed service provider";
    default:
      return null;
  }
}

/**
 * The prototype's risk levels are Low / Medium / High (proto 15079). The stored
 * column also permits `critical`, which the prototype has no colour for — its
 * `ccRiskMeta[c.risk] || '#94a3b8'` lookup falls through to slate. `Critical`
 * is surfaced here for the same reason: a stored critical must not silently
 * render as something milder.
 */
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const;
export type RiskLevel = typeof RISK_LEVELS[number];

export function displayRiskLevel(riskLevel: string): RiskLevel {
  switch (riskLevel) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "critical":
      return "Critical";
    default:
      return "High";
  }
}

/**
 * `ccRiskComputed`, ported verbatim from proto 15107-15113 and moved
 * server-side (see the header). The three literal patterns are the
 * prototype's own — authentication policy, mail transport, immutable
 * retention — and are matched against the raw target string exactly as it does.
 */
export type StoredRiskLevel = "critical" | "high" | "medium" | "low";

/** `Low`/`Medium`/`High` → the stored lowercase value, without a cast. */
export function storedRiskLevel(risk: Exclude<RiskLevel, "Critical">): Exclude<StoredRiskLevel, "critical"> {
  switch (risk) {
    case "Low":
      return "low";
    case "Medium":
      return "medium";
    default:
      return "high";
  }
}

export function computeRiskLevel(input: {
  changeClass: ChangeClass;
  targetResource: string;
  impactedUsersCount: number;
}): Exclude<RiskLevel, "Critical"> {
  if (input.changeClass === "Emergency") return "High";
  if (
    input.impactedUsersCount > 500 ||
    /conditionalAccess|TransportConfig|RestrictiveRetention/i.test(input.targetResource)
  ) {
    return "High";
  }
  if (input.impactedUsersCount > 50) return "Medium";
  return "Low";
}

/**
 * `submitCc`'s workload derivation, ported verbatim from proto 17181-17185.
 * ORDER IS LOAD-BEARING and is the prototype's: `/Retention|Compliance/`
 * is tested before `/SPO|SharePoint/`, so a retention change on a SharePoint
 * site classifies as Purview, not SharePoint. Reordering these silently
 * reclassifies changes.
 */
export function deriveWorkload(targetResource: string): ChangeRequestWorkload {
  if (/conditionalAccess/i.test(targetResource)) return "Conditional Access";
  if (/Transport|Mailbox|CASMailbox|SafeLinks/i.test(targetResource)) return "Exchange / mail";
  if (/deviceManagement|Intune/i.test(targetResource)) return "Intune";
  if (/Retention|Compliance/i.test(targetResource)) return "Purview";
  if (/SPO|SharePoint/i.test(targetResource)) return "SharePoint";
  return "Identity";
}

/**
 * Workload derivation for a CR raised FROM a remediation checklist item
 * (#1941) — a THIRD, separate function from `deriveWorkload` and
 * `deriveWorkloadFromTouches`, for the same reason those two are separate
 * from each other: the input shape is different. `deriveWorkload` matches a
 * technical PowerShell-cmdlet/Graph-endpoint string; a checklist item has no
 * such string — its only stable identity is `checkKey`
 * (`remediation_knowledge_base.check_key`), whose own namespace prefix
 * (`identity:…`, `sharepoint:…`, `security:…`) already names the real area of
 * the tenant the finding is about. Real prefixes as seeded in
 * `remediation_knowledge_base` (verified live): identity, devices, exchange,
 * sharepoint, onedrive, teams, security, compliance, governance, copilot,
 * appgov, adoption, cost, license/licensing, m365, platform. Only the first
 * seven have an unambiguous single workload; everything else (governance,
 * copilot, appgov, adoption, cost, license, licensing, m365, platform) falls
 * through to `Identity`, the same default `deriveWorkload` itself falls back
 * to for anything it can't classify — this is not a fabricated category, it's
 * the same "no better answer" fallback already established for the sibling
 * function.
 */
export function workloadForCheckKey(checkKey: string): ChangeRequestWorkload {
  const prefix = checkKey.split(":", 1)[0]?.toLowerCase() ?? "";
  switch (prefix) {
    case "exchange":
      return "Exchange / mail";
    case "sharepoint":
    case "onedrive":
      return "SharePoint";
    case "devices":
      return "Intune";
    case "security":
      return "Defender";
    case "compliance":
      return "Purview";
    case "teams":
      return "Teams";
    case "identity":
      return "Identity";
    default:
      return "Identity";
  }
}

/**
 * Workload derivation for a Microsoft-change-routed CR (#1534/#1700) — a SEPARATE
 * function from `deriveWorkload` above, on purpose. `deriveWorkload` is
 * `submitCc`'s prototype-ported matcher over a TECHNICAL resource string (a
 * cmdlet or a Graph endpoint, e.g. `Set-TransportConfig`, `/deviceManagement/…`).
 * A routed CR's `targetResource` is not that — it is a comma-joined, human-
 * readable string built by `targetResourceForInterpretation` out of the
 * interpretation's own `touches` (service names like "Exchange Online",
 * "Outlook", plus protocols/skus/settings). Running `deriveWorkload`'s
 * cmdlet/endpoint patterns over that string (Git #1700) matches nothing for an
 * ordinary Exchange/Outlook change and silently falls through to Identity —
 * CR-2026-183 (shared calendars MAPI → REST, `touches.services: ["Exchange
 * Online", "Outlook"]`) shipped mis-categorised because of exactly this.
 *
 * This reads the interpretation's own structured `touches.services` — the
 * AI's/analyst's actual workload signal — instead of re-parsing the flattened
 * display string. ORDER IS LOAD-BEARING, same reasoning as `deriveWorkload`:
 * Conditional Access and Purview are tested before the broader Identity/
 * SharePoint fallbacks so a Purview retention policy on a SharePoint site
 * still classifies as Purview, not SharePoint.
 */
export function deriveWorkloadFromTouches(
  touches: Pick<M365Touches, "services" | "settings">,
): ChangeRequestWorkload {
  const signal = [...(touches.services ?? []), ...(touches.settings ?? [])].join(" | ");
  if (/conditional ?access/i.test(signal)) return "Conditional Access";
  if (/purview|retention|compliance|dlp|ediscovery/i.test(signal)) return "Purview";
  if (/intune|device management/i.test(signal)) return "Intune";
  if (/defender/i.test(signal)) return "Defender";
  if (/exchange|outlook|mailbox|calendar/i.test(signal)) return "Exchange / mail";
  if (/teams/i.test(signal)) return "Teams";
  if (/sharepoint|onedrive/i.test(signal)) return "SharePoint";
  return "Identity";
}

/**
 * `formatCrId` — the same `CR-2026-{100 + id}` formatting the MSP-side route
 * (`msp-changes.ts`) already uses, kept identical on purpose so one change
 * request has ONE code whichever console is looking at it.
 *
 * The prototype's codes are four digits (`CR-2026-0184`); the existing
 * formatter's are three (`CR-2026-101`). The existing formatter wins: a code
 * is an identifier two consoles have to agree on, and re-formatting it here
 * would mean the same row answering to two different names.
 */
export function formatChangeRequestCode(id: number): string {
  return `CR-2026-${100 + id}`;
}

/**
 * The prototype renders `pre` / `post` as pre-formatted JSON text (proto
 * 14952-14953). The columns are jsonb, so the text is rebuilt here with the
 * prototype's own two-space indent rather than stored as a string.
 */
export function formatSnapshotJson(value: unknown): string {
  if (value === null || value === undefined) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * The approvals list the prototype shows under each expanded CR (proto 14951).
 * The stored model has ONE approver column, not the prototype's ordered list of
 * named approvals, so this reconstructs what the columns can honestly support:
 * who approved, or that nobody has. It deliberately does not invent the
 * prototype's second "Second admin — awaiting" line for a change nothing has
 * recorded a second approver for.
 */
export function approvalLines(input: {
  status: string;
  approvedBy: string | null;
  changeClass: ChangeClass;
}): string[] {
  const approver = input.approvedBy?.trim();
  if (input.status === "rejected") {
    return [approver ? `Rejected by ${approver}` : "Rejected"];
  }
  if (approver) return [`Approved by ${approver}`];
  if (input.changeClass === "Standard") return ["Pre-approved — standard change"];
  return ["Awaiting approval"];
}

/**
 * How long a pre-change snapshot is kept. The design states this in two places
 * as page copy — "Pre-change state is captured at execution and held for 90
 * days" (proto 1563) and "Pre-change state, 90-day retention" (proto 15048) —
 * so it is a stated policy constant, not a tenant number, and lives here rather
 * than in a component.
 */
export const SNAPSHOT_RETENTION_DAYS = 90;

/** The window the "Emergency changes" stat card counts over (proto 15047). */
export const EMERGENCY_LOOKBACK_DAYS = 90;

/** Statuses that mean the change has not finished — the prototype's "open" set (proto 15045). */
const OPEN_DISPLAY_STATUSES = new Set<ChangeRequestDisplayStatus>([
  "Pending approval",
  "Approved",
  "Scheduled",
  "In window",
]);

export function isOpenStatus(status: ChangeRequestDisplayStatus): boolean {
  return OPEN_DISPLAY_STATUSES.has(status);
}

/**
 * The prototype gates its Approve / Reject pair on `status === 'Pending
 * approval'` and its Roll back button on `status === 'Implemented'`
 * (proto 15040-15041). Those flags are reproduced exactly.
 *
 * NOTE, because it is easy to misread as an omission: in the prototype those
 * three buttons carry NO `onClick` — only "Ask ShaneBot to explain the diff"
 * does. The flags therefore control whether an affordance is SHOWN, and the
 * route exposes no approve/reject/rollback mutation. See the route header.
 */
export function canApprove(status: ChangeRequestDisplayStatus): boolean {
  return status === "Pending approval";
}

export function canRollback(status: ChangeRequestDisplayStatus): boolean {
  return status === "Implemented";
}
