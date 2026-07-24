import React from 'react';
import { Tenant } from '@/components/msp-tenants/types';

interface TenantGridCardViewProps {
  tenants: Tenant[];
  onOpenTriage: (tenant: Tenant) => void;
  onOpenTerminal: (tenant: Tenant) => void;
  onSelectTenantDetail: (tenant: Tenant) => void;
}

export const TenantGridCardView: React.FC<TenantGridCardViewProps> = ({
  tenants,
  onOpenTriage,
  onOpenTerminal,
  onSelectTenantDetail,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {tenants.map((tenant) => {
        const isCritical = tenant.status === 'critical';
        return (
          <div
            key={tenant.id}
            onClick={() => onSelectTenantDetail(tenant)}
            className="glass-dark rounded-xl p-5 border border-white/5 hover:border-[#99cbff]/30 transition-all cursor-pointer flex flex-col justify-between group"
          >
            <div>
              {/* Card Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm border ${
                      isCritical
                        ? 'bg-[#ffb4ab]/20 border-[#ffb4ab]/30 text-[#ffb4ab]'
                        : 'bg-[#99cbff]/20 border-[#99cbff]/30 text-[#99cbff]'
                    }`}
                  >
                    {tenant.shortLetter}
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#e2e2e6] text-base group-hover:text-[#99cbff] transition-colors flex items-center gap-2">
                      {tenant.name}
                      {isCritical && (
                        <span className="w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse"></span>
                      )}
                    </h3>
                    <p className="text-xs text-[#bfc7d3]/50 font-mono">{tenant.id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTerminal(tenant);
                    }}
                    className="p-1.5 rounded hover:bg-white/10 text-[#bfc7d3] hover:text-[#99cbff]"
                    title="Terminal"
                  >
                    <span className="material-symbols-outlined text-sm">terminal</span>
                  </button>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-2 bg-[#1a1c1f]/60 p-3 rounded-lg border border-white/5 mb-4">
                <div>
                  <span className="text-[9px] font-mono opacity-50 uppercase block">Secure</span>
                  <span
                    className={`text-sm font-bold ${
                      tenant.secureScore < 50 ? 'text-[#ffb4ab]' : 'text-[#a5eeff]'
                    }`}
                  >
                    {tenant.secureScore}%
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-mono opacity-50 uppercase block">Compliance</span>
                  <span className="text-sm font-bold text-[#99cbff]">
                    {tenant.complianceScore}%
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-mono opacity-50 uppercase block">Baseline</span>
                  <span className="text-sm font-bold text-[#bfc7d3]">
                    {tenant.baselineAlignment}%
                  </span>
                </div>
              </div>

              {/* GDAP & Automation */}
              <div className="space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-[#bfc7d3]/50">GDAP Session</span>
                  <span
                    className={
                      tenant.gdap.isCritical || tenant.gdap.isExpired
                        ? 'text-[#ffb4ab] font-bold'
                        : 'text-[#a5eeff]'
                    }
                  >
                    {tenant.gdap.text}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#bfc7d3]/50">Workflows</span>
                  <span className={tenant.automation.isFailed ? 'text-[#ffb4ab] font-bold' : 'text-[#bfc7d3]'}>
                    {tenant.automation.text}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Action */}
            <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#bfc7d3]/40">
                {tenant.usersCount} users · {tenant.region}
              </span>
              {isCritical ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTriage(tenant);
                  }}
                  className="bg-[#ffb4ab]/10 hover:bg-[#ffb4ab]/20 text-[#ffb4ab] text-[10px] font-mono uppercase px-3 py-1 rounded border border-[#ffb4ab]/30 font-bold"
                >
                  Triage Now
                </button>
              ) : (
                <span className="text-[10px] font-mono text-[#99cbff] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Inspect <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
