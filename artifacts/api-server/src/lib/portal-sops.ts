/**
 * portal-sops.ts — the pure derivations behind the customer-scoped SOPs &
 * Runbooks routes.
 *
 * Kept out of `routes/portal-sops.ts` for the same reason `portal-hold-windows.ts`
 * is kept out of `portal-runbooks.ts`: every one of these is a decision about how
 * a stored column becomes a sentence on the customer's screen, and each one is
 * worth a unit test that does not need a database.
 *
 * ── The honest-mapping rule ────────────────────────────────────────────────
 * `msp_sops` and `msp_sop_runs` were built for the MSP console, and the design's
 * SOP hub asks for a handful of things those tables do not store. The rule
 * applied throughout this file is that a derived value must be TRUE of the row it
 * came from — never a plausible-looking invention that fills a gap.
 *
 * So `level`, `runnable`, `mode` and `who runs it` all derive from
 * `automation_type` and from whether a step actually carries a `graphEndpoint`,
 * because those genuinely determine them. Review cadence is NOT stored anywhere,
 * so it reads "Not recorded" rather than being guessed from `version_status` —
 * a cadence the customer might rely on is not a field to make up.
 *
 * ── The evidence hash is a real digest ─────────────────────────────────────
 * The audit view's own copy promises "every entry is hashed and exportable —
 * this is the evidence an auditor asks for". `evidenceHash` therefore computes a
 * real SHA-256 over the entry's own canonical fields and shows the design's
 * first4…last4 form. It is reproducible from the record, which is the only thing
 * that makes the claim on screen true; a random-looking string would have
 * rendered identically and meant nothing.
 */

import { createHash } from "node:crypto";

/** The design's two source buckets — see SOP_SOURCE_META in the portal. */
export type WireSopSource = "baseline" | "ours";

/** One step as `msp_sops.steps` stores it (validated by msp-sops.ts on write). */
export interface StoredSopStep {
  readonly stepNumber?: number;
  readonly title?: string;
  readonly description?: string;
  readonly type?: string;
  readonly graphEndpoint?: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/**
 * `msp_sops.steps` is jsonb, so it arrives as `unknown` no matter what the
 * insert schema promised. Anything that is not an object becomes an empty step
 * rather than throwing — one malformed row must not take the whole library down.
 */
export function readSteps(raw: unknown): StoredSopStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => (s && typeof s === "object" ? (s as StoredSopStep) : {}));
}

/** The step's own sentence: its description if it has one, else its title. */
export function stepText(step: StoredSopStep): string {
  const description = (step.description ?? "").trim();
  const title = (step.title ?? "").trim();
  if (description && title) return `${title} — ${description}`;
  return description || title || "Step details not recorded.";
}

/** A step is automated when it actually names an endpoint to call. */
export function stepEndpoint(step: StoredSopStep): string {
  return (step.graphEndpoint ?? "").trim();
}

/** How many of a SOP's steps can genuinely run through Graph/PowerShell. */
export function automatedStepCount(steps: readonly StoredSopStep[]): number {
  return steps.filter((s) => stepEndpoint(s) !== "").length;
}

/**
 * The design's four execution levels (SOP_EXEC_TYPES). Derived from
 * `automation_type` — the column that means exactly this — with one correction
 * the column cannot make on its own: a SOP with no steps at all cannot be
 * executed whatever its type says, so it reads as reference.
 */
export function sopLevel(automationType: string, stepCount: number): string {
  if (stepCount === 0) return "Reference only";
  switch (automationType.trim().toLowerCase()) {
    case "automated":
      return "Fully automated";
    case "hybrid":
      return "Partially automated";
    case "manual":
      return "Manual with verification";
    default:
      return "Reference only";
  }
}

/**
 * "Runnable" on this page means the platform can actually execute part of it,
 * which is true exactly when a step carries an endpoint. Deliberately NOT
 * `automation_type !== 'manual'`: a row typed `hybrid` whose steps carry no
 * endpoint has nothing to run, and the library's Runnable flag would be a lie.
 */
export function sopRunnable(steps: readonly StoredSopStep[]): boolean {
  return automatedStepCount(steps) > 0;
}

/**
 * The detail panel's "Who runs it". `automation_type` is the only stored fact
 * that bears on this, and it bears on it directly.
 */
export function whoRunsIt(automationType: string, stepCount: number): string {
  if (stepCount === 0) return "Reference only — there is nothing to execute.";
  switch (automationType.trim().toLowerCase()) {
    case "automated":
      return "Runs automatically through Graph, with no manual steps.";
    case "hybrid":
      return "Run by us, with the automated steps executed through Graph.";
    case "manual":
      return "Run by hand, with each step verified before the next.";
    default:
      return "Not recorded.";
  }
}

/**
 * `2026-08-19` → `19 August 2026`. `msp_sops.last_updated_at` is a text column
 * holding a plain date; anything that is not parseable is returned verbatim
 * rather than becoming "Invalid Date" on screen.
 */
export function formatLongDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const [, y, m, d] = match;
  const monthIndex = Number(m) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value.trim();
  return `${Number(d)} ${MONTHS[monthIndex]} ${y}`;
}

/** The design's own "Updated 4 August 2026 · v4" line. */
export function formatUpdated(lastUpdatedAt: string, version: string): string {
  const date = formatLongDate(lastUpdatedAt);
  const v = version.trim();
  return v ? `Updated ${date} · ${v}` : `Updated ${date}`;
}

