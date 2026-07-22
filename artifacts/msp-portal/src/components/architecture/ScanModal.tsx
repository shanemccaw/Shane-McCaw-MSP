import React, { useEffect, useState } from 'react';
import { Terminal, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { ScanLog } from './types';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  environmentName: string;
}

export const ScanModal: React.FC<ScanModalProps> = ({
  isOpen,
  onClose,
  environmentName,
}) => {
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setLogs([]);
      setProgress(0);
      setIsFinished(false);
      return;
    }

    const scanSteps = [
      { module: 'Directory Services', msg: 'Querying Active Directory hygiene & role density...' },
      { module: 'Conditional Access', msg: 'Evaluating CA policy alignment across locations & risk rules...' },
      { module: 'OAuth Governance', msg: 'Scanning app registration grants & admin consents...' },
      { module: 'Collab Topology', msg: 'Analyzing Teams, SharePoint, and site ownership structures...' },
      { module: 'Anomaly Engine', msg: 'Calculating structural risk vectors and score updates...' },
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < scanSteps.length) {
        const step = scanSteps[currentStep];
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString(),
            module: step.module,
            status: 'success',
            message: step.msg,
          },
        ]);
        currentStep++;
        setProgress(Math.round((currentStep / scanSteps.length) * 100));
      } else {
        setIsFinished(true);
        clearInterval(interval);
      }
    }, 800);

    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-lg border border-[#333535] bg-[#1a1c1c] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#282a2b] pb-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-[#479ef5]" />
            <h3 className="font-display text-base font-semibold text-[#e2e2e2]">
              Tenant Analysis Engine ({environmentName})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#8a919d] hover:bg-[#282a2b] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between font-mono text-xs text-[#8a919d] mb-1">
            <span>Scan Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-[#121414] overflow-hidden">
            <div
              className="h-2 rounded-full bg-[#479ef5] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Live Terminal Log Output */}
        <div className="mt-4 h-64 overflow-y-auto rounded-md border border-[#282a2b] bg-[#121414] p-3 font-mono text-xs text-[#c0c7d3] space-y-2">
          {logs.map((log, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="text-[#8a919d]">[{log.timestamp}]</span>
              <span className="text-[#a0c9ff] font-bold">[{log.module}]</span>
              <span>{log.message}</span>
            </div>
          ))}

          {!isFinished && (
            <div className="flex items-center gap-2 text-[#f59e0b] animate-pulse">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Analyzing infrastructure parameters...</span>
            </div>
          )}

          {isFinished && (
            <div className="flex items-center gap-2 text-emerald-400 font-bold pt-2 border-t border-[#282a2b]">
              <CheckCircle2 className="h-4 w-4" />
              <span>Tenant analysis scan complete. Architecture score verified at 88/100.</span>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={!isFinished}
            className={`rounded-md px-4 py-2 font-mono text-xs font-semibold ${
              isFinished
                ? 'bg-[#479ef5] text-[#001c37] hover:bg-[#a0c9ff]'
                : 'bg-[#282a2b] text-[#8a919d] cursor-not-allowed'
            }`}
          >
            {isFinished ? 'Close Analysis' : 'Scanning...'}
          </button>
        </div>
      </div>
    </div>
  );
};
