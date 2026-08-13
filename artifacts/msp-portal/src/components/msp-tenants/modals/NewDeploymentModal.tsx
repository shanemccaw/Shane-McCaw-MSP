import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenants/types';

interface NewDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeployTenant: (newTenant: Partial<Tenant>) => void;
}

export const NewDeploymentModal: React.FC<NewDeploymentModalProps> = ({
  isOpen,
  onClose,
  onDeployTenant,
}) => {
  const [step, setStep] = useState(1);
  const [tenantName, setTenantName] = useState('');
  const [domain, setDomain] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [template, setTemplate] = useState('zero-trust');

  if (!isOpen) return null;

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
    else {
      // Finish deployment
      const generatedId = `T-${Math.floor(1000 + Math.random() * 9000)}-${tenantName.slice(0, 2).toUpperCase()}`;
      onDeployTenant({
        id: generatedId,
        name: tenantName || 'Acme Enterprises',
        shortLetter: (tenantName || 'A')[0].toUpperCase(),
        status: 'healthy',
        secureScore: 89,
        securePtsDelta: 5,
        secureSparkline: [6, 8, 10, 12],
        complianceScore: 92,
        compliancePtsDelta: 4,
        complianceSparkline: [8, 10, 11],
        baselineAlignment: 95,
        gdap: {
          text: '730d left',
          daysLeft: 730,
          percent: 100,
        },
        automation: {
          text: 'Provisioned Baseline Active',
          count: 45,
        },
        incidentsCount: 0,
        region,
        licenseCount: 250,
        usersCount: 210,
        mfaEnforcedPercent: 100,
        conditionalAccessRules: 14,
        primaryDomain: domain || `${tenantName.toLowerCase().replace(/\s+/g, '')}.onmicrosoft.com`,
      });
      onClose();
      setStep(1);
      setTenantName('');
      setDomain('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#111317] border border-white/10 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#99cbff]">add_box</span>
            <h2 className="text-sm font-bold text-[#e2e2e6] font-mono uppercase">
              New M365 Tenant Deployment Wizard
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-[#bfc7d3] hover:text-[#e2e2e6]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Wizard Steps indicator */}
        <div className="px-6 pt-4 flex items-center justify-between font-mono text-[10px]">
          <span className={step >= 1 ? 'text-[#99cbff] font-bold' : 'text-[#bfc7d3]/40'}>
            1. Identity
          </span>
          <span className="text-[#bfc7d3]/20">→</span>
          <span className={step >= 2 ? 'text-[#99cbff] font-bold' : 'text-[#bfc7d3]/40'}>
            2. GDAP Consent
          </span>
          <span className="text-[#bfc7d3]/20">→</span>
          <span className={step >= 3 ? 'text-[#99cbff] font-bold' : 'text-[#bfc7d3]/40'}>
            3. Policy Baseline
          </span>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-[#bfc7d3] mb-1">
                  Tenant Organization Name *
                </label>
                <input
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                  className="w-full bg-[#1a1c1f] border border-white/10 rounded px-3 py-2 text-xs text-[#e2e2e6] focus:outline-none focus:border-[#99cbff]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#bfc7d3] mb-1">
                  Primary Domain Name
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. acme.com"
                  className="w-full bg-[#1a1c1f] border border-white/10 rounded px-3 py-2 text-xs text-[#e2e2e6] focus:outline-none focus:border-[#99cbff]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#bfc7d3] mb-1">
                  Primary Azure Region
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full bg-[#1a1c1f] border border-white/10 rounded px-3 py-2 text-xs text-[#e2e2e6] focus:outline-none focus:border-[#99cbff]"
                >
                  <option value="us-east-1">US East (N. Virginia)</option>
                  <option value="us-west-2">US West (Oregon)</option>
                  <option value="eu-west-1">EU West (Ireland)</option>
                  <option value="ap-southeast-1">AP Southeast (Singapore)</option>
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="p-4 bg-[#99cbff]/5 border border-[#99cbff]/20 rounded-lg text-xs space-y-2">
                <p className="font-bold text-[#99cbff] font-mono">
                  Granular Delegated Admin Privileges (GDAP) Authorization
                </p>
                <p className="text-[#e2e2e6]/80 text-[11px] leading-relaxed">
                  Obsidian will issue a 730-day auto-renewing GDAP relationship invitation with minimal required roles (Global Reader, Security Admin, Intune Admin).
                </p>
              </div>
              <div className="flex items-center gap-2 p-3 bg-[#1a1c1f] rounded border border-white/5 text-xs text-[#a5eeff]">
                <span className="material-symbols-outlined text-sm">verified_user</span>
                <span>OAuth 2.0 Partner Center Certificate Ready</span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <label className="block text-xs font-mono text-[#bfc7d3] mb-1">
                Select Baseline Security Policy Template
              </label>

              <div
                onClick={() => setTemplate('zero-trust')}
                className={`p-3 rounded-lg border cursor-pointer ${
                  template === 'zero-trust'
                    ? 'bg-[#99cbff]/10 border-[#99cbff] text-[#e2e2e6]'
                    : 'bg-[#1a1c1f] border-white/5 text-[#bfc7d3]'
                }`}
              >
                <div className="font-bold text-xs font-mono">Obsidian Zero-Trust Baseline v5</div>
                <div className="text-[10px] opacity-70 mt-1">
                  Enforces phishing-resistant MFA, blocks legacy auth, auto-enrolls Defender endpoint policies.
                </div>
              </div>

              <div
                onClick={() => setTemplate('cis-level1')}
                className={`p-3 rounded-lg border cursor-pointer ${
                  template === 'cis-level1'
                    ? 'bg-[#99cbff]/10 border-[#99cbff] text-[#e2e2e6]'
                    : 'bg-[#1a1c1f] border-white/5 text-[#bfc7d3]'
                }`}
              >
                <div className="font-bold text-xs font-mono">CIS Microsoft 365 Foundation Level 1</div>
                <div className="text-[10px] opacity-70 mt-1">
                  Standard compliance for SMB & enterprise regulated workloads.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#1a1c1f] flex justify-between">
          <button
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="px-4 py-2 text-xs font-mono text-[#bfc7d3] disabled:opacity-30"
          >
            Back
          </button>
          <button
            onClick={handleNext}
            className="bg-[#99cbff] text-[#003355] px-5 py-2 rounded font-mono text-xs font-bold uppercase tracking-wider hover:brightness-110"
          >
            {step === 3 ? 'Deploy & Sync' : 'Next Step'}
          </button>
        </div>
      </div>
    </div>
  );
};
