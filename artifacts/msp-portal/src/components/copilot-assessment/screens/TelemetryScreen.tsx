import React, { useState, useEffect, useRef } from 'react';
import { UnifiedTelemetryCarousel } from '../telemetry/UnifiedTelemetryCarousel';
import {
  Activity,
  CheckCircle2,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  Shield,
  ShieldAlert,
  Zap,
  ArrowRight,
  Server,
  AlertCircle,
  HelpCircle,
  X,
  Lock,
  Users,
  Database,
  Key,
  FileCode,
  Sliders,
  Sparkles,
  FileText,
  ChevronRight,
  ChevronLeft,
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
import {
  GRAPH_API_STEPS,
  TELEMETRY_ENGINES,
  TELEMETRY_DOCS,
  generateDynamicHintCards,
  generateTop3Mismatches,
  TelemetryEngineDef,
  TelemetryDocDef
} from '../../data/telemetryCatalog';

interface TelemetryScreenProps {
  quizAnswers?: Record<string, string>;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
}

type TelemetryPhase = 'phase1_graph' | 'phase2_engines' | 'phase3_docs' | 'complete';

export const TelemetryScreen: React.FC<TelemetryScreenProps> = ({
  quizAnswers = {},
  onContinue,
  onHelpClick,
  onExitClick
}) => {
  // Phase state
  const [phase, setPhase] = useState<TelemetryPhase>('phase1_graph');
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1); // 1x, 2x, 4x speed

  // Phase 1 Graph API State
  const [graphStepIndex, setGraphStepIndex] = useState<number>(0);
  const [graphStepProgress, setGraphStepProgress] = useState<number>(0);
  const [graphStatus, setGraphStatus] = useState<Array<'pending' | 'running' | 'complete'>>([
    'running',
    'pending',
    'pending',
    'pending'
  ]);

  // Phase 2 Engines State
  const [engines, setEngines] = useState<
    Array<TelemetryEngineDef & { status: 'pending' | 'running' | 'complete'; progress: number; currentSseMsg: string }>
  >(() =>
    TELEMETRY_ENGINES.map(e => ({
      ...e,
      status: 'pending',
      progress: 0,
      currentSseMsg: e.sseMessages[0]
    }))
  );
  const [activeEngineIndex, setActiveEngineIndex] = useState<number>(0);

  // Phase 3 Documents State
  const [docs, setDocs] = useState<
    Array<TelemetryDocDef & { status: 'pending' | 'running' | 'complete'; progress: number; currentSseMsg: string }>
  >(() =>
    TELEMETRY_DOCS.map(d => ({
      ...d,
      status: 'pending',
      progress: 0,
      currentSseMsg: d.sseMessages[0]
    }))
  );
  const [activeDocIndex, setActiveDocIndex] = useState<number>(0);

  // SSE Stream Message
  const [currentSseStream, setCurrentSseStream] = useState<string>(
    'Initiating OAuth2 session with Microsoft Graph API...'
  );

  // Dynamic Hint Cards Carousel Index
  const [hintCardIndex, setHintCardIndex] = useState<number>(0);
  const [ribbonPulse, setRibbonPulse] = useState<boolean>(false);

  useEffect(() => {
    setRibbonPulse(true);
    const timer = setTimeout(() => setRibbonPulse(false), 1200);
    return () => clearTimeout(timer);
  }, [hintCardIndex]);

  const isDocumentMode = phase === 'phase3_docs' || phase === 'complete';

  // Compute Completed Counts
  const completedEnginesCount = engines.filter(e => e.status === 'complete').length;
  const completedDocsCount = docs.filter(d => d.status === 'complete').length;

  // Unified Overall Progress Calculation (0 to 100%)
  // Phase 1 = 0% to 25%
  // Phase 2 = 25% to 75%
  // Phase 3 = 75% to 100%
  let overallProgress = 0;
  if (phase === 'phase1_graph') {
    const stepWeight = 25 / GRAPH_API_STEPS.length;
    const completedSteps = graphStatus.filter(s => s === 'complete').length;
    const runningStepContrib = graphStatus.includes('running') ? (graphStepProgress / 100) * stepWeight : 0;
    overallProgress = Math.min(25, Math.round(completedSteps * stepWeight + runningStepContrib));
  } else if (phase === 'phase2_engines') {
    const engineWeight = 50 / TELEMETRY_ENGINES.length;
    const runningContrib = engines[activeEngineIndex]?.status === 'running' ? (engines[activeEngineIndex].progress / 100) * engineWeight : 0;
    overallProgress = Math.min(75, Math.round(25 + completedEnginesCount * engineWeight + runningContrib));
  } else if (phase === 'phase3_docs' || phase === 'complete') {
    const docWeight = 25 / TELEMETRY_DOCS.length;
    const runningContrib = docs[activeDocIndex]?.status === 'running' ? (docs[activeDocIndex].progress / 100) * docWeight : 0;
    overallProgress = Math.min(100, Math.round(75 + completedDocsCount * docWeight + runningContrib));
  }

  // Dynamic Hint Cards Stream
  const dynamicHints = generateDynamicHintCards(
    quizAnswers,
    phase === 'phase3' || phase === 'complete' ? 'phase3' : phase === 'phase2_engines' ? 'phase2' : 'phase1',
    completedEnginesCount
  );

  // Auto-rotate Insight Ribbon every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHintCardIndex(prev => (prev + 1) % Math.max(1, dynamicHints.length));
    }, 5000);
    return () => clearInterval(interval);
  }, [dynamicHints.length]);

  // Main Simulation Engine Effect
  useEffect(() => {
    if (!isSimulating) return;

    const intervalTime = 120 / simSpeed;
    const timer = setInterval(() => {
      // PHASE 1: GRAPH API
      if (phase === 'phase1_graph') {
        setGraphStepProgress(prevProgress => {
          if (prevProgress < 100) {
            const nextProgress = prevProgress + 10;
            // Update SSE message
            const currentStepDef = GRAPH_API_STEPS[graphStepIndex];
            if (currentStepDef) {
              const msgIdx = Math.min(
                currentStepDef.sseMessages.length - 1,
                Math.floor((nextProgress / 100) * currentStepDef.sseMessages.length)
              );
              setCurrentSseStream(currentStepDef.sseMessages[msgIdx]);
            }
            return nextProgress;
          } else {
            // Step complete
            setGraphStatus(prev => {
              const copy = [...prev];
              copy[graphStepIndex] = 'complete';
              if (graphStepIndex + 1 < GRAPH_API_STEPS.length) {
                copy[graphStepIndex + 1] = 'running';
              }
              return copy;
            });

            if (graphStepIndex + 1 < GRAPH_API_STEPS.length) {
              setGraphStepIndex(prev => prev + 1);
              return 0;
            } else {
              // Transition to Phase 2
              setPhase('phase2_engines');
              setCurrentSseStream('Graph API session established. Starting 12 Correlation Engines...');
              setEngines(prev => prev.map((e, idx) => (idx === 0 ? { ...e, status: 'running', progress: 0 } : e)));
              return 100;
            }
          }
        });
      }

      // PHASE 2: ENGINES EXECUTION
      else if (phase === 'phase2_engines') {
        setEngines(prevEngines => {
          const activeEngine = prevEngines[activeEngineIndex];
          if (!activeEngine) return prevEngines;

          if (activeEngine.progress < 100) {
            const nextProgress = Math.min(100, activeEngine.progress + 15);
            const msgIdx = Math.min(
              activeEngine.sseMessages.length - 1,
              Math.floor((nextProgress / 100) * activeEngine.sseMessages.length)
            );
            const nextSse = activeEngine.sseMessages[msgIdx];
            setCurrentSseStream(`[${activeEngine.name}] ${nextSse}`);

            return prevEngines.map((e, idx) =>
              idx === activeEngineIndex ? { ...e, progress: nextProgress, currentSseMsg: nextSse } : e
            );
          } else {
            // Active engine complete
            const updated = prevEngines.map((e, idx) =>
              idx === activeEngineIndex ? { ...e, status: 'complete' as const, progress: 100 } : e
            );

            if (activeEngineIndex + 1 < TELEMETRY_ENGINES.length) {
              const nextIdx = activeEngineIndex + 1;
              setActiveEngineIndex(nextIdx);
              updated[nextIdx] = {
                ...updated[nextIdx],
                status: 'running' as const,
                progress: 0
              };
            } else {
              // Phase 2 complete -> Phase 3
              setPhase('phase3_docs');
              setCurrentSseStream('Telemetry Engine Analysis Complete. Initiating Document Generation...');
              setDocs(prev => prev.map((d, idx) => (idx === 0 ? { ...d, status: 'running', progress: 0 } : d)));
            }
            return updated;
          }
        });
      }

      // PHASE 3: DOCUMENT GENERATION
      else if (phase === 'phase3_docs') {
        setDocs(prevDocs => {
          const activeDoc = prevDocs[activeDocIndex];
          if (!activeDoc) return prevDocs;

          if (activeDoc.progress < 100) {
            const nextProgress = Math.min(100, activeDoc.progress + 8);
            const msgIdx = Math.min(
              activeDoc.sseMessages.length - 1,
              Math.floor((nextProgress / 100) * activeDoc.sseMessages.length)
            );
            const nextSse = activeDoc.sseMessages[msgIdx];
            setCurrentSseStream(`[${activeDoc.name}] ${nextSse}`);

            return prevDocs.map((d, idx) =>
              idx === activeDocIndex ? { ...d, progress: nextProgress, currentSseMsg: nextSse } : d
            );
          } else {
            // Active document complete
            const updated = prevDocs.map((d, idx) =>
              idx === activeDocIndex ? { ...d, status: 'complete' as const, progress: 100 } : d
            );

            if (activeDocIndex + 1 < TELEMETRY_DOCS.length) {
              const nextIdx = activeDocIndex + 1;
              setActiveDocIndex(nextIdx);
              updated[nextIdx] = {
                ...updated[nextIdx],
                status: 'running' as const,
                progress: 0
              };
            } else {
              // Phase 3 Complete!
              setPhase('complete');
              setIsSimulating(false);
              setCurrentSseStream('Telemetry Analysis & Document Deliverables Generation Complete!');
            }
            return updated;
          }
        });
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, [phase, isSimulating, simSpeed, graphStepIndex, activeEngineIndex, activeDocIndex]);

  // Restart Handler
  const handleRestart = () => {
    setPhase('phase1_graph');
    setGraphStepIndex(0);
    setGraphStepProgress(0);
    setGraphStatus(['running', 'pending', 'pending', 'pending']);
    setEngines(
      TELEMETRY_ENGINES.map(e => ({ ...e, status: 'pending', progress: 0, currentSseMsg: e.sseMessages[0] }))
    );
    setActiveEngineIndex(0);
    setDocs(
      TELEMETRY_DOCS.map(d => ({ ...d, status: 'pending', progress: 0, currentSseMsg: d.sseMessages[0] }))
    );
    setActiveDocIndex(0);
    setCurrentSseStream('Initiating OAuth2 session with Microsoft Graph API...');
    setIsSimulating(true);
  };

  // RIGHT PANEL SCORES & METRICS CALCULATIONS
  const selectedSensitivities = (quizAnswers['sensitivity'] || '').split(',').filter(Boolean);
  const selectedCollaborations = (quizAnswers['collaboration'] || '').split(',').filter(Boolean);
  const selectedPersonas = (quizAnswers['personas'] || '').split(',').filter(Boolean);
  const selectedUseCases = (quizAnswers['use-cases'] || '').split(',').filter(Boolean);

  // Multi-Select Sensitivity Risk Factor
  let sensRiskScore = 20;
  if (selectedSensitivities.length > 0) {
    const scores = selectedSensitivities.map(val => {
      if (['classified', 'phi', 'sec_reg', 'cui_restricted'].includes(val)) return 85;
      if (['mission_crit', 'hipaa_reg', 'sox', 'confidential'].includes(val)) return 65;
      if (['res_sens', 'mixed_sens', 'high_sens', 'internal'].includes(val)) return 45;
      return 20;
    });
    const maxSens = Math.max(...scores);
    const breadthBonus = Math.min(15, (selectedSensitivities.length - 1) * 5);
    sensRiskScore = Math.min(100, maxSens + breadthBonus);
  }

  // Multi-Select Collaboration Risk Factor
  let collabRiskScore = 35;
  if (selectedCollaborations.length > 0) {
    const scores = selectedCollaborations.map(val => {
      if (['cross_agency', 'multi_facility', 'client_facing', 'external_partners'].includes(val)) return 85;
      if (['cross_mission', 'department', 'firm_wide', 'cross_functional'].includes(val)) return 60;
      return 35;
    });
    const maxCollab = Math.max(...scores);
    const breadthBonus = Math.min(15, (selectedCollaborations.length - 1) * 5);
    collabRiskScore = Math.min(100, maxCollab + breadthBonus);
  }

  const engineProgressFactor = phase === 'phase1_graph' ? 0 : completedEnginesCount / TELEMETRY_ENGINES.length;

  // 1. Self-Assessment Score (from quiz)
  const selfScore = 72; // Baseline quiz readiness score

  // 2. Actual Telemetry Score incorporating multi-select sets
  const targetActualScore = Math.max(28, Math.min(65, Math.round(75 - (sensRiskScore * 0.28 + collabRiskScore * 0.22))));
  let actualTelemetryScore = 0;
  if (phase === 'phase1_graph') {
    actualTelemetryScore = 0;
  } else if (phase === 'phase2_engines') {
    actualTelemetryScore = Math.round(targetActualScore * engineProgressFactor);
  } else {
    actualTelemetryScore = targetActualScore;
  }

  // 3. Radar Chart Data incorporating multi-select sensitivity & collaboration
  const actualGov = Math.max(20, Math.round((82 - (sensRiskScore * 0.35 + collabRiskScore * 0.25)) * engineProgressFactor));
  const actualRisk = Math.min(95, Math.round((32 + sensRiskScore * 0.38 + collabRiskScore * 0.25) * engineProgressFactor));
  const actualAdoption = Math.min(90, Math.round((30 + collabRiskScore * 0.35 + (selectedPersonas.length * 3)) * engineProgressFactor));
  const actualFeasibility = Math.max(25, Math.round((85 - sensRiskScore * 0.35 - collabRiskScore * 0.15) * engineProgressFactor));
  const actualComplexity = Math.min(95, Math.round((35 + sensRiskScore * 0.25 + collabRiskScore * 0.32) * engineProgressFactor));
  const actualValue = Math.round((55 + (selectedUseCases.length * 3) + (collabRiskScore * 0.15) - (sensRiskScore * 0.1)) * engineProgressFactor);

  const radarData = [
    { axis: 'Governance', self: 75, actual: actualGov },
    { axis: 'Risk Posture', self: 30, actual: actualRisk },
    { axis: 'Adoption Friction', self: 40, actual: actualAdoption },
    { axis: 'Feasibility', self: 80, actual: actualFeasibility },
    { axis: 'Complexity', self: 65, actual: actualComplexity },
    { axis: 'Value Levers', self: 85, actual: actualValue }
  ];

  // Dynamic Mismatches
  const topMismatches = generateTop3Mismatches(quizAnswers);

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

  // SVG Gauge calculations
  const radius = 32;
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

        {/* Action Controls & Toolbar Right */}
        <div className="flex items-center gap-3">
          {/* Simulation Controls */}
          <div className="flex items-center gap-1.5 bg-[#161616] border border-[#2D2D2D] rounded px-2 py-1 text-[11px] font-mono">
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              className="text-[#CCCCCC] hover:text-white flex items-center gap-1 transition-colors px-1"
              title={isSimulating ? 'Pause Analysis' : 'Resume Analysis'}
            >
              {isSimulating ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isSimulating ? 'Pause' : 'Resume'}</span>
            </button>
            <span className="text-[#333333]">|</span>
            <button
              onClick={() => setSimSpeed(s => (s === 1 ? 2 : s === 2 ? 4 : 1))}
              className="text-[#0078D4] font-bold hover:underline px-1"
              title="Toggle Speed"
            >
              {simSpeed}x Speed
            </button>
            <span className="text-[#333333]">|</span>
            <button
              onClick={handleRestart}
              className="text-[#888888] hover:text-white flex items-center gap-1 transition-colors px-1"
              title="Restart Analysis"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          <button
            onClick={onHelpClick}
            className="p-1.5 hover:bg-[#222222] rounded text-[#A1A1A1] hover:text-white transition-colors"
            title="Help & Specification"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <button
            onClick={onExitClick}
            className="flex items-center gap-1.5 bg-[#1F1F1F] hover:bg-[#2D2D2D] text-xs text-[#CCCCCC] px-3 py-1 rounded border border-[#2D2D2D] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>
        </div>
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

                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      phase === 'phase1_graph'
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                        : phase !== 'phase1_graph'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold'
                        : 'bg-[#222222] text-[#666666]'
                    }`}
                  >
                    {phase === 'phase1_graph' ? 'Running' : 'Complete'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Microsoft Graph API connection, scope validation & telemetry stream.
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
                      ? `${completedEnginesCount}/12`
                      : phase === 'phase3_docs' || phase === 'complete'
                      ? 'Complete'
                      : 'Pending'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Sequential evaluation across 12 security, risk & drift engines.
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
                      phase === 'phase3_docs'
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                        : phase === 'complete'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold'
                        : 'bg-[#222222] text-[#666666]'
                    }`}
                  >
                    {phase === 'phase3_docs'
                      ? `${completedDocsCount}/6`
                      : phase === 'complete'
                      ? 'Complete'
                      : 'Pending'}
                  </span>
                </div>
                <p className="text-[10px] text-[#888888] mt-1.5 leading-relaxed">
                  Synthesizing 6 enterprise deliverable plans & ROI reports.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[#161616] border border-[#2D2D2D] rounded text-[10px] font-mono text-[#666666] leading-relaxed">
            SYSTEM TELEMETRY ENGINE:
            <br />
            v5.2 High-Throughput Correlation
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
                    {phase === 'phase1_graph' && 'Connecting to Microsoft 365'}
                    {phase === 'phase2_engines' && 'Analyzing Tenant Telemetry'}
                    {phase === 'phase3_docs' && 'Generating Assessment Documents'}
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

                {/* SSE Inline Stream Message Display */}
                <div className="flex items-center gap-2 pt-1 text-xs font-mono text-emerald-400 bg-[#111111] px-3 py-1.5 rounded border border-[#222222]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <span className="truncate">SSE Stream: {currentSseStream}</span>
                </div>
              </div>

              {/* INSIGHT RIBBON (QUIZ + TELEMETRY INTEGRATION) */}
              <div className="bg-[#001830] border border-[#0078D4]/60 px-4 py-3 rounded-lg relative overflow-hidden flex items-center justify-between gap-3 text-xs shadow-md mt-2">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-md bg-[#0078D4] text-white font-mono text-[10px] font-extrabold uppercase tracking-wider shadow">
                    <Sparkles className="w-3.5 h-3.5 text-sky-200 animate-pulse" />
                    <span>INSIGHT RIBBON</span>
                  </div>
                  <div className="overflow-hidden relative h-6 flex items-center min-w-0 flex-1">
                    <p
                      key={hintCardIndex}
                      className="text-xs sm:text-sm text-sky-100 font-semibold truncate italic animate-fade-slide"
                    >
                      "{dynamicHints[hintCardIndex] || 'Correlating quiz self-assessment with tenant signal telemetry...'}"
                    </p>
                  </div>
                </div>

                {/* Ribbon Navigation Controls & Counter */}
                <div className="flex items-center gap-2 shrink-0 bg-[#001020] px-2 py-1 rounded border border-[#0078D4]/30">
                  <span className="font-mono text-xs font-bold text-sky-300">
                    {hintCardIndex + 1}/{dynamicHints.length}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setHintCardIndex(prev => (prev - 1 + dynamicHints.length) % dynamicHints.length)}
                      className="p-1 hover:bg-[#0078D4]/30 rounded text-sky-300 hover:text-white transition-colors"
                      title="Previous insight"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setHintCardIndex(prev => (prev + 1) % dynamicHints.length)}
                      className="p-1 hover:bg-[#0078D4]/30 rounded text-sky-300 hover:text-white transition-colors"
                      title="Next insight"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* PHASE 1 TILE GRID — GRAPH API CONNECTION */}
            {phase === 'phase1_graph' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#A1A1A1]">
                    Tile Group: Microsoft Graph Connection
                  </h3>
                  <span className="text-xs font-mono text-[#0078D4]">4 Steps</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {GRAPH_API_STEPS.map((step, idx) => {
                    const st = graphStatus[idx];
                    return (
                      <div
                        key={step.id}
                        className={`p-3.5 rounded-xl border transition-all ${
                          st === 'running'
                            ? 'bg-[#161616] border-[#0078D4] ring-1 ring-[#0078D4]/30 shadow-lg'
                            : st === 'complete'
                            ? 'bg-[#161616]/80 border-[#2D2D2D]'
                            : 'bg-[#121212] border-[#222222] opacity-50'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                                st === 'complete'
                                  ? 'bg-emerald-950/80 border-emerald-700 text-emerald-400'
                                  : st === 'running'
                                  ? 'bg-[#0078D4]/20 border-[#0078D4] text-[#0078D4]'
                                  : 'bg-[#222222] border-[#333333] text-[#666666]'
                              }`}
                            >
                              {st === 'complete' ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : st === 'running' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Server className="w-4 h-4" />
                              )}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-white">{step.title}</h4>
                              <p className="text-[11px] text-[#888888]">{step.subtitle}</p>
                            </div>
                          </div>

                          <span
                            className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border ${
                              st === 'complete'
                                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                                : st === 'running'
                                ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 font-bold'
                                : 'bg-[#222222] text-[#666666] border-[#333333]'
                            }`}
                          >
                            {st}
                          </span>
                        </div>

                        {/* Details / Log Subtitle */}
                        <div className="mt-2.5 pt-2 border-t border-[#222222] text-[10px] font-mono text-[#A1A1A1] flex items-center gap-1">
                          <span className="text-[#0078D4]">↳</span>
                          <span className="truncate">{step.details}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* UNIFIED TELEMETRY CAROUSEL (ENGINES + DOCUMENTS) */}
            <UnifiedTelemetryCarousel
              phase={phase}
              engines={engines}
              completedEnginesCount={completedEnginesCount}
              docs={docs}
              completedDocsCount={completedDocsCount}
              renderEngineIcon={renderEngineIcon}
            />
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
          } ${ribbonPulse ? 'animate-ribbon-pulse' : ''}`}
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
                      <circle cx="32" cy="32" r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={radius}
                        stroke="#0078D4"
                        strokeWidth="5"
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
                      <circle cx="32" cy="32" r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={radius}
                        stroke={actualTelemetryScore > 0 ? '#F59E0B' : '#444444'}
                        strokeWidth="5"
                        strokeDasharray={circumference}
                        strokeDashoffset={actualDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-amber-400 font-mono">
                      {actualTelemetryScore}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-amber-400 font-bold">
                    {phase === 'phase1_graph' ? 'Scanning...' : 'Live Telemetry'}
                  </span>
                </div>
              </div>
            </div>

            {/* RADAR CHART COMPARISON */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-2 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/80">
                <span>Multi-Dimension Radar</span>
                <div className="flex items-center gap-2 text-[9px] font-mono">
                  <span className="flex items-center gap-1 text-[#0078D4]">
                    <span className="w-2 h-2 rounded-full bg-[#0078D4]" /> Self
                  </span>
                  <span className="flex items-center gap-1 text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400" /> Telemetry
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

                {/* Data pulse behind radar chart synced to ribbon cycle */}
                <div key={`radar-pulse-${hintCardIndex}`} className="absolute inset-0 pointer-events-none rounded-xl animate-ribbon-pulse" />

                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                    <PolarGrid stroke="rgba(255,255,255,0.15)" />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: '#A1A1A1', fontSize: 8 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      name="Self-Assessment"
                      dataKey="self"
                      stroke="#0078D4"
                      fill="#0078D4"
                      fillOpacity={0.25}
                      className="transition-all duration-700"
                    />
                    <Radar
                      name="Actual Telemetry"
                      dataKey="actual"
                      stroke="#F59E0B"
                      fill="#F59E0B"
                      fillOpacity={phase === 'phase1_graph' ? 0.05 : 0.40}
                      className="transition-all duration-700"
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* GAP BARS */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2.5 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/80">
                <span className="flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dimension Gap Analysis</span>
                </span>
                <span className="text-[9.5px] font-mono text-white/50">Live Delta</span>
              </div>

              <div className="space-y-2 text-[10px]">
                {/* Governance Gap */}
                <div className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-white/80">Governance Exposure</span>
                    <span className="font-mono text-rose-400 font-bold">-{Math.max(0, 75 - actualGov)}% Exposure</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden flex border border-white/5 relative">
                    <div
                      className="bg-[#0078D4] h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${actualGov}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-30" />
                    </div>
                    <div
                      className="bg-rose-500 h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${Math.max(0, 75 - actualGov)}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-50" />
                    </div>
                  </div>
                </div>

                {/* Risk Posture Gap */}
                <div className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-white/80">Unmonitored Risk Posture</span>
                    <span className="font-mono text-amber-400 font-bold">+{Math.max(0, actualRisk - 30)}% Risk</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden flex border border-white/5 relative">
                    <div
                      className="bg-[#0078D4] h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: '30%' }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-30" />
                    </div>
                    <div
                      className="bg-amber-500 h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${Math.max(0, actualRisk - 30)}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-50" />
                    </div>
                  </div>
                </div>

                {/* Adoption Friction Gap */}
                <div className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-white/80">Adoption Friction</span>
                    <span className="font-mono text-sky-400 font-bold">+{Math.max(0, actualAdoption - 40)}% Friction</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden flex border border-white/5 relative">
                    <div
                      className="bg-[#0078D4] h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: '40%' }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-30" />
                    </div>
                    <div
                      className="bg-sky-400 h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${Math.max(0, actualAdoption - 40)}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-50" />
                    </div>
                  </div>
                </div>

                {/* Feasibility Gap */}
                <div className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-white/80">Use-Case Feasibility</span>
                    <span className="font-mono text-purple-400 font-bold">-{Math.max(0, 80 - actualFeasibility)}% Blocked</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden flex border border-white/5 relative">
                    <div
                      className="bg-[#0078D4] h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${actualFeasibility}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-30" />
                    </div>
                    <div
                      className="bg-purple-500 h-full transition-all duration-700 ease-out relative overflow-hidden"
                      style={{ width: `${Math.max(0, 80 - actualFeasibility)}%` }}
                    >
                      <div className="absolute inset-0 animate-shimmer opacity-50" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* MINIMALIST DISCREPANCY SEVERITY CHIPS */}
            <div className="bg-black/30 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Top Discrepancies</span>
                </div>
                <span className="text-[9px] font-mono text-amber-300/70">{topMismatches.length} Detected</span>
              </div>

              <div className="space-y-2 text-[10px]">
                {topMismatches.map((m, idx) => {
                  const severity = m.severity || (idx === 0 ? 'high' : idx === 1 ? 'medium' : 'low');
                  const isHigh = severity === 'high';
                  const isMed = severity === 'medium';

                  const borderBg = isHigh
                    ? 'border-rose-500/50 bg-rose-950/40 text-rose-200'
                    : isMed
                    ? 'border-amber-500/50 bg-amber-950/40 text-amber-200'
                    : 'border-sky-500/50 bg-sky-950/40 text-sky-200';

                  const badgeColor = isHigh
                    ? 'bg-rose-500/30 text-rose-300 border-rose-500/60'
                    : isMed
                    ? 'bg-amber-500/30 text-amber-300 border-amber-500/60'
                    : 'bg-sky-500/30 text-sky-300 border-sky-500/60';

                  return (
                    <div
                      key={m.id || idx}
                      className={`p-2.5 rounded-lg border backdrop-blur-sm transition-all duration-300 animate-fade-slide ${borderBg}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-rose-500' : isMed ? 'bg-amber-500' : 'bg-sky-400'} animate-pulse`} />
                          {m.title}
                        </span>
                        <span className={`text-[8.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}>
                          {severity}
                        </span>
                      </div>

                      <div className="text-[9.5px] font-mono font-medium text-amber-300/90 truncate">
                        Quiz: {m.quizText}
                      </div>
                      <p className="text-[9.5px] text-white/70 leading-tight mt-0.5 line-clamp-2">
                        Telemetry: {m.telemetryText}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
