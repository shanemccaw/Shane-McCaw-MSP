import React from 'react';
import { TenantHealthData } from './types';
import { Activity, Shield, Sparkles, CheckCircle2 } from 'lucide-react';

interface TenantHealthCardProps {
  data: TenantHealthData;
  onClick?: () => void;
}

export const TenantHealthCard: React.FC<TenantHealthCardProps> = ({ data, onClick }) => {
  const { unifiedScore, metrics } = data;

  // Center & radius for 4-axis SVG radar chart
  const cx = 130;
  const cy = 110;
  const radius = 70;

  // 4 axes angles: Top (Security), Right (Governance), Bottom (Compliance), Left (Copilot Readiness)
  const angles = [-90, 0, 90, 180]; // degrees

  const getCoordinates = (index: number, valPercent: number) => {
    const angleRad = (angles[index] * Math.PI) / 180;
    const r = (radius * valPercent) / 100;
    const x = cx + r * Math.cos(angleRad);
    const y = cy + r * Math.sin(angleRad);
    return { x, y };
  };

  // Generate grid concentric diamond polygons (at 25%, 50%, 75%, 100%)
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPolygons = gridLevels.map((level) => {
    return angles
      .map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = cx + radius * level * Math.cos(rad);
        const y = cy + radius * level * Math.sin(rad);
        return `${x},${y}`;
      })
      .join(' ');
  });

  // Generate data polygon points
  const dataPoints = metrics.map((m, idx) => getCoordinates(idx, m.score));
  const dataPolygonString = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // Strength colors for the 4 pillars: Security, Governance, Compliance, Copilot Readiness
  const pillarColors = ['#34d399', '#fbbf24', '#60a5fa', '#c084fc'];

  // Label offsets
  const labelPositions = [
    { x: cx, y: cy - radius - 14, textAnchor: 'middle', label: metrics[0]?.subject || 'Security', val: metrics[0]?.score, color: pillarColors[0] },
    { x: cx + radius + 12, y: cy + 4, textAnchor: 'start', label: metrics[1]?.subject || 'Governance', val: metrics[1]?.score, color: pillarColors[1] },
    { x: cx, y: cy + radius + 18, textAnchor: 'middle', label: metrics[2]?.subject || 'Compliance', val: metrics[2]?.score, color: pillarColors[2] },
    { x: cx - radius - 12, y: cy + 4, textAnchor: 'end', label: metrics[3]?.subject || 'Copilot Readiness', val: metrics[3]?.score, color: pillarColors[3] },
  ];

  return (
    <div
      onClick={onClick}
      className="bg-[#242424] rounded-xl card-border p-4 flex flex-col relative overflow-hidden hover:border-[#479ef5]/40 transition-all cursor-pointer shadow-md group"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <div>
          <span className="text-[11px] font-semibold text-[#8a919d] uppercase tracking-wider block">
            Tenant Health Radar
          </span>
          <div className="text-xs text-[#c0c7d3] mt-0.5">
            Unified Security & Governance Score
          </div>
        </div>

        {/* Unified Score Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#479ef5]/15 border border-[#479ef5]/30">
          <Activity className="w-3.5 h-3.5 text-[#479ef5]" />
          <span className="text-xs font-bold text-[#e0e2ea] font-mono">
            {unifiedScore}%
          </span>
        </div>
      </div>

      {/* SVG Spider / Radar Chart */}
      <div className="flex items-center justify-center relative py-1 my-1">
        <svg width="260" height="230" className="overflow-visible">
          <defs>
            <linearGradient id="radarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
              <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.25" />
              <stop offset="70%" stopColor="#34d399" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.35" />
            </linearGradient>
            <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Grid Concentric Diamonds */}
          {gridPolygons.map((polyStr, i) => (
            <polygon
              key={i}
              points={polyStr}
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="1"
              strokeDasharray={i === 3 ? 'none' : '2 2'}
            />
          ))}

          {/* Axis lines */}
          {angles.map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const x2 = cx + radius * Math.cos(rad);
            const y2 = cy + radius * Math.sin(rad);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="1"
              />
            );
          })}

          {/* Filled Data Radar Polygon */}
          <polygon
            points={dataPolygonString}
            fill="url(#radarGradient)"
            stroke="#479ef5"
            strokeWidth="2"
            filter="url(#radarGlow)"
            className="transition-all duration-700 ease-out group-hover:stroke-[#34d399]"
          />

          {/* Data Points / Vertices */}
          {dataPoints.map((pt, i) => (
            <g key={i}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r="4"
                fill={pillarColors[i]}
                stroke="#101419"
                strokeWidth="2"
                className="group-hover:scale-125 transition-transform origin-center"
              />
            </g>
          ))}

          {/* Axis Labels */}
          {labelPositions.map((lbl, i) => (
            <text
              key={i}
              x={lbl.x}
              y={lbl.y}
              textAnchor={lbl.textAnchor as any}
              fill="#c0c7d3"
              fontSize="10"
              fontWeight="600"
              className="font-sans"
            >
              {lbl.label} <tspan fill={lbl.color} fontWeight="700">({lbl.val}%)</tspan>
            </text>
          ))}

          {/* Center Dot */}
          <circle cx={cx} cy={cy} r="3" fill="#8a919d" />
        </svg>
      </div>

      {/* Footer Details summary */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-[#8a919d]">
        <span>4 Core Telemetry Pillars</span>
        <span className="text-[#34d399] font-medium flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-[#34d399]" /> Optimal Baseline
        </span>
      </div>
    </div>
  );
};
