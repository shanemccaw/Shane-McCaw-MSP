import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentPreviewData } from '../types';
import { FileText, X, ShieldAlert, AlertTriangle, CheckCircle, ExternalLink, Sparkles, TrendingUp, ShieldCheck, Zap, Sliders, ArrowRight, Check } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface InlineDocPreviewProps {
  document: DocumentPreviewData | null;
  onClose: () => void;
  onApplyRemediation?: () => void;
}

export const InlineDocPreview: React.FC<InlineDocPreviewProps> = ({
  document,
  onClose,
  onApplyRemediation,
}) => {
  const [isEnableSimulated, setIsEnableSimulated] = useState<boolean>(true);
  const [activePage, setActivePage] = useState<number>(0);

  if (!document) return null;

  const totalPages = 3;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 overflow-hidden">
        {/* Slight Room Dimming Backdrop with Holographic Ambient Vignette */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            audioSynth.playHoverTick();
            onClose();
          }}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-xl shadow-[inset_0_0_150px_rgba(0,0,0,0.95)] z-0"
        />

        {/* Projection Beam Pedestal Rays (Emitters projecting up from table) */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 max-w-2xl h-48 bg-gradient-to-t from-cyan-500/20 via-purple-500/10 to-transparent pointer-events-none blur-2xl z-0" />

        {/* Floating Holographic Glass Viewer Frame */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          transition={{
            duration: 0.35,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="relative w-full max-w-3xl max-h-[90vh] rounded-3xl bg-slate-900/95 border border-cyan-400/60 p-5 md:p-6 backdrop-blur-2xl shadow-[0_20px_60px_rgba(6,182,212,0.28)] flex flex-col justify-between ring-1 ring-cyan-400/40 relative overflow-hidden z-10 transform-gpu will-change-transform"
        >
          {/* Shimmering Edge Specular Light Sweep */}
          <motion.div
            animate={{
              x: ['-100%', '200%'],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent pointer-events-none z-20"
          />

          {/* Holographic Layered Glow Backdrop */}
          <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-emerald-500/20 blur-2xl pointer-events-none" />

          {/* Corner Holographic Reticles & Brackets */}
          <div className="absolute top-2 left-3 text-[9px] font-mono font-bold text-cyan-400/70 tracking-widest pointer-events-none">
            [ HOLOGRAPHIC_DOC_PROJECTION // VER 3.4 ]
          </div>
          <div className="absolute top-2 right-12 text-[9px] font-mono font-bold text-cyan-400/70 tracking-widest pointer-events-none">
            [ RETICLE_LOCK_ACTIVE ]
          </div>

          {/* Refractive Specular Glass Overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-cyan-500/10 pointer-events-none rounded-3xl z-10" />

          {/* Holographic Scanline Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(6,182,212,0.04)_50%)] bg-[length:100%_4px] pointer-events-none z-10" />

          {/* Header Bar */}
          <div className="relative z-20 pt-2">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-500/60 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-950 border border-rose-500/60 text-rose-300 uppercase tracking-widest">
                      {document.classification}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-700 uppercase">
                      Holographic View
                    </span>
                  </div>
                  <h3 className="text-base md:text-lg font-bold text-slate-100 tracking-wide mt-1">
                    {document.title}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  onClose();
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors z-20 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Document Metadata Strip */}
            <div className="my-3 py-2 px-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 gap-2">
              <span>Author: <strong className="text-slate-200">{document.author}</strong></span>
              <span>Audit Date: <strong className="text-slate-200">{document.date}</strong></span>
              <span className="text-cyan-300 font-bold">Page {activePage + 1} of {totalPages}</span>
            </div>

            {/* Page Navigation Tabs */}
            <div className="flex items-center gap-1.5 mb-3 p-1 rounded-xl bg-slate-950 border border-slate-800">
              {[
                '1. Executive Overview & Policy',
                '2. Audited Findings Matrix',
                '3. Tenant Metrics & Enforcements',
              ].map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    audioSynth.playHoverTick();
                    setActivePage(idx);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-mono font-bold transition-all ${
                    activePage === idx
                      ? 'bg-cyan-500 text-slate-950 shadow-md border border-cyan-300'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Animated Page Transitions Content Area */}
          <div className="relative z-20 flex-1 overflow-y-auto custom-scrollbar my-2 pr-1 min-h-[300px]">
            <AnimatePresence mode="wait">
              {activePage === 0 && (
                <motion.div
                  key="page-0"
                  initial={{ opacity: 0, x: 25 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -25 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="space-y-4"
                >
                  {/* COMPARISON MODULE */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-cyan-950/40 to-slate-950 border border-cyan-500/50 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3 pb-2 border-b border-cyan-500/20">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
                        <h4 className="text-xs font-mono font-extrabold text-cyan-300 uppercase tracking-wider">
                          What Happens If You Enable This Policy?
                        </h4>
                      </div>

                      <button
                        onClick={() => {
                          audioSynth.playHoverTick();
                          setIsEnableSimulated(!isEnableSimulated);
                        }}
                        className="px-3 py-1 rounded-full bg-slate-900 border border-cyan-400/60 text-xs font-mono font-bold text-cyan-200 hover:border-cyan-300 transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                      >
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                        <span>State: {isEnableSimulated ? 'ENABLED (Simulated)' : 'CURRENT (Baseline)'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        className={`p-3 rounded-xl border transition-all ${
                          !isEnableSimulated
                            ? 'bg-rose-950/40 border-rose-500/80 ring-2 ring-rose-500/40'
                            : 'bg-slate-900/60 border-slate-800 opacity-75'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-rose-400" />
                            Current State (Disabled)
                          </span>
                          <span className="text-[10px] font-mono text-rose-400 bg-rose-950 px-1.5 py-0.5 rounded border border-rose-800">
                            GAPS PRESENT
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs font-mono">
                          <div className="flex justify-between text-slate-300">
                            <span>DLP Coverage:</span>
                            <strong className="text-rose-400">42% Protected</strong>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Overshared Sites:</span>
                            <strong className="text-rose-400">640 High Risk</strong>
                          </div>
                          <div className="flex justify-between text-slate-300 pt-1 border-t border-rose-900/50">
                            <span>Readiness Score:</span>
                            <strong className="text-rose-300 text-sm font-extrabold">64 / 100</strong>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`p-3 rounded-xl border transition-all ${
                          isEnableSimulated
                            ? 'bg-emerald-950/40 border-emerald-400/80 ring-2 ring-emerald-400/40 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                            : 'bg-slate-900/60 border-slate-800 opacity-75'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            What If You Enable This?
                          </span>
                          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-700">
                            REMEDIATED
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs font-mono">
                          <div className="flex justify-between text-slate-200">
                            <span>DLP Coverage:</span>
                            <strong className="text-emerald-300">94% (+52% Increase)</strong>
                          </div>
                          <div className="flex justify-between text-slate-200">
                            <span>Overshared Sites:</span>
                            <strong className="text-emerald-300">28 (-95.6% Exposure)</strong>
                          </div>
                          <div className="flex justify-between text-slate-200 pt-1 border-t border-emerald-900/50">
                            <span>Score Change:</span>
                            <strong className="text-emerald-300 text-sm font-extrabold flex items-center gap-1">
                              92 / 100
                              <span className="text-[10px] bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded font-extrabold ml-1">
                                +28 PTS
                              </span>
                            </strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-slate-200 leading-relaxed">
                    <p className="font-semibold text-cyan-300 mb-1 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      Executive Assessment Abstract:
                    </p>
                    {document.summary}
                  </div>
                </motion.div>
              )}

              {activePage === 1 && (
                <motion.div
                  key="page-1"
                  initial={{ opacity: 0, x: 25 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -25 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="space-y-3"
                >
                  <h4 className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-cyan-400" />
                    Audited Findings & Data Exposure Matrix:
                  </h4>

                  {(document.findings || []).map((f, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded.xl bg-slate-950/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2 shadow-md"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                              f.severity === 'High'
                                ? 'bg-rose-950 border-rose-500 text-rose-300'
                                : f.severity === 'Medium'
                                ? 'bg-amber-950 border-amber-500 text-amber-300'
                                : 'bg-emerald-950 border-emerald-500 text-emerald-300'
                            }`}
                          >
                            {f.severity} Severity
                          </span>
                          <span className="text-xs font-bold text-slate-200">{f.topic}</span>
                        </div>
                        <p className="text-xs text-slate-400">{f.detail}</p>
                      </div>
                      <span className="text-[11px] font-mono text-rose-400 bg-rose-950/60 px-2.5 py-1 rounded-lg border border-rose-900/60 whitespace-nowrap self-start md:self-center">
                        {f.status}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}

              {activePage === 2 && (
                <motion.div
                  key="page-2"
                  initial={{ opacity: 0, x: 25 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -25 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="space-y-4"
                >
                  <h4 className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Tenant Security & Copilot Enforcement Telemetry:
                  </h4>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {Object.entries(document.stats || {}).map(([k, v], idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 text-center shadow-md"
                      >
                        <div className="text-[10px] text-slate-400 font-mono truncate">{k}</div>
                        <div className="text-sm font-extrabold text-cyan-300 font-mono mt-1">{v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-mono text-emerald-300 uppercase block mb-0.5">
                        Remediation Guarantee:
                      </strong>
                      <p className="text-[11px] leading-relaxed text-slate-300">
                        Automated Purview labels prohibit Microsoft Copilot from displaying confidential HR compensation data or unhashed customer credentials in end-user natural language queries.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer Controls & Page Flip Buttons */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3 relative z-20">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  setActivePage((prev) => Math.max(0, prev - 1));
                }}
                disabled={activePage === 0}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Previous Page
              </button>
              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  setActivePage((prev) => Math.min(totalPages - 1, prev + 1));
                }}
                disabled={activePage === totalPages - 1}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Next Page
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Close Viewer
              </button>
              {onApplyRemediation && (
                <button
                  onClick={() => {
                    audioSynth.playSuccessChime();
                    onApplyRemediation();
                    onClose();
                  }}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold tracking-wider uppercase transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  Apply Remediation Policy
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
