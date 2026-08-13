// artifacts/api-server/src/lib/ai-lead-attribution.ts
//
// Cost-per-lead and cost-per-assessment-run (initiative:
// ai-cost-governance-billing-rollup, Phase 4.1 / Issue #81).
//
// Pure module, in the same spirit as ai-billing-analytics.ts (Phase 4): every
// function here is a function over values the route already has in hand, so the
// attribution rules are unit-testable without an express + drizzle harness and
// without a live database. All money is integer cents; no currency formatting
// happens here.
//
// ── WHY THIS IS NOT A JOIN ───────────────────────────────────────────────────
//
// Issue #81 asked whether `lead_staging` carries a direct link to
// `tenants`/`users`, or whether the join has to go through an intermediate
// identity resolution step. The audit answer is the second one, and more
// sharply than the issue anticipated:
//
//   * `lead_staging` has NO tenant/user column at all. Its identity keys are the
//     normalised `email` and the pre-cutover pointers `legacy_lead_id` /
//     `legacy_quiz_lead_id` (see lead-intent.ts, the identity chokepoint).
//   * `ai_usage_events` has NO lead column at all either. Its only identity
//     column is `customerId`, which at every volume call site (document-engine,
//     document-engine-sow, workflow-executor) is a `tenants.id`.
//
// So there is no FK path in either direction and no single SQL join that spans
// them. What exists is a chain:
//
//     ai_usage_events.customerId  (tenants.id)
//       -> users.tenantId
//         -> users.linkedLeadId -> leads.id -> lead_staging.legacyLeadId
//         -> or lower(users.email) = lead_staging.email
//
// The caller resolves that chain into `TenantLeadLink` rows; this module turns
// them into an attribution map and does the arithmetic. Splitting it that way
// keeps the identity rule visible and testable instead of buried in a query.
//
// ── WHAT IS DELIBERATELY NOT ATTRIBUTED ──────────────────────────────────────
//
// Unattributed spend is reported as its own explicit figure, never folded into a
// named lead and never dropped, exactly as Phase 4's rollupDimension does. Three
// distinct reasons are counted separately, because they call for different
// fixes:
//
//   noCustomer          the event has a NULL customerId — the call site never
//                       wrapped itself in withAiAttribution(), so there is no
//                       tenant to start the chain from;
//   customerWithoutLead the tenant is known but no lead_staging row resolves
//                       from any of its users — a real customer that this
//                       platform cannot trace back to a captured lead;
//   ambiguous           see the tie-break note below.
//
// `quick_win_quiz_results` rows are NOT part of this at all, by design. Those
// rows carry no name and no email; they gain identity only via the
// `leadStagingId` promotion pointer. An unpromoted quiz result therefore has no
// lead to attribute to and MUST NOT be guessed at — any AI spend around it lands
// in `noCustomer` above and is reported there. A promoted one is already a
// `lead_staging` row and needs no special case here.
//
// ── THE TIE-BREAK, STATED ────────────────────────────────────────────────────
//
// A tenant can have several users, and those users can resolve to several
// distinct staged leads. Attributing a tenant's whole spend to all of them would
// multiply-count it; splitting it evenly would fabricate a precision the data
// does not support. The rule is: attribute to the EARLIEST staged lead (lowest
// `lead_staging.id`) for that tenant, because that is the identity that entered
// the funnel first and produced the account — ensureAssessmentFunnelLead()
// captures a lead BEFORE consent creates the tenant. The number of tenants where
// the rule had to break a tie is reported as `ambiguousTenantCount` so a reader
// can see how often it fired rather than trusting it blindly.

import { medianCents } from "./ai-cost-anomaly.ts";

// ── Identity resolution ──────────────────────────────────────────────────────

/**
 * One resolved (tenant, staged lead) pair, as produced by the route's identity
 * query. A tenant may appear more than once — that is exactly the ambiguity
 * resolveTenantLeads() exists to collapse.
 */
export interface TenantLeadLink {
  tenantId: number;
  leadStagingId: number;
  leadName: string | null;
  leadEmail: string | null;
  leadSource: string | null;
}

/** The single lead a tenant's spend is attributed to, after the tie-break. */
export interface ResolvedLead {
  leadStagingId: number;
  label: string;
  email: string | null;
  source: string | null;
}

