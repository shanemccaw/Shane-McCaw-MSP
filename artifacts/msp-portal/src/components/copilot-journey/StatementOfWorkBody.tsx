/**
 * StatementOfWorkBody.tsx — document 9 of 9, and the only one the customer
 * signs.
 *
 * ONE AGREEMENT, ONE SET OF ARITHMETIC
 * ------------------------------------
 * Scope and totals come from `journeyPricing.ts`. In preview that is over
 * `PREVIEW_SCOPE`, the design's worked example; on a live journey it is the
 * Sales Offer Engine's own candidates for this tenant, mapped by
 * `journeyScopeFromOffers()`. Nothing in this file adds up a fee. Two live
 * surfaces over one contract that each did their own maths would eventually
 * quote two different numbers to the same customer, and the one place that must
 * never happen is the page with a signature on it.
 *
 * NO STORED DOCUMENT ROW, NO GENERATION STEP
 * ------------------------------------------
 * This document used to read `GET /api/portal/assessment/sow`, which is
 * `loadSowDocs()` over `insights_generated_documents` — so the one report the
 * customer acts on was the one report that could not be read until
 * `document-engine-sow.ts` had run an AI generation and written a row, while the
 * other eight render straight off the scan. It no longer does. The scope comes
 * from `GET /api/portal/assessment/recommended-offers`, which runs the SAME
 * Sales Offer Engine that document-engine-sow.ts calls "the sole authority on
 * which projects to scope and what to charge for them", in pure-compute mode,
 * persisting nothing. `sowLiveScope.ts` holds that mapping and the full argument
 * for why it is the same authority rather than a stand-in for it.
 *
 * WHAT THAT USED TO COST, AND WHAT #599–#602 CLOSED
 * ---------------------------------------------------
 * This document could be READ by every tenant with a scan, but SIGNED by none
 * of them from here: signing used to write an `assessment_sow_agreements` row
 * FK'd to a stored document id, and `.../sow/payment-options` read its totals
 * off that same row, so a signature taken here with no such row would land in
 * a checkout that could not accept it (`SOW_UNSIGNABLE`). Git #599's
 * `sow/checkout-session` endpoint closed that gap — it snapshots a real,
 * server-priced cart with no stored document behind it at all — and #600 gave
 * it a real PaymentIntent to charge against. `SOW_UNSIGNABLE` is kept for a
 * caller that genuinely cannot honour a signature, but `LiveStatementOfWorkBody`
 * no longer is one. The standalone proposal screen
 * (`/copilot-readiness/proposal`) still reads the stored document and is still
 * where a GENERATED SOW is signed and paid; nothing about that separate path
 * changed.
 *
 * SIGNING IS A HARD LOCK, NOT A DISABLED STATE
 * --------------------------------------------
 * After signature the toggles stop responding rather than merely looking
 * inactive, because a contract that is still editable after execution is not a
 * contract. The lock lives in the handlers, not in CSS.
 *
 * SIGN AND PAY, IN THIS SAME VIEW (#602)
 * ----------------------------------------
 * A live signature now takes payment too, right here — no redirect, no route
 * change. `sign()` locks the scope, then hands it to #599's checkout-session
 * endpoint; the moment that session exists, `sowCartPayment.tsx`'s embedded
 * Stripe Payment Element (ported from the marketing site's own `AssessmentFlow.tsx`
 * / `PaymentStep`, #482) mounts inline in the signature block below and
 * confirms against #600's PaymentIntent. The design preview has no real
 * tenant to snapshot a session against, so it keeps its original behaviour:
 * signing there still just hands the agreed scope to the standalone checkout
 * screen as a query string. WHAT THIS STILL DOES NOT DO: record a signed
 * agreement anywhere. A confirmed Stripe charge is where this file's
 * responsibility ends — what happens to the contract after that is #603's own
 * deferred scope ("Reconcile post-payment agreement recording").
 *
 * PREVIEW VS LIVE (#292)
 * -----------------------
 * `StatementOfWorkBody` itself is presentational: pass `isPreview` (the
 * default, matching its original behaviour byte-for-byte) to render the
 * design's own Halden Materials worked example, or pass `isPreview={false}`
 * with `live` to render a real tenant's contract. `LiveStatementOfWorkBody`
 * below is the self-fetching wrapper `DocumentBody.tsx` actually mounts on a
 * real journey — it owns the one real fetch
 * (`GET /api/portal/assessment/recommended-offers`), mirroring the proposal
 * screen's own fetch/error/loading pattern, and hands the resolved scope down as
 * `live`. See `sowLiveContract.ts` for what is real, what is computed, and —
 * for the handful of rows the design's fixture can state and this platform
 * genuinely cannot — what is an honest declared gap.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Lock } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

import {
  BRAND,
  COPILOT_GATE_TARGET,
  INK,
  PILLARS,
  SEVERITY_ON_DARK,
  TABULAR,
  hexAlpha,
  reportAccent,
  severityColor,
  type PillarKey,
} from "./journeyTokens.ts";
import {
  computeTotals,
  defaultSelection,
  isPhaseIncluded,
  money,
  monthlyLabel,
  phaseCountLabel,
  pickTier,
  togglePhase,
  toggleAddon,
  type JourneyPhase,
  type JourneyPhaseStage,
  type JourneyScopeInput,
  type JourneySelection,
} from "./journeyPricing.ts";
import { PREVIEW_SCOPE, PREVIEW_SIGNAL_COUNT, PREVIEW_TENANT } from "./journeyPreviewFixture.ts";
import {
  STATEMENT_OF_WORK,
  sowConsent,
  sowDeliverables,
  sowHeadline,
  sowKicker,
  sowReference,
  sowStandfirst,
  type SowPillarCarry,
  type SowRow,
} from "./previewStatementOfWork.ts";
import {
  buildLiveBlockers,
  buildLiveCarry,
  elapsedDaysSince,
  projectedFromPhases,
  quotedWeeksOf,
  resolveBasisOfScope,
  resolveChangeWindows,
  resolveElapsedDays,
  resolveFindingsCarried,
  resolveFindingsInScope,
  resolveNetYear,
  resolveNewBudget,
  resolveObjective,
  resolvePaymentTerms,
  resolvePhaseDuration,
  resolvePhasesInParallel,
  resolveProjected,
  resolveStrictlySequential,
  resolveTelemetrySource,
  resolveTimeline,
  resolveTimelineIntro,
  resolveValidity,
  resolveWasteRecovered,
  resolveWeeksRow,
  resolveWhyMatters,
  SOW_UNSIGNABLE,
} from "./sowLiveContract.ts";
import { buildProvenance } from "./liveReportBlocks.ts";
import {
  withAdjustments,
  type JourneyAdjustmentLine,
  type JourneySowScope,
} from "./journeyScopeFromSow.ts";
import { journeyScopeFromOffers, type WireRecommendedOffers } from "./sowLiveScope.ts";
import { createSowCheckoutSession, SowCartPaymentPanel } from "./sowCartPayment";
import type { JourneyView } from "./journeyModel.ts";
import { JourneyUnavailable } from "./JourneyPrimitives";

/**
 * The Sales Offer Engine, run for the caller's own tenant in pure-compute mode.
 * Nothing is persisted and no offer state machine is touched — see
 * `sowLiveScope.ts` for why this is the same pricing authority the stored SOW is
 * built from rather than a second one.
 */
