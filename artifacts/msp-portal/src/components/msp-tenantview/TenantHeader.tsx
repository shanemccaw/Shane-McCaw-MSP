import React from 'react';
import { Tenant } from '../types';

interface TenantHeaderProps {
  tenant: Tenant;
  onRefreshSync?: () => void;
}

export const TenantHeader: React.FC<TenantHeaderProps> = ({ tenant, onRefreshSync }) => {
  // SVG Radial Progress Calculation
  const strokeDasharray = 251.2;
  const progressOffset = strokeDasharray - (strokeDasharray * tenant.healthScore) / 100;

  return (
    <section className="glass-panel rounded-xl p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-end border-l-4 border-[#99cbff] gap-6 relative overflow-hidden">
      {/* Background blueprint grid overlay effect */}
      <div className="absolute inset-0 blueprint-bg opacity-30 pointer-events-none"></div>

      {/* Left Metadata & Tenant Name */}
      <div className="relative z-10">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="bg-[#99cbff]/20 text-[#99cbff] text-[10px] px-2.5 py-0.5 rounded font-mono font-bold tracking-wider">
            {tenant.type}
          </span>
          <span className="text-[#bfc7d3] font-mono text-[10px] tracking-wider">
            DIRECTORY ID: {tenant.directoryId}
          </span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-[#e2e2e6] tracking-tighter">
          {tenant.name}
        </h1>

        <div className="flex flex-wrap gap-3 mt-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1c1f] rounded-full border border-[#3f4751]/30 text-xs">
            <span className="w-2 h-2 rounded-full bg-[#00daf8] indicator-pulse"></span>
            <span className="text-[#bfc7d3]">Graph API: <strong className="text-[#e2e2e6]">{tenant.graphStatus}</strong></span>
          </div>
          <div 
            onClick={onRefreshSync}
            className="flex items-center gap-2 px-3 py-1 bg-[#1a1c1f] hover:bg-[#282a2d] rounded-full border border-[#3f4751]/30 text-xs cursor-pointer transition-colors"
            title="Click to sync now"
          >
            <span className="w-2 h-2 rounded-full bg-[#00daf8]"></span>
            <span className="text-[#bfc7d3]">Sync: <strong className="text-[#e2e2e6]">{tenant.syncStatus}</strong></span>
            <span className="material-symbols-outlined text-xs text-[#bfc7d3] hover:rotate-180 transition-transform">sync</span>
          </div>
        </div>
      </div>

      {/* Right Overall Health Score Gauge */}
      <div className="relative z-10 flex flex-col items-start md:items-end w-full md:w-auto">
        <span className="font-mono text-[#bfc7d3] text-[10px] mb-2 uppercase tracking-widest">
          OVERALL HEALTH SCORE
        </span>

        <div className="flex items-center gap-4">
          <div className="text-left md:text-right">
            <div className="text-[#99cbff] font-bold text-3xl md:text-4xl leading-none font-mono">
              {tenant.healthScore}/100
            </div>
            <span className="text-[#00daf8] text-[11px] font-mono font-bold tracking-widest uppercase">
              {tenant.healthStatus}
            </span>
          </div>

          <div className="w-20 h-20 md:w-24 md:h-24 relative shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                className="text-[#1e2023]"
                cx="48"
                cy="48"
                fill="transparent"
                r="40"
                stroke="currentColor"
                strokeWidth="8"
              />
              <circle
                className="text-[#99cbff] transition-all duration-1000 ease-out"
                cx="48"
                cy="48"
                fill="transparent"
                r="40"
                stroke="currentColor"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={progressOffset}
                strokeLinecap="round"
                strokeWidth="8"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#99cbff] text-xl md:text-2xl">
                verified
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
