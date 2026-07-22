import React, { useState } from 'react';
import { X, FileText, Lock, HelpCircle } from 'lucide-react';

export const Footer: React.FC = () => {
  const [modalType, setModalType] = useState<'privacy' | 'audit' | 'support' | null>(null);

  return (
    <footer className="bg-[#0c0f0f] border-t border-[#404752]/20 mt-8 px-6 py-6 flex flex-col md:flex-row justify-between items-center w-full gap-4 max-w-[1440px] mx-auto">
      <div className="text-[12px] font-['JetBrains_Mono'] font-bold text-[#e2e2e2]">
        © 2024 Compliance Intelligence. Obsidian Metric Analytics.
      </div>
      <div className="flex gap-6">
        <button
          onClick={() => setModalType('privacy')}
          className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3] hover:text-[#e2e2e2] transition-colors"
        >
          Privacy Policy
        </button>
        <button
          onClick={() => setModalType('audit')}
          className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3] hover:text-[#e2e2e2] transition-colors"
        >
          Audit Logs
        </button>
        <button
          onClick={() => setModalType('support')}
          className="text-[10px] font-['JetBrains_Mono'] font-medium text-[#c0c7d3] hover:text-[#e2e2e2] transition-colors"
        >
          Support
        </button>
      </div>

      {/* Footer Modal dialogs */}
      {modalType && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#242424] border border-[#404752]/40 rounded-xl max-w-md w-full p-6 shadow-2xl relative">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-[#404752]/30">
              <h4 className="font-['Hanken_Grotesk'] font-bold text-sm text-[#e2e2e2] flex items-center gap-2">
                {modalType === 'privacy' && <Lock className="w-4 h-4 text-[#a0c9ff]" />}
                {modalType === 'audit' && <FileText className="w-4 h-4 text-[#a0c9ff]" />}
                {modalType === 'support' && <HelpCircle className="w-4 h-4 text-[#a0c9ff]" />}
                {modalType === 'privacy' && 'Privacy & Compliance Standard'}
                {modalType === 'audit' && 'System Audit Log Registry'}
                {modalType === 'support' && 'Obsidian Support Diagnostics'}
              </h4>
              <button onClick={() => setModalType(null)} className="text-[#c0c7d3] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#c0c7d3] leading-relaxed mb-4">
              {modalType === 'privacy' &&
                'All data processed by Compliance Intelligence is strictly encrypted at rest (AES-256) and in transit (TLS 1.3). No personal tenant content is logged beyond anonymized metadata.'}
              {modalType === 'audit' &&
                'Audit logs are continuously streamed to the immutable ledger. Current sync status: 99.8% consistency across 5 tenant regions.'}
              {modalType === 'support' &&
                'For urgent compliance incidents or custom retention overrides, contact compliance-ops@obsidian-metric.internal or submit a priority ticket.'}
            </p>

            <button
              onClick={() => setModalType(null)}
              className="w-full py-1.5 bg-[#479ef5] text-[#003259] font-bold text-xs rounded hover:opacity-90"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </footer>
  );
};