export interface LeadResolution {
  /** tenants.id -> the one lead its spend is attributed to. */
  byTenant: Map<number, ResolvedLead>;
  /** Tenants where more than one distinct lead resolved and the tie-break fired. */
  ambiguousTenantCount: number;
  /** Distinct leads reachable from the supplied links, before any spend is seen. */
  distinctLeadCount: number;
}

/** Prefer a real name, fall back to the email, never to a fabricated placeholder. */
function labelForLead(link: TenantLeadLink): string {
  const name = link.leadName?.trim();
  if (name) return name;
  const email = link.leadEmail?.trim();
  if (email) return email;
  return `Lead ${link.leadStagingId}`;
}

/**
 * Collapse the raw identity links into one lead per tenant.
 *
 * Deterministic: lowest `leadStagingId` wins, so the same links always produce
 * the same attribution regardless of row order coming back from the database.
 */
export function resolveTenantLeads(links: readonly TenantLeadLink[]): LeadResolution {
  const candidates = new Map<number, Map<number, TenantLeadLink>>();

  for (const link of links) {
    if (!Number.isFinite(link.tenantId) || !Number.isFinite(link.leadStagingId)) continue;
    let forTenant = candidates.get(link.tenantId);
    if (!forTenant) {
      forTenant = new Map<number, TenantLeadLink>();
      candidates.set(link.tenantId, forTenant);
    }
    // The identity query can return the same pair twice (matched on legacyLeadId
    // AND on email). Keyed by leadStagingId, so a duplicate pair is not an
    // ambiguity — only genuinely different leads are.
    if (!forTenant.has(link.leadStagingId)) forTenant.set(link.leadStagingId, link);
  }

  const byTenant = new Map<number, ResolvedLead>();
  const distinctLeads = new Set<number>();
  let ambiguousTenantCount = 0;

  for (const [tenantId, forTenant] of candidates) {
    for (const id of forTenant.keys()) distinctLeads.add(id);
    if (forTenant.size > 1) ambiguousTenantCount += 1;

    const winner = [...forTenant.values()].reduce((best, link) =>
      link.leadStagingId < best.leadStagingId ? link : best,
    );
    byTenant.set(tenantId, {
      leadStagingId: winner.leadStagingId,
      label: labelForLead(winner),
      email: winner.leadEmail?.trim() || null,
      source: winner.leadSource?.trim() || null,
    });
  }

  return { byTenant, ambiguousTenantCount, distinctLeadCount: distinctLeads.size };
}

// ── Cost per lead ────────────────────────────────────────────────────────────

/** The columns of a usage row this rollup needs. */
export interface LeadCostInputRow {
  costCents: number | null;
  customerId: number | null;
}

export interface LeadCostSlice {
  /** Stable key for React lists and drill-down links. */
  key: string;
  leadStagingId: number;
  label: string;
  email: string | null;
  source: string | null;
  costCents: number;
  eventCount: number;
}

export interface UnattributedLeadSpend {
  costCents: number;
  eventCount: number;
  label: string;
  /** Why each slice of it could not be attributed — see the module docblock. */
  breakdown: {
    noCustomer: { costCents: number; eventCount: number };
    customerWithoutLead: { costCents: number; eventCount: number };
  };
}

export interface CostPerLeadRollup {
  /** Attributed leads only, highest cost first, capped at `limit`. */
  slices: LeadCostSlice[];
  /** The attributed tail beyond `limit`, folded, with its own count stated. */
  other: { costCents: number; eventCount: number; sliceCount: number };
  unattributed: UnattributedLeadSpend;

  /**
   * Headline figure: the MEDIAN spend across leads that actually incurred AI
   * spend, following Phase 4's median-not-mean convention. Null — not 0 — when
   * no lead has any spend, because "we have no figure" and "the figure is zero"
   * are different statements and only one of them is true here.
   */
  medianCostPerLeadCents: number | null;
  /** Mean over the same set, so a skew against the median is visible. Null likewise. */
  meanCostPerLeadCents: number | null;

