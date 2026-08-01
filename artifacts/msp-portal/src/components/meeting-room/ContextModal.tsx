import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ContextAnchor } from '../types';
import { AlertTriangle, ShieldAlert, Users, Zap, X, ShieldCheck, Database, Check, Layers, Sliders, TrendingUp, Sparkles, Network, Lock, FileSearch } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface ContextModalProps {
  anchor: ContextAnchor | null;
  onClose: () => void;
  onApplyFix?: () => void;
}

export const ContextModal: React.FC<ContextModalProps> = ({
  anchor,
  onClose,
  onApplyFix,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'simulation' | 'metrics'>('overview');
  const [isPolicySimulated, setIsPolicySimulated] = useState<boolean>(true);

  if (!anchor) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Holographic Blurred Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            audioSynth.playHoverTick();
            onClose();
          }}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-xl"
        />

        {/* Modal Window with Specular Refraction & Holographic Glow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.88, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 240 }}
          className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl bg-slate-900/95 border border-cyan-400/70 p-5 md:p-6 backdrop-blur-2xl shadow-[0_25px_90px_rgba(6,182,212,0.4)] ring-2 ring-cyan-500/40 overflow-y-auto custom-scrollbar flex flex-col justify-between overflow-hidden"
        >
          {/* Holographic Layered Glow Backdrop */}
          <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-emerald-500/20 blur-2xl pointer-events-none" />

          {/* Refractive Specular Overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-cyan-500/10 pointer-events-none rounded-3xl z-10" />

          {/* Header */}
          <div className="relative z-20 flex items-center justify-between pb-3 border-b border-cyan-500/30">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-cyan-400/50 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                {anchor.type === 'oversharing' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                ) : anchor.type === 'dlp' ? (
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                ) : anchor.type === 'sprawl' ? (
                  <Users className="w-5 h-5 text-purple-400" />
                ) : (
                  <Zap className="w-5 h-5 text-emerald-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 text-[9px] font-mono font-extrabold uppercase tracking-widest border border-cyan-500/40">
                    HOLOGRAPHIC DEEP DIVE
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono font-bold">
                    [LIVE VECTOR ANALYZER]
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-white uppercase tracking-wide mt-0.5">
                  {anchor.label}
                </h3>
              </div>
            </div>

            <button
              onClick={() => {
                audioSynth.playHoverTick();
                onClose();
              }}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors z-20 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Views based on Anchor Type */}
          <div className="relative z-20 my-4 space-y-4">
            <p className="text-xs text-slate-200 leading-relaxed font-sans">
              {anchor.description}
            </p>

            {/* OVERSHARING MAP HOlOGRAPHIC PANEL */}
            {anchor.type === 'oversharing' && (
              <div className="space-y-3 font-mono text-xs">
                {/* Visual Risk Distribution Bar */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-500/40 space-y-2">
                  <div className="flex justify-between items-center text-slate-200">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Network className="w-4 h-4 text-amber-400" />
                      1,240 Exposed SharePoint Sites
                    </span>
                    <span className="text-rose-400 text-[10px] bg-rose-950 px-2 py-0.5 rounded border border-rose-800 font-bold">
                      78% INHERITED READ ACCESS
                    </span>
                  </div>

                  {/* Meter Bar */}
                  <div className="w-full h-3 rounded-full bg-slate-900 overflow-hidden flex p-0.5 border border-slate-800">
                    <div className="h-full bg-rose-500 rounded-l-full w-[45%]" title="Exec Salaries & HR (45%)" />
                    <div className="h-full bg-amber-500 w-[30%]" title="M&A & IP Strategy (30%)" />
                    <div className="h-full bg-purple-500 w-[15%]" title="Source Code & Credentials (15%)" />
                    <div className="h-full bg-emerald-500 rounded-r-full w-[10%]" title="Public Docs (10%)" />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] pt-1 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Exec Payroll: <strong>558 Sites</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>M&A Strategy: <strong>372 Sites</strong></span>
                    </div>
                  </div>
                </div>

                {/* Copilot Grounding Vector Threat */}
                <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-200 space-y-2">
                  <span className="font-bold text-rose-300 uppercase text-[10px] tracking-wider block">
                    Copilot Vector Vulnerability:
                  </span>
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    When an employee prompts Copilot: <em className="text-cyan-300 font-serif">"Summarize executive compensation for Q3"</em>, Copilot queries indexed SharePoint sites inheriting 'Everyone Except External Users' and surfaces confidential payroll spreadsheets.
                  </p>
                </div>
              </div>
            )}

            {/* DLP GAPS HOLOGRAPHIC PANEL */}
            {anchor.type === 'dlp' && (
              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-rose-500/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-rose-300 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-rose-400" />
                      Purview DLP Gap Matrix
                    </span>
                    <span className="text-emerald-300 text-[10px] bg-emerald-950 px-2 py-0.5 rounded border border-emerald-700 font-bold">
                      FIX GAINS +18 PTS
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 text-slate-300">
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">Unlabeled Files:</span>
                      <strong className="text-rose-400 text-sm">18,420 Files</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">Auto-Label Policy:</span>
                      <strong className="text-amber-400 text-sm">Disabled (Baseline)</strong>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-200 text-[11px] leading-relaxed flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-mono text-emerald-300 uppercase block mb-0.5">
                      Remediation Impact:
                    </strong>
                    <span>
                      Enforcing Microsoft Purview Auto-Labeling instantly applies 'Confidential - Highly Restricted' sensitivity tags to financial records, instructing Copilot to suppress unverified indexing.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TEAMS SPRAWL HOLOGRAPHIC PANEL */}
            {anchor.type === 'sprawl' && (
              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-purple-500/40 space-y-2">
                  <div className="flex justify-between items-center text-slate-200">
                    <span className="font-bold text-purple-300 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-purple-400" />
                      Teams Topology & Guest Governance
                    </span>
                    <span className="text-purple-300 text-[10px] bg-purple-950 px-2 py-0.5 rounded border border-purple-800 font-bold">
                      312 UNMANAGED CHANNELS
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-1 text-slate-300">
                    <div className="flex justify-between">
                      <span>Orphaned Guest Accounts:</span>
                      <strong className="text-amber-400">142 Guests</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Inactive Team Owners:</span>
                      <strong className="text-rose-400">89 Channels</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Conditional Access Enforcement:</span>
                      <strong className="text-cyan-300">Step-Up MFA Required</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* COPILOT SIMULATION / VALUE HOLOGRAPHIC PANEL */}
            {anchor.type === 'value' && (
              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-emerald-500/40 space-y-2">
                  <div className="flex justify-between items-center text-slate-200">
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      Copilot 1,500 Seat Rollout ROI
                    </span>
                    <span className="text-emerald-300 text-[10px] bg-emerald-950 px-2 py-0.5 rounded border border-emerald-700 font-bold">
                      340% ANNUAL RETURN
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 text-slate-300">
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">Est. Weekly Saved:</span>
                      <strong className="text-emerald-300 text-sm">5.2 Hours / User</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase">Yearly Enterprise Value:</span>
                      <strong className="text-cyan-300 text-sm">$4,850,000 Saved</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="relative z-20 pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
            >
              Close Panel
            </button>
            {onApplyFix && (
              <button
                onClick={() => {
                  audioSynth.playSuccessChime();
                  onApplyFix();
                  onClose();
                }}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs tracking-wider uppercase transition-colors shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Apply Remediation Fix</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
