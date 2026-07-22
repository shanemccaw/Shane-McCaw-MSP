import React, { useState } from 'react';
import { RiskDistribution, SignInTrendPoint } from '../types';
import { Fingerprint, TrendingUp } from 'lucide-react';

interface IdentityRiskDistributionProps {
  distribution: RiskDistribution;
  trend: SignInTrendPoint[];
}

export const IdentityRiskDistribution: React.FC<IdentityRiskDistributionProps> = ({
  distribution,
  trend,
}) => {
  const [activePoint, setActivePoint] = useState<SignInTrendPoint | null>(null);

  return (
    <div className="glass-card rounded-xl p-4 h-full flex flex-col justify-between border border-white/10 shadow-lg">
      {/* Identity Risk Distribution Section */}
      <div>
        <h3 className="font-mono text-xs text-[#c0c7d3] mb-3 flex items-center gap-1.5 uppercase tracking-wider font-medium">
          <Fingerprint className="w-4 h-4 text-[#a0c9ff]" />
          Identity Risk Distribution
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#e2e2e2]">High Risk</span>
            <span className="font-mono text-[#ffb4ab] font-medium">{distribution.highRiskPercentage}%</span>
          </div>

          {/* Bar chart representation */}
          <div className="w-full bg-[#0c0f0f] h-3 rounded-full overflow-hidden flex p-0.5 border border-white/5">
            <div
              className="bg-[#ffb4ab] h-full rounded-l-full transition-all duration-500"
              style={{ width: `${distribution.highRiskPercentage}%` }}
              title={`High Risk: ${distribution.highRiskPercentage}%`}
            />
            <div
              className="bg-[#5a3289] h-full transition-all duration-500"
              style={{ width: `${distribution.mediumRiskPercentage}%` }}
              title={`Medium Risk: ${distribution.mediumRiskPercentage}%`}
            />
            <div
              className="bg-[#a0c9ff] h-full rounded-r-full transition-all duration-500"
              style={{ width: `${distribution.lowRiskPercentage}%` }}
              title={`Low Risk: ${distribution.lowRiskPercentage}%`}
            />
          </div>

          <div className="flex justify-between font-mono text-[11px] text-[#c0c7d3] pt-0.5">
            <span>Low Risk ({distribution.lowRiskPercentage}%)</span>
            <span>Med ({distribution.mediumRiskPercentage}%)</span>
          </div>
        </div>
      </div>

      {/* Sign-in Risk Trend Sparkline Section */}
      <div className="mt-5 pt-4 border-t border-[#404752]/40">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-mono text-xs text-[#c0c7d3] flex items-center gap-1.5 uppercase tracking-wider font-medium">
            <TrendingUp className="w-4 h-4 text-[#ffb4ab]" />
            Sign-In Risk Trend
          </h3>
          {activePoint && (
            <span className="font-mono text-[10px] text-[#a0c9ff] bg-[#479ef5]/10 px-1.5 py-0.5 rounded border border-[#479ef5]/20">
              {activePoint.timeLabel}: {activePoint.value}% Risk
            </span>
          )}
        </div>

        {/* Sparkline Columns */}
        <div className="h-20 flex items-end gap-1.5 px-1 pt-2">
          {trend.map((point) => {
            const isHighlight = point.isCurrent;
            return (
              <div
                key={point.id}
                onMouseEnter={() => setActivePoint(point)}
                onMouseLeave={() => setActivePoint(null)}
                className="flex-1 flex flex-col items-center group cursor-pointer h-full justify-end"
              >
                <div
                  className={`w-full rounded-t-sm transition-all duration-200 ${
                    isHighlight
                      ? 'bg-[#ffb4ab] shadow-[0_0_12px_rgba(255,180,171,0.6)]'
                      : 'bg-[#ffb4ab]/40 group-hover:bg-[#ffb4ab]/80'
                  }`}
                  style={{ height: `${point.value}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
