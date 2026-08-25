/**
 * portal-v2-compliance-decisions.tsx — the "Documented policy decisions"
 * drill-down.
 *
 * A direct port of the prototype's `isCmpDecisions` section
 * (`Customer Portal Shell.dc.html` 4732-4781), originally driven by the
 * `CMP_ACCEPTED` fixture and the `cmpAcceptedRows` mapper (13852-13861). Not
 * the Operate "Policy Decisions" tracker (that is `/portal-v2/policy-decisions`,
 * Part 5's) — this page shows the same underlying register, filtered to the
 * Compliance pillar and rendered in full (rationale + compensating control
 * always open) rather than as a filterable queue.
 *
 * Wired (Git #1221): `CMP_ACCEPTED`'s two rows (CMP-A1/CMP-A2) turned out to be
 * a verbatim duplicate of `POLICY_DECISIONS`' first two rows in
 * `policyDecisionsData.ts` — same ids, same copy, same real backing table
 * (`msp_risk_decisions`, served by `GET /api/portal/policy-decisions` via
 * `usePolicyDecisions()`). That endpoint already filters to rows that ARE a
 * documented decision (`decision_state` non-null); this page narrows further to
 * `pillar === "Compliance"`. A tenant with no compliance decisions recorded now
 * shows an honest empty state instead of the two fixture rows.
 *
 * Every inline style value is the prototype's. Copy is verbatim.
 */

import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { CMP_MONO } from "@/components/portal-v2/cmpDrilldownData";
import { usePolicyDecisions } from "@/components/portal-v2/riskRegisterLive";
import type { PolicyDecision } from "@/components/portal-v2/policyDecisionsData";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

function cmpDecisionMeta(d: PolicyDecision): { k: string; v: string }[] {
  return [
    { k: "Approved by", v: d.owner },
    { k: "Approved", v: d.approved },
    { k: "Next review", v: d.review },
    { k: "Risk register", v: d.register },
  ];
}

export default function PortalV2ComplianceDecisionsPage() {
  // Reads the compliance pillar's live war-room-pillars payload through the same
  // `useLivePillarHero` seam as every other pillar view — the `pv2-cmpdec-source`
  // marker proves the page is on real data.
  const live = useLivePillarHero("compliance");
  // The real documented-decision register (`msp_risk_decisions`), narrowed to
  // this pillar. See the header comment for why this replaced `CMP_ACCEPTED`.
  const { decisions, loading, error } = usePolicyDecisions();
  const cmpDecisions = decisions.filter((d) => d.pillar.trim().toLowerCase() === "compliance");
  return (
    <PortalV2Shell eyebrow="Compliance" title="Documented policy decisions">
      <div
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
        <Link
          href="/portal-v2/compliance"
          data-testid="pv2-cmpdec-back"
          style={{
            alignSelf: "flex-start",
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
          ← Compliance
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}
            data-testid="pv2-cmpdec-heading"
          >
            Documented policy decisions
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>
            Deliberate positions, not gaps. Shown in full so an auditor sees the reasoning and the compensating
            control, not just the outcome.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}>
              Documented Policy Decisions · {cmpDecisions.length}
            </span>
            <span style={{ fontSize: "11px", color: "#475569" }}>
              Deliberate positions, not gaps. Shown in full so an auditor sees the reasoning, not just the outcome.
            </span>
          </div>

          {(loading || error) && (
            <div
              data-testid="pv2-cmpdec-status"
              style={{
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: "12px",
                border: `1px solid ${error ? "rgba(248,113,113,.4)" : "rgba(148,163,184,.25)"}`,
                background: error ? "rgba(248,113,113,.08)" : "transparent",
                color: error ? "#f87171" : "#94a3b8",
              }}
            >
              {error
                ? "Your documented policy decisions could not be loaded, so this page is not showing your current positions."
                : "Loading your documented policy decisions…"}
            </div>
          )}

          {!loading && !error && cmpDecisions.length === 0 && (
            <div
              data-testid="pv2-cmpdec-empty"
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
              No documented policy decisions are recorded against Compliance yet.
            </div>
          )}

          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10 }}
            data-testid="pv2-cmpdec-cards"
          >
            {cmpDecisions.map((a) => (
              <div
                key={a.id}
                data-testid={`pv2-cmpdec-card-${a.id}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                  padding: "16px 18px",
                  border: "1px solid rgba(226,232,240,.16)",
                  borderRadius: 12,
                  background: "linear-gradient(160deg, rgba(226,232,240,.05), rgba(15,23,42,.5))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", letterSpacing: ".06em", fontFamily: CMP_MONO }}>
                    {a.id}
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      border: "1px solid rgba(226,232,240,.3)",
                      background: "rgba(226,232,240,.08)",
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "#e2e8f0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Documented policy decision
                  </span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.45, textWrap: "pretty" }}>
                  {a.title}
                </span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", fontFamily: CMP_MONO }}>{a.obligation}</span>

                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
                    Rationale
                  </span>
                  <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{a.rationale}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
                    Compensating control
                  </span>
                  <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{a.compensating}</span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(226,232,240,.12)",
                  }}
                >
                  {cmpDecisionMeta(a).map((m) => (
                    <div key={m.k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>
                        {m.k}
                      </span>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#e2e8f0", fontFamily: CMP_MONO }}>{m.v}</span>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.55, textWrap: "pretty" }}>{a.check}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <PillarLiveSource testId="pv2-cmpdec-source" live={live} />
    </PortalV2Shell>
  );
}
