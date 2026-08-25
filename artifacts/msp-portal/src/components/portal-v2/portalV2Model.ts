/**
 * portalV2Model.ts — the read model behind the isolated Customer Portal v2
 * pillar pages.
 *
 * NOTHING HERE SCORES ANYTHING. Every number on these pages comes from
 * `GET /api/portal/assessment/war-room-pillars`, which computes pillar scores
 * through the real health engine (`computePillarDisplayScore`) against the
 * customer's own `tenant_monitor_profiles` / `msp_diagnostic_findings` rows.
 * This module only groups, orders and labels what that endpoint already sent.
 *
 * ── Why it declares its own payload types ────────────────────────────────────
 * `components/war-room/warRoomPillarStats.ts` mirrors the same endpoint, but
 * its mirror is a subset: it predates `evaluation` (#517) and `trend` (#356)
 * and does not declare either, nor `stats[].checkKey` / `stats[].licenseFeature`.
 * The server genuinely sends all of them (see api-server
 * `lib/war-room-pillar-stats.ts`, `WarRoomPillarCard`). These pages need
 * `evaluation` in particular — it is the difference between "we measured this
 * and it is bad" and "we could not measure this", which the design is explicit
 * about never conflating.
 *
 * Rather than widen the shared mirror (which the live War Room and Copilot
 * journey both consume, and which this isolated build must not disturb), the
 * richer shape is declared here and the shared hook's payload is narrowed into
 * it at the single seam in `usePortalV2Pillars`.
 */

import {
  PILLAR_KEYS,
  PILLARS,
  severityForScore,
  type PillarKey,
  type Severity,
} from "@/components/copilot-journey/journeyTokens";

/* ── Wire types (the fields this build reads) ─────────────────────────────── */

export type PortalV2StatUnit = "count" | "percent" | "currency";

/**
 * Why a pillar's score is or is not a number (#517). The three are rendered as
 * three different sentences — a bare null let all of them read as one shrug.
 */
export type PortalV2EvaluationStatus = "scored" | "insufficient_data" | "not_evaluated";

/**
 * The evaluation block as the server actually sends it — an OBJECT, not a bare
 * status string. Confirmed against a real response from the deployed API:
 *
 *   "evaluation": { "score": 56, "evaluableSignalCount": 31,
 *                   "minRequiredSignals": 2, "theoreticalMax": 163,
 *                   "status": "scored",
 *                   "reason": "scored from 31 evaluable governance signals" }
 *
 * Mirrors `PillarEvaluation` in api-server's lib/health-display.ts. `reason` is
 * documented there as "short machine-stable explanation, safe to log and to
 * surface as copy", which is why it is preferred over locally-written copy
 * wherever it is present.
 */
export interface PortalV2Evaluation {
  status: PortalV2EvaluationStatus;
  /** Non-null ONLY when `status === "scored"`. */
  score: number | null;
  evaluableSignalCount: number;
  minRequiredSignals: number;
  theoreticalMax: number;
  reason: string;
}

export interface PortalV2Stat {
  id: string;
  label: string;
  unit: PortalV2StatUnit;
  /** The real number, or null when the source genuinely has no data for it. */
  value: number | null;
  /** Machine-stable reason `value` is null (`no_data`, `not_in_scan_package`, …). */
  unavailableReason?: string;
  /** Only when `unavailableReason === "license_gap"` — the add-on Microsoft named. */
  licenseFeature?: string;
  /** The real `monitor_checks.key` behind this stat, so the UI can name it. */
  checkKey?: string | null;
  source?: string;
}

export interface PortalV2Finding {
  severity: "critical" | "warning";
  checkKey: string;
  title: string;
  /** The engine's own rank weight for this finding's pillar. 0 = unranked. */
  rankWeight?: number;
}

export interface PortalV2UpgradeLink {
  skuKey: string;
  skuName: string;
  url: string;
  checkKeys: string[];
}

