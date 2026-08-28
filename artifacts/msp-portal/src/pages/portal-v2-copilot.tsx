/**
 * portal-v2-copilot.tsx — Copilot readiness (the standalone-offer verdict page).
 *
 * Built from `Customer Portal Shell.dc.html` — markup 6093-6199, logic class
 * CP_PILLARS 13081-13106 and the render map 20602-20631. A NEW page: Copilot
 * carried 10% of its design copy and had no route.
 *
 * ── LIVE DATA (Git #1213) ──────────────────────────────────────────────────
 * This page used to render `copilotData.ts`'s hardcoded fixture — six literal
 * before/after pillar scores, a "41 → 68" gate and the prototype's fictional
 * tenant name "Halden Materials", shown identically to every real paying
 * customer. It is now wired to the real Copilot assessment engine, through
 * `useCopilotJourney()` → `JourneyView` — the SAME source the four Copilot
 * Readiness screens render from. Every figure and the tenant name are real and
 * specific to the tenant that ran the scan:
 *   • the tenant NAME comes from `GET /api/portal/dashboard` (`customerName`);
 *   • the gate SCORE is the engine's Copilot pillar (`view.readinessScore`);
 *   • each pillar's SCORE and lead FINDING are the live per-pillar payload;
 *   • the verdict headline and summary are derived from the real score against
 *     `COPILOT_GATE_TARGET`.
 *
 * ── The gate number is the constant, not a literal ─────────────────────────
 * The "of 82" denominator is `COPILOT_GATE_TARGET` from journeyTokens, read via
 * `copilotModel`'s `gateDenominatorLabel()` — never hardcoded. It is mirrored
 * server-side in `copilot-gate.ts`; each side is asserted by its own test. See
 * `copilotModel.test.ts`.
 *
 * ── Honest states, never a fabricated number ───────────────────────────────
 * A pillar the scan could not evaluate shows an honest "not evaluated" line, not
 * a red zero. The platform quotes remediation PRICES, not projected pillar scores
 * (`journeyScopeFromSow.ts`), so a post-remediation projection is shown only when
 * one genuinely exists — normally the row shows today's score alone rather than a
 * fabricated target. The hidden `pv2-cp-source` marker states which it is.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  Layers,
  Lock,
  Scale,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  CP_COPY,
  CP_PILLAR_ADVICE,
  type CopilotPillarIcon,
} from "@/components/portal-v2/copilotData";
import {
  copilotAssessedLine,
  copilotHeading,
  copilotPillarRow,
  gateDenominatorLabel,
  gateSummary,
  gateVerdict,
  pillarDelta,
  pillarDisplayColor,
  pillarStateColors,
  type CopilotPillarRow,
} from "@/components/portal-v2/copilotModel";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney";
import { withLiveDocuments } from "@/components/copilot-journey/journeyModel";
import { generationView } from "@/components/copilot-journey/revealMath";
import type { PillarKey } from "@/components/copilot-journey/journeyTokens";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
const DASHBOARD_URL = "/api/portal/dashboard";
const SOW_URL = "/api/portal/assessment/sow";
const JOURNEY_CHANNEL = "engine.dashboard";

const PILLAR_ICONS: Record<CopilotPillarIcon, LucideIcon> = {
  "shield-check": ShieldCheck,
  lock: Lock,
  scale: Scale,
  layers: Layers,
  "trending-up": TrendingUp,
  activity: Activity,
};

/** The live SOW's phase shape, narrowed to the two fields a projection needs. */
interface WireSowProjectionPhase {
  readonly pillar?: string;
  readonly scoreFrom?: number;
  readonly scoreTo?: number;
}

