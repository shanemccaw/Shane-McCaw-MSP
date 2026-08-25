/**
 * portal-v2-security-ca.tsx — the Conditional Access baseline drill-down.
 *
 * A direct port of the prototype's `isCaPage` section
 * (`Customer Portal Shell.dc.html` 4975-5039), driven by `secCaModel`. The
 * wrench on any policy opens the shared FixPanel (the CR gate) on `ca-<id>`,
 * which is exactly the "build it via Graph, hand it to Shane, or follow the
 * exact clicks yourself" choice the page's own banner promises.
 *
 * Every inline style value is the prototype's; no house Card/Badge is used where
 * the numbers differ. Copy is verbatim — including the heading's "22 named"
 * against a fixture of 21 policies, which is the prototype's own wording.
 */

import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { CA_MONO } from "@/components/portal-v2/secCaData";
import { caBandsWithRows, caBandsWithRowsLive, caStatCards, caStatCardsLive } from "@/components/portal-v2/secCaModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { useCaBaselineLive } from "@/components/portal-v2/useCaBaselineLive";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";

function WrenchIcon({ color = "#60a5fa", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

const WRENCH_BTN: React.CSSProperties = {
  flex: "0 0 30px",
  width: 30,
  height: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 7,
  border: "1px solid rgba(0,120,212,.4)",
  background: "rgba(0,120,212,.12)",
  cursor: "pointer",
  fontFamily: "inherit",
};

export default function PortalV2SecurityCaPage() {
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();

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

  // Reads the security pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-ca-source` proves the hero score is on real data.
  const live = useLivePillarHero("security");

  // The per-policy band rows: real per-policy Conditional Access status, read
  // via `useCaBaselineLive` (identity:ca-policy-count / license:sku-utilization
  // item-detail rows, #1232). Falls back to the design fixture only until the
  // first response lands or when the tenant genuinely has no collected rows.
  const caLive = useCaBaselineLive();
  const rowsAreLive = caLive.loaded && caLive.policies !== null;
  const bands = rowsAreLive ? caBandsWithRowsLive(caLive.policies!, caLive.hasEntraP2) : caBandsWithRows();
  const stats = rowsAreLive ? caStatCardsLive(bands) : caStatCards();

  return (
    <PortalV2Shell eyebrow="Security" title="Conditional Access Baseline">
      <div
        data-testid="pv2-ca-page"
        style={{
          position: "relative",
          maxWidth: 1060,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/portal-v2/security"
          data-testid="pv2-ca-back"
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
          ← Security
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>
            Conditional Access Baseline
          </span>
          <span
            style={{ fontSize: "21px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3, letterSpacing: "-.02em" }}
            data-testid="pv2-ca-heading"
          >
            Every scan checks your tenant against 22 named Conditional Access policies.
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "74ch", textWrap: "pretty" }}>
            The naming convention is [Prefix] - [Persona] - [Target Resource] - [Control], so a policy's scope is
            readable from its name alone. Anything missing or drifted can be built for you through the Microsoft Graph
            API — created in report-only mode, with both break-glass accounts excluded.
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }} data-testid="pv2-ca-stats">
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                borderRadius: 10,
                border: `1px solid ${s.c}38`,
                background: `linear-gradient(160deg, ${s.c}12, rgba(15,23,42,.5))`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: -24,
                  top: -28,
                  width: 90,
                  height: 90,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${s.c}22, rgba(2,6,23,0) 70%)`,
                  pointerEvents: "none",
                }}
              />
              <span style={{ position: "relative", fontSize: "9.5px", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b" }}>
                {s.label}
              </span>
              <span style={{ position: "relative", fontSize: "22px", fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", fontFamily: CA_MONO }}>
                {s.value}
              </span>
              <span style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}>{s.sub}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "13px 16px",
            border: "1px solid rgba(0,120,212,.35)",
            borderRadius: 12,
            background: "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.35))",
          }}
        >
          <span
            style={{
              flex: "0 0 30px",
              width: 30,
              height: 30,
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
          <span style={{ flex: 1, minWidth: 200, fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.5 }}>
            The wrench on any policy below opens the same three choices: build it via Graph, hand it to Shane, or follow
            the exact clicks yourself.
          </span>
        </div>

        {bands.map((band) => (
          <div
            key={band.range}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 14,
              background: "rgba(15,23,42,.35)",
              overflow: "hidden",
            }}
            data-testid={`pv2-ca-band-${band.range}`}
          >
            <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 3, background: "linear-gradient(160deg, rgba(139,92,246,.07), rgba(15,23,42,0))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: "#a78bfa", fontFamily: CA_MONO }}>{band.range}</span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9" }}>{band.label}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b" }}>{band.count} policies</span>
              </div>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{band.desc}</span>
            </div>

            {band.rows.map((cr) => (
              <div
                key={cr.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  padding: "12px 14px",
                  borderTop: "1px solid rgba(30,41,59,.8)",
                  background: cr.actionable ? "transparent" : "rgba(52,211,153,.03)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: cr.actionable ? "#e2e8f0" : "#94a3b8", letterSpacing: "-.01em", lineHeight: 1.4, fontFamily: CA_MONO }}>
                        {cr.id}
                      </span>
                      <span
                        style={{
                          flex: "0 0 auto",
                          padding: "3px 8px",
                          borderRadius: 4,
                          border: `1px solid ${cr.statusColor}55`,
                          background: `${cr.statusColor}14`,
                          fontSize: "9.5px",
                          fontWeight: 700,
                          letterSpacing: ".07em",
                          textTransform: "uppercase",
                          color: cr.statusColor,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cr.statusLabel}
                      </span>
                      {cr.showP2 && (
                        <span
                          style={{
                            flex: "0 0 auto",
                            padding: "3px 8px",
                            borderRadius: 4,
                            border: "1px solid rgba(96,165,250,.4)",
                            background: "rgba(96,165,250,.1)",
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".07em",
                            textTransform: "uppercase",
                            color: "#60a5fa",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Entra ID P2
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.55 }}>{cr.purpose}</span>
                    <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}>{cr.note}</span>
                  </div>
                  {cr.actionable && (
                    <button
                      onClick={() => openFixPanel(cr.fixKey)}
                      title="Build this policy via Microsoft Graph"
                      data-testid={`pv2-ca-fix-${cr.id}`}
                      style={WRENCH_BTN}
                    >
                      <WrenchIcon />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
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
      <PillarLiveSource testId="pv2-ca-source" live={live} />
      <span data-testid="pv2-ca-rows-source" style={PV2_SOURCE_CLIP}>
        {rowsAreLive ? "live" : "fixture"}
      </span>
    </PortalV2Shell>
  );
}
