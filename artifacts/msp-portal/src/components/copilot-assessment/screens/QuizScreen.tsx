import React, { useState } from 'react';
import {
  Rocket, HeartPulse, Landmark, Factory, GraduationCap, Building2, Scale,
  ShoppingBag, Code, Zap, Truck, Sprout, Heart, Sparkles, Shield, Users, Globe,
  Lock, ShieldCheck, FileCheck, ShieldAlert, EyeOff, Check, CheckSquare, Activity,
  Target, TrendingUp, CheckCircle2, MessageSquare, FolderKanban, FileText,
  HardDrive, FileSpreadsheet, ListTodo, BarChart2, BarChart, AlertTriangle, Meh,
  PenTool, Search, Check as CheckIcon, ChevronLeft, ChevronRight, ArrowRight,
  HelpCircle, HelpCircle as QuestionIcon
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

import {
  QUIZ_NAV_ITEMS,
  INDUSTRY_OPTIONS,
  COLLABORATION_OPTIONS,
  SENSITIVITY_OPTIONS,
  WORKFLOW_STYLE_OPTIONS,
  OUTCOME_PRIORITY_OPTIONS,
  TOOL_USAGE_OPTIONS,
  AI_COMFORT_OPTIONS,
  LOAD_CATEGORIES,
  INITIAL_QUIZ_PROFILE,
  QuizOptionTile,
  LoadKey,
} from '../quizCatalog';
import { ScoringPanel } from '../quiz/ScoringPanel';
import type { CollaborationPattern, QuizProfile, WorkflowStyle, AiComfortLevel } from '../types';

interface QuizScreenProps {
  initialProfile?: Partial<QuizProfile>;
  onCompleteQuiz: (profile: QuizProfile) => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
}

const DynamicIcon: React.FC<{ name: string; className?: string }> = ({ name, className = 'w-5 h-5' }) => {
  const iconMap: Record<string, React.ElementType> = {
    Rocket, HeartPulse, Landmark, Factory, GraduationCap, Building2, Scale,
    ShoppingBag, Code, Zap, Truck, Sprout, Heart, Sparkles, Shield, Users, Globe,
    Lock, ShieldCheck, FileCheck, ShieldAlert, EyeOff, Check, CheckSquare, Activity,
    Target, TrendingUp, CheckCircle2, MessageSquare, FolderKanban, FileText,
    HardDrive, FileSpreadsheet, ListTodo, BarChart2, BarChart, AlertTriangle, Meh,
    PenTool, Search,
  };
  const IconComponent = iconMap[name] || Sparkles;
  return <IconComponent className={className} />;
};

// Which fields must be set before the user can leave a given step.
const isStepComplete = (stepId: string, profile: Partial<QuizProfile>): boolean => {
  switch (stepId) {
    case 'about-you':
      return !!profile.role?.trim() && !!profile.department?.trim();
    case 'industry':
      return !!profile.industry;
    case 'collaboration':
      return !!profile.collaboration && profile.collaboration.length > 0;
    case 'sensitivity':
      return !!profile.sensitivity && profile.sensitivity.length > 0;
    case 'workflow-style':
      return !!profile.workflowStyle;
    case 'outcomes':
      return !!profile.outcomePriorities && profile.outcomePriorities.length > 0;
    case 'workload':
      return true; // sliders always carry a value (defaulted)
    case 'tool-usage':
      return !!profile.toolUsage && profile.toolUsage.length > 0;
    case 'ai-comfort':
      return !!profile.aiComfort;
    case 'review':
      return QUIZ_NAV_ITEMS.filter((item) => item.id !== 'review').every((item) => isStepComplete(item.id, profile));
    default:
      return false;
  }
};

export const QuizScreen: React.FC<QuizScreenProps> = ({
  initialProfile,
  onCompleteQuiz,
  onHelpClick,
  onExitClick,
}) => {
  const [profile, setProfile] = useState<Partial<QuizProfile>>({
    ...INITIAL_QUIZ_PROFILE,
    ...initialProfile,
  });
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);

  const currentStep = QUIZ_NAV_ITEMS[activeStepIndex];
  const stepId = currentStep.id;

  const isStepAnswered = (idx: number) => isStepComplete(QUIZ_NAV_ITEMS[idx].id, profile);

  const canNavigateToStep = (idx: number) => {
    if (idx === 0) return true;
    for (let i = 0; i < idx; i++) {
      if (!isStepAnswered(i)) return false;
    }
    return true;
  };

  const isNextDisabled = () => !isStepComplete(stepId, profile);

  const handleNext = () => {
    if (activeStepIndex < QUIZ_NAV_ITEMS.length - 1) setActiveStepIndex((prev) => prev + 1);
  };

  const handleBack = () => {
    if (activeStepIndex > 0) setActiveStepIndex((prev) => prev - 1);
  };

  const toggleMulti = (key: 'collaboration' | 'sensitivity' | 'outcomePriorities' | 'toolUsage', value: string) => {
    setProfile((prev) => {
      const current = (prev[key] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const setSingle = <K extends keyof QuizProfile>(key: K, value: QuizProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const setLoad = (key: LoadKey, value: number) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const handleComplete = () => {
    onCompleteQuiz(profile as QuizProfile);
  };

  const renderTile = (option: QuizOptionTile, isSelected: boolean, onClick: () => void) => (
    <button
      key={option.id}
      onClick={onClick}
      className={`group relative p-5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
        isSelected
          ? 'bg-primary/10 border-primary ring-1 ring-primary shadow-lg shadow-primary/10'
          : 'bg-card border-border hover:border-primary/60 hover:bg-secondary'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div
            className={`p-2.5 rounded-md border transition-colors ${
              isSelected
                ? 'bg-primary border-primary text-primary-foreground'
                : 'bg-secondary border-border text-primary group-hover:border-primary/40'
            }`}
          >
            <DynamicIcon name={option.iconName} className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-2">
            {option.badge && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/20 text-primary border border-primary/40 uppercase">
                {option.badge}
              </span>
            )}
            <div
              className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition-all ${
                isSelected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-muted-foreground/40 bg-background group-hover:border-primary/60'
              }`}
            >
              {isSelected && <CheckIcon className="w-3.5 h-3.5 stroke-[3]" />}
            </div>
          </div>
        </div>
        <h3 className={`text-sm font-bold transition-colors ${isSelected ? 'text-foreground' : 'text-foreground/90 group-hover:text-foreground'}`}>
          {option.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{option.description}</p>
      </div>
    </button>
  );

  const renderStepBody = () => {
    switch (currentStep.stepType) {
      case 'form':
        return (
          <div className="space-y-6 pt-2 max-w-lg">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Your role / title</label>
              <Input
                value={profile.role ?? ''}
                onChange={(e) => setSingle('role', e.target.value)}
                placeholder="e.g. IT Director, Operations Manager"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Your department</label>
              <Input
                value={profile.department ?? ''}
                onChange={(e) => setSingle('department', e.target.value)}
                placeholder="e.g. Information Technology, Legal, Sales"
              />
            </div>
          </div>
        );

      case 'tiles': {
        const catalogMap: Record<string, { catalog: QuizOptionTile[]; key: keyof QuizProfile; multi: boolean }> = {
          industry: { catalog: INDUSTRY_OPTIONS, key: 'industry', multi: false },
          collaboration: { catalog: COLLABORATION_OPTIONS, key: 'collaboration', multi: true },
          sensitivity: { catalog: SENSITIVITY_OPTIONS, key: 'sensitivity', multi: true },
          'workflow-style': { catalog: WORKFLOW_STYLE_OPTIONS, key: 'workflowStyle', multi: false },
          outcomes: { catalog: OUTCOME_PRIORITY_OPTIONS, key: 'outcomePriorities', multi: true },
          'tool-usage': { catalog: TOOL_USAGE_OPTIONS, key: 'toolUsage', multi: true },
          'ai-comfort': { catalog: AI_COMFORT_OPTIONS, key: 'aiComfort', multi: false },
        };
        const config = catalogMap[stepId];
        if (!config) return null;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 pt-2">
            {config.catalog.map((option) => {
              const isSelected = config.multi
                ? ((profile[config.key] as string[] | undefined) ?? []).includes(option.id)
                : profile[config.key] === option.id;

              return renderTile(option, isSelected, () => {
                if (config.multi) {
                  toggleMulti(config.key as 'collaboration' | 'sensitivity' | 'outcomePriorities' | 'toolUsage', option.id);
                } else if (config.key === 'workflowStyle') {
                  setSingle('workflowStyle', option.id as WorkflowStyle);
                } else if (config.key === 'aiComfort') {
                  setSingle('aiComfort', option.id as AiComfortLevel);
                } else {
                  setSingle('industry', option.id);
                }
              });
            })}
          </div>
        );
      }

      case 'sliders':
        return (
          <div className="space-y-8 pt-4 max-w-xl">
            {LOAD_CATEGORIES.map((cat) => {
              const value = (profile[cat.key] as number | undefined) ?? 0.5;
              return (
                <div key={cat.key} className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-md border border-border bg-secondary text-primary shrink-0">
                        <DynamicIcon name={cat.iconName} className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-foreground">{cat.label}</div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{cat.description}</p>
                      </div>
                    </div>
                    <span className="text-sm font-mono font-bold text-primary shrink-0">{Math.round(value * 100)}%</span>
                  </div>
                  <Slider
                    value={[Math.round(value * 100)]}
                    onValueChange={([v]) => setLoad(cat.key, v / 100)}
                    max={100}
                    step={5}
                  />
                </div>
              );
            })}
          </div>
        );

      case 'review': {
        const p = profile;
        const summaryRows: Array<{ label: string; value: string }> = [
          { label: 'Role', value: p.role?.trim() || 'Not provided' },
          { label: 'Department', value: p.department?.trim() || 'Not provided' },
          { label: 'Industry', value: INDUSTRY_OPTIONS.find((o) => o.id === p.industry)?.title || 'Not selected' },
          { label: 'Collaboration', value: (p.collaboration ?? []).map((c) => COLLABORATION_OPTIONS.find((o) => o.id === c)?.title || c).join(', ') || 'Not selected' },
          { label: 'Data Sensitivity', value: (p.sensitivity ?? []).map((s) => SENSITIVITY_OPTIONS.find((o) => o.id === s)?.title || s).join(', ') || 'Not selected' },
          { label: 'Workflow Style', value: WORKFLOW_STYLE_OPTIONS.find((o) => o.id === p.workflowStyle)?.title || 'Not selected' },
          { label: 'Outcome Priorities', value: (p.outcomePriorities ?? []).map((o) => OUTCOME_PRIORITY_OPTIONS.find((opt) => opt.id === o)?.title || o).join(', ') || 'Not selected' },
          { label: 'Tool Usage', value: (p.toolUsage ?? []).map((t) => TOOL_USAGE_OPTIONS.find((opt) => opt.id === t)?.title || t).join(', ') || 'Not selected' },
          { label: 'AI Comfort', value: AI_COMFORT_OPTIONS.find((o) => o.id === p.aiComfort)?.title || 'Not selected' },
        ];

        return (
          <div className="space-y-6 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {summaryRows.map((row) => (
                <div key={row.label} className="p-4 bg-card border border-border rounded-lg">
                  <span className="text-[10px] uppercase font-mono text-muted-foreground block">{row.label}</span>
                  <div className="text-sm font-bold text-foreground mt-1">{row.value}</div>
                </div>
              ))}

              <div className="p-4 bg-card border border-border rounded-lg md:col-span-2 lg:col-span-3">
                <span className="text-[10px] uppercase font-mono text-muted-foreground block mb-2">Workload Mix</span>
                <div className="flex flex-wrap gap-4">
                  {LOAD_CATEGORIES.map((cat) => (
                    <div key={cat.key} className="text-sm">
                      <span className="text-muted-foreground">{cat.label}: </span>
                      <span className="font-bold text-foreground font-mono">{Math.round(((p[cat.key] as number | undefined) ?? 0) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 bg-card border border-primary/40 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">Profile Complete</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  This profile becomes the input for your generated personas, use cases, and final report.
                </p>
              </div>
              <button
                onClick={handleComplete}
                className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-md shadow-lg shadow-primary/20 transition-all shrink-0 cursor-pointer flex items-center gap-2"
              >
                <span>Continue to Telemetry Analysis</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground select-none">
      {/* TOP TOOLBAR */}
      <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-primary rounded-sm flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">Copilot Assessment — Quiz</span>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>Step</span>
          <span className="px-2 py-0.5 bg-primary text-primary-foreground font-bold rounded text-[11px]">
            {activeStepIndex + 1} of {QUIZ_NAV_ITEMS.length}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onHelpClick}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors cursor-pointer"
            title="Help & Framework Info"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={onExitClick}
            className="px-3 py-1 bg-secondary text-secondary-foreground text-xs font-semibold rounded hover:bg-muted transition-colors cursor-pointer"
          >
            Exit
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL */}
        <aside className="w-60 bg-card border-r border-border flex flex-col shrink-0">
          <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Quiz Sections</span>
          </div>

          <div className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
            {QUIZ_NAV_ITEMS.map((item, idx) => {
              const isActive = activeStepIndex === idx;
              const isDone = isStepAnswered(idx);
              const canClick = canNavigateToStep(idx);

              return (
                <button
                  key={item.id}
                  onClick={() => canClick && setActiveStepIndex(idx)}
                  disabled={!canClick}
                  className={`w-full flex items-center justify-between p-2 rounded-md text-xs transition-all ${
                    isActive
                      ? 'bg-secondary text-foreground font-semibold border-l-2 border-primary'
                      : canClick
                      ? 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground cursor-pointer'
                      : 'text-muted-foreground/40 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full border border-border">
                      {isDone ? (
                        <CheckIcon className="w-3 h-3 text-primary stroke-[3]" />
                      ) : isActive ? (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                      )}
                    </div>
                    <span className="truncate text-[11px]">{item.label}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/70">
                    {String(item.stepNumber).padStart(2, '0')}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-border bg-background text-[10px] text-muted-foreground font-mono">
            Progress: {QUIZ_NAV_ITEMS.filter((_, idx) => isStepAnswered(idx)).length}/{QUIZ_NAV_ITEMS.length} Answered
          </div>
        </aside>

        {/* CENTER PANEL */}
        <main className="flex-1 overflow-y-auto bg-background p-6 sm:p-8 flex flex-col justify-between scrollbar-thin">
          <div className="max-w-4xl mx-auto w-full space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-card border border-border rounded text-[11px] font-mono text-primary mb-3">
                <QuestionIcon className="w-3.5 h-3.5 text-primary" />
                <span>
                  Screen {activeStepIndex + 1} of {QUIZ_NAV_ITEMS.length} — {currentStep.label}
                  {currentStep.isMultiSelect && <span className="ml-2 font-bold text-status-green">(Multi-Select)</span>}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{currentStep.label}</h1>
            </div>

            {renderStepBody()}
          </div>

          <div className="max-w-4xl mx-auto w-full pt-8 flex items-center justify-between border-t border-border mt-8">
            <button
              onClick={handleBack}
              disabled={activeStepIndex === 0}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                activeStepIndex === 0
                  ? 'opacity-40 cursor-not-allowed text-muted-foreground bg-background'
                  : 'text-foreground bg-secondary hover:bg-muted border border-border cursor-pointer'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            {stepId !== 'review' ? (
              <button
                onClick={handleNext}
                disabled={isNextDisabled()}
                className={`flex items-center space-x-2 px-6 py-2.5 rounded-md text-xs font-bold transition-all ${
                  !isNextDisabled()
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-md cursor-pointer'
                    : 'opacity-50 cursor-not-allowed bg-secondary text-muted-foreground'
                }`}
              >
                <span>{activeStepIndex === QUIZ_NAV_ITEMS.length - 2 ? 'Review Profile' : 'Next'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-md text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md cursor-pointer"
              >
                <span>Continue to Telemetry Analysis</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </main>

        {/* RIGHT PANEL */}
        <ScoringPanel profile={profile} activeStepId={stepId} isReviewScreen={stepId === 'review'} />
      </div>
    </div>
  );
};
