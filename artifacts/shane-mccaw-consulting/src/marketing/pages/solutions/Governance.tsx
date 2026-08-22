import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowIcon } from "./_shared";

// Route /solutions/governance — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - Governance.dc.html. Unlike the other six
// deep-dives, this page is bespoke and interactive: the centre "From read-only connection to
// accountable baseline" panel is a five-stage animation the design drives with a DCLogic state
// machine (auto-advance, hover-pause, click-to-pin, prefers-reduced-motion). That state machine is
// ported here to React hooks; all copy, colours and geometry are the design's own.

// ── Shared bits ──────────────────────────────────────────────────────────────────────────────────
const GRADIENT = "linear-gradient(90deg,#60a5fa,#a78bfa)";

function GradientText({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: GRADIENT,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      {children}
    </span>
  );
}

type IconName = "refreshcw" | "clipboardlist" | "key" | "layers" | "check";
function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    refreshcw: (
      <>
        <path d="M21 8a9 9 0 00-15-4.7L3 6" />
        <path d="M3 3v5h5" />
        <path d="M3 16a9 9 0 0015 4.7L21 18" />
        <path d="M21 21v-5h-5" />
      </>
    ),
    clipboardlist: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="12" y2="17" />
      </>
    ),
    key: (
      <>
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="M10.9 12.1L20 3" />
        <path d="M17 6l3 3" />
        <path d="M14 9l2.5 2.5" />
      </>
    ),
    layers: (
      <>
        <polygon points="12 3 21 8 12 13 3 8" />
        <polyline points="3 13 12 18 21 13" />
        <polyline points="3 18 12 23 21 18" />
      </>
    ),
    check: <polyline points="20 6 9 17 4 12" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function tone(v: number): string {
  return v >= 85 ? "#34d399" : v >= 60 ? "#fbbf24" : "#f87171";
}

// Reproduces the design's ringStyle(value, radius, revealed): a dash-array that draws value% of the
// circle, only once "revealed".
function ringStyle(value: number, radius: number, revealed: boolean): React.CSSProperties {
  const circ = 2 * Math.PI * radius;
  const dash = revealed ? (Math.max(0, Math.min(100, value)) / 100) * circ : 0;
  return {
    strokeDasharray: `${dash.toFixed(2)} ${circ.toFixed(2)}`,
    strokeLinecap: dash > 0 ? "round" : "butt",
    transition: "stroke-dasharray 700ms ease-out",
  };
}

// ── Data (design DATA) ───────────────────────────────────────────────────────────────────────────
const STEPS = [
  {
    title: "Connect",
    description:
      "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
  },
  {
    title: "Scan",
    description:
      "The engine reads your real Teams and Group lifecycle state, naming convention compliance, admin role assignments, and current tenant configuration against your approved baseline.",
  },
  {
    title: "Findings",
    description:
      "Every lifecycle policy exception, naming violation, ownerless Group, and baseline deviation is logged as a real, inspectable finding on your next scheduled evaluation — not guaranteed the instant a change happens.",
  },
  {
    title: "Score",
    description:
      "Findings roll up into your real Governance pillar score inside the Architecture Health Engine.",
  },
  {
    title: "Remediate",
    description:
      "You get the specific fixes, ranked by which one closes the biggest exposure first — and the Drift Engine checks the same baseline again on your next scheduled evaluation.",
  },
];
const SCAN_ROWS: { icon: IconName; label: string; sublabel: string }[] = [
  {
    icon: "refreshcw",
    label: "Teams & Group lifecycle",
    sublabel: "Every Team and Microsoft 365 Group, creation to expiry, against your real policy",
  },
  {
    icon: "clipboardlist",
    label: "Naming & ownership",
    sublabel: "Naming convention exceptions and groups without a current accountable owner",
  },
  {
    icon: "key",
    label: "Admin role assignments",
    sublabel: "Who actually holds Global Admin and every other privileged role",
  },
  {
    icon: "layers",
    label: "Configuration baseline",
    sublabel: "Your live tenant configuration compared against the last approved state",
  },
];
const METRICS = [
  { label: "Orphaned Teams", count: 14 },
  { label: "Orphaned SharePoint Sites", count: 23 },
  { label: "Overdue Access Reviews", count: 6 },
];
const RING_VALUE = 49;
const REMEDIATED_VALUE = 85;
const PILLARS = [
  { label: "Governance", value: 49 },
  { label: "Compliance", value: 32 },
  { label: "Adoption", value: 88 },
  { label: "Copilot Readiness", value: 38 },
  { label: "Health", value: 79 },
  { label: "Licensing", value: 91 },
  { label: "Security", value: 58 },
];
const SCAN_IDX = 1;
const FINDINGS_IDX = 2;
const SCORE_IDX = 3;
const REMEDIATE_IDX = 4;
const STAGE_MS = 4200;
const SCAN_MS = 3400;

