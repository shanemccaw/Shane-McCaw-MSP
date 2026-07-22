import React from 'react';
import { TrendingUp, CheckCircle, Database, ShieldCheck } from 'lucide-react';
import { MetricSummary } from './types';

interface HeroBandProps {
  metrics: MetricSummary;
  onMetricClick?: (metricName: string) => void;
}

export const HeroBand: React.FC<HeroBandProps> = ({ metrics, onMetricClick }) => {
  return (
    <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* 1. Compliance Health Score */}
      <div 
        onClick={() => onMetricClick?.('healthScore')}
        className="card-obsidian p-6 flex flex-col justify-between cursor-pointer group hover:border-[#479ef5]/60 transition-all"
      >
        <div>
          <span className="text-[12px] font-['JetBrains_Mono'] text-[#c0c7d3] uppercase tracking-wider font-medium">
            Compliance Health Score
          </span>
          <div className="flex items-baseline gap-1 mt-2">
            <h2 className="text-[48px] leading-[56px] font-['Hanken_Grotesk'] font-bold text-[#a0c9ff] tracking-tight">
              {metrics.healthScore}
            </h2>
            <span className="text-[12px] font-['JetBrains_Mono'] text-[#a0c9ff]/60 font-medium">
              /100
            </span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-[#dab9ff]">
          <TrendingUp className="w-4 h-4 text-[#dab9ff]" />
          <span className="text-[10px] font-['JetBrains_Mono'] font-medium">
            +{metrics.healthChange}% from last audit
          </span>
        </div>
      </div>

      {/* 2. Labeled Content Ratio */}
      <div 
        onClick={() => onMetricClick?.('labeledRatio')}
        className="card-obsidian p-6 flex flex-col justify-between cursor-pointer group hover:border-[#479ef5]/60 transition-all"
      >
        <div>
          <span className="text-[12px] font-['JetBrains_Mono'] text-[#c0c7d3] uppercase tracking-wider font-medium">
            Labeled Content Ratio
          </span>
          <h2 className="text-[24px] leading-[32px] font-['Hanken_Grotesk'] font-semibold mt-2 text-[#e2e2e2]">
            {metrics.labeledRatio}%
          </h2>
          <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden mt-4">
            <div 
              className="h-full bg-[#479ef5] transition-all duration-700 ease-out" 
              style={{ width: `${metrics.labeledRatio}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[#c0c7d3] text-[12px]">
          <Database className="w-3.5 h-3.5 text-[#a0c9ff]" />
          <span className="text-[12px] font-['Inter']">{metrics.totalItemsDetected}</span>
        </div>
      </div>

      {/* 3. Retention Coverage */}
      <div 
        onClick={() => onMetricClick?.('retentionCoverage')}
        className="card-obsidian p-6 flex flex-col justify-between cursor-pointer group hover:border-[#10b981]/60 transition-all"
      >
        <div>
          <span className="text-[12px] font-['JetBrains_Mono'] text-[#c0c7d3] uppercase tracking-wider font-medium">
            Retention Coverage
          </span>
          <h2 className="text-[24px] leading-[32px] font-['Hanken_Grotesk'] font-semibold mt-2 text-[#e2e2e2]">
            {metrics.retentionCoverageRatio}%
          </h2>
          <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden mt-4">
            <div 
              className="h-full bg-[#10b981] transition-all duration-700 ease-out" 
              style={{ width: `${metrics.retentionCoverageRatio}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[#c0c7d3] text-[12px]">
          <CheckCircle className="w-3.5 h-3.5 text-[#10b981]" />
          <span className="text-[12px] font-['Inter']">Across {metrics.workloadCount} major workloads</span>
        </div>
      </div>

      {/* 4. Audit Log Completeness */}
      <div 
        onClick={() => onMetricClick?.('auditCompleteness')}
        className="card-obsidian p-6 flex flex-col justify-between cursor-pointer group hover:border-[#f59e0b]/60 transition-all"
      >
        <div>
          <span className="text-[12px] font-['JetBrains_Mono'] text-[#c0c7d3] uppercase tracking-wider font-medium">
            Audit Log Completeness
          </span>
          <h2 className="text-[24px] leading-[32px] font-['Hanken_Grotesk'] font-semibold mt-2 text-[#e2e2e2]">
            {metrics.auditCompletenessRatio}%
          </h2>
          <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden mt-4">
            <div 
              className="h-full bg-[#f59e0b] transition-all duration-700 ease-out" 
              style={{ width: `${metrics.auditCompletenessRatio}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[#c0c7d3] text-[12px]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#f59e0b]" />
          <span className="text-[12px] font-['Inter']">{metrics.auditCheckStatus}</span>
        </div>
      </div>
    </section>
  );
};
