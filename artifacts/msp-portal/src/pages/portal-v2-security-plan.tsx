/**
 * portal-v2-security-plan.tsx — the Security Plan.
 *
 * A direct port of the prototype's `isSecPlan` block
 * ('Customer Portal Shell.dc.html' 4258-4343) and its render derivation
 * (20197-20244), transcribed into `securityPlanData.ts` (the design reference)
 * and `securityPlanModel.ts` (the derived tallies).
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * "The authoritative record of how this tenant must be configured, monitored,
 * governed and changed. Every requirement points at the module that proves it,
 * so the plan cannot quietly drift from the tenant." The header verdict, the
 * percentage and the per-section gap badge are therefore DERIVED from the rows
 * (securityPlanModel.ts), not stated — a plan that could disagree with itself
 * would defeat its own claim.
 *
 * ── Real backend, real honest states (Git #1439) ───────────────────────────
 * `GET /api/portal/security-plan` (`artifacts/api-server/src/routes/
 * portal-security-plan.ts`, admin-authored via the manual migration
 * `2026-08-21-portal-v2-security-plan.sql`) is real and wired through
 * `useSecurityPlan`. `securityPlanData.ts`'s `SECURITY_PLAN` is design
 * reference / unit-test content only now — no runtime path renders it. Shane's
 * live testing ("Security Plan fake data") caught the prior version silently
 * rendering that fixture for every customer besides the one seeded testbed
 * tenant, since most real customers genuinely have no plan authored yet. The
 * page now resolves one of four honest states off `dataState`: a loading
 * skeleton, the real plan, an honest "no plan authored yet" empty state, or an
 * honest error state — never the fixture.
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
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import { NoScanDataState } from "@/components/portal-v2/NoScanDataState";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import { type SecPlanRow } from "@/components/portal-v2/securityPlanData";
import { useSecurityPlan } from "@/components/portal-v2/securityPlanLive";
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
  // Live from GET /api/portal/security-plan. `dataState` is one of four honest
  // states (see the header). Kept as one object, not destructured, until after
  // the state checks below — `SecurityPlanState` is a discriminated union on
  // `dataState`, and only checking `secPlan.dataState` (the same reference)
  // lets the compiler narrow `secPlan.plan`/`secPlan.owner` to non-null for the
  // "live" branch, rather than the widened `| null` every other branch carries.
  const secPlan = useSecurityPlan();

  const [selected, setSelected] = useState<string>("governance");

  const go = (to: string) => {
    if (LIVE_ROUTES.has(to)) navigate(to);
  };

  // While the real read is in flight, render an honest loading skeleton — never
  // the design fixture (Git #1343). The seeded plan is a verbatim copy of the
  // fixture, so showing it here then swapping to real data would flicker a
  // confident-but-fake plan; a stable skeleton is the honest state. The source
  // marker stays in the DOM reading "loading" so the manifest can assert it.
  if (secPlan.dataState === "loading") {
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
          <span data-testid="pv2-sp-source" style={PV2_SOURCE_CLIP}>
            {secPlan.dataState}
          </span>
          <PortalV2LoadingState
            rows={6}
            label="Loading your security plan…"
            testId="pv2-sp-loading"
          />
        </div>
      </PortalV2Shell>
    );
  }

  // Honest empty states (Git #1439) — never the design fixture. "no-plan" is the
  // expected, common case for any real customer besides the one seeded testbed
  // tenant; "error" is a genuinely failed or malformed read.
  if (secPlan.dataState === "no-plan" || secPlan.dataState === "error") {
    const isNoPlan = secPlan.dataState === "no-plan";
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
          <span data-testid="pv2-sp-source" style={PV2_SOURCE_CLIP}>
            {secPlan.dataState}
          </span>
          <NoScanDataState
            label={
              isNoPlan
                ? "No security plan has been authored for your tenant yet"
                : "Your security plan could not be loaded"
            }
            detail={
              isNoPlan
                ? "Your account manager authors and signs this plan for your tenant. Reach out if you believe one is overdue."
                : "Please refresh the page. If this keeps happening, contact support."
            }
            testId="pv2-sp-empty"
          />
        </div>
      </PortalV2Shell>
    );
  }

  // secPlan.dataState === "live" from here down — `plan`/`owner` are real and
  // non-null (the compiler enforces it: SecurityPlanState is a discriminated
  // union and every other member was returned above).
  const { plan, owner, dataState } = secPlan;
  const section = spSelectedSection(plan, selected);
  const counts = spCounts(plan);
  const pct = spPct(plan);

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
        {/*
          Which of the four honest states rendered this pass — always "live" here,
          since the loading/no-plan/error states return earlier. The seeded plan is
          a verbatim copy of the design reference content, so text alone cannot
          prove which source rendered it; this marker is the one signal that does,
          and is what the test manifest asserts. Off-screen, not display:none, so
          its textContent is still readable by the harness.
        */}
        <span
          data-testid="pv2-sp-source"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
          }}
        >
          {dataState}
        </span>

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
                  background: owner.tone,
                  border: "1px solid transparent",
                }}
              >
                {owner.initials}
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
