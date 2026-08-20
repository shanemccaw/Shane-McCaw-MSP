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
 * ── The red dot on a green line is deliberate ──────────────────────────────
 * The trend counts OPEN DEBT ITEMS, where lower is better, and its end-point dot
 * is `#f87171` on a `#22C55E` line. The caption says why: "The last point is red
 * because the direction changed, not because the number is high." Colouring it
 * green — the obvious choice from the other five pillars — would state the
 * opposite of what the page says in words.
 *
 * ── Severity vocabulary is the pillar's own ────────────────────────────────
 * Degrading / Accruing / Housekeeping, not Critical / High / Low, and it is the
 * only pillar with a third band. Debt accrues; it does not threaten.
 *
 * ── Where its wrenches go ──────────────────────────────────────────────────
 * The drift table and the stale-object inventory carry keys belonging to OTHER
 * pillars — drift is detected here and remediated where the setting lives. Those
 * route to the owning pillar's playbook; several of those pillars are not built
 * yet, so a few wrenches resolve to the generic fallback for now. That is
 * recorded rather than papered over with invented Health copies.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, Wrench } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { GOV_SRC_META } from "@/components/portal-v2/govPages";
import { PILLAR_ORDER } from "@/components/copilot-journey/journeyTokens";
import {
  HLT_ACCEPTED,
  HLT_BANNER_BODY,
  HLT_DRIFT,
  HLT_DRIFT_COUNT,
  HLT_FINDINGS,
  HLT_FINDING_COUNT,
  HLT_GREEN,
  HLT_GREEN_TEXT,
  HLT_HERO,
  HLT_HERO_STATS,
  HLT_OBJECTS,
  HLT_OBJECT_TOTAL,
  HLT_PROV,
  HLT_SERVICE,
  HLT_SERVICE_TONE,
  HLT_SEV_META,
  HLT_SYNC,
  HLT_TONE,
  hltAcceptedMeta,
  hltTrendGeometry,
  type HltFinding,
} from "@/components/portal-v2/hltDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The drift table's column template. Header and every row share it. */
const DRIFT_GRID =
  "minmax(190px,1.6fr) minmax(110px,.9fr) minmax(130px,1.1fr) minmax(120px,1fr) minmax(96px,.7fr) 30px";

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

const MICRO_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "#64748b",
};

