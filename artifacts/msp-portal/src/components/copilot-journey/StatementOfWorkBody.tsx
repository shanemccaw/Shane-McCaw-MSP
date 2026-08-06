/**
 * StatementOfWorkBody.tsx — document 9 of 9, and the only one the customer
 * signs.
 *
 * ONE AGREEMENT, ONE SET OF ARITHMETIC
 * ------------------------------------
 * Scope and totals come from `journeyPricing.ts`. In preview that is over
 * `PREVIEW_SCOPE`, the design's worked example; on a live journey it is the
 * mapped `GET /api/portal/assessment/sow` scope — the SAME module and the same
 * `journeyScopeFromSow()` mapping the standalone proposal screen
 * (`/copilot-readiness/proposal`) uses. Nothing in this file adds up a fee.
 * Two live surfaces over one contract that each did their own maths would
 * eventually quote two different numbers to the same customer, and the one
 * place that must never happen is the page with a signature on it.
 *
 * The design intends this document to supersede that screen. It is left
 * standing for now and this is additive; the header's "Ready to fix this?"
 * already lands here when the document exists.
 *
 * SIGNING IS A HARD LOCK, NOT A DISABLED STATE
 * --------------------------------------------
 * After signature the toggles stop responding rather than merely looking
 * inactive, because a contract that is still editable after execution is not a
 * contract. The lock lives in the handlers, not in CSS.
 *
 * WHAT THIS DOES NOT DO: it takes no payment and creates no agreement record.
 * Signing hands the agreed scope to the checkout screen, which is where the
 * platform's real Stripe path lives — the same handoff the proposal screen makes.
 *
 * PREVIEW VS LIVE (#292)
 * -----------------------
 * `StatementOfWorkBody` itself is presentational: pass `isPreview` (the
 * default, matching its original behaviour byte-for-byte) to render the
 * design's own Halden Materials worked example, or pass `isPreview={false}`
 * with `live` to render a real tenant's contract. `LiveStatementOfWorkBody`
 * below is the self-fetching wrapper `DocumentBody.tsx` actually mounts on a
 * real journey — it owns the two real fetches
 * (`GET /api/portal/assessment/sow`, `.../sow/payment-options`), mirroring the
 * proposal screen's own fetch/error/loading pattern exactly, and hands the
 * resolved scope down as `live`. See `sowLiveContract.ts` for what is real,
 * what is computed, and — for the handful of rows the design's fixture can
 * state and this platform genuinely cannot — what is an honest declared gap.
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
  togglePhase,
  toggleAddon,
  weeksLabel,
  type JourneyPhase,
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
  resolveBasisOfScope,
  resolveChangeWindows,
  resolveElapsedDays,
  resolveFindingsCarried,
  resolveFindingsInScope,
  resolveNetYear,
  resolveNewBudget,
  resolveObjective,
  resolvePaymentTerms,
  resolveProjected,
  resolveTelemetrySource,
  resolveValidity,
  resolveWasteRecovered,
  resolveWhyMatters,
} from "./sowLiveContract.ts";
import { buildProvenance } from "./liveReportBlocks.ts";
import {
  journeyScopeFromSow,
  withAdjustments,
  type JourneyAdjustmentLine,
  type JourneySowScope,
  type WireSowState,
} from "./journeyScopeFromSow.ts";
import type { JourneyView } from "./journeyModel.ts";
import { JourneyUnavailable } from "./JourneyPrimitives";

const SOW_URL = "/api/portal/assessment/sow";
const PAYMENT_OPTIONS_URL = "/api/portal/assessment/sow/payment-options";
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
 * The real inputs a live journey supplies. See `LiveStatementOfWorkBody`
 * below for how these are fetched and mapped.
 * ------------------------------------------------------------------ */

export interface SowLiveInputs {
  readonly view: JourneyView;
  readonly built: JourneySowScope;
  /** `payment-options`' own `phased.selfServe`, or `null` before that fetch settles. Best-effort: the contract renders fully without it. */
  readonly phasedSelfServe: boolean | null;
  /** `payment-options`' own `payInFull.active`. `false` before that fetch settles — an unconfirmed discount is never implied. */
  readonly payInFullActive: boolean;
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

