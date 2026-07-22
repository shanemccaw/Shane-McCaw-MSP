import React, { useState } from 'react';
import { ShieldAlert, TrendingUp, AlertTriangle, ArrowRight, DollarSign } from 'lucide-react';

interface CostAndRiskRowProps {
  onOpenSavingsCalculator?: () => void;
  onTriggerRiskMitigation?: () => void;
}

export const CostAndRiskRow: React.FC<CostAndRiskRowProps> = ({
  onOpenSavingsCalculator,
  onTriggerRiskMitigation,
}) => {
  const [hoveredSavingsSource, setHoveredSavingsSource] = useState<string | null>(null);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* 1. Cost Savings Projection */}
      <div className="bg-card border border-border p-6 md:p-8 rounded-xl flex flex-col justify-between relative overflow-hidden">
        <div>
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline text-lg font-bold text-[#e2e2e2]">
              Cost Savings Projection
            </h3>
            <span className="status-pill bg-[#a0c9ff]/20 text-[#a0c9ff] border border-[#a0c9ff]/30">
              LIVE FORECAST
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div className="p-3 bg-[#1a1c1c] rounded-xl border border-[#404752]/40">
              <p className="text-[10px] font-mono text-[#8a919d] uppercase tracking-wider">
                ANNUAL POTENTIAL
              </p>
              <p className="text-3xl font-headline font-bold text-[#a0c9ff] mt-1">
                $174.5k
              </p>
              <p className="text-xs text-[#c0c7d3] mt-1">
                Optimizing E5/G5 license drift
              </p>
            </div>

            <div className="p-3 bg-[#1a1c1c] rounded-xl border border-[#404752]/40">
              <p className="text-[10px] font-mono text-[#8a919d] uppercase tracking-wider">
                MONTHLY RUN-RATE
              </p>
              <p className="text-3xl font-headline font-bold text-[#e2e2e2] mt-1">
                $14,541
              </p>
              <p className="text-xs text-[#c0c7d3] mt-1">
                Automation-driven reduction
              </p>
            </div>
          </div>
        </div>

        {/* Savings Sources Stacked Bar */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-[#8a919d]">Savings Sources</span>
            {hoveredSavingsSource && (
              <span className="text-[#a0c9ff] font-semibold">{hoveredSavingsSource}</span>
            )}
          </div>

          <div className="flex h-10 w-full rounded-lg overflow-hidden border border-[#404752]">
            <button
              onMouseEnter={() => setHoveredSavingsSource('Inactive Accounts: 45% ($78.5k)')}
              onMouseLeave={() => setHoveredSavingsSource(null)}
              className="bg-[#a0c9ff] hover:brightness-110 flex items-center justify-center text-[11px] font-bold text-[#003259] transition-all px-1 cursor-pointer"
              style={{ width: '45%' }}
            >
              Inactive Accounts (45%)
            </button>

            <button
              onMouseEnter={() => setHoveredSavingsSource('License Downgrades: 30% ($52.3k)')}
              onMouseLeave={() => setHoveredSavingsSource(null)}
              className="bg-[#dab9ff] hover:brightness-110 flex items-center justify-center text-[11px] font-bold text-[#421871] transition-all px-1 cursor-pointer"
              style={{ width: '30%' }}
            >
              Downgrades (30%)
            </button>

            <button
              onMouseEnter={() => setHoveredSavingsSource('Auto-Cleanup: 25% ($43.7k)')}
              onMouseLeave={() => setHoveredSavingsSource(null)}
              className="bg-[#c8c6c5] hover:brightness-110 flex items-center justify-center text-[11px] font-bold text-[#313030] transition-all px-1 cursor-pointer"
              style={{ width: '25%' }}
            >
              Auto-Cleanup (25%)
            </button>
          </div>
        </div>
      </div>

      {/* 2. Risk Concentration */}
      <div className="bg-card border border-border p-6 md:p-8 rounded-xl flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline text-lg font-bold text-[#e2e2e2]">
              Risk Concentration
            </h3>
            <span className="status-pill bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/30">
              HIGH EXPOSURE
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Left list */}
            <div className="space-y-3">
              <div className="p-3 bg-[#1e2020] rounded-lg border-l-4 border-[#ffb4ab]">
                <p className="text-[10px] font-mono text-[#8a919d]">Top Source</p>
                <p className="text-xs font-bold text-[#e2e2e2] mt-0.5">
                  Privileged Identity Drift
                </p>
              </div>

              <div className="p-3 bg-[#1e2020] rounded-lg border-l-4 border-[#dab9ff]">
                <p className="text-[10px] font-mono text-[#8a919d]">Emerging Risk</p>
                <p className="text-xs font-bold text-[#e2e2e2] mt-0.5">
                  Unlabeled DLP Overrides
                </p>
              </div>

              <div className="p-3 bg-[#1e2020] rounded-lg border-l-4 border-[#c8c6c5]">
                <p className="text-[10px] font-mono text-[#8a919d]">Governance Gap</p>
                <p className="text-xs font-bold text-[#e2e2e2] mt-0.5">
                  Expired Guest Access
                </p>
              </div>
            </div>

            {/* Right Gauge metric */}
            <div className="flex flex-col items-center justify-center bg-[#1a1c1c] rounded-xl p-4 border border-[#404752]/40 text-center">
              <span className="text-4xl md:text-5xl font-headline font-bold text-[#ffb4ab]">
                84%
              </span>
              <p className="text-xs text-[#c0c7d3] mt-2 font-medium max-w-[180px]">
                Critical Risk Reduction via Automation
              </p>
              
              <div className="mt-4 w-full h-1.5 bg-[#333535] rounded-full overflow-hidden">
                <div className="h-full bg-[#ffb4ab] rounded-full w-[84%]" />
              </div>

              <button
                onClick={onTriggerRiskMitigation}
                className="mt-4 text-xs font-mono text-[#a0c9ff] hover:underline flex items-center space-x-1"
              >
                <span>Initiate Auto-Fix</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
