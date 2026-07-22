import React, { useState } from 'react';
import { Search, ArrowUp, ArrowDown, Cloud, Users, FolderOpen, Database, Shield } from 'lucide-react';
import { HeatmapEntity } from './types';

const ENTITY_ICONS: Record<HeatmapEntity['icon'], React.ComponentType<{ className?: string }>> = {
  cloud: Cloud,
  groups: Users,
  folder_open: FolderOpen,
  database: Database,
  shield: Shield
};

interface PermissionsHeatmapProps {
  entities: HeatmapEntity[];
  onSelectEntity: (entity: HeatmapEntity) => void;
}

export const PermissionsHeatmap: React.FC<PermissionsHeatmapProps> = ({
  entities,
  onSelectEntity
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof HeatmapEntity>('broadInternal');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const filteredEntities = entities
    .filter(
      (e) =>
        e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.type.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDirection === 'desc' ? valB - valA : valA - valB;
      }
      return sortDirection === 'desc'
        ? String(valB).localeCompare(String(valA))
        : String(valA).localeCompare(String(valB));
    });

  const handleSort = (field: keyof HeatmapEntity) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Helper function to color cells dynamically based on numeric severity
  const getHeatCellClass = (value: number) => {
    if (value === 0) {
      return 'bg-[#0c0f0f] border-[#2b2b2b] text-[#c0c7d3]';
    }
    if (value <= 5) {
      return 'bg-red-500/10 border-red-500/20 text-red-300';
    }
    if (value <= 25) {
      return 'bg-red-500/25 border-red-500/35 text-red-200';
    }
    if (value <= 70) {
      return 'bg-red-500/50 border-red-500/60 text-white font-medium';
    }
    if (value <= 150) {
      return 'bg-red-600/80 border-red-500 text-white font-semibold';
    }
    return 'bg-red-600 border-red-400 text-white font-bold shadow-[0_0_12px_rgba(239,68,68,0.5)]';
  };

  return (
    <section className="bg-card border border-border rounded-xl p-6 overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#f0f0f0]">
            Permissions Hygiene & Data Exposure
          </h2>
          <p className="font-body text-xs text-[#c0c7d3] mt-1">
            Analysis of over-privileged access and external sharing across core storage entities.
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 text-[#c0c7d3] w-4 h-4 pointer-events-none" />
            <input
              type="text"
              placeholder="Search site / drive..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#1a1a1a] border border-[#2b2b2b] rounded-md text-xs text-white placeholder-[#8a919d] focus:outline-none focus:border-[#479ef5] transition-all w-48 sm:w-56"
            />
          </div>

          {/* Severity Legend */}
          <div className="flex items-center gap-3 bg-[#1a1a1a]/60 px-3 py-1.5 rounded-md border border-[#2b2b2b]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-[#1a1a1a] border border-[#404752] rounded-xs" />
              <span className="font-mono text-[10px] text-[#c0c7d3]">Low</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-red-500/40 border border-red-500/50 rounded-xs" />
              <span className="font-mono text-[10px] text-[#c0c7d3]">Medium</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-red-600 rounded-xs" />
              <span className="font-mono text-[10px] text-[#c0c7d3]">High</span>
            </div>
          </div>
        </div>
      </div>

      {/* Table Matrix */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#2b2b2b]">
              <th
                onClick={() => handleSort('name')}
                className="py-3 px-2 font-mono text-xs text-[#c0c7d3] uppercase font-medium cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center gap-1">
                  Entity (Sites/Drives)
                  {sortField === 'name' && (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('anonymousLinks')}
                className="py-3 px-2 font-mono text-xs text-[#c0c7d3] uppercase font-medium text-center cursor-pointer hover:text-white transition-colors"
              >
                Anonymous Links
              </th>
              <th
                onClick={() => handleSort('externalUsers')}
                className="py-3 px-2 font-mono text-xs text-[#c0c7d3] uppercase font-medium text-center cursor-pointer hover:text-white transition-colors"
              >
                External Users
              </th>
              <th
                onClick={() => handleSort('broadInternal')}
                className="py-3 px-2 font-mono text-xs text-[#c0c7d3] uppercase font-medium text-center cursor-pointer hover:text-white transition-colors"
              >
                Broad Internal
              </th>
              <th
                onClick={() => handleSort('highPermissionApps')}
                className="py-3 px-2 font-mono text-xs text-[#c0c7d3] uppercase font-medium text-center cursor-pointer hover:text-white transition-colors"
              >
                High-Permission Apps
              </th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {filteredEntities.map((entity) => {
              const EntityIcon = ENTITY_ICONS[entity.icon];
              return (
              <tr
                key={entity.id}
                onClick={() => onSelectEntity(entity)}
                className="border-b border-[#2b2b2b]/40 hover:bg-white/5 transition-colors cursor-pointer group"
              >
                <td className="py-3 px-2 flex items-center gap-2 font-mono text-xs text-white">
                  <EntityIcon className="text-[#479ef5] w-4 h-4 group-hover:scale-110 transition-transform" />
                  <div>
                    <span className="font-semibold text-[#f0f0f0] group-hover:text-[#479ef5] transition-colors">
                      {entity.name}
                    </span>
                    <span className="block text-[10px] text-[#8a919d] font-body">
                      {entity.type}
                    </span>
                  </div>
                </td>

                <td className="p-1">
                  <div
                    className={`heat-cell h-8 rounded-sm border flex items-center justify-center ${getHeatCellClass(
                      entity.anonymousLinks
                    )}`}
                  >
                    {entity.anonymousLinks}
                  </div>
                </td>

                <td className="p-1">
                  <div
                    className={`heat-cell h-8 rounded-sm border flex items-center justify-center ${getHeatCellClass(
                      entity.externalUsers
                    )}`}
                  >
                    {entity.externalUsers}
                  </div>
                </td>

                <td className="p-1">
                  <div
                    className={`heat-cell h-8 rounded-sm border flex items-center justify-center ${getHeatCellClass(
                      entity.broadInternal
                    )}`}
                  >
                    {entity.broadInternal}
                  </div>
                </td>

                <td className="p-1">
                  <div
                    className={`heat-cell h-8 rounded-sm border flex items-center justify-center ${getHeatCellClass(
                      entity.highPermissionApps
                    )}`}
                  >
                    {entity.highPermissionApps}
                  </div>
                </td>
              </tr>
              );
            })}
            {filteredEntities.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[#8a919d] font-body">
                  No storage entities found matching "{searchTerm}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
