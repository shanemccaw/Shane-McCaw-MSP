import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenantview/types';

interface SecurityDetailViewProps {
  tenant: Tenant;
}

export const SecurityDetailView: React.FC<SecurityDetailViewProps> = ({ tenant }) => {
  const [toast, setToast] = useState<string | null>(null);

  const triggerRiskyUserRemediation = () => {
    setToast('Remediation action triggered: Password reset & revoke tokens sent for 2 risky accounts.');
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div className="fixed top-20 right-8 bg-[#ffb4ab]/20 border border-[#ffb4ab] text-white text-xs px-4 py-2.5 rounded-lg font-mono shadow-2xl z-50 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-[#ffb4ab]">verified_user</span>
          {toast}
        </div>
      )}

      {/* Security Header Banner */}
      <div className="glass-panel rounded-xl p-6 border-l-4 border-[#ffb4ab] flex justify-between items-center">
        <div>
          <span className="text-[10px] font-mono text-[#ffb4ab] font-bold uppercase tracking-widest">
            ENTRA ID SECURITY & IDENTITY PROTECTION
          </span>
          <h2 className="text-2xl font-bold text-[#e2e2e6] mt-1">{tenant.name} Security Oversight</h2>
          <p className="text-xs text-[#bfc7d3] mt-1">Identity threat detection, risky sign-ins, and Conditional Access enforcement</p>
        </div>
        <button
          onClick={triggerRiskyUserRemediation}
          className="bg-[#93000a]/30 hover:bg-[#93000a]/50 text-[#ffb4ab] border border-[#ffb4ab]/40 px-4 py-2 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">key_off</span>
          Remediate Risky Users
        </button>
      </div>

      {/* Security Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">MFA Adoption Rate</span>
          <div className="text-2xl font-mono font-bold text-[#99cbff] mt-1">{tenant.mfaPercentage}%</div>
          <p className="text-[10px] text-[#bfc7d3]/70 mt-1">{tenant.usersCount - Math.round((tenant.mfaPercentage / 100) * tenant.usersCount)} Unenrolled Users</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Active CA Policies</span>
          <div className="text-2xl font-mono font-bold text-[#e2e2e6] mt-1">14 Policies</div>
          <p className="text-[10px] text-[#00daf8] mt-1">100% Policy Sync Active</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Risky Users Detected</span>
          <div className="text-2xl font-mono font-bold text-[#ffb4ab] mt-1">{tenant.riskyUsersCount} Accounts</div>
          <p className="text-[10px] text-[#ffb4ab] mt-1">Impossible Travel Flagged</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Break Glass Admin Accounts</span>
          <div className="text-2xl font-mono font-bold text-[#00daf8] mt-1">2 Configured</div>
          <p className="text-[10px] text-[#00daf8] mt-1">Cloud-only, FIDO2 Key Protected</p>
        </div>
      </div>

      {/* Risky Users Detail Table */}
      <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20">
        <h3 className="text-base font-semibold text-[#e2e2e6] mb-4">Identity Protection - Active Risk Detections</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#3f4751]/20 text-[10px] font-mono text-[#bfc7d3] uppercase">
                <th className="py-2.5">USER</th>
                <th className="py-2.5">RISK EVENT</th>
                <th className="py-2.5">RISK LEVEL</th>
                <th className="py-2.5">LOCATION / IP</th>
                <th className="py-2.5">TIME</th>
                <th className="py-2.5 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4751]/10 text-xs">
              <tr className="hover:bg-[#333538]/20">
                <td className="py-3">
                  <div className="font-semibold text-[#e2e2e6]">Pradeep Gupta</div>
                  <div className="text-[10px] font-mono text-[#bfc7d3]">pradeep.g@contoso.com</div>
                </td>
                <td className="py-3 font-mono text-[#ffb4ab]">Impossible Travel</td>
                <td className="py-3">
                  <span className="bg-[#93000a]/30 text-[#ffb4ab] px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-[#ffb4ab]/30">HIGH</span>
                </td>
                <td className="py-3 font-mono text-[#bfc7d3]">Frankfurt, DE (185.220.101.4)</td>
                <td className="py-3 font-mono text-[#bfc7d3]/80 text-[11px]">22 mins ago</td>
                <td className="py-3 text-right">
                  <button 
                    onClick={triggerRiskyUserRemediation}
                    className="bg-[#ffb4ab]/20 hover:bg-[#ffb4ab]/30 text-[#ffb4ab] border border-[#ffb4ab]/30 px-2.5 py-1 rounded font-mono text-[11px]"
                  >
                    Reset & Revoke
                  </button>
                </td>
              </tr>
              <tr className="hover:bg-[#333538]/20">
                <td className="py-3">
                  <div className="font-semibold text-[#e2e2e6]">Patti Fernandez</div>
                  <div className="text-[10px] font-mono text-[#bfc7d3]">patti.f@contoso.com</div>
                </td>
                <td className="py-3 font-mono text-amber-300">Unfamiliar Sign-in Properties</td>
                <td className="py-3">
                  <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-amber-500/30">MEDIUM</span>
                </td>
                <td className="py-3 font-mono text-[#bfc7d3]">Tor Exit Node (109.70.100.12)</td>
                <td className="py-3 font-mono text-[#bfc7d3]/80 text-[11px]">1 hour ago</td>
                <td className="py-3 text-right">
                  <button 
                    onClick={triggerRiskyUserRemediation}
                    className="bg-[#ffb4ab]/20 hover:bg-[#ffb4ab]/30 text-[#ffb4ab] border border-[#ffb4ab]/30 px-2.5 py-1 rounded font-mono text-[11px]"
                  >
                    Require MFA
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