const RECOMMENDED_OFFERS_URL = "/api/portal/assessment/recommended-offers";
const JOURNEY_CHANNEL = "engine.dashboard";

const H2: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.015em",
  color: INK.headingDark,
};

const BODY: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: INK.bodyDarkStrong,
  textWrap: "pretty",
};

/**
 * The gate this contract is written against — the journey's one Gate constant,
 * not a second copy. This file used to declare its own `= 82` while
 * `COPILOT_GATE_TARGET` was 60, so the SOW and the Document Viewer stated
 * different thresholds for the same tenant. #359 resolved that by moving the
 * shared constant to 82; the local alias is kept only so the surrounding copy
 * reads naturally.
 */
const SOW_GATE_TARGET = COPILOT_GATE_TARGET;

function Row({ label, tone, value }: { label: string; tone: keyof typeof SEVERITY_ON_DARK; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px,1.1fr) minmax(0,1.9fr)",
        gap: 14,
        padding: "11px 10px",
        borderBottom: `1px solid ${INK.hairlineDark}`,
        alignItems: "baseline",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: INK.headingDark }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: SEVERITY_ON_DARK[tone] }}>{value}</span>
    </div>
  );
}

/** The switch on a phase card and on each optional service. */
function Toggle({ on, locked }: { on: boolean; locked: boolean }) {
  const track = on ? (locked ? "rgba(52,211,153,.5)" : BRAND.blue) : "rgba(51,65,85,.5)";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 40,
        height: 20,
        borderRadius: 999,
        flex: "none",
        background: track,
        // One border shorthand rather than shorthand + `borderStyle`: React warns
        // when both are set and one changes between renders, which signing does.
        border: `1px ${locked ? "dashed" : "solid"} ${on ? (locked ? "rgba(52,211,153,.7)" : BRAND.blue) : "rgba(71,85,105,.8)"}`,
        position: "relative",
        transition: "background 180ms, border-color 180ms",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: on ? (locked ? INK.micro : "#ffffff") : INK.micro,
          transform: `translateX(${on ? 20 : 0}px)`,
          transition: "transform 180ms ease, background 180ms",
        }}
      />
    </span>
  );
}

/** Which pillar identity to draw for a phase, or `null` when it cannot be shown honestly — see `journeyScopeFromSow.ts`'s `pillarShown`. Preview phases (`JourneyPhase`, no `pillarById`) are always shown as their own `pillar`: the fixture's attribution is a real design decision, not a guess. */
function identityPillarFor(
  phase: JourneyPhase,
  pillarById: Readonly<Partial<Record<string, PillarKey>>> | undefined,
): PillarKey | null {
  if (!pillarById) return phase.pillar;
  return pillarById[phase.id] ?? null;
}

/* ------------------------------------------------------------------ *
 * Git #593 — the Delivery Timeline's real Gantt visual.
 *
 * Static CSS bars, same idiom as ReportFigures.tsx's `BarList`/`SplitBar` —
 * no charting library, no animation. Sequencing is keyed on `JourneyPhase.stage`
 * (Foundation always first, Closeout always last, Parallel-eligible phases
 * overlap, Continuous has no bounded duration) — never on array position or a
 * hardcoded phase count, since which phases and stages appear varies by
 * tenant. A phase carrying no recognised stage (a stored-document workstream;
 * see `journeyScopeFromSow.ts`) still renders, sequenced after the parallel
 * block and before Closeout, rather than being dropped.
 * ------------------------------------------------------------------ */

const KNOWN_GANTT_STAGES: ReadonlySet<JourneyPhaseStage> = new Set(["foundation", "parallel-eligible", "closeout", "continuous"]);

interface GanttBar {
  readonly phase: JourneyPhase;
  readonly start: number;
  readonly width: number;
}

/**
 * Lays out the bounded (non-continuous) phases actually in scope along one
 * shared week axis. A phase with no real quoted duration still draws a
 * 1-week sliver rather than collapsing to a zero-width bar nobody can see.
 */
function buildGanttLayout(
  phases: readonly JourneyPhase[],
  weeksFor: (id: string) => number | null,
): { bars: GanttBar[]; totalWeeks: number } {
  const weeksOrMin = (id: string) => {
    const w = weeksFor(id);
    return typeof w === "number" && w > 0 ? w : 1;
  };
  const bucket = (stage: JourneyPhaseStage) => phases.filter((p) => p.stage === stage);
  const foundation = bucket("foundation");
  const parallel = bucket("parallel-eligible");
  const closeout = bucket("closeout");
  const unstaged = phases.filter((p) => !KNOWN_GANTT_STAGES.has((p.stage ?? "") as JourneyPhaseStage));

  const bars: GanttBar[] = [];
  let cursor = 0;
  for (const p of foundation) {
    const width = weeksOrMin(p.id);
    bars.push({ phase: p, start: cursor, width });
    cursor += width;
  }
  const parallelStart = cursor;
  let parallelWidth = 0;
  for (const p of parallel) {
    const width = weeksOrMin(p.id);
    bars.push({ phase: p, start: parallelStart, width });
    parallelWidth = Math.max(parallelWidth, width);
  }
  cursor = parallelStart + parallelWidth;
  for (const p of unstaged) {
    const width = weeksOrMin(p.id);
    bars.push({ phase: p, start: cursor, width });
    cursor += width;
  }
  for (const p of closeout) {
    const width = weeksOrMin(p.id);
    bars.push({ phase: p, start: cursor, width });
    cursor += width;
  }

  return { bars, totalWeeks: Math.max(cursor, 1) };
}

const GANTT_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(150px,1fr) minmax(0,2.6fr)",
  gap: 14,
  alignItems: "center",
};

const GANTT_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: INK.headingDark,
};

