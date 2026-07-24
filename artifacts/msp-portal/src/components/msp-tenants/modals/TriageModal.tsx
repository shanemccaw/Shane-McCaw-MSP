import React, { useState } from 'react';
import { Tenant } from '../../types';

interface TriageModalProps {
  tenant: Tenant | null;
  onClose: () => void;
  onAutoRemediate: (tenantId: string) => void;
}

export const TriageModal: React.FC<TriageModalProps> = ({ tenant, onClose, onAutoRemediate }) => {
  const [isFixing, setIsFixing] = useState(false);
  const [fixSuccess, setFixSuccess] = useState(false);

  if (!tenant) return null;

  const handleFix = () => {
    setIsFixing(true);
    setTimeout(() => {
      setIsFixing(false);
      setFixSuccess(true);
      setTimeout(() => {
        onAutoRemediate(tenant.id);
        onClose();
      }, 1200);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#111317] border border-[#ffb4ab]/30 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-[#ffb4ab]/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ffb4ab]/20 border border-[#ffb4ab]/40 flex items-center justify-center text-[#ffb4ab] font-bold">
              {tenant.shortLetter}
            </div>
            <div>
              <h2 className="font-bold text-lg text-[#e2e2e6] flex items-center gap-2">
                Emergency Triage: {tenant.name}
                <span className="text-xs font-mono bg-[#ffb4ab] text-[#690005] px-2 py-0.5 rounded font-bold">
                  CRITICAL
                </span>
              </h2>
              <p className="text-xs font-mono text-[#bfc7d3]/70">Tenant ID: {tenant.id} · Domain: {tenant.primaryDomain}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#bfc7d3] hover:text-[#e2e2e6] hover:bg-white/10"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Status summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#1a1c1f] p-3 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">Secure Score</span>
              <span className="text-lg font-bold text-[#ffb4ab]">{tenant.secureScore}%</span>
            </div>
            <div className="bg-[#1a1c1f] p-3 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">GDAP Window</span>
              <span className="text-lg font-bold text-[#ffb4ab]">{tenant.gdap.text}</span>
            </div>
            <div className="bg-[#1a1c1f] p-3 rounded-lg border border-white/5">
              <span className="text-[10px] font-mono text-[#bfc7d3]/50 uppercase block">Active Incidents</span>
              <span className="text-lg font-bold text-[#ffb4ab]">{tenant.incidentsCount} High</span>
            </div>
          </div>

          {/* Failed Workflows list */}
          <div>
            <h3 className="text-xs font-mono text-[#bfc7d3] uppercase tracking-wider font-bold mb-3">
              Detected Workflow Failures ({tenant.failedWorkflowsDetails?.length || 0})
            </h3>
            <div className="space-y-2">
              {tenant.failedWorkflowsDetails?.map((fail, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg text-xs flex items-start gap-3"
                >
                  <span className="material-symbols-outlined text-[#ffb4ab] text-sm mt-0.5">
                    error
                  </span>
                  <div>
                    <p className="text-[#e2e2e6] font-medium">{fail}</p>
                    <p className="text-[10px] font-mono text-[#bfc7d3]/50 mt-0.5">
                      Target: Microsoft Graph Endpoint / Conditional Access API
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Remediation Recommendation */}
          <div className="bg-[#99cbff]/5 border border-[#99cbff]/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[#99cbff] text-base">psychology</span>
              <h4 className="text-xs font-bold text-[#99cbff] font-mono uppercase">
                Copilot Auto-Fix Strategy
              </h4>
            </div>
            <p className="text-xs text-[#e2e2e6]/80 leading-relaxed">
              Automated script will re-authenticate GDAP token, force-reset breaking Conditional Access exclusion rules, and restore default baseline policy in under 15 seconds.
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-mono text-[#bfc7d3] hover:text-[#e2e2e6]"
          >
            Cancel
          </button>

          {fixSuccess ? (
            <div className="flex items-center gap-2 text-[#a5eeff] font-mono text-xs font-bold">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Remediation Applied Successfully!
            </div>
          ) : (
            <button
              disabled={isFixing}
              onClick={handleFix}
              className="bg-[#ffb4ab] hover:bg-[#ffb4ab]/90 text-[#690005] px-6 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg"
            >
              {isFixing ? (
                <>
                  <span className="material-symbols-outlined text-sm animate-spin">
                    autorenew
                  </span>
                  Executing Auto-Fix...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">bolt</span>
                  Execute 1-Click Auto-Remediation
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
