/**
 * free-scan-sow.ts — Git #1374 (Phase of Feature #1352, Free Scan).
 *
 * The Statement of Work the Review step renders: a real contract artifact
 * computed from ONE Free Scan Prospect's own scan, for the scope they have
 * selected.
 *
 * ── Fixed structure + tenant-specific data ────────────────────────────────────
 * The same pattern the platform's other real document types already use (see
 * `document-types.ts`): the SHAPE of the document is fixed and reviewed, and
 * every NUMBER in it comes from this tenant. Nothing here is free-form
 * generation and nothing here is a fixture.
 *
 *   FIXED (the structure), and it lives in the Products Catalog, not in code:
 *     the six remediation phases are six real `services` rows
 *     (`category = 'project'`) — `PHASE_SLUGS` below names them in delivery
 *     order. Their name, customer-facing description, fixed fee
 *     (`resolveServicePriceCents`), duration (`type_attributes.durationWeeks`),
 *     deliverables (`type_attributes.deliverables`) and whether they need a
 *     change window (`type_attributes.requiresChangeWindow`) are all read off
 *     those rows. A price is never written in a `.tsx` and never written here.
 *
 *   TENANT-SPECIFIC (the data): every score, finding, count and date comes from
 *     `buildPillarSummary(customerId)` — the SAME real computation
 *     `GET /api/portal/pillars` and the Free Scan results screen (#1358) read.
 *     No second scoring model, no re-derivation.
 *
 * ── The projection ("41 → N"), and why it is not a new scoring formula ────────
 * `health-display.ts` scores a pillar as
 *
 *     score = 100 − (rawRiskScore / theoreticalMax) × 100
 *
 * where `rawRiskScore` is the summed impact of the signals that actually fired
 * for this tenant, and every finding on a pillar card carries `rankWeight` —
 * the real impact of its own check FOR THAT PILLAR, resolved through
 * `buildFindingRankWeights` from the very same `getSignalHealthImpacts` map the
 * score itself is computed from.
 *
 * So "what would this pillar score once this phase has cleared its findings" is
 * the IDENTICAL expression with the cleared weight subtracted from the raw term:
 *
 *     projected = 100 − (max(0, rawRiskScore − Σ rankWeight) / theoreticalMax) × 100
 *
 * Nothing is re-weighted, re-banded or invented; the denominator, the weights
 * and the formula are the platform's own. A pillar whose evaluation is not
 * `"scored"` (#517 — too little real coverage to state a number) projects to
 * `null`, exactly as it scores to null today. The headline readiness figure is
 * the Copilot pillar treated the same way, against the real
 * `COPILOT_GATE_THRESHOLD`.
 *
 * ── What this file deliberately does NOT produce ──────────────────────────────
 * A licence-uplift ("the E5 uplift for N users") dollar figure. Nothing in this
 * platform computes one: `licenseGapPurchase` (#489) resolves WHICH categories
 * are gapped and which add-on answers them, not the cost of moving a named
 * population onto E5. The Commercial Terms section omits that row rather than
 * approximating it — the same "named rather than faked" stance
 * `PILLAR_UNPRODUCIBLE_STATS` takes in pillar-summary-stats.ts. Filed as a real
 * finding; see the issue trail on #1374.
 */

import { db, servicesTable, tenantsTable, monitorChecksTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  buildPillarSummary,
  buildFindingRankWeights,
  FINDING_RANK_IMPACT_FIELD,
  type PillarSummaryCard,
  type PillarSummaryKey,
  type CheckRankWeights,
} from "./pillar-summary-stats.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { getSignalHealthImpacts } from "./health-engine.ts";
import { COPILOT_GATE_THRESHOLD } from "./copilot-gate.ts";
import { resolveTenantMonitoringAddon, resolveArchitectRetainerAddon } from "./sow-monitoring-addon.ts";
import { resolveServicePriceCents } from "./catalog-pricing.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

// ── Fixed structure ───────────────────────────────────────────────────────────

