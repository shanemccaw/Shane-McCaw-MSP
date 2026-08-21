/**
 * portal-v2-copilot.tsx — Copilot readiness (the standalone-offer verdict page).
 *
 * Built from `Customer Portal Shell.dc.html` — markup 6093-6199, logic class
 * CP_PILLARS 13081-13106 and the render map 20602-20631. A NEW page: Copilot
 * carried 10% of its design copy and had no route.
 *
 * ── Why this page is the urgent one ────────────────────────────────────────
 * The Overview was rebuilt to the current design, whose Overview has no Copilot
 * gate band — so until this page shipped, the Copilot gate had NO surface
 * anywhere in the portal. The verdict ("41 of the gate, not safe to deploy")
 * lives here now.
 *
 * ── The gate number is the constant, not a literal ─────────────────────────
 * The "of 82" denominator is `COPILOT_GATE_TARGET` from journeyTokens, read via
 * `copilotModel`'s `gateDenominatorLabel()` — never hardcoded. It is mirrored
 * server-side in `copilot-gate.ts`; each side is asserted by its own test, so
 * changing one means changing and re-testing both. See `copilotModel.test.ts`.
 *
 * ── UI ONLY ────────────────────────────────────────────────────────────────
 * Every figure is the design's own fixture in `copilotData.ts`. The six "Open
 * <pillar>" buttons and the document links point at routes that genuinely
 * exist; the add-on / booking buttons open flows not built this pass and are
 * rendered as visual controls. Copy is FINAL and reproduced verbatim.
 */

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

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  CP_COPY,
  CP_DELIVERABLES,
  CP_GATE,
  CP_PILLARS,
  type CopilotPillar,
  type CopilotPillarIcon,
} from "@/components/portal-v2/copilotData";
import {
  gateDenominatorLabel,
  pillarDelta,
  pillarDisplayColor,
  pillarStateColors,
} from "@/components/portal-v2/copilotModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const PILLAR_ICONS: Record<CopilotPillarIcon, LucideIcon> = {
  "shield-check": ShieldCheck,
  lock: Lock,
  scale: Scale,
  layers: Layers,
  "trending-up": TrendingUp,
  activity: Activity,
};

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

/** One pillar row inside "What each pillar is worth once remediated". */
function PillarRow({ pillar }: { pillar: CopilotPillar }) {
  const colour = pillarDisplayColor(pillar);
  const state = pillarStateColors(pillar.state);
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
        <span style={{ flex: "1 1 40px" }} />
        <span style={{ display: "flex", alignItems: "baseline", gap: 7, flex: "0 0 auto" }}>
          <span style={{ fontSize: "19px", fontWeight: 800, color: "#94a3b8", fontFamily: MONO }}>{pillar.now}</span>
          <span style={{ fontSize: "11px", color: "#475569" }}>→</span>
          <span style={{ fontSize: "19px", fontWeight: 800, color: colour, fontFamily: MONO }}>{pillar.target}</span>
          <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#4ade80", whiteSpace: "nowrap" }}>{pillarDelta(pillar)}</span>
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
  return (
    <PortalV2Shell eyebrow="Copilot readiness" title="Copilot readiness">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
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
              {CP_COPY.heading}
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
                <span style={{ fontSize: "44px", fontWeight: 800, color: "#f87171", lineHeight: 1, fontFamily: MONO }}>{CP_GATE.now}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                  {gateDenominatorLabel()} · {CP_GATE.nowVerdict}
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
                <span style={{ fontSize: "44px", fontWeight: 800, color: "#22d3ee", lineHeight: 1, fontFamily: MONO }}>{CP_GATE.remediated}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b" }}>{CP_GATE.remediatedNote}</span>
              </div>
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9, justifyContent: "center" }}>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(148,163,184,.14)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", background: "#f87171", opacity: 0.85 }} />
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "33%", background: "linear-gradient(90deg,#3B82F6,#8B5CF6,#22D3EE)", opacity: 0.8 }} />
                <div style={{ position: "absolute", left: "83%", top: -3, bottom: -3, width: 2, background: "#f8fafc" }} />
              </div>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{CP_GATE.summary}</span>
            </div>
          </div>

          {/* Pillars — what each is worth once remediated */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Eyebrow colour="#64748b">{CP_COPY.pillarsHeading}</Eyebrow>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{CP_GATE.assessed}</span>
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
              {CP_PILLARS.map((p) => (
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
                <span style={{ fontSize: "11.5px", color: "#475569" }}>{CP_COPY.producedNote}</span>
              </div>
              {CP_DELIVERABLES.map((d) => (
                <Link
                  key={d.num}
                  href="/portal-v2/documents"
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
                  <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO, flex: "0 0 auto" }}>{d.num}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 600, color: "#cbd5e1", lineHeight: 1.45, textWrap: "pretty" }}>{d.title}</span>
                  <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#4ade80", flex: "0 0 auto" }}>{CP_COPY.ready}</span>
                </Link>
              ))}
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
