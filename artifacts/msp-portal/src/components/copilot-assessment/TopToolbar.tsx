import React from 'react';
import { AssessmentStep } from './types';
import { 
  ShieldCheck, 
  HelpCircle, 
  FileText, 
  ChevronRight, 
  Sparkles,
  LogOut,
  Maximize2
} from 'lucide-react';

interface TopToolbarProps {
  currentStep: AssessmentStep;
  progressPercent: number;
  onNavigate: (step: AssessmentStep) => void;
  onOpenArchitectureSpec: () => void;
  onReset: () => void;
}

const STEPS: { id: AssessmentStep; label: string; number: number }[] = [
  { id: 'home', label: 'Home', number: 1 },
  { id: 'quiz', label: 'Quiz', number: 2 },
  { id: 'telemetry', label: 'Telemetry', number: 3 },
  { id: 'personas', label: 'Personas', number: 4 },
  { id: 'use-cases', label: 'Use Cases', number: 5 },
  { id: 'security', label: 'Security', number: 6 },
  { id: 'security2', label: 'Security 2', number: 7 },
  { id: 'governance', label: 'Governance', number: 8 },
  { id: 'roi', label: 'ROI', number: 9 },
  { id: 'report', label: 'Final Report', number: 10 },
  { id: 'documents', label: 'Deliverables', number: 11 },
  { id: 'sow', label: 'SOW & Purchase', number: 12 },
];

export const TopToolbar: React.FC<TopToolbarProps> = ({
  currentStep,
  progressPercent,
  onNavigate,
  onOpenArchitectureSpec,
  onReset
}) => {
  const currentStepNumber = STEPS.findIndex(s => s.id === currentStep) + 1;
  const currentStepObj = STEPS.find(s => s.id === currentStep);

  return (
    <header className="h-12 border-b border-[#2D2D2D] bg-[#161616] flex items-center justify-between px-6 shrink-0 z-30 select-none">
      {/* Left: Brand & Navigation Breadcrumb */}
      <div className="flex items-center gap-4">
        <div className="w-5 h-5 bg-[#0078D4] rounded-sm flex items-center justify-center shrink-0">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">Copilot Assessment</span>
        <div className="h-4 w-[1px] bg-[#2D2D2D] mx-1 hidden sm:block"></div>
        <nav className="hidden sm:flex items-center gap-2 text-[11px] text-[#A1A1A1] uppercase tracking-widest font-medium">
          <span>Assessment</span>
          <span>/</span>
          <span className="text-[#0078D4]">{currentStepObj?.label || 'Home'}</span>
        </nav>
      </div>

      {/* Center: Breadcrumb Step Selection */}
      <div className="hidden lg:flex items-center space-x-1 py-1">
        {STEPS.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isCompleted = STEPS.findIndex(s => s.id === currentStep) > idx;

          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => onNavigate(step.id)}
                className={`flex items-center space-x-1.5 px-2 py-1 rounded text-xs transition-all ${
                  isActive
                    ? 'bg-[#1F1F1F] text-white font-medium border-l-2 border-[#0078D4]'
                    : isCompleted
                    ? 'text-white hover:bg-[#1A1A1A]'
                    : 'text-[#A1A1A1] hover:text-white hover:bg-[#1A1A1A]'
                }`}
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-mono ${
                  isActive ? 'bg-[#0078D4] text-white font-bold' : isCompleted ? 'bg-[#2D2D2D] text-[#E1E1E1]' : 'bg-[#1F1F1F] text-[#888]'
                }`}>
                  {step.number}
                </span>
                <span>{step.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="w-3 h-3 text-[#444] shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: Progress indicator & Actions */}
      <div className="flex items-center gap-6">
        <div className="hidden sm:flex items-center gap-3">
          <span className="text-[11px] font-bold text-[#A1A1A1] uppercase">Progress</span>
          <div className="w-32 md:w-48 h-1.5 bg-[#2D2D2D] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#0078D4] transition-all duration-300" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-[#0078D4] font-semibold">{String(progressPercent).padStart(2, '0')}%</span>
        </div>

        <div className="flex items-center gap-2 border-l border-[#2D2D2D] pl-4">
          <button
            onClick={onOpenArchitectureSpec}
            className="px-2.5 py-1 bg-[#2D2D2D] text-[#E1E1E1] hover:text-white text-xs font-semibold rounded hover:bg-[#3D3D3D] transition-colors flex items-center gap-1.5"
            title="View Architecture Specification"
          >
            <FileText className="w-3.5 h-3.5 text-[#0078D4]" />
            <span className="hidden md:inline">UI Spec</span>
          </button>

          <button
            onClick={onOpenArchitectureSpec}
            className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded cursor-pointer transition-colors"
            title="Help & Framework Info"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <button
            onClick={onReset}
            className="px-3 py-1 bg-[#2D2D2D] text-white text-xs font-semibold rounded hover:bg-[#3D3D3D] transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    </header>
  );
};
