/**
 * portal-v2-health.tsx — the Health pillar dashboard. Pillar 6 of 6.
 *
 * A direct port of the prototype's `isHealth` block
 * (`Customer Portal Shell.dc.html` lines 2909-3215) and its logic (12945-13285).
 *
 * ── This pillar solves a naming problem on the page itself ─────────────────
 * The prototype's source comment: "the overview is 'M365 Health' across all six
 * pillars. This page is the infrastructure and configuration layer underneath
 * it, so it is titled and located explicitly." Three elements exist only because
 * two different screens are called health:
 *
 *  • the back link reads "M365 Health overview", not "Overview" — the only
 *    pillar whose back link differs;
 *  • a disambiguation banner names both things, with "M365 Health" bolded
 *    mid-sentence;
 *  • a LOCATOR CHIP ROW of all six pillars, with "· you are here" appended to
 *    this one and every other chip navigable.
 *
 * ── The red dot on a green line was deliberate in the design ────────────────
 * The prototype's trend counted OPEN DEBT ITEMS, where lower is better, with its
 * end-point dot `#f87171` on a `#22C55E` line — red because the direction
 * changed, not because the number was high. Git #1442's strict pass found no
 * per-scan history of that count exists anywhere in the platform, so the graphic
 * (and its invented 128→71→78 series) is now an honest no-live-data state; see
 * the `NO-BACKEND-TO-WIRE:` tag above `HLT_DEBT_HISTORY` in hltDashboardData.ts.
 *
 * ── Severity vocabulary is the pillar's own ────────────────────────────────
 * Degrading / Accruing / Housekeeping, not Critical / High / Low, and it is the
 * only pillar with a third band. Debt accrues; it does not threaten. A live
 * finding (Git #1442) is always Degrading or Accruing — the real payload's
 * critical/warning scale has no third-band signal to promote a live row to
 * Housekeeping.
 *
 * ── Where its wrenches go ──────────────────────────────────────────────────
 * The stale-object inventory carries keys belonging to OTHER pillars — several
 * of those pillars are not built yet, so a few wrenches resolve to the generic
 * fallback for now. That is recorded rather than papered over with invented
 * Health copies. The config-drift table's own wrenches went with it: Git #1442
 * found the real drift engine has no shape matching this table's "N of 47
 * tracked settings" inventory, so the whole section renders an honest
 * no-live-data state instead — see the `NO-BACKEND-TO-WIRE:` tag above
 * `HLT_DRIFT` in hltDashboardData.ts for the full investigation.
 *
 * ── Git #1442 strict pass — every value now resolves to one of three states ─
 * Real live data (score, delta, debt items, 7 of 9 stale-object rows, Message
 * Center service rows), an honest "No scan data available" when a real backend
 * exists but this tenant hasn't been scanned (debt items, service rows), or an
 * honest "No live data available" plus a `NO-BACKEND-TO-WIRE:` tag at the exact
 * fixture source for a genuine backend gap (config drift, the debt trend
 * history, the directory-sync stat, the accepted-risk register, 2 of 9
 * stale-object rows). Nothing on this page silently falls back to fixture.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, Wrench } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { GOV_SRC_META } from "@/components/portal-v2/govPages";
import { useLivePillarHero, PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import {
  NoScanValue,
  NoScanDataState,
  hasScanValue,
  NO_DATA_DASH,
  NO_DATA_INK,
  NO_SCAN_DATA_LABEL,
} from "@/components/portal-v2/NoScanDataState";
import { useMessageCenter } from "@/components/portal-v2/useMessageCenter";
import { useHltObjectsLive } from "@/components/portal-v2/useHltObjectsLive";
import { PILLAR_ORDER } from "@/components/copilot-journey/journeyTokens";
import {
  HLT_DRIFT_KBI,
  HLT_FINDINGS,
  HLT_FINDING_COUNT,
  HLT_GREEN,
  HLT_GREEN_TEXT,
  HLT_HERO,
  HLT_HERO_STATS,
  HLT_OBJECTS,
  HLT_OBJECTS_NO_BACKEND,
  HLT_PROV,
  HLT_SERVICE_TONE,
  HLT_SEV_META,
  HLT_TONE,
  hltAcceptedStripSuffix,
  hltFindingRowsFromLive,
  hltHeroStatsHonest,
  hltHeroStatsWithObjectTotal,
  hltObjectTotalFor,
  hltObjectsWithLive,
  type HltFinding,
  type HltServiceTone,
} from "@/components/portal-v2/hltDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "10.5px", color: "#475569" };

const PANEL_HEAD_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#64748b",
};

/**
 * The knowledge-base info dot (`kbInfo`, proto 7776-7789). A small "i" that
 * shows a hover card of the article's title, summary and a "Click to read it"
 * cue. The full article lives in the knowledge-base overlay (a later part), so
 * the click is inert here — the hover card is the reproduced surface.
 */
