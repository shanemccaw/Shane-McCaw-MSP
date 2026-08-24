/**
 * portal-v2-compliance-decisions.tsx — the "Documented policy decisions"
 * drill-down.
 *
 * A direct port of the prototype's `isCmpDecisions` section
 * (`Customer Portal Shell.dc.html` 4732-4781), driven by `CMP_ACCEPTED` and the
 * `cmpAcceptedRows` mapper (13852-13861). These are deliberate positions with an
 * owner and a review date, shown in full so an auditor sees the reasoning — not
 * the Operate "Policy Decisions" tracker (that is `/portal-v2/policy-decisions`,
 * Part 5's, a different page and a different fixture).
 *
 * Every inline style value is the prototype's. Copy is verbatim.
 */

import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { CMP_ACCEPTED, CMP_MONO } from "@/components/portal-v2/cmpDrilldownData";
import { CMP_ACCEPTED_COUNT, cmpAcceptedMeta } from "@/components/portal-v2/cmpDrilldownModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

export default function PortalV2ComplianceDecisionsPage() {
  // Reads the compliance pillar's live war-room-pillars payload through the same
  // `useLivePillarHero` seam as every other pillar view — the `pv2-cmpdec-source`
  // marker proves the page is on real data. The accepted-risk CARDS themselves are
  // a deliberate-decision register with no server producer today (accepting a risk
  // is a UI-only no-op on these pages), so those cards stay fixture — a documented
  // backend gap, not a fabricated number.
  const live = useLivePillarHero("compliance");
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
              Documented Policy Decisions · {CMP_ACCEPTED_COUNT}
            </span>
            <span style={{ fontSize: "11px", color: "#475569" }}>
              Deliberate positions, not gaps. Shown in full so an auditor sees the reasoning, not just the outcome.
            </span>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10 }}
            data-testid="pv2-cmpdec-cards"
          >
            {CMP_ACCEPTED.map((a) => (
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
                    {a.decision}
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
                  {cmpAcceptedMeta(a).map((m) => (
                    <div key={m.k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>
                        {m.k}
                      </span>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#e2e8f0", fontFamily: CMP_MONO }}>{m.v}</span>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.55, textWrap: "pretty" }}>{a.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <PillarLiveSource testId="pv2-cmpdec-source" live={live} />
    </PortalV2Shell>
  );
}
