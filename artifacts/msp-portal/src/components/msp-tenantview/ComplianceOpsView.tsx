import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenantview/types';
import { mockCompliancePolicies } from '@/components/msp-tenantview/mockData';

interface ComplianceOpsViewProps {
  tenant: Tenant;
}

export const ComplianceOpsView: React.FC<ComplianceOpsViewProps> = ({ tenant }) => {
  const [policies, setPolicies] = useState(mockCompliancePolicies);
  const [toast, setToast] = useState<string | null>(null);

  const triggerAudit = () => {
    setToast('Compliance audit triggered across M365 Purview Graph endpoints.');
    setTimeout(() => setToast(null), 3000);
  };

  const togglePolicyStatus = (idx: number) => {
    const updated = [...policies];
    updated[idx].status = updated[idx].status === 'Enforcing' ? 'Audit Only' : 'Enforcing';
    setPolicies(updated);
    setToast(`${updated[idx].name} updated to ${updated[idx].status}`);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div className="fixed top-20 right-8 bg-[#00daf8]/20 border border-[#00daf8] text-white text-xs px-4 py-2.5 rounded-lg font-mono shadow-2xl z-50 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-[#00daf8]">task_alt</span>
          {toast}
        </div>
      )}

      {/* Header card */}
      <div className="glass-panel rounded-xl p-6 border-l-4 border-[#00daf8] flex justify-between items-center">
        <div>
          <span className="text-[10px] font-mono text-[#00daf8] font-bold uppercase tracking-widest">
            MICROSOFT PURVIEW & GOVERNANCE OPS
          </span>
          <h2 className="text-2xl font-bold text-[#e2e2e6] mt-1">{tenant.name} Compliance Oversight</h2>
          <p className="text-xs text-[#bfc7d3] mt-1">Data loss prevention (DLP), retention policies, and cross-tenant regulatory compliance</p>
        </div>
        <button
          onClick={triggerAudit}
          className="bg-[#99cbff]/20 hover:bg-[#99cbff]/30 text-[#99cbff] border border-[#99cbff]/40 px-4 py-2 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">fact_check</span>
          Run Instant Audit
        </button>
      </div>

      {/* Compliance Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Purview Score</span>
          <div className="text-2xl font-mono font-bold text-[#99cbff] mt-1">91%</div>
          <p className="text-[10px] text-[#bfc7d3]/70 mt-1">GDPR & SOC2 Compliant</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Active DLP Rules</span>
          <div className="text-2xl font-mono font-bold text-[#e2e2e6] mt-1">12 Rules</div>
          <p className="text-[10px] text-[#00daf8] mt-1">64 Matches Prevented Today</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Sensitivity Labels</span>
          <div className="text-2xl font-mono font-bold text-[#e2e2e6] mt-1">8 Labels</div>
          <p className="text-[10px] text-[#bfc7d3]/70 mt-1">Confidential & Restricted</p>
        </div>

        <div className="glass-panel rounded-xl p-4 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Data Drift Status</span>
          <div className="text-2xl font-mono font-bold text-[#00daf8] mt-1">Clean</div>
          <p className="text-[10px] text-[#00daf8] mt-1">No unverified external shares</p>
        </div>
      </div>

      {/* Policy Table */}
      <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20">
        <h3 className="text-base font-semibold text-[#e2e2e6] mb-4">Active Compliance & Data Protection Policies</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#3f4751]/20 text-[10px] font-mono text-[#bfc7d3] uppercase">
                <th className="py-2.5">POLICY NAME</th>
                <th className="py-2.5">CATEGORY</th>
                <th className="py-2.5">STATUS</th>
                <th className="py-2.5">MATCHES TODAY</th>
                <th className="py-2.5">LAST AUDIT</th>
                <th className="py-2.5 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4751]/10 text-xs">
              {policies.map((p, idx) => (
                <tr key={idx} className="hover:bg-[#333538]/20">
                  <td className="py-3 font-semibold text-[#e2e2e6]">{p.name}</td>
                  <td className="py-3 font-mono text-[#bfc7d3] text-[11px]">{p.category}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      p.status === 'Enforcing' 
                        ? 'bg-[#00daf8]/20 text-[#00daf8]' 
                        : 'bg-[#333538] text-[#bfc7d3]'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-[#99cbff] font-bold">{p.matchesToday}</td>
                  <td className="py-3 font-mono text-[#bfc7d3]/80 text-[11px]">{p.lastAudit}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => togglePolicyStatus(idx)}
                      className="text-xs font-mono text-[#99cbff] hover:underline"
                    >
                      Toggle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
