/**
 * Wire shapes and normalisers for the Engines screen.
 *
 * Everything here describes what `routes/admin-engines.ts` actually returns.
 * Nothing invents a figure: where an engine's output has no single score, or
 * where a breakdown row carries no `contribution` field, these helpers return
 * `null` and the screen says so rather than computing something plausible.
 * handoff.md section 6's "cannot read" state is the model — the failure the
 * user was blind to has to stay visible.
 */

import { ACCENT, ACCENT_TEXT, TEXT } from "../../theme";

// ─── Engine registry ──────────────────────────────────────────────────────────

/** How an engine is configured. Mirrors GET /admin/engines' `configMode`. */
export type EngineConfigMode = "signal-rules" | "backing-table" | "aggregator";

/** One row of GET /api/admin/engines. */
export interface EngineDefLite {
  key: string;
  label: string;
  description: string;
  categoryPrefix: string;
  tenantScoped: boolean;
  dependsOn: string[];
  configMode: EngineConfigMode;
  backingTable: string | null;
}

/** A testbed customer, from GET /api/admin/testbeds. */
export interface Testbed {
  id: number;
  mspId: number | null;
  name: string;
  domain: string | null;
  isTestbed: boolean;
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

/**
 * The `display` block every engine run carries.
 *
 * Written by the `runForTenant` wrapper in `lib/engine-registry.ts`, per
 * engine — it is the server's own summary of what the run found, which is why
 * the engine cards render it verbatim instead of composing their own prose.
 */
export interface EngineDisplay {
  title: string;
  status: string;
  impact: string;
  recommendation: string;
}

/** One line of the signal trace the run wrapper attaches. */
export interface EngineTraceLine {
  ruleId: string;
  outcome: string;
  reasoning: string;
}

/** The wrapped output of one engine run. Engine-specific fields vary; these do not. */
export interface EngineRunOutput {
  engine?: string;
  score?: unknown;
  breakdown?: unknown;
  rawSignals?: string[];
  trendDirection?: string;
  display?: EngineDisplay;
  trace?: EngineTraceLine[];
  timestamp?: string;
  [key: string]: unknown;
}

export interface EngineTestResponse {
  mode: "tenant" | "payload";
  customerId?: number;
  output: EngineRunOutput;
}

export interface EnginePreviewResponse extends EngineTestResponse {
  workflowOutputPreview?: Record<string, boolean>;
  sowImpactPreview?: Array<{ signalKey: string; pricingImpact: number; pricingValueContribution: number }>;
  mspImpactPreview?: { note: string } | null;
}

/** POST /api/simulator/orchestrated-pipeline/run. */
export interface PipelineRunResponse {
  engines: Record<string, { ok: boolean }>;
  executionMs: number;
}

/** POST /api/admin/simulator/run — one output per step of the replay. */
export interface ReplayResponse {
  traces: Array<{ timestamp: string; output: EngineRunOutput }>;
}

// ─── History ──────────────────────────────────────────────────────────────────

export interface EngineHistoryPoint {
  date: string;
  score: number;
  previousScore: number | null;
  delta: number | null;
  trendDirection: string | null;
  source: "snapshot" | "rollup";
}

/** The full latest snapshot row, including the breakdown the series omits. */
export interface EngineSnapshot {
  id: number;
  engineKey: string;
  score: number;
  previousScore: number | null;
  delta: number | null;
  trendDirection: string | null;
  breakdown: Record<string, unknown>[];
  rawSignals: string[];
  capturedAt: string;
}

export interface EngineHistoryResponse {
  engineKey: string;
  customerId: number;
  series: EngineHistoryPoint[];
  baselineEvents: Array<{ id: number; baselineScore: number; resetTriggerType: string | null; createdAt: string }>;
  signalDeltas: Array<{ signalKey: string; label: string; direction: string; date: string }>;
  latest: EngineSnapshot | null;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface ConfigColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "bool" | "array" | "date";
}

/** A signal_derivation_rules row, as GET .../configuration returns it. */
export interface SignalRuleRow {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  severity: string | null;
  category: string | null;
  pillar: string | null;
  weight: number | null;
  [key: string]: unknown;
}

/** A signal_rule_groups row. */
export interface SignalGroupRow {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  severity: string | null;
  weight: number | null;
  [key: string]: unknown;
}

export interface EngineConfigResponse {
  mode: "signal-rules" | "backing-table" | "aggregator";
  rules?: SignalRuleRow[];
  groups?: SignalGroupRow[];
  /** backing-table / aggregator only. */
  title?: string;
  description?: string;
  backingTable?: string;
  columns?: ConfigColumn[];
  items?: Record<string, unknown>[];
  count?: number;
  dependsOn?: string[];
}

// ─── Score normalisation ──────────────────────────────────────────────────────

/**
 * The headline figure from a run, and what it is.
 *
 * Not every engine has one: `pricing` returns two totals and `crm` returns
 * five dimensions, so `value` is null for them and `note` says why. Returning
 * a synthesised single number here would be inventing the engine's own answer.
 */
export interface EngineScore {
  value: number | null;
  /** What the number is, when there is one. */
  label: string;
  /** Present only when there is no single score. */
  note?: string;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function scoreOfOutput(output: EngineRunOutput | null | undefined): EngineScore {
  if (!output) return { value: null, label: "score", note: "Nothing has been run yet." };
  const raw = output.score;

  const plain = num(raw);
  if (plain !== null) return { value: plain, label: "score" };

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const pricing = num(obj.totalPricingImpact);
    if (pricing !== null) return { value: pricing, label: "pricing impact" };
    const total = num(obj.total);
    if (total !== null) return { value: total, label: "combined score" };
  }

