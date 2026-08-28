/**
 * portal-v2-licensing.tsx — the Licensing pillar dashboard.
 *
 * A direct port of the prototype's `isLicensing` block
 * (`Customer Portal Shell.dc.html` lines 3508-3806) and its logic (12275-12600).
 *
 * ── This pillar shares almost nothing with the other three ─────────────────
 * The prototype's own source comment says why: "This pillar is a money page, not
 * a risk page." Checked element by element rather than assumed:
 *
 *  • The CONTAINER is `max-width:1320px; padding:26px 26px 48px; gap:18` — the
 *    drill-down template's frame, not the `1180 / 28px 28px 56px / gap:22` the
 *    other three pillar heroes use. It needs the width for the ledger's per-SKU
 *    cards and their full-width segmented utilisation bars.
 *
 * ── Round Two consolidated the ledger and the recovery list ────────────────
 * The prototype's own comment: "The ledger and the recovery list were two views
 * of the same fact. One card per SKU." The flat SKU table and the separate
 * recovery-items list were merged into `licLedgerCards` — expandable per-SKU
 * cards whose expansion carries the recovery ACTION attached to that SKU's gap
 * (`LIC_SKU_ACTIONS`). So the left column of the lower grid is Acknowledged
 * spend only; there is no standalone recovery list.
 *  • There is NO scan strip, NO status pill and NO cluster area-card grid.
 *  • The hero's left column is an EYEBROW ("Money on the table"), a 38px mono
 *    figure and a sentence — not a title / subtitle / status triple. There is no
 *    "Licensing Health" heading anywhere on the page.
 *  • The ring delta is GREEN (#34d399) and positive. Every other pillar's is red
 *    or muted.
 *  • It is the only pillar HERO with a provenance block, which the README
 *    places on drill-downs only.
 *  • Its stat grid is `minmax(140px,1fr)` — Governance and Compliance are 130,
 *    Security 110 — and the third stat renders at 15px because it is a date.
 *
 * ── What it does share, and only after checking ────────────────────────────
 * The `.pv2-gov-grid` two-column split (1.7fr / 1fr) and the drill-down's
 * provenance-block markup. Both are the same values, so they are the same class
 * and the same shapes rather than near-copies.
 *
 * ── The one sanctioned deviation from the prototype's copy ─────────────────
 * The third recovery bucket reads "£1,470-worth" in the prototype (3611) — a
 * pound sign on a page denominated in dollars everywhere else, including that
 * same sentence's own "$1,470/mo" value. It was flagged rather than silently
 * corrected, and Shane confirmed on 2026-08-19 that it should be "$". The
 * "copy is final" rule was not bypassed here; it was overruled by the copy's
 * owner, which is the only way it should ever move. Now recorded only in
 * `LIC_BUCKETS` (licDashboardData.ts) — see the next section for why that
 * object, and the bucket copy generally, no longer renders.
 *
 * ── Git #1446 strict pass — every NO-BACKEND-TO-WIRE field now renders
 *    visibly, not just under a hidden test marker ───────────────────────────
 * Shane's live-testing report was blunt: "Licensing still fake data." #1230/
 * #1411 had already confirmed onTable, recoveredTotal, ackMonthly, the 3
 * recovery buckets, the acknowledged-spend cards, the savings ledger and the
 * "why the waste recurs" policy list have no real backend anywhere in this
 * platform's schema — but #1411's fix was a HIDDEN `PV2_SOURCE_CLIP` marker
 * layered UNDER the same fabricated dollar figures and specifics, provable
 * only by reading `el.innerText` in a test, not by looking at the page. This
 * pass replaces every one of those with a visible `NoScanDataState` ("No live
 * data available" + the specific reason) instead — the fixture data those
 * sections used to render (`LIC_BUCKETS`, `LIC_BUCKET_LINES`, `LIC_ACK`,
 * `LIC_LEDGER`, `LIC_POLICY`, the fixture half of `LIC_HERO`, `LIC_HERO_STATS`
 * pre-#1446) is retained in licDashboardData.ts as design-fixture reference
 * only, each marked `NO-BACKEND-TO-WIRE:` at its declaration. The per-SKU
 * licence LEDGER below is unaffected — Git #1230 already wired it to real
 * `/subscribedSkus` + `sku_price_reference` data, a separate matter from the
 * fields this issue named. (Git #1474: that ledger's own live/fixture gate
 * used to require `totalUnassigned > 0`, which silently fell back to fixture
 * for a real, fully-assigned/zero-waste tenant — fixed to `Boolean(liveLedger)`
 * alone, since a real zero-waste ledger is still real data.)
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
} from "@/components/portal-v2/NoScanDataState";
import { useLicenseSkuLedgerLive } from "@/components/portal-v2/usePortalV2Pillars";
import {
  LIC_BUCKET_GAPS,
  LIC_HERO,
  LIC_HERO_STATS,
  LIC_LEDGER_KBI,
  LIC_LEDGER_LEGEND,
  LIC_PROV,
  LIC_SKU_TOTALS,
  LIC_TEAL,
  LIC_TONE,
  licFmt,
  licLedgerCards,
  licLedgerCardsFromLive,
} from "@/components/portal-v2/licDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
/** The lighter teal used for figures and eyebrows. */
const TEAL_TEXT = "#2dd4bf";
const TEAL_EYEBROW = "#5eead4";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "10.5px", color: "#475569" };

