import React from 'react';
import { AssessmentStage } from '../types';
import { Check, FileText, ChevronRight } from 'lucide-react';

interface AssessmentPipelineProps {
  stages: AssessmentStage[];
  activeStageId: string;
  onSelectStage: (stage: AssessmentStage) => void;
}

export const AssessmentPipeline: React.FC<AssessmentPipelineProps> = ({
  stages,
  activeStageId,
  onSelectStage,
}) => {
  return (
    <div className="bg-[#242424] rounded-xl card-border p-4 md:p-5 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#479ef5]" />
          <h2 className="text-base font-semibold text-[#e0e2ea] tracking-tight">
            Assessment Pipeline
          </h2>
        </div>
        <span className="text-[11px] font-mono text-[#8a919d]">
          {stages.filter((s) => s.status === 'done').length}/{stages.length} Complete
        </span>
      </div>

      <p className="text-[11px] text-[#8a919d] mb-3">
        Click any document below to open full Executive Summary & Remediation Plan.
      </p>

      <ul className="flex flex-col gap-1">
        {stages.map((stage) => {
          const isDone = stage.status === 'done';
          const isInProgress = stage.status === 'in_progress';

          return (
            <li
              key={stage.id}
              onClick={() => onSelectStage(stage)}
              className={`flex items-center py-2.5 px-3 rounded-lg transition-all cursor-pointer group ${
                isInProgress
                  ? 'bg-[#2b2b2b]/80 border border-[#479ef5]/40 hover:border-[#479ef5]'
                  : 'hover:bg-[#2b2b2b]/60 border border-transparent hover:border-white/10'
              }`}
            >
              {/* Icon Circle */}
              {isDone && (
                <div className="w-5 h-5 rounded-full bg-[#181c21] flex items-center justify-center mr-3 text-[#34d399] flex-shrink-0 border border-white/10 group-hover:border-[#34d399]/40">
                  <Check className="w-3 h-3 stroke-[2.5]" />
                </div>
              )}

              {isInProgress && (
                <div className="w-5 h-5 rounded-full bg-[#479ef5]/20 flex items-center justify-center mr-3 flex-shrink-0 border border-[#479ef5] relative">
                  <div className="absolute inset-0 rounded-full bg-[#479ef5]/40 animate-ping" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#479ef5] z-10" />
                </div>
              )}

              {!isDone && !isInProgress && (
                <div className="w-5 h-5 rounded-full bg-[#181c21] flex items-center justify-center mr-3 text-[#8a919d] flex-shrink-0 border border-white/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#8a919d]" />
                </div>
              )}

              {/* Title */}
              <div className="flex-grow min-w-0 mr-2">
                <p
                  className={`text-xs font-medium truncate transition-colors flex items-center gap-1.5 ${
                    isInProgress
                      ? 'text-[#e0e2ea] font-semibold'
                      : 'text-[#e0e2ea] group-hover:text-[#479ef5]'
                  }`}
                >
                  <span>{stage.title}</span>
                </p>
                {stage.completedAt && (
                  <p className="text-[10px] text-[#8a919d] truncate">
                    Finished {stage.completedAt}
                  </p>
                )}
              </div>

              {/* Status Text Badge & Chevron */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="text-[11px] font-semibold">
                  {isDone && <span className="text-[#8a919d]">Done</span>}
                  {isInProgress && <span className="text-[#479ef5]">In Progress</span>}
                  {!isDone && !isInProgress && <span className="text-[#8a919d]/60">Pending</span>}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-[#8a919d] group-hover:text-white group-hover:translate-x-0.5 transition-all" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