/** One always-on service with no bounded duration — a hatched full-width band, not a positioned bar. */
function ContinuousBandRow({ title, color }: { readonly title: string; readonly color: string }) {
  return (
    <div style={GANTT_ROW}>
      <span style={GANTT_LABEL}>{title}</span>
      <span
        aria-hidden="true"
        style={{
          height: 10,
          borderRadius: 999,
          display: "block",
          background: `repeating-linear-gradient(135deg, ${hexAlpha(color, 0.4)} 0 7px, ${hexAlpha(color, 0.16)} 7px 14px)`,
        }}
      />
    </div>
  );
}

/**
 * The real Gantt: one row per bounded phase actually in scope, positioned by
 * its stage bucket and its own quoted duration, plus a continuous band for
 * every always-on service (a Continuous-stage phase, or a Continuous-stage
 * add-on the customer has toggled on — Tenant Monitoring). `null` when scope
 * carries nothing to draw at all.
 */
function PhaseGanttChart({
  scope,
  selection,
  pillarById,
  weeksQuotedById,
}: {
  readonly scope: JourneyScopeInput;
  readonly selection: JourneySelection;
  readonly pillarById: Readonly<Partial<Record<string, PillarKey>>> | undefined;
  readonly weeksQuotedById: Map<string, number | null>;
}) {
  const included = scope.phases.filter((p) => isPhaseIncluded(scope, selection, p.id));
  const bounded = included.filter((p) => p.stage !== "continuous");
  const continuousPhases = included.filter((p) => p.stage === "continuous");
  const continuousAddons = scope.addons.filter((a) => a.stage === "continuous" && selection.addons[a.id]);

  if (bounded.length === 0 && continuousPhases.length === 0 && continuousAddons.length === 0) return null;

  const { bars, totalWeeks } = buildGanttLayout(bounded, (id) => weeksQuotedById.get(id) ?? null);
  const hasContinuous = continuousPhases.length > 0 || continuousAddons.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "12px 14px",
        border: `1px solid ${INK.hairlineDark}`,
        borderRadius: 10,
      }}
    >
      {bars.map(({ phase, start, width }) => {
        const identity = identityPillarFor(phase, pillarById);
        const color = identity ? PILLARS[identity].primary : INK.micro;
        return (
          <div key={phase.id} style={GANTT_ROW}>
            <span style={GANTT_LABEL}>{phase.title}</span>
            <span
              aria-hidden="true"
              style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(148,163,184,.14)", display: "block" }}
            >
              <span
                style={{
                  position: "absolute",
                  left: `${(start / totalWeeks) * 100}%`,
                  width: `${(width / totalWeeks) * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: color,
                  opacity: 0.85,
                }}
              />
            </span>
          </div>
        );
      })}
      {hasContinuous ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 7,
            marginTop: bars.length ? 2 : 0,
            paddingTop: bars.length ? 7 : 0,
            borderTop: bars.length ? `1px dashed ${INK.hairlineDark}` : "none",
          }}
        >
          {continuousPhases.map((p) => {
            const identity = identityPillarFor(p, pillarById);
            const color = identity ? PILLARS[identity].primary : INK.micro;
            return <ContinuousBandRow key={p.id} title={p.title} color={color} />;
          })}
          {continuousAddons.map((a) => (
            <ContinuousBandRow key={a.id} title={a.title} color={INK.micro} />
          ))}
        </div>
      ) : null}
      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: INK.micro }}>
        {bars.length > 0
          ? `Foundation to close-out, approx. ${totalWeeks} ${totalWeeks === 1 ? "week" : "weeks"} bounded${
              hasContinuous ? " · continuous services run throughout" : ""
            }`
          : "Continuous services only — no bounded phases in this scope"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The real inputs a live journey supplies. See `LiveStatementOfWorkBody`
 * below for how these are fetched and mapped.
 * ------------------------------------------------------------------ */

export interface SowLiveInputs {
  readonly view: JourneyView;
  readonly built: JourneySowScope;
  /**
   * `payment-options`' own `phased.selfServe`, or `null` when this platform has
   * not stated a billing arrangement for this scope. Kept on the shape — the
   * Payment Terms row renders honestly from either value — even though the live
   * wrapper now always passes `null`: that endpoint reads the stored SOW row,
   * which is precisely the dependency this document no longer has.
   */
  readonly phasedSelfServe: boolean | null;
  /** `payment-options`' own `payInFull.active`. `false` unless a discount is confirmed — an unconfirmed one is never implied. */
  readonly payInFullActive: boolean;
  /**
   * Whether a signature taken here can actually be recorded.
   *
   * Used to be `false` for every engine-computed scope: `POST .../sow/checkout`
   * wrote an agreement row FK'd to a stored `insights_generated_documents` id
   * that does not exist for one, and there was no other way to pay. Git #599's
   * `checkout-session` + #600's PaymentIntent endpoints replace that path
   * entirely — neither reads a stored document — so `LiveStatementOfWorkBody`
   * now passes `true`. Left as a real prop rather than hardcoded so a caller
   * that genuinely cannot honour a signature (see `SOW_UNSIGNABLE`) still can.
   */
  readonly signable: boolean;
}

export function StatementOfWorkBody({
  onSigned,
  isPreview = true,
  live,
}: {
  readonly onSigned?: (query: string) => void;
  /** Default `true` so every existing (preview) call site is unchanged. */
  readonly isPreview?: boolean;
  /** Required when `isPreview` is `false`. */
  readonly live?: SowLiveInputs;
}) {
  const scope: JourneyScopeInput = !isPreview && live ? live.built.scope : PREVIEW_SCOPE;
  const pillarById = !isPreview && live ? live.built.pillarById : undefined;
  const tenant = !isPreview && live ? live.view.tenant : PREVIEW_TENANT;
  const pillars = !isPreview && live ? live.view.pillars : [];

  const [selection, setSelection] = useState<JourneySelection>(() => defaultSelection(scope));
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  /**
   * Git #602 — the live sign-and-pay flow's own state, entered the moment
   * `sign()` runs for a real (`!isPreview && live`) scope. The design preview
   * never touches this: it has no real tenant to snapshot a checkout session
   * against, so it keeps its original `onSigned` handoff to the standalone
   * checkout screen unchanged.
   */
  const [sowPayment, setSowPayment] = useState<
    | { readonly status: "idle" }
    | { readonly status: "creating" }
    | { readonly status: "ready"; readonly sessionId: string; readonly totalCents: number; readonly phaseCount: number; readonly addonCount: number }
    | { readonly status: "paid"; readonly amountCents: number }
    | { readonly status: "error"; readonly message: string }
  >({ status: "idle" });
  const { fetchWithAuth } = useAuth();

  // A live scope can change identity between the loading state and the ready
  // one (or across a re-selected SOW version) — reset the selection to match
  // whenever the scope itself changes, exactly as the proposal screen does.
  useEffect(() => {
    setSelection(defaultSelection(scope));
  }, [scope]);

  const adjustments = !isPreview && live ? live.built.adjustments : [];
  const adjustmentsUsd = !isPreview && live ? live.built.adjustmentsUsd : 0;
  // The platform's mandatory adjustment lines are never phases, but their
  // money is always owed — `withAdjustments()` is the same fold the proposal
  // screen applies before it shows a total, and skipping it here would
  // under-state what a signature on this page actually commits the customer
  // to pay.
  const totals = useMemo(
    () => withAdjustments(computeTotals(scope, selection), adjustmentsUsd),
    [scope, selection, adjustmentsUsd],
  );
  const scannedOn = tenant.scannedOn ?? "";
  const accent = reportAccent(null);

  const reference = !isPreview && live ? sowReference(live.built.docId) : "SMC-HM-2026-0803";
  const kicker = sowKicker(reference);
  const headline = sowHeadline(tenant.name);
  const standfirst = sowStandfirst(tenant.scannedOn);
  const consent = sowConsent(tenant.name);

  const allPhases = totals.includedPhaseCount === totals.totalPhaseCount;
  // The assessment-fee credit is a claim about what THIS tenant has already
  // paid. No check this platform runs reads that, so it is preview-only.
  const credit = isPreview && allPhases ? STATEMENT_OF_WORK.fullScopeCredit.amountUsd : 0;
  const netFee = totals.upfrontUsd - credit;

  /**
   * The projection this scope actually asserts.
   *
   * `totals.projectedScore` is the mean of every phase's resulting score, which
   * is `0` whenever no phase quotes a score movement — the case for every
   * engine-derived phase and every phase mapped from a stored SOW's pricing
   * lines alike. Printing that mean rendered "0 · 82 points short of the gate",
   * a forecast nothing in this platform produced. `projectedFromPhases` reads
   * the flatness and declines instead.
   */
  const projected = projectedFromPhases(scope.phases, totals.projectedScore);
  const clears = projected !== null && projected >= SOW_GATE_TARGET;
  const currentScore = !isPreview && live ? live.view.readinessScore : null;

  /**
   * The phases' own quoted durations, keyed by phase id.
   *
   * `JourneyPhase.weeks` is `weeksQuoted` with `null` flattened to `0` (it has
   * to be a number for `computeTotals()` to sum it), so it cannot tell "runs
   * zero weeks" from "quoted no duration" — and on a page with prices, "approx.
   * 0 weeks" is a claim rather than a blank. This is the unflattened truth,
   * read from the mapped scope rather than re-derived.
   */
  const weeksQuotedById = useMemo(() => {
    const m = new Map<string, number | null>();
    if (isPreview || !live) {
      // The design's fixture quotes a real duration on every phase.
      for (const p of scope.phases) m.set(p.id, p.weeks);
    } else {
      for (const p of live.built.phases) m.set(p.id, p.weeksQuoted);
    }
    return m;
  }, [isPreview, live, scope]);

  /** Whole weeks across the phases in scope, or `null` when none quoted one. */
  const quotedWeeks = useMemo(
    () =>
      quotedWeeksOf(
        scope.phases
          .filter((p) => isPhaseIncluded(scope, selection, p.id))
          .map((p) => ({ weeksQuoted: weeksQuotedById.get(p.id) ?? null })),
      ),
    [scope, selection, weeksQuotedById],
  );

  /** See `SowLiveInputs.signable`. Preview always signs — that is the design's own flow. */
  const signable = isPreview || !live ? true : live.signable;

  /**
   * Findings closed by the phases actually in scope, from the phases' own counts
   * rather than a second table that could drift from them.
   *
   * `null` when any in-scope phase does not carry a count — a SOW assembled from
   * the platform's wire format has prices and scope but no finding tally, and
   * silently treating that as zero would under-state a contract.
   */
  const findingsInScope = useMemo<number | null>(() => {
    let sum = 0;
    for (const p of scope.phases) {
      if (!isPhaseIncluded(scope, selection, p.id)) continue;
      if (p.findingCount === undefined) return null;
      sum += p.findingCount;
    }
    return sum;
  }, [scope, selection]);

  /** This tenant's real total finding count across all six pillars — the number Section 1/3/6 used to hardcode as Halden's "41". */
  const totalFindings = useMemo<number | null>(() => {
    if (isPreview || !live) return null;
    const total = pillars.reduce((n, p) => n + p.criticalCount + p.warningCount, 0);
    return total > 0 ? total : null;
  }, [isPreview, live, pillars]);

  const blockers = useMemo(
    () => (isPreview || !live ? STATEMENT_OF_WORK.blockers : buildLiveBlockers(pillars)),
    [isPreview, live, pillars],
  );
  const carry = useMemo<readonly SowPillarCarry[]>(
    () => (isPreview || !live ? STATEMENT_OF_WORK.carry : buildLiveCarry(pillars)),
    [isPreview, live, pillars],
  );

  const onTogglePhase = useCallback(
    (id: string) => {
      if (signed) return; // hard lock — scope is fixed at signature
      setSelection((prev) => togglePhase(scope, prev, id));
    },
    [signed, scope],
  );

  const onToggleAddon = useCallback(
    (id: string) => {
      if (signed) return;
      setSelection((prev) => toggleAddon(prev, id));
    },
    [signed],
  );

  const onPickTier = useCallback(
    (addonId: string, tierId: string) => {
      if (signed) return; // same hard lock togglePhase/toggleAddon apply — scope is fixed at signature
      setSelection((prev) => pickTier(prev, addonId, tierId));
    },
    [signed],
  );

  /**
   * Git #599's session snapshot, for the real scope this customer just
   * signed. Split out of `sign()` so a failed session creation (network blip,
   * a candidate that dropped out from under them) can be retried without
   * re-running the signature itself — the scope is already locked by then.
   */
  const startSowCheckout = useCallback(() => {
    if (!live) return;
    const selectedPhaseServiceIds = live.built.phases
      .filter((p) => isPhaseIncluded(scope, selection, p.id))
      .map((p) => p.serviceId)
      .filter((id): id is number => id !== null);
    const addonSelections = scope.addons
      .filter((a) => selection.addons[a.id])
      .map((a) => ({ addonId: a.id, tierId: selection.tiers[a.id] ?? a.defaultTierId ?? "" }))
      .filter((a) => a.tierId.length > 0);

    setSowPayment({ status: "creating" });
    void createSowCheckoutSession(fetchWithAuth, { selectedPhaseServiceIds, addonSelections })
      .then((session) => setSowPayment({ status: "ready", ...session }))
      .catch((err) =>
        setSowPayment({ status: "error", message: err instanceof Error ? err.message : "Could not start checkout." }),
      );
  }, [live, scope, selection, fetchWithAuth]);

  const sign = useCallback(() => {
    // The same doctrine the post-signature lock follows: the guard lives in the
    // handler, not only in whether a button was rendered.
    if (!signable || !agreed || signed) return;
    setSigned(true);

    // Git #602: a real, live scope creates its checkout session and pays
    // inline, right here — no navigation. The design preview has no real
    // tenant to snapshot a session against, so it keeps its original handoff
    // to the standalone checkout screen (`copilot-readiness-checkout.tsx`)
    // unchanged.
    if (!isPreview && live) {
      startSowCheckout();
      return;
    }

    const phases = scope.phases
      .map((p) => (isPhaseIncluded(scope, selection, p.id) ? "1" : "0"))
      .join("");
    const addons = scope.addons
      .filter((a) => selection.addons[a.id])
      .map((a) => `${a.id}:${selection.tiers[a.id] ?? ""}`)
      .join(",");
    // Hand the agreed scope to checkout so the signed block there is this
    // contract rather than a re-quote. Deferred briefly so the executed stamp
    // is actually seen.
    const query = new URLSearchParams({ signed: "1", phases, addons }).toString();
    window.setTimeout(() => onSigned?.(query), 1100);
  }, [signable, agreed, signed, selection, onSigned, scope, isPreview, live, startSowCheckout]);

  /** Substitutes the figures the contract computes rather than states. */
  const resolveRow = useCallback(
    (row: SowRow): string => {
      switch (row.derived) {
        case "total":
          return `${money(netFee)} fixed fee, phase by phase`;
        case "projected":
          return resolveProjected(isPreview, currentScore, projected, SOW_GATE_TARGET);
        case "findings":
          return resolveFindingsInScope(isPreview, findingsInScope, totalFindings);
        case "phaseCount":
          return phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount);
        case "weeks":
          return resolveWeeksRow(isPreview, quotedWeeks);
        case "newBudget":
          return resolveNewBudget(isPreview);
        case "netYear":
          return resolveNetYear(isPreview);
        case "gateLabel":
          return clears ? "Passing on this scope" : "Not safe yet";
        case "objective":
          return resolveObjective(isPreview, currentScore);
        case "findingsCarried":
          return resolveFindingsCarried(isPreview, totalFindings, blockers.length);
        case "whyMatters": {
          const sitesStat = pillars
            .find((p) => p.key === "governance")
            ?.stats.find((s) => s.id === "governance.sites");
          const sitesInScope = sitesStat && typeof sitesStat.value === "number" ? sitesStat.value : null;
          return resolveWhyMatters(isPreview, sitesInScope);
        }
        case "basisOfScope":
          // No narrative fetch runs on this document, so this platform has no
          // real curated-check count to quote here without a fetch beyond the
          // two this task named — the clause is honestly omitted rather than
          // sourced from a third endpoint.
          return resolveBasisOfScope(isPreview, null);
        case "changeWindows":
          return resolveChangeWindows(isPreview);
        case "elapsedDays": {
          const days = isPreview ? null : elapsedDaysSince(tenant.scannedOn ? tenant.scannedOn : null, new Date().toISOString());
          return resolveElapsedDays(isPreview, days);
        }
        case "telemetrySource":
          return resolveTelemetrySource(isPreview, tenant.scannedOn);
        case "wasteRecovered": {
          const wasteStat = pillars
            .find((p) => p.key === "licensing")
            ?.stats.find((s) => s.id === "licensing.annualWaste");
          const wasteUsd = wasteStat && typeof wasteStat.value === "number" ? wasteStat.value : null;
          return resolveWasteRecovered(isPreview, wasteUsd);
        }
        case "paymentTerms":
          return resolvePaymentTerms(
            isPreview,
            !isPreview && live ? live.phasedSelfServe : null,
            !isPreview && live ? live.payInFullActive : false,
          );
        case "validity": {
          const validUntilIso = !isPreview && live ? live.built.quoteHoldIso : null;
          return resolveValidity(isPreview, validUntilIso ? formatSowDate(validUntilIso) : null);
        }
        case "phasesParallel":
          return resolvePhasesInParallel(isPreview);
        case "strictlySequential":
          return resolveStrictlySequential(isPreview);
        default:
          return row.value ?? "";
      }
    },
    [
      netFee,
      isPreview,
      currentScore,
      projected,
      findingsInScope,
      totalFindings,
      totals,
      quotedWeeks,
      clears,
      blockers.length,
      pillars,
      tenant.scannedOn,
      live,
    ],
  );

  const deliverables = useMemo(
    () =>
      sowDeliverables({
        findingsLabel:
          isPreview || totalFindings === null ? "41 findings" : `${totalFindings} findings`,
        blockersLabel: `${blockers.length} findings`,
      }),
    [isPreview, totalFindings, blockers.length],
  );

  const provenance = useMemo(
    () =>
      isPreview
        ? `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions. ${PREVIEW_SIGNAL_COUNT} signal derivation checks across six pillars. No configuration was altered during assessment.`
        : buildProvenance(tenant.scannedOn, 0),
    [isPreview, scannedOn, tenant.scannedOn],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 13,
          borderBottom: `1px solid ${INK.hairlineDark}`,
          paddingBottom: 24,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: BRAND.teal,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={BRAND.teal} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
            <path d={accent.icon} />
          </svg>
          {kicker}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px,2.8vw,31px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
            color: INK.headingDark,
          }}
        >
          {headline}
        </h1>
        <p style={{ ...BODY, fontSize: 15.5, lineHeight: 1.62 }}>{standfirst}</p>
      </div>

      {/* Sections 1-5 and 7 */}
      {STATEMENT_OF_WORK.sections.map((section) => (
        <div key={section.heading} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <h2 style={H2}>{section.heading}</h2>
          {section.intro ? (
            <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
              {section.intro}
            </p>
          ) : null}
          {section.rows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
              {section.rows.map((row) => (
                <Row key={row.label} label={row.label} tone={row.tone} value={resolveRow(row)} />
              ))}
            </div>
          ) : null}

          {/* Section 5 lists the blockers under its two rows. */}
          {section.heading.startsWith("5 ·")
            ? blockers.map((b) => (
                <div
                  key={b.text}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "baseline",
                    borderLeft: `2px solid ${SEVERITY_ON_DARK.critical}`,
                    padding: "8px 10px 8px 14px",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: PILLARS[b.pillar].primary,
                      flex: "none",
                      width: 92,
                    }}
                  >
                    {PILLARS[b.pillar].label}
                  </span>
                  <p style={{ ...BODY, fontSize: 14, lineHeight: 1.6 }}>{b.text}</p>
                </div>
              ))
            : null}

          {/* Section 7's carry-over table sits above its closing note. */}
          {section.heading.startsWith("7 ·")
            ? (
                <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
                  {carry.map((c) => (
                    <div
                      key={c.pillar}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px,.7fr) 92px minmax(0,2.2fr)",
                        gap: 14,
                        padding: "11px 10px",
                        borderBottom: `1px solid ${INK.hairlineDark}`,
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          color: INK.headingDark,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{ width: 7, height: 7, borderRadius: 2, background: PILLARS[c.pillar].primary, flex: "none" }}
                        />
                        {PILLARS[c.pillar].label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK.bodyDarkStrong, ...TABULAR }}>
                        {`${c.count} findings`}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
                        {c.detail}
                      </span>
                    </div>
                  ))}
                </div>
              )
            : null}
        </div>
      ))}

      {/* Section 6 — deliverable summary */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>6 · Section-by-Section Deliverable Summary</h2>
        <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
          {deliverables.map((d) => (
            <Row key={d.section} label={d.section} tone="healthy" value={d.detail} />
          ))}
        </div>
      </div>

      {/* Delivery timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{STATEMENT_OF_WORK.timeline.heading}</h2>
        <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
          {resolveTimelineIntro(isPreview)}
        </p>
        <PhaseGanttChart scope={scope} selection={selection} pillarById={pillarById} weeksQuotedById={weeksQuotedById} />
        <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
          {scope.phases.map((p, i) => {
            const on = isPhaseIncluded(scope, selection, p.id);
            const identity = identityPillarFor(p, pillarById);
            // Preview phases each carry a matching design deliverable; a live
            // SOW workstream has its own scope sentence but no separate
            // per-phase deliverable list, so that column is left blank rather
            // than reused from an unrelated phase index.
            const deliverable = isPreview ? STATEMENT_OF_WORK.timeline.deliverables[i] : p.scope;
            return (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px,1fr) minmax(0,1.8fr) 96px",
                  gap: 14,
                  padding: "11px 10px",
                  borderBottom: `1px solid ${INK.hairlineDark}`,
                  alignItems: "baseline",
                  opacity: on ? 1 : 0.42,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: INK.headingDark }}>{p.title}</span>
                <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
                  {deliverable}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: "right",
                    color: on && identity ? PILLARS[identity].primary : INK.micro,
                    ...TABULAR,
                  }}
                >
                  {resolvePhaseDuration(isPreview, on, weeksQuotedById.get(p.id) ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 8 — the scope decision */}
      <div data-sow-scope style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{STATEMENT_OF_WORK.phases.heading}</h2>
        <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
          {STATEMENT_OF_WORK.phases.intro}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {scope.phases.map((p, i) => {
            const on = isPhaseIncluded(scope, selection, p.id);
            const identityKey = identityPillarFor(p, pillarById);
            const identity = identityKey ? PILLARS[identityKey] : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onTogglePhase(p.id)}
                disabled={p.locked}
                aria-pressed={on}
                title={
                  signed
                    ? "Scope locked at signature"
                    : p.locked
                      ? "Required — cannot be removed"
                      : on
                        ? "Remove from scope"
                        : "Add to scope"
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 14,
                  alignItems: "start",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: `1px ${signed ? "dashed" : "solid"} ${on ? INK.hairlineDark : "rgba(30,41,59,.55)"}`,
                  background: on ? "rgba(15,23,42,.5)" : "rgba(15,23,42,.2)",
                  opacity: on ? 1 : 0.42,
                  cursor: signed || p.locked ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  transition: "opacity 180ms, background 180ms, border-color 180ms",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                        color: identity ? identity.primary : INK.micro,
                      }}
                    >
                      {identity ? `Phase ${i + 1} · ${identity.label}` : `Phase ${i + 1}`}
                    </span>
                    {p.locked ? (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".14em",
                          textTransform: "uppercase",
                          color: SEVERITY_ON_DARK.attention,
                        }}
                      >
                        Required
                      </span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: INK.headingDark, lineHeight: 1.35 }}>
                    {p.title}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
                    {p.scope}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
                    {p.addresses}
                  </span>
                  {p.stage === "continuous" ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: SEVERITY_ON_DARK.attention }}>
                      Ongoing service, not a bounded project — cancel with 30 days
                    </span>
                  ) : null}
                  {p.scoreTo !== p.scoreFrom ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: severityColor(p.scoreFrom), ...TABULAR }}>
                        {p.scoreFrom}
                      </span>
                      <span aria-hidden="true" style={{ color: INK.micro, fontSize: 12 }}>
                        →
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: severityColor(p.scoreTo), ...TABULAR }}>
                        {p.scoreTo}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.teal, ...TABULAR }}>
                        {`+${p.scoreTo - p.scoreFrom}`}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flex: "none" }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: INK.headingDark, ...TABULAR }}>
                    {money(p.priceUsd)}
                  </span>
                  <Toggle on={on} locked={signed} />
                </span>
              </button>
            );
          })}
        </div>

        {adjustments.length > 0 ? <IncludedAdjustments lines={adjustments} /> : null}

        {/* Optional services */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 6 }}>
          {scope.addons.map((a) => {
            const on = Boolean(selection.addons[a.id]);
            const selectedTierId = selection.tiers[a.id] ?? a.defaultTierId ?? "";
            const singleTier = a.tiers.length === 1 ? a.tiers[0] : null;
            // #594's real tier picker — a.tiers.length > 1 is exactly the
            // Architect Retainer's seat-banded shape (Essentials/Growth/
            // Enterprise); Tenant Monitoring resolves to one real tier
            // (Git #609) and never reaches this branch.
            const hasTierPicker = a.tiers.length > 1;
            return (
              <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hasTierPicker ? (
                  // Git #609: no outer enable/disable step for a tiered addon
                  // — it starts active with its seat-matched tier already
                  // selected (defaultSelection()); the customer's only
                  // actions are picking a different tier below or removing
                  // the add-on with this header switch.
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) auto",
                      gap: 14,
                      alignItems: "start",
                      padding: "14px 16px",
                      borderRadius: 10,
                      border: `1px ${signed ? "dashed" : "solid"} ${on ? hexAlpha(BRAND.teal, 0.4) : "rgba(30,41,59,.55)"}`,
                      background: on ? hexAlpha(BRAND.teal, 0.07) : "rgba(15,23,42,.2)",
                      opacity: on ? 1 : 0.42,
                      transition: "opacity 180ms, background 180ms, border-color 180ms",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: INK.headingDark }}>{a.title}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}>
                        {a.blurb}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleAddon(a.id)}
                      aria-pressed={on}
                      title={signed ? "Scope locked at signature" : on ? "Remove from scope" : "Add to scope"}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        cursor: signed ? "not-allowed" : "pointer",
                      }}
                    >
                      <Toggle on={on} locked={signed} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggleAddon(a.id)}
                    aria-pressed={on}
                    title={signed ? "Scope locked at signature" : on ? "Remove from scope" : "Add to scope"}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) auto",
                      gap: 14,
                      alignItems: "start",
                      textAlign: "left",
                      padding: "14px 16px",
                      borderRadius: 10,
                      border: `1px ${signed ? "dashed" : "solid"} ${on ? hexAlpha(BRAND.teal, 0.4) : "rgba(30,41,59,.55)"}`,
                      background: on ? hexAlpha(BRAND.teal, 0.07) : "rgba(15,23,42,.2)",
                      opacity: on ? 1 : 0.42,
                      cursor: signed ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      transition: "opacity 180ms, background 180ms, border-color 180ms",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: INK.headingDark }}>{a.title}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}>
                        {a.blurb}
                      </span>
                      {a.stage === "continuous" ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: SEVERITY_ON_DARK.attention }}>
                          Ongoing service, not a bounded project — cancel with 30 days
                        </span>
                      ) : null}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flex: "none" }}>
                      {singleTier ? (
                        <span style={{ fontSize: 14, fontWeight: 800, color: INK.headingDark, ...TABULAR }}>
                          {singleTier.monthlyUsd > 0 ? `${money(singleTier.monthlyUsd)}/mo` : money(singleTier.upfrontUsd)}
                        </span>
                      ) : null}
                      <Toggle on={on} locked={signed} />
                    </span>
                  </button>
                )}

                {hasTierPicker ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                      gap: 8,
                      paddingLeft: 4,
                      opacity: on ? 1 : 0.42,
                      transition: "opacity 180ms",
                    }}
                  >
                    {a.tiers.map((t) => {
                      const selected = on && t.id === selectedTierId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onPickTier(a.id, t.id)}
                          aria-pressed={selected}
                          title={signed ? "Scope locked at signature" : `Select ${t.label}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                            textAlign: "left",
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: `1px ${signed ? "dashed" : "solid"} ${selected ? hexAlpha(BRAND.teal, 0.5) : "rgba(30,41,59,.55)"}`,
                            background: selected ? hexAlpha(BRAND.teal, 0.1) : "rgba(15,23,42,.2)",
                            cursor: signed ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            transition: "border-color 180ms, background 180ms",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              letterSpacing: ".14em",
                              textTransform: "uppercase",
                              color: t.emphasis ? BRAND.teal : INK.micro,
                            }}
                          >
                            {t.label}
                            {t.emphasis === "recommended" ? " · recommended" : ""}
                            {t.emphasis === "seat-match" ? " · your seat count" : ""}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: INK.headingDark, ...TABULAR }}>
                            {t.monthlyUsd > 0 ? `${money(t.monthlyUsd)}/mo` : money(t.upfrontUsd)}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.45, color: INK.bodyDark }}>
                            {t.detail}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "16px 18px",
            border: `1px solid ${INK.hairlineDark}`,
            borderRadius: 10,
            background: "rgba(2,6,23,.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.bodyDark }}>
              {`${phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)} · ${resolveTimeline(isPreview, quotedWeeks)}`}
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: INK.headingDark, ...TABULAR }}>{money(netFee)}</span>
          </div>
          {credit > 0 ? (
            <span style={{ fontSize: 11.5, fontWeight: 500, color: SEVERITY_ON_DARK.healthy }}>
              {STATEMENT_OF_WORK.fullScopeCredit.note}
            </span>
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: INK.micro }}>
              {totals.recurringNames.length > 0
                ? `${totals.recurringNames.join(" + ")}, cancel with 30 days`
                : "No optional services in scope"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.teal, ...TABULAR }}>
              {totals.monthlyUsd > 0 ? monthlyLabel(totals.monthlyUsd) : "None selected"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 14,
              paddingTop: 8,
              borderTop: `1px solid ${INK.hairlineDark}`,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.bodyDark }}>Projected readiness</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: projected === null ? INK.micro : severityColor(projected),
                ...TABULAR,
              }}
            >
              {projected === null
                ? "—"
                : clears
                  ? `${projected} · clears the ${SOW_GATE_TARGET} gate`
                  : `${projected} · ${SOW_GATE_TARGET - projected} points short of the gate`}
            </span>
          </div>
        </div>
      </div>

      {/* Signature */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "20px 22px",
          border: `1px solid ${
            !signable
              ? INK.hairlineDark
              : signed
                ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.4)
                : hexAlpha(BRAND.teal, 0.32)
          }`,
          borderRadius: 12,
          background: !signable
            ? "rgba(15,23,42,.3)"
            : signed
              ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.06)
              : hexAlpha(BRAND.teal, 0.06),
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: !signable ? INK.micro : signed ? SEVERITY_ON_DARK.healthy : BRAND.teal,
          }}
        >
          {signed && signable ? <Lock size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
          {!signable
            ? SOW_UNSIGNABLE.eyebrow
            : signed
              ? STATEMENT_OF_WORK.signature.signedEyebrow
              : STATEMENT_OF_WORK.signature.unsignedEyebrow}
        </span>
        <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6 }}>
          {!signable
            ? SOW_UNSIGNABLE.blurb
            : signed
              ? STATEMENT_OF_WORK.signature.signedBlurb
              : STATEMENT_OF_WORK.signature.unsignedBlurb}
        </p>

        {/* No clickwrap and no button when a signature could not be recorded —
            an agreement that cannot be written is not one to invite. */}
        {!signable ? null : signed ? (
          isPreview || !live ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_ON_DARK.healthy, ...TABULAR }}>
              {`Executed · ${phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)} · ${money(netFee)}`}
            </span>
          ) : sowPayment.status === "paid" ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_ON_DARK.healthy, ...TABULAR }}>
              {`Executed & paid · ${phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)} · ${money(sowPayment.amountCents / 100)}`}
            </span>
          ) : sowPayment.status === "ready" ? (
            <SowCartPaymentPanel
              fetchWithAuth={fetchWithAuth}
              sessionId={sowPayment.sessionId}
              totalCents={sowPayment.totalCents}
              phaseCount={sowPayment.phaseCount}
              addonCount={sowPayment.addonCount}
              onPaid={(amountCents) => setSowPayment({ status: "paid", amountCents })}
            />
          ) : sowPayment.status === "error" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>{sowPayment.message}</span>
              <button
                type="button"
                onClick={startSowCheckout}
                style={{
                  alignSelf: "flex-start",
                  height: 34,
                  padding: "0 16px",
                  border: 0,
                  borderRadius: 6,
                  background: BRAND.blue,
                  color: BRAND.white,
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 500, color: INK.micro }}>Starting your checkout…</span>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              role="checkbox"
              aria-checked={agreed}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                border: 0,
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  flex: "none",
                  marginTop: 1,
                  border: `1px solid ${agreed ? BRAND.teal : "rgba(71,85,105,.9)"}`,
                  background: agreed ? BRAND.teal : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 160ms, border-color 160ms",
                }}
              >
                <Check size={11} strokeWidth={3.4} color="#020617" style={{ opacity: agreed ? 1 : 0 }} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
                {consent}
              </span>
            </button>
            <button
              type="button"
              onClick={sign}
              disabled={!agreed}
              style={{
                alignSelf: "flex-start",
                height: 38,
                padding: "0 18px",
                border: 0,
                borderRadius: 6,
                background: BRAND.blue,
                color: BRAND.white,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                cursor: agreed ? "pointer" : "not-allowed",
                opacity: agreed ? 1 : 0.45,
                transition: "opacity 160ms",
              }}
            >
              {agreed ? STATEMENT_OF_WORK.signature.signedCta : STATEMENT_OF_WORK.signature.unsignedCta}
            </button>
          </>
        )}
      </div>

      <p
        style={{
          margin: 0,
          paddingTop: 20,
          borderTop: `1px solid ${INK.hairlineDark}`,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: INK.bodyDark,
        }}
      >
        {provenance}
      </p>
    </div>
  );
}

