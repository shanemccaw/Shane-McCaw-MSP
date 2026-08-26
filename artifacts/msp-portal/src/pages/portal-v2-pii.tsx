/**
 * portal-v2-pii.tsx — PII Governance, WIRED TO REAL DATA.
 *
 * The page previously rendered `piiData.ts` (PII_GOVERNANCE), the prototype's
 * fictional Halden Materials PII discovery scan: named SharePoint/OneDrive/Teams/
 * Exchange sources, matched patterns, per-document findings, an access matrix and
 * a drift feed. It now renders the calling customer's OWN real data from
 * `GET /api/portal/pii-governance` (`usePiiGovernance`), scoped by (msp_id,
 * tenants.tenantId) off the JWT.
 *
 * ── The gap between the fixture and reality, and how it is handled ───────────
 * There is no content-inspection PII discovery scan in the platform, so the
 * fixture's per-document sources, patterns, access matrix and drift feed have NO
 * collected backing and are NOT shown — reproducing them would be stating as fact
 * a scan that never ran. What IS real is four aggregate Purview compliance
 * signals (sensitivity-label and DLP posture) already scored by
 * copilot-readiness.ts. Those become the page's findings when they genuinely
 * fired; every backing check's real status (ok / scan error / licence gap / not
 * collected) is shown in the "Where this comes from" panel so the page can
 * explain WHY it is empty rather than fabricate a clean result. For the testbed
 * tenant today all four report a Security & Compliance session error — a true,
 * honest not-collected state.
 *
 * `piiData.ts` is kept for its two design cross-link fixtures (PII_OWNER, the
 * Compliance-pillar RACI owner, and PII_LINKS, the five module deep-links) — both
 * of which point at real portal-v2 routes — not for its fictional scan data.
 *
 * ── UI ROUTE SHAPE ──────────────────────────────────────────────────────────
 * App.tsx declares '/portal-v2/pii' BEFORE '/portal-v2/:pillar' so the param
 * route cannot swallow it; the real URL is /portal/{slug}/portal-v2/pii.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PII_LINKS, PII_OWNER } from "@/components/portal-v2/piiData";
import { NO_DATA_INK } from "@/components/portal-v2/NoScanDataState";
import { usePiiGovernance } from "@/components/portal-v2/piiGovernanceLive";
import {
  PII_COVERAGE_META,
  PII_SIGNAL_SEV_COLOR,
  piiSignalHeadSub,
  piiSignalHeadline,
  piiSignalStats,
  type PiiFindingView,
  type PiiGovernanceView,
} from "@/components/portal-v2/piiGovernanceWire";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The portal-v2 routes these controls may navigate to that exist today. */
const LIVE_ROUTES = new Set<string>([
  "/portal-v2/risk-register",
  "/portal-v2/change-control",
  "/portal-v2/policy-decisions",
  "/portal-v2/security-plan",
  "/portal-v2/sops",
]);

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "#475569",
};

/** The status pill's colour, by the register's own three states. */
const STATUS_TONE: Record<PiiGovernanceView["status"], string> = {
  "At risk": "#f87171",
  Monitored: "#34d399",
  "Not collected": "#94a3b8",
};

const EMPTY_VIEW: PiiGovernanceView = {
  status: "Not collected",
  scanned: null,
  cadence: "Daily",
  findings: [],
  coverage: [],
};

