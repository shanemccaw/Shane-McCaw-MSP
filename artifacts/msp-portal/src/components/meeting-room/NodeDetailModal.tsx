import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WhiteboardNode } from '../types';
import { X, AlertTriangle, ShieldAlert, Lock, CheckCircle2, FileText, ArrowRight, Sparkles, MessageSquare, ShieldCheck, Zap } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface NodeDetailModalProps {
  node: WhiteboardNode | null;
  onClose: () => void;
  onDiscussTopic: (promptText: string) => void;
  onOpenDoc?: (docId: string) => void;
}

export const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  node,
  onClose,
  onDiscussTopic,
  onOpenDoc,
}) => {
  if (!node) return null;

  const isDanger = node.status === 'danger';
  const isWarning = node.status === 'warning';
  const isSafe = node.status === 'safe';

  const handleDiscuss = (questionText: string) => {
    audioSynth.playSuccessChime();
    onDiscussTopic(questionText);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            audioSynth.playHoverTick();
            onClose();
          }}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="relative w-full max-w-2xl max-h-[88vh] rounded-3xl bg-slate-900/95 border border-cyan-400/60 p-4 sm:p-6 backdrop-blur-2xl shadow-2xl ring-2 ring-cyan-500/30 overflow-y-auto custom-scrollbar text-slate-100 flex flex-col justify-between"
        >
          {/* Ambient Glow */}
          <div
            className={`absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none ${
              isDanger ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
          />

          {/* Close Button */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onClose();
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors z-10"
            title="Close Details"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-start gap-3.5 pb-4 border-b border-white/10">
            <div
              className={`p-3 rounded-2xl border shadow-lg flex-shrink-0 ${
                isDanger
                  ? 'bg-rose-950/80 border-rose-500/60 text-rose-400'
                  : isWarning
                  ? 'bg-amber-950/80 border-amber-500/60 text-amber-400'
                  : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-400'
              }`}
            >
              {isDanger ? (
                <AlertTriangle className="w-7 h-7 animate-pulse" />
              ) : isWarning ? (
                <ShieldAlert className="w-7 h-7" />
              ) : (
                <ShieldCheck className="w-7 h-7" />
              )}
            </div>

            <div className="flex-1 min-w-0 pr-6">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
                    isDanger
                      ? 'bg-rose-950 text-rose-300 border-rose-500/60'
                      : isWarning
                      ? 'bg-amber-950 text-amber-300 border-amber-500/60'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                  }`}
                >
                  {node.status.toUpperCase()} ASSESSMENT ITEM
                </span>
                <span className="text-xs font-mono text-cyan-300 uppercase tracking-wider">
                  Category: {node.category}
                </span>
              </div>
              <h3 className="text-xl md:text-2xl font-extrabold text-white tracking-tight leading-tight">
                {node.label}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-mono font-extrabold text-cyan-300 bg-cyan-950/80 px-2.5 py-0.5 rounded-lg border border-cyan-500/40">
                  {node.value}
                </span>
                <span className="text-xs text-slate-400 font-mono">{node.metricLabel}</span>
              </div>
            </div>
          </div>

          {/* Body Content in Clear Human-Readable Language */}
          <div className="my-4 space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {/* 1. What is this? (Plain English Summary) */}
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-cyan-300 font-bold mb-1 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                What This Means (In Plain English)
              </h4>
              <p className="text-xs md:text-sm text-slate-100 leading-relaxed bg-slate-950/70 p-3.5 rounded-xl border border-white/10 font-sans">
                {node.plainSummary || node.details}
              </p>
            </div>

            {/* 2. "WHAT HAPPENS IF I ENABLE THIS?" COMPARISON BOX */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-slate-950 to-emerald-950/30 border border-cyan-500/40 font-mono text-xs shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-cyan-500/20">
                <div className="flex items-center gap-1.5 text-cyan-300 font-bold uppercase tracking-wider text-[11px]">
                  <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span>What Happens If You Enable This Feature?</span>
                </div>
                <span className="text-[10px] bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-extrabold">
                  +18 PTS SCORE CHANGE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] my-2">
                <div className="p-2 rounded-xl bg-slate-950/80 border border-rose-500/40">
                  <span className="text-rose-400 font-bold block text-[10px] uppercase">Current State (Gap):</span>
                  <span className="text-slate-300 block mt-0.5">{node.value} ({node.metricLabel})</span>
                </div>

                <div className="p-2 rounded-xl bg-slate-950/80 border border-emerald-500/50">
                  <span className="text-emerald-300 font-bold block text-[10px] uppercase">If Enabled (Remediated):</span>
                  <span className="text-emerald-200 block mt-0.5">Automated Policy Grounding Active</span>
                </div>
              </div>

              <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-[11px] leading-relaxed flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>
                  <strong>Tenant Improvement:</strong> Elevates overall Microsoft 365 Copilot security posture, sealing oversharing vectors while maintaining seamless AI response grounding for authorized personnel.
                </span>
              </div>
            </div>

            {/* 2. Business Impact (Why this matters to the customer) */}
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-amber-300 font-bold mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Why This Matters to Your Business & Security
              </h4>
              <p className="text-xs md:text-sm text-amber-100/90 leading-relaxed bg-amber-950/30 p-3.5 rounded-xl border border-amber-500/30 font-sans">
                {node.businessImpact ||
                  'If left unaddressed, Microsoft 365 Copilot will respect existing permissions and make sensitive files discoverable in conversational responses to unauthorized personnel.'}
              </p>
            </div>

            {/* 3. Recommended Action Steps */}
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-emerald-300 font-bold mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Recommended Action Steps for Remediation
              </h4>
              <div className="space-y-1.5">
                {(
                  node.recommendedActions || [
                    'Implement Microsoft Purview Sensitivity Labels to automatically classify confidential documents.',
                    'Review and revoke broad "Everyone Except External Users" (EEEU) permissions across SharePoint.',
                    'Establish Data Loss Prevention (DLP) auto-labeling rules for credit card numbers and employee SSNs.',
                  ]
                ).map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-xs text-slate-200 bg-slate-950/50 p-2.5 rounded-xl border border-white/5"
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/50 font-mono font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="leading-snug">{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Interactive Discussion Action */}
          <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            {onOpenDoc && (
              <button
                onClick={() => {
                  audioSynth.playCardSwoosh();
                  onOpenDoc(
                    node.category === 'security'
                      ? 'doc-security-audit'
                      : node.category === 'oversharing'
                      ? 'doc-exposure-report'
                      : 'doc-copilot-spec'
                  );
                  onClose();
                }}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-cyan-400/60 hover:border-cyan-300 text-cyan-200 text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>OPEN HOLOGRAPHIC AUDIT REPORT</span>
              </button>
            )}

            <button
              onClick={() =>
                handleDiscuss(
                  node.suggestedQuestion ||
                    `Can the team walk through the details of ${node.label} (${node.value}) and explain our remediation steps?`
                )
              }
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-extrabold text-xs transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4" />
              <span>DISCUSS THIS ITEM IN BRIEFING</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
