/**
 * portal-v2-compliance-gaps.tsx — the Compliance "Open gaps" drill-down.
 *
 * A direct port of the prototype's `isCmpGaps` section
 * (`Customer Portal Shell.dc.html` 4659-4730), driven by `CMP_FINDINGS` and the
 * `cmpFindingRows` mapper (13806-13851).
 *
 * Every inline style value is the prototype's; the README states those values
 * ARE the spec, so no house Card/Badge is used where the numbers differ. The
 * fix wrench opens the shared FixPanel (the CR gate) and "Record a policy
 * decision instead" opens the shared FormDrawer, exactly as the prototype's
 * `f.fixGo` / `f.acceptGo` do.
 *
 * The heading's inline knowledge-base "i" chip (proto 4667) is deliberately not
 * reproduced: it reads from the shell's KB article store (Part 1's), and this
 * drill-down should not couple to it. The heading copy itself is verbatim.
 *
 * ── Rows are now real (Git #1255 / #1222) ────────────────────────────────────
 * #1255 widened the shared `war-room-pillars` finding shape with
 * `description`/`recommendation`/`evidence`/`obligation`/`whyItMatters`, so the
 * rows below now read the SAME live payload the header count already used
 * (`useLivePillarHero`), mapped through `cmpFindingRowsFromLive`. `CMP_FINDINGS`
 * stays as the loading-state placeholder only — once the payload has loaded for
 * this pillar, the real findings render, including an honest empty state when
 * the tenant genuinely has none. No fixture Halden Materials copy is shown
 * once real data is available, matching the "no fabricated numbers" rule.
 */

import { useState } from "react";
import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { CMP_FINDINGS, CMP_MONO, type CmpFinding } from "@/components/portal-v2/cmpDrilldownData";
import { cmpFindingRowsFromLive, cmpSevMeta } from "@/components/portal-v2/cmpDrilldownModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

