// @ts-nocheck
import React, { useState } from 'react';
import { BookOpen, Zap, Clock, CheckCircle2, ShieldCheck, Play, ArrowRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SopStep {
  stepNumber: number;
  title: string;
  description: string;
  latencyMs: number;
  completed: boolean;
}

export interface EmbeddedSopRunnerProps {
  sopCode: string;
  sopTitle?: string;
  steps?: SopStep[];
  onExecuteAll?: () => void;
  onStepToggle?: (stepNumber: number, completed: boolean) => void;
  className?: string;
}

const DEFAULT_SOP_STEPS: SopStep[] = [
  { stepNumber: 1, title: 'Revoke Active Sign-In Sessions', description: 'Terminates all OAuth tokens and active web sessions across all devices.', latencyMs: 120, completed: false },
  { stepNumber: 2, title: 'Remove Account Excluded State', description: 'Removes target UPN from Conditional Access Policy Exclusion Group.', latencyMs: 340, completed: false },
  { stepNumber: 3, title: 'Force Password Scramble & MFA Re-enroll', description: 'Invalidates current credentials and triggers MFA registration on next login.', latencyMs: 210, completed: false },
];

export const EmbeddedSopRunner: React.FC<EmbeddedSopRunnerProps> = ({
  sopCode = 'SOP-IAM-04',
  sopTitle = 'Executive Identity Hardening & MFA Baseline Auto-Heal',
  steps = DEFAULT_SOP_STEPS,
  onExecuteAll,
  onStepToggle,
  className,
}) => {
  const [stepList, setStepList] = useState<SopStep[]>(steps);
  const [isExecuting, setIsExecuting] = useState(false);

  const toggleStep = (idx: number) => {
    const updated = [...stepList];
    updated[idx].completed = !updated[idx].completed;
    setStepList(updated);
    if (onStepToggle) {
      onStepToggle(updated[idx].stepNumber, updated[idx].completed);
    }
  };

  const handleRunAll = () => {
    setIsExecuting(true);
    setTimeout(() => {
      setStepList(stepList.map((s) => ({ ...s, completed: true })));
      setIsExecuting(false);
      if (onExecuteAll) {
        onExecuteAll();
      }
    }, 1200);
  };

  const completedCount = stepList.filter((s) => s.completed).length;
  const isAllCompleted = completedCount === stepList.length;

  return (
    <div className={cn('rounded-xl border border-[#2d3748] bg-[#101419] p-4 space-y-3 font-sans', className)}>
      {/* SOP Runbook Header */}
      <div className="flex items-center justify-between border-b border-[#232b38] pb-2.5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#38BDF8]" />
          <span className="text-xs font-bold text-slate-100">Matching SOP Runbook</span>
          <span className="text-[10px] bg-[#0078d4]/20 text-[#38BDF8] border border-[#0078d4]/40 px-2 py-0.5 rounded font-mono font-bold">
            {sopCode}
          </span>
        </div>

        <button
          onClick={handleRunAll}
          disabled={isExecuting || isAllCompleted}
          className="text-xs bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
        >
          {isExecuting ? (
            <Clock className="h-3.5 w-3.5 animate-spin" />
          ) : isAllCompleted ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-amber-300" />
          )}
          <span>{isExecuting ? 'Executing Telemetry...' : isAllCompleted ? 'SOP Applied' : 'Run SOP Auto-Heal'}</span>
        </button>
      </div>

      <p className="text-[11px] text-slate-400 leading-normal">
        {sopTitle} (Telemetry Status: <strong className="text-slate-200">{completedCount}/{stepList.length} Steps Completed</strong>)
      </p>

      {/* Step Execution Telemetry List */}
      <div className="space-y-2">
        {stepList.map((step, idx) => (
          <div
            key={step.stepNumber}
            onClick={() => toggleStep(idx)}
            className={cn(
              'flex items-start gap-3 p-2.5 rounded-lg border transition-all cursor-pointer',
              step.completed
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                : 'bg-[#080b12] border-[#232b38] text-slate-300 hover:border-[#38BDF8]/50'
            )}
          >
            <input
              type="checkbox"
              checked={step.completed}
              onChange={() => {}}
              className="mt-0.5 h-3.5 w-3.5 rounded border-[#404752] bg-[#181c22] text-[#0078d4] focus:ring-0 cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  Step {step.stepNumber}: {step.title}
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-[#182235] px-1.5 py-0.5 rounded">
                  ~{step.latencyMs}ms execution
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

