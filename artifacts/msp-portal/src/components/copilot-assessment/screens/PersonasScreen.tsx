import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { PersonaStory, QuizProfile, PersonaGenerationStatus } from '../types';
import {
  Users,
  ArrowRight,
  ShieldAlert,
  Zap,
  Terminal,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Lock,
  Cpu,
  Clock,
  DollarSign,
  HelpCircle,
  X,
  ExternalLink,
  Layers,
  Activity,
  TrendingUp,
  ChevronRight,
  Bookmark,
  Target,
  BarChart3,
  Lightbulb,
  Loader2
} from 'lucide-react';

import { TransformationSurface, TransformationData } from '../telemetry/TransformationSurface';
import { UseCaseIssueModal, UseCaseIssue } from '../UseCaseIssueModal';

interface PersonasScreenProps {
  quizProfile: QuizProfile | null;
  personas: PersonaStory[];
  personasStatus: PersonaGenerationStatus;
  personasError?: string | null;
  /** Real server-reported progress (#283) — derived from the model's actual streamed output, never a fabricated stage. */
  personasProgress?: { pct: number; label: string } | null;
  onSelectPersona?: (persona: PersonaStory) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: any) => void;
}

export const PersonasScreen: React.FC<PersonasScreenProps> = ({
  quizProfile,
  personas,
  personasStatus,
  personasError,
  personasProgress,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  const { fetchWithAuth } = useAuth();
  const [activePersonaId, setActivePersonaId] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [ribbonPulse, setRibbonPulse] = useState<boolean>(false);
  const [selectedIssue, setSelectedIssue] = useState<UseCaseIssue | null>(null);

  // Real elapsed-time counter (#283) — the one honest signal that always
  // updates regardless of whether the server has emitted any progress event
  // yet, so the loading state is never indistinguishable from actually stuck.
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  useEffect(() => {
    if (personasStatus !== 'loading' && !(personasStatus === 'idle' && personas.length === 0)) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [personasStatus, personas.length]);

  // Transformation Surface State
  const [transSliderPos, setTransSliderPos] = useState<number>(50);
  const [isTransExpanded, setIsTransExpanded] = useState<boolean>(false);

  // Real personas arrive asynchronously (#186) — default the rail selection to
  // the first one once they land, rather than a hardcoded mock id.
  useEffect(() => {
    if (personas.length > 0 && !personas.some(p => p.id === activePersonaId)) {
      setActivePersonaId(personas[0].id);
    }
  }, [personas, activePersonaId]);

  const activePersona = personas.find(p => p.id === activePersonaId) || personas[0];

  if (!quizProfile) {
    return (
      <PersonasStatusScreen
        icon={<AlertTriangle className="w-8 h-8 text-status-amber" />}
        title="Complete the quiz first"
        detail="Persona generation needs your quiz answers as context. Go back and finish the quiz to continue."
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
      />
    );
  }

  if (personasStatus === 'loading' || (personasStatus === 'idle' && personas.length === 0)) {
    const elapsedLabel = `${elapsedSeconds}s elapsed`;
    const detail = personasProgress?.label
      ? `${personasProgress.label} (${Math.round(personasProgress.pct)}%) — ${elapsedLabel}`
      : `Sending your profile to M365 Copilot… — ${elapsedLabel}`;
    return (
      <PersonasStatusScreen
        icon={<Loader2 className="w-8 h-8 text-primary animate-spin" />}
        title="Generating your persona cohort…"
        detail={detail}
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
      />
    );
  }

  if (personasStatus === 'error' || !activePersona) {
    return (
      <PersonasStatusScreen
        icon={<AlertTriangle className="w-8 h-8 text-destructive" />}
        title="Persona generation failed"
        detail={personasError || 'Something went wrong generating personas. Please try again.'}
        onExitClick={onExitClick}
        onHelpClick={onHelpClick}
      />
    );
  }

  const handleSelectPersona = (id: string) => {
    if (id === activePersonaId) return;
    if (isExpanded) {
      setIsExpanded(false);
    }
    setActivePersonaId(id);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 1200);
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 1000);
  };

  const handleSliderChange = (pos: number) => {
    setTransSliderPos(pos);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 800);
  };

  // Transformation Surface Data
  const transformationData: TransformationData = {
    title: activePersona.name,
    category: activePersona.department,
    before: {
      headline: `${activePersona.role} operates with unmonitored data exposure and manual collaboration friction across ${activePersona.collaborationPattern.length} channels.`,
      telemetryItems: activePersona.sensitivityExposure.map(s => ({
        label: s.label,
        value: s.severity,
        severity: s.severity
      })),
      frictionPoints: activePersona.collaborationFriction.map(f => f.label),
      riskSummary: `Elevated Risk Score (${activePersona.riskScore}/100) • High Friction (${activePersona.adoptionFriction}%)`
    },
    after: {
      headline: `M365 Copilot & Purview auto-governance optimize ${activePersona.name}'s daily workflow with zero credential leakage.`,
      copilotUnlocks: activePersona.outcomePriorities.map(op => ({
        label: op,
        value: '100% Active',
        impact: 'Automated'
      })),
      optimizations: [
        `Automated Graph Grounding across ${activePersona.collaborationPattern.slice(0, 3).join(', ')}`,
        `Purview Auto-Labeling on ${activePersona.sensitivitySet.slice(0, 2).join(', ')}`,
        `Zero manual reconciliation required`
      ],
      roiOutcome: `${activePersona.valuePotential.hoursSavedPerWeek} hrs/wk saved (${activePersona.valuePotential.annualValuePerSeat})`
    }
  };

  // Dynamic Reactive Metrics based on Slider Position
  const ratio = transSliderPos / 100;
  const effectiveRiskScore = Math.max(0, Math.round(activePersona.riskScore * (1.8 - 0.8 * ratio)));
  const effectiveFeasibilityScore = Math.min(100, Math.round(activePersona.feasibilityScore * (0.6 + 0.4 * ratio)));
  const effectiveAdoptionFriction = Math.max(0, Math.round(activePersona.adoptionFriction * (1.8 - 0.8 * ratio)));
  const effectiveHoursSaved = (activePersona.valuePotential.hoursSavedPerWeek * (0.2 + 0.8 * ratio)).toFixed(1);

  // Gauge calculations for active persona
  const riskRadius = 28;
  const riskCircumference = 2 * Math.PI * riskRadius;
  const riskOffset = riskCircumference - (effectiveRiskScore / 100) * riskCircumference;

  const feasRadius = 28;
  const feasCircumference = 2 * Math.PI * feasRadius;
  const feasOffset = feasCircumference - (effectiveFeasibilityScore / 100) * feasCircumference;

  const dynamicRibbonText = isTransExpanded
    ? transSliderPos < 30
      ? `⚠️ Telemetry Reality Mode (${transSliderPos}%): High unmonitored risk & manual workflow friction detected for ${activePersona.name}.`
      : transSliderPos < 70
      ? `⚡ Transformation Transition Mode (${transSliderPos}%): Purview governance & Copilot grounding in progress...`
      : `✨ Copilot-Optimized Mode (${transSliderPos}%): ${activePersona.insightRibbonText}`
    : activePersona.insightRibbonText;

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* 1. TOP MISSION-CONTROL TOOLBAR */}
      <header className="h-13 bg-sidebar/90 border-b border-border px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
            <Users className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Persona Stories & Cohort Fusion
              </span>
              <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/40 px-2 py-0.5 rounded font-semibold">
                STEP 4 OF 8
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Quiz Intent × Live Telemetry Reality Surface
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          {onHelpClick && (
            <button
              onClick={onHelpClick}
              className="flex items-center space-x-1.5 bg-secondary/80 hover:bg-secondary text-muted-foreground text-xs px-3 py-1.5 rounded-lg border border-border transition-all cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-primary" />
              <span>Spec Info</span>
            </button>
          )}

          <button
            onClick={onContinue}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            className="group relative flex items-center gap-2.5 px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 rounded-full bg-[linear-gradient(135deg,#3B82F6_0%,#8B5CF6_50%,#D8B4FE_100%)] animate-copilot-pulse-glow hover:shadow-2xl hover:-translate-y-0.5 active:scale-95 overflow-hidden border border-white/20 cursor-pointer"
          >
            {/* Shimmer sweep */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-copilot-shimmer z-[5]" />
            {/* Glossy hover overlay */}
            <div className="absolute inset-0 transition-opacity duration-500 opacity-0 group-hover:opacity-100 bg-gradient-to-tr from-transparent via-white/10 to-white/20 z-10" />
            <span className="relative z-20 tracking-tight">Evaluate Use-Case Stories</span>
            <ArrowRight className="relative z-20 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1.5" />
            {/* Ambient light line */}
            <div className="absolute -inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50 z-20" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* 2. THREE-PANEL MISSION-CONTROL BODY */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ==================================================================== */}
        {/* LEFT PANEL — PERSONA SELECTOR RAIL */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-sidebar/95 border-r border-border p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              <span>Persona Cohort Rail ({personas.length})</span>
            </span>
            <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
              Live Select
            </span>
          </div>

          <div className="space-y-2.5">
            {personas.map((p) => {
              const isActive = p.id === activePersonaId;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectPersona(p.id)}
                  className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer relative group ${
                    isActive
                      ? 'bg-gradient-to-br from-primary/15 to-background border-primary ring-1 ring-primary/40 shadow-[0_0_20px_rgba(0,120,212,0.25)]'
                      : 'bg-card/80 border-border hover:border-border hover:bg-secondary'
                  }`}
                >
                  {/* Selection Indicator Line */}
                  {isActive && (
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r" />
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 border transition-transform ${
                          isActive
                            ? 'bg-primary/15 border-primary text-primary shadow-[0_0_10px_rgba(0,120,212,0.4)] scale-105'
                            : 'bg-secondary border-border text-muted-foreground group-hover:scale-105'
                        }`}
                      >
                        {p.avatar}
                      </div>
                      <div>
                        <h3 className={`text-xs font-bold leading-tight ${
                          isActive ? 'text-foreground' : 'text-foreground group-hover:text-primary'
                        }`}>
                          {p.name}
                        </h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                          {p.role}
                        </p>
                      </div>
                    </div>

                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground shrink-0">
                      {p.department.split(' ')[0]}
                    </span>
                  </div>

                  {/* Multi-Select Collaboration Chips */}
                  <div className="mt-2.5 pt-2 border-t border-border/50 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-muted-foreground font-semibold mr-1">Channels:</span>
                      {p.collaborationPattern.slice(0, 3).map((ch, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-secondary/90 text-primary px-1.5 py-0.2 rounded border border-primary/20">
                          {ch}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-muted-foreground font-semibold mr-1">Sensitivity:</span>
                      {p.sensitivitySet.slice(0, 2).map((sen, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-destructive/10 text-destructive px-1.5 py-0.2 rounded border border-destructive/30">
                          {sen}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Outcome Priorities */}
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-status-green font-semibold bg-status-green/10 px-2 py-1 rounded border border-status-green/30">
                    <span className="truncate">🎯 {p.outcomePriorities[0]}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ==================================================================== */}
        {/* CENTER PANEL — FULL EXPANDED NARRATIVE SURFACE (HERO STORY FOCUS) */}
        {/* ==================================================================== */}
        <main className="flex-1 overflow-y-auto bg-background p-5 flex flex-col relative scrollbar-thin">
          
          {/* INSIGHT RIBBON SYNC */}
          <div
            className={`mb-4 p-3.5 rounded-xl border transition-all duration-700 backdrop-blur-md relative overflow-hidden shrink-0 ${
              ribbonPulse ? 'animate-ribbon-pulse' : ''
            } ${
              isExpanded || isTransExpanded
                ? 'bg-accent/10 border-accent/40 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                : 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(0,120,212,0.2)]'
            }`}
          >
            <div className="flex items-center justify-between gap-3 relative z-10">
              <div className="flex items-center space-x-2.5 text-xs font-semibold text-foreground">
                <Sparkles className="w-4 h-4 text-primary shrink-0 animate-spin-slow" />
                <span>{dynamicRibbonText}</span>
              </div>
              <span className="text-[9.5px] font-mono uppercase font-bold tracking-wider text-primary bg-primary/20 px-2 py-0.5 rounded border border-primary/40 shrink-0">
                {isTransExpanded ? `Transformation ${transSliderPos}%` : 'Ribbon Synced'}
              </span>
            </div>
            <div className="absolute inset-0 animate-shimmer opacity-20 pointer-events-none" />
          </div>

          {/* CINEMATIC NARRATIVE HERO CARD */}
          <div className="relative rounded-2xl border border-border overflow-hidden shadow-2xl shrink-0 flex flex-col transition-all duration-700 bg-background min-h-fit">
            
            {/* PERSONA-SPECIFIC BACKGROUND ANIMATIONS */}
            {activePersona.bgAnimationType === 'engineer' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--primary))_1px,transparent_1px)] [background-size:24px_24px] opacity-15 animate-grid-move" />
                <div className="absolute top-10 right-10 w-64 h-64 rounded-full bg-primary/10 blur-3xl animate-pulse" />
              </div>
            )}

            {activePersona.bgAnimationType === 'security' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/15 to-background opacity-90" />
                <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full border border-primary/20 animate-radar-sweep" />
              </div>
            )}

            {activePersona.bgAnimationType === 'pm' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 bottom-0 left-10 right-10 flex flex-col justify-around opacity-15">
                  <div className="h-0.5 bg-primary animate-shimmer" />
                  <div className="h-0.5 bg-accent animate-shimmer" />
                  <div className="h-0.5 bg-status-green animate-shimmer" />
                </div>
              </div>
            )}

            {activePersona.bgAnimationType === 'writer' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/4 w-0.5 bg-gradient-to-b from-transparent via-status-amber/30 to-transparent animate-doc-flow" />
                <div className="absolute top-0 bottom-0 right-1/4 w-0.5 bg-gradient-to-b from-transparent via-primary/30 to-transparent animate-doc-flow" />
              </div>
            )}

            {activePersona.bgAnimationType === 'researcher' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-accent/10 via-background to-primary/15" />
                <div className="absolute left-1/3 top-1/4 w-40 h-40 rounded-full bg-accent/20 blur-xl animate-nebula" />
              </div>
            )}

            {/* OVERLAY */}
            <div className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-700 ${
              isExpanded ? 'opacity-90' : 'opacity-40'
            }`} />

            {/* CARD MAIN CONTENT CONTAINER */}
            <div className="relative z-10 p-6 flex flex-col space-y-6">
              
              {/* Persona Story Header */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-border shrink-0">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-secondary/90 border border-primary/50 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(0,120,212,0.35)] animate-pulse shrink-0">
                    {activePersona.avatar}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-extrabold text-foreground tracking-tight">
                        {activePersona.name}
                      </h2>
                      <span className="text-[11px] font-mono bg-primary/20 text-primary border border-primary/30 px-2.5 py-0.5 rounded-full font-bold">
                        {activePersona.department}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                      {activePersona.role} • <span className="text-primary font-semibold">{activePersona.useCaseCluster}</span>
                    </p>
                  </div>
                </div>

                {/* Quick Value Badge & EXPAND STORY / COLLAPSE BUTTON */}
                <div className="flex items-center space-x-3 shrink-0">
                  <div className="hidden lg:flex flex-col items-end px-3 py-1.5 rounded-xl bg-secondary/80 border border-border shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground">Value Potential</span>
                    <span className="text-xs font-mono font-extrabold text-status-green">{activePersona.valuePotential.annualValuePerSeat}</span>
                  </div>

                  <button
                    onClick={toggleExpand}
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    className="group relative flex items-center justify-center gap-2.5 min-w-[250px] shrink-0 px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 rounded-full bg-[linear-gradient(135deg,#3B82F6_0%,#8B5CF6_50%,#D8B4FE_100%)] animate-copilot-pulse-glow hover:shadow-2xl hover:-translate-y-0.5 active:scale-95 overflow-hidden border border-white/20 cursor-pointer"
                  >
                    {/* Shimmer sweep */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-copilot-shimmer z-[5]" />
                    {/* Glossy hover overlay */}
                    <div className="absolute inset-0 transition-opacity duration-500 opacity-0 group-hover:opacity-100 bg-gradient-to-tr from-transparent via-white/10 to-white/20 z-10" />
                    <Sparkles className="relative z-20 w-4 h-4 animate-spin-slow" />
                    <span className="relative z-20 tracking-tight">{isExpanded ? 'Collapse 7-Part Story' : 'Expand Full 7-Part Narrative'}</span>
                    {isExpanded
                      ? <ChevronUp className="relative z-20 w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
                      : <ChevronDown className="relative z-20 w-4 h-4 transition-transform duration-300 group-hover:translate-y-0.5" />}
                    {/* Ambient light line */}
                    <div className="absolute -inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50 z-20" />
                  </button>
                </div>
              </div>

              {/* MODE 1 — SHORT STORY (MODE 1 ACTIVE) */}
              {!isExpanded && (
                <div className="space-y-5 flex flex-col animate-fade-in">
                  
                  {/* Persona Story Quote Summary */}
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-secondary/90 via-background to-secondary/90 border border-primary/30 relative overflow-hidden shadow-lg">
                    <div className="absolute top-0 right-0 p-3 text-primary/10 pointer-events-none">
                      <Bookmark className="w-16 h-16" />
                    </div>
                    <span className="text-[10px] font-mono font-extrabold text-primary uppercase tracking-widest block mb-1.5">
                      Persona Story Narrative Synthesis
                    </span>
                    <p className="text-sm text-foreground leading-relaxed font-normal">
                      "{activePersona.shortStory.summary}"
                    </p>
                  </div>

                  {/* INLINE TRANSFORMATION SURFACE (BEFORE → AFTER) */}
                  <TransformationSurface
                    data={transformationData}
                    sliderPos={transSliderPos}
                    onSliderChange={handleSliderChange}
                    isExpanded={isTransExpanded}
                    onToggleExpand={() => setIsTransExpanded(!isTransExpanded)}
                  />

                  {/* Multi-Select Collaboration & Sensitivity Matrix */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-secondary/80 p-3.5 rounded-xl border border-border space-y-2">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase font-bold flex items-center justify-between">
                        <span>Multi-Select Collaboration Pattern</span>
                        <span className="text-primary font-mono text-[9px]">{activePersona.collaborationPattern.length} Selected</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activePersona.collaborationPattern.map((ch, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-primary/15 text-primary border border-primary/30 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-secondary/80 p-3.5 rounded-xl border border-border space-y-2">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase font-bold flex items-center justify-between">
                        <span>Multi-Select Sensitivity Profile</span>
                        <span className="text-destructive font-mono text-[9px]">{activePersona.sensitivitySet.length} Selected</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activePersona.sensitivitySet.map((sen, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-destructive/15 text-destructive border border-destructive/30 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                            {sen}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Key Callout Boxes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-status-amber/10 border border-status-amber/30 text-xs space-y-1.5">
                      <span className="text-[10px] font-mono font-bold uppercase text-status-amber flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Telemetry Reality Check
                      </span>
                      <p className="text-status-amber leading-relaxed">
                        {activePersona.shortStory.telemetryCheck}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 text-xs space-y-1.5">
                      <span className="text-[10px] font-mono font-bold uppercase text-primary flex items-center gap-1.5">
                        <Zap className="w-4 h-4" />
                        Copilot Value Unlock
                      </span>
                      <p className="text-primary leading-relaxed">
                        {activePersona.shortStory.copilotUnlock}
                      </p>
                    </div>
                  </div>

                  {/* Outcome Priorities & ROI Impact Footer */}
                  <div className="p-4 rounded-xl bg-secondary/90 border border-border flex flex-col md:flex-row items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-status-green/10 border border-status-green/30 flex items-center justify-center text-status-green shrink-0">
                        <Target className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase font-bold block">Outcome Priorities</span>
                        <p className="text-xs font-bold text-status-green">
                          {activePersona.outcomePriorities.join(' • ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 shrink-0">
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-muted-foreground block">Weekly Return</span>
                        <span className="text-xs font-mono font-extrabold text-foreground">{activePersona.valuePotential.hoursSavedPerWeek} hrs / week</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-muted-foreground block">ROI Multiplier</span>
                        <span className="text-xs font-mono font-extrabold text-status-green">{activePersona.valuePotential.roiMultiplier}</span>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* MODE 2 — EXPANDED NARRATIVE (7-PART CINEMATIC ANALYSIS) */}
              {isExpanded && (
                <div className="pt-2 space-y-5 animate-fade-slide">
                  
                  <div className="flex items-center justify-between pb-2 border-b border-accent/30">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-accent flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent" />
                      <span>Full 7-Part Persona Narrative Surface</span>
                    </h3>
                    <span className="text-[10px] font-mono text-accent bg-accent/20 px-2.5 py-0.5 rounded-full border border-accent/40">
                      Expanded Mode Active
                    </span>
                  </div>

                  {/* 7 Structured Sections */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    
                    {/* 1. Identity & Role Context */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-border space-y-2">
                      <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        1. Identity & Role Context
                      </span>
                      <p className="text-muted-foreground leading-relaxed text-xs">
                        {activePersona.expandedNarrative.identityContext}
                      </p>
                    </div>

                    {/* 2. Collaboration Patterns & Sensitivity Profile */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-border space-y-2">
                      <span className="text-[10px] font-mono font-bold text-destructive uppercase tracking-wider flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        2. Collaboration Patterns & Sensitivity
                      </span>
                      <p className="text-muted-foreground leading-relaxed text-xs">
                        {activePersona.expandedNarrative.collaborationSensitivity}
                      </p>
                    </div>

                    {/* 3. Telemetry Reality Check */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-status-amber/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-status-amber uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        3. Telemetry Reality Check
                      </span>
                      <p className="text-status-amber leading-relaxed text-xs">
                        {activePersona.expandedNarrative.telemetryRealityCheck}
                      </p>
                    </div>

                    {/* 4. Workflow Friction & Governance Gaps */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-border space-y-2">
                      <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" />
                        4. Workflow Friction & Governance Gaps
                      </span>
                      <p className="text-muted-foreground leading-relaxed text-xs">
                        {activePersona.expandedNarrative.workflowFriction}
                      </p>
                    </div>

                    {/* 5. Use-Case Feasibility & Adoption Readiness */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-status-green/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-status-green uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        5. Use-Case Feasibility & Adoption
                      </span>
                      <p className="text-status-green leading-relaxed text-xs">
                        {activePersona.expandedNarrative.feasibilityReadiness}
                      </p>
                    </div>

                    {/* 6. Copilot Value Story */}
                    <div className="p-4 bg-muted/60 rounded-xl border border-accent/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        6. Copilot Value Story
                      </span>
                      <p className="text-accent leading-relaxed text-xs">
                        {activePersona.expandedNarrative.copilotValueStory}
                      </p>
                    </div>

                  </div>

                  {/* 7. Persona-Specific ROI Potential Banner */}
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-accent/15 via-accent/20 to-primary/25 border border-accent/40 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-bold text-accent uppercase tracking-wider">
                      <span className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-status-green" />
                        <span>7. Persona-Specific ROI Potential & Seat Value</span>
                      </span>
                      <span className="font-mono text-status-green text-base font-extrabold">{activePersona.valuePotential.annualValuePerSeat}</span>
                    </div>
                    <p className="text-foreground text-xs leading-relaxed">
                      {activePersona.expandedNarrative.roiBreakdown}
                    </p>
                  </div>

                  {/* Bottom Collapse Story Button */}
                  <div className="pt-2 flex justify-center">
                    <button
                      onClick={toggleExpand}
                      className="px-5 py-2.5 bg-accent/90 hover:bg-accent text-primary-foreground font-bold text-xs rounded-xl border border-accent flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-accent/30"
                    >
                      <ChevronUp className="w-4 h-4" />
                      <span>Collapse 7-Part Story View</span>
                    </button>
                  </div>

                </div>
              )}

            </div>
          </div>

        </main>

        {/* ==================================================================== */}
        {/* RIGHT PANEL — PERSONA METRICS (ANIMATED) */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-sidebar/95 border-l border-border p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20 select-none">
          
          <div className="space-y-4">
            
            {/* Title */}
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Persona Telemetry Metrics
              </h2>
              <span className="text-[10px] font-mono text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded border border-primary/30">
                Live Fusion
              </span>
            </div>

            {/* DUAL RADIAL GAUGES: Risk Score vs Feasibility Score */}
            <div className="bg-muted/40 backdrop-blur-md border border-border p-3.5 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>Score Vectors</span>
                <span className="text-[10px] font-mono text-muted-foreground">0 – 100 Scale</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                
                {/* Persona Risk Gauge */}
                <div className="flex flex-col items-center space-y-1 bg-muted/50 p-2 rounded-lg border border-border/50 relative">
                  <span className="text-[10px] font-mono text-muted-foreground">Risk Score</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border border-destructive/30 animate-ring-rotate pointer-events-none" />
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={riskRadius} stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={riskRadius}
                        stroke={effectiveRiskScore > 50 ? 'hsl(var(--status-red))' : effectiveRiskScore > 30 ? 'hsl(var(--status-amber))' : 'hsl(var(--status-green))'}
                        strokeWidth="5"
                        strokeDasharray={riskCircumference}
                        strokeDashoffset={riskOffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-foreground font-mono">
                      {effectiveRiskScore}
                    </span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border ${
                    effectiveRiskScore > 50
                      ? 'text-destructive bg-destructive/10 border-destructive/30'
                      : effectiveRiskScore > 30
                      ? 'text-status-amber bg-status-amber/10 border-status-amber/30'
                      : 'text-status-green bg-status-green/10 border-status-green/30'
                  }`}>
                    {effectiveRiskScore > 50 ? 'Elevated Risk' : effectiveRiskScore > 30 ? 'Moderate' : 'Low Risk'}
                  </span>
                </div>

                {/* Persona Feasibility Score */}
                <div className="flex flex-col items-center space-y-1 bg-muted/50 p-2 rounded-lg border border-border/50 relative">
                  <span className="text-[10px] font-mono text-muted-foreground">Feasibility</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border border-primary/30 animate-ring-rotate pointer-events-none" />
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={feasRadius} stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={feasRadius}
                        stroke="hsl(var(--primary))"
                        strokeWidth="5"
                        strokeDasharray={feasCircumference}
                        strokeDashoffset={feasOffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-foreground font-mono">
                      {effectiveFeasibilityScore}%
                    </span>
                  </div>
                  <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border text-primary bg-primary/10 border-primary/30">
                    High Readiness
                  </span>
                </div>

              </div>
            </div>

            {/* ADOPTION FRICTION BAR */}
            <div className="bg-muted/40 backdrop-blur-md border border-border p-3 rounded-xl space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-bold">
                <span className="text-muted-foreground">Adoption Friction</span>
                <span className="font-mono text-primary text-xs">{effectiveAdoptionFriction}%</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden border border-border/50">
                <div
                  className="bg-gradient-to-r from-status-green via-primary to-status-amber h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, effectiveAdoptionFriction)}%` }}
                />
              </div>
              <p className="text-[9.5px] text-muted-foreground text-right">
                Change management resistance factor
              </p>
            </div>

            {/* SENSITIVITY EXPOSURE LIST */}
            <div className="bg-muted/40 backdrop-blur-md border border-border p-3 rounded-xl space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-muted-foreground block">
                Sensitivity Exposure (Telemetry × Quiz)
              </span>
              <div className="space-y-1.5">
                {activePersona.sensitivityExposure.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIssue({ label: item.label, category: 'sensitivity', severity: item.severity })}
                    className="flex items-center justify-between text-[10px] bg-secondary/80 p-2 rounded border border-border cursor-pointer hover:border-primary/50 hover:bg-secondary transition-colors"
                  >
                    <span className="text-muted-foreground font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border font-semibold ${
                      item.severity === 'High'
                        ? 'text-destructive bg-destructive/15 border-destructive/30'
                        : item.severity === 'Medium'
                        ? 'text-status-amber bg-status-amber/15 border-status-amber/30'
                        : 'text-status-green bg-status-green/15 border-status-green/30'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* COLLABORATION FRICTION LIST */}
            <div className="bg-muted/40 backdrop-blur-md border border-border p-3 rounded-xl space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-muted-foreground block">
                Collaboration Friction Bottlenecks
              </span>
              <div className="space-y-1.5">
                {activePersona.collaborationFriction.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIssue({ label: item.label, category: 'friction', severity: item.severity })}
                    className="flex items-center justify-between text-[10px] bg-secondary/80 p-2 rounded border border-border cursor-pointer hover:border-primary/50 hover:bg-secondary transition-colors"
                  >
                    <span className="text-muted-foreground font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border font-semibold ${
                      item.severity === 'High'
                        ? 'text-destructive bg-destructive/15 border-destructive/30'
                        : 'text-status-amber bg-status-amber/15 border-status-amber/30'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* VALUE POTENTIAL VECTOR (ROI CARD) */}
            <div className="bg-gradient-to-br from-status-green/10 via-secondary to-primary/10 border border-status-green/40 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase text-status-green flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Value Potential ROI Vector
                </span>
                <span className="text-xs font-mono font-extrabold text-status-green">
                  {activePersona.valuePotential.roiMultiplier}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center pt-1">
                <div className="bg-muted/40 p-2 rounded border border-border/50">
                  <span className="text-[9px] font-mono text-muted-foreground block">Weekly Return</span>
                  <span className="text-xs font-mono font-bold text-foreground">
                    {activePersona.valuePotential.hoursSavedPerWeek} hrs/wk
                  </span>
                </div>
                <div className="bg-muted/40 p-2 rounded border border-border/50">
                  <span className="text-[9px] font-mono text-muted-foreground block">Annual Seat Value</span>
                  <span className="text-xs font-mono font-bold text-status-green">
                    {activePersona.valuePotential.annualValuePerSeat}
                  </span>
                </div>
              </div>

              <p className="text-[9.5px] text-muted-foreground leading-tight pt-1">
                {activePersona.valuePotential.primaryBenefit}
              </p>
            </div>

          </div>

          {/* FOOTER METRICS STAMP */}
          <div className="pt-2 border-t border-border text-center text-[9px] font-mono text-muted-foreground">
            Persona Cohort Fusion Engine • Live Telemetry Active
          </div>

        </aside>

      </div>

      <UseCaseIssueModal
        issue={selectedIssue}
        onClose={() => setSelectedIssue(null)}
        fetchWithAuth={fetchWithAuth}
        context={{
          role: quizProfile.role,
          department: quizProfile.department,
          industry: quizProfile.industry,
          personaName: activePersona.name,
          personaRole: activePersona.role,
          useCaseCluster: activePersona.useCaseCluster,
          collaborationPattern: activePersona.collaborationPattern,
          sensitivitySet: activePersona.sensitivitySet,
        }}
      />
    </div>
  );
};

/** Shared loading/error/blocked-state layout for PersonasScreen — honest states, never a fabricated persona. */
const PersonasStatusScreen: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail: string;
  onExitClick?: () => void;
  onHelpClick?: () => void;
}> = ({ icon, title, detail, onExitClick, onHelpClick }) => (
  <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">
    <header className="h-13 bg-sidebar/90 border-b border-border px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
          <Users className="w-4 h-4" />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">
          Persona Stories & Cohort Fusion
        </span>
      </div>
      <div className="flex items-center space-x-3">
        {onHelpClick && (
          <button
            onClick={onHelpClick}
            className="flex items-center space-x-1.5 bg-secondary/80 hover:bg-secondary text-muted-foreground text-xs px-3 py-1.5 rounded-lg border border-border transition-all cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-primary" />
            <span>Spec Info</span>
          </button>
        )}
        {onExitClick && (
          <button
            onClick={onExitClick}
            className="p-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card/80 p-8 flex flex-col items-center text-center space-y-4">
        {icon}
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
      </div>
    </div>
  </div>
);
