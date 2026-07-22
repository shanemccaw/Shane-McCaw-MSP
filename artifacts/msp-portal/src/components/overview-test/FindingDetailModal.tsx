import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Terminal,
  CheckCircle2,
  Copy,
  Check,
  Zap,
  ShieldAlert,
} from 'lucide-react';
import { CriticalFinding } from './types';

interface FindingDetailModalProps {
  finding: CriticalFinding;
  onClose: () => void;
  onRemediate: (id: string) => void;
}

export const FindingDetailModal: React.FC<FindingDetailModalProps> = ({
  finding,
  onClose,
  onRemediate,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(finding.status === 'remediated');

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleExecuteRemediation = () => {
    setIsExecuting(true);
    setExecutionLog(['Connecting to Microsoft Graph API Endpoint...', 'Authenticating with Admin token...']);

    setTimeout(() => {
      setExecutionLog((prev) => [...prev, 'Evaluating target resource configuration...']);
    }, 1000);

    setTimeout(() => {
      setExecutionLog((prev) => [...prev, 'Applying remediation policy script...']);
    }, 2000);

    setTimeout(() => {
      setExecutionLog((prev) => [...prev, 'SUCCESS: Policy applied. Verification scan passed!']);
      setIsExecuting(false);
      setIsComplete(true);
      onRemediate(finding.id);
    }, 3200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in">
      <div className="bg-[#1c2025] border border-white/10 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative my-8">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-white/10 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-mono tracking-wider font-bold text-slate-400">
                  {finding.category}
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-xs font-mono font-bold text-red-400 uppercase">
                  Severity: {finding.severity}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight mt-0.5">
                {finding.title}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="py-6 space-y-6 text-xs sm:text-sm text-slate-300">
          
          {/* Affected Entities Banner */}
          <div className="bg-[#101419] p-4 rounded-xl border border-white/10">
            <span className="text-xs font-bold text-slate-400 block mb-1 uppercase font-mono">
              Affected Entities / Scope:
            </span>
            <p className="font-mono text-xs text-[#479ef5]">{finding.affectedEntities}</p>
          </div>

          {/* Description & Impact */}
          <div>
            <h4 className="font-bold text-white text-xs uppercase font-mono tracking-wider mb-2 text-slate-400">
              Finding Overview & Risk Impact
            </h4>
            <p className="leading-relaxed text-slate-300">{finding.details}</p>
          </div>

          {/* Remediation Steps */}
          <div>
            <h4 className="font-bold text-white text-xs uppercase font-mono tracking-wider mb-2 text-slate-400">
              Recommended Remediation Steps
            </h4>
            <ul className="space-y-2">
              {finding.remediationSteps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2.5 bg-white/5 p-3 rounded-lg border border-white/5">
                  <span className="w-5 h-5 rounded-full bg-[#479ef5]/20 text-[#479ef5] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-xs text-slate-200">{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* PowerShell / MS Graph Script */}
          {finding.powershellCommand && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs uppercase font-mono tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  PowerShell / MS Graph Command
                </span>
                <button
                  onClick={() => handleCopy(finding.powershellCommand!)}
                  className="text-xs text-[#479ef5] hover:underline flex items-center gap-1 font-mono"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied!' : 'Copy Script'}</span>
                </button>
              </div>
              <pre className="bg-[#101419] p-3.5 rounded-xl border border-white/10 font-mono text-[11px] text-emerald-400 overflow-x-auto">
                {finding.powershellCommand}
              </pre>
            </div>
          )}

          {/* Simulated Execution Log */}
          {executionLog.length > 0 && (
            <div className="bg-[#101419] p-3.5 rounded-xl border border-white/10 font-mono text-[11px] space-y-1">
              <div className="text-slate-400 font-bold mb-1 border-b border-white/10 pb-1">
                Execution Output Log:
              </div>
              {executionLog.map((log, i) => (
                <div
                  key={i}
                  className={log.includes('SUCCESS') ? 'text-emerald-400 font-bold' : 'text-slate-300'}
                >
                  &gt; {log}
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-[#242830] hover:bg-[#2c313c] text-xs font-semibold text-slate-300"
          >
            Close
          </button>

          {isComplete ? (
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs bg-emerald-500/10 px-4 py-2.5 rounded-xl border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
              <span>Remediation Applied & Verified</span>
            </div>
          ) : (
            <button
              onClick={handleExecuteRemediation}
              disabled={isExecuting}
              className={`px-6 py-2.5 rounded-xl font-bold text-xs text-slate-950 flex items-center gap-2 transition-all shadow-lg ${
                isExecuting
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-[#479ef5] hover:bg-[#3b82f6] shadow-[#479ef5]/20 hover:scale-105'
              }`}
            >
              <Zap className={`w-4 h-4 ${isExecuting ? 'animate-spin' : ''}`} />
              <span>{isExecuting ? 'Executing Policy...' : 'Execute Auto-Remediation'}</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