function WrenchIcon({ color = "#60a5fa", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function Chevron({ deg }: { deg: number }) {
  return (
    <span style={{ flex: "0 0 auto", display: "flex", marginTop: 2, transform: `rotate(${deg}deg)`, transition: "transform 180ms" }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

// Generic role labels only — the fictional Halden employees (Dan Whitlock,
// Priya Raman) were removed so the accept-decision form never suggests an
// invented person as the accountable name on a real customer's page (Git #1342).
// There is no tenant people/RACI source to populate real names from yet.
const OWNER_OPTIONS = ["General Counsel", "Controller", "IT Director", "Data Protection Officer"].map((v) => ({ value: v, label: v }));
const REVIEW_OPTIONS = ["3 months", "6 months", "12 months"].map((v) => ({ value: v, label: v }));

export default function PortalV2ComplianceGapsPage() {
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();
  const [expanded, setExpanded] = useState<number | null>(null);

  // Both the header count and the rows themselves now read the SAME real
  // per-finding data (#1255 widened the shared finding shape; see the header
  // comment). `present` is false only before this pillar's first real payload
  // has arrived — the fixture is shown then, and only then. Once loaded, the
  // rows are the tenant's real findings, including a real empty list.
  const live = useLivePillarHero("compliance");
  const compliancePillar = live.pillars.find((p) => p.key === "compliance");
  const liveRows = compliancePillar?.present
    ? cmpFindingRowsFromLive(compliancePillar.findings)
    : null;
  const rows = liveRows ?? CMP_FINDINGS;
  const openCount = liveRows ? liveRows.length : CMP_FINDINGS.length;

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [{ id: "question", label: "Your question", kind: "textarea", wide: true, placeholder: "What would you like to know about this?" }],
      doneTitle: "Sent",
      doneNote: "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({ onConfirm: () => {}, onAskShaneBot: askShaneBot });

  const recordDecision = (f: CmpFinding) =>
    openForm({
      kicker: "Policy decision from " + f.id,
      title: "Record a policy decision",
      intro:
        "This gap stays visible, but as a position with a name against it rather than a finding. Prefilled from " +
        f.id +
        " — change anything that is not right.",
      submitLabel: "Record it, awaiting sign-off",
      fields: [
        { id: "gap", label: "The gap", value: f.title, wide: true },
        { id: "obligation", label: "Obligation it touches", value: f.obligation, wide: true },
        { id: "owner", label: "Accountable name", kind: "select", options: OWNER_OPTIONS, value: "General Counsel" },
        { id: "rationale", label: "Why this is the right position", kind: "textarea", wide: true, value: "" },
        { id: "control", label: "Compensating control", kind: "textarea", wide: true, value: "" },
        { id: "review", label: "Review in", kind: "select", options: REVIEW_OPTIONS, value: "12 months" },
      ],
      doneTitle: "Recorded",
      doneNote: f.id + " recorded as a policy decision, awaiting sign-off.",
    });

  return (
    <PortalV2Shell eyebrow="Compliance" title="Open gaps">
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
          data-testid="pv2-cmpgaps-back"
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
            data-testid="pv2-cmpgaps-heading"
          >
            Open gaps
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>
            Every compliance gap the last scan found, each citing the obligation it touches. Expand one for the
            evidence behind it, or record a policy decision instead of a fix.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span
              data-testid="pv2-cmpgaps-count"
              style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}
            >
              Open Gaps · {openCount}
            </span>
            <span style={{ fontSize: "11px", color: "#475569" }}>
              Each one cites the obligation it touches. Expand for the evidence behind it.
            </span>
          </div>

          {liveRows && liveRows.length === 0 && (
            <div
              data-testid="pv2-cmpgaps-empty"
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
              No open compliance gaps from your last scan.
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
            data-testid="pv2-cmpgaps-rows"
          >
            {rows.map((f, i) => {
              const sev = cmpSevMeta(f.sev);
              const isExpanded = expanded === i;
              return (
                <div
                  key={f.id}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    borderTop: "1px solid rgba(30,41,59,.85)",
                  }}
                >
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `${sev.c}66` }} />
                  <button
                    onClick={() => setExpanded(isExpanded ? null : i)}
                    data-testid={`pv2-cmpgaps-row-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "14px 18px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <Chevron deg={isExpanded ? 180 : -90} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        <span
                          style={{
                            flex: "0 0 auto",
                            fontSize: "10.5px",
                            fontWeight: 700,
                            color: "#64748b",
                            letterSpacing: ".06em",
                            fontFamily: CMP_MONO,
                          }}
                        >
                          {f.id}
                        </span>
                        <span
                          style={{
                            flex: "0 0 auto",
                            padding: "2px 8px",
                            borderRadius: 4,
                            border: `1px solid ${sev.c}55`,
                            background: `${sev.c}14`,
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            color: sev.c,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sev.label}
                        </span>
                      </div>
                      <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4, textWrap: "pretty" }}>
                        {f.title}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#cbd5e1",
                          letterSpacing: ".01em",
                          fontFamily: CMP_MONO,
                        }}
                      >
                        {f.obligation}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: "0 18px 18px 44px", display: "flex", flexDirection: "column", gap: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          padding: "12px 14px",
                          border: "1px solid rgba(226,232,240,.14)",
                          borderRadius: 8,
                          background: "rgba(226,232,240,.04)",
                        }}
                      >
                        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
                          The obligation
                        </span>
                        <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
                          {f.obligationText}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
                          Why it matters here
                        </span>
                        <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}>{f.why}</span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid rgba(30,41,59,.9)" }}>
                        {f.evidence.map((e) => (
                          <div
                            key={e.k}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(130px,.85fr) minmax(0,2.15fr)",
                              gap: 14,
                              padding: "8px 0",
                              borderBottom: "1px solid rgba(30,41,59,.75)",
                              alignItems: "baseline",
                            }}
                          >
                            <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.4 }}>
                              {e.k}
                            </span>
                            <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{e.v}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                        <button
                          onClick={() => openFixPanel(f.fixKey)}
                          data-testid={`pv2-cmpgaps-fix-${f.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 11,
                            textAlign: "left",
                            padding: "11px 13px",
                            borderRadius: 9,
                            border: "1px solid rgba(0,120,212,.4)",
                            background: "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <span
                            style={{
                              flex: "0 0 28px",
                              width: 28,
                              height: 28,
                              borderRadius: 7,
                              border: "1px solid rgba(0,120,212,.4)",
                              background: "rgba(0,120,212,.14)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <WrenchIcon />
                          </span>
                          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#60a5fa", lineHeight: 1.4 }}>{f.fixLabel}</span>
                            <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45 }}>{f.fixSub}</span>
                          </span>
                        </button>
                        <button
                          onClick={() => recordDecision(f)}
                          data-testid={`pv2-cmpgaps-decide-${f.id}`}
                          style={{
                            alignSelf: "flex-start",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(226,232,240,.22)",
                            background: "rgba(226,232,240,.05)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>Record a policy decision instead</span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>Owner, rationale, review date</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) => askShaneBot(`Explain this finding to me before I approve the change: ${playbook.title}`)}
          onAcceptRisk={(playbook) => {
            closeFixPanel();
            openAcceptRisk({
              title: playbook.title,
              description: playbook.description,
              details:
                "Accepting instead of fixing suppresses this finding’s points in the pillar score and mutes its alerts, and puts it on the risk register with your name, a rationale and a review date. It stays visible as an accepted risk. No change request is raised because nothing changes in the tenant.",
              kicker: "Accept instead of fixing",
            });
          }}
        />
      )}
      {acceptRiskElement}
      {formElement}
      <PillarLiveSource testId="pv2-cmpgaps-source" live={live} />
    </PortalV2Shell>
  );
}
