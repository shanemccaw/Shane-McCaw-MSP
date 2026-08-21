/**
 * portal-v2-security-plan.tsx — the Security Plan.
 *
 * A direct port of the prototype's `isSecPlan` block
 * ('Customer Portal Shell.dc.html' 4258-4343) and its render derivation
 * (20197-20244), transcribed into `securityPlanData.ts` (the fixture) and
 * `securityPlanModel.ts` (the derived tallies).
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * "The authoritative record of how this tenant must be configured, monitored,
 * governed and changed. Every requirement points at the module that proves it,
 * so the plan cannot quietly drift from the tenant." The header verdict, the
 * percentage and the per-section gap badge are therefore DERIVED from the rows
 * (securityPlanModel.ts), not stated — a plan that could disagree with itself
 * would defeat its own claim.
 *
 * ── UI ONLY ─────────────────────────────────────────────────────────────────
 * There is no plan-of-record endpoint yet; every value is the design's own,
 * kept in `securityPlanData.ts` for the later wiring pass. The one piece of real
 * interactivity — selecting a section in the left rail — is driven by the model.
 *
 * ── Cross-links to pages that do not exist yet ─────────────────────────────
 * Each requirement points at the module that proves it, and the version history
 * points at the change that made it. Most of those routes exist today and are
 * wired; a handful do not yet (Policy Decisions is Part 5, SOPs & Runbooks is
 * Part 6, Remediation is Part 5, some drill-downs are Part 11, Integrations is
 * Part 12), so their "→" controls render identically but stay inert rather than
 * navigating to a 404. Routes drop into LIVE_ROUTES as those pages land.
 */

import { useState } from "react";
import { useLocation } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import {
  SECURITY_PLAN,
  SECURITY_PLAN_OWNER,
  type SecPlanRow,
} from "@/components/portal-v2/securityPlanData";
import {
  SP_STATE_META,
  spCounts,
  spPct,
  spSectionGaps,
  spSelectedSection,
  spVerdict,
} from "@/components/portal-v2/securityPlanModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The portal-v2 routes these "→" controls may navigate to that exist today. */
const LIVE_ROUTES = new Set<string>([
  "/portal-v2",
  "/portal-v2/ownership",
  "/portal-v2/documents",
  "/portal-v2/security",
  "/portal-v2/health",
  "/portal-v2/governance",
  "/portal-v2/risk-register",
  "/portal-v2/change-control",
  "/portal-v2/compliance",
  "/portal-v2/pii",
  "/portal-v2/settings",
  "/portal-v2/ms-changes",
  "/portal-v2/security-plan",
]);

