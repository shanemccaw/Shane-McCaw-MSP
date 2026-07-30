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
  HelpCircle as QuestionIcon, File, Settings
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

interface QuizScreenProps {
  answers?: Record<string, string>;
  onSelectOption?: (stepId: string, optionId: string) => void;
  onCompleteQuiz: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
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
    File, Settings
  };

  const IconComponent = iconMap[name] || Sparkles;
  return <IconComponent className={className} />;
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

      case 'review':
        return {
          title: 'Quiz Complete',
          description: 'Review your adaptive baseline inputs before running real-time tenant telemetry analysis.',
          options: [],
          hint: 'Next: We analyze your tenant telemetry.'
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
    if (stepId === 'review') return false;
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
      const f = catalog.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
    }

    if (key === 'collaboration') {
      const catalog = ADAPTIVE_COLLABORATION[currentIndustry] || ADAPTIVE_COLLABORATION['default'];
      const f = catalog.find(o => o.id === arr[0]);
      return f ? f.title : arr[0];
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

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] text-[#E1E1E1] select-none">
      {/* TOP TOOLBAR */}
      <header className="h-12 border-b border-[#2D2D2D] bg-[#161616] flex items-center justify-between px-4 sm:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-[#0078D4] rounded-sm flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">Copilot Assessment — Quiz</span>
        </div>

        {/* Center: Step Indicator */}
        <div className="flex items-center gap-2 font-mono text-xs text-[#A1A1A1]">
          <span>Step</span>
          <span className="px-2 py-0.5 bg-[#0078D4] text-white font-bold rounded text-[11px]">
            {activeStepIndex + 1} of 13
          </span>
        </div>

        {/* Right: Help & Exit */}
        <div className="flex items-center gap-3">
          <button
            onClick={onHelpClick}
            className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors cursor-pointer"
            title="Help & Framework Info"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={onExitClick}
            className="px-3 py-1 bg-[#2D2D2D] text-white text-xs font-semibold rounded hover:bg-[#3D3D3D] transition-colors cursor-pointer"
          >
            Exit
          </button>
        </div>
      </header>

      {/* MAIN 3-PANEL CONTAINER */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL (Fixed Navigation) */}
        <aside className="w-60 bg-[#111111] border-r border-[#2D2D2D] flex flex-col shrink-0">
          <div className="h-10 border-b border-[#2D2D2D] flex items-center px-4 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-[#666666] font-bold">
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
                      ? 'bg-[#1F1F1F] text-white font-semibold border-l-2 border-[#0078D4]'
                      : canClick
                      ? 'text-[#A1A1A1] hover:bg-[#1A1A1A] hover:text-white cursor-pointer'
                      : 'text-[#444444] cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {/* Completion Indicator */}
                    <div className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full border border-[#333333]">
                      {isDone ? (
                        <Check className="w-3 h-3 text-[#0078D4] stroke-[3]" />
                      ) : isActive ? (
                        <div className="w-2 h-2 rounded-full bg-[#0078D4]" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-[#333333]" />
                      )}
                    </div>
                    <span className="truncate text-[11px]">{item.label}</span>
                  </div>

                  <span className="text-[10px] font-mono text-[#555555]">
                    {String(item.stepNumber).padStart(2, '0')}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-[#2D2D2D] bg-[#0A0A0A] text-[10px] text-[#555555] font-mono">
            Progress: {QUIZ_NAV_ITEMS.filter((_, idx) => isStepAnswered(idx)).length}/11 Answered
          </div>
        </aside>

        {/* CENTER PANEL (Primary Content Stage) */}
        <main className="flex-1 overflow-y-auto bg-[#0F0F0F] p-6 sm:p-8 flex flex-col justify-between scrollbar-thin">
          <div className="max-w-4xl mx-auto w-full space-y-6">
            {/* Screen Header */}
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#161616] border border-[#2D2D2D] rounded text-[11px] font-mono text-[#0078D4] mb-3">
                <QuestionIcon className="w-3.5 h-3.5 text-[#0078D4]" />
                <span>
                  Screen {activeStepIndex + 1} of 13 — {currentNav.label}
                  {isMultiSelect && (
                    <span className="ml-2 font-bold text-emerald-400">
                      (Multi-Select)
                    </span>
                  )}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {stepData.title}
              </h1>
              {stepData.description && (
                <p className="text-sm text-[#A1A1A1] mt-2 leading-relaxed max-w-2xl">
                  {stepData.description}
                </p>
              )}
            </div>

            {/* Answer Options Tiles Grid (Screens 1 to 11) */}
            {stepId !== 'review' && (
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
                          ? 'bg-[#0078D4]/10 border-[#0078D4] ring-1 ring-[#0078D4] shadow-lg shadow-[#0078D4]/10'
                          : 'bg-[#161616] border-[#2D2D2D] hover:border-[#0078D4]/60 hover:bg-[#1C1C1C] hover:shadow-[0_0_15px_rgba(0,120,212,0.12)]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className={`p-2.5 rounded-md border transition-colors ${
                            isSelected
                              ? 'bg-[#0078D4] border-[#0078D4] text-white'
                              : 'bg-[#1F1F1F] border-[#2D2D2D] text-[#0078D4] group-hover:border-[#0078D4]/40'
                          }`}>
                            <DynamicIcon name={option.iconName} className="w-5 h-5" />
                          </div>

                          <div className="flex items-center gap-2">
                            {option.badge && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 uppercase">
                                {option.badge}
                              </span>
                            )}
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition-all ${
                              isSelected
                                ? 'bg-[#0078D4] border-[#0078D4] text-white'
                                : 'border-[#444444] bg-[#111111] group-hover:border-[#0078D4]/60'
                            }`}>
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                          </div>
                        </div>

                        <h3 className={`text-sm font-bold transition-colors ${
                          isSelected ? 'text-white' : 'text-[#E1E1E1] group-hover:text-white'
                        }`}>
                          {option.title}
                        </h3>

                        <p className="text-xs text-[#A1A1A1] mt-1.5 leading-relaxed">
                          {option.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* SCREEN 12: QUIZ COMPLETION SUMMARY */}
            {stepId === 'review' && (
              <div className="space-y-6 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Selected Industry</span>
                    <div className="text-sm font-bold text-white mt-1 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#0078D4]"></span>
                      {getReviewTitles('industry')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Persona Clusters (Multi)</span>
                    <div className="text-sm font-bold text-emerald-400 mt-1">
                      {getReviewTitles('clusters')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Target Personas (Multi)</span>
                    <div className="text-sm font-bold text-white mt-1">
                      {getReviewTitles('personas')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Use Case Clusters (Multi)</span>
                    <div className="text-sm font-bold text-[#0078D4] mt-1">
                      {getReviewTitles('use-cases')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Data Sensitivity / Risk Posture</span>
                    <div className="text-sm font-bold text-yellow-400 mt-1">
                      {getReviewTitles('sensitivity')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Collaboration Pattern</span>
                    <div className="text-sm font-bold text-white mt-1">
                      {getReviewTitles('collaboration')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">AI Comfort & Governance</span>
                    <div className="text-sm font-bold text-green-400 mt-1">
                      {getReviewTitles('ai-comfort')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Workflow Structure</span>
                    <div className="text-sm font-bold text-white mt-1">
                      {getReviewTitles('workflow')}
                    </div>
                  </div>

                  <div className="p-4 bg-[#161616] border border-[#2D2D2D] rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-[#888888] block">Adoption Friction & Speed</span>
                    <div className="text-sm font-bold text-white mt-1">
                      {getReviewTitles('adoption-speed')}
                    </div>
                  </div>
                </div>

                <div className="p-5 bg-[#161616] border border-[#0078D4]/40 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white">Quiz Completed — Multi-Persona Baseline Set</h3>
                    <p className="text-xs text-[#A1A1A1] mt-1">
                      All assessment parameters registered. Proceed to execute real-time tenant telemetry analysis.
                    </p>
                  </div>
                  <button
                    onClick={onCompleteQuiz}
                    className="px-6 py-3 bg-[#0078D4] hover:bg-[#0086F0] text-white font-bold text-xs rounded-md shadow-lg shadow-[#0078D4]/20 transition-all shrink-0 cursor-pointer flex items-center gap-2"
                  >
                    <span>Continue to Telemetry Analysis</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Navigation Row */}
          <div className="max-w-4xl mx-auto w-full pt-8 flex items-center justify-between border-t border-[#2D2D2D] mt-8">
            <button
              onClick={handleBack}
              disabled={activeStepIndex === 0}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                activeStepIndex === 0
                  ? 'opacity-40 cursor-not-allowed text-[#666666] bg-[#111111]'
                  : 'text-[#E1E1E1] bg-[#1F1F1F] hover:bg-[#2D2D2D] border border-[#2D2D2D] cursor-pointer'
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
                    ? 'bg-[#0078D4] hover:bg-[#0086F0] text-white shadow-md cursor-pointer'
                    : 'opacity-50 cursor-not-allowed bg-[#2D2D2D] text-[#888888]'
                }`}
              >
                <span>{activeStepIndex === QUIZ_NAV_ITEMS.length - 2 ? 'Review Baseline' : 'Next'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={onCompleteQuiz}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-md text-xs font-bold bg-[#0078D4] hover:bg-[#0086F0] text-white shadow-md cursor-pointer"
              >
                <span>Continue to Telemetry Analysis</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </main>

        {/* RIGHT PANEL (Real-Time Context Scoring Panel) */}
        <ScoringPanel answers={answers} activeStepId={stepId} isReviewScreen={stepId === 'review'} />
      </div>
    </div>
  );
};
