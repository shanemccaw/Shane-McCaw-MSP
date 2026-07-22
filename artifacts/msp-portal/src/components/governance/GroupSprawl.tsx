import React, { useState } from 'react';
import { GroupStat, HeatmapCell } from '../types';
import { Users, UserMinus, AlertTriangle, Globe, Grid } from 'lucide-react';

interface GroupSprawlProps {
  stats: GroupStat[];
  cells: HeatmapCell[];
  onCellClick?: (cell: HeatmapCell) => void;
}

export const GroupSprawl: React.FC<GroupSprawlProps> = ({ stats, cells, onCellClick }) => {
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<'all' | 'ownerless' | 'external' | 'stale'>('all');
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Users':
        return <Users className="w-5 h-5 text-[#479ef5]" />;
      case 'UserMinus':
        return <UserMinus className="w-5 h-5 text-[#eab308]" />;
      case 'AlertTriangle':
        return <AlertTriangle className="w-5 h-5 text-[#ef4444]" />;
      case 'Globe':
        return <Globe className="w-5 h-5 text-[#c084fc]" />;
      default:
        return <Users className="w-5 h-5" />;
    }
  };

  const getCellColor = (cell: HeatmapCell) => {
    if (activeCategoryFilter !== 'all' && cell.category !== activeCategoryFilter) {
      return 'bg-white/5 opacity-30';
    }

    switch (cell.riskLevel) {
      case 'critical':
        return 'bg-[#ef4444]/60 border-[#ef4444]/80 shadow-[0_0_8px_rgba(239,68,68,0.3)]';
      case 'high':
        return 'bg-[#eab308]/50 border-[#eab308]/60';
      case 'medium':
        return 'bg-[#479ef5]/35 border-[#479ef5]/50';
      case 'low':
      default:
        return 'bg-[#479ef5]/15 border-white/5 hover:border-[#479ef5]/50';
    }
  };

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left Stat Cards */}
      <div className="lg:col-span-1 space-y-3">
        {stats.map((stat, idx) => (
          <div
            key={idx}
            className={`glass-card p-4 rounded-xl flex items-center gap-4 ${
              stat.borderLeft ? 'border-l-4 border-l-[#ef4444]' : ''
            }`}
          >
            <div className="p-2.5 bg-[#333535]/80 rounded-lg flex items-center justify-center">
              {getIcon(stat.icon)}
            </div>
            <div>
              <p className="font-mono text-[10px] text-[#8a919d] uppercase tracking-wider">
                {stat.label}
              </p>
              <p className="font-headline text-2xl font-bold text-[#e2e2e2]">
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Right Heatmap */}
      <div className="lg:col-span-2 glass-card p-6 rounded-xl flex flex-col justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <h3 className="font-headline text-lg font-semibold flex items-center gap-2 text-[#e2e2e2]">
            <Grid className="w-5 h-5 text-[#ef4444]" />
            Risk Concentration Heatmap
          </h3>

          {/* Category Filter Pills */}
          <div className="flex gap-1.5 font-mono text-[10px]">
            <button
              onClick={() => setActiveCategoryFilter('all')}
              className={`px-2 py-1 rounded transition-colors ${
                activeCategoryFilter === 'all'
                  ? 'bg-[#479ef5]/20 text-[#479ef5] border border-[#479ef5]/40'
                  : 'bg-white/5 text-[#8a919d] hover:text-[#e2e2e2]'
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => setActiveCategoryFilter('ownerless')}
              className={`px-2 py-1 rounded transition-colors ${
                activeCategoryFilter === 'ownerless'
                  ? 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40'
                  : 'bg-white/5 text-[#8a919d] hover:text-[#e2e2e2]'
              }`}
            >
              OWNERLESS
            </button>
            <button
              onClick={() => setActiveCategoryFilter('external')}
              className={`px-2 py-1 rounded transition-colors ${
                activeCategoryFilter === 'external'
                  ? 'bg-[#c084fc]/20 text-[#c084fc] border border-[#c084fc]/40'
                  : 'bg-white/5 text-[#8a919d] hover:text-[#e2e2e2]'
              }`}
            >
              EXTERNAL
            </button>
            <button
              onClick={() => setActiveCategoryFilter('stale')}
              className={`px-2 py-1 rounded transition-colors ${
                activeCategoryFilter === 'stale'
                  ? 'bg-[#eab308]/20 text-[#eab308] border border-[#eab308]/40'
                  : 'bg-white/5 text-[#8a919d] hover:text-[#e2e2e2]'
              }`}
            >
              STALE
            </button>
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="grid grid-cols-12 gap-1.5 h-56 sm:h-60 relative">
          {cells.map((cell) => (
            <div
              key={cell.id}
              onClick={() => onCellClick?.(cell)}
              onMouseEnter={() => setHoveredCell(cell)}
              onMouseLeave={() => setHoveredCell(null)}
              className={`rounded-xs border transition-all cursor-pointer ${getCellColor(cell)}`}
            />
          ))}
        </div>

        {/* Dynamic Cell Info or Column Markers */}
        <div className="mt-4 pt-2 border-t border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center font-mono text-[11px] text-[#8a919d]">
          {hoveredCell ? (
            <div className="flex items-center gap-3 text-xs w-full justify-between">
              <span className="text-[#479ef5] font-semibold">{hoveredCell.groupName}</span>
              <span className="text-[#e2e2e2]">Category: <span className="uppercase text-[#c084fc]">{hoveredCell.category}</span></span>
              <span className="text-[#e2e2e2]">Risk: <span className="uppercase font-semibold text-[#ef4444]">{hoveredCell.riskLevel}</span></span>
            </div>
          ) : (
            <div className="flex justify-between w-full uppercase">
              <span>Ownerless</span>
              <span>External Access</span>
              <span>Stale Records</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
