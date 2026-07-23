import React from 'react';
import { ShieldAlert, ExternalLink, ChevronDown } from 'lucide-react';

interface PrivacyGovernanceCardProps {
  retentionPolicy: string;
  onChangeRetentionPolicy: (val: string) => void;
  onOpenPrivacyModal: () => void;
}

export const PrivacyGovernanceCard: React.FC<PrivacyGovernanceCardProps> = ({
  retentionPolicy,
  onChangeRetentionPolicy,
  onOpenPrivacyModal,
}) => {
  return (
    <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5 shadow-sm">
      <h2 className="font-display font-semibold text-base text-[#f1f3f5] pb-3 border-b border-[#282a2b]">
        Privacy & Data Governance
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Data Retention Policy */}
        <div className="bg-[#141616] border border-[#282a2b] rounded-lg p-4 flex flex-col justify-between gap-3">
          <div>
            <h3 className="font-medium text-xs text-[#e2e2e2]">Data Retention Policy</h3>
            <p className="text-[11px] text-[#8a919d] mt-1 leading-relaxed">
              System logs and tenant records are stored for a default of 7 years unless custom configurations are applied.
            </p>
          </div>

          <div className="relative mt-1">
            <select
              value={retentionPolicy}
              onChange={(e) => onChangeRetentionPolicy(e.target.value)}
              className="w-full bg-[#1e2020] border border-[#282a2b] rounded-md py-2 pl-3 pr-8 text-xs text-[#e2e2e2] appearance-none focus:outline-none focus:border-[#479ef5] cursor-pointer"
            >
              <option value="Standard (7 Years)">Standard (7 Years)</option>
              <option value="Extended (10 Years)">Extended (10 Years)</option>
              <option value="Compliance Archive (15 Years)">Compliance Archive (15 Years)</option>
              <option value="Custom (3 Years)">Custom (3 Years)</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[#8a919d] pointer-events-none" />
          </div>
        </div>

        {/* Privacy Policy */}
        <div className="bg-[#141616] border border-[#282a2b] rounded-lg p-4 flex flex-col justify-between gap-3">
          <div>
            <h3 className="font-medium text-xs text-[#e2e2e2]">Privacy Policy</h3>
            <p className="text-[11px] text-[#8a919d] mt-1 leading-relaxed">
              Review our latest updates regarding GDPR and CCPA compliance. Last updated Oct 24, 2023.
            </p>
          </div>

          <div>
            <button
              onClick={onOpenPrivacyModal}
              className="inline-flex items-center gap-1.5 text-xs text-[#a0c9ff] hover:text-[#bcd8ff] font-medium transition-colors"
            >
              <span>Read Full Policy</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
