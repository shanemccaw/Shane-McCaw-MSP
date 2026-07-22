import React, { useState } from 'react';
import { TrendDataPoint } from './types';

interface SensitivityTrendCardProps {
  trendData: TrendDataPoint[];
}

export const SensitivityTrendCard: React.FC<SensitivityTrendCardProps> = ({ trendData }) => {
  const [activePoint, setActivePoint] = useState<TrendDataPoint | null>(null);

  return (
    <div className="card-obsidian p-6 overflow-hidden relative flex flex-col justify-between">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          High-Sensitivity Content Trend
        </h3>
        {activePoint && (
          <span className="font-['JetBrains_Mono'] text-[10px] text-[#479ef5] bg-[#479ef5]/10 px-2 py-0.5 rounded border border-[#479ef5]/30">
            {activePoint.month}: {(activePoint.itemCount / 1000).toFixed(0)}k items ({activePoint.highRiskPercentage}% Risk)
          </span>
        )}
      </div>

      {/* Curve graph canvas container */}
      <div className="h-48 relative w-full">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 400 150">
          <defs>
            <linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#479ef5" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#479ef5" stopOpacity="0" />
            </linearGradient>

            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Area fill */}
          <path
            d="M0,120 Q50,110 100,80 T200,60 T300,90 T400,20 V150 H0 Z"
            fill="url(#trend-gradient)"
            opacity="0.25"
          />

          {/* Glowing curve stroke matching exact path in prompt SVG */}
          <path
            d="M0,120 Q50,110 100,80 T200,60 T300,90 T400,20"
            fill="none"
            stroke="#479ef5"
            strokeWidth="3"
            style={{ filter: 'drop-shadow(0px 0px 8px rgba(71, 158, 245, 0.7))' }}
          />

          {/* Data Points */}
          {[
            { x: 0, y: 120, point: trendData[0] },
            { x: 80, y: 90, point: trendData[1] },
            { x: 160, y: 65, point: trendData[2] },
            { x: 240, y: 60, point: trendData[3] },
            { x: 320, y: 90, point: trendData[4] },
            { x: 400, y: 20, point: trendData[5] }
          ].map((item, idx) => (
            <g key={idx} className="cursor-pointer">
              <circle
                cx={item.x}
                cy={item.y}
                r={activePoint?.month === item.point.month ? "6" : "4"}
                fill={activePoint?.month === item.point.month ? "#a0c9ff" : "#479ef5"}
                stroke="#121414"
                strokeWidth="2"
                onMouseEnter={() => setActivePoint(item.point)}
                onMouseLeave={() => setActivePoint(null)}
                className="transition-all"
              />
            </g>
          ))}
        </svg>

        {/* X-Axis labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1 text-[10px] leading-[14px] text-[#c0c7d3] font-['JetBrains_Mono'] font-medium">
          {trendData.map((dp) => (
            <span
              key={dp.month}
              onMouseEnter={() => setActivePoint(dp)}
              onMouseLeave={() => setActivePoint(null)}
              className={`cursor-pointer transition-colors ${
                activePoint?.month === dp.month ? 'text-[#a0c9ff] font-bold' : 'hover:text-[#e2e2e2]'
              }`}
            >
              {dp.month}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