  const projected = totals.projectedScore;
  const clears = projected !== null && projected >= SOW_GATE_TARGET;
  const currentScore = !isPreview && live ? live.view.readinessScore : null;

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

  const sign = useCallback(() => {
    if (!agreed || signed) return;
    setSigned(true);
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
  }, [agreed, signed, selection, onSigned, scope]);

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
          return `${weeksLabel(totals.weeks)} to certification`;
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
          {STATEMENT_OF_WORK.timeline.intro}
        </p>
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
                  {on ? `${p.weeks} ${p.weeks === 1 ? "week" : "weeks"}` : "Out of scope"}
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
            return (
              <button
                key={a.id}
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
                </span>
                <Toggle on={on} locked={signed} />
              </button>
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
              {`${phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)} · ${weeksLabel(totals.weeks)}`}
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
          border: `1px solid ${signed ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.4) : hexAlpha(BRAND.teal, 0.32)}`,
          borderRadius: 12,
          background: signed ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.06) : hexAlpha(BRAND.teal, 0.06),
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
            color: signed ? SEVERITY_ON_DARK.healthy : BRAND.teal,
          }}
        >
          {signed ? <Lock size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
          {signed ? STATEMENT_OF_WORK.signature.signedEyebrow : STATEMENT_OF_WORK.signature.unsignedEyebrow}
        </span>
        <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6 }}>
          {signed ? STATEMENT_OF_WORK.signature.signedBlurb : STATEMENT_OF_WORK.signature.unsignedBlurb}
        </p>

        {signed ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_ON_DARK.healthy, ...TABULAR }}>
            {`Executed · ${phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)} · ${money(netFee)}`}
          </span>
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
  | { readonly status: "none"; readonly regenerating: boolean }
  | { readonly status: "error"; readonly message: string };

/** The subset of `payment-options`' response this document reads. Every field optional — a malformed or partial payload degrades to the generic Payment Terms wording rather than failing the fetch. */
interface WirePaymentOptions {
  readonly ready?: boolean;
  readonly phased?: { readonly selfServe?: boolean };
  readonly payInFull?: { readonly active?: boolean };
}

export function LiveStatementOfWorkBody({
  view,
  onSigned,
}: {
  readonly view: JourneyView;
  readonly onSigned?: (query: string) => void;
}) {
  const { fetchWithAuth, accessToken } = useAuth();
  const [load, setLoad] = useState<SowLoad>({ status: "loading" });
  const [payment, setPayment] = useState<WirePaymentOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SOW_URL);
        if (!res.ok) throw new Error(`sow ${res.status}`);
        const body = (await res.json()) as WireSowState;
        if (cancelled) return;
        const built = journeyScopeFromSow(body);
        if (!built) {
          setLoad({ status: "none", regenerating: body.regenerating === true });
          return;
        }
        setLoad({ status: "ready", built });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setLoad({ status: "error", message });
        reportClientEvent(accessToken, "StatementOfWorkScopeFetchFailed", message, JOURNEY_CHANNEL, {
          url: SOW_URL,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, accessToken]);

  // Best-effort and independent of the scope fetch above: the contract's
  // Payment Terms row degrades to generic-but-honest wording if this never
  // lands, exactly as the rest of the document degrades when a check did not
  // report — it never blocks the signable contract from rendering.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(PAYMENT_OPTIONS_URL);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as WirePaymentOptions;
        if (!cancelled) setPayment(body);
      } catch {
        // Non-fatal — see the comment above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  if (load.status === "ready") {
    return (
      <StatementOfWorkBody
        isPreview={false}
        onSigned={onSigned}
        live={{
          view,
          built: load.built,
          phasedSelfServe: payment?.phased?.selfServe ?? null,
          payInFullActive: payment?.payInFull?.active === true,
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

  return (
    <JourneyUnavailable
      title={
        load.status === "none" && load.regenerating
          ? "Your statement of work is being rebuilt"
          : "Your statement of work has not been generated yet"
      }
      detail={
        load.status === "none" && load.regenerating
          ? "A new version of your scope is generating from the assessment right now. It takes a few minutes; this page will show it once it lands."
          : "The scope is written from your assessment findings, and it has not been produced for this tenant yet. Your other reports are already available — the priced phases follow from them."
      }
    />
  );
}
