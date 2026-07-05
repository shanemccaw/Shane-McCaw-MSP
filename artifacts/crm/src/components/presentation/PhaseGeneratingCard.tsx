import { useState, useEffect } from "react";
import AnimatedBackground from "@/components/quickwin/AnimatedBackground";
import CopilotAura from "@/components/wizard/CopilotAura";

export interface PhaseGenPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  subtasks: string[];
}

interface ProgressRow {
  message: string;
  done: boolean;
  current?: number;
  total?: number;
}

interface Scores {
  security: number;
  compliance: number;
  governance: number;
  copilot: number;
  productivity: number;
}

const PILLARS: { key: keyof Scores; label: string; color: string }[] = [
  { key: "security",     label: "Security",     color: "#0078D4" },
  { key: "compliance",   label: "Compliance",   color: "#4f46e5" },
  { key: "governance",   label: "Governance",   color: "#7c3aed" },
  { key: "copilot",      label: "Copilot AI",   color: "#00B4D8" },
  { key: "productivity", label: "Productivity", color: "#059669" },
];

function scoreColor(s: number) {
  if (s >= 80) return "#16a34a";
  if (s >= 60) return "#d97706";
  if (s >= 40) return "#ea580c";
  return "#dc2626";
}

function scoreLabel(s: number) {
  if (s >= 80) return "Strong";
  if (s >= 60) return "Moderate";
  if (s >= 40) return "At Risk";
  return "Critical";
}

// Animated count-up (easeOutCubic)
function useCountUp(target: number, durationMs = 1300, enabled = true): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!enabled) { setVal(0); return; }
    const start = Date.now();
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / durationMs);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, enabled]);
  return val;
}

/* ── Score Ring ─────────────────────────────────────────────── */
function ScoreRing({ score, animate }: { score: number; animate: boolean }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  const displayed = useCountUp(score, 1400, animate);

  return (
    <div className="relative flex items-center justify-center mx-auto" style={{ width: 112, height: 112 }}>
      <svg width="112" height="112" viewBox="0 0 112 112" className="absolute inset-0">
        {/* Track */}
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="9" />
        {/* Arc */}
        <circle
          cx="56" cy="56" r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={animate ? circ * (1 - score / 100) : circ}
          transform="rotate(-90 56 56)"
          style={{ transition: animate ? "stroke-dashoffset 1.4s cubic-bezier(0.34,1.56,0.64,1)" : "none" }}
        />
      </svg>
      <div className="flex flex-col items-center leading-none z-10">
        <span className="text-2xl font-black tabular-nums" style={{ color }}>{displayed}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5 text-black/35">/ 100</span>
      </div>
    </div>
  );
}

/* ── Pillar bar ─────────────────────────────────────────────── */
function PillarBar({ label, score, color, animate, delay }: {
  label: string; score: number; color: string; animate: boolean; delay: number;
}) {
  const displayed = useCountUp(score, 1100, animate);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-[#0A2540]/70 w-[80px] flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.07)" }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: color,
            width: animate ? `${score}%` : "0%",
            transition: animate ? "width 1.1s cubic-bezier(0.34,1.56,0.64,1)" : "none",
            transitionDelay: animate ? `${delay}ms` : "0ms",
          }}
        />
      </div>
      <span className="text-[11px] font-bold tabular-nums w-6 text-right" style={{ color: scoreColor(score) }}>
        {displayed}
      </span>
    </div>
  );
}

/* ── Stat chip ──────────────────────────────────────────────── */
function StatChip({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-2xl bg-white border border-black/[0.07] shadow-sm min-w-0">
      <div className="text-[#0078D4]">{icon}</div>
      <span className="text-base font-black text-[#0A2540] tabular-nums leading-none mt-0.5">{value}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest text-black/35 text-center leading-tight">{label}</span>
    </div>
  );
}

/* ── Main progress bar ──────────────────────────────────────── */
function BuildProgressBar({ current, total }: { current: number | null; total: number | null }) {
  const pct = current != null && total != null && total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const isPulsing = current == null || total == null;
  return (
    <div className="relative w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.07)" }}>
      {isPulsing ? (
        <div className="absolute inset-0 rounded-full animate-pulse" style={{ background: "linear-gradient(90deg,#0078D4,#00B4D8)", opacity: 0.55 }} />
      ) : (
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#0078D4,#00B4D8)", transition: "width 0.5s ease", boxShadow: "0 0 8px rgba(0,180,216,0.5)" }}
        />
      )}
    </div>
  );
}

/* ── Props ──────────────────────────────────────────────────── */
interface Props {
  presentationId: number;
  shareToken?: string | null;
  accessToken?: string | null;
  clientName?: string | null;
  projectTitle?: string | null;
  sowPhases?: PhaseGenPhase[];
  totalPrice?: number;
  documentCount?: number;
  onComplete: (phases: PhaseGenPhase[]) => void;
  onError: () => void;
  phaseGenEvent?: {
    type: string; message?: string; current?: number; total?: number; phases?: PhaseGenPhase[];
  } | null;
}