/**
 * The platform's mandatory price lines, shown as what they are — same
 * treatment `IncludedAdjustments` gets on the SOW Proposal screen. Not phase
 * cards: an adjustment has no scope of work, no toggle, and its money is
 * already inside `totals` above.
 */
function IncludedAdjustments({ lines }: { readonly lines: readonly JourneyAdjustmentLine[] }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(51,65,85,.9)",
        borderRadius: 10,
        background: "rgba(15,23,42,.3)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".2em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        <Lock size={11} strokeWidth={2.2} color={INK.micro} aria-hidden="true" />
        Included adjustments
      </span>
      {lines.map((line) => (
        <div
          key={line.id}
          style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: INK.bodyDarkStrong }}>{line.title}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: INK.headingDark, ...TABULAR }}>
            {money(line.priceUsd)}
          </span>
        </div>
      ))}
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
        Set by the platform against your tenant, not a phase you can add or remove. Already counted in the totals
        below.
      </p>
    </div>
  );
}

function formatSowDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ *
 * LiveStatementOfWorkBody — the self-fetching wrapper `DocumentBody.tsx`
 * mounts on a real journey.
 * ------------------------------------------------------------------ */

type SowLoad =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly built: JourneySowScope }
  | { readonly status: "none" }
  | { readonly status: "error"; readonly message: string };

