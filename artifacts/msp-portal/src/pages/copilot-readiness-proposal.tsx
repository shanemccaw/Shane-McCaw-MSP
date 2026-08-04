/**
 * copilot-readiness-proposal.tsx — Screen 3 of the Copilot Readiness journey.
 *
 * Route: `/copilot-readiness/proposal` (bare path — the whole authenticated
 * subtree is mounted inside `<WouterRouter base={"/" + slug}>`, so the tenant
 * slug is prefixed for us).
 *
 * The findings become a scope the customer configures and signs. Every card is a
 * decision; the totals, the phase count, the week estimate and the projected
 * readiness all move as those decisions are made, and the sticky header states
 * both halves of what is being agreed to — "Today {upfront} then {monthly}" —
 * because an unlabelled figure that silently drops a line item on a screen the
 * customer signs is misleading.
 *
 * Renders outside AppShell, like `pages/war-room.tsx`: this is a full-bleed,
 * theme-fixed dark surface (`.cj-dark`, `#020617`) and the portal's own chrome
 * and light/dark toggle would fight it.
 *
 * WHERE THE NUMBERS COME FROM
 * ---------------------------
 *   • `?preview=design` → `PREVIEW_SCOPE`, the design's worked example, and a
 *     permanent `<PreviewBadge />` so it can never be read as a real tenant.
 *   • Otherwise → `GET /api/portal/assessment/sow`, mapped by the shared
 *     `journeyScopeFromSow()`. `allWorkstreams` are the toggleable phases;
 *     `adjustments` are the platform's own mandatory PRICE lines and are
 *     rendered as their own "Included adjustments" block, never as phases —
 *     see that module's header for why that distinction is load-bearing. With
 *     no scope document the screen says so and links back to the reports — it
 *     never falls back to the fixture's prices.
 *   • Findings counts and today's readiness → `useCopilotJourney()`, over the
 *     same real payloads the rest of the journey reads.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Lock } from "lucide-react";

import { JourneySignaturePanel, type JourneySignature } from "@/components/copilot-journey/JourneySignaturePanel";
import { BrandMark, JourneyUnavailable, PreviewBadge } from "@/components/copilot-journey/JourneyPrimitives";
import { ProposalAddonCard } from "@/components/copilot-journey/ProposalAddonCard";
import { ProposalPhaseCard } from "@/components/copilot-journey/ProposalPhaseCard";
import { ProposalSummaryRail } from "@/components/copilot-journey/ProposalSummaryRail";
import { tenantStrip } from "@/components/copilot-journey/journeyModel.ts";
import {
  computeTotals,
  defaultSelection,
  isPhaseIncluded,
  money,
  monthlyLabel,
  phaseCountLabel,
  pickTier,
  toggleAddon,
  togglePhase,
  type JourneyScopeInput,
  type JourneySelection,
} from "@/components/copilot-journey/journeyPricing.ts";
import {
  journeyScopeFromSow,
  quotedWeeks,
  withAdjustments,
  type JourneyAdjustmentLine,
  type JourneySowPhase,
  type JourneySowScope,
  type WireSowState,
} from "@/components/copilot-journey/journeyScopeFromSow.ts";
import {
  PREVIEW_SCOPE,
  PREVIEW_TENANT,
  PREVIEW_READINESS_SCORE,
  previewJourneyView,
} from "@/components/copilot-journey/journeyPreviewFixture.ts";
import {
  INK,
  RADIUS,
  TABULAR,
  type PillarKey,
} from "@/components/copilot-journey/journeyTokens.ts";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
// The handoff key and its shape are DECLARED BY SCREEN 4 and imported here, so
// the writer and the reader of `sessionStorage` cannot drift apart. Screen 4
// refuses to render without this payload; a second copy of the key in this file
// would make a rename on either side a silent, invisible break.
import {
  SIGNED_SCOPE_KEY,
  type SignedScopeHandoff,
} from "@/pages/copilot-readiness-checkout";
import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import "@/components/copilot-journey/copilot-journey.css";

const SOW_URL = "/api/portal/assessment/sow";
const DASHBOARD_URL = "/api/portal/dashboard";
const JOURNEY_CHANNEL = "engine.dashboard";

/**
 * What crosses the navigation, on Screen 4's own key and Screen 4's own type.
 *
 * `adjustments` is the one addition, and it is additive on purpose:
 * `SignedScopeHandoff.scope` is a `JourneyScopeInput`, which has nowhere to put a
 * price line that is not a phase and not an optional service. Screen 4 ignores
 * unknown keys today; it should read this one, because the platform charges
 * `workstreams + adjustments` and a checkout that totals only the phases
 * under-states what the customer is about to pay.
 */
