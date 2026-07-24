import React from 'react';
import { Tenant } from '@/components/msp-tenants/types';

interface TenantMapViewProps {
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
}

export const TenantMapView: React.FC<TenantMapViewProps> = ({ tenants, onSelectTenant }) => {
  return (
    <div className="glass-dark rounded-xl p-6 border border-white/5 relative min-h-[420px] flex flex-col justify-between overflow-hidden">
      <div className="flex items-center justify-between mb-4 z-10">
        <div>
          <h3 className="font-mono text-xs text-[#99cbff] uppercase tracking-widest font-bold">
            Alpha Cluster Topology Map
          </h3>
          <p className="text-xs text-[#bfc7d3]/50">Global M365 Data Center Routing & GDAP Latency</p>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#a5eeff]"></span> Optimal</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#99cbff]"></span> Syncing</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#ffb4ab]"></span> Critical Drift</span>
        </div>
      </div>

      {/* Visual Canvas Nodes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 my-6 z-10">
        {tenants.map((tenant) => {
          const isCritical = tenant.status === 'critical';
          return (
            <button
              key={tenant.id}
              onClick={() => onSelectTenant(tenant)}
              className={`p-4 rounded-xl border text-left transition-all hover:scale-105 ${
                isCritical
                  ? 'bg-[#ffb4ab]/10 border-[#ffb4ab]/40 text-[#ffb4ab] shadow-[0_0_15px_rgba(255,180,171,0.15)]'
                  : 'bg-[#1a1c1f] border-white/10 text-[#e2e2e6] hover:border-[#99cbff]/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] opacity-60">{tenant.region}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCritical ? 'bg-[#ffb4ab] animate-pulse' : 'bg-[#a5eeff]'
                  }`}
                ></span>
              </div>
              <h4 className="font-bold text-sm truncate">{tenant.name}</h4>
              <p className="text-[10px] font-mono opacity-50 mt-1">{tenant.id}</p>
              <div className="mt-3 pt-2 border-t border-white/5 text-[10px] font-mono flex justify-between">
                <span>Score:</span>
                <span className="font-bold">{tenant.secureScore}%</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-center text-[10px] font-mono text-[#bfc7d3]/40 border-t border-white/5 pt-3 z-10">
        Connected via Microsoft Graph REST API · 24ms Average Mesh Latency
      </div>
    </div>
  );
};
