/**
 * portal-v2-security-evidence.tsx — the three Security evidence drill-downs.
 *
 * A direct port of the prototype's `isEvidencePage` section
 * (`Customer Portal Shell.dc.html` 5041-5202), which renders whichever of the
 * three `EVIDENCE_PAGES` the current key selects. One page component serves all
 * three (OAuth / Legacy Auth / Email) because the prototype renders them from
 * one template keyed on `active`; the slug is taken from the URL's last segment
 * (`security-<slug>`), since each is its own literal route.
 *
 * This is the drill-down anatomy the handoff README describes: purpose →
 * sparkle/wrench stat cards → top-risks toggle → provenance queries ("How we
 * know this") → expandable evidence rows → a tenant-controls panel. The sparkle
 * asks ShaneBot and the wrench opens the CR gate — the two shared systems.
 *
 * Every inline style value is the prototype's; no house Card/Badge is used where
 * the numbers differ. Copy is verbatim.
 *
 * ── One deliberate reconstruction ──────────────────────────────────────────
 * The prototype's evidence stat-card builder (18589-18600) never assigns
 * `sparkBtnCss` / `sparkHtml` / `askGo`, so its sparkle button would render
 * unstyled and inert — a prototype gap, not a design decision. The README states
 * these cards carry a sparkle icon, and the sibling `isGovDetailV2` template
 * ships the intended styling; that styling and the Ask-ShaneBot wiring are
 * reproduced here.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";

import NotFound from "@/pages/not-found";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import {
  EV_MONO,
  securityOauthPageWithLive,
  type EvidencePage,
  type EvRow,
  type EvStatCard,
} from "@/components/portal-v2/secEvidenceData";
import { evSrc, evTone, evTopRisksCount, evidencePageFor } from "@/components/portal-v2/secEvidenceModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { useSecEvidenceOauthLive } from "@/components/portal-v2/useSecEvidenceOauthLive";

/* ── Icons ─────────────────────────────────────────────────────────────────── */

function WrenchIcon({ color = "#60a5fa", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  );
}

