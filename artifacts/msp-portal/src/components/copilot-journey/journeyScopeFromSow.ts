/**
 * journeyScopeFromSow.ts — the ONE mapping from `GET /api/portal/assessment/sow`
 * onto the journey's priced scope, shared by Screen 3 (the SOW Proposal) and
 * Screen 4 (the Checkout).
 *
 * WHY THIS IS SHARED RATHER THAN COPIED
 * ------------------------------------
 * The phase id space is load-bearing across the navigation. The signed selection
 * that crosses from the proposal to the checkout in `sessionStorage` is keyed by
 * `slugify(title)`, so two screens slugifying differently would read every phase
 * as deselected and bill for nothing. The pillar attribution is load-bearing for
 * a different reason: a phase wearing the Governance swatch on the proposal and a
 * different one on the confirmation screen would make the two screens disagree
 * about what was signed. Both were verbatim copies in two files; they live here
 * now so they cannot drift.
 *
 * WHY `adjustments` ARE NOT PHASES
 * --------------------------------
 * `sow_pricing_lines` carries two kinds of row and the platform treats them
 * differently everywhere else. A *workstream* is a piece of work — a title, a
 * scope, a price, sometimes a week estimate — and it is toggleable. An
 * *adjustment* is a price modifier: `sow-pricing.ts` pushes synthetic lines
 * literally titled "Price Adjustments", and real ones read like "Tenant Size
 * Adjustment Factor". They carry no `weeks` key at all, they are never in
 * `selectedWorkstreamTitles`, and `effectiveSowTotals()` adds them to the total
 * unconditionally.
 *
 * Rendering one as "Phase 1 · Required, cannot be removed — the identity work
 * that lands before Copilot is enabled for anyone" is therefore false twice over:
 * it is not a phase, and it is not identity work. Worse, `POST
 * .../assessment/sow/checkout` compares the submitted
 * `selectedWorkstreamTitles` set against the active document's, so an adjustment
 * title swept into the phase list makes that comparison fail and the customer
 * cannot pay at all (`409 scope_changed`).
 *
 * So this module keeps them out of `scope.phases` — which is what makes the
 * phase count, the locked-phase logic and the submitted title list all about real
 * workstreams — and returns them separately, with their money, for the caller to
 * show as "Included adjustments" and to fold into the total via
 * `withAdjustments()`. `AssessmentSowSelector.tsx` gives them exactly this
 * treatment already.
 *
 * NO PRICE IS DECLARED IN THIS FILE. Every figure arrives on the payload.
 */

