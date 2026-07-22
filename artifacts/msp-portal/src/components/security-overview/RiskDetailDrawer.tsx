import React, { useState } from 'react';
import { SecurityRiskItem } from '../types';
import { X, ShieldAlert, CheckCircle2, Lock, RefreshCw, UserX } from 'lucide-react';

interface RiskDetailDrawerProps {
  risk: SecurityRiskItem | null;
  onClose: () => void;
  onMitigate: (riskId: string, actionName: string) => void;
}

export const RiskDetailDrawer: React.FC<RiskDetailDrawerProps> = ({
  risk,
  onClose,
  onMitigate,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!risk) return null;

  const handleAction = (actionName: string) => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onMitigate(risk.id, actionName);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[#181a1a] border-l border-white/10 h-full p-6 flex flex-col justify-between overflow-y-auto shadow-2xl">
        {/* Drawer Header */}
        <div>
          <div className="flex justify-between items-center pb-4 border-b border-white/10 mb-5">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#ffb4ab]/10 text-[#ffb4ab] border border-[#ffb4ab]/30 font-semibold">
                RISK #{risk.rank}
              </span>
              <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-[#93000a] text-[#ffdad6]">
                {risk.severity}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-[#c0c7d3] hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Risk Title & Subtitle */}
          <div className="space-y-4">
            <h2 className="font-headline text-xl font-semibold text-white leading-snug">
              {risk.title}
            </h2>

            <div className="bg-[#0c0f0f] p-3.5 rounded-lg border border-white/5 space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-[#c0c7d3]">Scope / Target:</span>
                <span className="text-[#a0c9ff] font-medium">{risk.locationOrIdentity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#c0c7d3]">Detected At:</span>
                <span className="text-white">{risk.detectedAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#c0c7d3]">Status:</span>
                <span className="text-[#ffb4ab] uppercase font-semibold">{risk.status}</span>
              </div>
            </div>

            {/* Recommendation Box */}
            <div className="bg-[#1e2020] p-4 rounded-xl border border-[#479ef5]/20 space-y-2">
              <div className="flex items-center gap-2 text-xs font-mono text-[#a0c9ff] uppercase tracking-wider font-semibold">
                <ShieldAlert className="w-4 h-4 text-[#479ef5]" />
                Security AI Recommendation
              </div>
              <p className="text-sm text-[#e2e2e2] leading-relaxed font-body">
                {risk.recommendation}
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-6 border-t border-white/10 space-y-2.5 mt-6">
          <button
            onClick={() => handleAction('Quarantine Session & Block Sign-in')}
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-[#93000a] hover:bg-[#b00020] text-white rounded-lg font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow"
          >
            {isSubmitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <UserX className="w-4 h-4" />
            )}
            QUARANTINE & BLOCK SIGN-IN
          </button>

          <button
            onClick={() => handleAction('Enforce Step-Up MFA Policy')}
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-[#479ef5] hover:bg-[#0061a6] text-[#003259] hover:text-white rounded-lg font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow"
          >
            <Lock className="w-4 h-4" />
            ENFORCE STEP-UP MFA
          </button>

          <button
            onClick={() => handleAction('Mark Risk as Mitigated')}
            disabled={isSubmitting}
            className="w-full py-2 px-4 bg-white/5 hover:bg-white/10 text-[#c0c7d3] hover:text-white rounded-lg font-mono text-xs flex items-center justify-center gap-2 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4 text-[#40c463]" />
            MARK AS MITIGATED
          </button>
        </div>
      </div>
    </div>
  );
};