export interface PortalV2PillarCard {
  pillar: string;
  enginePillar?: string;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds it. */
  score: number | null;
  /** The object described on PortalV2Evaluation — never a bare status string. */
  evaluation?: PortalV2Evaluation;
  rawRiskScore?: number;
  stats: PortalV2Stat[];
  findings: PortalV2Finding[];
  findingCounts: { critical: number; warning: number };
  /** Real replayed history. Null below the minimum real checkpoint count. */
  trend?: { series: number[]; window: string } | null;
  licenseGapUpgrades?: PortalV2UpgradeLink[];
}

/**
 * A real per-SKU ledger row (Git #1230), mirroring api-server's
 * `LicenseSkuLedgerRow` — see `license-waste-source.ts` for what real data this
 * is (and is not) sourced from.
 */
export interface PortalV2LicenseSkuLedgerRow {
  skuPartNumber: string;
  displayName: string;
  purchased: number;
  assigned: number;
  unassigned: number;
  unitMonthlyPriceCents: number;
  monthlyWasteCents: number;
  annualWasteCents: number;
}

export interface PortalV2LicenseSkuLedger {
  rows: PortalV2LicenseSkuLedgerRow[];
  totalPurchased: number;
  totalAssigned: number;
  totalUnassigned: number;
  totalMonthlyWasteCents: number;
  totalAnnualWasteCents: number;
  checkKey: string;
}

export interface PortalV2Payload {
  pillars: PortalV2PillarCard[];
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  activeRunId: string | null;
  /** Which packages this tenant has ever been scanned with — the coverage evidence. */
  scannedPackageKeys?: string[];
  scannedCheckCount?: number;
  generatedAt: string;
  /** Real per-SKU licensing ledger (Git #1230). Undefined on an older payload; null when unsourceable. */
  licenseSkuLedger?: PortalV2LicenseSkuLedger | null;
}

/* ── View model ───────────────────────────────────────────────────────────── */

/**
 * The Copilot card is in the same payload but is NOT one of the six pillars —
 * it is the roll-up gate. journeyTokens' `PILLAR_KEYS` deliberately excludes it
 * and `HeroHealthScore` filters it out of the radar for the same reason.
 */
export const PORTAL_V2_GATE_KEY = "copilot";

export interface PortalV2PillarView {
  readonly key: PillarKey;
  readonly label: string;
  /** Fixed identity colour. Never severity-driven. */
  readonly primary: string;
  readonly accent: string;
  readonly score: number | null;
  readonly evaluation: PortalV2EvaluationStatus;
  /**
   * The server's own explanation for `evaluation`, when it sent one. Preferred
   * over locally-written copy because it names the real signal counts.
   */
  readonly evaluationReason: string | null;
  /** Only meaningful when `score` is a number. */
  readonly severity: ReturnType<typeof severityForScore> | null;
  /**
   * The stats safe to show a customer: everything except our own wiring faults.
   * This is what the grid renders.
   */
  readonly stats: readonly PortalV2Stat[];
  /** Stats that resolved to a real number. */
  readonly resolvedStats: readonly PortalV2Stat[];
  /** Stats that genuinely could not be measured, with the reason preserved. */
  readonly unavailableStats: readonly PortalV2Stat[];
  /** How many stats were withheld as OUR defect. Counted, never rendered as theirs. */
  readonly withheldStatCount: number;
  readonly findings: readonly PortalV2Finding[];
  readonly findingCounts: { critical: number; warning: number };
  readonly trend: { series: number[]; window: string } | null;
  readonly upgrades: readonly PortalV2UpgradeLink[];
  /** True when the payload actually carried a card for this pillar. */
  readonly present: boolean;
}

export interface PortalV2UrgentItem {
  readonly pillar: PillarKey;
  readonly pillarLabel: string;
  readonly primary: string;
  readonly severity: "critical" | "warning";
  readonly title: string;
  readonly checkKey: string;
  readonly rankWeight: number;
}