import { isPhaseIncluded } from "./journeyPricing.ts";
import type {
  JourneyPhase,
  JourneyScopeInput,
  JourneySelection,
  JourneyTotals,
} from "./journeyPricing.ts";
import { PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";

/* ------------------------------------------------------------------ *
 * Wire shapes — the subset of the SOW payload the journey reads.
 * ------------------------------------------------------------------ */

/**
 * A workstream line. `weeks` is genuinely nullable on the wire
 * (`buildSowState()` writes `l.weeks ?? null`) and an adjustment line does not
 * carry the key at all.
 */
export interface WireSowLine {
  readonly title: string;
  readonly scope?: string | null;
  readonly priceUsd: number;
  readonly weeks?: number | null;
  readonly deliveryDate?: string | null;
}

export interface WireSowState {
  readonly ready?: boolean;
  readonly regenerating?: boolean;
  readonly allWorkstreams?: readonly WireSowLine[];
  readonly adjustments?: readonly WireSowLine[];
  readonly selectedWorkstreamTitles?: readonly string[];
  readonly pricing?: { readonly validUntil?: string };
  /** `buildSowState()`'s own `doc` — the real, stable `sow_documents.id` this SOW is. */
  readonly doc?: { readonly id: number };
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Attribute a SOW workstream to a pillar from its title.
 *
 * `sow_pricing_lines` has no pillar column — the generator writes prose, not a
 * typed link back to the signal that produced the line — so this reads the title
 * and returns `null` the moment it is not sure. An unmatched row renders with no
 * swatch, which says "we are not claiming a pillar here"; a guessed colour would
 * say something false about what the customer is buying.
 */
export const PILLAR_PATTERNS: readonly (readonly [PillarKey, RegExp])[] = [
  ["security", /identit|access|mfa|conditional|privileg|entra|legacy auth|admin/i],
  ["governance", /sharing|sharepoint|site|permission|lifecycle|oversharing|exposure/i],
  ["compliance", /label|dlp|retention|complian|purview|data protection|sensitivit/i],
  ["licensing", /licen|sku|seat|e5|subscription|rationalis/i],
  ["adoption", /adoption|enablement|training|usage|engagement/i],
  ["health", /drift|handover|baseline|monitor|health|change review/i],
];

export function inferPillar(title: string): PillarKey | null {
  for (const [key, pattern] of PILLAR_PATTERNS) {
    if (pattern.test(title)) return key;
  }
  return null;
}

/** The phase id space. Shared, because the signed selection is keyed by it. */
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ------------------------------------------------------------------ *
 * The mapped scope
 * ------------------------------------------------------------------ */

/**
 * A phase, plus the two things `JourneyPhase` cannot carry honestly.
 *
 * Structurally still a `JourneyPhase`, so it drops straight into
 * `JourneyScopeInput` and the tested pricing maths.
 */
export interface JourneySowPhase extends JourneyPhase {
  /** `null` when the workstream could not be attributed — no swatch is drawn. */
  readonly pillarShown: PillarKey | null;
  /**
   * The week estimate the SOW line ACTUALLY quoted, or `null` where it quoted
   * none. `JourneyPhase.weeks` above is this value with `null` flattened to `0`,
   * and only because `computeTotals()` sums a required `number` — nothing may
   * render a week count off it without consulting this field first, or a scope
   * that quoted no duration reads as "approx. 0 weeks" on a screen the customer
   * signs.
   */
  readonly weeksQuoted: number | null;
}

/** A price modifier. Always included, never a workstream, never toggleable. */
export interface JourneyAdjustmentLine {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly priceUsd: number;
}

export interface JourneySowScope {
  /** Real workstreams only — the toggleable, priced, countable phases. */
  readonly scope: JourneyScopeInput;
  /** The same phases, with their display-only fields still attached. */
  readonly phases: readonly JourneySowPhase[];
  readonly adjustments: readonly JourneyAdjustmentLine[];
  /** Their total, in whole dollars. Always part of what is owed. */
  readonly adjustmentsUsd: number;
  /** phase id → pillar. Absent where the platform does not say which. */
  readonly pillarById: Readonly<Partial<Record<string, PillarKey>>>;
  /** ISO date the quoted pricing holds until, when the payload carries one. */
  readonly quoteHoldIso: string | null;
  /** The platform's own record of what the active SOW includes. */
  readonly serverSelectedTitles: readonly string[] | null;
  /** The real `sow_documents.id` this SOW is, or `null` when the wire carries none. */
  readonly docId: number | null;
}

function toPhase(line: WireSowLine): JourneySowPhase {
  const pillarShown = inferPillar(line.title);
  // Both ends of the delta are equal, so a card draws no score movement: a SOW
  // workstream quotes a price and a scope, never a projected pillar score, and a
  // "44 → 44" would read as remediation that achieves nothing. `pillar` still has
  // to be a `PillarKey` for the shared type; it is never read where `pillarShown`
  // is null.
  const flat = 0;
  const weeksQuoted = typeof line.weeks === "number" ? line.weeks : null;
  return {
    id: slugify(line.title) || line.title,
    title: line.title,
    pillar: pillarShown ?? PILLAR_KEYS[0],
    pillarShown,
    scope: line.scope ?? "",
    priceUsd: Number(line.priceUsd) || 0,
    weeks: weeksQuoted ?? 0,
    weeksQuoted,
    scoreFrom: flat,
    scoreTo: flat,
    addresses: "",
    // Nothing on this wire is a mandatory *workstream*. The platform's only
    // "shown, never toggleable" rows are the adjustments, and those are not
    // phases at all — see the note at the top of this file.
    locked: false,
  };
}

/**
 * Map a SOW payload onto the journey's scope, or `null` when the tenant has no
 * usable scope document yet (the caller renders its unavailable state — it never
 * falls back to a fixture's prices).
 */
export function journeyScopeFromSow(body: WireSowState): JourneySowScope | null {
  const workstreams = body.allWorkstreams ?? [];
  if (body.ready !== true || workstreams.length === 0) return null;

  const phases = workstreams.map(toPhase);
  const pillarById: Record<string, PillarKey> = {};
  phases.forEach((p) => {
    if (p.pillarShown) pillarById[p.id] = p.pillarShown;
  });

  const adjustments: JourneyAdjustmentLine[] = (body.adjustments ?? []).map((l) => ({
    id: slugify(l.title) || l.title,
    title: l.title,
    scope: l.scope ?? "",
    priceUsd: Number(l.priceUsd) || 0,
  }));

  return {
    // Optional services are catalogue products chosen on the proposal; nothing on
    // this endpoint carries them, so the set is empty rather than invented.
    scope: { phases, addons: [] },
    phases,
    adjustments,
    adjustmentsUsd: adjustments.reduce((sum, a) => sum + a.priceUsd, 0),
    pillarById,
    quoteHoldIso: body.pricing?.validUntil ?? null,
    serverSelectedTitles: body.selectedWorkstreamTitles ?? null,
    docId: typeof body.doc?.id === "number" ? body.doc.id : null,
  };
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

/**
 * Fold the always-included adjustment money into a `computeTotals()` result.
 *
 * The server does exactly this and nothing else: `effectiveSowTotals()` is
 * `workstreamTotal (selected only) + adjustmentsTotal (all of them)`, and
 * `computePayInFullOffer()` charges that sum. So a screen that shows the
 * workstream total alone under-states what leaves the account.
 *
 * Only the two one-off figures move. `monthlyUsd` is recurring services and
 * `includedPhaseCount`/`totalPhaseCount`/`weeks` are statements about
 * workstreams — an adjustment is none of those things.
 *
 * Callers must apply this ONCE, at the point the totals are derived, and then
 * pass the same object to every consumer: the sticky header's "Today X then Y"
 * and the summary rail are two views of one arithmetic, and re-deriving either
 * is how they come to disagree.
 */
export function withAdjustments(totals: JourneyTotals, adjustmentsUsd: number): JourneyTotals {
  if (!adjustmentsUsd) return totals;
  return {
    ...totals,
    oneOffUsd: totals.oneOffUsd + adjustmentsUsd,
    upfrontUsd: totals.upfrontUsd + adjustmentsUsd,
  };
}

/**
 * The weeks to print, or `null` when no included phase quoted a duration.
 *
 * `computeTotals().weeks` sums a field that was flattened from `null` to `0`, so
 * it cannot tell "this scope runs zero weeks" from "this scope quoted no
 * timeline". This can, and the difference matters on a signing screen: the
 * platform's own SOW selector guards the same field (`w.weeks != null && …`).
 */
export function quotedWeeks(
  scope: JourneyScopeInput,
  phases: readonly JourneySowPhase[],
  selection: JourneySelection,
): number | null {
  let weeks = 0;
  let anyQuoted = false;
  phases.forEach((p) => {
    if (!isPhaseIncluded(scope, selection, p.id)) return;
    if (typeof p.weeksQuoted !== "number") return;
    weeks += p.weeksQuoted;
    anyQuoted = true;
  });
  return anyQuoted ? weeks : null;
}
