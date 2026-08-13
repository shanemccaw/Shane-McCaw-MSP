import React from 'react';
import { Tenant } from '@/components/msp-tenants/types';

interface TenantDetailModalProps {
  tenant: Tenant | null;
  onClose: () => void;
  onOpenTerminal: (tenant: Tenant) => void;
  onOpenTriage: (tenant: Tenant) => void;
}

export const TenantDetailModal: React.FC<TenantDetailModalProps> = ({
  tenant,
  onClose,
  onOpenTerminal,
  onOpenTriage,
}) => {
  if (!tenant) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#111317] border border-white/10 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm border ${
                tenant.status === 'critical'
                  ? 'bg-[#ffb4ab]/20 border-[#ffb4ab]/30 text-[#ffb4ab]'
                  : 'bg-[#99cbff]/20 border-[#99cbff]/30 text-[#99cbff]'
              }`}
            >
              {tenant.shortLetter}
            </div>
            <div>
              <h2 className="font-bold text-lg text-[#e2e2e6] flex items-center gap-2">
                {tenant.name}
                <span className="text-xs font-mono text-[#bfc7d3]/50">({tenant.id})</span>
              </h2>
              <p className="text-xs font-mono text-[#bfc7d3]/70">{tenant.primaryDomain} · Region: {tenant.region}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-[#bfc7d3] hover:text-[#e2e2e6]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Key metrics cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#1a1c1f] p-3.5 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">Secure Score</span>
              <span className={`text-xl font-bold ${tenant.secureScore < 50 ? 'text-[#ffb4ab]' : 'text-[#a5eeff]'}`}>
                {tenant.secureScore}%
              </span>
              <span className="text-[10px] font-mono block text-[#bfc7d3]/40 mt-0.5">Delta: {tenant.securePtsDelta > 0 ? `+${tenant.securePtsDelta}` : tenant.securePtsDelta} pts</span>
            </div>

            <div className="bg-[#1a1c1f] p-3.5 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">Compliance</span>
              <span className="text-xl font-bold text-[#99cbff]">{tenant.complianceScore}%</span>
              <span className="text-[10px] font-mono block text-[#bfc7d3]/40 mt-0.5">Alignment: {tenant.baselineAlignment}%</span>
            </div>

            <div className="bg-[#1a1c1f] p-3.5 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">Active Users</span>
              <span className="text-xl font-bold text-[#e2e2e6]">{tenant.usersCount}</span>
              <span className="text-[10px] font-mono block text-[#bfc7d3]/40 mt-0.5">{tenant.licenseCount} Licenses</span>
            </div>

            <div className="bg-[#1a1c1f] p-3.5 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">GDAP Session</span>
              <span className={`text-xl font-bold ${tenant.gdap.isCritical || tenant.gdap.isExpired ? 'text-[#ffb4ab]' : 'text-[#a5eeff]'}`}>
                {tenant.gdap.text}
              </span>
              <span className="text-[10px] font-mono block text-[#bfc7d3]/40 mt-0.5">{tenant.gdap.daysLeft} days remaining</span>
            </div>
          </div>

          {/* Details breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#1a1c1f]/60 p-4 rounded-lg border border-white/5 space-y-3">
              <h3 className="text-xs font-mono text-[#99cbff] uppercase tracking-wider font-bold">
                Security Posture & Enforcement
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-[#bfc7d3]/70">MFA Enforced Rate:</span>
                  <span className="text-[#e2e2e6] font-bold">{tenant.mfaEnforcedPercent}%</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-[#bfc7d3]/70">Conditional Access Policies:</span>
                  <span className="text-[#e2e2e6] font-bold">{tenant.conditionalAccessRules} Active Rules</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-[#bfc7d3]/70">Active Incidents:</span>
                  <span className={tenant.incidentsCount > 0 ? 'text-[#ffb4ab] font-bold' : 'text-[#a5eeff]'}>
                    {tenant.incidentsCount} High Priority
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-[#1a1c1f]/60 p-4 rounded-lg border border-white/5 space-y-3">
              <h3 className="text-xs font-mono text-[#99cbff] uppercase tracking-wider font-bold">
                Automation & Notes
              </h3>
              <p className="text-xs text-[#bfc7d3] leading-relaxed">
                {tenant.notes || 'No specific admin notes recorded for this environment.'}
              </p>
              <div className="pt-2 text-[10px] font-mono text-[#bfc7d3]/50">
                Primary Domain: {tenant.primaryDomain}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#1a1c1f] flex justify-between items-center">
          <button
            onClick={() => onOpenTerminal(tenant)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[#bfc7d3] rounded text-xs font-mono flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">terminal</span>
            Launch Terminal
          </button>

          <div className="flex gap-2">
            {tenant.status === 'critical' && (
              <button
                onClick={() => {
                  onClose();
                  onOpenTriage(tenant);
                }}
                className="bg-[#ffb4ab] text-[#690005] px-4 py-2 rounded font-mono text-xs font-bold uppercase"
              >
                Emergency Triage
              </button>
            )}
            <button
              onClick={onClose}
              className="bg-[#99cbff] text-[#003355] px-5 py-2 rounded font-mono text-xs font-bold uppercase"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
