import React, { useState } from 'react';
import {
  LineChart,
  LayoutGrid,
  DollarSign,
  Maximize2,
  HelpCircle,
  TrendingUp,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { PillarData, RiskHeatmapCell, CostBreakdownItem } from './types';

interface IntelligenceCoreProps {
  pillars: PillarData[];
  heatmapGrid: RiskHeatmapCell[];
  costItems: CostBreakdownItem[];
  onSelectPillar: (pillarId: string) => void;
  onSelectRiskCell: (cell: RiskHeatmapCell) => void;
}

export const IntelligenceCore: React.FC<IntelligenceCoreProps> = ({
  pillars,
  heatmapGrid,
  costItems,
  onSelectPillar,
  onSelectRiskCell,
}) => {
  const [activeCell, setActiveCell] = useState<RiskHeatmapCell | null>(null);
  const [radarCompare, setRadarCompare] = useState<boolean>(true);
  const [costMultiplier, setCostMultiplier] = useState<number>(1);

  // Radar points polygon calculations (5-point polygon for SEC, GOV, COMP, ADOP, ARCH)
  // Center is (50, 50), max radius = 40
  const angleStep = (2 * Math.PI) / 5;

  const pointsPrimary = pillars.slice(0, 5).map((p, i) => {
    const r = (p.score / 100) * 38;
    const angle = i * angleStep - Math.PI / 2;
    const x = 50 + r * Math.cos(angle);
    const y = 50 + r * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const pointsTarget = pillars.slice(0, 5).map((p, i) => {
    const r = (p.targetScore / 100) * 38;
    const angle = i * angleStep - Math.PI / 2;
    const x = 50 + r * Math.cos(angle);
    const y = 50 + r * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const totalCostOptimization = costItems.reduce((acc, item) => acc + item.amount, 0) * costMultiplier;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      {/* 1. Spider Chart Simulation: Pillar Synergy */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col justify-between relative group">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-mono text-xs font-semibold text-[#e2e2e2] tracking-wider uppercase flex items-center space-x-1.5">
              <span>PILLAR SYNERGY</span>
            </h3>
            <p className="text-[10px] text-[#8a919d]">Cross-domain coverage alignment</p>
          </div>
          <button
            onClick={() => setRadarCompare(!radarCompare)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
              radarCompare
                ? 'bg-[#479ef5]/20 text-[#a0c9ff] border-[#479ef5]/40'
                : 'bg-[#1a1c1c] text-[#8a919d] border-[#404752]'
            }`}
            title="Toggle Target Comparison Overlay"
          >
            {radarCompare ? 'Target ON' : 'Target OFF'}
          </button>
        </div>

        {/* Radar Graphic */}
        <div className="flex-grow relative flex items-center justify-center my-1">
          <svg className="w-full h-full max-w-[210px] max-h-[210px]" viewBox="0 0 100 100">
            {/* Grid Rings */}
            <polygon points="50,10 88,38 73,83 27,83 12,38" fill="none" stroke="#404752" strokeWidth="0.5" strokeDasharray="1 1" />
            <polygon points="50,22 77,42 66,74 34,74 23,42" fill="none" stroke="#404752" strokeWidth="0.5" />
            <polygon points="50,35 65,46 59,65 41,65 35,46" fill="none" stroke="#404752" strokeWidth="0.5" />

            {/* Target Polygon (Dotted Violet) */}
            {radarCompare && (
              <polygon
                points={pointsTarget}
                fill="rgba(218, 185, 255, 0.12)"
                stroke="#dab9ff"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            )}

            {/* Current Polygon (Primary Blue) */}
            <polygon
              points={pointsPrimary}
              fill="rgba(71, 158, 245, 0.25)"
              stroke="#479ef5"
              strokeWidth="1.8"
              className="transition-all duration-500"
            />

            {/* Radar Vertices Dots */}
            {pillars.slice(0, 5).map((p, i) => {
              const r = (p.score / 100) * 38;
              const angle = i * angleStep - Math.PI / 2;
              const x = 50 + r * Math.cos(angle);
              const y = 50 + r * Math.sin(angle);
              return (
                <circle
                  key={p.id}
                  cx={x}
                  cy={y}
                  r="2.5"
                  fill="#a0c9ff"
                  className="cursor-pointer hover:r-4 transition-all"
                  onClick={() => onSelectPillar(p.id)}
                >
                  <title>{`${p.name}: ${p.score}`}</title>
                </circle>
              );
            })}
          </svg>

          {/* Radar Labels overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full h-full relative font-mono text-[9px] text-[#c0c7d3]">
              <span className="absolute top-1 left-1/2 -translate-x-1/2 font-bold text-[#a0c9ff]">SEC</span>
              <span className="absolute top-1/4 right-1">GOV</span>
              <span className="absolute bottom-2 right-6">COMP</span>
              <span className="absolute bottom-2 left-6">ADOP</span>
              <span className="absolute top-1/4 left-1">ARCH</span>
            </div>
          </div>
        </div>

        {/* Footer legend */}
        <div className="flex justify-between items-center text-[10px] font-mono text-[#8a919d] pt-2 border-t border-[#404752]/40">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-0.5 bg-[#479ef5]" />
            <span>Current Telemetry</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-0.5 bg-[#dab9ff]" />
            <span>Target Benchmark</span>
          </span>
        </div>
      </div>

      {/* 2. Risk Heat Map */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col justify-between relative">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-mono text-xs font-semibold text-[#e2e2e2] tracking-wider uppercase">
              RISK HEAT MAP
            </h3>
            <p className="text-[10px] text-[#8a919d]">18-Cell anomaly telemetry grid</p>
          </div>
          <LayoutGrid className="w-4 h-4 text-[#8a919d]" />
        </div>

        {/* Heat Map Grid */}
        <div className="grid grid-cols-6 grid-rows-3 gap-1.5 flex-grow my-1">
          {heatmapGrid.map((cell) => (
            <button
              key={cell.id}
              onClick={() => {
                setActiveCell(cell);
                onSelectRiskCell(cell);
              }}
              onMouseEnter={() => setActiveCell(cell)}
              className={`rounded-sm transition-all duration-200 relative group border ${
                cell.severityColor
              } opacity-80 hover:opacity-100 hover:scale-105 hover:z-10 focus:outline-none ${
                activeCell?.id === cell.id ? 'ring-2 ring-[#a0c9ff] opacity-100 z-10' : 'border-transparent'
              }`}
              title={`${cell.rowCategory}: ${cell.label} (Score: ${cell.riskScore})`}
            />
          ))}
        </div>

        {/* Category labels bottom */}
        <div className="flex justify-between text-[10px] font-mono text-[#8a919d] pt-2 border-t border-[#404752]/40">
          <span className={activeCell?.rowCategory === 'IDENTITY' ? 'text-[#a0c9ff] font-bold' : ''}>
            IDENTITY
          </span>
          <span className={activeCell?.rowCategory === 'POLICIES' ? 'text-[#a0c9ff] font-bold' : ''}>
            POLICIES
          </span>
          <span className={activeCell?.rowCategory === 'DRIFT' ? 'text-[#a0c9ff] font-bold' : ''}>
            DRIFT
          </span>
        </div>

        {/* Hover Popover preview */}
        {activeCell && (
          <div className="mt-2 p-2 bg-[#1a1c1c] rounded border border-[#404752] text-[11px] flex items-center justify-between animate-fadeIn">
            <div>
              <span className="font-bold text-[#e2e2e2]">{activeCell.label}</span>
              <span className="text-[#8a919d] ml-2">({activeCell.affectedCount} items)</span>
            </div>
            <div className="font-mono font-bold text-[#ffb4ab]">
              Score: {activeCell.riskScore}
            </div>
          </div>
        )}
      </div>

      {/* 3. Cost Efficiency */}
      <div className="bg-card border border-border p-5 rounded-xl h-80 flex flex-col justify-between">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-mono text-xs font-semibold text-[#e2e2e2] tracking-wider uppercase">
              COST EFFICIENCY
            </h3>
            <p className="text-[10px] text-[#8a919d]">Licensing waste & ROI forecast</p>
          </div>
          <button
            onClick={() => setCostMultiplier(costMultiplier === 1 ? 1.25 : 1)}
            className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1a1c1c] border border-[#404752] text-[#a0c9ff] hover:bg-[#282a2b]"
            title="Simulate 25% Growth Scenario"
          >
            {costMultiplier === 1 ? '1x Scale' : '1.25x Scale'}
          </button>
        </div>

        {/* Bars List */}
        <div className="space-y-3 my-1">
          {costItems.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between text-xs font-mono text-[#c0c7d3]">
                <span>{item.label}</span>
                <span className="font-semibold" style={{ color: item.color }}>
                  ${(item.amount * costMultiplier).toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-[#1e2020] h-2 rounded-full overflow-hidden border border-[#404752]/30">
                <div
                  className="h-full transition-all duration-700 rounded-full"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Projected Optimization Footer */}
        <div className="pt-3 border-t border-[#404752]/40 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono text-[#8a919d] uppercase">
              Total Projected Optimization
            </p>
            <p className="text-xl font-headline font-bold text-[#a0c9ff]">
              ${totalCostOptimization.toLocaleString()} <span className="text-xs font-normal text-[#8a919d]">/yr</span>
            </p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-[#a0c9ff]/10 border border-[#a0c9ff]/30 flex items-center justify-center text-[#a0c9ff]">
            <Zap className="w-4 h-4" />
          </div>
        </div>
      </div>
    </section>
  );
};
