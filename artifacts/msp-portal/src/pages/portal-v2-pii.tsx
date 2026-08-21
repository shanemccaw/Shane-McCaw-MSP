/**
 * portal-v2-pii.tsx — PII Governance.
 *
 * A direct port of the prototype's `isPii` block ('Customer Portal Shell.dc.html'
 * 4106-4256) and its render derivation (20095-20196), transcribed into
 * `piiData.ts` (the fixture) and `piiModel.ts` (the computed values).
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * The prototype's own comment above the fixture (7870-7871): personal data
 * across the tenant — where it is, who can reach it, what moved, and what is
 * required of each finding. "Findings become risks and changes, never tickets."
 * So every finding row offers exactly the three moves the design gives it: raise
 * a change to fix it, open the risk it already spawned, or accept it as a
 * recorded decision.
 *
 * ── UI ONLY ─────────────────────────────────────────────────────────────────
 * There is no PII discovery endpoint yet; every number is the design's own,
 * kept in `piiData.ts` for the later wiring pass. The interactivity that IS the
 * page — the stat-card filter and the expand-in-place findings — is real and
 * driven by `piiModel.ts`.
 *
 * ── Cross-links to pages that do not exist yet ─────────────────────────────
 * The design's finding actions and the "wired into" cards deep-link into five
 * other modules. Three of those routes exist today (Risk Register, Change
 * Control, and this Security Plan sibling) and are wired; two do not yet
 * (Policy Decisions is Part 5, SOPs & Runbooks is Part 6), so their controls
 * render identically but stay inert rather than navigating to a 404 — the same
 * "designed, not yet wired" treatment the Risk Register page uses for its own
 * inert buttons. When those pages land, the routes drop into LIVE_ROUTES below.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { PII_GOVERNANCE, PII_LINKS, PII_OWNER, type PiiFinding } from "@/components/portal-v2/piiData";
import {
  PII_EXP_COLOR,
  PII_SEV_COLOR,
  piiDriftVerdict,
  piiFilesText,
  piiFilterFindings,
  piiHeadSub,
  piiHeadline,
  piiHitsText,
  piiLabelText,
  piiSourceBarPct,
  piiStats,
  type PiiFilterKey,
} from "@/components/portal-v2/piiModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * The portal-v2 routes these controls may navigate to that exist today. A target
 * not in this set renders as an inert control (see the header note).
 */
const LIVE_ROUTES = new Set<string>([
  "/portal-v2/risk-register",
  "/portal-v2/change-control",
  "/portal-v2/security-plan",
]);

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "#475569",
};