export interface PortalV2View {
  readonly pillars: readonly PortalV2PillarView[];
  /** The Copilot Gate card — the same engine number, kept separate on purpose. */
  readonly gate: {
    score: number | null;
    evaluation: PortalV2EvaluationStatus;
    reason: string | null;
  };
  readonly urgent: readonly PortalV2UrgentItem[];
  readonly findingsRunId: string | null;
  readonly findingsRunStatus: string | null;
  readonly activeRunId: string | null;
  readonly scannedPackageKeys: readonly string[];
  readonly scannedCheckCount: number | null;
  readonly generatedAt: string | null;
  /** True when a real payload has arrived at all. */
  readonly loaded: boolean;
  /** Real per-SKU licensing ledger (Git #1230). Null until loaded or unsourceable. */
  readonly licenseSkuLedger: PortalV2LicenseSkuLedger | null;
}

const EMPTY_PILLAR = (key: PillarKey): PortalV2PillarView => ({
  key,
  label: PILLARS[key].label,
  primary: PILLARS[key].primary,
  accent: PILLARS[key].accent,
  score: null,
  evaluation: "not_evaluated",
  evaluationReason: null,
  severity: null,
  stats: [],
  resolvedStats: [],
  unavailableStats: [],
  withheldStatCount: 0,
  findings: [],
  findingCounts: { critical: 0, warning: 0 },
  trend: null,
  upgrades: [],
  present: false,
});

export const PORTAL_V2_VIEW_EMPTY: PortalV2View = {
  pillars: PILLAR_KEYS.map(EMPTY_PILLAR),
  gate: { score: null, evaluation: "not_evaluated", reason: null },
  urgent: [],
  findingsRunId: null,
  findingsRunStatus: null,
  activeRunId: null,
  scannedPackageKeys: [],
  scannedCheckCount: null,
  generatedAt: null,
  loaded: false,
  licenseSkuLedger: null,
};

/**
 * How many urgent items the Overview ranks. The design's Most Urgent list shows
 * five; the server already returns each pillar's findings worst-first, so this
 * is a cap on an existing order, not a re-ranking.
 */
export const PORTAL_V2_URGENT_LIMIT = 5;

/**
 * Order findings across pillars. Critical outranks warning; within a severity
 * the engine's own `rankWeight` decides, which is the SAME weight
 * `compareRankedFindings` uses server-side. Ties fall back to title so the list
 * is stable between renders rather than shuffling on equal weights.
 */
function compareUrgent(a: PortalV2UrgentItem, b: PortalV2UrgentItem): number {
  if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
  if (b.rankWeight !== a.rankWeight) return b.rankWeight - a.rankWeight;
  return a.title.localeCompare(b.title);
}

/** A row in the shell's "Smart alerts" tray section — see `urgentToAlertItems`. */
export interface SmartAlertItem {
  readonly pillarKey: PillarKey;
  readonly pillarLabel: string;
  readonly title: string;
  readonly why: string;
  /** Deep-links to the owning pillar page — Most Urgent lives there. */
  readonly href: string;
  /** Larger, heavier treatment on the first (most urgent) row. */
  readonly top: boolean;
}

/**
 * The tray's "Smart alerts" section, read off the SAME `urgent` ranking the
 * Overview's Most Urgent list uses — the tray's own header already promises
 * "Same ranking as Most Urgent." There is no detection timestamp on the wire
 * to narrate, so `why` states the real check behind the finding (`checkKey`)
 * rather than inventing one.
 */
export function urgentToAlertItems(
  urgent: readonly PortalV2UrgentItem[],
): readonly SmartAlertItem[] {
  return urgent.map((u, i) => ({
    pillarKey: u.pillar,
    pillarLabel: u.pillarLabel,
    title: u.title,
    why: `${u.severity === "critical" ? "Critical" : "Warning"} — ${u.checkKey}`,
    href: `/portal-v2/${u.pillar}`,
    top: i === 0,
  }));
}