export default function PortalV2PiiPage() {
  const [, navigate] = useLocation();
  const { view, dataState, error } = usePiiGovernance();
  const [open, setOpen] = useState<string | null>(null);

  const v = view ?? EMPTY_VIEW;
  const stats = piiSignalStats(v);
  const tone = STATUS_TONE[v.status];

  const go = (to: string) => {
    if (LIVE_ROUTES.has(to)) navigate(to);
  };

  return (
    <PortalV2Shell eyebrow="Governance" title="PII Governance">
      <div
        data-testid="pv2-pii-page"
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "26px 28px 60px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxSizing: "border-box",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 800,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#a78bfa",
                }}
              >
                PII governance
              </span>
              <span
                data-testid="pv2-pii-status"
                style={{
                  padding: "3px 11px",
                  borderRadius: 6,
                  border: `1px solid ${tone}80`,
                  background: `${tone}24`,
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: tone,
                  whiteSpace: "nowrap",
                }}
              >
                {v.status}
              </span>
            </div>
            <span
              data-testid="pv2-pii-heading"
              style={{
                fontSize: "21px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-.02em",
                lineHeight: 1.3,
              }}
            >
              {piiSignalHeadline(v)}
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "#94a3b8",
                lineHeight: 1.6,
                maxWidth: "84ch",
                textWrap: "pretty",
              }}
            >
              {piiSignalHeadSub(v)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "flex-end",
              flex: "0 0 auto",
            }}
          >
            {/* Owner chip. There is no ownership/RACI table in the schema, so this
                page has no real owner to resolve — it renders an honest Unassigned
                state (muted, no fictional identity) rather than the prototype's
                fictional Halden employee (Git #1342). */}
            <div
              data-testid="pv2-pii-owner"
              data-state="empty"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                title={PII_OWNER.name}
                style={{
                  flex: "0 0 auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: ".02em",
                  color: NO_DATA_INK,
                  background: "transparent",
                  border: `1px dashed ${NO_DATA_INK}`,
                }}
              >
                {PII_OWNER.initials}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "right" }}>
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#94a3b8" }}>
                  {PII_OWNER.name}
                </span>
                <span style={{ fontSize: "9.5px", color: "#64748b" }}>No owner recorded</span>
              </div>
            </div>
            <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>
              {v.scanned ? `Scanned ${v.scanned}` : "Not yet collected"} · {v.cadence}
            </span>
          </div>
        </div>

        {/* ── Data status banner (loading / error) ───────────────────────── */}
        {(dataState === "loading" || dataState === "error") && (
          <div
            data-testid="pv2-pii-data-status"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: "12px",
              border: `1px solid ${dataState === "error" ? "rgba(248,113,113,.4)" : "rgba(148,163,184,.25)"}`,
              background: dataState === "error" ? "rgba(248,113,113,.08)" : "transparent",
              color: dataState === "error" ? "#f87171" : "#94a3b8",
            }}
          >
            {dataState === "error"
              ? "Your PII governance signals could not be loaded, so this page is not showing your current posture."
              : "Loading your PII governance signals…"}
            {dataState === "error" && error ? ` (${error})` : ""}
          </div>
        )}

        {/* ── Stat tiles ─────────────────────────────────────────────────── */}
        <div
          data-testid="pv2-pii-stats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 10,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.key}
              data-testid={`pv2-pii-stat-${s.key}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "13px 15px",
                borderRadius: 11,
                border: `1px solid ${s.color}2b`,
                background: `linear-gradient(160deg, ${s.color}0d, rgba(15,23,42,.45))`,
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 800,
                  letterSpacing: ".11em",
                  textTransform: "uppercase",
                  color: s.color,
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  color: "#f8fafc",
                  fontFamily: MONO,
                }}
              >
                {s.value}
              </span>
              <span style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.35 }}>{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Findings ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={SECTION_LABEL}>Findings</span>
          <div
            data-testid="pv2-pii-findings"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.85)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
          >
            {v.findings.length > 0 ? (
              v.findings.map((f) => (
                <FindingRow
                  key={f.id}
                  f={f}
                  open={open === f.id}
                  onToggle={() => setOpen((o) => (o === f.id ? null : f.id))}
                  onFix={() => go("/portal-v2/change-control")}
                  onAccept={() => go("/portal-v2/policy-decisions")}
                />
              ))
            ) : (
              <div
                style={{
                  padding: "18px 16px",
                  fontSize: "12.5px",
                  color: "#94a3b8",
                  lineHeight: 1.6,
                }}
              >
                {dataState === "loading"
                  ? "Loading…"
                  : "No personal-data governance signals are firing on this tenant. See “Where this comes from” below for each backing check's real status — a check that could not run or needs a licence is reported there rather than shown as a clean result."}
              </div>
            )}
          </div>
        </div>

        {/* ── Where this comes from — the real backing-check coverage ─────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={SECTION_LABEL}>Where this comes from</span>
          <div
            data-testid="pv2-pii-coverage"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.85)",
              borderRadius: 11,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
          >
            {v.coverage.map((c) => {
              const meta = PII_COVERAGE_META[c.status];
              return (
                <div
                  key={c.key}
                  data-testid={`pv2-pii-coverage-${c.key}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "11px 13px",
                    borderBottom: "1px solid rgba(30,41,59,.75)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35 }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>
                      {c.kind}
                      {c.status === "ok" && c.count != null ? ` · ${c.count} found` : ""}
                      {c.collected ? ` · ${c.collected}` : ""}
                    </span>
                    {c.reason && (
                      <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>
                        {c.reason}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      flex: "0 0 auto",
                      padding: "2px 8px",
                      borderRadius: 5,
                      border: `1px solid ${meta.tone}55`,
                      background: `${meta.tone}14`,
                      fontSize: "9px",
                      fontWeight: 800,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: meta.tone,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── What a finding is wired into ───────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={SECTION_LABEL}>What a finding is wired into</span>
          <div
            data-testid="pv2-pii-links"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
              gap: 9,
            }}
          >
            {PII_LINKS.map((l) => (
              <button
                key={l.label}
                className="pv2-area-card"
                onClick={() => go(l.to)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "12px 14px",
                  borderRadius: 11,
                  border: "1px solid rgba(148,163,184,.16)",
                  background: "rgba(15,23,42,.4)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                  ["--pv2-area-hover" as string]: "rgba(148,163,184,.36)",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#93c5fd" }}>{l.label} →</span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#94a3b8",
                    lineHeight: 1.55,
                    textWrap: "pretty",
                  }}
                >
                  {l.note}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}

