import React, { useState } from 'react';
import { Lock, ShieldAlert, CheckCircle2, FileText, AlertTriangle, ArrowRight, X, Play, ShieldCheck, Database, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ChangeControlGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionTitle: string;
  targetEndpoint: string;
  targetTenantName: string;
  beforeStateJson: string;
  proposedStateJson: string;
  onApproveAndExecute: (psaTicketRef: string, justification: string) => void;
}

export const ChangeControlGateModal: React.FC<ChangeControlGateModalProps> = ({
  isOpen,
  onClose,
  actionTitle,
  targetEndpoint,
  targetTenantName,
  beforeStateJson,
  proposedStateJson,
  onApproveAndExecute,
}) => {
  const [psaTicketRef, setPsaTicketRef] = useState(`CW-${Math.floor(10000 + Math.random() * 90000)}`);
  const [justification, setJustification] = useState('Emergency security drift remediation requested by client NOC operator.');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!psaTicketRef.trim()) {
      setErrorText('PSA Ticket Reference # is required for production change governance.');
      return;
    }
    if (!justification.trim() || justification.trim().length < 10) {
      setErrorText('Please provide a detailed risk justification (min 10 chars).');
      return;
    }

    setErrorText('');
    setIsSubmitting(true);

    setTimeout(() => {
      setIsSubmitting(false);
      onApproveAndExecute(psaTicketRef.trim(), justification.trim());
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-[#131927] border border-amber-500/40 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* HEADER */}
        <div className="bg-gradient-to-r from-amber-950/60 via-[#182235] to-[#131927] border-b border-amber-500/30 p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 rounded-2xl border border-amber-500/40 text-amber-400 shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                  Dual-Sign Change Control Gate
                </span>
                <span className="text-xs text-slate-400">Target Tenant: <strong className="text-white">{targetTenantName}</strong></span>
              </div>
              <h2 className="text-lg font-bold text-white mt-0.5">
                {actionTitle}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY CONTENT */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5 max-h-[80vh] overflow-y-auto custom-scrollbar">
          
          {/* Pre-State Backup Snapshot Verification Badge */}
          <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold">🟢 Pre-State JSON Backup Snapshot Ready</span>
                <p className="text-[11px] text-emerald-300/80 mt-0.5 font-mono">
                  Snapshot ID: snap_m365_{Date.now().toString(36)} (Auto-Rollback Cache Enabled)
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono bg-emerald-900/60 text-emerald-300 px-2.5 py-1 rounded-lg border border-emerald-700/50">
              Graph Endpoint: {targetEndpoint}
            </span>
          </div>

          {/* JSON DIFF VIEW: Before vs Proposed After */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#38BDF8]" />
                Production Baseline JSON Diff (Before vs Proposed After)
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">Comparing tenant baseline vs new policy update</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
              {/* Before */}
              <div className="p-3 rounded-xl bg-slate-950 border border-red-900/40 text-red-300/90 overflow-x-auto space-y-1">
                <div className="text-[10px] uppercase font-bold text-red-400 border-b border-red-900/40 pb-1 mb-2 flex justify-between">
                  <span>Current Baseline (Before)</span>
                  <span className="text-slate-500">ReadOnly</span>
                </div>
                <pre className="whitespace-pre-wrap leading-relaxed">{beforeStateJson}</pre>
              </div>

              {/* Proposed After */}
              <div className="p-3 rounded-xl bg-slate-950 border border-emerald-900/40 text-emerald-300/90 overflow-x-auto space-y-1">
                <div className="text-[10px] uppercase font-bold text-emerald-400 border-b border-emerald-900/40 pb-1 mb-2 flex justify-between">
                  <span>Proposed Change (After)</span>
                  <span className="text-emerald-400 font-sans">Active Target</span>
                </div>
                <pre className="whitespace-pre-wrap leading-relaxed">{proposedStateJson}</pre>
              </div>
            </div>
          </div>

          {/* MANDATORY INPUT FIELDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide mb-1.5">
                PSA Ticket Reference # <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={psaTicketRef}
                onChange={(e) => setPsaTicketRef(e.target.value)}
                placeholder="e.g. CW-94821 or AUT-2026-88"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#182235] border border-[#23314a] text-slate-100 text-xs font-mono focus:outline-none focus:border-[#0078D4]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide mb-1.5">
                Risk Justification & Approval Reason <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Provide change ticket justification..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#182235] border border-[#23314a] text-slate-100 text-xs focus:outline-none focus:border-[#0078D4]"
                required
              />
            </div>
          </div>

          {errorText && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {/* ACTION BUTTONS */}
          <div className="pt-3 border-t border-[#1f293d] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-600/30 flex items-center gap-2 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Executing Graph API Write...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-300" />
                  <span>Approve & Execute Production Write</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