/** Build the view. Pure — every input comes from the wire. */
export function buildPortalV2View(payload: PortalV2Payload | null): PortalV2View {
  if (!payload || !Array.isArray(payload.pillars)) return PORTAL_V2_VIEW_EMPTY;

  const byKey = new Map<string, PortalV2PillarCard>();
  for (const card of payload.pillars) {
    if (card && typeof card.pillar === "string") byKey.set(card.pillar, card);
  }

  const pillars = PILLAR_KEYS.map((key): PortalV2PillarView => {
    const card = byKey.get(key);
    if (!card) return EMPTY_PILLAR(key);

    const stats = Array.isArray(card.stats) ? card.stats : [];
    const shownStats = stats.filter((s) => !isWiringFault(s));
    const findings = Array.isArray(card.findings) ? card.findings : [];
    // `evaluation` is an object on the wire; read `.status` off it. Falling back
    // to the score's own nullness keeps this correct against an older payload
    // that predates #517 and sends no evaluation block at all.
    const evaluation: PortalV2EvaluationStatus =
      card.evaluation?.status ?? (typeof card.score === "number" ? "scored" : "not_evaluated");

    return {
      key,
      label: PILLARS[key].label,
      primary: PILLARS[key].primary,
      accent: PILLARS[key].accent,
      score: typeof card.score === "number" ? card.score : null,
      evaluation,
      evaluationReason: card.evaluation?.reason ?? null,
      // Severity is a statement about a measured number. A pillar with no score
      // has no severity — never a red zero.
      severity: typeof card.score === "number" ? severityForScore(card.score) : null,
      // Withhold our own wiring faults from the customer-facing grid — see
      // isWiringFault. They are counted below, not silently dropped.
      stats: shownStats,
      resolvedStats: shownStats.filter((s) => typeof s.value === "number"),
      unavailableStats: shownStats.filter((s) => typeof s.value !== "number"),
      withheldStatCount: stats.length - shownStats.length,
      findings,
      findingCounts: card.findingCounts ?? { critical: 0, warning: 0 },
      trend: card.trend ?? null,
      upgrades: Array.isArray(card.licenseGapUpgrades) ? card.licenseGapUpgrades : [],
      present: true,
    };
  });

  const gateCard = byKey.get(PORTAL_V2_GATE_KEY);
  const gate = {
    score: typeof gateCard?.score === "number" ? gateCard.score : null,
    evaluation:
      gateCard?.evaluation?.status ??
      (typeof gateCard?.score === "number" ? "scored" : "not_evaluated"),
    reason: gateCard?.evaluation?.reason ?? null,
  };

  const urgent = pillars
    .flatMap((p) =>
      p.findings.map((f) => ({
        pillar: p.key,
        pillarLabel: p.label,
        primary: p.primary,
        severity: f.severity,
        title: f.title,
        checkKey: f.checkKey,
        rankWeight: typeof f.rankWeight === "number" ? f.rankWeight : 0,
      })),
    )
    .sort(compareUrgent)
    .slice(0, PORTAL_V2_URGENT_LIMIT);

  return {
    pillars,
    gate,
    urgent,
    findingsRunId: payload.findingsRunId ?? null,
    findingsRunStatus: payload.findingsRunStatus ?? null,
    activeRunId: payload.activeRunId ?? null,
    scannedPackageKeys: payload.scannedPackageKeys ?? [],
    scannedCheckCount:
      typeof payload.scannedCheckCount === "number" ? payload.scannedCheckCount : null,
    generatedAt: payload.generatedAt ?? null,
    loaded: true,
    licenseSkuLedger:
      payload.licenseSkuLedger && Array.isArray(payload.licenseSkuLedger.rows)
        ? payload.licenseSkuLedger
        : null,
  };
}

/** Is this route param one of the six pillars? Narrows the string for a route. */
export function isPillarKey(value: string | undefined): value is PillarKey {
  return typeof value === "string" && (PILLAR_KEYS as readonly string[]).includes(value);
}

/**
 * The customer-facing sentence for a pillar that has no score. Deliberately
 * three different sentences, because they are three different facts.
 */
