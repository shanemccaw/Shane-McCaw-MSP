/**
 * portal-v2-remediation.tsx — Operate → Remediation Tracker.
 *
 * A direct port of the prototype's `isRemediation` block
 * ('Customer Portal Shell.dc.html' 5961-6012) and its `rtRun` derivation
 * (20380-20441), transcribed into remediationModel.ts.
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * The prototype's own comment (20381) names it: "Not a project plan and not a
 * quote — a run-down of what has been fixed and what has not." So there is no
 * price here (that lives on the separate copilot-readiness surface), only a
 * progress bar, four state counters that double as filters, and every finding
 * grouped under its pillar with the state it is in and who closes it.
 *
 * ── STATUS vs VERIFICATION ─────────────────────────────────────────────────
 * A step reads "Verified" only when a REAL SCAN has verified it. That value can
 * now only arrive one way — `verificationState` on the customer's own tracker
 * row, set exclusively by `reverifyRemediationTrackerSteps()` running inside a
 * scan — and the fixture no longer carries a `verified` (or `done`) field for
 * anything to read instead. This page never derives verified from UI state, a
 * tick, or a filter. See remediationLive.ts / remediationModel.ts.
 *
 * ── WHAT IS REAL, AND WHAT IS STILL FIXTURE ────────────────────────────────
 * REAL, per customer, off `GET /api/portal/remediation-tracker` via
 * `useRemediationTracker`: every step's status, every step's verification, and
 * therefore the progress bar, the headline count, all four counters, the row
 * state badges, the CR badges and the "We run it" routing of a step handed to
 * Shane.
 *
 * STILL FIXTURE (remediationData.ts): the finding catalogue itself — titles,
 * scan evidence, severity, pillar and the RACI owner chips. The platform holds
 * no per-customer source for those yet.
 *
 * ── UI-only bits that remain ───────────────────────────────────────────────
 * The counter filter is local UI state. The row is not clickable (the
 * prototype's markup wires no row handler); the only interactions are the CR
 * badge — which deep-links into Change Control — and the owner chip, which
 * carries its name on a native tooltip (the prototype's pinned RACI popover is
 * shell state a page must not touch).
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";

import { useRemediationTracker } from "@/components/copilot-journey/useRemediationTracker";
import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import type { RtLiveState } from "@/components/portal-v2/remediationLive";
import {
  rtCounters,
  rtGroups,
  rtProgress,
  type RtRow,
  type RtStateKey,
} from "@/components/portal-v2/remediationModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

export default function PortalV2RemediationPage() {
  /** `rtFilter` — which state the list is filtered to, or null for all. */
  const [filter, setFilter] = useState<RtStateKey | null>(null);
  const [, navigate] = useLocation();

  // The customer's own tracker rows — the same store the Full Remediation Guide
  // reads and writes, so a step ticked there is already ticked here.
  const tracker = useRemediationTracker();
  const live: RtLiveState = useMemo(
    () => ({ statuses: tracker.statuses, verification: tracker.verification }),
    [tracker.statuses, tracker.verification],
  );

  const progress = rtProgress(live);
  const counters = rtCounters(filter, live);
  const groups = rtGroups(filter, live);

  const toggleFilter = (state: RtStateKey) => setFilter((f) => (f === state ? null : state));

  return (
    <PortalV2Shell eyebrow="Operate" title="Remediation Tracker">
      {/*
        Load state rides as data attributes rather than new copy: the design
        specifies no loading or error slot on this page, and inventing one would
        be a layout change. Before the payload lands every step reads "not
        started" — understating, never over-claiming — and a failed read is
        already beaconed by the hook (RemediationTrackerLoadFailed).
      */}
      <div
        style={{ minHeight: "100%", background: SIDEBAR_WASH }}
        data-testid="pv2-rt-root"
        data-rt-loaded={tracker.loaded ? "true" : "false"}
        data-rt-error={tracker.error ? "true" : "false"}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 28px 60px",
            display: "flex",
            flexDirection: "column",
            gap: 17,
          }}
        >
          {/* ── Header — proto 5964-5968 ─────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Remediation
            </span>
            <span
              data-testid="pv2-rt-heading"
              style={{
                fontSize: "22px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-.02em",
                lineHeight: 1.3,
              }}
            >
              {progress.headline}
            </span>
            <span
              data-testid="pv2-rt-sub"
              style={{
                fontSize: "12.5px",
                color: "#94a3b8",
                lineHeight: 1.6,
                maxWidth: "86ch",
                textWrap: "pretty",
              }}
            >
              {progress.sub}
            </span>
          </div>

          {/* ── Progress bar — proto 5970-5974 ───────────────────────────── */}
          <div
            style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}
            data-testid="pv2-rt-progress"
          >
            <div
              style={{
                flex: 1,
                minWidth: 220,
                height: 10,
                borderRadius: 5,
                background: "rgba(148,163,184,.14)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 5,
                  width: `${progress.pct}%`,
                  background: "linear-gradient(90deg,#34d399,#5eead4)",
                  transition: "width 500ms",
                }}
              />
            </div>
            <span
              style={{
                flex: "0 0 auto",
                fontSize: "13px",
                fontWeight: 800,
                color: "#34d399",
                fontFamily: MONO,
              }}
            >
              {progress.pct}%
            </span>
            <span
              style={{ flex: "0 0 auto", fontSize: "11px", color: "#64748b", fontFamily: MONO }}
            >
              {progress.done} / {progress.total}
            </span>
          </div>

          {/* ── State counters — proto 5976-5984. Each is a filter. ──────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
              gap: 10,
            }}
            data-testid="pv2-rt-counters"
          >
            {counters.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleFilter(c.key)}
                data-testid={`pv2-rt-counter-${c.key}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  padding: "13px 15px",
                  borderRadius: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                  border: `1px solid ${c.tone}${c.active ? "99" : "2b"}`,
                  background: `linear-gradient(160deg,${c.tone}${c.active ? "1f" : "0d"},rgba(15,23,42,.45))`,
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 800,
                    letterSpacing: ".11em",
                    textTransform: "uppercase",
                    color: c.tone,
                  }}
                >
                  {c.label}
                </span>
                <span
                  style={{
                    fontSize: "22px",
                    fontWeight: 800,
                    letterSpacing: "-.02em",
                    color: "#f8fafc",
                    fontFamily: MONO,
                  }}
                >
                  {c.value}
                </span>
                <span style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.35 }}>{c.sub}</span>
              </button>
            ))}
          </div>

          {/* ── Grouped findings — proto 5986-6009 ───────────────────────── */}
          {groups.map((g) => (
            <div
              key={g.key}
              data-testid={`pv2-rt-group-${g.key}`}
              style={{ display: "flex", flexDirection: "column", gap: 7 }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  {g.label}
                </span>
                <span style={{ fontSize: "9.5px", color: "#3f4c5f", fontFamily: MONO }}>{g.n}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.85)",
                  borderRadius: 11,
                  background: "rgba(15,23,42,.4)",
                  overflow: "hidden",
                }}
              >
                {g.items.map((t) => (
                  <RemediationRow
                    key={t.id}
                    t={t}
                    onOpenCr={() => navigate("/portal-v2/change-control")}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PortalV2Shell>
  );
}

function RemediationRow({ t, onOpenCr }: { t: RtRow; onOpenCr: () => void }) {
  return (
    <div
      data-testid={`pv2-rt-row-${t.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "10px 14px",
        borderLeft: `2px solid ${t.state.tone}`,
        borderTop: "1px solid rgba(30,41,59,.75)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          padding: "2px 8px",
          borderRadius: 5,
          border: `1px solid ${t.state.tone}55`,
          background: `${t.state.tone}14`,
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: t.state.tone,
          whiteSpace: "nowrap",
        }}
      >
        {t.state.label}
      </span>
      <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: "12.5px",
            fontWeight: 600,
            color: "#e2e8f0",
            lineHeight: 1.4,
            textWrap: "pretty",
          }}
        >
          {t.title}
        </span>
        <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.4 }}>
          Found by the scan · {t.ev}
        </span>
      </div>
      <span
        style={{
          flex: "0 0 auto",
          padding: "2px 8px",
          borderRadius: 5,
          border: `1px solid ${t.route.tone}3d`,
          background: "transparent",
          fontSize: "9px",
          fontWeight: 700,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: t.route.tone,
          whiteSpace: "nowrap",
        }}
      >
        {t.route.label}
      </span>
      {t.cr && (
        <button
          onClick={onOpenCr}
          data-testid={`pv2-rt-cr-${t.id}`}
          style={{
            flex: "0 0 auto",
            padding: "2px 8px",
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
          {t.cr}
        </button>
      )}
      <span
        title={t.owner.name}
        data-testid={`pv2-rt-owner-${t.id}`}
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: "50%",
          fontSize: "8.5px",
          fontWeight: 800,
          letterSpacing: ".02em",
          color: "#0b1524",
          background: t.owner.tone,
          border: "1px solid transparent",
        }}
      >
        {t.owner.init}
      </span>
    </div>
  );
}
