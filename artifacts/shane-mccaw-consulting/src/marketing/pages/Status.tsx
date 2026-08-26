import { useEffect, useRef, useState } from "react";
import { MarketingLayout } from "../components/MarketingLayout";
import {
  Monitor,
  Lock,
  Search,
  Bell,
  Mail,
  PenLine,
  Activity,
  Check,
  ChevronDown,
  AlertTriangle,
  Clock,
} from "lucide-react";

// Service Status — /status. Recreated from Design/access-pages-export/Marketing Service Status.dc.html
// in the app's real Nav/Footer shell (MarketingLayout). Green Health-pillar accent, activity watermark.
//
// HONESTY over the design's placeholder data (Git #1350): every number on this page comes from the real
// /api/status endpoint (public-status.ts) or is honestly marked "not yet recorded". The design's fixed
// EVENTS / SLA_ROWS actuals / MS_WORKLOADS / scheduled-maintenance / subscribe were placeholder fixtures.
//   - REAL & wired: overall platform state, incident history (platform_incidents), and Microsoft 365
//     rolling-90-day uptime (m365_service_health_samples via sla-uptime.ts, exposed on /api/status).
//   - HONEST no-data (no real source found this session, per #1350's audit — do NOT fabricate):
//       * per-component 90-day daily bars: no daily-rollup source + no defined per-component SLO
//         thresholds to classify a day up/degraded/down — shown as a planned follow-up, not fake bars.
//       * "Our SLA, measured" actuals: no confirmed measured availability series yet — targets are the
//         real published commitments, actuals read "Not yet measured".
//       * scheduled maintenance: no maintenance table exists — honest "none scheduled".
//   - OMITTED: the email subscribe box (no real subscribe backend, and platform email is Graph-only).
// Page renders/refreshes independently of the portal (it only reads the api-server's public endpoint).

interface PlatformIncident {
  id: number;
  title: string;
  description: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  startedAt: string;
  resolvedAt: string | null;
}

type M365ServiceStatus = "healthy" | "degraded" | "interruption";

type M365HealthSection =
  | { available: true; services: { service: string; status: M365ServiceStatus }[] }
  | { available: false; reason: string };

type M365UptimeSection =
  | {
      available: true;
      target: number;
      services: { service: string; uptimePercent: number | null; breached: boolean; coverage: number; sampleCount: number }[];
      overallUptimePercent: number | null;
    }
  | { available: false; reason: string };

interface DailyHistoryEntry {
  date: string; // YYYY-MM-DD (UTC)
  status: "operational" | "degraded" | "outage";
  title: string | null;
  description: string | null;
}

interface StatusResponse {
  status: "operational" | "degraded" | "outage";
  incidents: PlatformIncident[];
  m365Health: M365HealthSection;
  m365Uptime: M365UptimeSection;
  dailyHistory?: DailyHistoryEntry[];
}

const REFRESH_MS = 60_000;

const TONE = {
  ok: "#22c55e",
  okBright: "#4ade80",
  degraded: "#fbbf24",
  down: "#f87171",
  ink: "#f8fafc",
  muted: "#64748b",
  faint: "#475569",
} as const;

// Overall platform state → the eyebrow/hero treatment. h1 reflects the REAL state, not a fixed string.
const OVERALL_META: Record<StatusResponse["status"], { label: string; h1: string; color: string; note: string }> = {
  operational: { label: "All systems operational", h1: "All systems operational", color: TONE.okBright, note: "platform-wide" },
  degraded: { label: "Degraded performance", h1: "Degraded performance", color: TONE.degraded, note: "platform-wide" },
  outage: { label: "Service disruption", h1: "Service disruption", color: TONE.down, note: "platform-wide" },
};

