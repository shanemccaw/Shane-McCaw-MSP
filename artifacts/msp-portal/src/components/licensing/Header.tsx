import React from 'react';
import { FilterState } from '../types';
import { RefreshCw, Download, ChevronDown, Check, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  filter: FilterState;
  onFilterChange: (newFilter: Partial<FilterState>) => void;
  onRefresh: () => void;
  onExport: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  filter,
  onFilterChange,
  onRefresh,
  onExport,
  isRefreshing,
}) => {
  const [showInstanceMenu, setShowInstanceMenu] = React.useState(false);
  const instances = ['ARC-INTEL-09X', 'ARC-INTEL-02B (EMEA)', 'ARC-INTEL-05A (APAC)'];

  return (
    <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-8 gap-4 border-b border-white/5 pb-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-6 h-6 text-[#479ef5]" />
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[#e2e2e2]">
            Licensing Intelligence <span className="text-[#a0c9ff]">Overview</span>
          </h1>
        </div>
        <p className="text-[#c0c7d3] font-sans text-sm sm:text-base mt-1">
          Executive Overview Pillar: Tenant Resource Optimization & Compliance
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
        {/* Time Period Selector */}
        <div className="flex items-center bg-[#1a1c1c] border border-white/10 rounded-md p-1">
          {(['30d', '90d', 'ytd', 'all'] as const).map((period) => (
            <button
              key={period}
              onClick={() => onFilterChange({ timeRange: period })}
              className={`px-2.5 py-1 text-xs font-mono-tech uppercase rounded transition-all ${
                filter.timeRange === period
                  ? 'bg-[#479ef5] text-[#003259] font-bold shadow-sm'
                  : 'text-[#c0c7d3] hover:text-white hover:bg-white/5'
              }`}
            >
              {period}
            </button>
          ))}
        </div>

        {/* Instance Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowInstanceMenu(!showInstanceMenu)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1c1c] border border-white/10 rounded-md text-xs font-mono-tech hover:border-[#479ef5]/50 transition-all text-[#e2e2e2]"
          >
            <span className="text-[#c0c7d3] hidden sm:inline">VIRTUALIZED INSTANCE:</span>
            <span className="text-[#479ef5] font-bold">{filter.instance}</span>
            <div className="h-2 w-2 rounded-full bg-[#479ef5] neon-glow ml-1"></div>
            <ChevronDown className="w-3.5 h-3.5 text-[#c0c7d3]" />
          </button>

          {showInstanceMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-[#1e2020] border border-white/10 rounded-md shadow-2xl z-50 py-1 font-mono-tech text-xs">
              <div className="px-3 py-2 text-[10px] text-[#c0c7d3] border-b border-white/5 uppercase tracking-wider">
                Select Active Tenant
              </div>
              {instances.map((inst) => (
                <button
                  key={inst}
                  onClick={() => {
                    onFilterChange({ instance: inst.split(' ')[0] });
                    setShowInstanceMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-[#e2e2e2] hover:bg-white/5 flex items-center justify-between transition-colors"
                >
                  <span>{inst}</span>
                  {filter.instance === inst.split(' ')[0] && (
                    <Check className="w-3.5 h-3.5 text-[#479ef5]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh Action */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh Data Telemetry"
          className="p-2 bg-[#1a1c1c] border border-white/10 rounded-md text-[#c0c7d3] hover:text-white hover:border-[#479ef5]/50 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#479ef5]' : ''}`} />
        </button>

        {/* Export Report Action */}
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1c1c] hover:bg-[#282a2b] border border-white/10 hover:border-[#479ef5]/50 rounded-md text-xs font-mono-tech text-[#a0c9ff] transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">EXPORT REPORT</span>
        </button>
      </div>
    </header>
  );
};
