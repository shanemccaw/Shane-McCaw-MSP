import React from 'react';
import { Sparkles, Activity, ShieldCheck } from 'lucide-react';

interface AssessmentHeroProps {
  progressPercentage: number;
  activeStageTitle: string;
  isScanning: boolean;
  onTriggerScan: () => void;
}

export const AssessmentHero: React.FC<AssessmentHeroProps> = ({
  progressPercentage,
  activeStageTitle,
  isScanning,
  onTriggerScan,
}) => {
  return (
    <section className="bg-[#242424] rounded-xl card-border p-6 md:p-8 flex flex-col items-center justify-center relative overflow-hidden shadow-xl">
      {/* Background glow ambient effect */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[800px] h-[350px] bg-[#479ef5] blur-[120px] rounded-full opacity-30" />
      </div>

      <div className="z-10 w-full max-w-2xl flex flex-col items-center text-center">
        {/* Top pill badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#101419]/60 border border-white/10 text-xs text-[#c0c7d3] mb-3">
          <Sparkles className="w-3.5 h-3.5 text-[#479ef5] animate-pulse" />
          <span>Tenant Telemetry Engine v4.2</span>
        </div>

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-bold text-[#e0e2ea] mb-2 tracking-tight">
          M365 Environment Assessment
        </h1>

        {/* Subtitle */}
        <p className="text-sm md:text-base text-[#c0c7d3] mb-6">
          Processing Tenant Telemetry:{' '}
          <span className="text-[#479ef5] font-semibold">{activeStageTitle}</span>
        </p>

        {/* Animated Progress Bar */}
        <div className="w-full bg-[#31353b] rounded-full h-2.5 mb-3 overflow-hidden p-0.5 border border-white/5 relative">
          <div
            className={`bg-[#479ef5] h-full rounded-full transition-all duration-700 ease-out relative ${
              isScanning ? 'animate-pulse' : ''
            }`}
            style={{ width: `${progressPercentage}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
          </div>
        </div>

        {/* Progress Text */}
        <div className="flex justify-between w-full text-xs font-semibold text-[#c0c7d3] tracking-wide uppercase">
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#479ef5]" />
            Overall Progress
          </span>
          <span className="text-[#479ef5] font-mono text-sm">{progressPercentage}%</span>
        </div>
      </div>
    </section>
  );
};
