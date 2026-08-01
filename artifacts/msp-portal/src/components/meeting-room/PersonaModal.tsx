import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Persona } from '../types';
import { X, Shield, Sparkles, MessageSquare, Send, CheckCircle2, Award, Target, HelpCircle } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface PersonaModalProps {
  persona: Persona | null;
  onClose: () => void;
  onAskQuestion: (questionText: string) => void;
}

export const PersonaModal: React.FC<PersonaModalProps> = ({
  persona,
  onClose,
  onAskQuestion,
}) => {
  if (!persona) return null;

  const handleAskDirect = (questionText: string) => {
    audioSynth.playSuccessChime();
    onAskQuestion(questionText);
    onClose();
  };

  const isSecurity = persona.id === 'kirk' || persona.id === 'beth';

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
          className="relative w-full max-w-xl max-h-[88vh] rounded-3xl bg-slate-900/95 border border-cyan-400/60 p-4 sm:p-6 backdrop-blur-2xl shadow-2xl ring-2 ring-cyan-500/30 overflow-y-auto custom-scrollbar text-slate-100 flex flex-col justify-between"
        >
          {/* Ambient Glow */}
          <div
            className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ backgroundColor: persona.glowHex }}
          />

          {/* Close Button */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onClose();
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors z-10"
            title="Close Persona Card"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header Section with Avatar */}
          <div className="flex items-start gap-4 pb-4 border-b border-white/10">
            <div className="relative flex-shrink-0">
              <div
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 shadow-2xl p-0.5 bg-slate-950"
                style={{ borderColor: persona.glowHex }}
              >
                <img
                  src={persona.avatarUrl}
                  alt={persona.name}
                  className="w-full h-full object-cover rounded-xl"
                />
              </div>
              {isSecurity && (
                <div className="absolute -bottom-2 -right-2 bg-rose-600 text-white p-1.5 rounded-full shadow-lg border border-rose-300">
                  <Shield className="w-4 h-4" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: persona.glowHex }}
                />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
                  {persona.department || 'Briefing Advisory Panel'}
                </span>
              </div>
              <h3 className="text-xl md:text-2xl font-extrabold text-white tracking-tight leading-tight">
                {persona.name}
              </h3>
              <p className="text-sm font-semibold text-cyan-400 mt-0.5">
                {persona.title || persona.role}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] font-mono text-slate-200">
                  {persona.role}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/50 text-[11px] font-mono text-cyan-300">
                  Active in Briefing
                </span>
              </div>
            </div>
          </div>

          {/* Body Information */}
          <div className="my-4 space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {/* Bio / Background */}
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-cyan-400" />
                Executive Background & Expertise
              </h4>
              <p className="text-xs md:text-sm text-slate-200 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-white/5">
                {persona.bio ||
                  `${persona.name} is a key stakeholder representing ${persona.role} leadership in this Microsoft 365 Copilot assessment briefing.`}
              </p>
            </div>

            {/* Key Priorities */}
            {persona.priorities && persona.priorities.length > 0 && (
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold mb-1.5 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  Key Focus Areas & Priorities
                </h4>
                <div className="space-y-1.5">
                  {persona.priorities.map((priority, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-slate-200 bg-slate-950/40 p-2 rounded-lg border border-white/5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{priority}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Direct Quote / Perspective */}
            {persona.keyQuote && (
              <div className="p-3 rounded-xl bg-gradient-to-r from-cyan-950/50 to-slate-950/80 border-l-4 border-cyan-400 text-xs text-cyan-100 italic">
                "{persona.keyQuote}"
              </div>
            )}
          </div>

          {/* Direct Question Action Buttons */}
          <div className="pt-3 border-t border-white/10 space-y-2">
            <p className="text-[11px] font-mono text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ask {persona.name.split(' ')[0]} a direct question in the briefing:</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() =>
                  handleAskDirect(
                    `@${persona.name.split(' ')[0]} What are your top concerns regarding our M365 Copilot rollout?`
                  )
                }
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-xs font-medium text-slate-100 hover:text-cyan-200 transition-all text-left flex items-center justify-between group"
              >
                <span>Ask about top concerns & risks</span>
                <Send className="w-3.5 h-3.5 text-cyan-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() =>
                  handleAskDirect(
                    `@${persona.name.split(' ')[0]} How can we partner with your team to accelerate remediation?`
                  )
                }
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-emerald-950 border border-slate-700 hover:border-emerald-400 text-xs font-medium text-slate-100 hover:text-emerald-200 transition-all text-left flex items-center justify-between group"
              >
                <span>Ask about team remediation steps</span>
                <Send className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