// ── The interactive five-stage panel ─────────────────────────────────────────────────────────────
// The left-hand ordered list of the five steps, paired with PanelBridge via HowItWorks's shared state.
function StageList({ active, select }: { active: number; select: (i: number, deliberate: boolean) => void }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
      {STEPS.map((s, i) => (
        <li
          key={s.title}
          onMouseEnter={() => select(i, false)}
          onClick={() => select(i, true)}
          style={{ position: "relative", display: "flex", gap: "12px", paddingBottom: "16px", cursor: "pointer" }}
        >
          {i < STEPS.length - 1 ? (
            <span
              style={{
                position: "absolute",
                left: "15px",
                top: "34px",
                bottom: 0,
                width: "1px",
                background: "linear-gradient(180deg,#3b82f6,rgba(255,255,255,.08))",
              }}
            />
          ) : null}
          <span
            style={{
              position: "relative",
              zIndex: 2,
              flexShrink: 0,
              width: "30px",
              height: "30px",
              borderRadius: "999px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 700,
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              transition: "transform 300ms,box-shadow 300ms",
              ...(active === i ? { transform: "scale(1.12)", boxShadow: "0 0 0 4px rgba(59,130,246,.28)" } : {}),
            }}
          >
            {i + 1}
          </span>
          <div style={{ paddingTop: "3px" }}>
            <p style={{ margin: "0 0 3px", fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{s.title}</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.6 }}>{s.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// The "From read-only connection to accountable baseline" section couples StageList + StagePanel to a
// single active index so hovering a step on the left drives the panel on the right.
function HowItWorks() {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [active, setActive] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [scanDone, setScanDone] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);

  const flags = useRef({ stopped, hovered, active });
  flags.current = { stopped, hovered, active };

  useEffect(() => {
    if (reduced) {
      setCardRevealed(true);
      return;
    }
    const tick = setInterval(() => {
      const f = flags.current;
      if (f.stopped || f.hovered) return;
      setActive((a) => (a + 1) % 5);
      setScanDone(0);
    }, STAGE_MS);
    const scan = setInterval(() => {
      if (flags.current.active !== SCAN_IDX) return;
      setScanDone((d) => Math.min(d + 1, SCAN_ROWS.length));
    }, SCAN_MS / SCAN_ROWS.length);
    const reveal = setTimeout(() => setCardRevealed(true), 350);
    return () => {
      clearInterval(tick);
      clearInterval(scan);
      clearTimeout(reveal);
    };
  }, [reduced]);

  const select = (i: number, deliberate: boolean) => {
    setActive(i);
    setScanDone(0);
    if (deliberate) setStopped(true);
  };

  return (
    <section style={{ padding: "0 32px 44px" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 18px", letterSpacing: "-.02em", textWrap: "pretty" }}>
          From read-only connection to accountable baseline — five steps, on a schedule you can see.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px", alignItems: "stretch" }}>
          <StageList active={active} select={select} />
          <PanelBridge
            active={active}
            stopped={stopped}
            hovered={hovered}
            scanDone={scanDone}
            cardRevealed={cardRevealed}
            reduced={reduced}
            setActive={setActive}
            setStopped={setStopped}
            setHovered={setHovered}
            setScanDone={setScanDone}
            select={select}
          />
        </div>
      </div>
    </section>
  );
}

// PanelBridge is StagePanel's markup driven by HowItWorks's shared state (so the left list and right
// panel stay in lockstep). It re-implements the panel body against the passed-in state.
function PanelBridge(props: {
  active: number;
  stopped: boolean;
  hovered: boolean;
  scanDone: number;
  cardRevealed: boolean;
  reduced: boolean;
  setActive: (fn: (a: number) => number) => void;
  setStopped: (fn: (s: boolean) => boolean) => void;
  setHovered: (v: boolean) => void;
  setScanDone: (fn: (d: number) => number) => void;
  select: (i: number, deliberate: boolean) => void;
}) {
  const { active, stopped, hovered, scanDone, reduced, setStopped, setHovered, select } = props;
  const animating = !reduced && !stopped && !hovered;
  const scanActive = active === SCAN_IDX;
  const shownDone = reduced ? SCAN_ROWS.length : scanDone;
  const scanComplete = shownDone >= SCAN_ROWS.length;
  const maxCount = Math.max(...METRICS.map((m) => m.count), 1);
  const findingsOn = active === FINDINGS_IDX;
  const connectIsActive = active === 0 && animating;

  const stageCss = (i: number): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    transition: "opacity 500ms,transform 500ms",
    ...(active === i
      ? { opacity: 1, transform: "translateY(0)" }
      : { opacity: 0, transform: "translateY(6px)", pointerEvents: "none" }),
  });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", padding: "18px", display: "flex", flexDirection: "column" }}
    >
      <span style={{ position: "absolute", top: "12px", right: "12px", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", padding: "3px 8px", borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.12)" }}>
        Illustrative Example
      </span>
      <h3 style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: ".12em", color: "#64748b", margin: "0 0 16px", paddingRight: "140px" }}>
        Step {active + 1} of 5 — {STEPS[active].title}
      </h3>
      <div style={{ position: "relative", flexGrow: 1, minHeight: "252px" }}>
        {/* Stage 0 — Connect */}
        <div style={stageCss(0)}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "7px", flexShrink: 0, width: "78px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="12" height="18" rx="1.5" />
                  <path d="M16 9h4v12H4" />
                </svg>
              </div>
              <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b", textAlign: "center", lineHeight: 1.3 }}>Your tenant</span>
            </div>
            <div style={{ position: "relative", flex: 1, height: "44px" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: "16px", height: "1px", opacity: 0.65, backgroundImage: "repeating-linear-gradient(90deg,#3b82f6 0 6px,transparent 6px 12px)", ...(connectIsActive ? { animation: "hiwDashMarch .9s linear infinite" } : {}) }} />
              <div style={{ position: "absolute", top: "13px", width: "6px", height: "6px", borderRadius: "999px", background: "#60a5fa", ...(connectIsActive ? { animation: "hiwTravelDot 1.8s ease-in-out infinite" } : { opacity: 0 }) }} />
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, textAlign: "center", fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b" }}>Microsoft Graph API</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "7px", flexShrink: 0, width: "78px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b", textAlign: "center", lineHeight: 1.3 }}>Read-only scan</span>
            </div>
          </div>
          <div style={{ margin: "22px auto 0", width: "fit-content", display: "flex", flexDirection: "column", gap: "9px" }}>
            {["Scoped connection", "Read-only", "No agent installed", "No standing credential left behind"].map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: "#34d399", flexShrink: 0, display: "flex" }}>
                  <Icon name="check" size={14} />
                </span>
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stage 1 — Scan */}
        <div style={stageCss(1)}>
          <div style={{ height: "6px", borderRadius: "999px", background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: "999px", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", width: scanActive || reduced ? "100%" : "0%", transition: scanActive && !reduced ? `width ${SCAN_MS}ms linear` : "none" }} />
          </div>
          <div style={{ marginTop: "9px", fontSize: "11px", color: "#94a3b8", minHeight: "16px" }}>
            {scanComplete ? "Scan complete — findings logged" : `Scanning ${SCAN_ROWS[shownDone] ? SCAN_ROWS[shownDone].label : ""}…`}
          </div>
          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "11px" }}>
            {SCAN_ROWS.map((s, i) => {
              const state = i < shownDone ? "done" : i === shownDone && scanActive && !reduced ? "scanning" : "queued";
              return (
                <div key={s.label} style={{ display: "flex", alignItems: "flex-start", gap: "10px", ...(state === "queued" ? { opacity: 0.5 } : {}) }}>
                  <span style={{ flexShrink: 0, marginTop: "2px", display: "flex", color: state === "done" ? "#34d399" : state === "scanning" ? "#60a5fa" : "#64748b", ...(state === "scanning" ? { animation: "hiwPulse 1.1s ease-in-out infinite" } : {}) }}>
                    <Icon name={state === "done" ? "check" : s.icon} size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11.5px", color: "#cbd5e1" }}>{s.label}</div>
                    <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.5, marginTop: "2px" }}>{s.sublabel}</div>
                  </div>
                  <span style={{ flexShrink: 0, marginTop: "2px", fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: state === "done" ? "#34d399" : "#64748b" }}>
                    {state === "done" ? "Done" : state === "scanning" ? "Scanning…" : "Queued"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stage 2 — Findings */}
        <div style={stageCss(2)}>
          <div style={{ fontSize: "9.5px", textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b", marginBottom: "14px" }}>Portal preview — Compliance & Governance</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
            {METRICS.map((m, i) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "10.5px", color: "#94a3b8", width: "118px", flexShrink: 0, lineHeight: 1.35 }}>{m.label}</span>
                <div style={{ flex: 1, height: "6px", borderRadius: "999px", background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: "999px", background: "#f59e0b", transition: "width 700ms", transitionDelay: `${i * 120}ms`, width: findingsOn || reduced ? `${(m.count / maxCount) * 100}%` : "0%" }} />
                </div>
                <span style={{ fontSize: "10.5px", width: "22px", textAlign: "right", fontWeight: 700, color: m.count > 0 ? "#fbbf24" : "#64748b" }}>{m.count}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#fbbf24", flexShrink: 0 }} />
            <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>
              <b style={{ color: "#fbbf24", fontWeight: 700 }}>43</b> findings logged on this scheduled evaluation — each one inspectable
            </span>
          </div>
        </div>

        {/* Stage 3 — Score */}
        <div style={stageCss(3)}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ position: "relative", width: "104px", height: "104px" }}>
              <svg width="104" height="104" style={{ display: "block" }}>
                <circle cx="52" cy="52" r="47" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
                <circle cx="52" cy="52" r="47" fill="none" stroke="#f87171" strokeWidth="9" transform="rotate(-90 52 52)" style={ringStyle(RING_VALUE, 47, active === SCORE_IDX || reduced)} />
              </svg>
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "#f87171" }}>49</span>
            </div>
            <div style={{ marginTop: "12px", fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Governance pillar</div>
            <div style={{ marginTop: "4px", fontSize: "10.5px", color: "#64748b" }}>Architecture Health Engine · Example data — not your real score</div>
          </div>
        </div>

        {/* Stage 4 — Remediate */}
        <div style={stageCss(4)}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <div style={{ position: "relative", width: "48px", height: "48px" }}>
                <svg width="48" height="48" style={{ display: "block" }}>
                  <circle cx="24" cy="24" r="21.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="24" cy="24" r="21.5" fill="none" stroke="#f87171" strokeWidth="5" transform="rotate(-90 24 24)" style={ringStyle(RING_VALUE, 21.5, active === REMEDIATE_IDX || reduced)} />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#f87171" }}>49</span>
              </div>
              <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b" }}>Before</span>
            </div>
            <span style={{ color: "#64748b", display: "flex", flexShrink: 0 }}>
              <ArrowIcon size={15} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <div style={{ position: "relative", width: "104px", height: "104px" }}>
                <svg width="104" height="104" style={{ display: "block" }}>
                  <circle cx="52" cy="52" r="47" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
                  <circle cx="52" cy="52" r="47" fill="none" stroke="#34d399" strokeWidth="9" transform="rotate(-90 52 52)" style={ringStyle(REMEDIATED_VALUE, 47, active === REMEDIATE_IDX || reduced)} />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "#34d399" }}>85</span>
              </div>
              <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b" }}>After remediation</span>
            </div>
          </div>
          <div style={{ marginTop: "18px", textAlign: "center" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Ranked fixes — biggest exposure closed first</div>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "5px" }}>Drift Engine checks the same baseline again on your next scheduled evaluation</div>
            <div style={{ fontSize: "10px", color: "#475569", marginTop: "4px" }}>Example data — not your real score</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "4px" }}>
        {STEPS.map((s, i) => (
          <button key={s.title} onClick={() => select(i, true)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1, minWidth: 0, background: "none", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            <span style={{ width: "21px", height: "21px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9.5px", fontWeight: 700, transition: "background 300ms", ...(active === i ? { color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" } : { color: "#94a3b8", background: "rgba(255,255,255,.08)" }) }}>
              {i + 1}
            </span>
            <span style={{ fontSize: "8.5px", textTransform: "uppercase", letterSpacing: ".05em", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 300ms", color: active === i ? "#f8fafc" : "#64748b" }}>
              {s.title}
            </span>
          </button>
        ))}
        <button onClick={() => setStopped((v) => !v)} title={stopped ? "Resume the step animation" : "Pause the step animation"} style={{ flexShrink: 0, width: "22px", height: "22px", borderRadius: "999px", background: "rgba(255,255,255,.08)", border: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", cursor: "pointer" }}>
          {stopped ? (
            <svg viewBox="0 0 24 24" width="11" height="11">
              <polygon points="7 4 20 12 7 20" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="11" height="11">
              <rect x="6" y="4" width="4" height="16" fill="currentColor" />
              <rect x="14" y="4" width="4" height="16" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// The portal-preview card (ring + 7 pillar rings) used in the "posture as a live score" section. Its
// rings reveal shortly after mount.
function PortalPreviewCard() {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ position: "relative", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", padding: "20px" }}>
      <span style={{ position: "absolute", top: "12px", right: "12px", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", padding: "3px 8px", borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.12)" }}>
        Illustrative Example
      </span>
      <h3 style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: ".12em", color: "#64748b", margin: "0 0 18px", paddingRight: "140px" }}>
        Portal preview — Compliance & Governance
      </h3>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ position: "relative", width: "92px", height: "92px", flexShrink: 0 }}>
          <svg width="92" height="92" style={{ display: "block" }}>
            <circle cx="46" cy="46" r="41.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
            <circle cx="46" cy="46" r="41.5" fill="none" stroke="#f87171" strokeWidth="9" transform="rotate(-90 46 46)" style={ringStyle(RING_VALUE, 41.5, revealed)} />
          </svg>
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "23px", fontWeight: 700, color: "#f87171" }}>49</span>
        </div>
        <div>
          <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Governance pillar</div>
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>Example data — not your real score</div>
        </div>
      </div>
      <div style={{ marginTop: "20px", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: ".09em", color: "#64748b", marginBottom: "11px" }}>
        Architecture Health Engine — all 7 pillars
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px 8px" }}>
        {PILLARS.map((p) => {
          const c = tone(p.value);
          return (
            <div key={p.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
              <div style={{ position: "relative", width: "44px", height: "44px" }}>
                <svg width="44" height="44" style={{ display: "block" }}>
                  <circle cx="22" cy="22" r="19.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="22" cy="22" r="19.5" fill="none" stroke={c} strokeWidth="5" transform="rotate(-90 22 22)" style={ringStyle(p.value, 19.5, revealed)} />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: c }}>
                  {p.value}
                </span>
              </div>
              <span style={{ fontSize: "9.5px", color: "#64748b", textAlign: "center", lineHeight: 1.25 }}>{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Small static building blocks ─────────────────────────────────────────────────────────────────
function CheckList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: "20px", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", display: "flex", flexDirection: "column", gap: "11px" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <span style={{ color: "#60a5fa", flexShrink: 0, marginTop: "2px", display: "flex" }}>
            <Icon name="check" size={14} />
          </span>
          <span style={{ color: "#94a3b8", lineHeight: 1.6, fontSize: "12.5px" }}>{it}</span>
        </li>
      ))}
    </ul>
  );
}

const SCAN_FLOW = [
  {
    n: "1",
    title: "Run the free scan",
    body: "A read-only Graph connection reads your real tenant. No questionnaire, no agent, no cost.",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 12 8 12 11 19 14 5 17 12 21 12" />
      </svg>
    ),
  },
  {
    n: "2",
    title: "Get a priced SOW",
    body: "The pricing engine turns what the scan found into a statement of work, priced phase by phase.",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    n: "3",
    title: "Select your scopes",
    body: "Set scope on the document itself. Defer a phase and the totals, timeline and readiness move with it.",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 17 9" />
        <path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
      </svg>
    ),
  },
  {
    n: "4",
    title: "Sign, pay, onboard",
    body: "Sign the scope you chose, pay, and your Portal opens with the work, findings and re-checks in it.",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
];

function FlowArrow() {
  return (
    <span style={{ flex: "none", display: "flex", alignItems: "center", color: "#334155", paddingTop: "14px" }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="12" x2="19" y2="12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────────
export default function SolutionGovernance() {
  return (
    <MarketingLayout current="solutions">
      <style>{`
        @keyframes hiwDashMarch{to{background-position:12px 0}}
        @keyframes hiwTravelDot{0%{left:0;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:100%;opacity:0}}
        @keyframes hiwPulse{0%,100%{opacity:1}50%{opacity:.35}}
      `}</style>

      {/* Hero */}
      <section style={{ textAlign: "center", padding: "44px 32px 32px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "6px 12px",
              borderRadius: "999px",
              background: "rgba(59,130,246,.1)",
              border: "1px solid rgba(59,130,246,.25)",
              color: "#60a5fa",
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              marginBottom: "16px",
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
            </svg>{" "}
            Governance
          </span>
          <h1 style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1.14, color: "#f8fafc", margin: "0 0 12px", textWrap: "pretty" }}>
            Sprawl doesn't announce itself. <GradientText>The cleanup invoice does.</GradientText>
          </h1>
          <p style={{ fontSize: "14.5px", color: "#94a3b8", maxWidth: "640px", margin: "0 auto 22px", lineHeight: 1.6 }}>
            Lifecycle policy, naming discipline, and admin role assignments enforced against a real approved
            baseline — checked on a real schedule, not assumed compliant because nobody complained.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginBottom: "26px" }}>
            <Link href="/scan" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "11px 20px", borderRadius: "10px", fontWeight: 700, fontSize: "13.5px", color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>
              Scan My Tenant · Free <ArrowIcon size={15} />
            </Link>
            <Link href="/solutions" style={{ padding: "11px 20px", borderRadius: "10px", fontWeight: 600, fontSize: "13.5px", color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)" }}>
              Browse All Projects
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "10px", maxWidth: "480px", margin: "0 auto" }}>
            {[
              { big: "Scored", small: "Governance pillar" },
              { big: "Verified", small: "Lifecycle policy" },
              { big: "Tracked", small: "Baseline drift" },
            ].map((s) => (
              <div key={s.big} style={{ padding: "11px 13px", background: "#0b1524", border: "1px solid rgba(30,41,59,.9)", borderRadius: "11px", textAlign: "left" }}>
                <div style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>{s.big}</div>
                <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>{s.small}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* A live read */}
      <section style={{ padding: "20px 32px 36px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#f8fafc", margin: "0 0 14px", letterSpacing: "-.02em", maxWidth: "720px", textWrap: "pretty" }}>
            A live read of the tenant you actually have — not the one your policy document describes.
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: "26px", alignItems: "start", marginBottom: "18px" }}>
            <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13.5px" }}>
              Governance runs a live, read-only Microsoft Graph API scan against your tenant's actual Teams and
              Microsoft 365 Group lifecycle state — every naming convention exception, every group without a
              current accountable owner, every admin role assignment, and your live configuration compared
              against your approved governance baseline. Baseline drift isn't watched in real time and it
              doesn't guarantee an alert the instant something changes — deviations are flagged on your next
              scheduled evaluation, a real cadence you can see, not an assumed constant watch.
            </p>
            <div style={{ position: "relative", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", padding: "18px" }}>
              <span style={{ position: "absolute", top: "12px", right: "12px", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", padding: "3px 8px", borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.12)" }}>
                Illustrative Example
              </span>
              <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: ".12em", color: "#64748b", margin: "0 0 14px", paddingRight: "140px" }}>
                Drift Engine — scheduled evaluations
              </div>
              <svg viewBox="0 0 400 150" style={{ width: "100%", height: "auto", display: "block" }}>
                <line x1="10" y1="132" x2="390" y2="132" stroke="rgba(255,255,255,0.06)" />
                <line x1="10" y1="76" x2="390" y2="76" stroke="rgba(255,255,255,0.06)" />
                <line x1="10" y1="20" x2="390" y2="20" stroke="rgba(255,255,255,0.06)" />
                <polyline points="18.0,100.9 90.8,90.5 163.6,90.5 236.4,69.8 309.2,59.4 382.0,38.7" fill="none" stroke="#60a5fa" strokeWidth="2" />
                <circle cx="18.0" cy="100.9" r="3" fill="#60a5fa" />
                <text x="18.0" y="91.9" textAnchor="middle" fontSize="9" fill="#94a3b8">3</text>
                <circle cx="90.8" cy="90.5" r="3" fill="#60a5fa" />
                <text x="90.8" y="81.5" textAnchor="middle" fontSize="9" fill="#94a3b8">4</text>
                <circle cx="163.6" cy="90.5" r="3" fill="#60a5fa" />
                <text x="163.6" y="81.5" textAnchor="middle" fontSize="9" fill="#94a3b8">4</text>
                <circle cx="236.4" cy="69.8" r="3" fill="#60a5fa" />
                <text x="236.4" y="60.8" textAnchor="middle" fontSize="9" fill="#94a3b8">6</text>
                <circle cx="309.2" cy="59.4" r="3" fill="#60a5fa" />
                <text x="309.2" y="50.4" textAnchor="middle" fontSize="9" fill="#94a3b8">7</text>
                <circle cx="382.0" cy="38.7" r="3" fill="#60a5fa" />
                <text x="382.0" y="29.7" textAnchor="middle" fontSize="9" fill="#94a3b8">9</text>
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                {["5 evals ago", "4 evals ago", "3 evals ago", "2 evals ago", "1 eval ago", "Latest"].map((t) => (
                  <span key={t} style={{ fontSize: "8.5px", color: "#64748b" }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: "9.5px", color: "#64748b", marginTop: "8px" }}>Open baseline deviations</div>
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#fbbf24", flexShrink: 0, marginTop: "5px" }} />
                <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>Drift Engine: trend rising since last scheduled evaluation</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px" }}>
            {[
              { icon: "refreshcw" as IconName, title: "Teams & Group lifecycle", body: "Every Team and Microsoft 365 Group, creation to expiry, against your real policy" },
              { icon: "clipboardlist" as IconName, title: "Naming & ownership", body: "Naming convention exceptions and groups without a current accountable owner" },
              { icon: "key" as IconName, title: "Admin role assignments", body: "Who actually holds Global Admin and every other privileged role" },
              { icon: "layers" as IconName, title: "Configuration baseline", body: "Your live tenant configuration compared against the last approved state" },
            ].map((c) => (
              <div key={c.title} style={{ borderRadius: "12px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", padding: "13px", display: "flex", alignItems: "flex-start", gap: "11px" }}>
                <span style={{ flexShrink: 0, width: "30px", height: "30px", borderRadius: "10px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa" }}>
                  <Icon name={c.icon} size={15} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: "#f8fafc", lineHeight: 1.35 }}>{c.title}</span>
                  <span style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.55 }}>{c.body}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NASA credibility band */}
      <section style={{ padding: "0 32px 36px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "24px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "16px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#f8fafc", margin: "0 0 11px", letterSpacing: "-.015em", lineHeight: 1.35, textWrap: "pretty" }}>
            Built by the <GradientText>current Lead Microsoft 365 Architect at NASA</GradientText> — practiced
            daily, not read about.
          </h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>
            I'm NASA's current Lead Microsoft 365 Architect, and I wrote the agency's M365 Copilot governance
            framework. The same lifecycle, naming, and admin-role discipline this page scans for is one I
            enforce inside NASA's own tenant every day — not a case study I read about. This platform doesn't
            score your tenant against NASA's specific frameworks — that's not what it's built to do — but the
            same governance discipline that keeps a tenant defensible at NASA's scale is what's engineered into
            this scan.
          </p>
        </div>
      </section>

      {/* Governance debt */}
      <section style={{ padding: "0 32px 40px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em", textWrap: "pretty" }}>
            Governance debt always gets paid. The only question is on whose schedule.
          </h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: "0 0 16px", fontSize: "13.5px" }}>
            Governance debt doesn't fail all at once — it fails the day someone asks who owns a Team, why a
            Global Admin role was granted three reorgs ago, or why a configuration change nobody approved has
            been sitting in production since last quarter. Each of those questions eventually stops being
            awkward and starts being expensive. These are the bills an ungoverned tenant eventually pays:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              {
                icon: (
                  <>
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
                    <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
                  </>
                ),
                tag: "SharePoint sites",
                body: "SharePoint sprawl that ends as a paid cleanup project — hundreds of orphaned sites nobody can safely delete, scoped in consultant-weeks, because the ownership answers left with the people who had them",
              },
              {
                icon: <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
                tag: "Teams naming",
                body: "Four Teams all named some variant of “Marketing” and no way to tell which one is real — misfiled documents, misrouted requests, and a manual rationalization effort that costs more every quarter it's deferred",
              },
              {
                icon: (
                  <>
                    <circle cx="9" cy="8" r="3.2" />
                    <path d="M2 19c0-3.5 3-6 7-6s7 2.5 7 6" />
                    <path d="M16 4.2a3.2 3.2 0 010 6.2" />
                    <path d="M18 13c2 .6 3.5 2.4 3.5 6" />
                  </>
                ),
                tag: "Microsoft 365 Groups",
                body: "Microsoft 365 Groups sprawl quietly filling the Global Address List — every dead and duplicate group another chance for a confidential message to reach the wrong audience, until someone budgets a project just to make the address book usable again",
              },
              {
                icon: (
                  <>
                    <circle cx="7.5" cy="15.5" r="4.5" />
                    <path d="M10.9 12.1L20 3" />
                    <path d="M17 6l3 3" />
                    <path d="M14 9l2.5 2.5" />
                  </>
                ),
                tag: "Admin roles",
                body: "An audit stalled for days at “who has Global Admin, and why” — billable hours burned reconstructing role assignments that were granted ad hoc across three reorgs and documented nowhere",
              },
            ].map((c) => (
              <div key={c.tag} style={{ borderRadius: "12px", border: "1px solid rgba(245,158,11,.2)", background: "rgba(245,158,11,.1)", padding: "13px", display: "flex", alignItems: "flex-start", gap: "11px" }}>
                <span style={{ color: "#fbbf24", flexShrink: 0, marginTop: "2px", display: "flex" }}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {c.icon}
                  </svg>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "9.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "rgba(251,191,36,.9)", marginBottom: "5px" }}>{c.tag}</span>
                  <span style={{ display: "block", color: "#cbd5e1", lineHeight: 1.6, fontSize: "13px" }}>{c.body}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — interactive */}
      <HowItWorks />

      {/* Posture as a live score */}
      <section style={{ padding: "0 32px 44px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 18px", letterSpacing: "-.02em", textWrap: "pretty" }}>
            Your governance posture as a live score — not a policy binder nobody reopens.
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px", alignItems: "start" }}>
            <CheckList
              items={[
                "Your real Governance pillar score, not a self-reported estimate",
                "A full lifecycle and naming compliance report — every Team and Group checked against your real policy, not a spreadsheet",
                "A current admin role roster — who actually holds Global Admin and every other privileged role, and why",
                "Baseline drift findings from your real scheduled evaluations, not a one-time audit",
                "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
              ]}
            />
            <PortalPreviewCard />
          </div>
        </div>
      </section>

      {/* Four real surfaces */}
      <section style={{ padding: "0 32px 44px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", letterSpacing: "-.02em", textWrap: "pretty" }}>
            Four real surfaces. One accountable baseline.
          </h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: "0 0 18px", fontSize: "13.5px" }}>
            Governance checks four real surfaces before sprawl and ad hoc admin changes become the norm:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px", alignItems: "start" }}>
            <CheckList
              items={[
                "Microsoft 365 Group and Teams lifecycle policy enforcement",
                "Naming convention and ownership requirement compliance",
                "Configuration baseline drift since the last approved state",
                "Admin role assignment sprawl (who actually has Global Admin, and why)",
              ]}
            />
            <div style={{ position: "relative", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", padding: "20px" }}>
              <span style={{ position: "absolute", top: "12px", right: "12px", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", padding: "3px 8px", borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.12)" }}>
                Illustrative Example
              </span>
              <div style={{ position: "relative", width: "100%", maxWidth: "300px", margin: "22px auto 0", aspectRatio: "1/1" }}>
                <svg viewBox="0 0 240 240" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
                  <polygon points="120.0,38.0 202.0,120.0 120.0,202.0 38.0,120.0" fill="none" stroke="rgba(255,255,255,0.08)" />
                  <polygon points="120.0,58.5 181.5,120.0 120.0,181.5 58.5,120.0" fill="none" stroke="rgba(255,255,255,0.08)" />
                  <polygon points="120.0,79.0 161.0,120.0 120.0,161.0 79.0,120.0" fill="none" stroke="rgba(255,255,255,0.08)" />
                  <polygon points="120.0,99.5 140.5,120.0 120.0,140.5 99.5,120.0" fill="none" stroke="rgba(255,255,255,0.08)" />
                  <line x1="120" y1="120" x2="120.0" y2="38.0" stroke="rgba(255,255,255,0.08)" />
                  <line x1="120" y1="120" x2="202.0" y2="120.0" stroke="rgba(255,255,255,0.08)" />
                  <line x1="120" y1="120" x2="120.0" y2="202.0" stroke="rgba(255,255,255,0.08)" />
                  <line x1="120" y1="120" x2="38.0" y2="120.0" stroke="rgba(255,255,255,0.08)" />
                  <polygon points="120.0,74.9 171.7,120.0 120.0,160.2 56.9,120.0" fill="#5B8DEF" fillOpacity="0.14" stroke="#5B8DEF" strokeWidth="2" />
                </svg>
                <span style={{ position: "absolute", left: "50.0%", top: "15.8%", transform: "translate(-50%,-140%)", fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap", lineHeight: 1.2, pointerEvents: "none" }}>
                  Lifecycle policy <b style={{ color: "#94a3b8", fontWeight: 700 }}>55</b>
                </span>
                <span style={{ position: "absolute", left: "84.2%", top: "50.0%", transform: "translate(4%,-50%)", fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap", lineHeight: 1.2, pointerEvents: "none" }}>
                  Naming compliance <b style={{ color: "#94a3b8", fontWeight: 700 }}>63</b>
                </span>
                <span style={{ position: "absolute", left: "50.0%", top: "84.2%", transform: "translate(-50%,40%)", fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap", lineHeight: 1.2, pointerEvents: "none" }}>
                  Baseline integrity <b style={{ color: "#94a3b8", fontWeight: 700 }}>49</b>
                </span>
                <span style={{ position: "absolute", left: "15.8%", top: "50.0%", transform: "translate(-104%,-50%)", fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap", lineHeight: 1.2, pointerEvents: "none" }}>
                  Admin role hygiene <b style={{ color: "#94a3b8", fontWeight: 700 }}>77</b>
                </span>
              </div>
              <p style={{ fontSize: "10.5px", color: "#64748b", textAlign: "center", margin: "18px 0 0", lineHeight: 1.55 }}>
                The four surfaces, scored in relation to each other — example data, not your tenant
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Projects We Can Scope */}
      <section style={{ padding: "0 32px 44px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 8px", letterSpacing: "-.02em" }}>
            Projects We Can Scope for You
          </h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: "0 0 20px", fontSize: "13.5px", maxWidth: "660px" }}>
            These aren't self-checkout — once the scan surfaces a real gap in this area, the pricing engine
            scopes and prices it as a SOW you can select line by line before you buy.
          </p>
          <div style={{ padding: "20px", borderRadius: "16px", border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <span style={{ flexShrink: 0, width: "38px", height: "38px", borderRadius: "10px", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8V6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1" />
                  <path d="M3 8h16.5l-2 10H5z" />
                </svg>
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "520px" }}>
                Governance projects are surfaced from your own scan findings and priced as a fixed-scope SOW you
                approve before any work starts.
              </span>
            </div>
            <Link href="/buy" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "7px", padding: "10px 18px", borderRadius: "10px", border: "1px solid rgba(148,163,184,.2)", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1" }}>
              See how your SOW is priced <ArrowIcon size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section style={{ padding: "0 32px 44px", textAlign: "center" }}>
        <div style={{ maxWidth: "660px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "24px", fontWeight: 800, color: "#f8fafc", margin: "0 0 12px", letterSpacing: "-.02em", textWrap: "pretty" }}>
            Your governance baseline is either enforced, or assumed. <GradientText>Find out which — free.</GradientText>
          </h2>
          <p style={{ color: "#94a3b8", margin: "0 0 20px", lineHeight: 1.7, fontSize: "13.5px" }}>
            Run the free scan and get your real Governance pillar score — scanned, not guessed — then let the
            pricing engine turn the findings into a scoped, priced SOW.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/scan" style={{ padding: "11px 20px", borderRadius: "10px", fontWeight: 700, fontSize: "13.5px", color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>
              Scan My Tenant · Free
            </Link>
            <Link href="/solutions" style={{ padding: "11px 20px", borderRadius: "10px", fontWeight: 600, fontSize: "13.5px", color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)" }}>
              Browse Projects
            </Link>
          </div>
        </div>
      </section>

      {/* From Scan to Scoped Work (Governance's bespoke four-card variant) */}
      <section style={{ padding: "32px 32px 56px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto 26px", textAlign: "center" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em" }}>
            From Scan to Scoped Work
          </h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>
            Four steps, one continuous path. The free scan reads your actual tenant. The pricing engine turns
            those findings into a scoped, priced SOW — not a generic quote. You pick which scopes to buy and
            which to defer. Once you approve, your Portal opens with the work in it.
          </p>
        </div>
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", alignItems: "stretch", justifyContent: "center", gap: "6px", flexWrap: "wrap" }}>
          {SCAN_FLOW.map((s, i) => {
            const hot = i === 0;
            return (
              <React.Fragment key={s.n}>
                <div style={{ flex: "1 1 150px", maxWidth: "224px", minWidth: 0, display: "flex", flexDirection: "column", gap: "9px", padding: "15px 14px", borderRadius: "14px", border: `1px solid ${hot ? "rgba(59,130,246,.32)" : "rgba(30,41,59,.9)"}`, background: hot ? "rgba(59,130,246,.06)" : "#0b1524" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: "24px",
                        height: "24px",
                        borderRadius: "999px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 700,
                        ...(hot
                          ? { color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }
                          : { color: "#60a5fa", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)" }),
                      }}
                    >
                      {s.n}
                    </span>
                    <span style={{ color: "#60a5fa", display: "flex" }}>{s.icon}</span>
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc", lineHeight: 1.35 }}>{s.title}</span>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>{s.body}</span>
                </div>
                {i < SCAN_FLOW.length - 1 ? <FlowArrow /> : null}
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ maxWidth: "1000px", margin: "22px auto 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px" }}>
          <Link href="/scan" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "12px 24px", borderRadius: "11px", fontSize: "14px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>
            Scan My Tenant · Free <ArrowIcon size={15} />
          </Link>
          <span style={{ fontSize: "11px", color: "#475569", textAlign: "center" }}>
            Read-only. No card, no agent, no sales call scheduled.
          </span>
        </div>
      </section>
    </MarketingLayout>
  );
}
