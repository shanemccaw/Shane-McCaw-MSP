import React, { useState } from 'react';
import { PrivilegedMetrics } from '../types';
import { ShieldAlert } from 'lucide-react';

interface PrivilegedExposureCardProps {
  metrics: PrivilegedMetrics;
}

export const PrivilegedExposureCard: React.FC<PrivilegedExposureCardProps> = ({ metrics }) => {
  const [hoveredAxis, setHoveredAxis] = useState<string | null>(null);

  // Radar points relative to center (100, 100), radius 80
  // Top: Total Privileged (100, 20)
  // Right: High User Risk (180, 100)
  // Bottom: No MFA Enabled (100, 180)
  // Left: Risky Sign-ins (20, 100)
  const scores = metrics.radarScores;
  const pTop = { x: 100, y: 100 - (scores.totalPrivileged / 100) * 70, label: 'Total Privileged', val: `${scores.totalPrivileged}%` };
  const pRight = { x: 100 + (scores.highUserRisk / 100) * 70, y: 100, label: 'High User Risk', val: `${scores.highUserRisk}%` };
  const pBottom = { x: 100, y: 100 + (scores.noMfaEnabled / 100) * 70, label: 'No MFA Enabled', val: `${scores.noMfaEnabled}%` };
  const pLeft = { x: 100 - (scores.riskySignIns / 100) * 70, y: 100, label: 'Risky Sign-ins', val: `${scores.riskySignIns}%` };

  const polygonPath = `${pTop.x},${pTop.y} ${pRight.x},${pRight.y} ${pBottom.x},${pBottom.y} ${pLeft.x},${pLeft.y}`;

  return (
    <div className="glass-card rounded-xl p-6 border border-white/10 shadow-xl flex flex-col justify-between">
      {/* Title Header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h2 className="font-headline text-lg font-semibold text-[#a0c9ff] mb-0.5">
            Privileged Exposure
          </h2>
          <p className="text-[#c0c7d3] text-xs">PIM/PAM active surfaces</p>
        </div>
        <span className="p-2 bg-[#479ef5]/10 rounded-lg text-[#479ef5] border border-[#479ef5]/20">
          <ShieldAlert className="w-5 h-5" />
        </span>
      </div>

      {/* Numerical Stats */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="border-l-2 border-[#a0c9ff] pl-3.5">
          <div className="text-[#c0c7d3] font-mono text-[11px] uppercase tracking-wider">
            Privileged Accounts
          </div>
          <div className="text-2xl font-headline font-semibold text-white mt-0.5">
            {metrics.totalPrivileged}
          </div>
        </div>
        <div className="border-l-2 border-[#ffb4ab] pl-3.5">
          <div className="text-[#c0c7d3] font-mono text-[11px] uppercase tracking-wider">
            Accounts with Risk
          </div>
          <div className="text-2xl font-headline font-semibold text-[#ffb4ab] mt-0.5">
            {metrics.accountsWithRisk}
          </div>
        </div>
      </div>

      {/* Spider Web / Radar Chart Visualization */}
      <div className="relative h-60 flex items-center justify-center my-2">
        {/* SVG Spider Mesh */}
        <svg viewBox="0 0 200 200" className="w-full h-full max-w-[240px] overflow-visible">
          {/* Concentric Grid Squares/Polygons */}
          <polygon points="100,20 180,100 100,180 20,100" fill="none" stroke="#404752" strokeWidth="1" strokeDasharray="2 2" className="opacity-40" />
          <polygon points="100,45 155,100 100,155 45,100" fill="none" stroke="#404752" strokeWidth="1" strokeDasharray="2 2" className="opacity-30" />
          <polygon points="100,70 130,100 100,130 70,100" fill="none" stroke="#404752" strokeWidth="1" strokeDasharray="2 2" className="opacity-20" />
          
          {/* Axis Lines */}
          <line x1="100" y1="20" x2="100" y2="180" stroke="#404752" strokeWidth="1" className="opacity-30" />
          <line x1="20" y1="100" x2="180" y2="100" stroke="#404752" strokeWidth="1" className="opacity-30" />

          {/* Active Data Area */}
          <polygon
            points={polygonPath}
            fill="rgba(71, 158, 245, 0.25)"
            stroke="#a0c9ff"
            strokeWidth="2"
            className="transition-all duration-500 hover:fill-rgba(71, 158, 245, 0.35)"
          />

          {/* Point Markers */}
          {[pTop, pRight, pBottom, pLeft].map((pt, idx) => (
            <g key={idx} onMouseEnter={() => setHoveredAxis(pt.label)} onMouseLeave={() => setHoveredAxis(null)}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={hoveredAxis === pt.label ? "5" : "3.5"}
                fill="#a0c9ff"
                stroke="#121414"
                strokeWidth="1.5"
                className="cursor-pointer transition-all duration-200"
              />
            </g>
          ))}
        </svg>

        {/* Labels Overlay around SVG */}
        <div className="absolute top-0 font-mono text-[9px] text-[#c0c7d3] uppercase tracking-wider bg-[#0c0f0f]/80 px-1.5 py-0.5 rounded border border-white/5">
          Total Privileged ({scores.totalPrivileged}%)
        </div>
        <div className="absolute right-0 font-mono text-[9px] text-[#c0c7d3] uppercase tracking-wider bg-[#0c0f0f]/80 px-1.5 py-0.5 rounded border border-white/5 text-right">
          High User Risk ({scores.highUserRisk}%)
        </div>
        <div className="absolute bottom-0 font-mono text-[9px] text-[#c0c7d3] uppercase tracking-wider bg-[#0c0f0f]/80 px-1.5 py-0.5 rounded border border-white/5">
          No MFA Enabled ({scores.noMfaEnabled}%)
        </div>
        <div className="absolute left-0 font-mono text-[9px] text-[#c0c7d3] uppercase tracking-wider bg-[#0c0f0f]/80 px-1.5 py-0.5 rounded border border-white/5">
          Risky Sign-ins ({scores.riskySignIns}%)
        </div>
      </div>
    </div>
  );
};
