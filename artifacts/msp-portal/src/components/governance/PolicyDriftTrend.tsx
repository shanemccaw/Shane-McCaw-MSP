import React, { useState } from 'react';
import { PolicyDriftPoint } from './types';
import { Activity } from 'lucide-react';

interface PolicyDriftTrendProps {
  data: PolicyDriftPoint[];
}

export const PolicyDriftTrend: React.FC<PolicyDriftTrendProps> = ({ data }) => {
  const [timeRange, setTimeRange] = useState<'30D' | '60D' | '90D'>('30D');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Filter or scale data based on timeRange
  const displayData = React.useMemo(() => {
    if (timeRange === '60D') {
      return [
        { date: '01 AUG', changes: 30, driftScore: 12 },
        { date: '15 AUG', changes: 45, driftScore: 22 },
        ...data
      ];
    }
    if (timeRange === '90D') {
      return [
        { date: '01 JUL', changes: 22, driftScore: 8 },
        { date: '15 JUL', changes: 38, driftScore: 15 },
        { date: '01 AUG', changes: 30, driftScore: 12 },
        { date: '15 AUG', changes: 45, driftScore: 22 },
        ...data
      ];
    }
    return data;
  }, [data, timeRange]);

  return (
    <section className="bg-card border border-border p-6 rounded-xl relative">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <h3 className="font-headline text-lg font-semibold flex items-center gap-2 text-[#e2e2e2]">
          <Activity className="w-5 h-5 text-[#479ef5]" />
          Audit &amp; Policy Drift Trend
        </h3>

        <div className="flex flex-wrap items-center gap-4">
          {/* Time Range Selector */}
          <div className="flex bg-[#121414] p-1 rounded-md border border-white/5 font-mono text-[10px]">
            {(['30D', '60D', '90D'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  timeRange === range
                    ? 'bg-[#479ef5] text-[#001c37] font-semibold'
                    : 'text-[#8a919d] hover:text-[#e2e2e2]'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex gap-4 font-mono text-xs">
            <span className="flex items-center gap-1.5 text-[#479ef5]">
              <span className="w-2 h-2 rounded-full bg-[#479ef5]"></span>
              Changes
            </span>
            <span className="flex items-center gap-1.5 text-[#ef4444]">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]"></span>
              Drift Score
            </span>
          </div>
        </div>
      </div>

      {/* SVG Interactive Trend Chart */}
      <div className="h-60 sm:h-64 relative w-full">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(71, 158, 245, 0.45)" />
              <stop offset="100%" stopColor="rgba(71, 158, 245, 0)" />
            </linearGradient>
          </defs>

          {/* Area Chart Path */}
          <path
            d="M0 200 L0 120 Q 250 80, 500 140 T 1000 100 L 1000 200 Z"
            fill="url(#areaGrad)"
          />

          {/* Changes Line */}
          <path
            d="M0 120 Q 250 80, 500 140 T 1000 100"
            fill="none"
            stroke="#479ef5"
            strokeWidth="3"
          />

          {/* Red Drift Line */}
          <path
            d="M0 180 Q 250 140, 500 120 T 1000 70"
            fill="none"
            stroke="#ef4444"
            strokeDasharray="8 4"
            strokeWidth="2.5"
          />

          {/* Interactive Data Point Dots */}
          {displayData.map((pt, idx) => {
            const x = (idx / (displayData.length - 1)) * 1000;
            const y1 = 120 - (pt.changes / 120) * 80;
            const y2 = 180 - (pt.driftScore / 100) * 110;

            return (
              <g key={idx} className="cursor-pointer" onMouseEnter={() => setHoveredIndex(idx)}>
                {/* Vertical guide line on hover */}
                {hoveredIndex === idx && (
                  <line x1={x} y1="0" x2={x} y2="200" stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
                )}
                {/* Changes Dot */}
                <circle cx={x} cy={y1} r={hoveredIndex === idx ? 6 : 4} fill="#479ef5" stroke="#121414" strokeWidth="2" />
                {/* Drift Dot */}
                <circle cx={x} cy={y2} r={hoveredIndex === idx ? 6 : 4} fill="#ef4444" stroke="#121414" strokeWidth="2" />
              </g>
            );
          })}
        </svg>

        {/* Grid Background Overlay Lines */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-15">
          <div className="border-t border-white"></div>
          <div className="border-t border-white"></div>
          <div className="border-t border-white"></div>
          <div className="border-t border-white"></div>
        </div>

        {/* Hover Tooltip Box */}
        {hoveredIndex !== null && displayData[hoveredIndex] && (
          <div 
            className="absolute top-2 bg-[#1e2020] border border-[#479ef5]/50 p-2.5 rounded-lg shadow-xl font-mono text-xs z-20 pointer-events-none"
            style={{
              left: `${Math.min(85, Math.max(10, (hoveredIndex / (displayData.length - 1)) * 100))}%`,
              transform: 'translateX(-50%)'
            }}
          >
            <p className="text-[#8a919d] font-semibold mb-1">{displayData[hoveredIndex].date}</p>
            <p className="text-[#479ef5]">Changes: {displayData[hoveredIndex].changes}</p>
            <p className="text-[#ef4444]">Drift Score: {displayData[hoveredIndex].driftScore}</p>
          </div>
        )}
      </div>

      {/* Date Labels */}
      <div 
        className="mt-4 pt-2 border-t border-white/5 font-mono text-xs text-[#8a919d] flex justify-between"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {displayData.map((pt, idx) => (
          <span
            key={idx}
            className={`cursor-pointer transition-colors ${
              hoveredIndex === idx ? 'text-[#479ef5] font-semibold' : 'hover:text-[#e2e2e2]'
            }`}
            onMouseEnter={() => setHoveredIndex(idx)}
          >
            {pt.date}
          </span>
        ))}
      </div>
    </section>
  );
};
