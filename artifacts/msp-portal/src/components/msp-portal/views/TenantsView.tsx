import React, { useState } from 'react';
import { Users, Search, ShieldCheck, Lock, RefreshCw, Key, ExternalLink } from 'lucide-react';
import { Tenant } from '../../types';

interface TenantsViewProps {
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
  onEnforceMFA: (tenant: Tenant) => void;
  onRevokeSessions: (tenant: Tenant) => void;
  onRunSync: (tenant: Tenant) => void;
}

export const TenantsView: React.FC<TenantsViewProps> = ({
  tenants,
  onSelectTenant,
  onEnforceMFA,
  onRevokeSessions,
  onRunSync,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.primaryDomain.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea]">
      <div className="flex justify-between items-center bg-[#1c2026] p-3 border border-[#404752] rounded-md">
        <div>
          <h2 className="text-base font-bold text-[#e0e2ea] flex items-center gap-2">
            <Users className="w-5 h-5 text-[#0078d4]" />
            <span>Managed Tenants Inventory ({tenants.length})</span>
          </h2>
          <p className="text-xs text-[#8a919e]">
            Multi-Tenant Microsoft 365 environments under MSP GDAP delegation.
          </p>
        </div>

        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e] w-3.5 h-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search tenant name or domain..."
            className="bg-[#0b0e14] border border-[#404752] rounded pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-[#0078d4] text-[#e0e2ea] w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((tenant) => (
          <div
            key={tenant.id}
            className="bg-[#101419] border border-[#404752] p-3.5 rounded-md flex flex-col justify-between hover:border-[#0078d4] transition-all space-y-3"
          >
            <div className="space-y-2">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 flex items-center justify-center font-bold text-xs text-[#a3c9ff]">
                    {tenant.code}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#e0e2ea]">{tenant.name}</h3>
                    <div className="text-[10px] text-[#8a919e] font-mono">{tenant.primaryDomain}</div>
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    tenant.secureScore > 75
                      ? 'bg-[#052e16] text-[#4ade80] border border-[#166534]'
                      : 'bg-[#451a03] text-[#fb923c] border border-[#9a3412]'
                  }`}
                >
                  Score: {tenant.secureScore}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] bg-[#181c22] p-2 rounded border border-[#404752]/30">
                <div>
                  <span className="text-[#8a919e]">MFA Status: </span>
                  <span className={tenant.mfaPercentage < 70 ? 'text-[#ffb4ab] font-bold' : 'font-semibold'}>
                    {tenant.mfaPercentage}%
                  </span>
                </div>
                <div>
                  <span className="text-[#8a919e]">Licenses: </span>
                  <span className="font-semibold text-[#a3c9ff]">{tenant.licenseUsage.tier}</span>
                </div>
                <div>
                  <span className="text-[#8a919e]">User Count: </span>
                  <span className="font-semibold">{tenant.userCount}</span>
                </div>
                <div>
                  <span className="text-[#8a919e]">Sync: </span>
                  <span className="font-semibold text-[#4ade80]">{tenant.syncStatus}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#404752]/40 gap-2">
              <button
                onClick={() => onEnforceMFA(tenant)}
                title="Enforce MFA Policy"
                className="p-1.5 bg-[#272a30] hover:bg-[#0078d4] hover:text-white text-[#a3c9ff] rounded transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onRevokeSessions(tenant)}
                title="Revoke Sessions"
                className="p-1.5 bg-[#272a30] hover:bg-[#93000a] hover:text-white text-[#ffb4ab] rounded transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onRunSync(tenant)}
                title="Run Graph Sync"
                className="p-1.5 bg-[#272a30] hover:bg-[#166534] hover:text-white text-[#4ade80] rounded transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onSelectTenant(tenant)}
                className="flex-1 bg-[#0078d4] hover:bg-[#0060ab] text-white py-1 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1"
              >
                <span>View Telemetry</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