function HltInfoDot({ title, summary }: { title: string; summary: string }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="pv2-hlt-drift-info"
      style={{
        position: "relative",
        flex: "0 0 15px",
        width: 15,
        height: 15,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1px solid ${hover ? "rgba(96,165,250,.8)" : "rgba(148,163,184,.35)"}`,
        background: hover ? "rgba(96,165,250,.18)" : "transparent",
        color: hover ? "#93c5fd" : "#64748b",
        fontSize: "9.5px",
        fontWeight: 800,
        fontStyle: "normal",
        textTransform: "none",
        letterSpacing: 0,
        cursor: "pointer",
        fontFamily: MONO,
      }}
    >
      i
      {hover && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 22,
            transform: "translateX(-50%)",
            zIndex: 140,
            width: 260,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid rgba(96,165,250,.35)",
            background: "#0b1524",
            boxShadow: "0 14px 34px rgba(2,6,23,.6)",
            textAlign: "left",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: "11.5px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.35 }}>
            {title}
          </span>
          <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>{summary}</span>
          <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#60a5fa" }}>Click to read it</span>
        </span>
      )}
    </span>
  );
}

export default function PortalV2HealthPage() {
  // Real pillar score/delta from the live health engine (the engine calls this
  // pillar "architecture"; the payload keys it "health"), fixture as the
  // honest-null fallback. The ring, the debt items and the stale-object
  // inventory are wired (see below); the drift table, the debt trend, the
  // directory-sync stat and the accepted-risk register are genuine backend
  // gaps, tagged `NO-BACKEND-TO-WIRE:` at their fixture source in
  // hltDashboardData.ts (Git #1442).
  const live = useLivePillarHero("health");
  // Honest-null contract (#1387): real score/delta when scored, muted "—"
  // otherwise — never the design fixture.
  const score = live.score;
  const hasScore = hasScanValue(score);
  const delta = live.delta?.text ?? NO_DATA_DASH;
  const deltaColor = live.delta?.color ?? NO_DATA_INK;

  // Debt items (Git #1442) — the SAME #1255 pattern `portal-v2-compliance-
  // gaps.tsx` already proved: once this tenant's Health pillar card is
  // `present`, its real findings render (including a real empty list), never
  // the fixture. `HLT_FINDINGS` is the loading/never-scanned placeholder only,
  // and a never-scanned tenant gets the honest "No scan data available" state
  // instead of that placeholder (a stricter contract than compliance-gaps'
  // own loading-only fallback — see Git #1442).
  const healthPillar = live.pillars.find((p) => p.key === "health");
  const healthPillarFindings = healthPillar?.findings ?? [];
  const liveDebtItems = healthPillar?.present ? hltFindingRowsFromLive(healthPillarFindings) : null;
  const debtItemsScanned = !!healthPillar?.present;
  const debtItems = liveDebtItems ?? HLT_FINDINGS;
  const debtItemCount = liveDebtItems ? liveDebtItems.length : HLT_FINDING_COUNT;

  // The accepted-risk strip's sentence (#1273): the worst real finding on this
  // tenant's own Health payload, off the SAME `pillars` array `live` already
  // carries from usePortalV2Pillars — no second fetch. `findings[0]` is the
  // server's own worst-first order (severity, then real signal weight); see
  // `hltAcceptedStripSuffix`'s header for why that stands in for "most recent".
  const acceptedStripSuffix = hltAcceptedStripSuffix(healthPillarFindings[0]?.title);

  // Stale object inventory summary card + itemized drill-down (Git #1340,
  // widened to 7 of 9 rows by #1442). See hltDashboardData.ts's
  // `hltObjectsWithLive` for the full per-row mapping and the 2 rows
  // (`HLT_OBJECTS_NO_BACKEND`) tagged `NO-BACKEND-TO-WIRE:` there. The hero's
  // "Stale objects" stat and this section's own total are computed from the
  // SAME liveObjects array, so they can never drift from each other.
  const objectsLive = useHltObjectsLive();
  const liveObjects = hltObjectsWithLive(HLT_OBJECTS, objectsLive.live);
  const objectTotal = hltObjectTotalFor(liveObjects);
  const objectsDataState: "live" | "fixture" = liveObjects === HLT_OBJECTS ? "fixture" : "live";
  const heroStats = hltHeroStatsHonest(hltHeroStatsWithObjectTotal(HLT_HERO_STATS, objectTotal), NO_DATA_DASH);

  // The "Service health & incoming changes" panel has a real per-item feed —
  // this tenant's own synced Message Center posts (portal-message-center.ts,
  // the same route the Microsoft Changes page reads). It replaces the design's
  // fictional incident/advisory rows with the tenant's own highest-scoring
  // real posts. There is no live equivalent for the incident/advisory ROWS
  // themselves (Message Center carries posts only, not incident status) — see
  // the `NO-BACKEND-TO-WIRE:` tag above `HLT_SERVICE` — so when there are no
  // real live posts this panel renders the honest empty state rather than
  // that invented 5-row mix.
  const messageCenter = useMessageCenter();
  const liveServiceRows = messageCenter.dataset.live
    ? messageCenter.dataset.posts
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((p) => ({
          title: p.title,
          kind: `Message Center · ${p.id}`,
          when: p.when,
          impact: p.impact,
          tone: (p.hard ? "amber" : "blue") as HltServiceTone,
        }))
    : null;
  const serviceRows = liveServiceRows && liveServiceRows.length > 0 ? liveServiceRows : null;
  const mcAllCount =
    messageCenter.dataset.live && messageCenter.dataset.itemCount > 0
      ? String(messageCenter.dataset.itemCount)
      : NO_DATA_DASH;

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = hasScore ? ringC - (score / 100) * ringC : ringC;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [provOpen, setProvOpen] = useState(false);
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [
        {
          id: "question",
          label: "Your question",
          kind: "textarea",
          wide: true,
          placeholder: "What would you like to know about this?",
        },
      ],
      doneTitle: "Sent",
      doneNote:
        "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({
    onConfirm: () => {},
    onAskShaneBot: askShaneBot,
  });

  /**
   * `f.acceptGo` (13139-13148). The fifth distinct contract on one drawer:
   * Governance accepts a risk, Compliance records a policy decision, Licensing
   * acknowledges intentional spend, Adoption parks a play — and Health accepts
   * an OPERATIONAL risk, interpolating the item's own debt state so the customer
   * signs against the specific thing being left in place.
   */
  const acceptDebt = (f: HltFinding) =>
    openAcceptRisk({
      title: f.title,
      description: f.why,
      details: `Leaving this in place is a legitimate operational decision if there is a reason for it — a dependency, a project sequence, a contract. Recorded here it becomes a documented choice with an owner and a review date, and it stays visible on this page as accepted rather than disappearing. Current state: ${f.debt}.`,
      kicker: "Accept this risk",
      descLabel: "What you are leaving in place",
      detailsLabel: "What accepting it means",
      confirmText:
        "I accept this operational risk on behalf of the organisation, with a named owner and a review date, and I understand it stays visible as an accepted item on every future scan.",
      btnLabel: "Accept risk",
    });

  return (
    <PortalV2Shell eyebrow="Pillar" title="Health">
      <div
        style={{
          position: "relative",
          maxWidth: 1320,
          margin: "0 auto",
          padding: "26px 26px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxSizing: "border-box",
        }}
      >
        {/* Page glow — proto 2911. Opacity .45, the softest of the six. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-6%",
            width: "min(1000px,150%)",
            height: "52%",
            transform: "translateX(-50%)",
            filter: "blur(80px)",
            opacity: 0.45,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at top, rgba(34,197,94,.16), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Back link + accepted strip — proto 2913-2923 ───────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/portal-v2"
            data-testid="pv2-hlt-back"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "11.5px",
              fontWeight: 600,
              color: "#64748b",
              fontFamily: "inherit",
            }}
          >
            ← {HLT_HERO.backLabel}
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 14px",
              border: "1px solid rgba(148,163,184,.22)",
              borderRadius: 9,
              background: "rgba(148,163,184,.05)",
            }}
          >
            {/* NO-BACKEND-TO-WIRE: see the tag above HLT_ACCEPTED in
                hltDashboardData.ts — there is no accepted-risk persistence to
                count, so this reads as an honest dash rather than the
                fixture's "1". */}
            <span style={{ fontSize: "15px", fontWeight: 800, color: NO_DATA_INK, fontFamily: MONO }}>
              {NO_DATA_DASH}
            </span>
            <span
              data-testid="pv2-hlt-accepted-strip-suffix"
              style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}
            >
              {acceptedStripSuffix}
            </span>
            {/* Prototype 2921 called this `goRiskSec`, filtering the register to
                SECURITY rather than Health — the same investigation that decided
                the sentence above (#1273) also settled this: it is the one-word
                fix to `pillar=Health` rather than a reproduction of the
                prototype's mismatch, since the register this strip should open
                to is this pillar's own. */}
            <Link
              href="/portal-v2/risk-register?pillar=Health"
              data-testid="pv2-hlt-risk-register-link"
              style={{
                padding: 0,
                border: "none",
                background: "none",
                fontFamily: "inherit",
                cursor: "pointer",
                fontSize: "11.5px",
                fontWeight: 600,
                color: "#cbd5e1",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Risk register →
            </Link>
          </div>
        </div>

        {/* ── Locator chip row — proto 2891-2897. All six pillars, this one
            marked "you are here". Together with the "M365 Health overview" back
            link above, this is the whole of the page's disambiguation; the
            current design carries no prose banner (there is no bannerTitle
            symbol anywhere in the shell). ── */}
        <div
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}
          data-testid="pv2-hlt-locator"
        >
          {PILLAR_ORDER.map((p) => {
            const isThis = p.key === "health";
            // Compliance's near-white identity is unreadable as a chip border,
            // so the prototype substitutes #cbd5e1 for it here specifically.
            const c = p.key === "compliance" ? "#cbd5e1" : p.primary;
            return (
              <Link
                key={p.key}
                href={`/portal-v2/${p.key}`}
                data-testid={`pv2-hlt-locator-${p.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: `1px solid ${isThis ? `${c}99` : "rgba(30,41,59,.9)"}`,
                  background: isThis ? `${c}1c` : "transparent",
                  fontSize: "10.5px",
                  fontWeight: isThis ? 700 : 600,
                  color: isThis ? "#f8fafc" : "#64748b",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: c,
                    flex: "0 0 5px",
                    opacity: isThis ? 1 : 0.5,
                  }}
                />
                {p.label}
                {isThis ? " · you are here" : ""}
              </Link>
            );
          })}
        </div>

        {/* ── Hero card — proto 2899-2963 ────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 24,
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 14,
            background: "linear-gradient(160deg, rgba(34,197,94,.08), rgba(15,23,42,.5))",
          }}
          data-testid="pv2-hlt-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -60,
              top: -90,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(34,197,94,.22), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -40,
              bottom: -100,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(34,197,94,.12), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minWidth: 250,
                maxWidth: 480,
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: HLT_GREEN_TEXT,
                }}
              >
                {HLT_HERO.eyebrow}
              </span>
              {/* 17px here, not the 19px every other pillar's headline uses. */}
              <span
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  letterSpacing: "-.015em",
                  color: "#f8fafc",
                  lineHeight: 1.35,
                }}
                data-testid="pv2-hlt-headline"
              >
                {HLT_HERO.headline}
              </span>
              <span
                style={{
                  fontSize: "12.5px",
                  color: "#cbd5e1",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                {HLT_HERO.standfirst}
              </span>
            </div>

            <div
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="pv2-hlt-trend"
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                {HLT_HERO.trendLabel}
              </span>
              {/* NO-BACKEND-TO-WIRE: no per-scan historical time series of
                  "open debt item count" exists (see the tag above
                  HLT_DEBT_HISTORY in hltDashboardData.ts) — the invented
                  128→71→78 series and its red-dot-on-green-line graphic are
                  replaced with the honest no-live-data state rather than
                  drawn from fixture numbers. */}
              <NoScanDataState
                testId="pv2-hlt-trend-empty"
                label="No live data available"
                detail="No historical series of open debt items exists yet."
                compact
                align="start"
              />
            </div>
          </div>

          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "auto repeat(3,minmax(140px,1fr))",
              alignItems: "stretch",
              gap: 0,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "2px 22px 2px 0" }}>
              <div style={{ position: "relative", flex: "0 0 auto", width: 88, height: 88 }}>
                <div
                  style={{
                    position: "absolute",
                    inset: -18,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(34,197,94,.26), rgba(2,6,23,0) 72%)",
                    pointerEvents: "none",
                  }}
                />
                <svg
                  width={88}
                  height={88}
                  viewBox="0 0 104 104"
                  style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}
                  aria-hidden="true"
                >
                  <circle cx={52} cy={52} r={ringR} fill="none" stroke="rgba(148,163,184,.14)" strokeWidth={9} />
                  <circle
                    cx={52}
                    cy={52}
                    r={ringR}
                    fill="none"
                    stroke={HLT_GREEN}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                  }}
                >
                  <NoScanValue
                    value={score}
                    color={HLT_GREEN_TEXT}
                    testId="pv2-hlt-score"
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      fontFamily: MONO,
                    }}
                  />
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: deltaColor, fontFamily: MONO }}
                  >
                    {delta}
                  </span>
                  <span data-testid="pv2-hlt-source" style={PV2_SOURCE_CLIP}>
                    {live.dataState}
                  </span>
                </div>
              </div>
            </div>

            {heroStats.map((s) => (
              <div
                key={s.label}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "2px 16px",
                  borderLeft: `2px solid ${HLT_GREEN}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-hlt-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(34,197,94,.18), rgba(2,6,23,0) 70%)",
                    pointerEvents: "none",
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    lineHeight: 1.25,
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    position: "relative",
                    fontSize: "22px",
                    fontWeight: 800,
                    color: s.value === NO_DATA_DASH ? NO_DATA_INK : "#f8fafc",
                    letterSpacing: "-.02em",
                    fontFamily: MONO,
                  }}
                >
                  {s.value}
                </span>
                <span style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}>
                  {s.sub}
                </span>
                {s.label === "Stale objects" && (
                  <span data-testid="pv2-hlt-objects-source" style={PV2_SOURCE_CLIP}>
                    {objectsDataState}
                  </span>
                )}
                {/* NO-BACKEND-TO-WIRE: "Directory sync" (HLT_SYNC) and "Config
                    drift" (HLT_DRIFT) have no wiring path — see the tags in
                    hltDashboardData.ts. Hidden marker so a test can prove the
                    honest state rendered, same PV2_SOURCE_CLIP convention the
                    live hero stats use. */}
                {(s.label === "Directory sync" || s.label === "Config drift") && (
                  <span data-testid={`pv2-hlt-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}-source`} style={PV2_SOURCE_CLIP}>
                    empty
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Stale object inventory — proto 3010-3053 ───── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={SECTION_LABEL}>Stale object inventory</span>
              <span style={SECTION_NOTE}>{objectTotal} objects · 9 classes</span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
                overflow: "hidden",
              }}
              data-testid="pv2-hlt-objects"
            >
              {liveObjects.map((o, i) => {
                const c = HLT_TONE[o.tone];
                // NO-BACKEND-TO-WIRE: see the tag above `hltObjectsWithLive`
                // in hltDashboardData.ts — these 2 of 9 rows have no check
                // anywhere in the catalog that can answer what they claim, so
                // they render an honest no-live-data count rather than this
                // fixture number.
                const noBackend = HLT_OBJECTS_NO_BACKEND.has(o.type);
                return (
                  <div
                    key={o.type}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) 44px 30px",
                      gap: 10,
                      padding: "10px 14px",
                      borderBottom: "1px solid rgba(30,41,59,.8)",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                    >
                      <span
                        style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35 }}
                      >
                        {o.type}
                      </span>
                      <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>
                        {noBackend ? "No live data available" : `${o.where} · ${o.oldest}`}
                      </span>
                      <span
                        style={{
                          fontSize: "10.5px",
                          color: "#94a3b8",
                          lineHeight: 1.45,
                          textWrap: "pretty",
                        }}
                      >
                        {o.note}
                      </span>
                    </div>
                    <span
                      data-testid={`pv2-hlt-object-count-${i}`}
                      style={{
                        fontSize: "15px",
                        fontWeight: 800,
                        color: noBackend ? NO_DATA_INK : c,
                        textAlign: "right",
                        fontFamily: MONO,
                      }}
                    >
                      {noBackend ? NO_DATA_DASH : o.count}
                    </span>
                    <button
                      onClick={() => openFixPanel(o.fixKey)}
                      title="Clean this up"
                      data-testid={`pv2-hlt-object-fix-${o.fixKey}`}
                      style={{
                        width: 28,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 7,
                        border: "1px solid rgba(34,197,94,.4)",
                        background: "rgba(34,197,94,.12)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <Wrench size={13} color={HLT_GREEN_TEXT} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Configuration drift — proto 3022-3090. Expandable and
            verdict-sorted: the unexplained changes float to the top, and each
            row opens to who changed it, when, who answers for it, the change
            record if there is one, and the fix or the change to raise. ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ ...SECTION_LABEL, display: "flex", alignItems: "center", gap: 8 }}>
              Configuration drift
              <HltInfoDot title={HLT_DRIFT_KBI.title} summary={HLT_DRIFT_KBI.summary} />
            </span>
          </div>
          {/* NO-BACKEND-TO-WIRE: see the tag above HLT_DRIFT in
              hltDashboardData.ts. A real drift-events engine exists
              (drift_events + dashboard-resolvers.ts's resolveDriftEvents,
              portal-reachable via POST /api/dashboard/resolve against the 17
              drift.*DriftCount metric keys already consumed elsewhere in this
              app, m365-health/useM365HealthLive.ts), but it has no shape that
              maps to this "N of 47 tracked settings, including clean/accepted
              rows" inventory — that needs a product decision on verdict-
              taxonomy mapping this pass does not make unilaterally. Renders
              the honest no-live-data state rather than this invented table. */}
          <div
            style={{
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
            data-testid="pv2-hlt-drift"
          >
            <NoScanDataState
              testId="pv2-hlt-drift-empty"
              label="No live data available"
              detail="No per-setting drift inventory is wired for this tenant yet."
            />
          </div>
        </div>

        {/* ── Debt items (left) + service/provenance (right) ─────────────── */}
        <div className="pv2-gov-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={SECTION_LABEL}>Debt items · {debtItemsScanned ? debtItemCount : NO_DATA_DASH}</span>
              <span style={SECTION_NOTE}>
                Ordered by how quickly leaving it alone gets worse.
              </span>
            </div>
            {!debtItemsScanned && (
              <NoScanDataState
                testId="pv2-hlt-debt-empty"
                label={NO_SCAN_DATA_LABEL}
                detail="This tenant has not been scanned for Health yet."
                compact
                align="start"
              />
            )}
            {debtItemsScanned && liveDebtItems && liveDebtItems.length === 0 && (
              <div
                data-testid="pv2-hlt-debt-clear"
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  fontSize: "12px",
                  lineHeight: 1.6,
                  border: "1px solid rgba(148,163,184,.18)",
                  background: "rgba(148,163,184,.05)",
                  color: "#94a3b8",
                }}
              >
                No open debt items from your last scan.
              </div>
            )}
            {debtItemsScanned && debtItems.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "rgba(15,23,42,.4)",
                  overflow: "hidden",
                }}
                data-testid="pv2-hlt-debt"
              >
              {debtItems.map((f, i) => {
                const sev = HLT_SEV_META[f.sev];
                const isExpanded = expanded === i;
                return (
                  <div
                    key={f.id}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: 0,
                      borderTop: "1px solid rgba(30,41,59,.85)",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: `${sev.c}77`,
                      }}
                    />
                    <button
                      onClick={() => setExpanded(isExpanded ? null : i)}
                      data-testid={`pv2-hlt-debt-${f.id}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "13px 16px",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 auto",
                          display: "flex",
                          marginTop: 3,
                          transform: `rotate(${isExpanded ? 180 : -90}deg)`,
                          transition: "transform 180ms",
                        }}
                      >
                        <ChevronDown size={14} color="#64748b" aria-hidden="true" />
                      </span>
                      <div
                        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                          <span
                            style={{
                              flex: "0 0 auto",
                              fontSize: "10.5px",
                              fontWeight: 700,
                              color: "#64748b",
                              letterSpacing: ".06em",
                              fontFamily: MONO,
                            }}
                          >
                            {f.id}
                          </span>
                          {/* Degrading / Accruing / Housekeeping — this pillar's
                              own vocabulary, and the only three-band scale. */}
                          <span
                            style={{
                              flex: "0 0 auto",
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: `1px solid ${sev.c}55`,
                              background: `${sev.c}14`,
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              color: sev.c,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sev.label}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 600,
                              color: "#64748b",
                              fontFamily: MONO,
                            }}
                          >
                            {f.debt}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#f1f5f9",
                            lineHeight: 1.45,
                            textWrap: "pretty",
                          }}
                        >
                          {f.title}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          padding: "0 16px 16px 40px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12.5px",
                            color: "#cbd5e1",
                            lineHeight: 1.65,
                            textWrap: "pretty",
                          }}
                        >
                          {f.why}
                        </span>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                            gap: "0 20px",
                          }}
                        >
                          {f.evidence.map((e) => (
                            <div
                              key={e.k}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                padding: "7px 0",
                                borderBottom: "1px solid rgba(30,41,59,.75)",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "9.5px",
                                  fontWeight: 700,
                                  letterSpacing: ".07em",
                                  textTransform: "uppercase",
                                  color: "#64748b",
                                }}
                              >
                                {e.k}
                              </span>
                              <span
                                style={{
                                  fontSize: "12px",
                                  color: "#e2e8f0",
                                  lineHeight: 1.5,
                                  textWrap: "pretty",
                                }}
                              >
                                {e.v}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                            gap: 8,
                            paddingTop: 6,
                          }}
                        >
                          <button
                            onClick={() => openFixPanel(f.fixKey)}
                            data-testid={`pv2-hlt-fix-${f.fixKey}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 11,
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: 9,
                              border: "1px solid rgba(34,197,94,.42)",
                              background:
                                "linear-gradient(160deg, rgba(34,197,94,.13), rgba(15,23,42,.3))",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span
                              style={{
                                flex: "0 0 28px",
                                width: 28,
                                height: 28,
                                borderRadius: 7,
                                border: "1px solid rgba(34,197,94,.45)",
                                background: "rgba(34,197,94,.16)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Wrench size={13} color={HLT_GREEN_TEXT} aria-hidden="true" />
                            </span>
                            <span
                              style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                            >
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  fontWeight: 700,
                                  color: HLT_GREEN_TEXT,
                                  lineHeight: 1.4,
                                }}
                              >
                                {f.action}
                              </span>
                              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                                {f.actionSub}
                              </span>
                            </span>
                          </button>
                          <button
                            onClick={() => acceptDebt(f)}
                            data-testid={`pv2-hlt-accept-${f.id}`}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 2,
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: 9,
                              border: "1px solid rgba(148,163,184,.25)",
                              background: "rgba(148,163,184,.05)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>
                              Accept this risk
                            </span>
                            <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>
                              Documented, owned, reviewed — stays visible as accepted
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            )}

            {/* Accepted risk cards — proto 3140-3166. NO-BACKEND-TO-WIRE: see
                the tag above HLT_ACCEPTED in hltDashboardData.ts — there is
                no accepted-risk persistence anywhere in the platform, so this
                section renders the honest no-live-data state rather than the
                fixture "AD FS retained" example. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                gap: 10,
                marginTop: 6,
              }}
              data-testid="pv2-hlt-accepted"
            >
              <NoScanDataState
                testId="pv2-hlt-accepted-empty"
                label="No live data available"
                detail="Accepting a risk records nothing yet — there is no accepted-risk storage to read back."
              />
            </div>
          </div>

          {/* ── Right column — proto 3168-3212 ───────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
                overflow: "hidden",
              }}
              data-testid="pv2-hlt-service"
            >
              <div
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid rgba(30,41,59,.9)",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={PANEL_HEAD_LABEL}>Service health &amp; incoming changes</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                    Straight from the Message Center, filtered to services you use.
                  </span>
                  <span data-testid="pv2-hlt-service-source" style={PV2_SOURCE_CLIP}>
                    {serviceRows ? "live" : "empty"}
                  </span>
                </div>
                {/* Design `hltMcGo` (3185) opens the Message Center drill-down,
                    a Health sub-page not built yet — inert for now. */}
                <button
                  type="button"
                  data-testid="pv2-hlt-mc-all"
                  style={{
                    flex: "0 0 auto",
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(96,165,250,.4)",
                    background: "rgba(96,165,250,.1)",
                    color: "#93c5fd",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  All {mcAllCount} notices →
                </button>
              </div>
              {!serviceRows && (
                <NoScanDataState
                  testId="pv2-hlt-service-empty"
                  label={NO_SCAN_DATA_LABEL}
                  detail="No Message Center posts scored for your services yet. Incident/advisory status has no data source in this platform yet."
                  compact
                  align="start"
                />
              )}
              {serviceRows && serviceRows.map((s) => {
                const c = HLT_SERVICE_TONE[s.tone];
                return (
                  <div
                    key={s.title}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "11px 14px",
                      borderBottom: "1px solid rgba(30,41,59,.8)",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 6px",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: c,
                        marginTop: 6,
                      }}
                    />
                    <div
                      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
                    >
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: 700,
                          color: "#e2e8f0",
                          lineHeight: 1.4,
                        }}
                      >
                        {s.title}
                      </span>
                      <span
                        style={{ fontSize: "10px", fontWeight: 600, color: c, fontFamily: MONO }}
                      >
                        {s.kind} · {s.when}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#94a3b8",
                          lineHeight: 1.5,
                          textWrap: "pretty",
                        }}
                      >
                        {s.impact}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
                overflow: "hidden",
              }}
              data-testid="pv2-hlt-provenance"
            >
              <button
                onClick={() => setProvOpen(!provOpen)}
                data-testid="pv2-hlt-provenance-toggle"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "11px 14px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    display: "flex",
                    transform: `rotate(${provOpen ? 180 : -90}deg)`,
                    transition: "transform 180ms",
                  }}
                >
                  <ChevronDown size={13} color="#64748b" aria-hidden="true" />
                </span>
                <span
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span style={PANEL_HEAD_LABEL}>How this is gathered</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                    Cloud reads from the container; sync and Exchange reads run on those servers.
                  </span>
                </span>
              </button>
              {provOpen && (
                <div
                  style={{
                    padding: "0 14px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {HLT_PROV.map((q) => {
                    const m = GOV_SRC_META[q.src];
                    return (
                      <div
                        key={q.call}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          padding: "9px 11px",
                          border: "1px solid rgba(30,41,59,.9)",
                          borderRadius: 8,
                          background: "#0b1524",
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}
                        >
                          <span
                            style={{
                              flex: "0 0 auto",
                              padding: "2px 7px",
                              borderRadius: 4,
                              border: `1px solid ${m.c}55`,
                              background: `${m.c}14`,
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              color: m.c,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.label}
                          </span>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 600,
                              color: m.c,
                              fontFamily: MONO,
                            }}
                          >
                            {q.scope}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            color: "#e2e8f0",
                            lineHeight: 1.5,
                            wordBreak: "break-word",
                            fontFamily: MONO,
                          }}
                        >
                          {q.call}
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            color: "#64748b",
                            lineHeight: 1.45,
                            textWrap: "pretty",
                          }}
                        >
                          {q.note}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) =>
            askShaneBot(`Explain this finding to me before I approve the change: ${playbook.title}`)
          }
          onAcceptRisk={(playbook) => {
            closeFixPanel();
            openAcceptRisk({
              title: playbook.title,
              description: playbook.description,
              details:
                "Accepting instead of fixing suppresses this finding’s points in the pillar score and mutes its alerts, and puts it on the risk register with your name, a rationale and a review date. It stays visible as an accepted risk. No change request is raised because nothing changes in the tenant.",
              kicker: "Accept instead of fixing",
            });
          }}
        />
      )}
      {acceptRiskElement}
      {formElement}
    </PortalV2Shell>
  );
}
