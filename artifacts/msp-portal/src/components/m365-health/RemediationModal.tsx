import React, { useState, useEffect } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, X, Zap, Wrench } from 'lucide-react';

interface RemediationModalProps {
  title: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export const RemediationModal: React.FC<RemediationModalProps> = ({
  title,
  description,
  isOpen,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<number>(1);
  const [isExecuting, setIsExecuting] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setIsExecuting(true);

      const t1 = setTimeout(() => setStep(2), 1200);
      const t2 = setTimeout(() => setStep(3), 2400);
      const t3 = setTimeout(() => {
        setIsExecuting(false);
      }, 3500);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
    return undefined;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="glass-card bg-[#1e2020] border border-[#404752] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#404752] flex items-center justify-between bg-[#121414]">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-[#a0c9ff]" />
            <h3 className="font-headline font-bold text-[#e2e2e2]">
              Automated Remediation Engine
            </h3>
          </div>
          <button onClick={onClose} className="text-[#8a919d] hover:text-[#e2e2e2]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div>
            <h4 className="text-sm font-bold text-[#a0c9ff]">{title}</h4>
            <p className="text-xs text-[#c0c7d3] mt-1">{description}</p>
          </div>

          {/* Workflow Steps */}
          <div className="space-y-3 bg-[#121414] p-4 rounded-xl border border-[#404752]/50">
            {/* Step 1 */}
            <div className="flex items-center space-x-3 text-xs font-mono">
              {step > 1 ? (
                <CheckCircle2 className="w-4 h-4 text-[#a0c9ff]" />
              ) : step === 1 ? (
                <RefreshCw className="w-4 h-4 text-[#479ef5] animate-spin" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-[#404752] flex items-center justify-center text-[9px]">1</span>
              )}
              <span className={step >= 1 ? 'text-[#e2e2e2] font-semibold' : 'text-[#8a919d]'}>
                Step 1: Validating tenant security policies & Graph API scope
              </span>
            </div>

            {/* Step 2 */}
            <div className="flex items-center space-x-3 text-xs font-mono">
              {step > 2 ? (
                <CheckCircle2 className="w-4 h-4 text-[#a0c9ff]" />
              ) : step === 2 ? (
                <RefreshCw className="w-4 h-4 text-[#479ef5] animate-spin" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-[#404752] flex items-center justify-center text-[9px]">2</span>
              )}
              <span className={step >= 2 ? 'text-[#e2e2e2] font-semibold' : 'text-[#8a919d]'}>
                Step 2: Executing powershell/policy auto-enforcement script
              </span>
            </div>

            {/* Step 3 */}
            <div className="flex items-center space-x-3 text-xs font-mono">
              {step >= 3 && !isExecuting ? (
                <CheckCircle2 className="w-4 h-4 text-[#a0c9ff]" />
              ) : step === 3 ? (
                <RefreshCw className="w-4 h-4 text-[#479ef5] animate-spin" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-[#404752] flex items-center justify-center text-[9px]">3</span>
              )}
              <span className={step >= 3 ? 'text-[#e2e2e2] font-semibold' : 'text-[#8a919d]'}>
                Step 3: Verifying compliance telemetry & updating metric scores
              </span>
            </div>
          </div>

          {isExecuting ? (
            <div className="text-center py-2 text-xs font-mono text-[#479ef5] animate-pulse">
              Running automated remediation flow... Please do not close.
            </div>
          ) : (
            <div className="p-3 bg-[#00345c]/40 border border-[#479ef5] rounded-xl text-xs font-mono text-[#a0c9ff] flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 flex-shrink-0" />
              <span>Remediation completed successfully! Tenant score updated.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#121414] border-t border-[#404752] flex justify-end space-x-3">
          <button
            onClick={() => {
              onComplete();
              onClose();
            }}
            disabled={isExecuting}
            className="px-5 py-2 bg-[#479ef5] text-[#00345c] font-mono text-xs font-bold rounded-lg hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isExecuting ? 'Processing...' : 'Done & Apply Score'}
          </button>
        </div>
      </div>
    </div>
  );
};
