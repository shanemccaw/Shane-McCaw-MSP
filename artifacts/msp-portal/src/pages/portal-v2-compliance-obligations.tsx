/**
 * portal-v2-compliance-obligations.tsx — the "Obligations we check against"
 * drill-down.
 *
 * A direct port of the prototype's `isCmpObligations` section
 * (`Customer Portal Shell.dc.html` 4783-4814), driven by `CMP_OBLIGATIONS` and
 * the `cmpObligations` mapper (13871-13878). The scope chip and the state text
 * both branch on tone; the out-of-scope PCI-DSS row is the `slate` tone and gets
 * the muted styling.
 *
 * Every inline style value is the prototype's. Copy is verbatim.
 */

import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { CMP_MONO } from "@/components/portal-v2/cmpDrilldownData";
import { CMP_OBLIGATIONS, cmpObligationColor, cmpObligationScopeMuted } from "@/components/portal-v2/cmpDrilldownModel";

export default function PortalV2ComplianceObligationsPage() {
  return (
    <PortalV2Shell eyebrow="Compliance" title="Obligations we check against">
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
          data-testid="pv2-cmpobl-back"
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
            data-testid="pv2-cmpobl-heading"
          >
            Obligations we check against
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>
            Scope set by you at onboarding. Change it and every check re-evaluates on the next scan.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}>
              Obligations We Check Against
            </span>
            <span style={{ fontSize: "11px", color: "#475569" }}>Scope set by you at onboarding. Change it and every check re-evaluates.</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(226,232,240,.13)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
            }}
            data-testid="pv2-cmpobl-rows"
          >
            {CMP_OBLIGATIONS.map((o) => {
              const muted = cmpObligationScopeMuted(o.tone);
              return (
                <div
                  key={o.framework}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(190px,1fr) minmax(0,1.5fr) minmax(0,1.3fr)",
                    gap: 16,
                    padding: "12px 18px",
                    borderTop: "1px solid rgba(30,41,59,.85)",
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4, fontFamily: CMP_MONO }}>
                      {o.framework}
                    </span>
                    <span
                      style={{
                        flex: "0 0 auto",
                        alignSelf: "flex-start",
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: `1px solid ${muted ? "rgba(148,163,184,.25)" : "rgba(226,232,240,.2)"}`,
                        background: "rgba(226,232,240,.05)",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        color: muted ? "#64748b" : "#cbd5e1",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.scope}
                    </span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{o.requires}</span>
                  <span style={{ fontSize: "11.5px", fontWeight: 600, color: cmpObligationColor(o.tone), lineHeight: 1.5 }}>{o.state}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