const DRIFT_HEAD: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2HealthPage() {
  const trend = hltTrendGeometry();
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (HLT_HERO.score / 100) * ringC;

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
            <span style={{ fontSize: "15px", fontWeight: 800, color: "#cbd5e1", fontFamily: MONO }}>
              {HLT_ACCEPTED.length}
            </span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              {HLT_HERO.acceptedStripSuffix}
            </span>
            {/* Prototype 2921. NOTE THE PILLAR: this button calls `goRiskSec`,
                not a Health equivalent — there is no `goRiskHealth` anywhere in
                the prototype — so it opens the register filtered to SECURITY.
                The visible consequence is that RSK-006, 'AD FS retained
                alongside cloud authentication', which is a Health risk and is
                what the copy beside this button is about, is filtered OUT by
                the link meant to show it.

                Reproduced as written, because the prototype is the
                specification and a fourth handler would be an invention. It is
                a one-word change to `pillar=Health` if Shane wants it, and it
                is flagged in the build log rather than silently corrected. */}
            <Link
              href="/portal-v2/risk-register?pillar=Security"
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

        {/* ── The disambiguation banner + locator — proto 2925-2939 ──────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px 18px",
            border: "1px solid rgba(34,197,94,.24)",
            borderLeft: `2px solid ${HLT_GREEN}`,
            borderRadius: 12,
            background: "linear-gradient(160deg, rgba(34,197,94,.07), rgba(15,23,42,.45))",
          }}
          data-testid="pv2-hlt-banner"
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: HLT_GREEN_TEXT,
                }}
              >
                {HLT_HERO.bannerEyebrow}
              </span>
              <span
                style={{
                  fontSize: "19px",
                  fontWeight: 800,
                  color: "#f8fafc",
                  lineHeight: 1.28,
                  letterSpacing: "-.02em",
                }}
                data-testid="pv2-hlt-banner-title"
              >
                {HLT_HERO.bannerTitle}
              </span>
            </div>
            <span style={{ fontSize: "10.5px", color: "#64748b", whiteSpace: "nowrap" }}>
              {HLT_HERO.bannerScoreNote}
            </span>
          </div>
          <span
            style={{
              fontSize: "12.5px",
              color: "#cbd5e1",
              lineHeight: 1.6,
              maxWidth: "92ch",
              textWrap: "pretty",
            }}
          >
            {HLT_BANNER_BODY.before}
            <span style={{ fontWeight: 700, color: "#f8fafc" }}>{HLT_BANNER_BODY.boldA}</span>
            {HLT_BANNER_BODY.middle}
          </span>
          {/* The locator: all six pillars, this one marked "you are here". */}
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 2 }}
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
        </div>

        {/* ── Hero card — proto 2941-3008 ────────────────────────────────── */}
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
              <div style={{ position: "relative" }}>
                <svg
                  width="100%"
                  height={trend.h}
                  viewBox={`0 0 ${trend.w} ${trend.h}`}
                  preserveAspectRatio="none"
                  style={{ overflow: "visible", display: "block" }}
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="hltTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={HLT_GREEN} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={HLT_GREEN} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={trend.area} fill="url(#hltTrendFill)" />
                  <polyline
                    points={trend.line}
                    fill="none"
                    stroke={HLT_GREEN}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <svg
                  width="100%"
                  height={trend.h}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    overflow: "visible",
                    display: "block",
                    pointerEvents: "none",
                  }}
                  aria-hidden="true"
                >
                  {/* RED on a green line, and the caption below says why. */}
                  <circle
                    cx={`${(trend.lastX / trend.w) * 100}%`}
                    cy={trend.lastY}
                    r={3.5}
                    fill="#f87171"
                  />
                </svg>
                <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
                <span
                  style={{ display: "block", paddingTop: 5, fontSize: "10.5px", color: "#64748b" }}
                >
                  {HLT_HERO.trendCaption}
                </span>
              </div>
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
                  <span
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      color: HLT_GREEN_TEXT,
                      fontFamily: MONO,
                    }}
                    data-testid="pv2-hlt-score"
                  >
                    {HLT_HERO.score}
                  </span>
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: "#f87171", fontFamily: MONO }}
                  >
                    {HLT_HERO.delta}
                  </span>
                </div>
              </div>
            </div>

            {HLT_HERO_STATS.map((s) => (
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
                    color: "#f8fafc",
                    letterSpacing: "-.02em",
                    fontFamily: MONO,
                  }}
                >
                  {s.value}
                </span>
                <span style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}>
                  {s.sub}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sync & hybrid + stale object inventory — proto 3010-3053 ───── */}
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
              <span style={SECTION_LABEL}>Directory sync &amp; hybrid</span>
              <span style={SECTION_NOTE}>Read on the sync server, not from the cloud</span>
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
              data-testid="pv2-hlt-sync"
            >
              {HLT_SYNC.map((s) => {
                const c = HLT_TONE[s.tone];
                return (
                  <div
                    key={s.stage}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 14px",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>
                          {s.stage}
                        </span>
                        <span
                          style={{
                            flex: "0 0 auto",
                            padding: "3px 8px",
                            borderRadius: 4,
                            border: `1px solid ${c}55`,
                            background: `${c}14`,
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: ".04em",
                            color: c,
                            whiteSpace: "nowrap",
                            fontFamily: MONO,
                          }}
                        >
                          {s.state}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#94a3b8",
                          lineHeight: 1.5,
                          textWrap: "pretty",
                        }}
                      >
                        {s.detail}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

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
              <span style={SECTION_NOTE}>{HLT_OBJECT_TOTAL} objects · 9 classes</span>
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
              {HLT_OBJECTS.map((o) => {
                const c = HLT_TONE[o.tone];
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
                        {o.where} · {o.oldest}
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
                      style={{
                        fontSize: "15px",
                        fontWeight: 800,
                        color: c,
                        textAlign: "right",
                        fontFamily: MONO,
                      }}
                    >
                      {o.count}
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

        {/* ── Configuration drift — proto 3055-3087 ──────────────────────── */}
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
            <span style={SECTION_LABEL}>
              Configuration drift · {HLT_DRIFT_COUNT} of 47 tracked settings
            </span>
            <span style={SECTION_NOTE}>
              Baseline signed at scan 1. Actor and date from the audit log where it exists.
            </span>
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
            data-testid="pv2-hlt-drift"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: DRIFT_GRID,
                gap: 12,
                padding: "9px 16px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                background: "rgba(34,197,94,.05)",
              }}
            >
              <span style={DRIFT_HEAD}>Setting</span>
              <span style={DRIFT_HEAD}>Baseline</span>
              <span style={DRIFT_HEAD}>Current</span>
              <span style={DRIFT_HEAD}>Changed by</span>
              <span style={DRIFT_HEAD}>When</span>
              <span />
            </div>
            {HLT_DRIFT.map((d) => {
              const c = HLT_TONE[d.tone];
              return (
                <div
                  key={d.setting}
                  style={{
                    display: "grid",
                    gridTemplateColumns: DRIFT_GRID,
                    gap: 12,
                    padding: "9px 16px",
                    borderBottom: "1px solid rgba(30,41,59,.8)",
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "#e2e8f0",
                        lineHeight: 1.4,
                        overflowWrap: "break-word",
                        fontFamily: MONO,
                      }}
                    >
                      {d.setting}
                    </span>
                    <span
                      style={{
                        flex: "0 0 auto",
                        alignSelf: "flex-start",
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: "1px solid rgba(148,163,184,.22)",
                        background: "rgba(148,163,184,.06)",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "#94a3b8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.scope}
                    </span>
                  </div>
                  <span
                    style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.4, fontFamily: MONO }}
                  >
                    {d.baseline}
                  </span>
                  <span
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 700,
                      color: c,
                      lineHeight: 1.4,
                      fontFamily: MONO,
                    }}
                  >
                    {d.current}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#94a3b8",
                      lineHeight: 1.4,
                      overflowWrap: "break-word",
                    }}
                  >
                    {d.who}
                  </span>
                  <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.4 }}>
                    {d.when}
                  </span>
                  {d.fixKey ? (
                    <button
                      onClick={() => openFixPanel(d.fixKey!)}
                      title="Reconcile this setting"
                      data-testid={`pv2-hlt-drift-fix-${d.fixKey}`}
                      style={{
                        width: 26,
                        height: 26,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 6,
                        border: "1px solid rgba(34,197,94,.4)",
                        background: "rgba(34,197,94,.12)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <Wrench size={12} color={HLT_GREEN_TEXT} aria-hidden="true" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
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
              <span style={SECTION_LABEL}>Debt items · {HLT_FINDING_COUNT}</span>
              <span style={SECTION_NOTE}>
                Ordered by how quickly leaving it alone gets worse.
              </span>
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
              data-testid="pv2-hlt-debt"
            >
              {HLT_FINDINGS.map((f, i) => {
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

            {/* Accepted risk cards — proto 3140-3166. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                gap: 10,
                marginTop: 6,
              }}
              data-testid="pv2-hlt-accepted"
            >
              {HLT_ACCEPTED.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 9,
                    padding: "15px 16px",
                    border: "1px solid rgba(148,163,184,.2)",
                    borderRadius: 12,
                    background: "linear-gradient(160deg, rgba(148,163,184,.05), rgba(15,23,42,.5))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: ".06em",
                        fontFamily: MONO,
                      }}
                    >
                      {a.id}
                    </span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid rgba(148,163,184,.35)",
                        background: "rgba(148,163,184,.08)",
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "#cbd5e1",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Accepted risk
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#f1f5f9",
                      lineHeight: 1.45,
                    }}
                  >
                    {a.title}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>Operational reason</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {a.rationale}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>Compensating controls</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {a.compensating}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      paddingTop: 9,
                      borderTop: "1px solid rgba(148,163,184,.14)",
                    }}
                  >
                    {hltAcceptedMeta(a).map((m) => (
                      <div key={m.k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".07em",
                            textTransform: "uppercase",
                            color: "#64748b",
                          }}
                        >
                          {m.k}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#e2e8f0",
                            fontFamily: MONO,
                          }}
                        >
                          {m.v}
                        </span>
                      </div>
                    ))}
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      lineHeight: 1.5,
                      textWrap: "pretty",
                    }}
                  >
                    {a.note}
                  </span>
                </div>
              ))}
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
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={PANEL_HEAD_LABEL}>Service health &amp; incoming changes</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                  Filtered to services you use and changes that touch your configuration.
                </span>
              </div>
              {HLT_SERVICE.map((s) => {
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