export default function PortalV2SecurityPlanPage() {
  const [, navigate] = useLocation();
  const plan = SECURITY_PLAN;

  const [selected, setSelected] = useState<string>("governance");
  const section = spSelectedSection(plan, selected);
  const counts = spCounts(plan);
  const pct = spPct(plan);

  const go = (to: string) => {
    if (LIVE_ROUTES.has(to)) navigate(to);
  };

  return (
    <PortalV2Shell eyebrow="Governance" title="Security Plan">
      <div
        data-testid="pv2-sp-page"
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
        {/* ── Header — proto 4261-4277 ──────────────────────────────────── */}
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
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#a78bfa",
              }}
            >
              Security plan · {plan.version}
            </span>
            <span
              data-testid="pv2-sp-heading"
              style={{
                fontSize: "22px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-.02em",
              }}
            >
              {plan.tenant} · {plan.env}
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "#94a3b8",
                lineHeight: 1.6,
                maxWidth: "82ch",
                textWrap: "pretty",
              }}
            >
              The authoritative record of how this tenant must be configured, monitored, governed
              and changed. Every requirement points at the module that proves it, so the plan cannot
              quietly drift from the tenant.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 7,
              alignItems: "flex-end",
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 6,
                border: "1px solid rgba(139,92,246,.45)",
                background: "rgba(139,92,246,.12)",
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "#c4b5fd",
                whiteSpace: "nowrap",
              }}
            >
              {plan.tier} tier
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                title={plan.approver}
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
                  background: SECURITY_PLAN_OWNER.tone,
                  border: "1px solid transparent",
                }}
              >
                {SECURITY_PLAN_OWNER.initials}
              </span>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 0, textAlign: "right" }}
              >
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#cbd5e1" }}>
                  {plan.approver}
                </span>
                <span style={{ fontSize: "9.5px", color: "#64748b" }}>Signed {plan.updated}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Verdict band — proto 4279-4291 ────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 9,
            padding: "15px 17px",
            borderRadius: 12,
            border: "1px solid rgba(139,92,246,.24)",
            background: "linear-gradient(160deg,rgba(139,92,246,.07),rgba(15,23,42,.45))",
          }}
        >
          <span
            data-testid="pv2-sp-verdict"
            style={{
              fontSize: "14px",
              fontWeight: 800,
              color: "#f8fafc",
              letterSpacing: "-.01em",
            }}
          >
            {spVerdict(plan)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
            <div
              style={{
                flex: 1,
                minWidth: 200,
                height: 9,
                borderRadius: 5,
                background: "rgba(148,163,184,.14)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 5,
                  width: `${pct}%`,
                  background: "linear-gradient(90deg,#34d399,#5eead4)",
                }}
              />
            </div>
            <span
              data-testid="pv2-sp-pct"
              style={{ fontSize: "12px", fontWeight: 800, color: "#34d399", fontFamily: MONO }}
            >
              {pct}%
            </span>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", color: "#34d399", fontWeight: 700 }}>
              {counts.met} met
            </span>
            <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700 }}>
              {counts.partial} partly met
            </span>
            <span style={{ fontSize: "11px", color: "#f87171", fontWeight: 700 }}>
              {counts.gap} not met
            </span>
            <span style={{ fontSize: "11px", color: "#64748b" }}>
              {counts.total} requirements in total
            </span>
          </div>
        </div>

        {/* ── Sections nav + selected section — proto 4293-4340 ─────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "236px minmax(0,1fr)",
            gap: 22,
            alignItems: "start",
          }}
        >
          {/* Left rail — proto 4294-4305 */}
          <div
            data-testid="pv2-sp-nav"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              position: "sticky",
              top: 18,
              paddingRight: 12,
              borderRight: "1px solid rgba(30,41,59,.8)",
            }}
          >
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#475569",
                padding: "0 0 6px 11px",
              }}
            >
              Sections
            </span>
            {plan.sections.map((sec) => {
              const on = selected === sec.k;
              const gaps = spSectionGaps(sec);
              return (
                <button
                  key={sec.k}
                  data-testid={`pv2-sp-nav-${sec.k}`}
                  onClick={() => setSelected(sec.k)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 11px",
                    borderRadius: 8,
                    border: "none",
                    borderLeft: `2px solid ${on ? "#8B5CF6" : "transparent"}`,
                    background: on ? "rgba(139,92,246,.12)" : "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: "9.5px",
                      fontWeight: 700,
                      color: on ? "#a78bfa" : "#475569",
                      fontFamily: MONO,
                    }}
                  >
                    {sec.n}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "11.5px",
                      fontWeight: on ? 800 : 600,
                      color: on ? "#f8fafc" : "#94a3b8",
                      lineHeight: 1.35,
                    }}
                  >
                    {sec.label}
                  </span>
                  {gaps > 0 && (
                    <span
                      style={{
                        flex: "0 0 auto",
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "rgba(248,113,113,.16)",
                        border: "1px solid rgba(248,113,113,.4)",
                        fontSize: "9px",
                        fontWeight: 800,
                        color: "#fca5a5",
                      }}
                    >
                      {gaps}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right — the selected section — proto 4307-4339 */}
          <div
            data-testid="pv2-sp-section"
            style={{ display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 800,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#a78bfa",
                }}
              >
                Section {section.n}
              </span>
              <span
                data-testid="pv2-sp-section-label"
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  color: "#f8fafc",
                  letterSpacing: "-.015em",
                }}
              >
                {section.label}
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                {section.lead}
              </span>
            </div>

            <div
              data-testid="pv2-sp-rows"
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
              {section.rows.map((r, i) => (
                <RequirementRow key={i} r={r} index={i} onGo={() => go(r.to)} />
              ))}
            </div>

            {/* ── Version history — proto 4326-4338 ───────────────────── */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 8,
              }}
            >
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                Version history
              </span>
              <div
                data-testid="pv2-sp-history"
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {plan.history.map((h) => (
                  <div
                    key={h.cr}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "10px 13px",
                      borderRadius: 10,
                      border: "1px solid rgba(30,41,59,.8)",
                      background: "rgba(15,23,42,.35)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        fontSize: "11px",
                        fontWeight: 800,
                        color: "#c4b5fd",
                        fontFamily: MONO,
                      }}
                    >
                      {h.v}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 200,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11.5px",
                          color: "#cbd5e1",
                          lineHeight: 1.55,
                          textWrap: "pretty",
                        }}
                      >
                        {h.what}
                      </span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>
                        {h.when} · {h.who}
                      </span>
                    </div>
                    <button
                      onClick={() => go("/portal-v2/change-control")}
                      style={{
                        flex: "0 0 auto",
                        padding: "3px 9px",
                        borderRadius: 5,
                        border: "1px solid rgba(96,165,250,.4)",
                        background: "rgba(96,165,250,.1)",
                        color: "#93c5fd",
                        fontSize: "9.5px",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: MONO,
                      }}
                    >
                      {h.cr}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}

function RequirementRow({
  r,
  index,
  onGo,
}: {
  r: SecPlanRow;
  index: number;
  onGo: () => void;
}) {
  const m = SP_STATE_META[r.state];
  return (
    <div
      data-testid={`pv2-sp-row-${index}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "13px 15px",
        borderLeft: `2px solid ${m.color}`,
        borderTop: "1px solid rgba(30,41,59,.75)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
        <span
          style={{
            flex: "0 0 auto",
            padding: "2px 9px",
            borderRadius: 5,
            border: `1px solid ${m.color}55`,
            background: `${m.color}14`,
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: m.color,
            whiteSpace: "nowrap",
          }}
        >
          {m.label}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 200,
            fontSize: "12.5px",
            fontWeight: 700,
            color: "#e2e8f0",
            lineHeight: 1.45,
            textWrap: "pretty",
          }}
        >
          {r.req}
        </span>
      </div>
      <span
        style={{
          fontSize: "11.5px",
          color: "#94a3b8",
          lineHeight: 1.6,
          textWrap: "pretty",
          paddingLeft: 2,
        }}
      >
        {r.detail}
      </span>
      <button
        onClick={onGo}
        style={{
          alignSelf: "flex-start",
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid rgba(148,163,184,.22)",
          background: "transparent",
          color: "#93c5fd",
          fontSize: "10.5px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {r.toLabel} →
      </button>
    </div>
  );
}
