import React, { useState } from 'react';
import { Tenant } from '../types';

interface BillingDetailViewProps {
  tenant: Tenant;
}

export const BillingDetailView: React.FC<BillingDetailViewProps> = ({ tenant }) => {
  const [toast, setToast] = useState<string | null>(null);

  const optimizeLicenses = () => {
    setToast('License optimization scan completed: 15 unassigned inactive seats flagged for reclamation saving $570/mo.');
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div className="fixed top-20 right-8 bg-[#00daf8]/20 border border-[#00daf8] text-white text-xs px-4 py-2.5 rounded-lg font-mono shadow-2xl z-50">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="glass-panel rounded-xl p-6 border-l-4 border-[#00daf8] flex justify-between items-center">
        <div>
          <span className="text-[10px] font-mono text-[#00daf8] font-bold uppercase tracking-widest">
            M365 LICENSE INVENTORY & BILLING
          </span>
          <h2 className="text-2xl font-bold text-[#e2e2e6] mt-1">{tenant.name} Subscriptions</h2>
          <p className="text-xs text-[#bfc7d3] mt-1">Seat allocation, license utilization, and cost optimization insights</p>
        </div>
        <button
          onClick={optimizeLicenses}
          className="bg-[#00daf8]/20 hover:bg-[#00daf8]/30 text-[#00daf8] border border-[#00daf8]/40 px-4 py-2 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">savings</span>
          Cost Optimization Scan
        </button>
      </div>

      {/* Billing Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">M365 E5 Seats Assigned</span>
          <div className="text-3xl font-mono font-bold text-[#e2e2e6] mt-1">
            {tenant.licensesTotal - tenant.licensesAvailable} / {tenant.licensesTotal}
          </div>
          <div className="w-full bg-[#1e2023] rounded-full h-1.5 overflow-hidden my-2">
            <div className="bg-[#99cbff] h-1.5 rounded-full" style={{ width: `${((tenant.licensesTotal - tenant.licensesAvailable) / tenant.licensesTotal) * 100}%` }}></div>
          </div>
          <span className="text-[10px] font-mono text-[#00daf8]">{tenant.licensesAvailable} Seats Available for Onboarding</span>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Monthly Recurring Cost</span>
          <div className="text-3xl font-mono font-bold text-[#99cbff] mt-1">
            ${(tenant.licensesTotal * 38).toLocaleString()} / mo
          </div>
          <p className="text-[10px] text-[#bfc7d3]/70 mt-2">Next Auto-Renewal: Sep 1, 2026</p>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-[#3f4751]/20">
          <span className="text-[10px] font-mono text-[#bfc7d3] uppercase">Add-on Subscriptions</span>
          <div className="text-3xl font-mono font-bold text-[#e2e2e6] mt-1">Microsoft Copilot</div>
          <p className="text-[10px] text-[#00daf8] mt-2">45 Seats Assigned ($1,350/mo)</p>
        </div>
      </div>

      {/* Subscriptions Table */}
      <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20">
        <h3 className="text-base font-semibold text-[#e2e2e6] mb-4">Active Microsoft 365 Subscriptions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#3f4751]/20 text-[10px] font-mono text-[#bfc7d3] uppercase">
                <th className="py-2.5">PRODUCT SKU</th>
                <th className="py-2.5">PURCHASED</th>
                <th className="py-2.5">ASSIGNED</th>
                <th className="py-2.5">AVAILABLE</th>
                <th className="py-2.5">UNIT PRICE</th>
                <th className="py-2.5 text-right">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4751]/10 text-xs">
              <tr className="hover:bg-[#333538]/20">
                <td className="py-3 font-semibold text-[#e2e2e6]">Microsoft 365 E5</td>
                <td className="py-3 font-mono text-[#e2e2e6]">500</td>
                <td className="py-3 font-mono text-[#99cbff] font-bold">450</td>
                <td className="py-3 font-mono text-[#00daf8]">50</td>
                <td className="py-3 font-mono text-[#bfc7d3]">$38.00 / mo</td>
                <td className="py-3 text-right">
                  <span className="bg-[#00daf8]/20 text-[#00daf8] px-2 py-0.5 rounded text-[10px] font-mono font-bold">ACTIVE</span>
                </td>
              </tr>
              <tr className="hover:bg-[#333538]/20">
                <td className="py-3 font-semibold text-[#e2e2e6]">Microsoft Copilot for M365</td>
                <td className="py-3 font-mono text-[#e2e2e6]">50</td>
                <td className="py-3 font-mono text-[#99cbff] font-bold">45</td>
                <td className="py-3 font-mono text-[#00daf8]">5</td>
                <td className="py-3 font-mono text-[#bfc7d3]">$30.00 / mo</td>
                <td className="py-3 text-right">
                  <span className="bg-[#00daf8]/20 text-[#00daf8] px-2 py-0.5 rounded text-[10px] font-mono font-bold">ACTIVE</span>
                </td>
              </tr>
              <tr className="hover:bg-[#333538]/20">
                <td className="py-3 font-semibold text-[#e2e2e6]">Microsoft Defender for Endpoint Plan 2</td>
                <td className="py-3 font-mono text-[#e2e2e6]">500</td>
                <td className="py-3 font-mono text-[#99cbff] font-bold">500</td>
                <td className="py-3 font-mono text-[#bfc7d3]">0</td>
                <td className="py-3 font-mono text-[#bfc7d3]">Included in E5</td>
                <td className="py-3 text-right">
                  <span className="bg-[#00daf8]/20 text-[#00daf8] px-2 py-0.5 rounded text-[10px] font-mono font-bold">ACTIVE</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