/* ── Component ──────────────────────────────────────────────── */
export default function PhaseGeneratingCard({
  accessToken,
  clientName,
  projectTitle,
  sowPhases = [],
  totalPrice,
  documentCount = 0,
  onComplete,
  onError,
  phaseGenEvent,
}: Props) {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [stepCounter, setStepCounter] = useState<{ current: number; total: number } | null>(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Scorecard state
  const [scores, setScores] = useState<Scores | null>(null);
  const [scoresReady, setScoresReady] = useState(false);

  // Fetch scorecard when accessToken is available
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetch("/api/portal/quick-win/scorecard", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.ok ? r.json() as Promise<{ hasProfile: boolean; scores: Scores }> : null)
      .then(d => {
        if (cancelled || !d) return;
        if (d.hasProfile && d.scores) {
          setScores(d.scores);
          // Delay animate start slightly so the layout has settled
          setTimeout(() => setScoresReady(true), 120);
        }
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [accessToken]);

  // Handle SSE phase_gen events
  useEffect(() => {
    if (!phaseGenEvent) return;
    if (phaseGenEvent.type === "phase_gen_progress") {
      const msg = phaseGenEvent.message ?? "";
      if (phaseGenEvent.current !== undefined && phaseGenEvent.total !== undefined) {
        setStepCounter({ current: phaseGenEvent.current, total: phaseGenEvent.total });
      }
      setRows(prev => {
        const updated = prev.map((r, i) => i === prev.length - 1 ? { ...r, done: true } : r);
        return [...updated, { message: msg, done: false, current: phaseGenEvent.current, total: phaseGenEvent.total }];
      });
    } else if (phaseGenEvent.type === "phase_gen_complete") {
      setRows(prev => prev.map(r => ({ ...r, done: true })));
      setTimeout(() => onComplete(phaseGenEvent.phases ?? []), 400);
    } else if (phaseGenEvent.type === "phase_gen_error") {
      setRows(prev => prev.map(r => ({ ...r, done: true })));
      setErrorMessage(phaseGenEvent.message ?? "An error occurred while generating your project plan.");
      setHasError(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseGenEvent]);

  const overallScore = scores
    ? Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length)
    : 0;

  const phasesBuilding = sowPhases.length > 0 ? sowPhases.length : rows.length > 0 ? "–" : "–";
  const investmentLabel = totalPrice != null && totalPrice > 0
    ? totalPrice >= 1000 ? `$${Math.round(totalPrice / 1000)}K` : `$${totalPrice.toLocaleString()}`
    : "–";

  /* ── Error state ── */
  if (hasError) {
    return (
      <div className="fixed inset-0 z-[20000] flex items-center justify-center" style={{ backgroundColor: "rgb(248,249,251)" }}>
        <AnimatedBackground fullScreen />
        <CopilotAura />
        <div className="relative z-[20] w-full max-w-sm mx-auto px-4">
          <div className="rounded-2xl shadow-lg p-6 text-center bg-white border border-black/[0.08]">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-extrabold text-[#0A2540] mb-2">Couldn't Build Your Plan</h2>
            <p className="text-sm leading-relaxed mb-6 text-black/60">{errorMessage}</p>
            <button
              onClick={onError}
              className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 transition-colors shadow-lg shadow-[#0078D4]/30"
            >
              Continue to Payment Options
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main waiting screen ── */
  return (
    <div className="fixed inset-0 z-[20000] flex flex-col items-center justify-center overflow-y-auto py-6 px-4" style={{ backgroundColor: "rgb(248,249,251)" }}>
      <AnimatedBackground fullScreen />
      <CopilotAura />

      <div className="relative z-[20] w-full max-w-3xl mx-auto flex flex-col gap-4">

        {/* ── Header ── */}
        <div className="text-center mb-1">
          {clientName && (
            <p className="text-[11px] font-bold text-[#00B4D8] uppercase tracking-widest mb-1">
              Hi, {clientName}
            </p>
          )}
          <h1 className="text-2xl font-black text-[#0A2540] leading-tight">
            Building Your Custom Project Plan
          </h1>
          {projectTitle && (
            <p className="text-sm font-semibold text-[#0078D4] mt-1 opacity-80">{projectTitle}</p>
          )}
          {/* Global progress bar */}
          <div className="mt-3 max-w-sm mx-auto">
            <BuildProgressBar
              current={stepCounter?.current ?? null}
              total={stepCounter?.total ?? null}
            />
            {stepCounter && (
              <p className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mt-1.5">
                Step {stepCounter.current} of {stepCounter.total}
              </p>
            )}
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Left: M365 Health Assessment */}
          <div className="rounded-2xl bg-white border border-black/[0.07] shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">Your Assessment</p>
                  <p className="text-sm font-extrabold text-[#0A2540] leading-none">M365 Health Overview</p>
                </div>
              </div>

              {scores ? (
                <>
                  {/* Score ring */}
                  <div className="flex flex-col items-center mb-4">
                    <ScoreRing score={overallScore} animate={scoresReady} />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-black/40 mt-1.5">Overall Readiness</p>
                    <span
                      className="mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background: `${scoreColor(overallScore)}18`,
                        color: scoreColor(overallScore),
                      }}
                    >
                      {scoreLabel(overallScore)}
                    </span>
                  </div>

                  {/* Pillar bars */}
                  <div className="flex flex-col gap-2.5">
                    {PILLARS.map((p, i) => (
                      <PillarBar
                        key={p.key}
                        label={p.label}
                        score={scores[p.key]}
                        color={p.color}
                        animate={scoresReady}
                        delay={i * 80}
                      />
                    ))}
                  </div>
                </>
              ) : (
                /* Skeleton / loading state */
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-28 h-28 rounded-full bg-black/[0.06] animate-pulse" />
                  <div className="w-full flex flex-col gap-2 mt-2">
                    {PILLARS.map(p => (
                      <div key={p.key} className="flex items-center gap-2">
                        <div className="w-[80px] h-2 rounded bg-black/[0.06] animate-pulse" />
                        <div className="flex-1 h-1.5 rounded-full bg-black/[0.06] animate-pulse" />
                        <div className="w-5 h-2 rounded bg-black/[0.06] animate-pulse" />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] font-semibold text-black/30 uppercase tracking-widest">Loading your scores…</p>
                </div>
              )}
            </div>

            {/* Context note */}
            <div className="px-5 py-3 mt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.05)", background: "rgba(0,0,0,0.015)" }}>
              <p className="text-[10px] leading-relaxed text-black/40">
                Scores are derived from your Microsoft 365 environment telemetry and will inform your custom project phases.
              </p>
            </div>
          </div>

          {/* Right: What's Being Built */}
          <div className="rounded-2xl bg-white border border-black/[0.07] shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 flex-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-[#00B4D8]/10 flex items-center justify-center">
                  {/* Spinner or check depending on state */}
                  {rows.every(r => r.done) && rows.length > 0 ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-[#00B4D8] animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">AI Processing</p>
                  <p className="text-sm font-extrabold text-[#0A2540] leading-none">What's Being Built</p>
                </div>
              </div>

              {/* Live steps */}
              <ul className="flex flex-col gap-2.5 min-h-[120px]">
                {rows.length === 0 ? (
                  <li className="flex items-center gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </span>
                    <span className="text-xs font-semibold text-[#0078D4]">
                      Starting up<span className="animate-pulse">…</span>
                    </span>
                  </li>
                ) : (
                  rows.map((row, i) => {
                    const isActive = !row.done && i === rows.length - 1;
                    return (
                      <li key={i} className="flex items-start gap-2.5" style={{ opacity: row.done && i < rows.length - 1 ? 0.5 : 1, transition: "opacity 0.3s ease" }}>
                        <span className="flex-shrink-0 w-4 h-4 mt-0.5 flex items-center justify-center">
                          {row.done ? (
                            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : isActive ? (
                            <svg className="w-3.5 h-3.5 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full block" style={{ background: "rgba(0,0,0,0.20)" }} />
                          )}
                        </span>
                        <span className="text-xs leading-snug" style={{
                          color: row.done ? "#16a34a" : isActive ? "#0078D4" : "rgba(0,0,0,0.30)",
                          fontWeight: isActive ? 600 : row.done ? 500 : 400,
                        }}>
                          {row.message}{isActive && <span className="animate-pulse">…</span>}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>

              {/* What's being customized */}
              <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "rgba(0,120,212,0.05)", border: "1px solid rgba(0,120,212,0.12)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0078D4] mb-1">Customized for you</p>
                <p className="text-[11px] leading-relaxed text-[#0A2540]/70">
                  Shane is tailoring each phase, milestone, and price point specifically to your Microsoft 365 environment and scope of work.
                </p>
              </div>
            </div>

            <div className="px-5 py-3 mt-auto" style={{ borderTop: "1px solid rgba(0,0,0,0.05)", background: "rgba(0,0,0,0.015)" }}>
              <p className="text-[10px] leading-relaxed text-black/40">
                This typically takes 60–90 seconds. Your plan will appear automatically when ready.
              </p>
            </div>
          </div>
        </div>

        {/* ── Stat chips ── */}
        <div className="flex gap-3">
          <StatChip
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
            value={typeof phasesBuilding === "number" ? `${phasesBuilding}` : "–"}
            label="Phases Being Designed"
          />
          <StatChip
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            value={investmentLabel}
            label="Estimated Investment"
          />
          <StatChip
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            value={documentCount > 0 ? `${documentCount}` : "–"}
            label="Docs Reviewed"
          />
        </div>

      </div>
    </div>
  );
}
