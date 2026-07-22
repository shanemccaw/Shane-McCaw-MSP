import React, { useState } from 'react';
import { AuditRow, AuditCell } from './types';

interface AuditHeatmapCardProps {
  matrix: AuditRow[];
}

export const AuditHeatmapCard: React.FC<AuditHeatmapCardProps> = ({ matrix }) => {
  const [hoveredCell, setHoveredCell] = useState<{
    workload: string;
    cell: AuditCell;
  } | null>(null);

  const getCellBgClass = (workload: string, level: string) => {
    // Exact color mapping from screenshot html markup
    if (workload === 'Identity') {
      if (level === 'L1') return 'bg-[#479ef5]/20';
      if (level === 'L2') return 'bg-[#479ef5]/40';
      if (level === 'L3') return 'bg-[#479ef5]/60';
      if (level === 'L4') return 'bg-[#479ef5]';
      if (level === 'L5') return 'bg-[#479ef5]';
    }
    if (workload === 'Directory') {
      if (level === 'L1') return 'bg-[#479ef5]/20';
      if (level === 'L2') return 'bg-[#479ef5]/40';
      if (level === 'L3') return 'bg-[#479ef5]/60';
      if (level === 'L4') return 'bg-[#479ef5]/80';
      if (level === 'L5') return 'bg-[#479ef5]/90';
    }
    if (workload === 'SharePoint') {
      if (level === 'L1') return 'bg-[#479ef5]/10';
      if (level === 'L2') return 'bg-[#479ef5]/20';
      if (level === 'L3') return 'bg-[#ffb4ab]/40';
      if (level === 'L4') return 'bg-[#ffb4ab]/60';
      if (level === 'L5') return 'bg-[#ffb4ab]/80';
    }
    if (workload === 'Teams') {
      if (level === 'L1') return 'bg-[#479ef5]/20';
      if (level === 'L2') return 'bg-[#479ef5]/30';
      if (level === 'L3') return 'bg-[#479ef5]/40';
      if (level === 'L4') return 'bg-[#479ef5]/50';
      if (level === 'L5') return 'bg-[#479ef5]/60';
    }
    if (workload === 'Exchange') {
      return 'bg-[#479ef5]';
    }
    return 'bg-[#479ef5]/40';
  };

  return (
    <div className="bg-card border border-border p-6 relative">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          Audit Log Completeness
        </h3>
        {hoveredCell && (
          <span className="font-['JetBrains_Mono'] text-[10px] text-[#a0c9ff] bg-[#a0c9ff]/10 px-2 py-0.5 rounded border border-[#a0c9ff]/20">
            {hoveredCell.workload} {hoveredCell.cell.level}: {(hoveredCell.cell.logCount / 1000).toFixed(0)}k logs ({hoveredCell.cell.lastSync})
          </span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-2">
        {/* Column Headers */}
        <div className="col-span-1"></div>
        <div className="text-center text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">L1</div>
        <div className="text-center text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">L2</div>
        <div className="text-center text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">L3</div>
        <div className="text-center text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">L4</div>
        <div className="text-center text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3]">L5</div>

        {/* Matrix Rows */}
        {matrix.map((row) => (
          <React.Fragment key={row.workload}>
            {/* Workload Label */}
            <div className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#e2e2e2] flex items-center">
              {row.workload}
            </div>

            {/* 5 Levels Cells */}
            {row.levels.map((cell) => (
              <div
                key={cell.level}
                onMouseEnter={() => setHoveredCell({ workload: row.workload, cell })}
                onMouseLeave={() => setHoveredCell(null)}
                className={`h-8 rounded transition-all cursor-pointer hover:ring-2 hover:ring-white/50 ${getCellBgClass(
                  row.workload,
                  cell.level
                )}`}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
