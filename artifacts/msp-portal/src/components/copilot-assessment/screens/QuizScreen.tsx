import React, { useState } from 'react';
import {
  Rocket, HeartPulse, Landmark, Factory, GraduationCap, Building2, Scale,
  ShoppingBag, Code, Zap, Truck, Sprout, Heart, Sparkles, Atom, Compass,
  Radio, Cpu, FileText, Briefcase, Stethoscope, Microscope, ShieldCheck,
  BarChart, TrendingUp, ShieldAlert, FileCheck, Wrench, CheckCircle2, Shield,
  Boxes, BookOpen, Building, Layers, FileSpreadsheet, FolderKanban, Search,
  HardDrive, Target, Palette, LifeBuoy, Gavel, Tag, Store, PenTool, LineChart,
  CheckSquare, MessageSquare, Megaphone, FileCode, ListTodo, BarChart2, Lock,
  EyeOff, Globe, Network, Users, Share2, Smile, Meh, AlertTriangle, Activity,
  Clock, Crown, Check, ChevronLeft, ChevronRight, ArrowRight, Info, HelpCircle,
  HelpCircle as QuestionIcon, File, Settings, User
} from 'lucide-react';

import {
  QUIZ_NAV_ITEMS,
  INDUSTRY_OPTIONS,
  ADAPTIVE_CLUSTERS,
  ADAPTIVE_PERSONAS,
  ADAPTIVE_USE_CASES,
  ADAPTIVE_DATA_SENSITIVITY,
  ADAPTIVE_COLLABORATION,
  UNIVERSAL_AI_COMFORT,
  UNIVERSAL_WORKFLOW_STRUCTURE,
  UNIVERSAL_ADOPTION_SPEED,
  ADAPTIVE_OUTCOME_PRIORITIES,
  UNIVERSAL_CHANGE_MGMT,
  QuizOptionTile
} from '../quizCatalog';
import { ScoringPanel } from '../quiz/ScoringPanel';
import { QuizProfile, CollaborationPattern, WorkflowStyle, AiComfortLevel } from '../types';

interface QuizScreenProps {
  answers?: Record<string, string>;
  onSelectOption?: (stepId: string, optionId: string) => void;
  onCompleteQuiz: (profile: QuizProfile) => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
}

interface WorkloadMix {
  draftingLoad: number;
  researchLoad: number;
  communicationLoad: number;
  repetitiveLoad: number;
}

// Icon Resolver Component
const DynamicIcon: React.FC<{ name: string; className?: string }> = ({ name, className = "w-5 h-5" }) => {
  const iconMap: Record<string, React.ElementType> = {
    Rocket, HeartPulse, Landmark, Factory, GraduationCap, Building2, Scale,
    ShoppingBag, Code, Zap, Truck, Sprout, Heart, Sparkles, Atom, Compass,
    Radio, Cpu, FileText, Briefcase, Stethoscope, Microscope, ShieldCheck,
    BarChart, TrendingUp, ShieldAlert, FileCheck, Wrench, CheckCircle2, Shield,
    Boxes, BookOpen, Building, Layers, FileSpreadsheet, FolderKanban, Search,
    HardDrive, Target, Palette, LifeBuoy, Gavel, Tag, Store, PenTool, LineChart,
    CheckSquare, MessageSquare, Megaphone, FileCode, ListTodo, BarChart2, Lock,
    EyeOff, Globe, Network, Users, Share2, Smile, Meh, AlertTriangle, Activity,
    Clock, Crown, Check, ChevronLeft, ChevronRight, ArrowRight, Info, HelpCircle,
    File, Settings, User
  };

  const IconComponent = iconMap[name] || Sparkles;
  return <IconComponent className={className} />;
};

// --- Mapping tables: original quiz's industry-specific option IDs -> real QuizProfile enum values ---
const COLLABORATION_MAP: Record<string, CollaborationPattern> = {
  cross_mission: 'cross-team',
  cross_agency: 'external',
  internal_only: 'internal',
  care_team: 'internal',
  department: 'internal',
  multi_facility: 'cross-team',
  desk_level: 'internal',
  firm_wide: 'cross-team',
  client_facing: 'external',
  cross_functional: 'cross-team',
  enterprise_wide: 'cross-team',
  external_partners: 'external',
};

