import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenantview/types';

interface MultiTenantViewProps {
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
}

export const MultiTenantView: React.FC<MultiTenantViewProps> = ({ tenants, onSelectTenant }) => {
  const [filter, setFilter] = useState<'all' | 'warning' | 'excellent'>('all');
  const [search, setSearch] = useState('');

  const filteredTenants = tenants.filter(t => {
    if (filter === 'warning' && t.healthScore >= 90) return false;
    if (filter === 'excellent' && t.healthScore < 90) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.directoryId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <div className="text-xs font-mono text-[#bfc7d3] uppercase">Total Managed Tenants</div>
          <div className="text-3xl font-mono font-bold text-[#99cbff] mt-2">{tenants.length}</div>
          <p className="text-[11px] text-[#bfc7d3]/80 mt-1">100% Graph Sync Connected</p>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <div className="text-xs font-mono text-[#bfc7d3] uppercase">Avg MSP Health Score</div>
          <div className="text-3xl font-mono font-bold text-[#00daf8] mt-2">
            {Math.round(tenants.reduce((acc, t) => acc + t.healthScore, 0) / tenants.length)}/100
          </div>
          <p className="text-[11px] text-[#00daf8] mt-1">Excellent Security Baseline</p>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <div className="text-xs font-mono text-[#bfc7d3] uppercase">Active Alerts Across Tenants</div>
          <div className="text-3xl font-mono font-bold text-[#ffb4ab] mt-2">
            {tenants.reduce((acc, t) => acc + t.openAlertsCount, 0)}
          </div>
          <p className="text-[11px] text-[#ffb4ab] mt-1">Requires MSP Analyst Attention</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#1e2023] p-4 rounded-xl border border-[#3f4751]/20">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
              filter === 'all' ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold border border-[#99cbff]/40' : 'text-[#bfc7d3] hover:bg-[#333538]'
            }`}
          >
            ALL TENANTS ({tenants.length})
          </button>
          <button
            onClick={() => setFilter('warning')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
              filter === 'warning' ? 'bg-[#93000a]/20 text-[#ffb4ab] font-bold border border-[#ffb4ab]/40' : 'text-[#bfc7d3] hover:bg-[#333538]'
            }`}
          >
            ATTENTION REQUIRED
          </button>
          <button
            onClick={() => setFilter('excellent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
              filter === 'excellent' ? 'bg-[#00daf8]/20 text-[#00daf8] font-bold border border-[#00daf8]/40' : 'text-[#bfc7d3] hover:bg-[#333538]'
            }`}
          >
            EXCELLENT (90+)
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenant or ID..."
            className="w-full bg-[#111317] border border-[#3f4751]/40 rounded-lg px-3 py-1.5 text-xs text-[#e2e2e6] placeholder:text-[#bfc7d3]/50 focus:outline-none focus:border-[#99cbff]"
          />
        </div>
      </div>

      {/* Tenants Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredTenants.map(t => (
          <div
            key={t.id}
            onClick={() => onSelectTenant(t)}
            className="glass-panel rounded-xl p-6 border border-[#3f4751]/20 hover:border-[#99cbff]/50 transition-all cursor-pointer accent-glow flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-[10px] font-mono text-[#99cbff] bg-[#99cbff]/10 px-2 py-0.5 rounded uppercase font-bold">
                    {t.type}
                  </span>
                  <h3 className="text-xl font-bold text-[#e2e2e6] mt-1">{t.name}</h3>
                  <p className="text-[11px] font-mono text-[#bfc7d3]">ID: {t.directoryId}</p>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-mono font-bold ${
                    t.healthScore >= 90 ? 'text-[#99cbff]' : 'text-[#ffb4ab]'
                  }`}>
                    {t.healthScore}/100
                  </div>
                  <span className="text-[10px] font-mono uppercase text-[#00daf8] font-bold">{t.healthStatus}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 py-3 my-3 border-y border-[#3f4751]/20 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-[#bfc7d3] block">USERS</span>
                  <span className="text-[#e2e2e6] font-bold">{t.usersCount}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#bfc7d3] block">MFA %</span>
                  <span className="text-[#99cbff] font-bold">{t.mfaPercentage}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#bfc7d3] block">OPEN ALERTS</span>
                  <span className={`font-bold ${t.openAlertsCount > 0 ? 'text-[#ffb4ab]' : 'text-[#00daf8]'}`}>
                    {t.openAlertsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs text-[#99cbff] font-mono pt-2">
              <span>Graph API: {t.graphStatus}</span>
              <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Inspect Command Center →
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