/**
 * The six remediation phases, in delivery order, as real `services.slug` values.
 *
 * Phase 1 is `required` — it is the identity work that has to land before
 * Copilot is enabled for anyone, and the rail cannot deselect it. The other five
 * are the customer's scope decision.
 *
 * `pillar` is which War Room pillar's findings the phase clears. One phase, one
 * pillar: this is the mapping that lets the document say "this phase addresses
 * THESE findings" and mean it.
 */
export const FREE_SCAN_SOW_PHASES: ReadonlyArray<{
  slug: string;
  pillar: PillarSummaryKey;
  pillarLabel: string;
  accentColor: string;
  required: boolean;
}> = [
  { slug: "identity-access-hardening", pillar: "security", pillarLabel: "Security", accentColor: "#8B5CF6", required: true },
  { slug: "sharing-exposure-remediation", pillar: "governance", pillarLabel: "Governance", accentColor: "#3B82F6", required: false },
  { slug: "data-protection-baseline", pillar: "compliance", pillarLabel: "Compliance", accentColor: "#F3F4F6", required: false },
  { slug: "licence-rationalisation", pillar: "licensing", pillarLabel: "Licensing", accentColor: "#14B8A6", required: false },
  { slug: "adoption-enablement", pillar: "adoption", pillarLabel: "Adoption", accentColor: "#F97316", required: false },
  { slug: "drift-baseline-handover", pillar: "health", pillarLabel: "Health", accentColor: "#22C55E", required: false },
];

export const FREE_SCAN_SOW_PHASE_SLUGS: readonly string[] = FREE_SCAN_SOW_PHASES.map((p) => p.slug);

/**
 * Pay the whole selected scope up front and 20% comes off. Only ever offered on
 * the FULL six-phase scope — a discount for taking a narrower scope would be a
 * discount for buying less, which is not the offer.
 */
export const FULL_SCOPE_DISCOUNT_PCT = 20;

/** Deposit taken at signature on the phased plan; the balance invoices per phase sign-off. */
export const PHASED_DEPOSIT_PCT = 40;

/** How long a scan-derived quote holds before a fresh scan is required. */
export const QUOTE_VALIDITY_DAYS = 30;

/**
 * The optional services the rail can add are NOT resolved here.
 *
 * `sow-monitoring-addon.ts` is this platform's one real answer to "which
 * optional services may a SOW offer, and at what price for this tenant" —
 * Tenant Monitoring priced at the tenant's real paid seat band (with #632's
 * SMB-floor fallback when no seat count can be sourced) and the Architect
 * Retainer's three real tiers, both off real catalog rows and both already
 * carrying the corrections #609, #632 and #4074 made to exactly this
 * resolution. It is reused verbatim rather than re-derived: a second band
 * matcher here is how #4074's bug happened the first time.
 *
 * The design's third add-on (White-Glove Copilot Adoption, three tiers) has no
 * tier family in the catalog to price against, and that resolver's own header
 * states the allowed set is those two. It is deliberately not invented here;
 * filed as a finding on #1374 instead.
 */
const ADDON_TIER_LABELS: Readonly<Record<string, string>> = {
  "tenant-monitoring": "Seat band",
  "architect-retainer": "Monthly hours",
};

// ── Wire shapes ───────────────────────────────────────────────────────────────

export interface SowPhase {
  slug: string;
  /** 1-based delivery order. */
  order: number;
  name: string;
  description: string | null;
  pillar: PillarSummaryKey;
  pillarLabel: string;
  accentColor: string;
  required: boolean;
  selected: boolean;
  feeCents: number;
  durationWeeks: number;
  /** Real `type_attributes.deliverables`; empty when the catalog row has none. */
  deliverables: string[];
  requiresChangeWindow: boolean;
  /** Real findings this phase clears — the pillar's own, from this tenant's scan. */
  findingCount: number;
  criticalCount: number;
  /** The real finding titles, worst first, so the card can name its own evidence. */
  addresses: string[];
  /** Real pillar score today, and where clearing those findings puts it. Null when unscored. */
  pillarScoreNow: number | null;
  pillarScoreProjected: number | null;
  /** Gantt placement, in weeks from kickoff. Null when the phase is out of scope. */
  startWeek: number | null;
}

/**
 * One tier of one optional service, flattened from `ResolvedAddonTier`
 * (sow-monitoring-addon.ts) into the cents this document prices everything in.
 */
