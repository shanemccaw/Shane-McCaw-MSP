import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl max-w-xl w-full p-6 shadow-2xl relative max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-[#282a2b]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 pb-4 border-b border-[#282a2b] shrink-0">
          <ShieldCheck className="w-5 h-5 text-[#a0c9ff]" />
          <div>
            <h3 className="font-display font-semibold text-base text-[#f1f3f5]">
              Privacy & Data Governance Policy
            </h3>
            <p className="text-xs text-[#8a919d]">GDPR & CCPA Compliance Statement (v2.4)</p>
          </div>
        </div>

        <div className="overflow-y-auto my-4 pr-2 space-y-4 text-xs text-[#c0c7d3] leading-relaxed font-sans">
          <section>
            <h4 className="font-semibold text-white text-sm mb-1">1. Information Collection & Storage</h4>
            <p>
              Tenant Intelligence collects property metadata, tenant lease logs, interaction timelines, and security audit records required to deliver multi-tenant property management analytics.
            </p>
          </section>

          <section>
            <h4 className="font-semibold text-white text-sm mb-1">2. Data Retention & Archival</h4>
            <p>
              By default, all workspace operational data is retained for 7 years to meet standard commercial lease auditing regulations. Extended compliance archives up to 15 years are supported under custom enterprise SLAs.
            </p>
          </section>

          <section>
            <h4 className="font-semibold text-white text-sm mb-1">3. GDPR & CCPA Compliance</h4>
            <p>
              Users possess the right to export full raw JSON/CSV archives of their workspace metadata at any time. Data deletion requests permanently purge tenant indices across all mirrored hot/cold database clusters within 30 days.
            </p>
          </section>

          <section>
            <h4 className="font-semibold text-white text-sm mb-1">4. Security Infrastructure</h4>
            <p>
              All transit channels utilize TLS 1.3 encryption, and database storage layers utilize AES-256 zero-trust key management. Access control is regulated via role-based access tokens (RBAC) and mandatory MFA enforcing.
            </p>
          </section>
        </div>

        <div className="pt-3 border-t border-[#282a2b] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-[#282a2b] hover:bg-[#333535] text-white rounded-md transition-colors"
          >
            Close Document
          </button>
        </div>
      </div>
    </div>
  );
};