export default function PortalV2PiiPage() {
  const [, navigate] = useLocation();
  const { openForm, formElement } = useFormDrawer();

  const [filter, setFilter] = useState<PiiFilterKey>(null);
  const [open, setOpen] = useState<string | null>(null);

  const pii = PII_GOVERNANCE;
  const stats = piiStats(pii);
  const findings = piiFilterFindings(pii, filter);

  const toggleFilter = (key: Exclude<PiiFilterKey, null>) =>
    setFilter((f) => (f === key ? null : key));

  const go = (to: string) => {
    if (LIVE_ROUTES.has(to)) navigate(to);
  };

  /** "Add a pattern" — prototype `piiAddPatternGo` (shell 20139-20148). */
  const addPattern = () =>
    openForm({
      kicker: "PII discovery",
      title: "Add a pattern",
      intro:
        "A custom pattern is matched on every scan alongside the built-in ones. Give it a shape we can recognise rather than a description.",
      submitLabel: "Add it",
      fields: [
        { id: "name", label: "What it is", value: "" },
        {
          id: "kind",
          label: "Type",
          kind: "select",
          value: "Personal",
          options: ["Personal", "Financial", "Medical", "Legal"].map((o) => ({
            value: o,
            label: o,
          })),
        },
        { id: "shape", label: "The shape it takes", kind: "textarea", wide: true, value: "" },
      ],
      doneNote: "The pattern will be matched from the next scan.",
    });

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
        {/* ── Header — proto 4109-4128 ──────────────────────────────────── */}
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
                  border: "1px solid rgba(248,113,113,.5)",
                  background: "rgba(248,113,113,.14)",
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "#fca5a5",
                  whiteSpace: "nowrap",
                }}
              >
                {pii.status}
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
              {piiHeadline(pii)}
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
              {piiHeadSub(pii)}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                  fontSize: "9.5px",
                  fontWeight: 800,
                  letterSpacing: ".02em",
                  color: "#0b1524",
                  background: PII_OWNER.tone,
                  border: "1px solid transparent",
                }}
              >
                {PII_OWNER.initials}
              </span>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "right" }}
              >
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#cbd5e1" }}>
                  {PII_OWNER.name}
                </span>
                <span style={{ fontSize: "9.5px", color: "#64748b" }}>Answers for personal data</span>
              </div>
            </div>
            <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>
              Scanned {pii.scanned} · {pii.cadence}
            </span>
          </div>
        </div>

        {/* ── Stat cards / filter — proto 4130-4138 ─────────────────────── */}
        <div
          data-testid="pv2-pii-stats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 10,
          }}
        >
          {stats.map((s) => {
            const on = filter === s.key;
            return (
              <button
                key={s.key}
                data-testid={`pv2-pii-stat-${s.key}`}
                onClick={() => toggleFilter(s.key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  padding: "13px 15px",
                  borderRadius: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                  border: `1px solid ${s.color}${on ? "99" : "2b"}`,
                  background: `linear-gradient(160deg, ${s.color}${on ? "1f" : "0d"}, rgba(15,23,42,.45))`,
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
              </button>
            );
          })}
        </div>

        {/* ── Findings — proto 4140-4171 ────────────────────────────────── */}
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
            {findings.map((f) => (
              <FindingRow
                key={f.id}
                f={f}
                open={open === f.id}
                onToggle={() => setOpen((o) => (o === f.id ? null : f.id))}
                onFix={() => go("/portal-v2/change-control")}
                onRisk={() => go("/portal-v2/risk-register")}
                onAccept={() => go("/portal-v2/policy-decisions")}
              />
            ))}
          </div>
        </div>

        {/* ── Who can reach it / What moved — proto 4173-4204 ───────────── */}
        <div className="pv2-gov-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={SECTION_LABEL}>Who can reach it</span>
            <div
              data-testid="pv2-pii-access"
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
              {pii.access.map((a) => (
                <div
                  key={a.who}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 13px",
                    borderBottom: "1px solid rgba(30,41,59,.75)",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#e2e8f0",
                        lineHeight: 1.35,
                      }}
                    >
                      {a.who}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>
                      {a.what} · {a.type} · {a.link}
                    </span>
                  </div>
                  <span
                    style={{
                      flex: "0 0 auto",
                      padding: "2px 8px",
                      borderRadius: 5,
                      border: `1px solid ${a.tone}55`,
                      background: `${a.tone}14`,
                      fontSize: "9px",
                      fontWeight: 800,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: a.tone,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.flag}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={SECTION_LABEL}>What moved</span>
            <div
              data-testid="pv2-pii-drift"
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
              {pii.drift.map((d) => (
                <button
                  key={d.what}
                  onClick={() => go("/portal-v2/change-control")}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "11px 13px",
                    border: "none",
                    borderBottom: "1px solid rgba(30,41,59,.75)",
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
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      marginTop: 5,
                      background: d.tone,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "12px",
                        color: "#e2e8f0",
                        lineHeight: 1.45,
                        textWrap: "pretty",
                      }}
                    >
                      {d.what}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>
                      {d.when} · {d.who}
                    </span>
                    <span
                      style={{
                        flex: "0 0 auto",
                        fontSize: "9px",
                        fontWeight: 800,
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                        color: d.tone,
                      }}
                    >
                      {piiDriftVerdict(d.cr)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Where it was found / What it looks for — proto 4206-4241 ──── */}
        <div className="pv2-gov-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={SECTION_LABEL}>Where it was found</span>
            <div
              data-testid="pv2-pii-sources"
              style={{ display: "flex", flexDirection: "column", gap: 9 }}
            >
              {pii.sources.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    padding: "11px 13px",
                    borderRadius: 10,
                    border: "1px solid rgba(139,92,246,.2)",
                    background: "rgba(139,92,246,.04)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>
                      {s.name}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        color: "#c4b5fd",
                        fontFamily: MONO,
                      }}
                    >
                      {piiHitsText(s.hits)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 3,
                      background: "rgba(148,163,184,.14)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        width: `${piiSourceBarPct(s.hits)}%`,
                        background: "linear-gradient(90deg,#8B5CF6,#a78bfa)",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45 }}>
                    {s.scanned} · {s.note}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span style={SECTION_LABEL}>What it looks for</span>
              <button
                data-testid="pv2-pii-add-pattern"
                onClick={addPattern}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(148,163,184,.24)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "10px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Add a pattern
              </button>
            </div>
            <div
              data-testid="pv2-pii-patterns"
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
              {pii.patterns.map((p) => (
                <div
                  key={p.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 13px",
                    borderBottom: "1px solid rgba(30,41,59,.75)",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "12px",
                      color: "#e2e8f0",
                      lineHeight: 1.4,
                    }}
                  >
                    {p.name}
                  </span>
                  {p.custom && (
                    <span
                      style={{
                        flex: "0 0 auto",
                        fontSize: "9px",
                        fontWeight: 800,
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                        color: "#5eead4",
                      }}
                    >
                      Yours
                    </span>
                  )}
                  <span
                    style={{
                      flex: "0 0 auto",
                      padding: "2px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(148,163,184,.24)",
                      background: "rgba(148,163,184,.06)",
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.kind}
                  </span>
                  <span
                    style={{
                      flex: "0 0 56px",
                      textAlign: "right",
                      fontSize: "11.5px",
                      fontWeight: 700,
                      color: "#94a3b8",
                      fontFamily: MONO,
                    }}
                  >
                    {piiHitsText(p.hits)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── What a finding is wired into — proto 4243-4253 ────────────── */}
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
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#93c5fd" }}>
                  {l.label} →
                </span>
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

      {formElement}
    </PortalV2Shell>
  );
}

function FindingRow({
  f,
  open,
  onToggle,
  onFix,
  onRisk,
  onAccept,
}: {
  f: PiiFinding;
  open: boolean;
  onToggle: () => void;
  onFix: () => void;
  onRisk: () => void;
  onAccept: () => void;
}) {
  const sevC = PII_SEV_COLOR[f.sev];
  const expC = PII_EXP_COLOR[f.exposure];

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
        <span
          style={{
            flex: "0 0 auto",
            padding: "2px 8px",
            borderRadius: 5,
            border: `1px solid ${expC}45`,
            background: "transparent",
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: expC,
            whiteSpace: "nowrap",
          }}
        >
          {f.exposure}
        </span>
        <div
          style={{
            flex: "1 1 240px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span
            style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}
          >
            {f.where}
          </span>
          <span style={{ fontSize: "10.5px", color: "#64748b" }}>
            {f.kind} · {piiFilesText(f)} · {piiLabelText(f)}
          </span>
        </div>
        <span
          style={{
            flex: "0 0 auto",
            fontSize: "10.5px",
            fontWeight: 700,
            color: "#93c5fd",
            whiteSpace: "nowrap",
          }}
        >
          {f.action}
        </span>
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
          <span
            style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}
          >
            {f.detail}
          </span>
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>Route · {f.route}</span>
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
            {f.risk && (
              <button
                onClick={onRisk}
                style={{
                  padding: "7px 13px",
                  borderRadius: 7,
                  border: "1px solid rgba(167,139,250,.45)",
                  background: "rgba(167,139,250,.1)",
                  color: "#c4b5fd",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {f.risk} on the register
              </button>
            )}
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