export interface SowAddonTier {
  tierId: string;
  label: string;
  /** One-time cents; 0 for a purely recurring tier. */
  oneOffCents: number;
  /** Recurring cents per month; 0 for a purely one-time tier. */
  monthlyCents: number;
  detail: string | null;
  /** Why this tier is called out — `seat-match` is the tenant's own real band. */
  emphasis: "seat-match" | "recommended" | null;
}

export interface SowAddon {
  /** `ResolvedSowAddon.id` — e.g. `tenant-monitoring`, `architect-retainer`. */
  addonId: string;
  name: string;
  blurb: string;
  tierLabel: string;
  tiers: SowAddonTier[];
  selected: boolean;
  /** The chosen tier's id, or null when the add-on is not taken. */
  selectedTierId: string | null;
}

export interface SowFindingLine {
  pillar: PillarSummaryKey;
  pillarLabel: string;
  severity: "critical" | "warning";
  title: string;
}

export interface SowPillarLine {
  pillar: PillarSummaryKey;
  label: string;
  accentColor: string;
  findingCount: number;
  scoreNow: number | null;
  /** The real finding titles this pillar raised, worst first. */
  findingTitles: string[];
  /** False once the phase that clears this pillar has been deselected. */
  inScope: boolean;
}

export interface FreeScanSow {
  /** Stable, human-readable SOW id printed on the document. */
  reference: string;
  customerName: string;
  /** When the scan this document is built from actually ran. */
  scanGeneratedAt: string;
  /** Whole days between the scan and now — the document's own "elapsed" row. */
  daysSinceScan: number;
  /** Real count of `monitor_checks` this tenant was actually scanned with. */
  scannedCheckCount: number;
  /** Last date this quote holds before a fresh scan is required (ISO date). */
  quoteValidUntil: string;

  readiness: {
    now: number | null;
    projected: number | null;
    threshold: number;
    /** Real reason the score is (or is not) a number — straight off the pillar evaluation. */
    evaluationStatus: string;
    evaluationReason: string;
  };

  totals: {
    totalFindings: number;
    criticalFindings: number;
    findingsInScope: number;
    /** Real annual licence waste off the Licensing pillar's own stat, in dollars. */
    annualWasteDollars: number | null;
    phasesSelected: number;
    phaseCount: number;
    weeksToCertification: number;
    weeksToCopilotEnablement: number;
    deliverableCount: number;
    changeWindowCount: number;
    /** Gross professional-services fee for the selected scope, before any discount. */
    servicesGrossCents: number;
    /** What the pay-in-full plan charges (gross less the full-scope discount, when it applies). */
    servicesFullPlanCents: number;
    /** What the phased plan takes at signature. */
    depositCents: number;
    /** The amount the currently-chosen plan charges today. */
    chargedNowCents: number;
    /** Recurring, from month one, for the selected add-ons. */
    recurringMonthlyCents: number;
    /** One-time add-on fees, already included in the gross total. */
    addonOneOffCents: number;
    discountApplies: boolean;
    discountPct: number;
    depositPct: number;
  };

  phases: SowPhase[];
  addons: SowAddon[];
  pillars: SowPillarLine[];
  /** The critical findings holding the gate below its threshold, worst first. */
  gateBlockers: SowFindingLine[];

  selection: {
    phaseSlugs: string[];
    addons: Array<{ addonId: string; tierId: string }>;
    paymentPlan: "full" | "phased";
  };

  signature: {
    signed: boolean;
    signedAt: string | null;
    signerName: string | null;
    signerRole: string | null;
  };

  status: "draft" | "signed" | "paid";
}

export interface SowSelection {
  phaseSlugs: readonly string[];
  addons: ReadonlyArray<{ addonId: string; tierId: string }>;
  paymentPlan: "full" | "phased";
}

/** Everything a caller needs to know when the SOW cannot be built yet. */
export type FreeScanSowResult =
  | { status: "scanning"; activeRunId: string | null; findingsRunId: string | null }
  | { status: "ready"; sow: FreeScanSow };

// ── Catalog reads ─────────────────────────────────────────────────────────────