function FindingRow({
  f,
  open,
  onToggle,
  onFix,
  onAccept,
}: {
  f: PiiFindingView;
  open: boolean;
  onToggle: () => void;
  onFix: () => void;
  onAccept: () => void;
}) {
  const sevC = PII_SIGNAL_SEV_COLOR[f.sev];

  return (
    <div
      data-testid={`pv2-pii-finding-${f.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderLeft: `2px solid ${sevC}`,
        borderTop: "1px solid rgba(30,41,59,.75)",
      }}
    >
      <button
        onClick={onToggle}
        data-testid={`pv2-pii-finding-toggle-${f.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "12px 15px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            flex: "0 0 auto",
            display: "flex",
            transform: `rotate(${open ? 180 : -90}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={12} color={sevC} />
        </span>
        <span
          style={{
            flex: "0 0 auto",
            padding: "2px 8px",
            borderRadius: 5,
            border: `1px solid ${sevC}55`,
            background: `${sevC}14`,
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: sevC,
            whiteSpace: "nowrap",
          }}
        >
          {f.sev}
        </span>
        <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}>
            {f.label}
          </span>
          <span style={{ fontSize: "10.5px", color: "#64748b" }}>
            {f.kind} · {f.count.toLocaleString("en-US")} {f.unit}
            {f.collected ? ` · ${f.collected}` : ""}
          </span>
        </div>
      </button>

      {open && (
        <div
          data-testid={`pv2-pii-finding-open-${f.id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 11,
            padding: "0 15px 15px 38px",
          }}
        >
          <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}>
            {f.detail}
          </span>
          {f.names.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {f.names.map((n) => (
                <span
                  key={n}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 5,
                    border: "1px solid rgba(148,163,184,.24)",
                    background: "rgba(148,163,184,.06)",
                    fontSize: "10px",
                    color: "#cbd5e1",
                    fontFamily: MONO,
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={onFix}
              style={{
                padding: "7px 13px",
                borderRadius: 7,
                border: "1px solid rgba(0,120,212,.5)",
                background: "rgba(0,120,212,.14)",
                color: "#93c5fd",
                fontSize: "11.5px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Raise the change to fix it
            </button>
            <button
              onClick={onAccept}
              style={{
                padding: "7px 13px",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,.24)",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Accept it as a decision
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