  /**
   * Leads with at least one usage event in the window. A lead with events that
   * happen to sum to zero cents IS counted here and DOES get a slice — that is a
   * genuine zero-cost lead. A lead with no events at all is not invented as a
   * $0.00 line; it simply is not in `slices`, and `leadsStagedInWindow` below is
   * the honest separate counter for lead volume.
   */
  leadsWithSpend: number;
  /** Distinct leads reachable from this window's customers, spend or not. */
  leadsReachable: number;
  ambiguousTenantCount: number;

  attributedCostCents: number;
  /** Attributed + other + unattributed. Reconciles with the series total. */
  totalCostCents: number;
  eventCount: number;
}

export const DEFAULT_LEAD_LIMIT = 8;

export const UNATTRIBUTED_LEAD_LABEL = "Unattributed (no lead resolved)";

/**
 * Roll usage rows up per lead.
 *
 * Sorted by cost descending, ties broken by event count then key — the same
 * stable ordering rule ai-billing-analytics.ts's rollupDimension uses, so two
 * panels on the same page can never disagree about ranking.
 */
export function rollupCostPerLead(
  rows: readonly LeadCostInputRow[],
  resolution: LeadResolution,
  limit: number = DEFAULT_LEAD_LIMIT,
): CostPerLeadRollup {
  const buckets = new Map<number, LeadCostSlice>();
  const noCustomer = { costCents: 0, eventCount: 0 };
  const customerWithoutLead = { costCents: 0, eventCount: 0 };
  let totalCostCents = 0;
  let eventCount = 0;

  for (const row of rows) {
    const cost = row.costCents ?? 0;
    totalCostCents += cost;
    eventCount += 1;

    if (row.customerId == null) {
      noCustomer.costCents += cost;
      noCustomer.eventCount += 1;
      continue;
    }

    const lead = resolution.byTenant.get(row.customerId);
    if (!lead) {
      customerWithoutLead.costCents += cost;
      customerWithoutLead.eventCount += 1;
      continue;
    }

    const existing = buckets.get(lead.leadStagingId);
    if (existing) {
      existing.costCents += cost;
      existing.eventCount += 1;
    } else {
      buckets.set(lead.leadStagingId, {
        key: String(lead.leadStagingId),
        leadStagingId: lead.leadStagingId,
        label: lead.label,
        email: lead.email,
        source: lead.source,
        costCents: cost,
        eventCount: 1,
      });
    }
  }

  const sorted = [...buckets.values()].sort(
    (a, b) =>
      b.costCents - a.costCents ||
      b.eventCount - a.eventCount ||
      a.key.localeCompare(b.key),
  );

  const capped = Math.max(1, Math.trunc(limit));
  const slices = sorted.slice(0, capped);
  const tail = sorted.slice(capped);

  // Computed over EVERY lead with spend, not just the capped `slices` — a median
  // of the visible top-N would drift the moment someone changed the limit.
  const perLeadCosts = sorted.map((s) => s.costCents);
  const attributedCostCents = perLeadCosts.reduce((acc, c) => acc + c, 0);

  return {
    slices,
    other: {
      costCents: tail.reduce((acc, s) => acc + s.costCents, 0),
      eventCount: tail.reduce((acc, s) => acc + s.eventCount, 0),
      sliceCount: tail.length,
    },
    unattributed: {
      costCents: noCustomer.costCents + customerWithoutLead.costCents,
      eventCount: noCustomer.eventCount + customerWithoutLead.eventCount,
      label: UNATTRIBUTED_LEAD_LABEL,
      breakdown: { noCustomer, customerWithoutLead },
    },
    medianCostPerLeadCents: perLeadCosts.length ? medianCents(perLeadCosts) : null,
    meanCostPerLeadCents: perLeadCosts.length
      ? Math.round(attributedCostCents / perLeadCosts.length)
      : null,
    leadsWithSpend: perLeadCosts.length,
    leadsReachable: resolution.distinctLeadCount,
    ambiguousTenantCount: resolution.ambiguousTenantCount,
    attributedCostCents,
    totalCostCents,
    eventCount,
  };
}

