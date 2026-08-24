/**
 * AlertsTrayContent.tsx — the rows inside the alerts tray, drawn to the
 * prototype markup (Customer Portal Shell.dc.html 293-325) and the
 * `holdAlertItems` / `alertItems` derivations (8716-8754).
 *
 * README §"Hold windows (runbook timers)": a window is reported in three places
 * from one source, one of which is "a Hold windows section in the alerts tray
 * that lists only windows needing a decision." That section is `HOLD_ALERT_ITEMS`
 * (state ≠ running) — the runbook-timer fixture, unchanged here.
 *
 * The "Smart alerts" section below it is REAL: `alertItems` is
 * `urgentToAlertItems(view.urgent)` from portalV2Model.ts — the same
 * `war-room-pillars` findings ranking the tray header already promises
 * ("Same ranking as Most Urgent"). PortalV2Shell owns the fetch and passes
 * the derived rows down; this component only renders them.
 *
 * The prototype's wrench opens the fix panel and the hold button releases a
 * gated step — both live on pages this part must not touch — so each row
 * deep-links to the owning page instead (Most Urgent lives on the pillar page;
 * hold decisions live on Active Runbooks). The tray's "Smart alerts" header is
 * drawn by the shell; this component renders the sections beneath it.
 */

import { Wrench } from "lucide-react";

import { PILLARS } from "@/components/copilot-journey/journeyTokens";
import type { PillarKey } from "@/components/copilot-journey/journeyTokens";
import type { SmartAlertItem } from "@/components/portal-v2/portalV2Model";

import { HOLD_ALERT_ITEMS } from "./holdAlerts";

/** The three alert rows scale down after the first — prototype `alertScale`. */
const ALERT_SCALE = [
  { pad: "16px", title: 14.5, why: 12, gap: 4 },
  { pad: "13px 16px", title: 13, why: 11.5, gap: 3 },
  { pad: "13px 16px", title: 13, why: 11.5, gap: 3 },
] as const;

export function AlertsTrayContent({
  onNavigate,
  alertItems,
  alertsLoaded,
}: {
  onNavigate: (href: string) => void;
  /** The real Smart alerts rows — `urgentToAlertItems(view.urgent)`. */
  alertItems: readonly SmartAlertItem[];
  /** True once the first real `war-room-pillars` payload has arrived. */
  alertsLoaded: boolean;
}) {
  return (
    <>
      {/* Hold windows section — only windows needing a decision. */}
      {HOLD_ALERT_ITEMS.length > 0 && (
        <div
          style={{
            padding: "10px 16px 8px",
            borderTop: "1px solid rgba(30,41,59,.9)",
            background: "rgba(15,23,42,.5)",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
            Hold windows
          </span>
          <span style={{ fontSize: "11px", color: "#475569" }}>Runbook timers that need a decision</span>
        </div>
      )}
      {HOLD_ALERT_ITEMS.map((h) => (
        <div
          key={h.id}
          data-testid="pv2-alert-hold-row"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "13px 16px",
            borderTop: "1px solid rgba(30,41,59,.9)",
            background: `linear-gradient(90deg,${h.tone}12,rgba(2,6,23,0) 65%)`,
          }}
        >
          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `${h.tone}aa` }} />
          <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: h.tone }}>
              {h.t}
            </span>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#f1f5f9", lineHeight: 1.4 }}>{h.title}</div>
            <div style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.45 }}>{h.why}</div>
          </div>
          <button
            onClick={() => onNavigate(h.href)}
            style={{
              flex: "0 0 auto",
              alignSelf: "center",
              padding: "6px 11px",
              borderRadius: 6,
              border: `1px solid ${h.tone}66`,
              background: `${h.tone}1f`,
              color: "#e2e8f0",
              fontSize: "10.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {h.btnLabel}
          </button>
        </div>
      ))}

      {/* Smart alerts — Most Urgent ranking, pillar coded, sized by impact. */}
      {alertsLoaded && alertItems.length === 0 && (
        <div
          data-testid="pv2-alert-empty"
          style={{
            padding: "14px 16px",
            borderTop: "1px solid rgba(30,41,59,.9)",
            fontSize: "12px",
            color: "#64748b",
          }}
        >
          No critical or warning findings for your tenant right now.
        </div>
      )}
      {alertItems.map((al, i) => {
        const c = PILLARS[al.pillarKey as PillarKey]?.accent ?? "#60a5fa";
        const s = ALERT_SCALE[Math.min(i, ALERT_SCALE.length - 1)];
        return (
          <div
            key={`${al.pillarKey}-${i}`}
            data-testid="pv2-alert-row"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: s.pad,
              borderTop: "1px solid rgba(30,41,59,.9)",
              background: `linear-gradient(90deg, ${c}0f, rgba(2,6,23,0) 65%)`,
            }}
          >
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `${c}80` }} />
            <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: s.gap }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: c }}>
                {al.pillarLabel}
              </span>
              <div style={{ fontSize: `${s.title}px`, fontWeight: al.top ? 700 : 600, color: "#f1f5f9", lineHeight: 1.35 }}>
                {al.title}
              </div>
              <div style={{ fontSize: `${s.why}px`, color: "#64748b", lineHeight: 1.4 }}>{al.why}</div>
            </div>
            <button
              onClick={() => onNavigate(al.href)}
              title="Open the fix options"
              style={{
                flex: "0 0 30px",
                alignSelf: "center",
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
              <Wrench size={14} color="#60a5fa" />
            </button>
          </div>
        );
      })}
    </>
  );
}