interface PhaseTypeAttributes {
  durationWeeks?: number | string | null;
  deliverables?: unknown;
  requiresChangeWindow?: boolean | null;
  stage?: string | null;
}

type CatalogRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  visibility: string | null;
  priceCents: number | null;
  price: string | null;
  basePrice: string | null;
  typeAttributes: unknown;
};

const catalogColumns = {
  id: servicesTable.id,
  slug: servicesTable.slug,
  name: servicesTable.name,
  description: servicesTable.description,
  category: servicesTable.category,
  visibility: servicesTable.visibility,
  priceCents: servicesTable.priceCents,
  price: servicesTable.price,
  basePrice: servicesTable.basePrice,
  typeAttributes: servicesTable.typeAttributes,
};

function phaseAttrs(row: CatalogRow): PhaseTypeAttributes {
  return (row.typeAttributes ?? {}) as PhaseTypeAttributes;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

// ── The projection ────────────────────────────────────────────────────────────

/**
 * Re-run `health-display.ts`'s own normalization with `clearedWeight` taken off
 * the raw risk term. Same formula, same denominator — see the file header for
 * why this is not a second scoring model.
 *
 * Returns null whenever the pillar has no score to project from, so an unscored
 * pillar stays unscored rather than acquiring a number through remediation
 * arithmetic.
 */
export function projectPillarScore(
  card: Pick<PillarSummaryCard, "score" | "rawRiskScore" | "evaluation">,
  clearedWeight: number,
): number | null {
  if (card.score === null || card.evaluation.status !== "scored") return null;
  const max = card.evaluation.theoreticalMax;
  if (!Number.isFinite(max) || max <= 0) return null;
  const remaining = Math.max(0, card.rawRiskScore - Math.max(0, clearedWeight));
  const projected = Math.max(0, Math.min(100, Math.round(100 - (remaining / max) * 100)));
  // Remediation can never make a pillar worse than it already is.
  return Math.max(card.score, projected);
}

/**
 * The Gantt the design specifies: phases 1–3 stagger a week apart and overlap
 * (they touch the same sites, so Compliance labelling begins while Governance
 * sharing work continues); phases 4–6 run strictly sequentially after them.
 * A deselected phase keeps its row on the chart but has no start week.
 *
 * Pure; exported for tests.
 */
export function computeSowSchedule(
  durations: readonly number[],
  selected: readonly boolean[],
): { startWeeks: Array<number | null>; totalWeeks: number; enablementWeeks: number } {
  const startWeeks: Array<number | null> = durations.map(() => null);
  let stagger = 0;
  for (const i of [0, 1, 2]) {
    if (!selected[i]) continue;
    startWeeks[i] = stagger;
    stagger += 1;
  }
  let cursor = 0;
  for (const i of [0, 1, 2]) {
    if (selected[i] && startWeeks[i] !== null) cursor = Math.max(cursor, startWeeks[i]! + durations[i]);
  }
  const enablementAfterParallel = cursor;
  for (const i of [3, 4, 5]) {
    if (!selected[i]) continue;
    startWeeks[i] = cursor;
    cursor += durations[i];
  }
  // Copilot enablement follows the licence work when it is in scope, since a
  // seat nobody has been assigned cannot be enabled.
  const enablementWeeks = selected[3] ? enablementAfterParallel + durations[3] : enablementAfterParallel;
  return { startWeeks, totalWeeks: Math.max(cursor, 0), enablementWeeks };
}

/**
 * The stable SOW reference printed on the document: `SMC-<initials>-<yyyy>-<mmdd>`.
 * Derived from real values (the customer's own name and the scan's own date) and
 * then persisted, so a document a customer signed never renumbers itself.
 *
 * Pure; exported for tests.
 */
export function buildSowReference(customerName: string, scanDate: Date): string {
  const initials = (customerName.match(/[A-Za-z0-9]+/g) ?? [])
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const yyyy = scanDate.getUTCFullYear();
  const mm = String(scanDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(scanDate.getUTCDate()).padStart(2, "0");
  return `SMC-${initials || "XX"}-${yyyy}-${mm}${dd}`;
}

// ── The builder ───────────────────────────────────────────────────────────────

/**
 * Build the whole SOW for one customer against one scope selection.
 *
 * `reference` is passed in rather than derived here so the persisted engagement
 * row owns it — the document a customer signed must not renumber itself when a
 * later scan changes its date.
 */
export async function buildFreeScanSow(
  customerId: number,
  selection: SowSelection,
  context: {
    reference: string | null;
    signature: FreeScanSow["signature"];
    status: FreeScanSow["status"];
  },
): Promise<FreeScanSowResult> {
  const summary = await buildPillarSummary(customerId);

  // Same readiness gate the locked results wire applies (#1358): a run in flight,
  // or no run that has ever produced findings, means there is nothing to scope.
  if (summary.activeRunId !== null || summary.findingsRunId === null) {
    return { status: "scanning", activeRunId: summary.activeRunId, findingsRunId: summary.findingsRunId };
  }

  const [tenantRow] = await db
    .select({ customerName: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  const customerName = tenantRow?.customerName?.trim() || "your tenant";

  // The per-check, per-pillar signal weights the SCORE itself is computed from.
  // `PillarFinding.rankWeight` already carries the weight for the pillar a
  // finding is filed under; this second read is only needed for the COPILOT
  // column, which no card's own findings carry.
  const { rules, groups } = await fetchSignalRulesAndGroups();
  const impacts = getSignalHealthImpacts(rules, groups);
  const rankCheckDefinitions = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
    })
    .from(monitorChecksTable);
  const weightsByCheckKey: ReadonlyMap<string, CheckRankWeights> = buildFindingRankWeights(
    rules,
    impacts,
    rankCheckDefinitions,
  );
  const copilotField = FINDING_RANK_IMPACT_FIELD["copilot"];

  const cardByPillar = new Map(summary.pillars.map((c) => [c.pillar, c]));

  // ── Catalog: the six phase rows, in delivery order ──────────────────────────
  const phaseRows = await db
    .select(catalogColumns)
    .from(servicesTable)
    .where(inArray(servicesTable.slug, [...FREE_SCAN_SOW_PHASE_SLUGS]));
  const phaseRowBySlug = new Map(phaseRows.map((r) => [r.slug, r as CatalogRow]));

  const missing = FREE_SCAN_SOW_PHASE_SLUGS.filter((s) => !phaseRowBySlug.has(s));
  if (missing.length > 0) {
    // Fail loudly rather than quietly shipping a shorter SOW: the phase set IS
    // the product, and a missing catalog row is a seeding fault, not a tenant
    // with less to do.
    log.error({ customerId, missing }, "free-scan SOW: phase service row(s) missing from the catalog");
    throw new Error(`free-scan SOW: missing catalog rows for ${missing.join(", ")}`);
  }

  const selectedSlugs = new Set(selection.phaseSlugs);
  // Phase 1 is required and cannot be deselected, whatever the stored row says.
  selectedSlugs.add(FREE_SCAN_SOW_PHASES[0]!.slug);

  const durations = FREE_SCAN_SOW_PHASES.map((p) =>
    toPositiveInt(phaseAttrs(phaseRowBySlug.get(p.slug)!).durationWeeks, 1),
  );
  const selectedFlags = FREE_SCAN_SOW_PHASES.map((p) => selectedSlugs.has(p.slug));
  const schedule = computeSowSchedule(durations, selectedFlags);

  const phases: SowPhase[] = FREE_SCAN_SOW_PHASES.map((spec, i) => {
    const row = phaseRowBySlug.get(spec.slug)!;
    const attrs = phaseAttrs(row);
    const card = cardByPillar.get(spec.pillar);
    const findings = card?.findings ?? [];
    const clearedWeight = findings.reduce((sum, f) => sum + (f.rankWeight || 0), 0);
    return {
      slug: spec.slug,
      order: i + 1,
      name: row.name,
      description: row.description,
      pillar: spec.pillar,
      pillarLabel: spec.pillarLabel,
      accentColor: spec.accentColor,
      required: spec.required,
      selected: selectedFlags[i]!,
      feeCents: resolveServicePriceCents(row),
      durationWeeks: durations[i]!,
      deliverables: toStringList(attrs.deliverables),
      requiresChangeWindow: attrs.requiresChangeWindow === true,
      findingCount: findings.length,
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      addresses: findings.slice(0, 3).map((f) => f.title),
      pillarScoreNow: card?.score ?? null,
      pillarScoreProjected: card ? projectPillarScore(card, clearedWeight) : null,
      startWeek: schedule.startWeeks[i]!,
    };
  });

  // ── Readiness: the Copilot pillar, projected the same way ───────────────────
  const copilotCard = cardByPillar.get("copilot");
  let copilotClearedWeight = 0;
  for (let i = 0; i < FREE_SCAN_SOW_PHASES.length; i++) {
    if (!selectedFlags[i]) continue;
    const card = cardByPillar.get(FREE_SCAN_SOW_PHASES[i]!.pillar);
    for (const f of card?.findings ?? []) {
      copilotClearedWeight += weightsByCheckKey.get(f.checkKey)?.[copilotField as keyof CheckRankWeights] ?? 0;
    }
  }

  // ── Add-ons, resolved by the platform's own real resolver ───────────────────
  const selectedTierByAddon = new Map(selection.addons.map((a) => [a.addonId, a.tierId]));
  const addons = await buildSowAddons(tenantRow?.tenantId ?? null, selectedTierByAddon);

  // ── Totals ─────────────────────────────────────────────────────────────────
  const selectedPhases = phases.filter((p) => p.selected);
  const phaseFeeCents = selectedPhases.reduce((sum, p) => sum + p.feeCents, 0);

  let addonOneOffCents = 0;
  let recurringMonthlyCents = 0;
  for (const addon of addons) {
    if (!addon.selected || !addon.selectedTierId) continue;
    const tier = addon.tiers.find((t) => t.tierId === addon.selectedTierId);
    if (!tier) continue;
    addonOneOffCents += tier.oneOffCents;
    recurringMonthlyCents += tier.monthlyCents;
  }

  const servicesGrossCents = phaseFeeCents + addonOneOffCents;
  const fullScope = selectedPhases.length === FREE_SCAN_SOW_PHASES.length;
  const discountApplies = fullScope;
  const servicesFullPlanCents = discountApplies
    ? Math.round(servicesGrossCents * (1 - FULL_SCOPE_DISCOUNT_PCT / 100))
    : servicesGrossCents;
  const depositCents = Math.round((servicesGrossCents * PHASED_DEPOSIT_PCT) / 100);
  const chargedNowCents = selection.paymentPlan === "full" ? servicesFullPlanCents : depositCents;

  const findingsInScope = selectedPhases.reduce((sum, p) => sum + p.findingCount, 0);
  let totalFindings = 0;
  let criticalFindings = 0;
  for (const spec of FREE_SCAN_SOW_PHASES) {
    const card = cardByPillar.get(spec.pillar);
    totalFindings += card?.findings.length ?? 0;
    criticalFindings += card?.findings.filter((f) => f.severity === "critical").length ?? 0;
  }

  const licensingCard = cardByPillar.get("licensing");
  const annualWasteStat = licensingCard?.stats.find((s) => s.id === "licensing.annualWaste");
  const annualWasteDollars = typeof annualWasteStat?.value === "number" ? annualWasteStat.value : null;

  const scanGeneratedAt = summary.generatedAt ? new Date(summary.generatedAt) : new Date();
  const daysSinceScan = Math.max(0, Math.floor((Date.now() - scanGeneratedAt.getTime()) / 86_400_000));
  const quoteValidUntil = new Date(scanGeneratedAt.getTime() + QUOTE_VALIDITY_DAYS * 86_400_000);

  const pillars: SowPillarLine[] = FREE_SCAN_SOW_PHASES.map((spec, i) => {
    const card = cardByPillar.get(spec.pillar);
    return {
      pillar: spec.pillar,
      label: spec.pillarLabel,
      accentColor: spec.accentColor,
      findingCount: card?.findings.length ?? 0,
      scoreNow: card?.score ?? null,
      findingTitles: (card?.findings ?? []).map((f) => f.title),
      inScope: selectedFlags[i]!,
    };
  });

  const gateBlockers: SowFindingLine[] = FREE_SCAN_SOW_PHASES.flatMap((spec) => {
    const card = cardByPillar.get(spec.pillar);
    return (card?.findings ?? [])
      .filter((f) => f.severity === "critical")
      .map((f) => ({
        pillar: spec.pillar,
        pillarLabel: spec.pillarLabel,
        severity: "critical" as const,
        title: f.title,
      }));
  });

  return {
    status: "ready",
    sow: {
      reference: context.reference ?? buildSowReference(customerName, scanGeneratedAt),
      customerName,
      scanGeneratedAt: scanGeneratedAt.toISOString(),
      daysSinceScan,
      scannedCheckCount: summary.scannedCheckCount,
      quoteValidUntil: quoteValidUntil.toISOString().slice(0, 10),
      readiness: {
        now: copilotCard?.score ?? null,
        projected: copilotCard ? projectPillarScore(copilotCard, copilotClearedWeight) : null,
        threshold: COPILOT_GATE_THRESHOLD,
        evaluationStatus: copilotCard?.evaluation.status ?? "not_evaluated",
        evaluationReason: copilotCard?.evaluation.reason ?? "no Copilot pillar card was produced for this tenant",
      },
      totals: {
        totalFindings,
        criticalFindings,
        findingsInScope,
        annualWasteDollars,
        phasesSelected: selectedPhases.length,
        phaseCount: FREE_SCAN_SOW_PHASES.length,
        weeksToCertification: schedule.totalWeeks,
        weeksToCopilotEnablement: schedule.enablementWeeks,
        deliverableCount: selectedPhases.reduce((sum, p) => sum + p.deliverables.length, 0),
        changeWindowCount: selectedPhases.filter((p) => p.requiresChangeWindow).length,
        servicesGrossCents,
        servicesFullPlanCents,
        depositCents,
        chargedNowCents,
        recurringMonthlyCents,
        addonOneOffCents,
        discountApplies,
        discountPct: FULL_SCOPE_DISCOUNT_PCT,
        depositPct: PHASED_DEPOSIT_PCT,
      },
      phases,
      addons,
      pillars,
      gateBlockers,
      selection: {
        phaseSlugs: phases.filter((p) => p.selected).map((p) => p.slug),
        addons: addons
          .filter((a) => a.selected && a.selectedTierId)
          .map((a) => ({ addonId: a.addonId, tierId: a.selectedTierId! })),
        paymentPlan: selection.paymentPlan,
      },
      signature: context.signature,
      status: context.status,
    },
  };
}

/**
 * The optional services this SOW may offer, priced for this tenant — resolved
 * entirely by `sow-monitoring-addon.ts`, which is the platform's one real
 * answer to that question. Nothing is re-derived here; this only flattens
 * dollars to cents and folds in which tier the customer has actually chosen.
 */
async function buildSowAddons(
  tenantGuid: string | null,
  selectedTierByAddon: ReadonlyMap<string, string>,
): Promise<SowAddon[]> {
  const resolved = await Promise.all([
    resolveTenantMonitoringAddon(tenantGuid),
    resolveArchitectRetainerAddon(tenantGuid),
  ]);

  const out: SowAddon[] = [];
  for (const addon of resolved) {
    if (!addon || addon.tiers.length === 0) continue;
    const tiers: SowAddonTier[] = addon.tiers.map((t) => ({
      tierId: t.id,
      label: t.label,
      oneOffCents: Math.round(t.upfrontUsd * 100),
      monthlyCents: Math.round(t.monthlyUsd * 100),
      detail: t.detail || null,
      emphasis: t.emphasis ?? null,
    }));
    const chosen = selectedTierByAddon.get(addon.id);
    const selectedTierId = chosen && tiers.some((t) => t.tierId === chosen) ? chosen : null;
    out.push({
      addonId: addon.id,
      name: addon.title,
      blurb: addon.blurb,
      tierLabel: ADDON_TIER_LABELS[addon.id] ?? "Tier",
      tiers,
      selected: selectedTierId !== null,
      selectedTierId,
    });
  }

  return out;
}
