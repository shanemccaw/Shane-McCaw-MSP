import React from 'react';
import { LayoutDashboard, Zap, ArrowRight, ShieldCheck } from 'lucide-react';

interface ExecutiveCtaBarProps {
  onOpenDashboards: () => void;
  onEnableAutomation: () => void;
}

export const ExecutiveCtaBar: React.FC<ExecutiveCtaBarProps> = ({
  onOpenDashboards,
  onEnableAutomation,
}) => {
  return (
    <section className="flex flex-col md:flex-row items-center justify-between gap-6 bg-[#1a1c1c] p-6 md:p-8 rounded-xl border border-[#479ef5]/30 mb-8 relative overflow-hidden">
      {/* Background subtle glow */}
      <div className="absolute right-0 top-0 w-96 h-full bg-[#479ef5]/5 blur-2xl pointer-events-none" />

      <div className="text-center md:text-left z-10">
        <div className="flex items-center space-x-2 justify-center md:justify-start mb-1">
          <ShieldCheck className="w-5 h-5 text-[#a0c9ff]" />
          <h2 className="font-headline text-xl font-bold text-[#e2e2e2]">
            Ready for deeper analysis?
          </h2>
        </div>
        <p className="text-xs md:text-sm text-[#c0c7d3]">
          Explore granular metrics per pillar or initiate automated remediation workflows.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 z-10">
        <button
          onClick={onOpenDashboards}
          className="px-5 py-2.5 bg-[#479ef5] text-[#003259] font-mono text-xs font-bold rounded-lg hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(71,158,245,0.3)] flex items-center space-x-2 cursor-pointer"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Open Full Pillar Dashboards</span>
        </button>

        <button
          onClick={onEnableAutomation}
          className="px-5 py-2.5 bg-[#333535] text-[#e2e2e2] font-mono text-xs font-semibold rounded-lg border border-[#404752] hover:bg-[#38393a] hover:border-[#a0c9ff] active:scale-95 transition-all flex items-center space-x-2 cursor-pointer"
        >
          <Zap className="w-4 h-4 text-[#a0c9ff]" />
          <span>Enable Premium Automation</span>
        </button>
      </div>
    </section>
  );
};