// ── Cost per assessment run ──────────────────────────────────────────────────
//
// An "assessment run" is an `msp_diagnostic_runs` row.
//
// ── ATTRIBUTION IS BY INTERVAL, NOT BY KEY ───────────────────────────────────
//
// `ai_usage_events` HAS a `runId` column, and it would be the obvious join. The
// audit found it is never populated with a diagnostic run id: the only writer is
// workflow-executor.ts's aiAttributionFor(), which supplies portal WORKFLOW run
// ids. `msp_diagnostic_runs.runId` and `ai_usage_events.runId` are disjoint id
// spaces today, so that join would match nothing and silently report $0.00 for
// every run — the exact fabricated-honest-looking-number this initiative exists
// to avoid.
//
// So spend is attributed to a run when it belongs to the SAME customer and fell
// inside the run's own interval. That is an upper bound, not a key match: other
// AI work for the same customer during the run's window is swept in with it.
// This is stated in the response (`attribution.note`) rather than presented as
// exact, and `ATTRIBUTION_METHOD` is carried as data so the UI cannot describe
// it as something it is not.

export const ASSESSMENT_RUN_ATTRIBUTION_METHOD = "customer-and-interval" as const;

/**
 * How long after its start an unfinished run may still claim spend. Without a
 * cap, a run that never wrote `completedAt` would have an open-ended interval
 * and would absorb every later call for that customer forever.
 */
export const OPEN_RUN_ATTRIBUTION_CAP_MS = 6 * 60 * 60 * 1000;

export interface AssessmentRunInput {
  runId: string;
  customerId: number | null;
  status: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string | null;
}

export interface AssessmentRunCostInputRow {
  occurredAt: Date | string | null;
  costCents: number | null;
  customerId: number | null;
}

export interface AssessmentRunCostSlice {
  key: string;
  runId: string;
  customerId: number | null;
  status: string | null;
  startedAt: string | null;
  completedAt: string | null;
  costCents: number;
  eventCount: number;
}

export interface CostPerAssessmentRunRollup {
  slices: AssessmentRunCostSlice[];
  other: { costCents: number; eventCount: number; sliceCount: number };
  /** Spend that fell inside no run's interval for its customer. */
  unattributed: { costCents: number; eventCount: number; label: string };

  /** Median/mean over runs that actually drew spend. Null when none did. */
  medianCostPerRunCents: number | null;
  meanCostPerRunCents: number | null;

  /** Runs overlapping the window at all — the denominator for "how busy was it". */
  runsInWindow: number;
  /** Runs with at least one attributed event. Never inflated to runsInWindow. */
  runsWithSpend: number;
  /** Runs excluded from attribution because they have no usable start instant. */
  runsWithoutInterval: number;
  /** Events that sat inside more than one run's interval; see the tie-break. */
  overlappingEventCount: number;

  attributedCostCents: number;
  totalCostCents: number;
  eventCount: number;

  attribution: {
    method: typeof ASSESSMENT_RUN_ATTRIBUTION_METHOD;
    openRunCapMs: number;
    note: string;
  };
}

export const UNATTRIBUTED_RUN_LABEL = "Unattributed (outside any assessment run)";

export const ASSESSMENT_RUN_ATTRIBUTION_NOTE =
  "ai_usage_events.runId carries portal workflow run ids, never msp_diagnostic_runs.runId, " +
  "so there is no key to join on. Spend is attributed to a run when it belongs to the same " +
  "customer and occurred inside that run's interval, which makes each figure an UPPER BOUND: " +
  "unrelated AI work for the same customer during the run is included. An unfinished run's " +
  "interval is capped at 6 hours from its start. Where intervals overlap, the run that started " +
  "latest claims the event.";