type ProposalHandoff = SignedScopeHandoff & {
  readonly adjustments?: readonly JourneyAdjustmentLine[];
};

/* ------------------------------------------------------------------ *
 * Copy helpers
 * ------------------------------------------------------------------ */

const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * Renders two counts in one sentence at a consistent register.
 *
 * The design's line is "Six findings, six phases" — words, because both of its
 * numbers are small. A real tenant's finding count is regularly not small, and
 * "15 findings, six phases" mixes a numeral and a word inside one clause, which
 * reads as a typo rather than a voice. So the pair moves together: words while
 * both fit the spelled range, numerals for both once either does not.
 */
function pairedCounts(a: number, b: number): { readonly a: string; readonly b: string } {
  const spellable = a < NUMBER_WORDS.length && b < NUMBER_WORDS.length;
  return spellable
    ? { a: numberWord(a), b: numberWord(b).toLowerCase() }
    : { a: String(a), b: String(b) };
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

type ScopeLoad =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly built: JourneySowScope }
  | { readonly status: "none"; readonly regenerating: boolean }
  | { readonly status: "error"; readonly message: string };

export default function CopilotReadinessProposalPage() {
  const search = useSearch();
  const isPreview = new URLSearchParams(search).get("preview") === "design";
  const [, navigate] = useLocation();
  const { fetchWithAuth, accessToken, logout } = useAuth();

  /* -------------------------------------------------- tenant identity */

  // `/api/portal/dashboard` is the cheapest existing source for the customer's
  // real company name — the same endpoint the War Room and customer-home already
  // call. Seats are deliberately left null: nothing on the wire here carries a
  // seat count, and `tenantStrip()` degrades to the name alone rather than
  // showing a number nobody measured.
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    fetchWithAuth(DASHBOARD_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        // Non-fatal — the header falls back to the generic label.
      });
    return () => {
      cancelled = true;
    };
  }, [isPreview, fetchWithAuth]);

  /* -------------------------------------------------- the scope */

  const [load, setLoad] = useState<ScopeLoad>({ status: "loading" });

  useEffect(() => {
    if (isPreview) return undefined;
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
        reportClientEvent(accessToken, "CopilotProposalScopeFetchFailed", message, JOURNEY_CHANNEL, {
          url: SOW_URL,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPreview, fetchWithAuth, accessToken]);

  /** The mapped live scope, or null in preview / before it lands. */
  const built: JourneySowScope | null =
    !isPreview && load.status === "ready" ? load.built : null;

  /** Real workstreams only — see `journeyScopeFromSow.ts` on why. */
  const scope: JourneyScopeInput | null = isPreview ? PREVIEW_SCOPE : built?.scope ?? null;

  /**
   * The platform's mandatory price lines. Not phases, not toggleable, and not
   * counted in "N of M phases" — but always part of what is owed, so their money
   * goes through `withAdjustments()` below and their titles are rendered in their
   * own block. The design fixture carries none.
   */
  const adjustments: readonly JourneyAdjustmentLine[] = built?.adjustments ?? [];
  const adjustmentsUsd = built?.adjustmentsUsd ?? 0;

  /* -------------------------------------------------- live journey data */

  // The projected per-pillar scores the scope quotes. Empty on a live render, so
  // `remediatedScore()` holds each pillar where it is rather than modelling an
  // improvement nobody has quoted.
  const projectedByPillar = useMemo(() => {
    const out: Partial<Record<PillarKey, number>> = {};
    (scope?.phases ?? []).forEach((p) => {
      if (p.scoreTo !== p.scoreFrom) out[p.pillar] = p.scoreTo;
    });
    return out;
  }, [scope]);

  const journeyOptions = useMemo(
    () => ({ tenantName: customerName, projectedByPillar }),
    [customerName, projectedByPillar],
  );
  const { view, pillarsLoaded } = useCopilotJourney(journeyOptions);

  const tenant = isPreview ? PREVIEW_TENANT : view.tenant;
  const currentScore = isPreview ? PREVIEW_READINESS_SCORE : view.readinessScore;

  /**
   * How many findings this tenant actually has.
   *
   * The real `msp_diagnostic_findings` rows, counted per pillar by
   * `GET /api/portal/assessment/war-room-pillars` and summed here. It bears NO
   * relationship to the number of SOW pricing lines, so the headline states the
   * two numbers and never asserts they are equal. `null` until the pillar
   * payload has landed, and `null` when it lands empty — "0 findings" over a
   * priced remediation scope would be a claim the scan does not support.
   */
  const findingsCount: number | null = useMemo(() => {
    const pillars = isPreview ? previewJourneyView().pillars : view.pillars;
    if (!isPreview && !pillarsLoaded) return null;
    const total = pillars.reduce((n, p) => n + p.criticalCount + p.warningCount, 0);
    return total > 0 ? total : null;
  }, [isPreview, pillarsLoaded, view.pillars]);

  /** How many reports this tenant's assessment actually produces. 0 = unknown. */
  const reportCount = isPreview ? previewJourneyView().generation.total : view.generation.total;

  /* -------------------------------------------------- selection */

  const [selection, setSelection] = useState<JourneySelection | null>(null);

  useEffect(() => {
    if (!scope) {
      setSelection(null);
      return;
    }
    const base = defaultSelection(scope);
    // A returning customer sees the selection the platform has stored for them,
    // not a fresh everything-on scope that quietly re-adds phases they removed.
    const saved = built?.serverSelectedTitles ?? null;
    if (!saved) {
      setSelection(base);
      return;
    }
    const phases: Record<string, boolean> = { ...base.phases };
    scope.phases.forEach((p) => {
      if (!p.locked) phases[p.id] = saved.includes(p.title);
    });
    setSelection({ ...base, phases });
  }, [scope, built]);

  const effectiveSelection = selection ?? (scope ? defaultSelection(scope) : null);

  /**
   * ONE arithmetic, derived once.
   *
   * `computeTotals()` sums the selected phases and any optional service;
   * `withAdjustments()` folds in the platform's mandatory price lines, exactly as
   * `effectiveSowTotals()` does server-side before it charges. Everything that
   * shows money on this screen — the sticky header's "Today X then Y" and the
   * summary rail — reads this same object, so the two cannot disagree.
   */
  const totals = useMemo(
    () =>
      scope && effectiveSelection
        ? withAdjustments(computeTotals(scope, effectiveSelection), adjustmentsUsd)
        : null,
    [scope, effectiveSelection, adjustmentsUsd],
  );

  /**
   * Weeks across the INCLUDED phases, or null when none of them quoted one.
   * `totals.weeks` is not used for display: it sums a field flattened from null
   * to 0, so it cannot tell an unquoted timeline from a zero-week one.
   */
  const weeksShown: number | null = useMemo(() => {
    if (!scope || !effectiveSelection) return null;
    // The fixture quotes weeks on every phase, so the preview reads the sum
    // directly; a live scope goes through the null-aware helper.
    if (isPreview) return computeTotals(scope, effectiveSelection).weeks;
    return built ? quotedWeeks(scope, built.phases, effectiveSelection) : null;
  }, [scope, effectiveSelection, isPreview, built]);

  // The headline gap is the FULL scope's gap — "what closing the 27-point gap
  // takes" is a statement about the whole proposal, so it must not tick down as
  // the customer removes phases. Only `projectedScore` is read off it, which no
  // adjustment moves.
  const fullScopeTotals = useMemo(
    () => (scope ? computeTotals(scope, defaultSelection(scope)) : null),
    [scope],
  );
  const projectionQuoted = (scope?.phases ?? []).some((p) => p.scoreTo !== p.scoreFrom);

  /**
   * The one phase the identity sentence is allowed to describe.
   *
   * It claims something specific — that this is "the identity work that lands
   * before Copilot is enabled for anyone" — so it is gated on a phase that is
   * both genuinely locked AND genuinely attributed to the identity/security
   * pillar, not merely on the scope containing some mandatory line.
   */
  const identityPhaseIndex = useMemo(() => {
    const phases = scope?.phases ?? [];
    const i = phases.findIndex((p) => {
      if (!p.locked) return false;
      const shown = (p as Partial<JourneySowPhase>).pillarShown;
      return (shown === undefined ? p.pillar : shown) === "security";
    });
    return i < 0 ? null : i + 1;
  }, [scope]);

  /* -------------------------------------------------- signing */

  const [signError, setSignError] = useState<string | null>(null);

  const handleSign = useCallback(
    (signature: JourneySignature) => {
      if (!effectiveSelection || !scope) return;
      // The scope travels with the signature. Screen 4 prefers it over a live
      // re-fetch for the reason its own comment gives: it is the snapshot of what
      // the customer was actually looking at while signing, and the endpoint may
      // have moved underneath them since.
      const payload: ProposalHandoff = {
        signerName: signature.signerName,
        role: signature.role,
        signatureData: signature.signatureData,
        selection: effectiveSelection,
        signedAt: new Date().toISOString(),
        scope,
        // The SOW's own 30-day expiry, when the payload carried one. Omitted
        // otherwise, and Screen 4 then renders no hold date at all rather than
        // computing one — the platform anchors `validUntil` to the earliest real
        // SOW row, not to the signature, so a signature-anchored fallback would
        // overstate the hold.
        ...(built?.quoteHoldIso ? { quoteHoldUntil: built.quoteHoldIso } : {}),
        ...(adjustments.length ? { adjustments } : {}),
      };
      try {
        sessionStorage.setItem(SIGNED_SCOPE_KEY, JSON.stringify(payload));
      } catch (e) {
        // Deliberately do NOT navigate on a failed write: the checkout would
        // open with no signature and no scope, and the customer would have no
        // way of knowing what they had just signed was lost.
        const message = e instanceof Error ? e.message : String(e);
        setSignError(
          "Your browser would not store the signed scope, so we have not moved you on. " +
            "Check that private browsing or site-data restrictions are not blocking storage, then sign again.",
        );
        reportClientEvent(
          accessToken,
          "CopilotProposalSignedScopePersistFailed",
          message,
          JOURNEY_CHANNEL,
        );
        return;
      }
      setSignError(null);
      navigate(`/copilot-readiness/checkout${search ? `?${search.replace(/^\?/, "")}` : ""}`);
    },
    [effectiveSelection, scope, built, adjustments, accessToken, navigate, search],
  );

  /* -------------------------------------------------- render */

  const documentsHref = `/copilot-readiness/documents${search ? `?${search.replace(/^\?/, "")}` : ""}`;

  return (
    <div className="cj-dark" style={{ minHeight: "100vh", background: "#020617", paddingBottom: 80 }}>
      {isPreview ? <PreviewBadge /> : null}

      {/* ------------------------------------------------ sticky header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(2,6,23,.94)",
          borderBottom: "1px solid rgba(30,41,59,.9)",
          padding: "13px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <BrandMark size={30} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: INK.micro,
              }}
            >
              Statement of work · draft
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: INK.headingDark,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tenantStrip(tenant)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flex: "none" }}>
          <Link href={documentsHref} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Back to findings
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: INK.micro,
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
          {totals ? (
            // Both halves, both labelled. `upfrontUsd` already includes any
            // optional service's one-off setup fee and any mandatory adjustment,
            // and `monthlyUsd` the recurring — straight off the one `totals`
            // object the rail also reads, never re-derived here, so the header
            // and the rail cannot disagree.
            <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: INK.micro,
                }}
              >
                Today
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: INK.headingDark, ...TABULAR }}>
                {money(totals.upfrontUsd)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: INK.deemphasised }}>then</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: INK.headingDark, ...TABULAR }}>
                {monthlyLabel(totals.monthlyUsd)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          maxWidth: 1260,
          margin: "0 auto",
          padding: "36px 24px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: "32px 36px",
          alignItems: "flex-start",
        }}
      >
        {scope && totals && effectiveSelection && fullScopeTotals ? (
          <>
            {/* -------------------------------------------- phases */}
            <div
              style={{
                flex: "1 1 540px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 30,
              }}
            >
              <ProposalIntro
                phaseCount={scope.phases.length}
                findingsCount={findingsCount}
                gap={
                  projectionQuoted && currentScore !== null && fullScopeTotals.projectedScore !== null
                    ? fullScopeTotals.projectedScore - currentScore
                    : null
                }
                scannedOn={tenant.scannedOn}
                identityPhaseIndex={identityPhaseIndex}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: ".22em",
                      textTransform: "uppercase",
                      color: INK.micro,
                    }}
                  >
                    Remediation phases
                  </span>
                  <span
                    style={{ fontSize: 11.5, fontWeight: 600, color: INK.micro, ...TABULAR }}
                  >
                    {phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)}
                  </span>
                </div>

                {scope.phases.map((phase, i) => {
                  // Fixture phases carry no `pillarShown` at all — their pillar
                  // is a real attribution from the assessment, so it is shown.
                  const shown = (phase as Partial<JourneySowPhase>).pillarShown;
                  return (
                    <ProposalPhaseCard
                      key={phase.id}
                      phase={phase}
                      index={i + 1}
                      included={isPhaseIncluded(scope, effectiveSelection, phase.id)}
                      pillar={shown === undefined ? phase.pillar : shown}
                      // No handler at all on a locked phase — the switch must be
                      // genuinely inert, not a working control wearing a badge.
                      onToggle={
                        phase.locked
                          ? undefined
                          : () => setSelection(togglePhase(scope, effectiveSelection, phase.id))
                      }
                    />
                  );
                })}
              </div>

              {adjustments.length > 0 ? <IncludedAdjustments lines={adjustments} /> : null}

              {scope.addons.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 24,
                    borderTop: "1px dashed rgba(30,41,59,.9)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: ".22em",
                        textTransform: "uppercase",
                        color: INK.micro,
                      }}
                    >
                      Optional · not remediation
                    </span>
                    <p
                      style={{
                        margin: 0,
                        maxWidth: "58ch",
                        fontSize: 13.5,
                        fontWeight: 500,
                        lineHeight: 1.6,
                        color: INK.bodyDark,
                      }}
                    >
                      Nothing here fixes a finding. These keep the score you are about to earn, or
                      hand back time you would otherwise spend.
                    </p>
                  </div>

                  {scope.addons.map((addon) => (
                    <ProposalAddonCard
                      key={addon.id}
                      addon={addon}
                      active={effectiveSelection.addons[addon.id] === true}
                      selectedTierId={effectiveSelection.tiers[addon.id] ?? ""}
                      onToggle={() => setSelection(toggleAddon(effectiveSelection, addon.id))}
                      onPickTier={(tierId) =>
                        setSelection(pickTier(effectiveSelection, addon.id, tierId))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {/* -------------------------------------------- summary rail */}
            <div
              style={{
                flex: "1 1 300px",
                minWidth: 0,
                position: "sticky",
                top: 88,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <ProposalSummaryRail
                totals={totals}
                weeks={weeksShown}
                adjustmentsUsd={adjustmentsUsd}
                currentScore={currentScore}
                projectionQuoted={projectionQuoted}
              />

              <JourneySignaturePanel tenantName={tenant.name} onSign={handleSign} />

              {signError ? (
                <p
                  style={{
                    margin: 0,
                    padding: "10px 12px",
                    borderRadius: RADIUS.card,
                    border: "1px solid rgba(248,113,113,.4)",
                    background: "rgba(248,113,113,.08)",
                    fontSize: 11.5,
                    fontWeight: 500,
                    lineHeight: 1.55,
                    color: "#f87171",
                  }}
                  role="alert"
                >
                  {signError}
                </p>
              ) : null}

              <p
                style={{
                  margin: 0,
                  padding: "0 4px",
                  fontSize: 11.5,
                  fontWeight: 500,
                  lineHeight: 1.6,
                  color: INK.micro,
                }}
              >
                {tenant.scannedOn
                  ? `Scope built from the ${tenant.scannedOn} assessment of ${tenant.name}.`
                  : `Scope built from the latest assessment of ${tenant.name}.`}{" "}
                {/* The tenant's OWN report count, from `documents.expected`.
                    Never the design's list of nine: a check of `document_types`
                    found no seeded type behind three of those titles, so
                    printing that number here would count deliverables this
                    platform cannot produce. Unknown → the clause drops the
                    number rather than guessing one. */}
                Line items trace directly to named findings in your{" "}
                {reportCount > 0 ? `${numberWord(reportCount).toLowerCase()} ` : ""}reports.
              </p>
            </div>
          </>
        ) : (
          <ScopeUnavailable load={load} isPreview={isPreview} documentsHref={documentsHref} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Intro block
 * ------------------------------------------------------------------ */

function ProposalIntro({
  phaseCount,
  findingsCount,
  gap,
  scannedOn,
  identityPhaseIndex,
}: {
  phaseCount: number;
  /**
   * The tenant's real finding count, or `null` when it is not measured yet.
   *
   * It is NOT derived from the phase count. The two are independent — a tenant's
   * `msp_diagnostic_findings` rows have no relationship to the number of SOW
   * pricing lines — and the design's fixture happening to have six of each is
   * exactly why the equality must not be baked into the copy.
   */
  findingsCount: number | null;
  /** Points between today's readiness and the full scope's projection, or null. */
  gap: number | null;
  scannedOn: string | null;
  /** 1-based index of the locked identity phase, or null when there is none. */
  identityPhaseIndex: number | null;
}) {
  const phases = numberWord(phaseCount);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: INK.link,
        }}
      >
        Remediation proposal{scannedOn ? ` · ${scannedOn}` : ""}
      </span>
      <h1
        style={{
          margin: 0,
          fontSize: "clamp(26px,3vw,36px)",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          color: INK.headingDark,
          textWrap: "pretty",
        }}
      >
        {/* Two independent counts, or just the one that is measured. Never one
            number stated twice. */}
        {findingsCount === null
          ? `${phases} ${phaseCount === 1 ? "phase" : "phases"}.`
          : (() => {
              const pair = pairedCounts(findingsCount, phaseCount);
              return `${pair.a} ${findingsCount === 1 ? "finding" : "findings"}, ${pair.b} ${
                phaseCount === 1 ? "phase" : "phases"
              }.`;
            })()}{" "}
        This is what closing {gap === null ? "the gap" : `the ${gap}-point gap`} takes.
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: "62ch",
          fontSize: 15.5,
          fontWeight: 500,
          lineHeight: 1.62,
          color: INK.bodyDark,
          textWrap: "pretty",
        }}
      >
        Every phase addresses a finding you have already read.{" "}
        {/* Claimed only where a phase is genuinely locked AND genuinely
            identity work. A mandatory PRICE line — "Tenant Size Adjustment
            Factor" — is neither, and describing one as the identity work that
            lands before Copilot is enabled would be a sentence about a
            workstream that does not exist. */}
        {identityPhaseIndex === null
          ? "What you keep is your call, and the total moves as you decide."
          : `Phase ${identityPhaseIndex} is required — it is the identity work that lands before Copilot is enabled for anyone. The rest is your call, and the total moves as you decide.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Included adjustments
 * ------------------------------------------------------------------ */

/**
 * The platform's mandatory price lines, shown as what they are.
 *
 * NOT phase cards: an adjustment is a price modifier, not a workstream. It has
 * no scope of work, no week estimate, no findings it closes and no toggle, and
 * the platform's own SOW selector renders exactly this — a dashed, locked
 * "Included adjustments" list under the toggleable phases. Their money is
 * already inside the headline total; this block is what makes that total add up
 * for a customer reading down the page.
 */
function IncludedAdjustments({ lines }: { readonly lines: readonly JourneyAdjustmentLine[] }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(51,65,85,.9)",
        borderRadius: RADIUS.cardLarge,
        background: "rgba(15,23,42,.3)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 11,
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
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: INK.bodyDarkStrong }}>
                {line.title}
              </span>
              {line.scope ? (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    lineHeight: 1.55,
                    color: INK.micro,
                    maxWidth: "56ch",
                  }}
                >
                  {line.scope}
                </span>
              ) : null}
            </span>
            <span
              style={{ fontSize: 13.5, fontWeight: 700, color: INK.headingDark, flex: "none", ...TABULAR }}
            >
              {money(line.priceUsd)}
            </span>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
        Set by the platform against your tenant, not a phase you can add or remove. Already counted
        in the totals beside this list.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unavailable states
 * ------------------------------------------------------------------ */

function ScopeUnavailable({
  load,
  isPreview,
  documentsHref,
}: {
  load: ScopeLoad;
  isPreview: boolean;
  documentsHref: string;
}) {
  if (isPreview) return null;

  const backLink = (
    <Link href={documentsHref} style={{ fontSize: 13.5, fontWeight: 600 }}>
      Back to your reports
    </Link>
  );

  if (load.status === "loading") {
    return (
      <span style={{ fontSize: 13, fontWeight: 500, color: INK.micro, padding: "26px 0" }}>
        Loading your scope…
      </span>
    );
  }

  if (load.status === "error") {
    return (
      <JourneyUnavailable
        title="We could not load your statement of work"
        detail={`The scope request failed (${load.message}). Nothing has been lost — reload the page, and if it keeps failing your assessment lead can pull the scope up directly.`}
        action={backLink}
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
          : "The scope is written from your assessment findings, and it has not been produced for this tenant yet. Your reports are already available — the priced phases follow from them."
      }
      action={backLink}
    />
  );
}