/**
 * The knowledge-base info dot (`kbInfo`, proto 7776-7789). A small "i" that
 * shows a hover card of the article's title, summary and a "Click to read it"
 * cue. The full article lives in the knowledge-base overlay (a later part), so
 * the click is inert here — the hover card is the reproduced surface.
 */
function LicInfoDot({ title, summary }: { title: string; summary: string }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="pv2-lic-ledger-info"
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

export default function PortalV2LicensingPage() {
  // Real pillar score/delta from the live health engine, with the fixture as the
  // honest-null fallback. The ring is wired here; the per-SKU ledger below is
  // wired separately via useLicenseSkuLedgerLive (Git #1230). The 3 recovery
  // buckets and the provenance block stay design fixture — no billing-term or
  // usage-activity data exists to source them (see the ledger note below).
  const live = useLivePillarHero("licensing");
  // Honest-null contract (#1387): real score/delta when scored, muted "—"
  // otherwise — never the design fixture.
  const score = live.score;
  const hasScore = hasScanValue(score);
  const delta = live.delta?.text ?? NO_DATA_DASH;
  const deltaColor = live.delta?.color ?? NO_DATA_INK;

  // The per-SKU ledger (Git #1230): real purchased/assigned/unassigned + dollar
  // rows from the tenant's own /subscribedSkus + sku_price_reference data, when
  // sourceable. Falls back to the design fixture otherwise — never a half-real
  // table. The 3 recovery buckets below stay fixture regardless: no billing-term
  // (monthly vs. annual commitment) or usage-activity data exists anywhere in
  // this platform's schema to classify a seat as today/renewal/reassign — see
  // licDashboardData.ts's header on `licLedgerCardsFromLive`.
  // Overlays whenever real ledger data exists at all — including a tenant
  // whose seats are fully assigned. That's still real data (Git #1474): a
  // fully-assigned tenant's correctly boring, zero-waste ledger is the true
  // answer, and the fixture is never a substitute for a genuinely
  // uninteresting real value.
  const { ledger: liveLedger } = useLicenseSkuLedgerLive();
  const ledgerIsLive = Boolean(liveLedger);
  const ledgerCards = ledgerIsLive ? licLedgerCardsFromLive(liveLedger!.rows) : licLedgerCards();
  const ledgerTotals = ledgerIsLive
    ? {
        purchased: String(liveLedger!.totalPurchased),
        active: String(liveLedger!.totalAssigned),
        waste: `${licFmt(Math.round(liveLedger!.totalMonthlyWasteCents / 100))}/mo`,
      }
    : LIC_SKU_TOTALS;

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = hasScore ? ringC - (score / 100) * ringC : ringC;

  /** `licSku` (14071) — which ledger card is open, keyed by SKU part number. */
  const [openSku, setOpenSku] = useState<string | null>(null);
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

  return (
    <PortalV2Shell eyebrow="Pillar" title="Licensing">
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
        {/* Page glow — proto 3510. Teal, and 52% tall against Gov/Sec's 56%. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-6%",
            width: "min(1000px,150%)",
            height: "52%",
            transform: "translateX(-50%)",
            filter: "blur(80px)",
            opacity: 0.5,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at top, rgba(20,184,166,.18), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Back link + finance strip — proto 3512-3522 ────────────────── */}
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
            data-testid="pv2-lic-back"
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
            ← Overview
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 14px",
              border: "1px solid rgba(20,184,166,.3)",
              borderRadius: 9,
              background: "rgba(20,184,166,.06)",
            }}
          >
            {/* NO-BACKEND-TO-WIRE: (Git #1446) no acknowledged-spend/finance-
                decision table exists anywhere in this platform's schema
                (confirmed by search, and by the "finance register is a later
                phase" comment on the link below). #1411 closed the "zero
                gating" gap with a HIDDEN test-only "fixture" marker while the
                fabricated $900/mo and "2 decisions" kept rendering visibly —
                Shane's live-testing report ("Licensing still fake data")
                confirmed that is not honest. This renders a real dash and
                says so on screen instead. */}
            <span style={{ fontSize: "15px", fontWeight: 800, color: NO_DATA_INK, fontFamily: MONO }}>
              {NO_DATA_DASH}/mo
            </span>
            <span style={{ fontSize: "11.5px", color: NO_DATA_INK, whiteSpace: "nowrap" }}>
              No acknowledged-spend data available
            </span>
            <span data-testid="pv2-lic-finance-source" style={PV2_SOURCE_CLIP}>
              empty
            </span>
            {/* The prototype makes this an <a href="#">, not a button (3521) —
                every other pillar's equivalent is a button. Rendered as a real
                link with no destination yet, since the finance register is a
                later phase. */}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              data-testid="pv2-lic-finance-register-link"
              style={{
                fontSize: "11.5px",
                fontWeight: 600,
                color: TEAL_TEXT,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Finance register →
            </a>
          </div>
        </div>

        {/* ── Hero card — proto 3524-3591 ────────────────────────────────── */}
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
            background: "linear-gradient(160deg, rgba(20,184,166,.1), rgba(15,23,42,.5))",
          }}
          data-testid="pv2-lic-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -60,
              top: -90,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(20,184,166,.26), rgba(2,6,23,0) 70%)",
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
              background: "radial-gradient(circle, rgba(20,184,166,.14), rgba(2,6,23,0) 70%)",
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
            {/* No title, no subtitle, no status pill — an eyebrow and a figure. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: TEAL_EYEBROW,
                }}
              >
                {LIC_HERO.eyebrow}
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "38px",
                    fontWeight: 800,
                    letterSpacing: "-.03em",
                    color: NO_DATA_INK,
                    lineHeight: 1,
                    fontFamily: MONO,
                  }}
                  data-testid="pv2-lic-on-table"
                >
                  {NO_DATA_DASH}
                </span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#94a3b8" }}>/month</span>
              </div>
              {/* NO-BACKEND-TO-WIRE: (Git #1446) onTable/onTableSentence, the
                  trend label/caption below, and the 3 HERO_STATS values
                  (recovered this quarter, seat utilisation, next renewal) all
                  derive from the same recovery-bucket arithmetic #1230
                  confirmed cannot be sourced live: no billing-term (monthly
                  vs. annual commitment) or usage-activity data exists
                  anywhere in this platform's schema. #1411 closed the "zero
                  gating" gap with a HIDDEN test-only marker while the
                  fabricated $2,679/mo sentence kept rendering visibly —
                  Shane's live-testing report ("Licensing still fake data")
                  confirmed that is not honest. The score/delta above ARE
                  live (`pv2-lic-source`); this body is not. */}
              <span style={{ fontSize: "12.5px", color: NO_DATA_INK, lineHeight: 1.5 }}>
                No live data available — no billing-term or usage-activity data exists in this
                platform's schema to classify licence spend as removable today, recoverable at
                renewal, or reassignable.
              </span>
              <span data-testid="pv2-lic-hero-money-source" style={PV2_SOURCE_CLIP}>
                empty
              </span>
            </div>

            {/* Trend — proto's own geometry when live, honest empty otherwise.
                NO-BACKEND-TO-WIRE: (Git #1446) no backend records a
                recovered-spend history to plot — the cumulative-savings
                series (`LIC_SAVED_HISTORY`) is design fixture with nothing
                real behind it, same gap as the hero figure beside it. */}
            <div
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="pv2-lic-trend"
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
                Cumulative recovered
              </span>
              <NoScanDataState
                compact
                icon={false}
                align="start"
                label="No live data available"
                detail="No recovered-spend history exists to plot a trend."
                testId="pv2-lic-trend-empty"
                style={{ padding: "8px 0 0" }}
              />
            </div>
          </div>

          {/* Ring + three stats at minmax(140px,1fr) — proto 3557-3589. */}
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
                    background: "radial-gradient(circle, rgba(20,184,166,.3), rgba(2,6,23,0) 72%)",
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
                    stroke={LIC_TEAL}
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
                    color={TEAL_TEXT}
                    testId="pv2-lic-score"
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      fontFamily: MONO,
                    }}
                  />
                  {/* Real score movement; colour follows its sign (green up, red
                      down). Muted "—" when live data is absent (#1387). */}
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: deltaColor, fontFamily: MONO }}
                  >
                    {delta}
                  </span>
                  <span data-testid="pv2-lic-source" style={PV2_SOURCE_CLIP}>
                    {live.dataState}
                  </span>
                </div>
              </div>
            </div>

            {LIC_HERO_STATS.map((s) => (
              <div
                key={s.label}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "2px 16px",
                  borderLeft: `2px solid ${LIC_TEAL}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-lic-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(20,184,166,.2), rgba(2,6,23,0) 70%)",
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
                {/* NO-BACKEND-TO-WIRE: (Git #1446) see LIC_HERO_STATS's header
                    note in licDashboardData.ts — no backend sources any of
                    these three stats. */}
                <span
                  style={
                    s.small
                      ? {
                          // The renewal DATE renders at 15px with -.01em and no
                          // mono stack — it is prose, not a figure (proto 3587).
                          position: "relative",
                          fontSize: "15px",
                          fontWeight: 800,
                          color: NO_DATA_INK,
                          letterSpacing: "-.01em",
                          lineHeight: 1.3,
                        }
                      : {
                          position: "relative",
                          fontSize: "22px",
                          fontWeight: 800,
                          color: NO_DATA_INK,
                          letterSpacing: "-.02em",
                          fontFamily: MONO,
                        }
                  }
                >
                  {NO_DATA_DASH}
                </span>
                <span style={{ position: "relative", fontSize: "10.5px", color: NO_DATA_INK }}>
                  {s.reason}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── The three recovery buckets — proto 3593-3612 ───────────────── */}
        {/* NO-BACKEND-TO-WIRE: (Git #1446) see LIC_BUCKET_GAPS's header note
            in licDashboardData.ts — no billing-term (monthly vs. annual
            commitment) or usage-activity data exists anywhere in this
            platform's schema to classify a seat as today/renewal/reassign
            (#1230's investigation, reconfirmed here). These previously
            rendered real-looking dollar figures ($399/mo, $2,280/mo,
            $1,470/mo) with only a hidden test marker over the whole hero two
            sections up — Shane's live-testing report ("Licensing still fake
            data") confirmed that is not honest. There is nothing to disclose
            in a "how is this arrived at" breakdown either, so these cards are
            no longer clickable. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))",
            gap: 10,
          }}
          data-testid="pv2-lic-buckets"
        >
          {LIC_BUCKET_GAPS.map((b) => (
            <div
              key={b.key}
              data-testid={`pv2-lic-bucket-${b.key}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "14px 16px",
                border: "1px solid rgba(20,184,166,.24)",
                borderLeft: `2px solid ${LIC_TEAL}`,
                borderRadius: 10,
                background: "linear-gradient(160deg, rgba(20,184,166,.07), rgba(15,23,42,.45))",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: TEAL_EYEBROW,
                  }}
                >
                  {b.label}
                </span>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.when}
                </span>
              </div>
              <NoScanDataState
                compact
                icon={false}
                align="start"
                label="No live data available"
                detail={b.reason}
                testId={`pv2-lic-bucket-${b.key}-empty`}
                style={{ padding: 0 }}
              />
            </div>
          ))}
        </div>

        {/* ── The licence ledger — proto 3614-3650 ───────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              Licence ledger · what you buy against what runs{" "}
              <LicInfoDot title={LIC_LEDGER_KBI.title} summary={LIC_LEDGER_KBI.summary} />
            </span>
            <span style={SECTION_NOTE} data-testid="pv2-lic-ledger-totals">
              {ledgerTotals.purchased} seats bought · {ledgerTotals.active}{" "}
              {ledgerIsLive ? "assigned" : "in use"} · {ledgerTotals.waste} wasted
            </span>
            <span data-testid="pv2-lic-ledger-source" style={PV2_SOURCE_CLIP}>
              {ledgerIsLive ? "live" : "fixture"}
            </span>
          </div>
          {/* The utilisation-bar legend — proto 3690-3697. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 16,
              padding: "0 2px 2px",
            }}
            data-testid="pv2-lic-ledger-legend"
          >
            {LIC_LEDGER_LEGEND.map((lg) => (
              <div key={lg.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{ width: 9, height: 9, borderRadius: 2, background: lg.dot, flex: "0 0 9px" }}
                />
                <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
                  {lg.label}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="pv2-lic-ledger">
            {ledgerCards.map((k) => {
              const c = LIC_TONE[k.tone];
              const isOpen = openSku === k.part;
              return (
                <div key={k.part} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <button
                    type="button"
                    onClick={k.hasActions ? () => setOpenSku(isOpen ? null : k.part) : undefined}
                    data-testid={`pv2-lic-sku-${k.part}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: "14px 16px",
                      borderRadius: 12,
                      width: "100%",
                      textAlign: "left",
                      fontFamily: "inherit",
                      cursor: k.hasActions ? "pointer" : "default",
                      border: `1px solid ${isOpen ? `${c}80` : "rgba(30,41,59,.9)"}`,
                      background: isOpen ? "rgba(2,6,23,.6)" : "rgba(15,23,42,.4)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 14,
                        flexWrap: "wrap",
                        width: "100%",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                        <span
                          style={{
                            fontSize: "13.5px",
                            fontWeight: 700,
                            color: "#f1f5f9",
                            letterSpacing: "-.01em",
                          }}
                        >
                          {k.sku}
                        </span>
                        <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>
                          {k.part}
                        </span>
                        <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>
                          {k.unit}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto" }}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: "14px",
                              fontWeight: 800,
                              fontFamily: MONO,
                              color: k.clean ? "#34d399" : c,
                            }}
                          >
                            {k.waste}
                          </span>
                          <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>
                            {k.annual}
                          </span>
                        </div>
                        {k.hasActions && (
                          <span
                            style={{
                              display: "flex",
                              transform: `rotate(${isOpen ? 180 : 0}deg)`,
                              transition: "transform 180ms",
                            }}
                          >
                            <ChevronDown size={12} color={c} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* The 3-segment utilisation bar — active / assigned-idle /
                        unassigned, all against purchased. Labels appear only when
                        a segment clears 12% of the bar. */}
                    <div
                      style={{
                        display: "flex",
                        width: "100%",
                        height: 22,
                        borderRadius: 6,
                        overflow: "hidden",
                        background: "rgba(148,163,184,.08)",
                      }}
                    >
                      <span
                        style={{
                          width: `${k.seg.active.pct}%`,
                          background: "rgba(45,212,191,.55)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{ fontSize: "10px", fontWeight: 800, color: "#062c2a", fontFamily: MONO }}
                        >
                          {k.seg.active.label}
                        </span>
                      </span>
                      {k.seg.idle.show && (
                        <span
                          style={{
                            width: `${k.seg.idle.pct}%`,
                            background: `${c}55`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{ fontSize: "10px", fontWeight: 800, color: "#0b1524", fontFamily: MONO }}
                          >
                            {k.seg.idle.label}
                          </span>
                        </span>
                      )}
                      {k.seg.free.show && (
                        <span
                          style={{
                            width: `${k.seg.free.pct}%`,
                            background: "rgba(148,163,184,.22)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 0,
                            borderLeft: "1px dashed rgba(148,163,184,.35)",
                          }}
                        >
                          <span
                            style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8", fontFamily: MONO }}
                          >
                            {k.seg.free.label}
                          </span>
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        width: "100%",
                      }}
                    >
                      <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: MONO }}>
                        {k.counts}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#64748b",
                          lineHeight: 1.5,
                          textWrap: "pretty",
                          flex: 1,
                          minWidth: 180,
                          textAlign: "right",
                        }}
                      >
                        {k.note}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 9,
                        margin: "8px 0 2px 16px",
                        paddingLeft: 14,
                        borderLeft: "2px solid rgba(20,184,166,.35)",
                      }}
                    >
                      {k.actions.map((ac) => (
                        <div
                          key={ac.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
                            padding: "12px 14px",
                            border: "1px solid rgba(20,184,166,.24)",
                            borderRadius: 10,
                            background: "rgba(20,184,166,.05)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 9,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", fontFamily: MONO }}
                            >
                              {ac.id}
                            </span>
                            <span
                              style={{
                                flex: "0 0 auto",
                                padding: "2px 8px",
                                borderRadius: 4,
                                border: `1px solid ${c}55`,
                                background: `${c}14`,
                                fontSize: "9px",
                                fontWeight: 700,
                                letterSpacing: ".06em",
                                textTransform: "uppercase",
                                color: c,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {ac.timing}
                            </span>
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: "12.5px",
                                fontWeight: 800,
                                color: TEAL_TEXT,
                                fontFamily: MONO,
                              }}
                            >
                              {ac.money}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#cbd5e1",
                              lineHeight: 1.6,
                              textWrap: "pretty",
                            }}
                          >
                            {ac.text}
                          </span>
                          <button
                            type="button"
                            onClick={() => openFixPanel(ac.fixKey)}
                            data-testid={`pv2-lic-fix-${ac.fixKey}`}
                            style={{
                              alignSelf: "flex-start",
                              display: "flex",
                              alignItems: "center",
                              gap: 9,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid rgba(20,184,166,.45)",
                              background: "rgba(20,184,166,.12)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <Wrench size={13} color={TEAL_TEXT} aria-hidden="true" />
                            <span
                              style={{ fontSize: "11.5px", fontWeight: 700, color: TEAL_TEXT }}
                            >
                              {ac.action}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Acknowledged spend (left) + savings/policy/provenance (right).
            Round Two consolidated the recovery list into the ledger cards above,
            so the left column is Acknowledged spend only — proto 3755-3794. ── */}
        <div className="pv2-gov-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {/* Acknowledged spend — proto 3757-3760, then its cards 3762-3792. */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={SECTION_LABEL}>Acknowledged spend</span>
              <span style={SECTION_NOTE}>
                Money you have decided to keep spending, with the reason recorded.
              </span>
            </div>
            {/* NO-BACKEND-TO-WIRE: (Git #1446) see LIC_ACK's header note in
                licDashboardData.ts — no acknowledged-spend/finance-decision
                table exists anywhere in this platform's schema. */}
            <NoScanDataState
              label="No live data available"
              detail="No acknowledged-spend/finance-decision table exists in this platform's schema."
              testId="pv2-lic-ack-cards"
              style={{
                marginTop: 6,
                border: "1px solid rgba(20,184,166,.22)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
              }}
            />
          </div>

          {/* ── Right column — proto 3743-3804 ───────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {/* Savings ledger */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(20,184,166,.25)",
                borderRadius: 12,
                background: "rgba(20,184,166,.04)",
                overflow: "hidden",
              }}
              data-testid="pv2-lic-savings"
            >
              <div
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid rgba(20,184,166,.16)",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: TEAL_EYEBROW,
                  }}
                >
                  Savings ledger
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: NO_DATA_INK, fontFamily: MONO }}>
                  {NO_DATA_DASH}/mo
                </span>
              </div>
              {/* NO-BACKEND-TO-WIRE: (Git #1446) see LIC_LEDGER's header note
                  in licDashboardData.ts — no table anywhere in this schema
                  records "an action was taken and it saved $X/mo", which is
                  also what the header figure above was summed from. #1411
                  closed the "zero gating" gap with a HIDDEN test-only marker
                  while the fabricated recovery rows kept rendering visibly —
                  Shane's live-testing report ("Licensing still fake data")
                  confirmed that is not honest. */}
              <NoScanDataState
                compact
                label="No live data available"
                detail="No table records a licence-recovery action or its dollar amount."
                testId="pv2-lic-savings-source"
                style={{ padding: "16px 14px" }}
              />
            </div>

            {/* Why the waste recurs */}
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
              data-testid="pv2-lic-policy"
            >
              <div
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid rgba(30,41,59,.9)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  Why the waste recurs
                </span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                  Settings and process gaps that refill this page every quarter.
                </span>
              </div>
              {/* NO-BACKEND-TO-WIRE: (Git #1446) see LIC_POLICY's header note
                  in licDashboardData.ts — none of these seven rows (self-
                  service purchase, offboarding licence removal, group-based
                  licensing coverage, idle-seat reclamation, licence
                  assignment errors, renewal calendar, cost-centre
                  attribution) has a live source anywhere in this platform's
                  schema. Since none is known to be true for any given
                  tenant, the "Fix this" wrenches are gone too — offering a
                  fix for a policy gap that was never verified for this
                  tenant would be as dishonest as the fixture status text it
                  used to sit next to. */}
              <NoScanDataState
                label="No live data available"
                detail="No self-service-purchase, offboarding, group-licensing, idle-seat-rule, assignment-error, renewal-calendar, or cost-centre data exists in this schema."
                testId="pv2-lic-policy-empty"
                style={{ padding: "18px 14px" }}
              />
            </div>

            {/* How the figures are derived — the only provenance block on a hero. */}
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
              data-testid="pv2-lic-provenance"
            >
              <button
                onClick={() => setProvOpen(!provOpen)}
                data-testid="pv2-lic-provenance-toggle"
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
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    How the figures are derived
                  </span>
                  {/* Reworded (Git #1446): every dollar figure above this
                      block now renders an honest "No live data available"
                      state, so this can no longer claim present tense that
                      the page's figures trace to these calls — see LIC_PROV's
                      header note in licDashboardData.ts. The calls and scopes
                      listed below are real; only what they currently power on
                      this page changed. */}
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                    None of the figures above are sourced from these calls today — this is what a
                    future wiring pass would use.
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
                  {LIC_PROV.map((q) => {
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