function Chevron({ deg, color = "#64748b", size = 14 }: { deg: number; color?: string; size?: number }) {
  return (
    <span style={{ flex: "0 0 auto", display: "flex", transform: `rotate(${deg}deg)`, transition: "transform 180ms" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

const SPARK_BTN: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 5,
  border: "1px solid rgba(0,180,216,.45)",
  background: "rgba(0,180,216,.1)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PortalV2SecurityEvidencePage() {
  const [location] = useLocation();
  const slug = location.split("/").filter(Boolean).pop();
  const fixturePage = evidencePageFor(slug);
  const isOauthPage = slug === "oauth";
  const { live: oauthLive } = useSecEvidenceOauthLive(isOauthPage);
  const page = fixturePage && isOauthPage ? securityOauthPageWithLive(fixturePage, oauthLive) : fixturePage;

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
  // `useLivePillarHero` seam; `pv2-ev-source` proves the page is on real data. The
  // per-evidence-type "top risks" list and provenance queries have no per-item
  // server producer, so those rows stay fixture — a documented backend gap.
  const live = useLivePillarHero("security");

  if (!page) return <NotFound />;

  return (
    <PortalV2Shell eyebrow="Security" title={page.heading}>
      <EvidenceBody page={page} onFix={openFixPanel} onAskShaneBot={askShaneBot} />

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
      <PillarLiveSource testId="pv2-ev-source" live={live} />
      {isOauthPage && (
        <PillarLiveSource
          testId="pv2-ev-oauth-stats-source"
          live={{ dataState: oauthLive.enterpriseAppCount != null || oauthLive.riskyPermissionGrantCount != null ? "live" : "fixture" }}
        />
      )}
    </PortalV2Shell>
  );
}

function EvidenceBody({
  page,
  onFix,
  onAskShaneBot,
}: {
  page: EvidencePage;
  onFix: (key: string) => void;
  onAskShaneBot: (topic: string) => void;
}) {
  const [topRisksOpen, setTopRisksOpen] = useState(false);
  const [queriesOpen, setQueriesOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div
      data-testid="pv2-ev-page"
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
        data-testid="pv2-ev-back"
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

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3, letterSpacing: "-.02em" }}
          data-testid="pv2-ev-heading"
        >
          {page.heading}
        </span>
        <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "76ch", textWrap: "pretty" }}>
          {page.desc}
        </span>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 10 }} data-testid="pv2-ev-stats">
        {page.statCards.map((s) => (
          <StatCard key={s.label} stat={s} onFix={onFix} onAskShaneBot={onAskShaneBot} />
        ))}
      </div>

      {/* ── "View Top Risks (n)" rule-and-label toggle ─────────────────── */}
      <button
        onClick={() => setTopRisksOpen((o) => !o)}
        data-testid="pv2-ev-top-risks-toggle"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
        <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#f87171" }}>
            View Top Risks ({evTopRisksCount(page)})
          </span>
          <Chevron deg={topRisksOpen ? 180 : 0} color="#f87171" size={11} />
        </span>
        <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
      </button>
      {topRisksOpen && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(248,113,113,.25)", borderRadius: 12, background: "rgba(248,113,113,.04)", overflow: "hidden" }}
          data-testid="pv2-ev-top-risks"
        >
          {page.topRisks.map((risk) => (
            <div key={risk} style={{ display: "flex", gap: 10, padding: "9px 18px", borderTop: "1px solid rgba(248,113,113,.15)", fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.55 }}>
              <span style={{ color: "#f87171", flex: "0 0 auto" }}>·</span>
              {risk}
            </div>
          ))}
        </div>
      )}

      {/* ── "How we know this" provenance queries ──────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.4)", overflow: "hidden" }} data-testid="pv2-ev-provenance">
        <button
          onClick={() => setQueriesOpen((o) => !o)}
          data-testid="pv2-ev-provenance-toggle"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
        >
          <Chevron deg={queriesOpen ? 180 : -90} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={SECTION_LABEL}>How we know this</span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>Every number on this page traces to one of these queries.</span>
          </span>
        </button>
        {queriesOpen && (
          <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{page.sourceNote}</span>
            {page.queries.map((q) => {
              const m = evSrc(q.src);
              return (
                <div key={q.url} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 8, background: "#0b1524" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        flex: "0 0 auto",
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: `1px solid ${m.c}55`,
                        background: `${m.c}14`,
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: m.c,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.label}
                    </span>
                    <span style={{ flex: "0 0 auto", fontSize: "10.5px", fontWeight: 700, color: m.c, fontFamily: EV_MONO }}>{q.method}</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.5, wordBreak: "break-all", fontFamily: EV_MONO }}>{q.url}</span>
                  <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>{q.note}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Evidence list ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <span style={SECTION_LABEL}>{page.listLabel}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }} data-testid="pv2-ev-rows">
          {page.rows.map((row, i) => (
            <EvidenceRow key={row.name} row={row} index={i} expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} onFix={onFix} />
          ))}
        </div>
      </div>

      {/* ── Secondary tenant-controls panel ────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 14, background: "rgba(15,23,42,.35)", overflow: "hidden" }} data-testid="pv2-ev-secondary">
        <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 3, background: "linear-gradient(160deg, rgba(139,92,246,.07), rgba(15,23,42,0))" }}>
          <span style={SECTION_LABEL}>{page.secondaryLabel}</span>
          <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{page.secondaryNote}</span>
        </div>
        {page.secondaryRows.map((sr) => {
          const c = evTone(sr.tone);
          return (
            <div key={sr.name} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderTop: "1px solid rgba(30,41,59,.8)" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{sr.name}</span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: `1px solid ${c}55`,
                      background: `${c}14`,
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: c,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sr.status}
                  </span>
                </div>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>{sr.detail}</span>
              </div>
              {sr.fixKey && (
                <button
                  onClick={() => onFix(sr.fixKey!)}
                  title="Fix via Microsoft Graph"
                  data-testid={`pv2-ev-secondary-fix-${sr.fixKey}`}
                  style={{
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
                  }}
                >
                  <WrenchIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ stat, onFix, onAskShaneBot }: { stat: EvStatCard; onFix: (key: string) => void; onAskShaneBot: (topic: string) => void }) {
  const c = evTone(stat.tone);
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${c}38`,
        background: `linear-gradient(160deg, ${c}12, rgba(15,23,42,.5))`,
      }}
      data-testid="pv2-ev-stat"
    >
      <div style={{ position: "absolute", right: -22, top: -26, width: 86, height: 86, borderRadius: "50%", background: `radial-gradient(circle, ${c}22, rgba(2,6,23,0) 70%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.3 }}>{stat.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
          <button style={SPARK_BTN} title="Ask ShaneBot about this" onClick={() => onAskShaneBot(`Explain this from my tenant: ${stat.label} is ${stat.value} (${stat.sub})`)}>
            <SparkIcon />
          </button>
          {stat.fixKey && (
            <button
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, border: `1px solid ${c}66`, background: `${c}14`, cursor: "pointer", fontFamily: "inherit" }}
              title="Fix via Microsoft Graph"
              data-testid={`pv2-ev-stat-fix-${stat.fixKey}`}
              onClick={() => onFix(stat.fixKey!)}
            >
              <WrenchIcon color={c} size={12} />
            </button>
          )}
        </div>
      </div>
      <span style={{ position: "relative", fontSize: "18px", fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", fontFamily: EV_MONO }}>{stat.value}</span>
      <span style={{ position: "relative", fontSize: "10px", color: "#64748b", lineHeight: 1.35 }}>{stat.sub}</span>
    </div>
  );
}

function EvidenceRow({ row, index, expanded, onToggle, onFix }: { row: EvRow; index: number; expanded: boolean; onToggle: () => void; onFix: (key: string) => void }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid rgba(30,41,59,.8)" }}>
      <button
        onClick={onToggle}
        data-testid={`pv2-ev-row-${index}`}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
      >
        <Chevron deg={expanded ? 180 : -90} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>{row.name}</span>
          <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>{row.context}</span>
        </div>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {row.chips.map((ch) => {
            const c = evTone(ch.tone);
            return (
              <span
                key={ch.label}
                style={{
                  flex: "0 0 auto",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: `1px solid ${c}55`,
                  background: `${c}14`,
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: c,
                  whiteSpace: "nowrap",
                }}
              >
                {ch.label}
              </span>
            );
          })}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "2px 18px 18px 44px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid rgba(30,41,59,.9)" }}>
            {row.facts.map((f) => (
              <div key={f.k} style={{ display: "grid", gridTemplateColumns: "minmax(120px,.8fr) minmax(0,2.2fr)", gap: 14, padding: "8px 0", borderBottom: "1px solid rgba(30,41,59,.75)", alignItems: "baseline" }}>
                <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.4 }}>{f.k}</span>
                <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55, wordBreak: "break-word", textWrap: "pretty" }}>{f.v}</span>
              </div>
            ))}
          </div>

          {row.groups.map((g) => (
            <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>{g.label}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {g.items.map((it) => (
                  <div key={it.primary} style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 11, borderLeft: "2px solid rgba(139,92,246,.35)" }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45, fontFamily: EV_MONO }}>{it.primary}</span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{it.secondary}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {row.actions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(30,41,59,.8)" }}>
              {row.actions.map((act) => (
                <button
                  key={act.fixKey}
                  onClick={() => onFix(act.fixKey)}
                  data-testid={`pv2-ev-action-${act.fixKey}`}
                  style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", padding: "11px 13px", borderRadius: 9, border: "1px solid rgba(0,120,212,.4)", background: "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <span style={{ flex: "0 0 28px", width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <WrenchIcon />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#60a5fa", lineHeight: 1.4 }}>{act.label}</span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45 }}>{act.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
