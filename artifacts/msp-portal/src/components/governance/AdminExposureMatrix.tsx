import React, { useState } from 'react';
import { AdminExposureMetric } from './types';
import { Shield } from 'lucide-react';

interface AdminExposureMatrixProps {
  metrics: AdminExposureMetric[];
}

export const AdminExposureMatrix: React.FC<AdminExposureMatrixProps> = ({ metrics }) => {
  const [activeMetric, setActiveMetric] = useState<AdminExposureMetric | null>(null);

  // Map metric keys to coordinates or tooltip content
  const getMetricByKey = (key: string) => metrics.find((m) => m.key === key);

  return (
    <div className="bg-card border border-border p-6 rounded-xl flex flex-col justify-between h-full relative">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-headline text-lg font-semibold flex items-center gap-2 text-[#e2e2e2]">
          <Shield className="w-5 h-5 text-[#eab308]" />
          Admin Exposure Matrix
        </h3>
        <span className="font-mono text-xs text-[#8a919d]">RADAR AUDIT</span>
      </div>

      <div className="flex-grow flex items-center justify-center relative min-h-[220px]">
        {/* SVG Radar Chart */}
        <svg className="w-56 h-56 overflow-visible" viewBox="0 0 100 100">
          {/* Concentric Grid Circles */}
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />

          {/* Radial Spokes */}
          <path
            d="M50 5 L50 95 M5 50 L95 50 M18 18 L82 82 M18 82 L82 18"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.5"
          />

          {/* Polygon area matching mockup shape */}
          <polygon
            points="50,20 80,50 50,85 25,50"
            fill="rgba(71, 158, 245, 0.25)"
            stroke="#479ef5"
            strokeWidth="1.5"
            className="transition-all duration-300 hover:fill-rgba(71, 158, 245, 0.4) cursor-pointer"
          />

          {/* Points at vertices */}
          {/* Top: Admin Count (50, 20) */}
          <circle
            cx="50"
            cy="20"
            r="3"
            className="fill-[#479ef5] hover:r-4 cursor-pointer transition-all"
            onMouseEnter={() => setActiveMetric(getMetricByKey('adminCount') || null)}
            onMouseLeave={() => setActiveMetric(null)}
          />
          {/* Right: No CA Enforced (80, 50) */}
          <circle
            cx="80"
            cy="50"
            r="3"
            className="fill-[#479ef5] hover:r-4 cursor-pointer transition-all"
            onMouseEnter={() => setActiveMetric(getMetricByKey('noCA') || null)}
            onMouseLeave={() => setActiveMetric(null)}
          />
          {/* Bottom: Stale Accounts (50, 85) */}
          <circle
            cx="50"
            cy="85"
            r="3"
            className="fill-[#479ef5] hover:r-4 cursor-pointer transition-all"
            onMouseEnter={() => setActiveMetric(getMetricByKey('staleAccounts') || null)}
            onMouseLeave={() => setActiveMetric(null)}
          />
          {/* Left: Risky Sign-ins (25, 50) */}
          <circle
            cx="25"
            cy="50"
            r="3"
            className="fill-[#479ef5] hover:r-4 cursor-pointer transition-all"
            onMouseEnter={() => setActiveMetric(getMetricByKey('riskySignIns') || null)}
            onMouseLeave={() => setActiveMetric(null)}
          />
        </svg>

        {/* Axis Labels Positioned around Radar */}
        <div 
          onMouseEnter={() => setActiveMetric(getMetricByKey('adminCount') || null)}
          onMouseLeave={() => setActiveMetric(null)}
          className="absolute top-0 left-1/2 -translate-x-1/2 font-mono text-[11px] text-[#c0c7d3] hover:text-[#479ef5] cursor-pointer transition-colors"
        >
          Admin Count
        </div>
        <div 
          onMouseEnter={() => setActiveMetric(getMetricByKey('staleAccounts') || null)}
          onMouseLeave={() => setActiveMetric(null)}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[11px] text-[#c0c7d3] hover:text-[#479ef5] cursor-pointer transition-colors"
        >
          Stale Accounts
        </div>
        <div 
          onMouseEnter={() => setActiveMetric(getMetricByKey('noCA') || null)}
          onMouseLeave={() => setActiveMetric(null)}
          className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[#c0c7d3] hover:text-[#479ef5] cursor-pointer transition-colors"
        >
          No CA Enforced
        </div>
        <div 
          onMouseEnter={() => setActiveMetric(getMetricByKey('riskySignIns') || null)}
          onMouseLeave={() => setActiveMetric(null)}
          className="absolute left-0 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[#c0c7d3] hover:text-[#479ef5] cursor-pointer transition-colors text-right"
        >
          Risky Sign-ins
        </div>
      </div>

      {/* Hover Info Banner */}
      <div className="mt-2 h-10 border-t border-white/5 pt-2 flex items-center justify-between text-xs font-mono">
        {activeMetric ? (
          <div className="w-full flex justify-between items-center text-[#479ef5]">
            <span className="font-semibold">{activeMetric.label}:</span>
            <span className="text-[#e2e2e2]">{activeMetric.rawValue}</span>
          </div>
        ) : (
          <span className="text-[#8a919d] text-[10px] italic">Hover nodes for exposure metrics</span>
        )}
      </div>
    </div>
  );
};
