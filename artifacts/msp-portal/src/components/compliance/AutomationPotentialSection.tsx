import React from 'react';
import { Zap, Tag, Shield, History, Rocket } from 'lucide-react';
import { AutomationPatch } from './types';

interface AutomationPotentialSectionProps {
  patches: AutomationPatch[];
  onPatchAction: (patch: AutomationPatch) => void;
}

export const AutomationPotentialSection: React.FC<AutomationPotentialSectionProps> = ({
  patches,
  onPatchAction
}) => {
  return (
    <section className="space-y-4">
      {/* Header with Bolt Icon */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-[#479ef5] fill-[#479ef5]" />
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          Compliance Automation Potential
        </h3>
      </div>

      {/* 3 Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Auto-apply sensitivity labels */}
        {patches[0] && (
          <div className="card-obsidian-no-hover p-6 flex flex-col justify-between gap-6 border-l-4 border-l-[#479ef5] hover:bg-[#2b2b2b] transition-colors">
            <div className="flex justify-between items-start">
              <div className="p-2 bg-[#479ef5]/10 rounded">
                <Tag className="w-5 h-5 text-[#479ef5]" />
              </div>
              <span className="text-[10px] font-['JetBrains_Mono'] font-medium bg-[#479ef5]/20 text-[#a0c9ff] px-2 py-1 rounded">
                {patches[0].patchLabel}
              </span>
            </div>
            <div>
              <h4 className="text-[16px] leading-[24px] font-['Inter'] font-bold mb-1 text-[#e2e2e2]">
                {patches[0].title}
              </h4>
              <p className="text-[12px] leading-[16px] font-['Inter'] text-[#c0c7d3]">
                {patches[0].predictedImpact}
              </p>
            </div>
            <button
              onClick={() => onPatchAction(patches[0])}
              disabled={patches[0].applied}
              className={`w-full py-2 ${
                patches[0].applied
                  ? 'bg-[#10b981] text-white cursor-default'
                  : 'bg-[#479ef5] text-[#003259] hover:opacity-90'
              } font-bold rounded transition-all flex items-center justify-center gap-2 text-xs`}
            >
              {patches[0].applied ? 'Applied ✓' : patches[0].actionText}
              {!patches[0].applied && <Rocket className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Card 2: Tighten DLP rules */}
        {patches[1] && (
          <div className="card-obsidian-no-hover p-6 flex flex-col justify-between gap-6 border-l-4 border-l-[#f59e0b] hover:bg-[#2b2b2b] transition-colors">
            <div className="flex justify-between items-start">
              <div className="p-2 bg-[#f59e0b]/10 rounded">
                <Shield className="w-5 h-5 text-[#f59e0b]" />
              </div>
              <span className="text-[10px] font-['JetBrains_Mono'] font-medium bg-[#f59e0b]/20 text-[#f59e0b] px-2 py-1 rounded">
                {patches[1].patchLabel}
              </span>
            </div>
            <div>
              <h4 className="text-[16px] leading-[24px] font-['Inter'] font-bold mb-1 text-[#e2e2e2]">
                {patches[1].title}
              </h4>
              <p className="text-[12px] leading-[16px] font-['Inter'] text-[#c0c7d3]">
                {patches[1].predictedImpact}
              </p>
            </div>
            <button
              onClick={() => onPatchAction(patches[1])}
              disabled={patches[1].applied}
              className={`w-full py-2 ${
                patches[1].applied
                  ? 'bg-[#10b981] text-white cursor-default border-none'
                  : 'border border-[#f59e0b] text-[#f59e0b] hover:bg-[#f59e0b]/10'
              } font-bold rounded transition-all text-xs`}
            >
              {patches[1].applied ? 'Applied ✓' : patches[1].actionText}
            </button>
          </div>
        )}

        {/* Card 3: Enforce retention baseline */}
        {patches[2] && (
          <div className="card-obsidian-no-hover p-6 flex flex-col justify-between gap-6 border-l-4 border-l-[#10b981] hover:bg-[#2b2b2b] transition-colors">
            <div className="flex justify-between items-start">
              <div className="p-2 bg-[#10b981]/10 rounded">
                <History className="w-5 h-5 text-[#10b981]" />
              </div>
              <span className="text-[10px] font-['JetBrains_Mono'] font-medium bg-[#10b981]/20 text-[#10b981] px-2 py-1 rounded">
                {patches[2].patchLabel}
              </span>
            </div>
            <div>
              <h4 className="text-[16px] leading-[24px] font-['Inter'] font-bold mb-1 text-[#e2e2e2]">
                {patches[2].title}
              </h4>
              <p className="text-[12px] leading-[16px] font-['Inter'] text-[#c0c7d3]">
                {patches[2].predictedImpact}
              </p>
            </div>
            <button
              onClick={() => onPatchAction(patches[2])}
              disabled={patches[2].applied}
              className={`w-full py-2 ${
                patches[2].applied
                  ? 'bg-[#10b981] text-white cursor-default border-none'
                  : 'border border-[#10b981] text-[#10b981] hover:bg-[#10b981]/10'
              } font-bold rounded transition-all text-xs`}
            >
              {patches[2].applied ? 'Deployed ✓' : patches[2].actionText}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