/** `19 Aug 2026 · 09:14:22`, the audit table's timestamp form. UTC. */
export function formatAuditTimestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getUTCDate()} ${SHORT_MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}` +
    ` · ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`
  );
}

/** `700` → `11m 40s`, the design's average-execution form. */
export function formatDurationSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * "Started 4 minutes ago" / "Queued 6 minutes ago". The queue's own line, and
 * the reason the payload is not cacheable for long.
 */
export function relativeSince(iso: string, now: Date, verb: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return `${verb} at an unrecorded time`;
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return `${verb} less than a minute ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${verb} ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${verb} ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${verb} ${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Which runs belong on the live queue, and how they read there.
 * `In Progress` is running; `Blocked` is the design's Queued state — it is
 * waiting on something rather than executing. A finished run returns null and
 * goes to the history view instead.
 */
export function queueStateFor(status: string): "Running" | "Queued" | null {
  const s = status.trim().toLowerCase();
  if (s === "in progress") return "Running";
  if (s === "blocked") return "Queued";
  return null;
}

/**
 * The queue row's "Automated steps only" / "Full execution". A run records how
 * many steps were IN SCOPE (`total_steps`); when that is fewer than the SOP's
 * own step count, the operator narrowed the scope, which on this page is exactly
 * what "automated steps only" means.
 */
export function runModeLabel(runTotalSteps: number, sopStepCount: number): string {
  if (sopStepCount > 0 && runTotalSteps > 0 && runTotalSteps < sopStepCount) {
    return "Automated steps only";
  }
  return "Full execution";
}

/**
 * done / now / todo per step, from the run's own counters. `passed_steps_count`
 * is the count that actually completed; `current_step_index` is where the run
 * is now — they are separate columns and a blocked run has a gap between them,
 * so both are honoured rather than deriving one from the other.
 */
export function stepStates(
  stepCount: number,
  currentStepIndex: number,
  passedStepsCount: number,
): ("done" | "now" | "todo")[] {
  const out: ("done" | "now" | "todo")[] = [];
  for (let i = 0; i < stepCount; i += 1) {
    if (i < passedStepsCount) out.push("done");
    else if (i === currentStepIndex) out.push("now");
    else out.push("todo");
  }
  return out;
}

/** `62` from 5 of 8. Zero-safe: a run with no steps in scope reads 0%, not NaN. */
export function progressPct(passedStepsCount: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((passedStepsCount / totalSteps) * 100)));
}

/**
 * The run-history row's state, in the vocabulary `runStateTone` already colours:
 * Complete (green), Part-complete / Failed (amber-to-red), Dry run (grey).
 * A completed run that did not pass every step in its own scope is honestly
 * part-complete rather than Complete.
 */
export function runStateLabel(status: string, passedStepsCount: number, totalSteps: number): string {
  const s = status.trim().toLowerCase();
  if (s === "failed") return "Failed";
  if (s === "blocked") return "Blocked";
  if (s === "in progress") return "In progress";
  if (s === "completed") {
    return totalSteps > 0 && passedStepsCount < totalSteps ? "Part-complete" : "Complete";
  }
  return status.trim();
}

/** The audit table's Result chip. Same rule as runStateLabel, three-valued. */
export function auditResult(
  status: string,
  passedStepsCount: number,
  totalSteps: number,
): "Success" | "Partial" | "Failure" {
  const s = status.trim().toLowerCase();
  if (s === "failed") return "Failure";
  if (s === "completed" && totalSteps > 0 && passedStepsCount < totalSteps) return "Partial";
  if (s === "completed") return "Success";
  return "Partial";
}

/**
 * A real SHA-256 over the entry's canonical fields, rendered in the design's
 * `a91f…7c02` form. Reproducible from the record — see the file header for why
 * that matters more than it looks.
 */
export function evidenceHash(...parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join(" "), "utf8").digest("hex");
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/**
 * A person, as the page should name them. `msp_sop_runs.operator` and
 * `msp_sops.last_updated_by` both hold whatever the writer put there — usually
 * an email. A resolved display name wins; otherwise the local part is title-cased
 * so the avatar has real initials to show instead of "—".
 */
export function personLabel(raw: string, resolvedName?: string | null): string {
  const name = (resolvedName ?? "").trim();
  if (name) return name;
  const value = raw.trim();
  if (!value) return "Unassigned";
  const local = value.includes("@") ? value.slice(0, value.indexOf("@")) : value;
  return (
    local
      .split(/[._\-+]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || value
  );
}

/**
 * A stable colour for a real person, so the same operator keeps the same avatar
 * tone across the library and the queue. The palette is the design's own RACI
 * set (sopHubData's RACI_PEOPLE tones); only the assignment is derived, because
 * there is no stored colour and an arbitrary-but-stable one is honest where an
 * arbitrary-and-changing one would not be.
 */
const OWNER_TONES = [
  "#f472b6",
  "#fbbf24",
  "#60a5fa",
  "#34d399",
  "#a78bfa",
  "#22d3ee",
  "#38bdf8",
  "#f87171",
];

export function ownerTone(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum = (sum + name.charCodeAt(i)) % 4096;
  return OWNER_TONES[sum % OWNER_TONES.length];
}

/** Whole calendar month match, for the "Executions this month" stat card. */
export function isSameUtcMonth(iso: string, now: Date): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return at.getUTCFullYear() === now.getUTCFullYear() && at.getUTCMonth() === now.getUTCMonth();
}

/** Seconds between two stored timestamps, or null when either is unusable. */
export function durationSeconds(startedAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const from = new Date(startedAt).getTime();
  const to = new Date(completedAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return (to - from) / 1000;
}
