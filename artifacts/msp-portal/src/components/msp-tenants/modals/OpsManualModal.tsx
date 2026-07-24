import React from 'react';

interface OpsManualModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OpsManualModal: React.FC<OpsManualModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#111317] border border-white/10 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#99cbff]">menu_book</span>
            <h2 className="text-sm font-bold text-[#e2e2e6] font-mono uppercase">
              Obsidian M365 Operations Handbook & Policy Baselines
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-[#bfc7d3] hover:text-[#e2e2e6]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#e2e2e6] font-sans leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-mono text-sm text-[#99cbff] font-bold uppercase">
              1. GDAP Lifecycle & Automated Extension Rules
            </h3>
            <p className="text-[#bfc7d3]">
              All tenant connections require active Granular Delegated Admin Privileges (GDAP). When GDAP session timer enters the critical window (&lt;72h), Admin Copilot automatically dispatches an invite renewal link to the tenant client administrator.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-mono text-sm text-[#99cbff] font-bold uppercase">
              2. Security Drift Engine Reconciliations
            </h3>
            <p className="text-[#bfc7d3]">
              The Drift Engine runs continuous diff checks every 15 minutes against Microsoft Graph API endpoints. If an unauthorized tenant admin creates an MFA exclusion or alters Conditional Access policies, the engine flags a drift event and prompts for 1-click auto-fix.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-mono text-sm text-[#a5eeff] font-bold uppercase">
              3. Emergency Triage Protocols
            </h3>
            <p className="text-[#bfc7d3]">
              Tenants falling below 50% Secure Score trigger an emergency alert in the Global Momentum Ribbon. Click "Triage Now" on the affected row to inspect specific failing workflows and restore compliance.
            </p>
          </section>

          <section className="space-y-2 bg-[#1a1c1f] p-4 rounded-lg border border-white/5 font-mono text-[11px]">
            <div className="text-[#d2bbff] font-bold mb-1">Standard M365 Baseline Specifications:</div>
            <ul className="list-disc pl-4 space-y-1 text-[#bfc7d3]">
              <li>Phishing-resistant MFA enforced for 100% of privileged accounts</li>
              <li>Legacy Authentication (Basic Auth) blocked across Exchange Online</li>
              <li>Intune Compliance required for all corporate device tokens</li>
              <li>Defender for Endpoint unified agent auto-deployment</li>
            </ul>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#1a1c1f] flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#99cbff] text-[#003355] px-5 py-2 rounded font-mono text-xs font-bold uppercase"
          >
            Close Manual
          </button>
        </div>
      </div>
    </div>
  );
};