// The six real internal subsystems (names + descriptions verbatim from the design — they describe real
// components), each with its Lucide glyph. No fabricated uptime/bars are attached: per-day 90-day history
// is not yet recorded (see header note), so these are shown as identities with an honest "history pending".
const COMPONENTS: { name: string; desc: string; Icon: typeof Monitor; color: string }[] = [
  { name: "Customer portal", desc: "Dashboards, findings, runbooks, change records", Icon: Monitor, color: "#60a5fa" },
  { name: "Sign-in and MFA", desc: "Username, password, two-factor, password reset", Icon: Lock, color: "#a78bfa" },
  { name: "Scan engines", desc: "All six engines, 158 checks per cycle, hourly", Icon: Search, color: "#22d3ee" },
  { name: "Smart alerting", desc: "Threshold breaches and drift notifications", Icon: Bell, color: "#fbbf24" },
  { name: "Outbound email", desc: "Reset codes, alert digests, monthly reports", Icon: Mail, color: "#2dd4bf" },
  { name: "Approved writes", desc: "Quick-Start Packs and remediation actions", Icon: PenLine, color: "#f472b6" },
];

// Real published SLA commitments (targets). Measured actuals are NOT fabricated — no confirmed measured
// availability series exists yet (#1350 audit), so each actual honestly reads "Not yet measured".
const SLA_ROWS: { name: string; detail: string; target: string }[] = [
  { name: "Portal availability", detail: "Monthly, excluding announced maintenance", target: "99.9%" },
  { name: "Sign-in availability", detail: "Authentication and MFA", target: "99.9%" },
  { name: "Scan cycle completion", detail: "Hourly cycle finishes inside the hour", target: "99.5%" },
  { name: "Critical alert delivery", detail: "From detection to your inbox", target: "15 min" },
  { name: "P1 response", detail: "Tenant-wide impact, retainer clients", target: "1 hour" },
  { name: "P2 and P3 response", detail: "Business hours, all clients", target: "4 hours" },
];

// Per-reason copy for the M365 unavailable states public-status.ts can return.
const M365_UNAVAILABLE: Record<string, string> = {
  not_configured: "Microsoft 365 service-health monitoring hasn't been configured yet.",
  no_tenant: "No Microsoft 365 tenant is currently connected for health reporting.",
  no_samples: "Microsoft 365 uptime history hasn't been sampled yet — measured availability will appear once sampling has run.",
  fetch_failed: "Couldn't reach Microsoft 365 to check service health right now.",
  consent_revoked: "Microsoft 365 access was revoked for the connected tenant — health data is unavailable until it's reconnected.",
  error: "Microsoft 365 service health is temporarily unavailable.",
};

// Daily-strip bar colours + labels, keyed by the real per-day status the API derives.
const DAY_BAR: Record<DailyHistoryEntry["status"], string> = {
  operational: "rgba(34,197,94,.55)",
  degraded: TONE.degraded,
  outage: TONE.down,
};
const DAY_SOLID: Record<DailyHistoryEntry["status"], string> = {
  operational: TONE.okBright,
  degraded: TONE.degraded,
  outage: TONE.down,
};
const DAY_LABEL: Record<DailyHistoryEntry["status"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
};

function fmtFullDate(iso: string): string {
  // iso is a bare YYYY-MM-DD (UTC calendar day) — parse as UTC so it never shifts a day by local tz.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function pill(text: string, color: string): React.CSSProperties {
  return {
    flex: "0 0 auto",
    padding: "3px 9px",
    borderRadius: "999px",
    fontSize: "9.5px",
    fontWeight: 800,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    background: `${color}1F`,
    border: `1px solid ${color}55`,
    color,
  };
}

function fmtUtcTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDuration(startISO: string, endISO: string | null): string {
  if (!endISO) return "Ongoing";
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  if (!(ms > 0)) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPercent(p: number | null | undefined): string {
  return typeof p === "number" ? `${p.toFixed(2)}%` : "—";
}

export default function Status() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [openIncident, setOpenIncident] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const dataRef = useRef<StatusResponse | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setData(json);
        setError(null);
        setCheckedAt(new Date());
      } catch {
        if (cancelled) return;
        // On a refresh failure keep the last good data on screen; only surface an error if we never loaded.
        if (!dataRef.current) setError("Could not load current status.");
      }
    };

    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const overall = data ? OVERALL_META[data.status] : null;
  const incidents = data?.incidents ?? [];
  const openCount = incidents.filter((i) => i.status !== "resolved").length;
  const lastResolved = incidents.find((i) => i.status === "resolved" && i.resolvedAt)?.resolvedAt ?? null;

  const dailyHistory = data?.dailyHistory ?? [];
  const hoverEntry = hoverDay !== null ? dailyHistory[hoverDay] ?? null : null;

  const uptime = data?.m365Uptime;
  const overallM365 = uptime?.available ? uptime.overallUptimePercent : null;

  // Merge current M365 state (m365Health) with 90-day uptime (m365Uptime) by service name.
  const health = data?.m365Health;
  const healthMap = new Map<string, M365ServiceStatus>();
  if (health?.available) for (const s of health.services) healthMap.set(s.service, s.status);
  const uptimeMap = new Map<string, number | null>();
  if (uptime?.available) for (const s of uptime.services) uptimeMap.set(s.service, s.uptimePercent);
  const serviceNames = Array.from(new Set([...healthMap.keys(), ...uptimeMap.keys()])).sort((a, b) => a.localeCompare(b));
  const workloads = serviceNames.map((service) => {
    const st = healthMap.get(service);
    const tone = st === "healthy" ? TONE.ok : st === "degraded" ? TONE.degraded : st === "interruption" ? TONE.down : TONE.faint;
    const stateLabel = st === "healthy" ? "Operational" : st === "degraded" ? "Degraded" : st === "interruption" ? "Interruption" : "Unknown";
    return { service, tone, stateLabel, uptime: fmtPercent(uptimeMap.get(service)) };
  });
  const m365Reason = !uptime?.available ? uptime?.reason : !health?.available ? health?.reason : undefined;

  const summary: { label: string; value: string; note: string; tone: string }[] = [
    {
      label: "Current state",
      value: overall ? overall.label.replace(/^All systems o/, "O") : error ? "Unavailable" : "Checking…",
      note: overall ? overall.note : "",
      tone: overall ? overall.color : TONE.muted,
    },
    {
      label: "Open incidents",
      value: data ? (openCount === 0 ? "None" : String(openCount)) : "—",
      note: openCount === 0 ? (lastResolved ? `last closed ${fmtDate(lastResolved)}` : "none in 90 days") : "active now",
      tone: openCount === 0 ? TONE.okBright : TONE.degraded,
    },
    {
      label: "Incidents",
      value: data ? String(incidents.length) : "—",
      note: "last 90 days",
      tone: TONE.ink,
    },
    {
      label: "Microsoft 365 uptime",
      value: fmtPercent(overallM365),
      note: overallM365 !== null ? "rolling 90 days" : "not yet measured",
      tone: overallM365 !== null ? TONE.okBright : TONE.muted,
    },
  ];

  return (
    <MarketingLayout current="none">
      <style>{`
        .st-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(258px,1fr);gap:20px;align-items:start}
        .st-main,.st-side{display:flex;flex-direction:column;gap:22px;min-width:0}
        .st-side{position:sticky;top:78px}
        @media (max-width:820px){.st-grid{grid-template-columns:1fr}.st-side{position:static}}
        @keyframes stPulse{0%,100%{opacity:.4}50%{opacity:1}}
        .st-row:hover{border-color:rgba(34,197,94,.4)}
        .st-inc:hover{border-color:rgba(148,163,184,.28)}
        @media (prefers-reduced-motion: reduce){.st-pulse{animation:none!important}}
      `}</style>

      <div
        data-testid="status-page"
        style={{ position: "relative", overflow: "hidden", padding: "40px 32px 56px" }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(circle 840px at 22% -10%, rgba(34,197,94,.12), rgba(2,6,23,0) 60%), radial-gradient(circle 640px at 88% 14%, rgba(0,180,216,.10), rgba(2,6,23,0) 58%)",
          }}
        />
        <span
          style={{
            position: "absolute",
            right: "-80px",
            top: "28%",
            opacity: 0.06,
            pointerEvents: "none",
            lineHeight: 0,
            filter: "drop-shadow(0 0 40px rgba(34,197,94,.5))",
          }}
        >
          <Activity width={500} height={500} strokeWidth={0.7} color="#22c55e" />
        </span>

        <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "26px" }}>
          {/* Hero */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                fontSize: "9.5px",
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: overall?.color ?? TONE.muted,
              }}
            >
              <span
                className="st-pulse"
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: overall?.color ?? TONE.muted,
                  boxShadow: `0 0 0 3px ${overall?.color ?? TONE.muted}2E`,
                  animation: "stPulse 2.4s ease-in-out infinite",
                }}
              />
              Service status
            </span>
            <h1
              data-testid="status-overall"
              style={{ fontSize: "31px", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: TONE.ink, margin: 0 }}
            >
              {overall ? overall.h1 : error ? "Status unavailable" : "Checking status…"}
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8", lineHeight: 1.65, maxWidth: "66ch", textWrap: "pretty" }}>
              We monitor our own platform on the same cadence we monitor your tenant, and we publish Microsoft&#8217;s numbers next to ours.
              This page refreshes every 60 seconds and is hosted away from the portal, so it stays up when the portal does not.
            </p>
            <span style={{ fontSize: "11.5px", color: TONE.faint, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>
              {checkedAt ? `Last checked ${fmtUtcTime(checkedAt)} · all times UTC` : "Checking…"}
            </span>
          </div>

          {/* Summary tiles — all real-backed */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "12px" }}>
            {summary.map((k) => (
              <div
                key={k.label}
                style={{
                  padding: "14px 16px",
                  borderRadius: "12px",
                  background: "#0b1524",
                  border: "1px solid rgba(30,41,59,.9)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "3px",
                }}
              >
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: TONE.muted }}>
                  {k.label}
                </span>
                <span style={{ fontSize: "19px", fontWeight: 800, letterSpacing: "-.02em", color: k.tone }}>{k.value}</span>
                <span style={{ fontSize: "10.5px", color: TONE.muted }}>{k.note}</span>
              </div>
            ))}
          </div>

          <div className="st-grid">
            {/* ── Main column ── */}
            <div className="st-main">
              {/* Platform history — REAL platform-wide 90-day daily strip from platform_incidents. Custom
                  per-bar hover tooltip (full date, status pill, scope, real event description). This is
                  platform-wide, not per-component (that granularity is a genuine gap — see the note below). */}
              {dailyHistory.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Platform history</h2>
                    <span style={{ fontSize: "11.5px", color: TONE.muted }}>Last 90 days · newest on the right</span>
                  </div>
                  <div
                    style={{
                      padding: "16px 17px",
                      borderRadius: "12px",
                      background: "#0b1524",
                      border: "1px solid rgba(30,41,59,.9)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div
                      data-testid="status-daily-strip"
                      onMouseLeave={() => setHoverDay(null)}
                      style={{ position: "relative", display: "flex", gap: "2px", alignItems: "stretch", height: "26px" }}
                    >
                      {dailyHistory.map((d, idx) => {
                        const isHot = hoverDay === idx;
                        return (
                          <span
                            key={d.date}
                            onMouseEnter={() => setHoverDay(idx)}
                            style={{
                              flex: "1 1 0",
                              minWidth: "2px",
                              borderRadius: "2px",
                              cursor: "default",
                              transition: "background .12s, transform .12s",
                              background: isHot ? DAY_SOLID[d.status] : DAY_BAR[d.status],
                              transform: isHot ? "scaleY(1.14)" : "none",
                            }}
                          />
                        );
                      })}
                      {hoverEntry && hoverDay !== null && (
                        <div
                          style={{
                            position: "absolute",
                            bottom: "34px",
                            left: `${Math.min(88, Math.max(12, ((hoverDay + 0.5) / 90) * 100))}%`,
                            transform: "translateX(-50%)",
                            zIndex: 30,
                            pointerEvents: "none",
                          }}
                        >
                          <div
                            style={{
                              minWidth: "196px",
                              maxWidth: "260px",
                              padding: "10px 12px",
                              borderRadius: "8px",
                              background: "#04101d",
                              border: "1px solid rgba(148,163,184,.22)",
                              boxShadow: "0 14px 34px rgba(2,6,23,.75)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "5px",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span
                                style={{
                                  flex: "0 0 7px",
                                  width: "7px",
                                  height: "7px",
                                  borderRadius: "50%",
                                  background: DAY_SOLID[hoverEntry.status],
                                  boxShadow: `0 0 0 3px ${DAY_SOLID[hoverEntry.status]}2E`,
                                }}
                              />
                              <span style={{ flex: 1, minWidth: 0, fontSize: "11px", fontWeight: 700, color: TONE.ink, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>
                                {fmtFullDate(hoverEntry.date)}
                              </span>
                              <span style={pill(DAY_LABEL[hoverEntry.status], DAY_SOLID[hoverEntry.status])}>{DAY_LABEL[hoverEntry.status]}</span>
                            </div>
                            <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#cbd5e1" }}>Platform-wide</span>
                            <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55 }}>
                              {hoverEntry.description ?? "No incidents recorded."}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10.5px", color: TONE.faint, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>90 days ago</span>
                      <span style={{ fontSize: "11px", color: TONE.muted }}>Each bar is one day, coloured by the worst incident that overlapped it</span>
                      <span style={{ fontSize: "10.5px", color: TONE.faint, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>Today</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Our components — honest: real identities, per-day history not yet recorded */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Our components</h2>
                  <span style={{ fontSize: "11.5px", color: TONE.muted }}>The subsystems behind the platform</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    padding: "12px 15px",
                    borderRadius: "10px",
                    background: "rgba(148,163,184,.05)",
                    border: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  <Clock width={15} height={15} color={TONE.muted} style={{ flex: "0 0 15px", marginTop: "1px" }} />
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                    Daily history is shown platform-wide above. Breaking it out per component for the last 90 days isn&#8217;t recorded
                    yet — it&#8217;s a planned addition. Any incident affecting a component appears in Incident history below.
                  </span>
                </div>
                {COMPONENTS.map((c) => (
                  <div
                    key={c.name}
                    className="st-row"
                    style={{
                      padding: "15px 17px",
                      borderRadius: "12px",
                      background: "#0b1524",
                      border: "1px solid rgba(30,41,59,.9)",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      transition: "border-color .18s",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 30px",
                        width: "30px",
                        height: "30px",
                        borderRadius: "9px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `${c.color}1A`,
                        border: `1px solid ${c.color}33`,
                      }}
                    >
                      <c.Icon width={16} height={16} color={c.color} />
                    </span>
                    <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "13.5px", fontWeight: 700, color: TONE.ink }}>{c.name}</span>
                      <span style={{ fontSize: "11.5px", color: TONE.muted, lineHeight: 1.5 }}>{c.desc}</span>
                    </span>
                    <span style={pill("History pending", "#64748b")}>History pending</span>
                  </div>
                ))}
              </div>

              {/* Our SLA, measured — real targets; actuals honestly not yet measured */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Our SLA, measured</h2>
                  <span style={{ fontSize: "11.5px", color: TONE.muted }}>Our commitments · measurement in progress</span>
                </div>
                <div style={{ borderRadius: "12px", background: "#0b1524", border: "1px solid rgba(30,41,59,.9)", overflow: "hidden" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1.5fr) .62fr .62fr .58fr",
                      gap: "10px",
                      padding: "11px 15px",
                      background: "rgba(148,163,184,.04)",
                      borderBottom: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    {["Commitment", "Target", "Actual", "Status"].map((h, idx) => (
                      <span
                        key={h}
                        style={{
                          fontSize: "9.5px",
                          fontWeight: 800,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          color: TONE.muted,
                          textAlign: idx === 3 ? "right" : "left",
                        }}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {SLA_ROWS.map((r) => (
                    <div
                      key={r.name}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1.5fr) .62fr .62fr .58fr",
                        gap: "10px",
                        alignItems: "center",
                        padding: "13px 15px",
                        borderBottom: "1px solid rgba(30,41,59,.6)",
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                        <span style={{ fontSize: "12.5px", fontWeight: 700, color: TONE.ink }}>{r.name}</span>
                        <span style={{ fontSize: "11px", color: TONE.muted, lineHeight: 1.5 }}>{r.detail}</span>
                      </span>
                      <span style={{ fontSize: "12px", color: "#94a3b8", fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>{r.target}</span>
                      <span style={{ fontSize: "12px", color: TONE.muted, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>Not yet measured</span>
                      <span style={{ display: "flex", justifyContent: "flex-end" }}>
                        <span style={pill("Pending", "#64748b")}>Pending</span>
                      </span>
                    </div>
                  ))}
                  <div style={{ padding: "12px 17px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11.5px", color: TONE.muted, lineHeight: 1.6 }}>
                      Miss an availability target in a calendar month and retainer clients receive a 10% service credit automatically. You do
                      not have to ask for it.
                    </span>
                  </div>
                </div>
              </div>

              {/* Incident history — real, from /api/status */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Incident history</h2>
                  <span style={{ fontSize: "11.5px", color: TONE.muted }}>Last 90 days</span>
                </div>

                {data && incidents.length === 0 && (
                  <div
                    data-testid="status-incidents-empty"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "16px 17px",
                      borderRadius: "12px",
                      background: "#0b1524",
                      border: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    <Check width={16} height={16} color={TONE.okBright} />
                    <span style={{ fontSize: "12.5px", color: "#cbd5e1" }}>No incidents in the last 90 days.</span>
                  </div>
                )}

                {incidents.map((i) => {
                  const resolved = i.status === "resolved";
                  const sevColor = i.severity === "critical" ? TONE.down : i.severity === "major" ? TONE.down : TONE.degraded;
                  const isOpen = openIncident === i.id;
                  return (
                    <div
                      key={i.id}
                      className="st-inc"
                      style={{ borderRadius: "12px", background: "#0b1524", border: "1px solid rgba(30,41,59,.9)", overflow: "hidden", transition: "border-color .18s" }}
                    >
                      <button
                        onClick={() => setOpenIncident(isOpen ? null : i.id)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "14px 16px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={pill(i.severity, sevColor)}>{i.severity}</span>
                        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "13.5px", fontWeight: 700, color: TONE.ink }}>{i.title}</span>
                          <span style={{ fontSize: "11.5px", color: TONE.muted }}>
                            {fmtDate(i.startedAt)} · {fmtDuration(i.startedAt, i.resolvedAt)}
                          </span>
                        </span>
                        <span style={pill(resolved ? "Resolved" : i.status, resolved ? TONE.ok : "#60a5fa")}>
                          {resolved ? "Resolved" : i.status}
                        </span>
                        <ChevronDown
                          width={16}
                          height={16}
                          color={TONE.faint}
                          style={{ flex: "0 0 auto", transition: "transform .18s", transform: isOpen ? "rotate(180deg)" : "none" }}
                        />
                      </button>
                      {isOpen && (
                        <div style={{ padding: "0 16px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                          <p style={{ margin: 0, fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7, maxWidth: "76ch" }}>{i.description}</p>
                          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "11px", color: TONE.muted, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>
                            <span>Started {new Date(i.startedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span>
                            {i.resolvedAt && <span>Resolved {new Date(i.resolvedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Sidebar ── */}
            <aside className="st-side">
              {/* Microsoft 365 uptime — real, from m365_service_health_samples / sla-uptime.ts */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Microsoft 365 uptime</h2>
                  <span style={{ fontSize: "11.5px", color: TONE.muted }}>Read from the Service Health API</span>
                </div>
                <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65, maxWidth: "76ch" }}>
                  We depend on Microsoft, so we publish their numbers next to ours. A Microsoft incident slows scans and delays alerts; it
                  never puts your tenant at risk, and queued scans drain on their own once the workload recovers.
                </p>

                {workloads.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                    {workloads.map((w) => (
                      <div
                        key={w.service}
                        style={{
                          padding: "13px 15px",
                          borderRadius: "12px",
                          background: "#0b1524",
                          border: "1px solid rgba(30,41,59,.9)",
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                        }}
                      >
                        <span style={{ flex: "0 0 7px", width: "7px", height: "7px", borderRadius: "50%", background: w.tone, boxShadow: `0 0 0 3px ${w.tone}2E` }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, color: TONE.ink }}>{w.service}</span>
                        <span style={{ flex: "0 0 auto", fontSize: "11px", color: TONE.muted }}>{w.stateLabel}</span>
                        <span style={{ flex: "0 0 auto", fontSize: "11px", fontWeight: 700, color: "#94a3b8", fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>
                          {w.uptime}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "13px 15px",
                      borderRadius: "12px",
                      background: "#0b1524",
                      border: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    <AlertTriangle width={15} height={15} color={TONE.muted} style={{ flex: "0 0 15px", marginTop: "1px" }} />
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                      {(m365Reason && M365_UNAVAILABLE[m365Reason]) || "Microsoft 365 service health is temporarily unavailable."}
                    </span>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "13px 16px",
                    borderRadius: "8px",
                    background: "rgba(0,120,212,.07)",
                    border: "1px solid rgba(0,120,212,.26)",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: "12px", color: "#cbd5e1", lineHeight: 1.55 }}>
                    Microsoft publishes a <span style={{ fontWeight: 700, color: TONE.ink }}>99.9% financially backed SLA</span> for Microsoft
                    365. Rolling 90-day measured availability across the workloads we read:{" "}
                    <span style={{ fontWeight: 700, color: overallM365 !== null ? TONE.okBright : TONE.muted, fontFamily: "Menlo,'SF Mono',Consolas,monospace" }}>
                      {fmtPercent(overallM365)}
                    </span>
                    .
                  </span>
                  <span style={{ flex: "0 0 auto", fontSize: "11px", color: TONE.faint, fontFamily: "Menlo,'SF Mono',Consolas,monospace", whiteSpace: "nowrap" }}>
                    Read hourly
                  </span>
                </div>
              </div>

              {/* Scheduled maintenance — honest: none scheduled (no maintenance table exists) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <h2 style={{ fontSize: "17px", fontWeight: 800, letterSpacing: "-.02em", color: TONE.ink, margin: 0 }}>Scheduled maintenance</h2>
                <div
                  style={{
                    padding: "16px 18px",
                    borderRadius: "12px",
                    background: "#0b1524",
                    border: "1px solid rgba(30,41,59,.9)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                  }}
                >
                  <Check width={16} height={16} color={TONE.okBright} style={{ flex: "0 0 16px", marginTop: "1px" }} />
                  <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65 }}>
                    No maintenance is currently scheduled. When we plan a window, it will appear here with the impact spelled out.
                  </p>
                </div>
              </div>
            </aside>
          </div>

          {/* Sign-in help links */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", paddingTop: "6px", fontSize: "11.5px" }}>
            <span style={{ color: TONE.muted }}>Signing in?</span>
            <a href="/portal/login" style={{ color: "#94a3b8", fontWeight: 600 }}>
              Customer portal
            </a>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