/**
 * ONE fetch, and it is not a document lookup.
 *
 * This used to be two — `GET .../assessment/sow` for the scope and
 * `.../sow/payment-options` for the billing terms — and BOTH are
 * `loadSowDocs()` over `insights_generated_documents`, so both returned nothing
 * until `document-engine-sow.ts` had generated and stored a SOW for the tenant.
 * That made the contract the only document in the set gated on a generation run.
 *
 * It now reads the Sales Offer Engine directly. The payment-options fetch is
 * gone rather than kept as a best-effort extra: without a stored document it can
 * only ever answer `{ ready: false }`, and `resolvePaymentTerms(false, null,
 * false)` already renders that state honestly as "Confirmed at checkout for your
 * agreed scope" — a request that cannot succeed is not worth making.
 */
export function LiveStatementOfWorkBody({
  view,
  onSigned,
}: {
  readonly view: JourneyView;
  readonly onSigned?: (query: string) => void;
}) {
  const { fetchWithAuth, accessToken } = useAuth();
  const [load, setLoad] = useState<SowLoad>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(RECOMMENDED_OFFERS_URL);
        if (!res.ok) throw new Error(`recommended-offers ${res.status}`);
        const body = (await res.json()) as WireRecommendedOffers;
        if (cancelled) return;
        const built = journeyScopeFromOffers(body);
        setLoad(built ? { status: "ready", built } : { status: "none" });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setLoad({ status: "error", message });
        reportClientEvent(accessToken, "StatementOfWorkScopeFetchFailed", message, JOURNEY_CHANNEL, {
          url: RECOMMENDED_OFFERS_URL,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, accessToken]);

  if (load.status === "ready") {
    return (
      <StatementOfWorkBody
        isPreview={false}
        onSigned={onSigned}
        live={{
          view,
          built: load.built,
          // Both come off `payment-options`, which reads the stored document
          // this scope deliberately does not have. Stated as unknown rather
          // than guessed — see `resolvePaymentTerms`.
          phasedSelfServe: null,
          payInFullActive: false,
          // Git #602: true now that signing a live scope pays it, right here,
          // through #599/#600's checkout-session + PaymentIntent endpoints —
          // neither depends on the stored `insights_generated_documents` row
          // that made this `false` before. See `SowLiveInputs.signable`.
          signable: true,
        }}
      />
    );
  }

  if (load.status === "loading") {
    return (
      <span style={{ fontSize: 13, fontWeight: 500, color: INK.micro, padding: "26px 0", display: "block" }}>
        Loading your statement of work…
      </span>
    );
  }

  if (load.status === "error") {
    return (
      <JourneyUnavailable
        title="We could not load your statement of work"
        detail={`The scope request failed (${load.message}). Nothing has been lost — reload the page, and if it keeps failing your assessment lead can pull the scope up directly.`}
      />
    );
  }

  // The engine returned no candidates. That is a real answer about this tenant,
  // not a document waiting to be generated, and the copy says so: nothing is in
  // flight and there is nothing to wait for. It is deliberately NOT the old
  // "has not been generated yet" wording, which described a pipeline this
  // document no longer depends on.
  return (
    <JourneyUnavailable
      title="No priced remediation scope for your tenant"
      detail="A statement of work is priced from the findings your assessment recorded, and none of them currently maps to a service we can scope and quote. Your reports are unaffected and still complete — speak to your assessment lead about what closing these findings would involve."
    />
  );
}