  return {
    value: null,
    label: "score",
    note: "This engine does not return a single score — see the breakdown below for what it did return.",
  };
}

/**
 * True when the engine's own output has no plain-number score.
 *
 * Worth surfacing, because `writeEngineSnapshot` records `0` in that case, so
 * this engine's recorded history is flat zeroes and the Score tab would
 * otherwise be quietly lying about it.
 */
export function historyUnderreportsScore(output: EngineRunOutput | null | undefined): boolean {
  return Boolean(output) && num(output?.score) === null;
}

// ─── Breakdown → trace rows ───────────────────────────────────────────────────

/** One line of "how that number was reached". */
export interface TraceRow {
  id: string;
  /** The signal, or the pillar for a grouped breakdown. */
  name: string;
  /** The band this row sorts under — a pillar name, or "" for a flat breakdown. */
  band: string;
  /** What it cost or added. Null when the breakdown row carries no single contribution. */
  impact: number | null;
  /** Everything else numeric on the row, as label/value pairs. */
  detail: Array<[string, string]>;
}

/** Fields that identify a breakdown row rather than measure it. */
const NON_MEASURE_KEYS = new Set(["signalKey", "pillar", "category", "source", "sourceId", "trendDirection", "id"]);

function measuresOf(row: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(row)) {
    if (NON_MEASURE_KEYS.has(k) || k === "contribution" || k === "value") continue;
    // A genuine 0 is a real measured value (Git #515) — only drop non-numbers/NaN/Infinity.
    if (typeof v === "number" && Number.isFinite(v)) out.push([humanise(k), String(v)]);
  }
  return out;
}

/** `governanceImpact` → `governance impact`. Field names are the vocabulary here; keep them recognisable. */
export function humanise(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

/**
 * Flattens any engine's `breakdown` into trace rows.
 *
 * The shapes genuinely differ — priority is `{signalKey, contribution}`,
 * health is `{pillar, score, contributions[]}`, drift and forecasting carry
 * trend fields, CRM carries five dimensions and no single contribution. This
 * reads whichever of `contribution` / `value` is actually present and leaves
 * `impact` null when neither is, rather than picking one of the five and
 * calling it the answer.
 */
export function traceRowsOf(breakdown: unknown): TraceRow[] {
  if (!breakdown) return [];
  const entries = Array.isArray(breakdown) ? breakdown : [breakdown];
  const rows: TraceRow[] = [];

  entries.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;

    const nested = row.contributions;
    if (Array.isArray(nested)) {
      const band = String(row.pillar ?? row.category ?? "");
      nested.forEach((c, j) => {
        if (!c || typeof c !== "object") return;
        const cr = c as Record<string, unknown>;
        rows.push({
          id: `${i}-${j}-${String(cr.signalKey ?? j)}`,
          name: String(cr.signalKey ?? "unnamed"),
          band,
          impact: num(cr.value) ?? num(cr.contribution),
          detail: measuresOf(cr),
        });
      });
      return;
    }

    rows.push({
      id: `${i}-${String(row.signalKey ?? i)}`,
      name: String(row.signalKey ?? row.pillar ?? `row ${i + 1}`),
      band: String(row.category ?? ""),
      impact: num(row.contribution) ?? num(row.value),
      detail: measuresOf(row),
    });
  });

  return rows;
}

/** Sum of the rows that actually carry a contribution. Null when none do. */
export function traceTotal(rows: TraceRow[]): number | null {
  const measured = rows.filter((r) => r.impact !== null);
  if (measured.length === 0) return null;
  return measured.reduce((a, r) => a + (r.impact ?? 0), 0);
}

// ─── Tone ─────────────────────────────────────────────────────────────────────

/**
 * Colour for a run's `status`.
 *
 * The statuses are the server's own strings (`CRITICAL_RISK`, `STABLE`,
 * `DRIFT_DETECTED`, …), so this matches on the words rather than an enum —
 * a new status the server invents lands on neutral instead of throwing.
 */
export function statusTone(status: string | undefined): string {
  if (!status) return TEXT.dim;
  const s = status.toUpperCase();
  if (/CRITICAL|RISK|BREACH|FAIL|DRIFT_DETECTED/.test(s)) return ACCENT_TEXT.danger;
  if (/WARN|ATTENTION|ACCELERAT|EXPANSION|OFFER|ENGAGEMENT/.test(s)) return ACCENT.amber;
  if (/HEALTHY|SECURE|STABLE|COMPLIANT|OPTIMIZED|ACTIVE/.test(s)) return ACCENT_TEXT.green;
  return ACCENT_TEXT.neutral;
}

export function severityTone(severity: string | null | undefined): string {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return ACCENT.danger;
    case "major":
    case "high":
      return ACCENT.amberDim;
    case "minor":
    case "low":
      return ACCENT.info;
    default:
      return TEXT.dim;
  }
}

/** "8 Aug", the label under a history bar. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
