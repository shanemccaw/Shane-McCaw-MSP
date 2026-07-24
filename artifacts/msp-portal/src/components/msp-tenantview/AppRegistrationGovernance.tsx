import React, { useState } from 'react';
import { Tenant, AppRegistration } from '@/components/msp-tenantview/types';

interface AppRegistrationGovernanceProps {
  tenant: Tenant;
  onToggleControl: (controlKey: keyof Tenant['securityControls']) => void;
  onViewAllApps: () => void;
  onUpdateAppStatus: (appId: string, status: 'Approved' | 'Revoked') => void;
}

export const AppRegistrationGovernance: React.FC<AppRegistrationGovernanceProps> = ({
  tenant,
  onToggleControl,
  onViewAllApps,
  onUpdateAppStatus,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAction = (app: AppRegistration, status: 'Approved' | 'Revoked') => {
    onUpdateAppStatus(app.appId, status);
    showToast(`${app.name} status updated to ${status}`);
  };

  return (
    <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20 flex flex-col justify-between relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 right-4 bg-[#00daf8]/20 border border-[#00daf8] text-[#e2e2e6] text-xs px-3.5 py-2 rounded-lg font-mono shadow-xl z-30 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-[#00daf8]">check_circle</span>
          {toastMessage}
        </div>
      )}

      <div>
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#99cbff]">apps</span>
            <h3 className="text-lg font-semibold text-[#e2e2e6]">App Registration Governance</h3>
          </div>
          <button 
            onClick={onViewAllApps}
            className="text-[#99cbff] text-[11px] font-mono hover:underline tracking-wider uppercase font-bold"
          >
            VIEW ALL 24 APPS
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#3f4751]/20 text-[10px] font-mono text-[#bfc7d3] uppercase tracking-wider">
                <th className="py-3 pr-4 font-semibold">APPLICATION</th>
                <th className="py-3 px-4 font-semibold">RISK SCORE</th>
                <th className="py-3 px-4 font-semibold">GRAPH PERMISSIONS</th>
                <th className="py-3 pl-4 font-semibold text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4751]/10 text-xs">
              {tenant.appRegistrations.slice(0, 3).map((app) => (
                <tr key={app.id} className="hover:bg-[#333538]/20 transition-colors">
                  <td className="py-3.5 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-[#333538] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[18px] text-[#bfc7d3]">{app.iconName}</span>
                      </div>
                      <div>
                        <div className="text-[#e2e2e6] font-semibold">{app.name}</div>
                        <div className="text-[10px] text-[#bfc7d3] font-mono">ID: {app.appId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                      app.riskLevel === 'HIGH' 
                        ? 'bg-[#93000a]/20 text-[#ffb4ab] border border-[#ffb4ab]/30' 
                        : app.riskLevel === 'MEDIUM'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-[#00daf8]/10 text-[#00daf8] border border-[#00daf8]/20'
                    }`}>
                      {app.riskLevel} ({app.riskScore})
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex gap-1.5 flex-wrap">
                      {app.permissions.map((p, idx) => (
                        <span 
                          key={idx}
                          className={`text-[9px] px-2 py-0.5 rounded font-mono ${
                            p.isHighRisk 
                              ? 'bg-[#93000a]/30 text-[#ffb4ab] border border-[#ffb4ab]/30' 
                              : 'bg-[#333538] text-[#bfc7d3]'
                          }`}
                        >
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3.5 pl-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handleAction(app, 'Approved')}
                        className={`p-1.5 rounded transition-colors ${
                          app.status === 'Approved' 
                            ? 'bg-[#99cbff]/20 text-[#99cbff]' 
                            : 'hover:bg-[#99cbff]/20 text-[#bfc7d3] hover:text-[#99cbff]'
                        }`}
                        title="Approve / Trust Application"
                      >
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                      </button>
                      <button 
                        onClick={() => handleAction(app, 'Revoked')}
                        className={`p-1.5 rounded transition-colors ${
                          app.status === 'Revoked' 
                            ? 'bg-[#93000a]/40 text-[#ffb4ab]' 
                            : 'hover:bg-[#93000a]/20 text-[#bfc7d3] hover:text-[#ffb4ab]'
                        }`}
                        title="Revoke / Block Application"
                      >
                        <span className="material-symbols-outlined text-sm">block</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rapid Security Controls Section */}
      <div className="mt-8 pt-6 border-t border-[#3f4751]/20">
        <h4 className="font-mono text-[10px] text-[#bfc7d3] mb-4 uppercase tracking-widest font-bold">
          RAPID SECURITY CONTROLS
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Control 1 */}
          <div className="flex items-center justify-between p-4 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div className="flex flex-col pr-2">
              <span className="text-[#e2e2e6] font-semibold text-xs">Password Complexity Enforcement</span>
              <span className="text-[10px] font-mono text-[#bfc7d3]">MIN 14 CHARS + NON-DICTIONARY</span>
            </div>
            <button
              onClick={() => {
                onToggleControl('passwordComplexity');
                showToast(`Password Complexity turned ${!tenant.securityControls.passwordComplexity ? 'ON' : 'OFF'}`);
              }}
              className={`w-11 h-6 rounded-full relative p-1 transition-colors shrink-0 ${
                tenant.securityControls.passwordComplexity ? 'bg-[#99cbff]' : 'bg-[#333538]'
              }`}
            >
              <div 
                className={`w-4 h-4 rounded-full bg-[#0c0e11] shadow transition-transform ${
                  tenant.securityControls.passwordComplexity ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Control 2 */}
          <div className="flex items-center justify-between p-4 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div className="flex flex-col pr-2">
              <span className="text-[#e2e2e6] font-semibold text-xs">MFA Conditional Access</span>
              <span className="text-[10px] font-mono text-[#bfc7d3]">TRUSTED LOCATIONS ONLY</span>
            </div>
            <button
              onClick={() => {
                onToggleControl('mfaConditionalAccess');
                showToast(`MFA Conditional Access turned ${!tenant.securityControls.mfaConditionalAccess ? 'ON' : 'OFF'}`);
              }}
              className={`w-11 h-6 rounded-full relative p-1 transition-colors shrink-0 ${
                tenant.securityControls.mfaConditionalAccess ? 'bg-[#99cbff]' : 'bg-[#333538]'
              }`}
            >
              <div 
                className={`w-4 h-4 rounded-full bg-[#0c0e11] shadow transition-transform ${
                  tenant.securityControls.mfaConditionalAccess ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