function Eyebrow({ colour, children, spacing = ".18em" }: { colour: string; children: React.ReactNode; spacing?: string }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: spacing,
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/** One pillar row inside the pillars table. Every figure here is live. */
function PillarRow({ pillar }: { pillar: CopilotPillarRow }) {
  const colour = pillarDisplayColor(pillar);
  const state = pillar.state ? pillarStateColors(pillar.state) : null;
  const Icon = PILLAR_ICONS[pillar.icon];
  return (
    <div
      data-testid={`pv2-cp-pillar-${pillar.key}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "15px 18px",
        borderTop: "1px solid rgba(30,41,59,.8)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        <span
          style={{
            flex: "0 0 24px",
            width: 24,
            height: 24,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${colour}14`,
            border: `1px solid ${colour}33`,
          }}
        >
          <Icon size={13} color={colour} />
        </span>
        <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9", letterSpacing: ".02em" }}>{pillar.label}</span>
        {state && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${state.border}`,
              background: state.background,
              color: state.text,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".09em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {pillar.state}
          </span>
        )}
        <span style={{ flex: "1 1 40px" }} />
        <span style={{ display: "flex", alignItems: "baseline", gap: 7, flex: "0 0 auto" }}>
          {pillar.now === null ? (
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#64748b" }}>Not scored</span>
          ) : pillar.hasProjection && pillar.target !== null ? (
            <>
              <span style={{ fontSize: "19px", fontWeight: 800, color: "#94a3b8", fontFamily: MONO }}>{pillar.now}</span>
              <span style={{ fontSize: "11px", color: "#475569" }}>→</span>
              <span style={{ fontSize: "19px", fontWeight: 800, color: colour, fontFamily: MONO }}>{pillar.target}</span>
              <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#4ade80", whiteSpace: "nowrap" }}>
                {pillarDelta({ now: pillar.now, target: pillar.target })}
              </span>
            </>
          ) : (
            <span style={{ fontSize: "19px", fontWeight: 800, color: colour, fontFamily: MONO }}>{pillar.now}</span>
          )}
        </span>
      </div>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.5, textWrap: "pretty" }}>{pillar.finding}</span>
      <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.65, maxWidth: "88ch", textWrap: "pretty" }}>{pillar.why}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
        <span
          style={{
            flex: "1 1 260px",
            minWidth: 0,
            fontSize: "11.5px",
            color: "#94a3b8",
            lineHeight: 1.55,
            padding: "6px 10px",
            borderLeft: `2px solid ${colour}66`,
            background: `${colour}0a`,
            textWrap: "pretty",
          }}
        >
          {pillar.fix}
        </span>
        <Link
          href={`/portal-v2/${pillar.key}`}
          data-testid={`pv2-cp-open-${pillar.key}`}
          style={{
            flex: "0 0 auto",
            padding: "7px 12px",
            borderRadius: 7,
            border: `1px solid ${colour}45`,
            background: `${colour}12`,
            color: colour,
            fontSize: "11px",
            fontWeight: 700,
            fontFamily: "inherit",
            textDecoration: "none",
          }}
        >
          Open {pillar.label}
        </Link>
      </div>
    </div>
  );
}

export default function PortalV2CopilotPage() {
  const { fetchWithAuth, accessToken } = useAuth();

  /* ---------------------------------------------------------------- *
   * Tenant identity — same source the Reveal uses (#327 made
   * `customerName` reachable for the Assessment role on this route).
   * ---------------------------------------------------------------- */
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchWithAuth(DASHBOARD_URL, undefined, { silent: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        /* Heading degrades to "Your tenant" — useCopilotJourney reports the
           payload failures that actually matter. */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  /* ---------------------------------------------------------------- *
   * Post-remediation projection, from the SOW's own phase deltas when a scope
   * document quotes them. Live scopes quote prices, not projected pillar scores
   * (journeyScopeFromSow.ts), so this is normally empty — `remediatedScore()`
   * then holds each pillar where it is rather than modelling an improvement
   * nobody has quoted. Best-effort: a missing/failed SOW is not an error state
   * for this page, it just means no projection to show.
   * ---------------------------------------------------------------- */
  const [projectedByPillar, setProjectedByPillar] = useState<Partial<Record<PillarKey, number>>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SOW_URL, undefined, { silent: true });
        if (!res.ok) return;
        const body = (await res.json()) as { allWorkstreams?: readonly WireSowProjectionPhase[] };
        if (cancelled) return;
        const out: Partial<Record<PillarKey, number>> = {};
        for (const phase of body.allWorkstreams ?? []) {
          if (
            phase.pillar &&
            typeof phase.scoreTo === "number" &&
            typeof phase.scoreFrom === "number" &&
            phase.scoreTo !== phase.scoreFrom
          ) {
            out[phase.pillar as PillarKey] = phase.scoreTo;
          }
        }
        setProjectedByPillar(out);
      } catch (e) {
        reportClientEvent(
          accessToken,
          "CopilotVerdictScopeFetchFailed",
          e instanceof Error ? e.message : String(e),
          JOURNEY_CHANNEL,
          { url: SOW_URL },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, accessToken]);

  const live = useCopilotJourney({ tenantName: customerName, seatCount: null, projectedByPillar });
  const view = live.view;
  const score = view.readinessScore;

  const rows = useMemo(
    () =>
      CP_PILLAR_ADVICE.map((advice) =>
        copilotPillarRow(
          advice,
          view.pillars.find((p) => p.key === advice.key),
          projectedByPillar[advice.key as PillarKey],
        ),
      ),
    [view.pillars, projectedByPillar],
  );

  const anyProjection = rows.some((r) => r.hasProjection);
  const summary = gateSummary(view.tenant.name, score);
  const dataState = score !== null ? "live" : live.pillarsLoaded ? "unscored" : "loading";

  /* ---------------------------------------------------------------- *
   * "What the assessment produced" (Git #1443) — the tenant's REAL document
   * set, not the five-item `CP_DELIVERABLES` fixture this used to render
   * unconditionally as "Ready" under a fixed "Nine documents, all issued"
   * claim. `withLiveDocuments(view.generation)` and `generationView()` are the
   * exact same derivation `RevealFullPicture.tsx` (Scene 9) already renders
   * from — one source for "what documents exist and how many are ready",
   * never a second hardcoded list that can silently drift from it. Gated on
   * `live.statusLoaded` for the same reason Scene 9 gates on its own
   * `payloadState`: nothing here may assert a document count before the
   * platform has had a chance to say what this tenant's set is.
   * ---------------------------------------------------------------- */
  const documentsLoaded = live.statusLoaded;
  const generation = documentsLoaded ? withLiveDocuments(view.generation) : view.generation;
  const gen = generationView(generation.ready, generation.total);
  const documents = generation.documents;

  return (
    <PortalV2Shell eyebrow="Copilot readiness" title="Copilot readiness">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        {/* Which source is on screen, so a test can prove live vs unscored/loading.
            Visually clipped, present in the DOM. */}
        <span
          data-testid="pv2-cp-source"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
        >
          {dataState}
        </span>
        <div
          style={{
            position: "relative",
            maxWidth: 1180,
            margin: "0 auto",
            padding: "28px 28px 72px",
            display: "flex",
            flexDirection: "column",
            gap: 22,
            boxSizing: "border-box",
          }}
        >
          {/* Ambient glow — decorative, prototype 6095 */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "-6%",
              width: "min(1100px,150%)",
              height: "52%",
              transform: "translateX(-50%)",
              filter: "blur(80px)",
              opacity: 0.55,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse at top, rgba(139,92,246,.16), rgba(34,211,238,.10) 45%, rgba(2,6,23,0) 72%)",
            }}
          />

          {/* Header */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ height: 2, width: 44, borderRadius: 1, background: "linear-gradient(90deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6)" }} />
              <Eyebrow colour="#22d3ee" spacing=".2em">
                {CP_COPY.eyebrow}
              </Eyebrow>
            </div>
            <h1
              data-testid="pv2-page-title"
              style={{ margin: 0, fontSize: "27px", fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", lineHeight: 1.24, maxWidth: "34ch", textWrap: "pretty" }}
            >
              {copilotHeading(view.tenant.name, score)}
            </h1>
            <span style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>{CP_COPY.subhead}</span>
          </div>

          {/* Gate band */}
          <div
            data-testid="pv2-cp-gate"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "stretch",
              gap: 14,
              flexWrap: "wrap",
              padding: "20px 22px",
              border: "1px solid rgba(139,92,246,.28)",
              borderRadius: 16,
              background: "linear-gradient(135deg, rgba(139,92,246,.09), rgba(15,23,42,.5) 55%)",
            }}
          >
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Eyebrow colour="#64748b" spacing=".14em">
                  {CP_COPY.gateTodayLabel}
                </Eyebrow>
                <span style={{ fontSize: "44px", fontWeight: 800, color: score !== null && score >= 82 ? "#22d3ee" : "#f87171", lineHeight: 1, fontFamily: MONO }}>
                  {score === null ? "—" : score}
                </span>
                <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                  {gateDenominatorLabel()} · {score === null ? "not yet assessed" : gateVerdict(score)}
                </span>
              </div>
              <span style={{ display: "flex", flex: "0 0 auto" }} aria-hidden="true">
                <svg width={26} height={12} viewBox="0 0 26 12" fill="none" stroke="#475569" strokeWidth={1.6}>
                  <path d="M0 6h22M18 2l4 4-4 4" />
                </svg>
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Eyebrow colour="#64748b" spacing=".14em">
                  {CP_COPY.remediatedLabel}
                </Eyebrow>
                {/* The platform quotes remediation prices, not a projected gate
                    score, so there is no honest "remediated" number to print. The
                    slot points the customer at where the real remediation plan and
                    its pricing live. */}
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#94a3b8", lineHeight: 1.2 }}>See the plan</span>
                <span style={{ fontSize: "10.5px", color: "#64748b", maxWidth: "22ch" }}>
                  Projected clearance is scoped in your remediation plan
                </span>
              </div>
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9, justifyContent: "center" }}>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(148,163,184,.14)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${score === null ? 0 : Math.max(0, Math.min(100, (score / 82) * 100))}%`, background: score !== null && score >= 82 ? "#22d3ee" : "#f87171", opacity: 0.85 }} />
                <div style={{ position: "absolute", left: "100%", top: -3, bottom: -3, width: 2, background: "#f8fafc" }} />
              </div>
              {summary && (
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{summary}</span>
              )}
            </div>
          </div>

          {/* Pillars */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Eyebrow colour="#64748b">{anyProjection ? CP_COPY.pillarsHeading : CP_COPY.pillarsHeadingNoProjection}</Eyebrow>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{copilotAssessedLine(view.tenant.scannedOn)}</span>
            </div>
            <div
              data-testid="pv2-cp-pillars"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 13,
                background: "rgba(15,23,42,.4)",
                overflow: "hidden",
              }}
            >
              {rows.map((p) => (
                <PillarRow key={p.key} pillar={p} />
              ))}
            </div>
          </div>

          {/* Add-on + document pack */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, alignItems: "start" }}>
            {/* The add-on */}
            <div
              data-testid="pv2-cp-addon"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "18px 20px",
                border: "1px solid rgba(34,211,238,.3)",
                borderRadius: 14,
                background: "rgba(34,211,238,.05)",
              }}
            >
              <Eyebrow colour="#22d3ee">{CP_COPY.addonEyebrow}</Eyebrow>
              <span style={{ fontSize: "17px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}>{CP_COPY.addonTitle}</span>
              <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7, textWrap: "pretty" }}>{CP_COPY.addonBody}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
                <button
                  type="button"
                  style={{
                    padding: "8px 13px",
                    borderRadius: 8,
                    border: "1px solid rgba(34,211,238,.5)",
                    background: "rgba(34,211,238,.12)",
                    color: "#22d3ee",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {CP_COPY.addonAdd}
                </button>
                <button
                  type="button"
                  style={{
                    padding: "8px 13px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,.22)",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {CP_COPY.addonAsk}
                </button>
              </div>
            </div>

            {/* What the assessment produced */}
            <div
              data-testid="pv2-cp-produced"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 14,
                background: "rgba(15,23,42,.4)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "15px 18px 11px", display: "flex", flexDirection: "column", gap: 3, borderBottom: "1px solid rgba(30,41,59,.85)" }}>
                <Eyebrow colour="#64748b">{CP_COPY.producedLabel}</Eyebrow>
                <span style={{ fontSize: "11.5px", color: "#475569" }}>
                  {!documentsLoaded
                    ? "Loading your document set…"
                    : gen.known
                      ? gen.note
                      : "Your document set has not been scoped for this tenant yet."}
                </span>
              </div>
              {!documentsLoaded ? null : !gen.known ? null : (
                documents.map((d) => (
                  <Link
                    key={d.docType}
                    href="/portal-v2/documents"
                    data-testid={`pv2-cp-produced-doc-${d.docType}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "11px 18px",
                      borderTop: "1px solid rgba(30,41,59,.7)",
                      background: "transparent",
                      textDecoration: "none",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 600, color: "#cbd5e1", lineHeight: 1.45, textWrap: "pretty" }}>{d.title}</span>
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".09em",
                        textTransform: "uppercase",
                        color: d.status === "ready" ? "#4ade80" : "#64748b",
                        flex: "0 0 auto",
                      }}
                    >
                      {d.status === "ready" ? CP_COPY.ready : d.status}
                    </span>
                  </Link>
                ))
              )}
              <div style={{ padding: "12px 18px 15px" }}>
                <Link
                  href="/portal-v2/documents"
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "center",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(96,165,250,.4)",
                    background: "rgba(96,165,250,.1)",
                    color: "#bfdbfe",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    textDecoration: "none",
                  }}
                >
                  {CP_COPY.docPack}
                </Link>
              </div>
            </div>
          </div>

          {/* Discuss with Shane */}
          <div
            data-testid="pv2-cp-discuss"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "17px 20px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 14,
              background: "rgba(15,23,42,.45)",
            }}
          >
            <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>{CP_COPY.discussTitle}</span>
              <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{CP_COPY.discussBody}</span>
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{
                  padding: "9px 15px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,120,212,.5)",
                  background: "rgba(0,120,212,.16)",
                  color: "#bfdbfe",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {CP_COPY.discussBook}
              </button>
              <Link
                href="/portal-v2/documents"
                style={{
                  padding: "9px 15px",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "12px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  textDecoration: "none",
                }}
              >
                {CP_COPY.discussPlan}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