function toMs(value: Date | string | null): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toIso(value: Date | string | null): string | null {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

interface RunInterval {
  run: AssessmentRunInput;
  startMs: number;
  endMs: number;
  slice: AssessmentRunCostSlice;
}

export const DEFAULT_RUN_LIMIT = 8;

/**
 * Roll usage rows up per assessment run.
 *
 * `now` is injected rather than read from the clock so the open-run cap is
 * testable against fixtures.
 */
export function rollupCostPerAssessmentRun(
  rows: readonly AssessmentRunCostInputRow[],
  runs: readonly AssessmentRunInput[],
  opts: { limit?: number; now?: Date } = {},
): CostPerAssessmentRunRollup {
  const limit = Math.max(1, Math.trunc(opts.limit ?? DEFAULT_RUN_LIMIT));
  const nowMs = (opts.now ?? new Date()).getTime();

  const byCustomer = new Map<number, RunInterval[]>();
  const intervals: RunInterval[] = [];
  let runsWithoutInterval = 0;

  for (const run of runs) {
    const startMs = toMs(run.startedAt) ?? toMs(run.createdAt);
    if (startMs == null || run.customerId == null) {
      // No usable start, or no customer to match events against: the run is
      // still counted in runsInWindow, but nothing can be attributed to it.
      runsWithoutInterval += 1;
      continue;
    }

    const completedMs = toMs(run.completedAt);
    const endMs =
      completedMs != null
        ? Math.max(completedMs, startMs)
        : Math.min(startMs + OPEN_RUN_ATTRIBUTION_CAP_MS, Math.max(nowMs, startMs));

    const interval: RunInterval = {
      run,
      startMs,
      endMs,
      slice: {
        key: run.runId,
        runId: run.runId,
        customerId: run.customerId,
        status: run.status,
        startedAt: toIso(run.startedAt ?? run.createdAt),
        completedAt: toIso(run.completedAt),
        costCents: 0,
        eventCount: 0,
      },
    };

    intervals.push(interval);
    const forCustomer = byCustomer.get(run.customerId);
    if (forCustomer) forCustomer.push(interval);
    else byCustomer.set(run.customerId, [interval]);
  }

  const unattributed = { costCents: 0, eventCount: 0, label: UNATTRIBUTED_RUN_LABEL };
  let totalCostCents = 0;
  let eventCount = 0;
  let overlappingEventCount = 0;

  for (const row of rows) {
    const cost = row.costCents ?? 0;
    totalCostCents += cost;
    eventCount += 1;

    const ms = toMs(row.occurredAt);
    const candidates = row.customerId == null ? undefined : byCustomer.get(row.customerId);
    if (ms == null || !candidates) {
      unattributed.costCents += cost;
      unattributed.eventCount += 1;
      continue;
    }

    // Latest-starting containing run wins — the most recent run is the one an
    // event during an overlap most plausibly belongs to.
    let winner: RunInterval | null = null;
    let matches = 0;
    for (const candidate of candidates) {
      if (ms < candidate.startMs || ms > candidate.endMs) continue;
      matches += 1;
      if (!winner || candidate.startMs > winner.startMs) winner = candidate;
    }

    if (!winner) {
      unattributed.costCents += cost;
      unattributed.eventCount += 1;
      continue;
    }
    if (matches > 1) overlappingEventCount += 1;

    winner.slice.costCents += cost;
    winner.slice.eventCount += 1;
  }

  const withSpend = intervals
    .filter((i) => i.slice.eventCount > 0)
    .map((i) => i.slice)
    .sort(
      (a, b) =>
        b.costCents - a.costCents ||
        b.eventCount - a.eventCount ||
        a.key.localeCompare(b.key),
    );

  const slices = withSpend.slice(0, limit);
  const tail = withSpend.slice(limit);
  const perRunCosts = withSpend.map((s) => s.costCents);
  const attributedCostCents = perRunCosts.reduce((acc, c) => acc + c, 0);

  return {
    slices,
    other: {
      costCents: tail.reduce((acc, s) => acc + s.costCents, 0),
      eventCount: tail.reduce((acc, s) => acc + s.eventCount, 0),
      sliceCount: tail.length,
    },
    unattributed,
    medianCostPerRunCents: perRunCosts.length ? medianCents(perRunCosts) : null,
    meanCostPerRunCents: perRunCosts.length
      ? Math.round(attributedCostCents / perRunCosts.length)
      : null,
    runsInWindow: runs.length,
    runsWithSpend: perRunCosts.length,
    runsWithoutInterval,
    overlappingEventCount,
    attributedCostCents,
    totalCostCents,
    eventCount,
    attribution: {
      method: ASSESSMENT_RUN_ATTRIBUTION_METHOD,
      openRunCapMs: OPEN_RUN_ATTRIBUTION_CAP_MS,
      note: ASSESSMENT_RUN_ATTRIBUTION_NOTE,
    },
  };
}
