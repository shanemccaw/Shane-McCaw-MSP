import React from 'react';
import { TimeFrame, Department } from './types';
import { 
  Building2, 
  RotateCcw, 
  Download, 
  Calendar, 
  SlidersHorizontal,
  Sparkles,
  Search
} from 'lucide-react';

interface HeaderProps {
  timeframe: TimeFrame;
  setTimeframe: (tf: TimeFrame) => void;
  selectedDepartment: Department;
  setSelectedDepartment: (dept: Department) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onRefreshData: () => void;
  onExportReport: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  timeframe,
  setTimeframe,
  selectedDepartment,
  setSelectedDepartment,
  searchQuery,
  setSearchQuery,
  onRefreshData,
  onExportReport,
  isRefreshing
}) => {
  return (
    <header className="rounded-xl p-4 lg:p-5 mb-6 border border-white/10 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
      {/* Title & Branding */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#479ef5]/15 border border-[#479ef5]/30 flex items-center justify-center text-[#479ef5]">
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl lg:text-2xl font-bold font-headline tracking-tight text-white">
              Adoption Intelligence Overview
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono-data uppercase tracking-wider bg-[#479ef5]/20 text-[#479ef5] rounded border border-[#479ef5]/30 font-medium">
              Live Tenant
            </span>
          </div>
          <p className="text-xs text-[#8a919d] font-body mt-0.5">
            Enterprise Microsoft 365, Teams, SharePoint & Copilot Adoption Analytics
          </p>
        </div>
      </div>

      {/* Controls & Search */}
      <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-between xl:justify-end">
        {/* Search input */}
        <div className="relative min-w-[200px] flex-1 sm:flex-initial">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search department or metrics..."
            className="w-full bg-[#1a1c1c] text-xs text-white placeholder-[#8a919d] pl-9 pr-3 py-2 rounded-lg border border-white/10 focus:outline-none focus:border-[#479ef5] transition-colors font-body"
          />
        </div>

        {/* Department Filter */}
        <div className="flex items-center gap-1.5 bg-[#1a1c1c] px-3 py-1.5 rounded-lg border border-white/10 text-xs">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#8a919d]" />
          <span className="text-[#8a919d] font-mono-data text-[11px] hidden sm:inline">Dept:</span>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value as Department)}
            className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
          >
            <option value="All" className="bg-[#1e2020] text-white">All Departments</option>
            <option value="Sales" className="bg-[#1e2020] text-white">Sales</option>
            <option value="Marketing" className="bg-[#1e2020] text-white">Marketing</option>
            <option value="Engineering" className="bg-[#1e2020] text-white">Engineering</option>
            <option value="HR" className="bg-[#1e2020] text-white">HR</option>
            <option value="Finance" className="bg-[#1e2020] text-white">Finance</option>
          </select>
        </div>

        {/* Timeframe Filter */}
        <div className="flex items-center bg-[#1a1c1c] p-1 rounded-lg border border-white/10 text-xs font-mono-data">
          <Calendar className="w-3.5 h-3.5 text-[#8a919d] ml-1.5 mr-1" />
          <button
            onClick={() => setTimeframe('7d')}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              timeframe === '7d'
                ? 'bg-[#479ef5] text-[#003259] font-bold shadow-sm'
                : 'text-[#8a919d] hover:text-white'
            }`}
          >
            7D
          </button>
          <button
            onClick={() => setTimeframe('30d')}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              timeframe === '30d'
                ? 'bg-[#479ef5] text-[#003259] font-bold shadow-sm'
                : 'text-[#8a919d] hover:text-white'
            }`}
          >
            30D
          </button>
          <button
            onClick={() => setTimeframe('90d')}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              timeframe === '90d'
                ? 'bg-[#479ef5] text-[#003259] font-bold shadow-sm'
                : 'text-[#8a919d] hover:text-white'
            }`}
          >
            90D
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshData}
            title="Refresh Live Data"
            disabled={isRefreshing}
            className="flex items-center gap-1.5 bg-[#1a1c1c] hover:bg-[#282a2b] text-xs font-mono-data text-[#e2e2e2] px-3 py-2 rounded-lg border border-white/10 transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#479ef5]' : ''}`} />
            <span className="hidden md:inline">Sync</span>
          </button>

          <button
            onClick={onExportReport}
            className="flex items-center gap-1.5 bg-[#479ef5] hover:bg-[#388de4] text-[#003259] font-bold text-xs font-mono-data px-3.5 py-2 rounded-lg transition-all active:scale-95 shadow-lg shadow-[#479ef5]/10"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>
    </header>
  );
};
