import React from 'react';
import { SecurityMetrics, TimeFrame } from './types';
import { TrendingUp, Shield, RefreshCw, Activity } from 'lucide-react';

interface HeaderHeroBandProps {
  metrics: SecurityMetrics;
  timeframe: TimeFrame;
  onTimeframeChange: (tf: TimeFrame) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const HeaderHeroBand: React.FC<HeaderHeroBandProps> = ({
  metrics,
  timeframe,
  onTimeframeChange,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div className="bg-card rounded-xl p-6 relative overflow-hidden flex flex-col justify-between border border-white/10 shadow-2xl">
      {/* Top Bar with Title, Controls and Health Score */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-headline text-2xl md:text-3xl font-semibold text-[#a0c9ff] tracking-tight">
              Security Intelligence Overview
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-[#479ef5]/10 text-[#a0c9ff] border border-[#479ef5]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#40c463] animate-pulse"></span>
              LIVE
            </span>
          </div>
          <p className="text-[#c0c7d3] font-mono text-xs tracking-wide">
            Real-time Tenant Telemetry | Graph API v2.1
          </p>
        </div>

        {/* Action Controls & Health Score */}
        <div className="flex items-center gap-6 self-end md:self-auto">
          {/* Timeframe Selector & Refresh */}
          <div className="hidden sm:flex items-center gap-2 bg-[#0c0f0f]/80 p-1 rounded-lg border border-[#404752]/50">
            {(['24h', '7d', '30d'] as TimeFrame[]).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-[#479ef5] text-[#003259] font-medium shadow'
                    : 'text-[#c0c7d3] hover:text-white hover:bg-white/5'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh telemetry stream"
              className="p-1.5 text-[#c0c7d3] hover:text-[#a0c9ff] hover:bg-white/5 rounded transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#a0c9ff]' : ''}`} />
            </button>
          </div>

          {/* Health Score Box */}
          <div className="flex flex-col items-end pl-4 border-l border-[#404752]/50">
            <span className="text-[#c0c7d3] font-mono text-[10px] uppercase tracking-widest font-medium">
              Health Score
            </span>
            <div className="flex items-center gap-2">
              <span className="font-headline text-4xl md:text-5xl font-bold text-[#a0c9ff] metric-glow">
                {metrics.healthScore}
              </span>
              <TrendingUp className="w-6 h-6 text-[#c8ffc8] stroke-[2.5]" />
            </div>
          </div>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="mt-6 pt-5 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4 z-10">
        <div>
          <div className="text-[#c0c7d3] font-mono text-xs mb-1">High-Risk Identities</div>
          <div className="font-headline text-2xl font-bold text-[#ffb4ab]">
            {metrics.highRiskIdentities}
          </div>
        </div>

        <div>
          <div className="text-[#c0c7d3] font-mono text-xs mb-1">Critical Alerts (24h)</div>
          <div className="font-headline text-2xl font-bold text-[#ffb4ab]">
            {metrics.criticalAlerts24h}
          </div>
        </div>

        <div>
          <div className="text-[#c0c7d3] font-mono text-xs mb-1">Potential Risk Reduction</div>
          <div className="font-headline text-2xl font-bold text-[#c8ffc8]">
            {metrics.potentialRiskReduction}%
          </div>
        </div>

        <div className="flex flex-col justify-end">
          <div className="flex gap-1 h-2 w-full bg-[#0c0f0f] rounded-full overflow-hidden p-0.5 border border-white/5">
            <div className="bg-[#ffb4ab] w-1/4 rounded-full" title="Critical"></div>
            <div className="bg-[#5a3289] w-1/3 rounded-full" title="High"></div>
            <div className="bg-[#8a919d] w-5/12 rounded-full" title="Medium"></div>
          </div>
          <div className="flex justify-between text-[10px] text-[#c0c7d3] mt-1.5 font-mono">
            <span className="text-[#ffb4ab]">CRIT</span>
            <span className="text-[#dab9ff]">HIGH</span>
            <span className="text-[#8a919d]">MED</span>
          </div>
        </div>
      </div>

      {/* Decorative Background Icon */}
      <div className="absolute -right-12 -top-12 opacity-[0.04] pointer-events-none text-white">
        <Shield className="w-[320px] h-[320px]" />
      </div>
    </div>
  );
};