const WORKFLOW_MAP: Record<string, WorkflowStyle> = {
  highly_structured: 'structured',
  moderately_structured: 'structured',
  unstructured: 'unstructured',
};

const AI_COMFORT_MAP: Record<string, AiComfortLevel> = {
  very_comfortable: 'high',
  somewhat_comfortable: 'high',
  neutral: 'medium',
  cautious: 'low',
  not_comfortable: 'low',
};

export const QuizScreen: React.FC<QuizScreenProps> = ({
  answers: externalAnswers,
  onSelectOption: externalOnSelect,
  onCompleteQuiz,
  onHelpClick,
  onExitClick
}) => {
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>(externalAnswers || {});
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [role, setRole] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [workload, setWorkload] = useState<WorkloadMix>({
    draftingLoad: 0.5,
    researchLoad: 0.5,
    communicationLoad: 0.5,
    repetitiveLoad: 0.5,
  });

  const answers = externalAnswers || localAnswers;

  const currentNav = QUIZ_NAV_ITEMS[activeStepIndex];
  const stepId = currentNav.id;
  const isMultiSelect = currentNav.isMultiSelect;
  const currentIndustry = answers['industry'] || 'space';

  // Helper for multi-select handling stored as comma-separated string
  const getSelectedArray = (id: string): string[] => {
    const raw = answers[id];
    if (!raw) return [];
    return raw.split(',').filter(Boolean);
  };

  const handleTileClick = (optionId: string) => {
    if (isMultiSelect) {
      const currentArr = getSelectedArray(stepId);
      let updatedArr: string[];
      if (currentArr.includes(optionId)) {
        updatedArr = currentArr.filter(i => i !== optionId);
      } else {
        updatedArr = [...currentArr, optionId];
      }
      const valStr = updatedArr.join(',');
      setLocalAnswers(prev => ({ ...prev, [stepId]: valStr }));
      if (externalOnSelect) {
        externalOnSelect(stepId, valStr);
      }
    } else {
      setLocalAnswers(prev => ({ ...prev, [stepId]: optionId }));
      if (externalOnSelect) {
        externalOnSelect(stepId, optionId);
      }
    }
  };

  // Resolve options & step definition based on stepId & active industry
  const getStepOptions = (): { title: string; description: string; options: QuizOptionTile[]; hint: string } => {
    switch (stepId) {
      case 'industry':
        return {
          title: 'Select Your Industry',
          description: 'Industry determines persona clusters, personas, use cases, and governance model.',
          options: INDUSTRY_OPTIONS,
          hint: 'Industry determines persona clusters, personas, and use cases.'
        };

      case 'clusters': {
        const catalog = ADAPTIVE_CLUSTERS[currentIndustry] || ADAPTIVE_CLUSTERS['default'];
        return {
          title: 'Select All Persona Clusters You Support',
          description: 'Persona clusters organize functional teams into structured Copilot enablement tracks.',
          options: catalog,
          hint: 'Clusters organize personas into logical groups.'
        };
      }

      case 'personas': {
        const fullCatalog = ADAPTIVE_PERSONAS[currentIndustry] || ADAPTIVE_PERSONAS['default'];
        const selectedClusterIds = getSelectedArray('clusters');
        let filteredCatalog = fullCatalog;

        // If clusters were selected, filter personas by those clusters
        if (selectedClusterIds.length > 0) {
          filteredCatalog = fullCatalog.filter(p => !p.clusterId || selectedClusterIds.includes(p.clusterId));
        }

        return {
          title: 'Select All Personas You Support',
          description: 'Copilot deployments support multi-role workflows and specialized job descriptions.',
          options: filteredCatalog,
          hint: 'Copilot deployments support multiple personas.'
        };
      }

      case 'use-cases': {
        const catalog = ADAPTIVE_USE_CASES[currentIndustry] || ADAPTIVE_USE_CASES['default'];
        return {
          title: 'Select All Relevant Copilot Use Cases',
          description: 'High-value use-case scenarios calculate initial feasibility, Graph grounding requirements, and ROI.',
          options: catalog,
          hint: 'Use cases determine feasibility and ROI.'
        };
      }

      case 'sensitivity': {
        const catalog = ADAPTIVE_DATA_SENSITIVITY[currentIndustry] || ADAPTIVE_DATA_SENSITIVITY['default'];
        return {
          title: 'Select All Applicable Data Sensitivity Levels',
          description: 'Data sensitivity dictates Microsoft Purview auto-labeling, DLP rules, and conditional access policies.',
          options: catalog,
          hint: 'Select all data sensitivity classifications present in your organization.'
        };
      }

      case 'collaboration': {
        const catalog = ADAPTIVE_COLLABORATION[currentIndustry] || ADAPTIVE_COLLABORATION['default'];
        return {
          title: 'Select All Applicable Collaboration Patterns',
          description: 'Collaboration patterns define site inheritance boundaries, guest access, and oversharing risk.',
          options: catalog,
          hint: 'Select all collaboration patterns present across your teams and departments.'
        };
      }

      case 'ai-comfort':
        return {
          title: 'How comfortable are you with AI-generated content?',
          description: 'User trust dictates human-in-the-loop validation, prompt engineering training, and review cadence.',
          options: UNIVERSAL_AI_COMFORT,
          hint: 'This influences governance tolerance.'
        };

      case 'workflow':
        return {
          title: 'How structured is your daily workflow?',
          description: 'Workflow predictability determines how quickly declarative agents and Copilot Studio extensions integrate.',
          options: UNIVERSAL_WORKFLOW_STRUCTURE,
          hint: 'This affects use-case feasibility.'
        };

      case 'adoption-speed':
        return {
          title: 'How quickly do you adopt new technology?',
          description: 'Adoption velocity informs pilot group sizing, champion network density, and Wave 1 rollout speed.',
          options: UNIVERSAL_ADOPTION_SPEED,
          hint: 'This shapes rollout strategy.'
        };

      case 'outcomes': {
        const catalog = ADAPTIVE_OUTCOME_PRIORITIES[currentIndustry] || ADAPTIVE_OUTCOME_PRIORITIES['default'];
        return {
          title: 'Select All Outcomes That Matter Most',
          description: 'Targeted business metrics drive value calculations, ROI modeling, and C-suite reporting.',
          options: catalog,
          hint: 'This determines value levers.'
        };
      }

      case 'change-mgmt':
        return {
          title: 'How much change management support do you need?',
          description: 'Enablement needs determine champion training, executive sponsorship, and enablement playbook scope.',
          options: UNIVERSAL_CHANGE_MGMT,
          hint: 'This affects adoption planning.'
        };

      case 'about-you':
      case 'workload-mix':
      case 'review':
        return {
          title: '',
          description: '',
          options: [],
          hint: ''
        };

      default:
        return {
          title: 'Assessment Question',
          description: '',
          options: [],
          hint: 'Select an option to proceed.'
        };
    }
  };

  const stepData = getStepOptions();
  const selectedArr = getSelectedArray(stepId);
  const singleSelectedId = answers[stepId];

  const isStepAnswered = (idx: number) => {
    const id = QUIZ_NAV_ITEMS[idx].id;
    if (id === 'review') return false;
    if (id === 'about-you') return role.trim().length > 0 && department.trim().length > 0;
    if (id === 'workload-mix') return true; // sliders always have a value
    const val = answers[id];
    return !!val && val.trim().length > 0;
  };

  const canNavigateToStep = (idx: number) => {
    if (idx === 0) return true;
    for (let i = 0; i < idx; i++) {
      if (!isStepAnswered(i)) return false;
    }
    return true;
  };

  const isNextDisabled = () => {
    if (stepId === 'review' || stepId === 'workload-mix') return false;
    if (stepId === 'about-you') return role.trim().length === 0 || department.trim().length === 0;
    if (isMultiSelect) {
      return selectedArr.length === 0;
    }
    return !singleSelectedId;
  };

  const handleNext = () => {
    if (activeStepIndex < QUIZ_NAV_ITEMS.length - 1) {
      setActiveStepIndex(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (activeStepIndex > 0) {
      setActiveStepIndex(prev => prev - 1);
    }
  };

  // Helper for multi-select titles display on review screen
  const getReviewTitles = (key: string) => {
    const raw = answers[key];
    if (!raw) return 'Not Selected';

    const arr = raw.split(',').filter(Boolean);
    if (arr.length === 0) return 'Not Selected';

    if (key === 'industry') {
      const found = INDUSTRY_OPTIONS.find(o => o.id === arr[0]);
      return found ? found.title : arr[0];
    }

    if (key === 'clusters') {
      const catalog = ADAPTIVE_CLUSTERS[currentIndustry] || ADAPTIVE_CLUSTERS['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'personas') {
      const catalog = ADAPTIVE_PERSONAS[currentIndustry] || ADAPTIVE_PERSONAS['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'use-cases') {
      const catalog = ADAPTIVE_USE_CASES[currentIndustry] || ADAPTIVE_USE_CASES['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'sensitivity') {
      const catalog = ADAPTIVE_DATA_SENSITIVITY[currentIndustry] || ADAPTIVE_DATA_SENSITIVITY['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'collaboration') {
      const catalog = ADAPTIVE_COLLABORATION[currentIndustry] || ADAPTIVE_COLLABORATION['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'ai-comfort') {
      const f = UNIVERSAL_AI_COMFORT.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
    }

    if (key === 'workflow') {
      const f = UNIVERSAL_WORKFLOW_STRUCTURE.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
    }

    if (key === 'adoption-speed') {
      const f = UNIVERSAL_ADOPTION_SPEED.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
    }

    if (key === 'outcomes') {
      const catalog = ADAPTIVE_OUTCOME_PRIORITIES[currentIndustry] || ADAPTIVE_OUTCOME_PRIORITIES['default'];
      return arr.map(id => {
        const f = catalog.find(o => o.id === id);
        return f ? f.title : id;
      }).join(', ');
    }

    if (key === 'change-mgmt') {
      const f = UNIVERSAL_CHANGE_MGMT.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
    }

    return arr.join(', ');
  };

  // Build the real QuizProfile the rest of the platform (#186/#187 AI generation,
  // #190 ROI scoring) actually consumes. toolUsage is intentionally left empty --
  // not collected by this quiz; use-case-generator.ts already falls back to
  // "none specified" gracefully when empty.
  const buildQuizProfile = (): QuizProfile => {
    const sensitivityCatalog = ADAPTIVE_DATA_SENSITIVITY[currentIndustry] || ADAPTIVE_DATA_SENSITIVITY['default'];
    const outcomesCatalog = ADAPTIVE_OUTCOME_PRIORITIES[currentIndustry] || ADAPTIVE_OUTCOME_PRIORITIES['default'];
    const collaborationIds = getSelectedArray('collaboration');
    const collaborationPatterns = Array.from(
      new Set(collaborationIds.map(id => COLLABORATION_MAP[id]).filter((v): v is CollaborationPattern => !!v))
    );

    return {
      role: role.trim(),
      department: department.trim(),
      industry: currentIndustry,
      collaboration: collaborationPatterns.length > 0 ? collaborationPatterns : ['internal'],
      sensitivity: getSelectedArray('sensitivity').map(id => sensitivityCatalog.find(o => o.id === id)?.title || id),
      workflowStyle: WORKFLOW_MAP[answers['workflow']] || 'structured',
      outcomePriorities: getSelectedArray('outcomes').map(id => outcomesCatalog.find(o => o.id === id)?.title || id),
      draftingLoad: workload.draftingLoad,
      researchLoad: workload.researchLoad,
      communicationLoad: workload.communicationLoad,
      repetitiveLoad: workload.repetitiveLoad,
      toolUsage: [],
      aiComfort: AI_COMFORT_MAP[answers['ai-comfort']] || 'medium',
    };
  };

  const handleCompleteQuiz = () => {
    onCompleteQuiz(buildQuizProfile());
  };

  const workloadFields: { key: keyof WorkloadMix; label: string; description: string }[] = [
    { key: 'draftingLoad', label: 'Drafting', description: 'Writing emails, reports, proposals, and documents' },
    { key: 'researchLoad', label: 'Research', description: 'Gathering, reading, and synthesizing information' },
    { key: 'communicationLoad', label: 'Communication', description: 'Meetings, messages, status updates, coordination' },
    { key: 'repetitiveLoad', label: 'Repetitive Tasks', description: 'Data entry, formatting, routine approvals' },
  ];

  return (
    <div className="flex flex-col h-full bg-background text-foreground select-none">
      {/* TOP TOOLBAR */}
      <header className="h-12 border-b border-border bg-sidebar flex items-center justify-between px-4 sm:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-primary rounded-sm flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">Copilot Assessment — Quiz</span>
        </div>

        {/* Center: Step Indicator */}
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>Step</span>
          <span className="px-2 py-0.5 bg-primary text-primary-foreground font-bold rounded text-[11px]">
            {activeStepIndex + 1} of {QUIZ_NAV_ITEMS.length}
          </span>
        </div>

        {/* Right: Help & Exit */}
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
            className="px-3 py-1 bg-secondary text-foreground text-xs font-semibold rounded hover:bg-secondary/80 transition-colors cursor-pointer"
          >
            Exit
          </button>
        </div>
      </header>

      {/* MAIN 3-PANEL CONTAINER */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL (Fixed Navigation) */}
        <aside className="w-60 bg-sidebar border-r border-border flex flex-col shrink-0">
          <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              Quiz Sections
            </span>
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
                      : 'text-muted-foreground/50 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {/* Completion Indicator */}
                    <div className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full border border-border">
                      {isDone ? (
                        <Check className="w-3 h-3 text-primary stroke-[3]" />
                      ) : isActive ? (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-border" />
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
            Progress: {QUIZ_NAV_ITEMS.filter((_, idx) => isStepAnswered(idx)).length}/{QUIZ_NAV_ITEMS.length - 1} Answered
          </div>
        </aside>

        {/* CENTER PANEL (Primary Content Stage) */}
        <main className="flex-1 overflow-y-auto bg-background p-6 sm:p-8 flex flex-col justify-between scrollbar-thin">
          <div className="max-w-4xl mx-auto w-full space-y-6">
            {/* Screen Header */}
            {stepId !== 'about-you' && stepId !== 'workload-mix' && stepId !== 'review' && (
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-card border border-border rounded text-[11px] font-mono text-primary mb-3">
                  <QuestionIcon className="w-3.5 h-3.5 text-primary" />
                  <span>
                    Screen {activeStepIndex + 1} of {QUIZ_NAV_ITEMS.length} — {currentNav.label}
                    {isMultiSelect && (
                      <span className="ml-2 font-bold text-status-green">
                        (Multi-Select)
                      </span>
                    )}
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                  {stepData.title}
                </h1>
                {stepData.description && (
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
                    {stepData.description}
                  </p>
                )}
              </div>
            )}

            {/* Answer Options Tiles Grid */}
            {stepId !== 'review' && stepId !== 'about-you' && stepId !== 'workload-mix' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 pt-2">
                {stepData.options.map((option) => {
                  const isSelected = isMultiSelect
                    ? selectedArr.includes(option.id)
                    : singleSelectedId === option.id;

                  return (
                    <button
                      key={option.id}
                      onClick={() => handleTileClick(option.id)}
                      className={`group relative p-5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-primary/10 border-primary ring-1 ring-primary shadow-lg shadow-primary/10'
                          : 'bg-card border-border hover:border-primary/60 hover:bg-secondary/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className={`p-2.5 rounded-md border transition-colors ${
                            isSelected
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-secondary border-border text-primary group-hover:border-primary/40'
                          }`}>
                            <DynamicIcon name={option.iconName} className="w-5 h-5" />
                          </div>

                          <div className="flex items-center gap-2">
                            {option.badge && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/20 text-primary border border-primary/40 uppercase">
                                {option.badge}
                              </span>
                            )}
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition-all ${
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'border-border bg-background group-hover:border-primary/60'
                            }`}>
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                          </div>
                        </div>

                        <h3 className={`text-sm font-bold transition-colors ${
                          isSelected ? 'text-foreground' : 'text-foreground/90 group-hover:text-foreground'
                        }`}>
                          {option.title}
                        </h3>

                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                          {option.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* NEW SCREEN: ABOUT YOU */}
            {stepId === 'about-you' && (
              <div className="space-y-6 pt-2">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">About You</h1>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
                    A quick bit of context before we get into your organization's profile.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                  <div className="p-5 rounded-lg border border-border bg-card space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wide">
                      <User className="w-3.5 h-3.5 text-primary" />
                      Your Role
                    </label>
                    <input
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="e.g. M365 Architect"
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div className="p-5 rounded-lg border border-border bg-card space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wide">
                      <Building2 className="w-3.5 h-3.5 text-primary" />
                      Your Department
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="e.g. CIO"
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* NEW SCREEN: WORKLOAD MIX */}
            {stepId === 'workload-mix' && (
              <div className="space-y-6 pt-2">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Workload Mix</h1>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
                    Roughly how does your work break down? This directly drives the ROI and time-saved figures in your final report.
                  </p>
                </div>
                <div className="space-y-5 max-w-2xl">
                  {workloadFields.map(field => (
                    <div key={field.key} className="p-5 rounded-lg border border-border bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-bold text-foreground">{field.label}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
                        </div>
                        <span className="text-sm font-mono font-extrabold text-primary shrink-0 ml-4">
                          {Math.round(workload[field.key] * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(workload[field.key] * 100)}
                        onChange={(e) => setWorkload(prev => ({ ...prev, [field.key]: Number(e.target.value) / 100 }))}
                        className="w-full accent-primary cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SCREEN: QUIZ COMPLETION SUMMARY */}
            {stepId === 'review' && (
              <div className="space-y-6 pt-2">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Quiz Complete</h1>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
                    Review your adaptive baseline inputs before running real-time tenant telemetry analysis.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Role / Department</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {role || 'Not Provided'} / {department || 'Not Provided'}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Selected Industry</span>
                    <div className="text-sm font-bold text-foreground mt-1 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-primary"></span>
                      {getReviewTitles('industry')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Persona Clusters (Multi)</span>
                    <div className="text-sm font-bold text-status-green mt-1">
                      {getReviewTitles('clusters')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Target Personas (Multi)</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('personas')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Use Case Clusters (Multi)</span>
                    <div className="text-sm font-bold text-primary mt-1">
                      {getReviewTitles('use-cases')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Data Sensitivity / Risk Posture</span>
                    <div className="text-sm font-bold text-status-amber mt-1">
                      {getReviewTitles('sensitivity')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Collaboration Pattern</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('collaboration')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">AI Comfort & Governance</span>
                    <div className="text-sm font-bold text-status-green mt-1">
                      {getReviewTitles('ai-comfort')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Workflow Structure</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('workflow')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Adoption Friction & Speed</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('adoption-speed')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Outcome Priorities</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('outcomes')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Change Management</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      {getReviewTitles('change-mgmt')}
                    </div>
                  </div>

                  <div className="p-4 bg-card border border-border rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground block">Workload Mix</span>
                    <div className="text-sm font-bold text-foreground mt-1">
                      Drafting {Math.round(workload.draftingLoad * 100)}% · Research {Math.round(workload.researchLoad * 100)}% · Comms {Math.round(workload.communicationLoad * 100)}% · Repetitive {Math.round(workload.repetitiveLoad * 100)}%
                    </div>
                  </div>
                </div>

                <div className="p-5 bg-card border border-primary/40 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Quiz Completed — Baseline Set</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      All assessment parameters registered. Proceed to execute real-time tenant telemetry analysis.
                    </p>
                  </div>
                  <button
                    onClick={handleCompleteQuiz}
                    className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-md shadow-lg shadow-primary/20 transition-all shrink-0 cursor-pointer flex items-center gap-2"
                  >
                    <span>Continue to Telemetry Analysis</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Navigation Row */}
          <div className="max-w-4xl mx-auto w-full pt-8 flex items-center justify-between border-t border-border mt-8">
            <button
              onClick={handleBack}
              disabled={activeStepIndex === 0}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                activeStepIndex === 0
                  ? 'opacity-40 cursor-not-allowed text-muted-foreground bg-background'
                  : 'text-foreground bg-secondary hover:bg-secondary/80 border border-border cursor-pointer'
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
                <span>{activeStepIndex === QUIZ_NAV_ITEMS.length - 2 ? 'Review Baseline' : 'Next'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleCompleteQuiz}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-md text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md cursor-pointer"
              >
                <span>Continue to Telemetry Analysis</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </main>

        {/* RIGHT PANEL (Real-Time Context Scoring Panel) */}
        <ScoringPanel answers={answers} activeStepId={stepId} isReviewScreen={stepId === 'review'} role={role} department={department} workload={workload} />
      </div>
    </div>
  );
};
