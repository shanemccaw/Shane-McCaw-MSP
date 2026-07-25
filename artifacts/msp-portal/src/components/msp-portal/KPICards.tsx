// @ts-nocheck
import React from 'react';
import { TrendingUp, ArrowUp, AlertTriangle, ShieldCheck } from 'lucide-react';

interface KPICardsProps {
  totalTenants: number;
  averageSecureScore: number;
  activeCriticalAlerts: number;
  pendingRemediationsCount: number;
  onOpenPendingRemediations: () => void;
  onFilterCriticalAlerts: () => void;
}

export const KPICards: React.FC<KPICardsProps> = ({
  totalTenants,
  averageSecureScore,
  activeCriticalAlerts,
  pendingRemediationsCount,
  onOpenPendingRemediations,
  onFilterCriticalAlerts,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
      {/* 1. Total Managed Tenants */}
      <div className="bg-[#101419] border border-[#404752] p-3 rounded-md flex justify-between items-center shadow-sm hover:border-[#8a919e] transition-colors">
        <div>
          <div className="text-[11px] font-bold text-[#8a919e] uppercase tracking-wider mb-1">
            Total Managed Tenants
          </div>
          <div className="text-xl font-bold text-[#e0e2ea] tracking-tight">{totalTenants}</div>
        </div>
        <div className="flex items-center gap-1 text-[#0078d4] text-xs font-semibold bg-[#0078d4]/10 px-2 py-1 rounded">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>+3</span>
        </div>
      </div>

      {/* 2. Overall Security Score */}
      <div className="bg-[#101419] border border-[#404752] p-3 rounded-md flex justify-between items-center shadow-sm hover:border-[#8a919e] transition-colors">
        <div>
          <div className="text-[11px] font-bold text-[#8a919e] uppercase tracking-wider mb-1">
            Overall Security Score
          </div>
          <div className="text-xl font-bold text-[#e0e2ea] tracking-tight">
            {averageSecureScore.toFixed(1)}%
          </div>
        </div>
        <div className="flex items-center text-[#4ade80] text-xs font-semibold bg-[#052e16] border border-[#166534] px-2 py-1 rounded">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>Top 10%</span>
        </div>
      </div>

      {/* 3. Active Critical Alerts */}
      <div
        onClick={onFilterCriticalAlerts}
        className="bg-[#101419] border border-[#ffb4ab]/80 p-3 rounded-md bg-[#93000a]/15 flex justify-between items-center shadow-sm cursor-pointer hover:bg-[#93000a]/25 transition-colors group"
      >
        <div>
          <div className="text-[11px] font-bold text-[#ffdad6] uppercase tracking-wider mb-1 flex items-center gap-1">
            <span>Active Critical Alerts</span>
          </div>
          <div className="text-xl font-bold text-[#ffb4ab] tracking-tight flex items-baseline gap-2">
            <span>{activeCriticalAlerts}</span>
            <span className="text-[10px] text-[#ffdad6] font-normal group-hover:underline">Click to filter</span>
          </div>
        </div>
        <div className="w-8 h-8 rounded bg-[#93000a]/40 border border-[#ffb4ab]/40 flex items-center justify-center text-[#ffb4ab]">
          <AlertTriangle className="w-5 h-5 animate-pulse" />
        </div>
      </div>

      {/* 4. Pending Remediations */}
      <div className="bg-[#101419] border border-[#404752] p-3 rounded-md flex justify-between items-center shadow-sm hover:border-[#8a919e] transition-colors">
        <div>
          <div className="text-[11px] font-bold text-[#8a919e] uppercase tracking-wider mb-1">
            Pending Remediations
          </div>
          <div className="text-xl font-bold text-[#e0e2ea] tracking-tight">
            {pendingRemediationsCount}
          </div>
        </div>
        <button
          onClick={onOpenPendingRemediations}
          className="border border-[#404752] px-2.5 py-1 rounded text-xs font-semibold text-[#a3c9ff] hover:bg-[#0078d4] hover:text-white hover:border-[#0078d4] transition-all flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Review</span>
        </button>
      </div>
    </div>
  );
};

