import React, { useState, useEffect, useRef } from 'react';
import { UnifiedTelemetryCarousel } from '../telemetry/UnifiedTelemetryCarousel';
import {
  Activity,
  CheckCircle2,
  Loader2,
  Play,
  Shield,
  ShieldAlert,
  Zap,
  ArrowRight,
  Server,
  AlertCircle,
  Lock,
  Users,
  Database,
  Key,
  FileCode,
  Sliders,
  Sparkles,
  FileText,
  AlertTriangle,
  Radio,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from 'recharts';
import { PHASE2_ENGINES } from '../telemetryCatalog';
import { useRealGraphScanSteps } from '../useRealGraphScanSteps';
import { useRealDocWorkflowPhases } from '../useRealDocWorkflowPhases';
import { useRealTelemetryComparison } from '../useRealTelemetryComparison';
import { useVersionInfo } from '@/hooks/useVersionInfo';
import type { ExtendedEngineDef, ExtendedDocDef } from '../telemetry/UnifiedTelemetryCarousel';

interface TelemetryScreenProps {
  quizAnswers?: Record<string, string>;
  /** True while the #237 saved-quiz-profile restore is still outstanding (#256). */
  quizProfileRestorePending?: boolean;
  onContinue: () => void;
}

type TelemetryPhase = 'phase1_graph' | 'phase2_engines' | 'phase3_docs' | 'complete';

export const TelemetryScreen: React.FC<TelemetryScreenProps> = ({
  quizAnswers = {},
  quizProfileRestorePending = false,
  onContinue
}) => {
  // Phase state
  const [phase, setPhase] = useState<TelemetryPhase>('phase1_graph');

  // Phase 1 — REAL Microsoft Graph scan state (#228).
  // No local step state and no timer here any more: the four tiles' statuses and
  // message lines come from the real diagnostics run for this customer's tenant
  // (see useRealGraphScanSteps.ts for the milestone mapping).
  const graphScan = useRealGraphScanSteps();

  // Left-panel footer version stamp — real git build info (#274), same
  // commit-count/short-hash source app-shell.tsx already uses, not an
  // invented scheme.
  const versionInfo = useVersionInfo();

  // Phase 3 — REAL doc-generation workflow run (#235).
  // The scripted setInterval walk over TELEMETRY_DOCS is gone: the document
  // tiles now read the real run of the seeded "Assessment Document Generation"
  // workflow for this customer, over the run-scoped SSE stream the old
  // assessment wizard has always used. See useRealDocWorkflowPhases.ts for the
  // exact real event shape this maps.
  const docWf = useRealDocWorkflowPhases();

  // #234 — testbed accounts must not auto-advance off scan history from a
  // prior session. graphScan.scanComplete reflects the tenant's most recent
  // diagnostics run ever, regardless of age, so a testbed tenant scanned days
  // ago would otherwise skip Phase 1 (and hide the [Debug] button) on mount.
  // Flips true only when THIS session explicitly fires the [Debug] button.
  // Non-testbed accounts never read this flag — their skip-ahead behavior is
  // unchanged.
  const [testbedScanTriggeredThisSession, setTestbedScanTriggeredThisSession] = useState(false);

  // Phase 2 engine tiles — COSMETIC, by Shane's scope correction on #235. These
  // five carry the real engine names (ids are real engine-registry keys) but no
  // real data source: nothing triggers those engines during a customer scan
  // today, so a paced local animation is the correct and intended treatment.
  // No `severity`/`findingLabel` is set, so the carousel omits both rather than
  // reintroducing the invented tenant findings this page used to show.
  const [engines, setEngines] = useState<ExtendedEngineDef[]>(() =>
    PHASE2_ENGINES.map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      icon: e.icon,
      status: 'pending',
      currentSseMsg: e.sseMessages[0]
    }))
  );
  const [activeEngineIndex, setActiveEngineIndex] = useState<number>(0);
  /** Cosmetic 0–100 fill for the engine currently pacing. */
  const [activeEngineProgress, setActiveEngineProgress] = useState<number>(0);

  // Phase 3 document tiles — a pure projection of the REAL run state above onto
  // the carousel's tile shape. No local status, progress or message state and no
  // timer: there is nothing here to simulate.
  const docs: ExtendedDocDef[] = docWf.docs.map(d => ({
    id: d.id,
    name: d.name,
    description: d.description,
    status: d.status,
    progress: d.progress,
    currentSseMsg: d.message
  }));

  // Stream row line. Phases 1 and 3 are real (the diagnostics run and the
  // doc-generation run respectively); phase 2's line is the cosmetic pacing
  // message of whichever engine tile is currently animating.
  const currentSseStream =
    phase === 'phase1_graph'
      ? graphScan.streamMessage
      : phase === 'phase2_engines'
        ? `[${engines[activeEngineIndex]?.name ?? 'Engines'}] ${engines[activeEngineIndex]?.currentSseMsg ?? ''}`
        : docWf.streamMessage;

  const isDocumentMode = phase === 'phase3_docs' || phase === 'complete';

  // Compute Completed Counts
  const completedEnginesCount = engines.filter(e => e.status === 'complete').length;
  const completedDocsCount = docs.filter(d => d.status === 'complete').length;

  // Unified Overall Progress Calculation (0 to 100%)
  // Phase 1 = 0% to 25%
  // Phase 2 = 25% to 75%
  // Phase 3 = 75% to 100%
  // Phases 1 and 3 are real completed-counts over real totals; phase 2's band is
  // the cosmetic pacing position (see PHASE2_ENGINES).
  let overallProgress = 0;
  if (phase === 'phase1_graph') {
    // Real scan progress (0–100 across the four real steps) scaled into this
    // page's 0–25% band for phase 1.
    overallProgress = Math.min(25, Math.round(graphScan.scanProgressPct * 0.25));
  } else if (phase === 'phase2_engines') {
    const engineWeight = engines.length > 0 ? 50 / engines.length : 0;
    const runningContrib =
      engines[activeEngineIndex]?.status === 'running' ? (activeEngineProgress / 100) * engineWeight : 0;
    overallProgress = Math.min(75, Math.round(25 + completedEnginesCount * engineWeight + runningContrib));
  } else if (phase === 'phase3_docs' || phase === 'complete') {
    const docFraction = docs.length > 0 ? completedDocsCount / docs.length : 0;
    overallProgress = phase === 'complete' ? 100 : Math.min(100, Math.round(75 + docFraction * 25));
  }

  // PHASE 1 → PHASE 2 — driven by the REAL run reaching a terminal state with
  // real results, not by a timer. A failed/blocked scan deliberately does NOT
  // advance: the page holds on the real failure instead of pretending forward.
  // #234 — testbed accounts additionally require an explicit [Debug] trigger
  // in this session; scanComplete alone (which can reflect a stale historical
  // run) is not enough to leave Phase 1 for them. Non-testbed accounts keep
  // the original scanComplete-only behavior.
  useEffect(() => {
    if (phase !== 'phase1_graph' || !graphScan.scanComplete) return;
    if (graphScan.isTestbed && !testbedScanTriggeredThisSession) return;
    setPhase('phase2_engines');
    setEngines(prev => prev.map((e, idx) => (idx === 0 ? { ...e, status: 'running' } : e)));
    setActiveEngineIndex(0);
    setActiveEngineProgress(0);
  }, [phase, graphScan.scanComplete, graphScan.isTestbed, testbedScanTriggeredThisSession]);

  // PHASE 2 — cosmetic pacing only (Shane's #235 scope correction). Walks the
  // five real engine names on a local timer and makes NO backend call: these
  // engines aren't triggered by any automated workflow for a real customer scan
  // today, so there is nothing live to report. Deliberately isolated from
  // `docWf` so the real phase-3 stream can never be mistaken for its source.
  // One tick per effect run (setTimeout, not setInterval) so every state update
  // happens in the effect body rather than inside a setState updater — no
  // side effects in a reducer, and StrictMode's double-invoke stays harmless.
  useEffect(() => {
    if (phase !== 'phase2_engines') return;

    const timer = setTimeout(() => {
      const next = activeEngineProgress + 15;

      if (next < 100) {
        setActiveEngineProgress(next);
        // Advance the active tile's pacing line in step with its fill.
        setEngines(current =>
          current.map((e, idx) => {
            if (idx !== activeEngineIndex) return e;
            const lines = PHASE2_ENGINES[idx]?.sseMessages ?? [];
            const msgIdx = Math.min(lines.length - 1, Math.floor((next / 100) * lines.length));
            return { ...e, currentSseMsg: lines[msgIdx] ?? e.currentSseMsg };
          })
        );
        return;
      }

      // Active tile done — complete it, and start the next one if there is one.
      const nextIdx = activeEngineIndex + 1;
      setEngines(current =>
        current.map((e, idx) => {
          if (idx === activeEngineIndex) return { ...e, status: 'complete' as const };
          if (idx === nextIdx) return { ...e, status: 'running' as const };
          return e;
        })
      );

      if (nextIdx < PHASE2_ENGINES.length) {
        setActiveEngineIndex(nextIdx);
        setActiveEngineProgress(0);
      } else {
        setActiveEngineProgress(100);
        setPhase('phase3_docs');
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [phase, activeEngineIndex, activeEngineProgress]);

  // PHASE 3 → COMPLETE — the real run reached its success terminal
  // (assessment.docs.completed on the stream, or status "completed" on the
  // poll). A failed run deliberately never advances: the page holds on the real
  // failure, exactly as phase 1 does for a failed scan.
  useEffect(() => {
    if (phase !== 'phase3_docs' || !docWf.docGenComplete) return;
    setPhase('complete');
  }, [phase, docWf.docGenComplete]);

  // RIGHT PANEL — REAL TELEMETRY COMPARISON (#245)
  //
  // All four elements below (Score gauges, Multi-Dimension Radar, Dimension Gap
  // Analysis, Top Discrepancies) now read one real source: the platform's own
  // health engine (computeHealthEngine via calculateArchitectureHealthScore) and
  // this customer's real msp_diagnostic_findings, joined with the run's real
  // per-check SSE stream while a scan is in flight. See
  // useRealTelemetryComparison.ts / telemetryComparison.ts, and api-server's
  // lib/telemetry-comparison.ts.
  //
  // What was here before: `sensRiskScore` / `collabRiskScore` derived from quiz
  // answers, multiplied by a synthetic `engineProgressFactor` (the fraction of
  // the COSMETIC phase-2 engine tiles that had animated), producing six invented
  // radar axes, four invented gap bars and an invented "Actual Telemetry" score
  // — none of which read a single byte of the real scan. Deleted outright rather
  // than left dormant, so nothing can quietly become the panel's source again.
  const comparison = useRealTelemetryComparison();

  // Self-Assessment gauge — unchanged, and deliberately so (#245 scopes the
  // Self side out: it is legitimately self-reported). Note for Shane: this is
  // still a constant, not actually derived from `quizAnswers`.
  const selfScore = 72; // Baseline quiz readiness score

  // Real overall health for the Actual gauge. Null means the engine genuinely
  // has no data for this tenant yet — shown as a "no data" caption, never as a
  // fabricated number.
  const actualTelemetryScore = comparison.actualScore ?? 0;

  // Real radar axes: the seven pillars the engine actually returns
  // (governance, compliance, adoption, copilot, architecture, licensing,
  // security), not the six invented ones. There is intentionally NO `self`
  // series — see the self-assessment design question in telemetryComparison.ts.
  const radarData = comparison.pillars.map(p => ({ axis: p.axis, actual: p.actual }));

  // Real gap bars — the SAME per-pillar numbers as the radar (previously a
  // separate set of invented formulas), worst real exposure first.
  const gapBars = comparison.gapBars;

  // Real discrepancies — this run's live failing/severity-matched checks while
  // it streams, its persisted critical/warning findings once it completes.
  const topDiscrepancies = comparison.discrepancies;

  // Helper for rendering icons dynamically
  const renderEngineIcon = (iconName: string) => {
    switch (iconName) {
      case 'Activity': return <Activity className="w-4 h-4" />;
      case 'Sliders': return <Sliders className="w-4 h-4" />;
      case 'Server': return <Server className="w-4 h-4" />;
      case 'Zap': return <Zap className="w-4 h-4" />;
      case 'Sparkles': return <Sparkles className="w-4 h-4" />;
      case 'Users': return <Users className="w-4 h-4" />;
      case 'ShieldAlert': return <ShieldAlert className="w-4 h-4" />;
      case 'Lock': return <Lock className="w-4 h-4" />;
      case 'Key': return <Key className="w-4 h-4" />;
      case 'Shield': return <Shield className="w-4 h-4" />;
      case 'Database': return <Database className="w-4 h-4" />;
      case 'FileCode': return <FileCode className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  // SVG Gauge calculations. The svg viewport is 64x64 (w-16 h-16) with the
  // circle centered at (32,32); a radius of 32 puts the stroke's outer edge
  // (r + strokeWidth/2) past the svg's own bounds, which the svg element's
  // default overflow:hidden then clips top/bottom. Leaving half the stroke
  // width as margin keeps the full ring inside the viewport.
  const gaugeStrokeWidth = 5;
  const radius = 32 - gaugeStrokeWidth / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const selfDashoffset = circumference - (selfScore / 100) * circumference;
  const actualDashoffset = circumference - (actualTelemetryScore / 100) * circumference;

  return (
    <div className="h-screen w-screen bg-[#0A0A0A] text-[#E1E1E1] flex flex-col font-sans overflow-hidden antialiased select-none">
      {/* 1. TOP TOOLBAR */}
      <header className="h-12 bg-[#111111] border-b border-[#2D2D2D] px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[#0078D4]/20 border border-[#0078D4]/40 flex items-center justify-center text-[#0078D4]">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xs font-bold text-white tracking-wide uppercase flex items-center gap-2">
              <span>Copilot Assessment</span>
              <span className="text-[#666666]">—</span>
              <span className="text-[#0078D4]">Telemetry Signals</span>
            </h1>
          </div>
        </div>

        {/* ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
            Testbed-only manual trigger for a REAL scan, so the real run can be
            watched live during development. Persistently visible across all
            three phases (#241) — no longer scoped to phase1_graph — so a
            testbed account can re-trigger a fresh scan without navigating away
            and back. It posts to the platform's one existing debug endpoint
            (POST /portal/assessment/debug-trigger-scan), which is hard-gated
            server-side to isTestbed=true customers — this isTestbed check only
            hides the button, it is NOT the gate. Remove this button with that
            route. See backlog: [Shane to add ticket]. */}
        {graphScan.isTestbed && (
          <button
            onClick={() => {
              setTestbedScanTriggeredThisSession(true);
              void graphScan.triggerScan();
            }}
            disabled={graphScan.triggering || graphScan.scanActive}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide px-2.5 py-1 rounded border border-amber-500/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 transition-colors disabled:opacity-40"
            title="Testbed only — starts a real diagnostics run against this tenant"
          >
            {graphScan.triggering ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <span>[Debug] Run real scan</span>
          </button>
        )}

        {/* ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
            Testbed-only navigation bypass (#253). Calls onContinue() directly
            regardless of phase, skipping the real document-generation wait
            (Phase 3 — real AI/credit spend) entirely, so a testbed account can
            iterate on the Personas/Use Cases/etc. screens downstream without
            spending AI credits generating real documents. Pure client-side
            navigation — no server call, no server-side gate. Downstream
            screens see real absence of document data, not a stub: this does
            NOT fake or fabricate any document. Remove this button before
            production.

            Gated on quizProfileRestorePending (#256): the #237 saved-quiz-profile
            restore is an async fetch on page mount, and a fast click here right
            after page load can outrun it, landing on Personas with a null
            quizProfile that looks identical to "no profile ever existed" and
            spins forever. Hidden — not just disabled — until that restore has
            left its initial pending state (restored or absent; both are terminal
            enough to know whether a profile exists). */}
        {graphScan.isTestbed && !quizProfileRestorePending && (
          <button
            onClick={onContinue}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide px-2.5 py-1 rounded border border-amber-500/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 transition-colors"
            title="Testbed only — skips ahead to Personas without waiting for document generation"
          >
            <ArrowRight className="w-3 h-3" />
            <span>[Debug] Skip to Personas</span>
          </button>
        )}
      </header>

      {/* 2. THREE-PANEL BODY */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL: Phase Indicator */}
        <aside className="w-64 bg-[#111111] border-r border-[#2D2D2D] p-4 flex flex-col justify-between shrink-0 select-none">
          <div className="space-y-6">
            <div className="pb-2 border-b border-[#2D2D2D]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#A1A1A1] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#0078D4]"></span>
                Execution Phases
              </h2>
            </div>

            {/* Phases List */}
            <div className="space-y-4">
              {/* Phase 1: Graph API */}
              <div
                className={`p-3 rounded-lg border transition-all ${
                  phase === 'phase1_graph'
                    ? 'bg-[#0078D4]/10 border-[#0078D4] shadow-md ring-1 ring-[#0078D4]/30'
                    : phase === 'phase2_engines' || phase === 'phase3_docs' || phase === 'complete'
                    ? 'bg-[#161616] border-[#2D2D2D]'
                    : 'bg-[#141414] border-[#222222] opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {/* Status Dot */}
                    {phase === 'phase1_graph' ? (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0078D4]"></span>
                      </span>
                    ) : phase === 'phase2_engines' || phase === 'phase3_docs' || phase === 'complete' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#444444]" />
                    )}
                    <span className="text-xs font-bold text-white">1. Graph API</span>
                  </div>

                  {/* Real state: a blocked/failed tenant scan says so here
                      instead of sitting on a permanent "Running". */}
                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      phase !== 'phase1_graph'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold'
                        : graphScan.scanFailed
                        ? 'bg-rose-500/10 text-rose-300 border border-rose-500/40 font-bold'
                        : graphScan.scanActive || graphScan.triggering
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                        : 'bg-[#222222] text-[#888888] border border-[#333333]'
                    }`}
                  >
                    {phase !== 'phase1_graph'
                      ? 'Complete'
                      : graphScan.scanFailed
                      ? 'Blocked'
                      : graphScan.scanActive || graphScan.triggering
                      ? 'Running'
                      : 'Waiting'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Real Microsoft Graph diagnostics run for your tenant — consent, package and per-check results.
                </p>
              </div>

              {/* Phase 2: Engines Execution */}
              <div
                className={`p-3 rounded-lg border transition-all ${
                  phase === 'phase2_engines'
                    ? 'bg-[#0078D4]/10 border-[#0078D4] shadow-md ring-1 ring-[#0078D4]/30'
                    : phase === 'phase3_docs' || phase === 'complete'
                    ? 'bg-[#161616] border-[#2D2D2D]'
                    : 'bg-[#141414] border-[#222222] opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {phase === 'phase2_engines' ? (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0078D4]"></span>
                      </span>
                    ) : phase === 'phase3_docs' || phase === 'complete' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#444444]" />
                    )}
                    <span className="text-xs font-bold text-white">2. Telemetry Engines</span>
                  </div>

                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      phase === 'phase2_engines'
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                        : phase === 'phase3_docs' || phase === 'complete'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold'
                        : 'bg-[#222222] text-[#666666]'
                    }`}
                  >
                    {phase === 'phase2_engines'
                      ? `${completedEnginesCount}/${engines.length}`
                      : phase === 'phase3_docs' || phase === 'complete'
                      ? 'Complete'
                      : 'Pending'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Sequential pass across the {engines.length} intelligence engines.
                </p>
              </div>

              {/* Phase 3: Document Generation */}
              <div
                className={`p-3 rounded-lg border transition-all ${
                  phase === 'phase3_docs'
                    ? 'bg-[#0078D4]/10 border-[#0078D4] shadow-md ring-1 ring-[#0078D4]/30'
                    : phase === 'complete'
                    ? 'bg-[#161616] border-[#2D2D2D]'
                    : 'bg-[#141414] border-[#222222] opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {phase === 'phase3_docs' ? (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0078D4]"></span>
                      </span>
                    ) : phase === 'complete' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#444444]" />
                    )}
                    <span className="text-xs font-bold text-white">3. Document Gen</span>
                  </div>

                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      phase === 'phase3_docs' && docWf.docGenError
                        ? 'bg-rose-500/10 text-rose-300 border border-rose-500/40 font-bold'
                        : phase === 'phase3_docs'
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                        : phase === 'complete'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold'
                        : 'bg-[#222222] text-[#666666]'
                    }`}
                  >
                    {phase === 'phase3_docs'
                      ? docWf.docGenError
                        ? 'Failed'
                        : `${completedDocsCount}/${docs.length}`
                      : phase === 'complete'
                      ? 'Complete'
                      : 'Pending'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Live progress of the real document-generation run for your account — your own
                  documents, then the SOW, then your presentation.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[#161616] border border-[#2D2D2D] rounded text-[10px] font-mono text-[#666666] leading-relaxed">
            SYSTEM TELEMETRY ENGINE:
            <br />
            v{versionInfo.display}
          </div>
        </aside>

        {/* CENTER PANEL: Stage & Tile Grid */}
        <main className="flex-1 overflow-y-auto bg-[#0F0F0F] p-6 flex flex-col justify-between scrollbar-thin">
          <div className="space-y-6 max-w-5xl mx-auto w-full">
            {/* Header Title & Unified Progress Bar */}
            <div className="bg-[#161616] border border-[#2D2D2D] p-5 rounded-xl space-y-4 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 text-xs font-mono text-[#0078D4] font-bold bg-[#0078D4]/10 border border-[#0078D4]/30 px-2.5 py-0.5 rounded-full mb-1">
                    <Activity className="w-3.5 h-3.5 animate-pulse" />
                    <span>Real-Time Telemetry Correlation</span>
                  </div>
                  <h2 className="text-xl font-bold text-white">
                    {phase === 'phase1_graph' &&
                      (graphScan.scanFailed
                        ? 'Microsoft 365 scan blocked'
                        : graphScan.scanActive
                        ? 'Scanning your Microsoft 365 tenant'
                        : 'Connecting to Microsoft 365')}
                    {phase === 'phase2_engines' && 'Analyzing Tenant Telemetry'}
                    {phase === 'phase3_docs' &&
                      (docWf.docGenError
                        ? 'Document generation failed'
                        : docWf.finishedWithoutProgress
                        ? 'Assessment run reported no document progress'
                        : docWf.runId == null
                        ? 'Waiting for your assessment run to start'
                        : 'Generating Assessment Documents')}
                    {phase === 'complete' && 'Telemetry Analysis Complete'}
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-2xl font-extrabold font-mono text-white tracking-tight">
                      {overallProgress}%
                    </span>
                    <span className="text-xs text-[#888888] block">Overall Completion</span>
                  </div>
                </div>
              </div>

              {/* Unified Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full bg-[#111111] h-3 rounded-full overflow-hidden border border-[#2D2D2D] p-0.5">
                  <div
                    className="bg-gradient-to-r from-[#0078D4] via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-300"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>

                {/* Inline stream row. Phase 1 is the real diagnostics run (poll +
                    diagnostics SSE) and phase 3 is the real doc-generation
                    workflow run (poll + its run-scoped SSE stream); phase 2's
                    line is the cosmetic engines pass, labelled as a pass rather
                    than as a live stream. */}
                {(() => {
                  const streamFailed =
                    phase === 'phase1_graph'
                      ? graphScan.scanFailed
                      : phase === 'phase3_docs' || phase === 'complete'
                        ? docWf.docGenError != null
                        : false;
                  return (
                    <div
                      className={`flex items-center gap-2 pt-1 text-xs font-mono bg-[#111111] px-3 py-1.5 rounded border border-[#222222] ${
                        streamFailed ? 'text-rose-300' : 'text-emerald-400'
                      }`}
                      title={currentSseStream}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          streamFailed ? 'bg-rose-400' : 'bg-emerald-400 animate-ping'
                        }`}
                      />
                      <span className="truncate">
                        {phase === 'phase1_graph'
                          ? 'Live scan: '
                          : phase === 'phase2_engines'
                            ? 'Engines pass: '
                            : 'Live run: '}
                        {currentSseStream}
                      </span>
                    </div>
                  );
                })()}
              </div>

            </div>

            {/* PHASE 1 TILE GRID — REAL MICROSOFT GRAPH SCAN (#228)
                Restyled to match Mode 1/2's carousel visual language (#254): the
                same rounded/bordered card shell, the same purple gradient
                background and header badge chip as UnifiedTelemetryCarousel.tsx,
                so all three modes read as one visual system. Visual only — every
                status badge and log line below is still real state of the real
                diagnostics run for this customer's tenant
                (useRealGraphScanSteps.ts). Nothing here is on a timer, and a tile
                with no real signal behind it stays pending. */}
            {phase === 'phase1_graph' && (
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-border">
                {/* BACKGROUND — same Copilot purple gradient as Mode 1/2 */}
                <div className="absolute inset-0 bg-gradient-to-r from-[#21093A]/90 via-[#0A1D3F]/90 to-[#022F43]/90 backdrop-blur-xl border border-purple-500/40" />

                {/* CONTENT RAIL */}
                <div className="relative z-10 p-4 space-y-3.5">
                  {/* HEADER RAIL — matches carousel's header badge chip pattern */}
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-purple-500/20 border border-purple-500/50 text-purple-300">
                        <Server className="w-4 h-4 animate-pulse" />
                        <span className="text-xs font-bold font-mono tracking-wider uppercase">
                          MODE 0: MICROSOFT GRAPH CONNECTION ({graphScan.steps.length})
                        </span>
                      </div>

                      <span className="text-xs font-mono font-bold text-foreground/80">
                        {graphScan.steps.filter(s => s.status === 'complete').length}/{graphScan.steps.length} Complete
                      </span>
                    </div>

                    {/* Heartbeat Line — same animate-waveform SVG pattern as the Mode 1 right-panel
                        background (#276), filling the empty space to the right of the complete count */}
                    <div className="flex-1 h-8 overflow-hidden pointer-events-none opacity-25 ml-4">
                      <div className="w-[200%] h-full flex items-center animate-waveform">
                        <svg className="w-full h-16 text-[#0078D4]" fill="none" viewBox="0 0 1200 60">
                          <path
                            d="M 0 30 Q 50 30 100 30 L 120 30 L 130 10 L 140 50 L 150 5 L 160 40 L 170 30 L 200 30 Z"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {graphScan.steps.map(step => {
                      const st = step.status;
                      return (
                        <div
                          key={step.id}
                          className={`p-3.5 rounded-xl border transition-all duration-300 flex flex-col justify-between ${
                            st === 'error'
                              ? 'bg-background/90 border-rose-500/60 ring-1 ring-rose-500/30'
                              : st === 'running'
                              ? 'bg-background/90 border-primary ring-1 ring-primary/50 shadow-lg shadow-primary/10'
                              : st === 'complete'
                              ? 'bg-background/80 border-status-green/40'
                              : 'bg-muted/40 border-border opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                                  st === 'error'
                                    ? 'bg-rose-500/15 border-rose-500 text-rose-400'
                                    : st === 'complete'
                                    ? 'bg-status-green/15 border-status-green text-status-green'
                                    : st === 'running'
                                    ? 'bg-primary/30 border-primary text-primary'
                                    : 'bg-foreground/5 border-border text-foreground/50'
                                }`}
                              >
                                {st === 'error' ? (
                                  <AlertCircle className="w-3.5 h-3.5" />
                                ) : st === 'complete' ? (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                ) : st === 'running' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Server className="w-3.5 h-3.5" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-foreground truncate">{step.title}</h4>
                                <p className="text-[10.5px] text-foreground/60 truncate">{step.subtitle}</p>
                              </div>
                            </div>

                            <span
                              className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 font-bold ${
                                st === 'error'
                                  ? 'bg-rose-950/90 text-rose-300 border-rose-700'
                                  : st === 'complete'
                                  ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700'
                                  : st === 'running'
                                  ? 'bg-[#0078D4]/20 text-[#0078D4] border-[#0078D4]/40'
                                  : 'bg-muted/60 text-foreground/50 border-border'
                              }`}
                            >
                              {st}
                            </span>
                          </div>

                          {/* Real log line for this step — live run state, no script */}
                          <div className="mt-3 pt-2 border-t border-border">
                            <div
                              className={`text-[9.5px] font-mono truncate flex items-center gap-1 ${
                                st === 'error' ? 'text-rose-300' : 'text-primary'
                              }`}
                              title={step.message}
                            >
                              <span>↳</span>
                              <span className="truncate">{step.message}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* UNIFIED TELEMETRY CAROUSEL (ENGINES + DOCUMENTS) — gated on
                phase !== 'phase1_graph' (#251), same as the Phase 1 tile
                group above: Mode 1's cosmetic engine tiles have no business
                appearing while the real Phase 1 Graph scan is still running. */}
            {phase !== 'phase1_graph' && (
              <UnifiedTelemetryCarousel
                phase={phase}
                engines={engines}
                completedEnginesCount={completedEnginesCount}
                docs={docs}
                completedDocsCount={completedDocsCount}
                renderEngineIcon={renderEngineIcon}
                emptyDocsMessage={docWf.streamMessage}
              />
            )}
          </div>

          {/* Completion Banner & Next Step Action */}
          {phase === 'complete' && (
            <div className="mt-6 bg-[#161616] border border-emerald-500/40 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Telemetry Analysis & Document Deliverables Complete!</h3>
                  <p className="text-xs text-[#A1A1A1]">
                    Tenant signal scan complete. Actual telemetry score calculated and document guides ready.
                  </p>
                </div>
              </div>

              <button
                onClick={onContinue}
                className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0060B0] text-white font-bold px-6 py-2.5 rounded-lg text-xs shadow-lg transition-all shrink-0"
              >
                <span>Continue to Persona Stories</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </main>

        {/* RIGHT PANEL: Real-time Telemetry Assessment Comparison */}
        <aside
          className={`w-80 relative flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin select-none p-4 transition-all duration-700 border-l ${
            isDocumentMode ? 'border-purple-500/40 text-purple-100' : 'border-[#0078D4]/40 text-sky-100'
          }`}
        >
          {/* MODE 1 BACKGROUND: Engine Phase (Deep blue pulse glow + Heartbeat line) */}
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${
              !isDocumentMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } bg-[#02152E]/95 backdrop-blur-xl animate-pulse-glow`}
          />

          {/* Heartbeat Line Overlay (Mode 1) */}
          <div
            className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${
              !isDocumentMode ? 'opacity-25' : 'opacity-0'
            }`}
          >
            <div className="w-[200%] h-full flex items-center animate-waveform">
              <svg className="w-full h-16 text-[#0078D4]" fill="none" viewBox="0 0 1200 60">
                <path
                  d="M 0 30 Q 50 30 100 30 L 120 30 L 130 10 L 140 50 L 150 5 L 160 40 L 170 30 L 200 30 Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          {/* MODE 2 BACKGROUND: Document Phase (Copilot gradient + AI sparkles + subtle shimmer) */}
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${
              isDocumentMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } bg-gradient-to-b from-[#1E0933]/95 via-[#0A1D3F]/95 to-[#022A3D]/95 backdrop-blur-xl`}
          />

          {/* Soft AI Sparkle Particles (Mode 2) */}
          <div
            className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${
              isDocumentMode ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Sparkles className="absolute left-[15%] bottom-0 w-3.5 h-3.5 text-purple-400 animate-sparkle-1" />
            <Sparkles className="absolute left-[50%] bottom-0 w-4 h-4 text-cyan-400 animate-sparkle-3" />
            <Sparkles className="absolute left-[80%] bottom-0 w-3 h-3 text-sky-300 animate-sparkle-5" />
          </div>

          {/* Subtle Shimmer Sweep Overlay */}
          <div className="absolute inset-0 pointer-events-none animate-shimmer opacity-20" />

          {/* PANEL CONTENT LAYER */}
          <div className="relative z-10 space-y-5">
            {/* Title */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isDocumentMode ? 'bg-purple-400' : 'bg-[#0078D4]'} animate-pulse`}></span>
                Telemetry Comparison
              </h2>
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                isDocumentMode
                  ? 'text-purple-300 bg-purple-500/10 border-purple-500/30'
                  : 'text-[#0078D4] bg-[#0078D4]/10 border-[#0078D4]/30'
              }`}>
                Self vs Actual
              </span>
            </div>

            {/* DUAL CIRCULAR GAUGES: Self-Assessment vs Actual Telemetry */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/80">
                <span>Score Comparison</span>
                <span className="text-[10px] font-mono text-white/50">0 – 100</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                {/* Self-Assessment Score Gauge */}
                <div className="flex flex-col items-center space-y-1 bg-black/40 p-2 rounded-lg border border-white/5 relative">
                  <span className="text-[10px] font-mono text-white/60">Self-Assessed</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    {/* Rotating Highlight Ring */}
                    <div className="absolute inset-0 rounded-full border border-sky-400/20 animate-ring-rotate pointer-events-none" />
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth={gaugeStrokeWidth} fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={radius}
                        stroke="#0078D4"
                        strokeWidth={gaugeStrokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={selfDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-white font-mono">
                      {selfScore}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#0078D4] font-bold">Quiz Baseline</span>
                </div>

                {/* Actual Telemetry Score Gauge */}
                <div className="flex flex-col items-center space-y-1 bg-black/40 p-2 rounded-lg border border-white/5 relative">
                  <span className="text-[10px] font-mono text-white/60">Actual Telemetry</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    {/* Rotating Highlight Ring */}
                    <div className="absolute inset-0 rounded-full border border-amber-400/30 animate-ring-rotate pointer-events-none" />
                    <svg className={`w-16 h-16 transform -rotate-90 ${
                      actualTelemetryScore > 0 ? 'drop-shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse' : ''
                    }`}>
                      <circle cx="32" cy="32" r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth={gaugeStrokeWidth} fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={radius}
                        stroke={actualTelemetryScore > 0 ? '#F59E0B' : '#444444'}
                        strokeWidth={gaugeStrokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={actualDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-amber-400 font-mono">
                      {comparison.actualScore ?? '—'}
                    </span>
                  </div>
                  {/* Real state of the real engine, never a generic "Live" label:
                      a tenant the engine has no data for says so. */}
                  <span className="text-[9px] font-mono text-amber-400 font-bold">
                    {comparison.actualScore == null
                      ? comparison.loaded
                        ? 'No engine data'
                        : 'Loading…'
                      : comparison.live
                        ? 'Live · updating'
                        : 'Health Engine'}
                  </span>
                </div>
              </div>
            </div>

            {/* RADAR CHART COMPARISON */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/80">
                <span>Multi-Dimension Radar</span>
                <div className="flex items-center gap-2 text-[9px] font-mono">
                  {/* No "Self" series — there is no real quiz-answer → pillar
                      self-score mapping to draw one from (see
                      telemetryComparison.ts). The legend states what is really
                      plotted rather than implying a comparison that isn't there. */}
                  <span className="flex items-center gap-1 text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400" /> Health Engine
                  </span>
                </div>
              </div>

              <div className="h-44 w-full relative">
                {/* Faint Radar Sweep Animation Background */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                  <div className="w-32 h-32 rounded-full border border-sky-400/30 relative overflow-hidden animate-radar-sweep">
                    <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-gradient-to-bl from-sky-400/50 to-transparent" />
                  </div>
                </div>


                {/* A pillar the engine has no real data for is absent, not
                    zero-filled — so an empty radar is reported honestly rather
                    than drawn as a collapsed shape. */}
                {radarData.length === 0 ? (
                  <div className="h-full w-full flex items-center justify-center text-center px-3">
                    <p className="text-[10px] font-mono text-white/50 leading-relaxed">
                      {comparison.loaded
                        ? 'No pillar has real signal data for your tenant yet — the radar fills in as your scan collects it.'
                        : 'Loading your tenant’s real pillar scores…'}
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.15)" />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: '#A1A1A1', fontSize: 8 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar
                        name="Health Engine"
                        dataKey="actual"
                        stroke="#F59E0B"
                        fill="#F59E0B"
                        fillOpacity={0.4}
                        className="transition-all duration-700"
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* GAP BARS */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2.5 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/80">
                <span className="flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dimension Gap Analysis</span>
                </span>
                <span className="text-[9.5px] font-mono text-white/50">
                  {comparison.live ? 'Live Delta' : 'Health Engine'}
                </span>
              </div>

              {/* One bar per REAL pillar, worst real exposure first — the same
                  per-pillar display scores the radar plots, from the same engine
                  breakdown, so the two elements can no longer disagree. The blue
                  segment is the pillar's real health, the rose segment its real
                  distance from full health. Baselines here used to be literals
                  (75 / 30 / 40 / 80) standing in for a self-assessment that was
                  never collected — see the design question in
                  telemetryComparison.ts. */}
              <div className="space-y-2 text-[10px]">
                {gapBars.length === 0 ? (
                  <p className="text-[10px] font-mono text-white/50 leading-relaxed">
                    {comparison.loaded
                      ? 'No pillar has real signal data for your tenant yet.'
                      : 'Loading your tenant’s real pillar exposure…'}
                  </p>
                ) : (
                  gapBars.map(bar => (
                    <div key={bar.pillar} className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span className="text-white/80">{bar.axis}</span>
                        <span className="font-mono text-rose-400 font-bold">-{bar.gap}% Exposure</span>
                      </div>
                      <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden flex border border-white/5 relative">
                        <div
                          className="bg-[#0078D4] h-full transition-all duration-700 ease-out relative overflow-hidden"
                          style={{ width: `${bar.actual}%` }}
                        >
                          <div className="absolute inset-0 animate-shimmer opacity-30" />
                        </div>
                        <div
                          className="bg-rose-500 h-full transition-all duration-700 ease-out relative overflow-hidden"
                          style={{ width: `${bar.gap}%` }}
                        >
                          <div className="absolute inset-0 animate-shimmer opacity-50" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* MINIMALIST DISCREPANCY SEVERITY CHIPS */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Top Discrepancies</span>
                </div>
                <span className="text-[9px] font-mono text-amber-300/70">{topDiscrepancies.length} Detected</span>
              </div>

              {/* REAL critical/warning findings (#245). Previously three hardcoded
                  strings from generateTop3Mismatches ("Unlabeled files (62%)",
                  "14 SharePoint sites", "CA01 policy disabled") that were
                  identical for every customer and every scan.
                  Two real sources, and the card says which it is showing:
                    • live   — the run currently streaming, classified from its
                               own per-check results by the same rule the server
                               uses when it writes the finding rows;
                    • persisted — that run's real msp_diagnostic_findings once it
                               has finished writing them.
                  The "Quiz:" line is gone: there is no real quiz-answer → finding
                  mapping to compare against (see telemetryComparison.ts). */}
              <div className="space-y-2 text-[10px]">
                {topDiscrepancies.length === 0 ? (
                  <p className="text-[9.5px] font-mono text-white/50 leading-relaxed">
                    {!comparison.loaded
                      ? 'Loading your tenant’s real findings…'
                      : comparison.live
                        ? 'No critical or warning result from your scan yet.'
                        : 'Your last scan returned no critical or warning findings.'}
                  </p>
                ) : (
                  topDiscrepancies.map(d => {
                    const isHigh = d.severity === 'critical';

                    const borderBg = isHigh
                      ? 'border-rose-500/50 bg-rose-950/40 text-rose-200'
                      : 'border-amber-500/50 bg-amber-950/40 text-amber-200';

                    const badgeColor = isHigh
                      ? 'bg-rose-500/30 text-rose-300 border-rose-500/60'
                      : 'bg-amber-500/30 text-amber-300 border-amber-500/60';

                    return (
                      <div
                        key={d.id}
                        className={`p-2.5 rounded-lg border backdrop-blur-sm transition-all duration-300 animate-fade-slide ${borderBg}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-rose-500' : 'bg-amber-500'} animate-pulse`} />
                            {d.title}
                          </span>
                          <span className={`text-[8.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}>
                            {d.severity}
                          </span>
                        </div>

                        <div className="text-[9.5px] font-mono font-medium text-amber-300/90 truncate">
                          {d.live ? 'Live check' : 'Finding'}: {d.checkKey}
                        </div>
                        <p className="text-[9.5px] text-white/70 leading-tight mt-0.5 line-clamp-2">
                          {d.detail}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
