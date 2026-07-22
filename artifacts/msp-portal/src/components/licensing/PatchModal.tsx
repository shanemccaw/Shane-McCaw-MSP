import React, { useState } from 'react';
import { AutomationCandidate } from '../types';
import { X, Play, ShieldAlert, CheckCircle2, ArrowRight, Loader2, Sparkles } from 'lucide-react';

interface PatchModalProps {
  candidate: AutomationCandidate | null;
  onClose: () => void;
  onApplyPatch: (candidateId: string) => void;
}

export const PatchModal: React.FC<PatchModalProps> = ({
  candidate,
  onClose,
  onApplyPatch,
}) => {
  const [step, setStep] = useState<'review' | 'running' | 'complete'>('review');
  const [logs, setLogs] = useState<string[]>([]);

  if (!candidate) return null;

  const handleStartPatch = () => {
    setStep('running');
    setLogs(['[00:00.01] Initializing Azure AD / Graph API pipeline connection...']);

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        `[00:00.85] Validating confidence metric (${candidate.confidence}%)... PASS`,
        `[00:01.20] Running dry-run simulation for action '${candidate.type}'...`,
      ]);
    }, 800);

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        `[00:02.10] Target scope matched: ${
          candidate.type === 'DELETE'
            ? '85 accounts inactive > 30d'
            : candidate.type === 'PATCH'
            ? '120 accounts suitable for E5->E3 downgrade'
            : '288 engineering users ready for Copilot'
        }`,
        `[00:02.90] Executing SKU reassignment transactional batch...`,
      ]);
    }, 1800);

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        `[00:03.60] Re-calculating tenant efficiency score (+3.2 pts)...`,
        `[00:04.10] Patch script executed successfully. Policy rules updated in ArchIntel tenant log.`,
      ]);
      setStep('complete');
      onApplyPatch(candidate.id);
    }, 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#1a1c1c] border border-white/10 rounded-xl max-w-xl w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#c0c7d3] hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-lg bg-[#479ef5]/10 border border-[#479ef5]/30 text-[#479ef5]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
              Automated Patch Execution
            </div>
            <h3 className="font-headline text-xl font-bold text-[#e2e2e2]">
              {candidate.title}
            </h3>
          </div>
        </div>

        {step === 'review' && (
          <div className="space-y-4 font-mono-tech text-xs">
            <div className="p-3 bg-[#121414] rounded border border-white/5 space-y-2">
              <div className="flex justify-between text-[#c0c7d3]">
                <span>Action Type:</span>
                <span className="font-bold text-[#479ef5]">{candidate.type}</span>
              </div>
              <div className="flex justify-between text-[#c0c7d3]">
                <span>Confidence Rating:</span>
                <span className="font-bold text-green-400">{candidate.confidence}% Verified</span>
              </div>
              <div className="flex justify-between text-[#c0c7d3]">
                <span>Projected Monthly Savings:</span>
                <span className="font-bold text-[#a0c9ff]">{candidate.estimatedMonthlySavings}</span>
              </div>
            </div>

            <p className="text-[#c0c7d3] font-sans leading-relaxed text-xs">
              {candidate.description} Executing this patch will apply tenant-wide licensing rules automatically via Microsoft Graph API integration.
            </p>

            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-300 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-[11px] font-sans">
                This operation is fully audit-logged. A automatic rollback checkpoint will be created prior to SKU modifications.
              </p>
            </div>

            <div className="pt-4 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-[#282a2b] hover:bg-[#333535] text-[#c0c7d3] rounded font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStartPatch}
                className="px-5 py-2 bg-[#479ef5] hover:bg-[#a0c9ff] text-[#003259] font-bold rounded flex items-center gap-2 transition-all shadow-lg"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Confirm &amp; Run Patch</span>
              </button>
            </div>
          </div>
        )}

        {step === 'running' && (
          <div className="py-6 text-center space-y-4">
            <div className="flex justify-center">
              <Loader2 className="w-10 h-10 text-[#479ef5] animate-spin" />
            </div>
            <p className="font-headline text-lg font-semibold text-[#e2e2e2]">
              Applying License Remediation Patch...
            </p>

            <div className="bg-[#121414] border border-white/5 rounded p-3 text-left font-mono-tech text-[11px] text-[#c0c7d3] h-36 overflow-y-auto space-y-1">
              {logs.map((log, idx) => (
                <div key={idx} className="leading-tight">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="py-4 space-y-4 text-center">
            <div className="flex justify-center">
              <div className="p-3 bg-green-500/20 border border-green-500/40 rounded-full text-green-400">
                <CheckCircle2 className="w-10 h-10" />
              </div>
            </div>

            <h4 className="font-headline text-xl font-bold text-[#e2e2e2]">
              Patch Successfully Applied!
            </h4>

            <p className="font-sans text-xs text-[#c0c7d3] leading-relaxed max-w-md mx-auto">
              License allocation has been updated across your tenant. Efficiency metrics and projected savings have been refreshed on your dashboard.
            </p>

            <div className="pt-4">
              <button
                onClick={onClose}
                className="w-full py-2.5 bg-[#479ef5] hover:bg-[#a0c9ff] text-[#003259] font-bold rounded font-mono-tech text-xs transition-all flex items-center justify-center gap-2"
              >
                <span>Return to Overview</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
