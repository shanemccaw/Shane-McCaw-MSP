import React, { useState } from 'react';
import {
  MessageSquare,
  Share2,
  Rocket,
  Shield,
  TrendingDown,
  CheckCircle,
} from 'lucide-react';
import { SecurityTrendPoint, AdoptionMetricItem } from './types';

interface TrendsRowProps {
  securityTrends: SecurityTrendPoint[];
  adoptionMetrics: AdoptionMetricItem[];
}

export const TrendsRow: React.FC<TrendsRowProps> = ({
  securityTrends,
  adoptionMetrics,
}) => {
  const [activeTrendMetric, setActiveTrendMetric] = useState<'alerts' | 'riskyUsers' | 'privSignIns'>('alerts');

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      {/* 1. Security Trend */}
      <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-[#e2e2e2] uppercase">
            SECURITY TRENDS
          </h4>
          <span className="text-xs font-mono text-[#a0c9ff] font-medium flex items-center">
            <TrendingDown className="w-3.5 h-3.5 mr-1" />
            Alerts Down 22%
          </span>
        </div>

        {/* Interactive Bar Chart */}
        <div className="h-32 flex items-end space-x-1.5 pb-2 border-b border-[#404752]/40">
          {securityTrends.map((point, idx) => {
            const val = point[activeTrendMetric];
            const maxVal = 100;
            const heightPercent = (val / maxVal) * 100;

            return (
              <div
                key={idx}
                className="flex-1 flex flex-col items-center group cursor-pointer"
                title={`${point.label}: ${val} ${activeTrendMetric}`}
              >
                <div
                  className="w-full bg-[#479ef5]/30 rounded-t group-hover:bg-[#479ef5] transition-all duration-300"
                  style={{
                    height: `${heightPercent}%`,
                    backgroundColor:
                      activeTrendMetric === 'alerts'
                        ? '#a0c9ff'
                        : activeTrendMetric === 'riskyUsers'
                        ? '#dab9ff'
                        : '#c8c6c5',
                  }}
                />
                <span className="text-[9px] font-mono text-[#8a919d] mt-1 group-hover:text-[#e2e2e2]">
                  {point.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Interactive Legend selector */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-[10px] font-mono text-[#8a919d]">
          <button
            onClick={() => setActiveTrendMetric('alerts')}
            className={`flex items-center justify-center space-x-1 py-1 rounded border transition-colors ${
              activeTrendMetric === 'alerts'
                ? 'bg-[#a0c9ff]/20 border-[#a0c9ff] text-[#a0c9ff] font-bold'
                : 'border-transparent hover:text-[#c0c7d3]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#a0c9ff]" />
            <span>Alerts</span>
          </button>

          <button
            onClick={() => setActiveTrendMetric('riskyUsers')}
            className={`flex items-center justify-center space-x-1 py-1 rounded border transition-colors ${
              activeTrendMetric === 'riskyUsers'
                ? 'bg-[#dab9ff]/20 border-[#dab9ff] text-[#dab9ff] font-bold'
                : 'border-transparent hover:text-[#c0c7d3]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#dab9ff]" />
            <span>Risky Users</span>
          </button>

          <button
            onClick={() => setActiveTrendMetric('privSignIns')}
            className={`flex items-center justify-center space-x-1 py-1 rounded border transition-colors ${
              activeTrendMetric === 'privSignIns'
                ? 'bg-[#c8c6c5]/20 border-[#c8c6c5] text-[#c8c6c5] font-bold'
                : 'border-transparent hover:text-[#c0c7d3]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#c8c6c5]" />
            <span>Priv. Sign-ins</span>
          </button>
        </div>
      </div>

      {/* 2. Compliance Drift */}
      <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-[#e2e2e2] uppercase">
            COMPLIANCE DRIFT
          </h4>
          <span className="text-xs font-mono text-[#dab9ff] font-medium">
            Labels +14%
          </span>
        </div>

        <div className="h-32 flex items-center justify-center space-x-6">
          {/* Ring Gauge */}
          <div className="relative w-24 h-24 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="transparent"
                stroke="#333535"
                strokeWidth="8"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="transparent"
                stroke="#dab9ff"
                strokeWidth="8"
                strokeDasharray={2 * Math.PI * 40}
                strokeDashoffset={2 * Math.PI * 40 * (1 - 0.75)}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono font-bold text-lg text-[#e2e2e2]">
              75%
            </div>
          </div>

          {/* Side Legend */}
          <div className="space-y-2 text-xs font-mono text-[#c0c7d3]">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-[#dab9ff]" />
              <span>Labeled Content</span>
            </div>
            <div className="flex items-center space-x-2 text-[#8a919d]">
              <span className="w-2 h-2 rounded-full bg-[#ffb4ab]" />
              <span>DLP Overrides (Low)</span>
            </div>
            <div className="flex items-center space-x-2 text-[#8a919d]">
              <span className="w-2 h-2 rounded-full bg-[#479ef5]" />
              <span>Policy Drift (Med)</span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-[#404752]/40 text-[10px] font-mono text-[#8a919d] flex justify-between">
          <span>Target Alignment: High</span>
          <span className="text-[#dab9ff]">24h Audit Sync</span>
        </div>
      </div>

      {/* 3. Adoption Metrics */}
      <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-mono text-xs font-semibold text-[#e2e2e2] uppercase">
            ADOPTION METRICS
          </h4>
          <span className="text-xs font-mono text-[#479ef5] font-medium">
            Engagement High
          </span>
        </div>

        <div className="space-y-4 my-auto">
          {adoptionMetrics.map((m) => {
            let IconComponent = MessageSquare;
            if (m.icon === 'Share2') IconComponent = Share2;
            if (m.icon === 'Rocket') IconComponent = Rocket;

            return (
              <div key={m.id} className="flex items-center space-x-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${m.color}20`, color: m.color }}
                >
                  <IconComponent className="w-3.5 h-3.5" />
                </div>

                <div className="flex-grow space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#c0c7d3]">{m.name}</span>
                    <span className="font-bold" style={{ color: m.color }}>
                      {m.percentage}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#1e2020] rounded-full overflow-hidden border border-[#404752]/30">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${m.percentage}%`,
                        backgroundColor: m.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 border-t border-[#404752]/40 text-[10px] font-mono text-[#8a919d] flex justify-between">
          <span>Active Users: 1,420</span>
          <span className="text-[#a0c9ff]">+18% MoM</span>
        </div>
      </div>
    </section>
  );
};