export function evaluationNote(
  evaluation: PortalV2EvaluationStatus,
  scanning: boolean,
  /**
   * The server's own `evaluation.reason`. Documented in health-display.ts as
   * safe to surface as copy, and it names the real signal counts ("2 evaluable
   * adoption signals, 2 required"), so it beats anything written here.
   */
  serverReason?: string | null,
): string {
  if (scanning) return "A scan is running now. This pillar will resolve when it finishes.";
  if (serverReason && serverReason.trim().length > 0) return serverReason;
  if (evaluation === "insufficient_data") {
    return "Not enough evaluable signal behind this pillar yet to state a score.";
  }
  return "No check feeding this pillar has run for your tenant yet.";
}

/** Format a stat's real value for display. Never invents a unit. */
export function formatStatValue(stat: PortalV2Stat): string {
  if (typeof stat.value !== "number") return "—";
  if (stat.unit === "percent") return `${Math.round(stat.value)}%`;
  if (stat.unit === "currency") {
    return stat.value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return stat.value.toLocaleString();
}

/**
 * Plain-English gloss for the machine-stable unavailability reasons, so a card
 * says WHICH kind of nothing it is rather than a bare dash.
 */
export function unavailableNote(stat: PortalV2Stat): string {
  switch (stat.unavailableReason) {
    case "not_in_scan_package":
      return "Not in your scan package";
    case "license_gap":
      return stat.licenseFeature
        ? `Needs ${stat.licenseFeature}`
        : "Needs a Microsoft add-on you do not have";
    case "no_data":
      return "Scanned, nothing reported";
    case "no_seat_data":
      return "No seat data";
    default:
      return "Not available";
  }
}

/**
 * Reasons that are OUR wiring fault, not a fact about the customer's tenant.
 *
 * Mirrors `WAR_ROOM_STAT_WIRING_FAULT_REASONS` in api-server's
 * war-room-pillar-stats.ts, which exists so consumers classify identically.
 * A real response from the deployed API carries these today — e.g.
 * `governance.sites` resolves `unknown_check_key` because its
 * `compliance:sharepoint-sites` key is not in the catalog.
 *
 * Printing "not wired to a check in the catalogue" to a customer states our own
 * defect as though it were a gap in their environment, so these stats are
 * dropped from the customer-facing grid entirely rather than rendered with a
 * reason. They are still counted, so the page can say how many it withheld.
 */
const WIRING_FAULT_REASONS: readonly string[] = [
  "unknown_check_key",
  "unknown_metric_key",
  "resolver_error",
];

export function isWiringFault(stat: PortalV2Stat): boolean {
  return (
    typeof stat.unavailableReason === "string" &&
    WIRING_FAULT_REASONS.includes(stat.unavailableReason)
  );
}

/**
 * The shell's sidebar "Tenant health" bar (Customer Portal Shell.dc.html
 * 76-86 / 8713-8730). The design's fixture computes `overallScore` as the
 * mean of its six hardcoded pillar scores and picks a `tenantStage`
 * (bad/decent/good) from a prop; this is the same computation against the
 * SAME real six pillar scores this build already wires everywhere else
 * (`usePortalV2Pillars`) — no second source, no invented copy, the stage
 * labels are the design's own `stageMeta` strings.
 */
export interface TenantHealthSummary {
  /** Rounded mean of every scored pillar. Null when nothing is scored yet. */
  readonly score: number | null;
  /** Null exactly when `score` is null — a pillarless average has no band. */
  readonly severity: Severity | null;
  /** The design's own stageMeta label for this band. */
  readonly label: string;
}

/** Mirrors Customer Portal Shell.dc.html's `stageMeta` labels (8726-8730). */
const TENANT_HEALTH_STAGE_LABEL: Readonly<Record<Severity, string>> = {
  critical: "Needs attention",
  attention: "Improving",
  healthy: "Healthy",
};

export function tenantHealthSummary(view: PortalV2View): TenantHealthSummary {
  const scores = view.pillars
    .map((p) => p.score)
    .filter((s): s is number => typeof s === "number");

  if (scores.length === 0) {
    return { score: null, severity: null, label: "Not yet scored" };
  }

  const score = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  const severity = severityForScore(score);
  return { score, severity, label: TENANT_HEALTH_STAGE_LABEL[severity] };
}
