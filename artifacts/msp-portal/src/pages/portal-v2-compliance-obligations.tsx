/**
 * portal-v2-compliance-obligations.tsx — the "Obligations we check against"
 * drill-down.
 *
 * A direct port of the prototype's `isCmpObligations` section
 * (`Customer Portal Shell.dc.html` 4783-4814). The scope chip and the state text
 * both branch on tone; the out-of-scope PCI-DSS row is the `slate` tone and gets
 * the muted styling. Copy is verbatim.
 *
 * ── Wired (Git #1432, off #1223/#1256's catalog) ────────────────────────────
 * The register used to render the raw `CMP_OBLIGATIONS` design fixture
 * unconditionally — no loading state, no honest empty/error state, every row's
 * `state` text a specific tenant-shaped claim presented as fact. #1415's audit
 * found this and #1432 was filed to fix it. Investigation for #1432 found the
 * premise "no register endpoint exists" was stale by one day: Git #1223/#1333
 * (commit `8f0d71788`) had already built a real endpoint
 * (`GET /api/portal/compliance-obligations`, joining `compliance_frameworks` /
 * `compliance_obligations` / `tenant_compliance_scope` to the tenant's open
 * `msp_risk_decisions`) and a real client hook (`useComplianceObligationsLive`)
 * — but the route was never mounted into `routes/index.ts` and this page never
 * called the hook, so it was dead code and the fixture kept rendering as if
 * real. This page now reads that hook directly; the fixture is never rendered.
 */

import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { CMP_MONO } from "@/components/portal-v2/cmpDrilldownData";
import { cmpObligationColor, cmpObligationScopeMuted } from "@/components/portal-v2/cmpDrilldownModel";
import { useComplianceObligationsLive } from "@/components/portal-v2/complianceObligationsLive";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

export default function PortalV2ComplianceObligationsPage() {
  // Reads the compliance pillar's live payload through `useLivePillarHero`; the
  // `pv2-cmpobl-source` marker proves the hero score is on real data.
  const live = useLivePillarHero("compliance");
  // The real obligation register (Git #1223) — a separate endpoint from the
  // pillar hero, so it gets its own `pv2-cmpobl-rows-source` marker below.
  // `rows` is ONLY the real, live catalog; the fixture is never rendered — a
  // failed/never-resolved fetch or an empty live catalog both fall through to
  // an honest on-screen state instead.
  const { obligations, dataState, loading } = useComplianceObligationsLive();
  const rows = dataState === "live" ? obligations : [];
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

          {(loading || dataState !== "live") && (
            <div
              data-testid="pv2-cmpobl-status"
              style={{
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: "12px",
                border: `1px solid ${loading ? "rgba(148,163,184,.25)" : "rgba(248,113,113,.4)"}`,
                background: loading ? "transparent" : "rgba(248,113,113,.08)",
                color: loading ? "#94a3b8" : "#f87171",
              }}
            >
              {loading
                ? "Loading your obligation register…"
                : "Your obligation register could not be loaded — no live data available."}
            </div>
          )}

          {!loading && dataState === "live" && rows.length === 0 && (
            <div
              data-testid="pv2-cmpobl-empty"
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
              No obligations are catalogued yet — not yet measured.
            </div>
          )}

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
            {rows.map((o) => {
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
      <PillarLiveSource testId="pv2-cmpobl-source" live={live} />
      <PillarLiveSource testId="pv2-cmpobl-rows-source" live={{ dataState }} />
    </PortalV2Shell>
  );
}
