import React, { useState } from 'react';
import {
  Activity,
  Download,
  RefreshCw,
  Search,
  Sliders,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Building2,
} from 'lucide-react';
import { TimeFrame } from '../types';

interface HeaderProps {
  timeFrame: TimeFrame;
  setTimeFrame: (tf: TimeFrame) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated: string;
  onExport: () => void;
  liveSync: boolean;
  setLiveSync: (val: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  timeFrame,
  setTimeFrame,
  searchQuery,
  setSearchQuery,
  onRefresh,
  isRefreshing,
  lastUpdated,
  onExport,
  liveSync,
  setLiveSync,
}) => {
  const [showTenantMenu, setShowTenantMenu] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('Contoso Global Tenant (us-east-1)');

  const tenants = [
    'Contoso Global Tenant (us-east-1)',
    'Fabrikam Enterprise (eu-west-1)',
    'Northwind Health (us-west-2)',
  ];

  return (
    <header className="glass-card rounded-xl p-4 md:p-6 mb-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Brand & Tenant Context */}
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-lg bg-[#479ef5]/10 border border-[#479ef5]/30 flex items-center justify-center text-[#a0c9ff] shadow-[0_0_15px_rgba(71,158,245,0.2)]">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl md:text-2xl font-bold font-headline tracking-tight text-[#e2e2e2]">
                OBSIDIAN METRIC
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#333535] text-[#a0c9ff] font-semibold border border-[#404752]">
                v4.2.1
              </span>
            </div>
            
            <div className="relative mt-1">
              <button
                onClick={() => setShowTenantMenu(!showTenantMenu)}
                className="flex items-center space-x-1.5 text-xs text-[#c0c7d3] hover:text-[#a0c9ff] transition-colors focus:outline-none"
              >
                <Building2 className="w-3.5 h-3.5 text-[#479ef5]" />
                <span className="font-medium">{selectedTenant}</span>
                <span className="text-[10px] text-[#8a919d]">▼</span>
              </button>

              {showTenantMenu && (
                <div className="absolute left-0 mt-2 w-64 glass-card rounded-lg border border-[#404752] py-2 z-50 shadow-2xl bg-[#1e2020]">
                  <div className="px-3 py-1 text-[10px] font-mono text-[#8a919d] uppercase">Switch Tenant Context</div>
                  {tenants.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setSelectedTenant(t);
                        setShowTenantMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#282a2b] transition-colors flex items-center justify-between ${
                        selectedTenant === t ? 'text-[#a0c9ff] font-semibold bg-[#282a2b]' : 'text-[#c0c7d3]'
                      }`}
                    >
                      <span>{t}</span>
                      {selectedTenant === t && <CheckCircle2 className="w-3.5 h-3.5 text-[#479ef5]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Global Controls & Search */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-64 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search metrics, signals, rules..."
              className="w-full bg-[#1a1c1c] border border-[#404752] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#e2e2e2] placeholder-[#8a919d] focus:outline-none focus:border-[#479ef5] focus:ring-1 focus:ring-[#479ef5] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#8a919d] hover:text-[#e2e2e2]"
              >
                ✕
              </button>
            )}
          </div>

          {/* Timeframe pill selector */}
          <div className="flex bg-[#1a1c1c] p-1 rounded-lg border border-[#404752]">
            {(['24h', '7d', '30d', 'YTD'] as TimeFrame[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeFrame(tf)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-all ${
                  timeFrame === tf
                    ? 'bg-[#479ef5] text-[#00345c] font-bold shadow-sm'
                    : 'text-[#c0c7d3] hover:text-[#e2e2e2]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Refresh & Live Sync button */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setLiveSync(!liveSync)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-all ${
                liveSync
                  ? 'bg-[#00345c]/50 text-[#a0c9ff] border-[#479ef5]'
                  : 'bg-[#1a1c1c] text-[#8a919d] border-[#404752]'
              }`}
              title="Toggle Live Sync Mode"
            >
              <span className={`w-2 h-2 rounded-full ${liveSync ? 'bg-[#a0c9ff] animate-ping' : 'bg-[#8a919d]'}`} />
              <span>LIVE</span>
            </button>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 bg-[#1a1c1c] border border-[#404752] rounded-lg text-[#c0c7d3] hover:text-[#a0c9ff] hover:border-[#479ef5] transition-all disabled:opacity-50"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#479ef5]' : ''}`} />
            </button>

            <button
              onClick={onExport}
              className="flex items-center space-x-1 px-3 py-1.5 bg-[#1e2020] border border-[#404752] rounded-lg text-xs font-mono text-[#c0c7d3] hover:text-[#a0c9ff] hover:border-[#479ef5] transition-all"
              title="Export Report Summary"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sync timestamp bar */}
      <div className="mt-3 pt-2 border-t border-[#404752]/40 flex items-center justify-between text-[11px] font-mono text-[#8a919d]">
        <div className="flex items-center space-x-2">
          <Clock className="w-3 h-3 text-[#479ef5]" />
          <span>Last sync: {lastUpdated}</span>
          <span className="text-[#404752]">|</span>
          <span className="text-[#a0c9ff]">Region: US-West-2</span>
        </div>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1 text-[#a0c9ff]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a0c9ff]" />
            <span>Telemetry Pipeline Active</span>
          </span>
        </div>
      </div>
    </header>
  );
};
