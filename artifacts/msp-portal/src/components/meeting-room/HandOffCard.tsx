import React, { useState } from 'react';
import { motion } from 'motion/react';
import { HandOffCardData } from '../types';
import { Sparkles, MessageSquare, Send, CheckCircle2, AlertTriangle, ShieldAlert, ChevronRight, HelpCircle, X } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface HandOffCardProps {
  card: HandOffCardData;
  onDiscuss: (promptText: string, cardId: string) => void;
  onDismiss?: (cardId: string) => void;
}

export const HandOffCard: React.FC<HandOffCardProps> = ({ card, onDiscuss, onDismiss }) => {
  const [customInput, setCustomInput] = useState('');
  const [isClicked, setIsClicked] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const handlePromptClick = (text: string) => {
    setIsClicked(true);
    audioSynth.playSuccessChime();
    setTimeout(() => setIsClicked(false), 800);
    onDiscuss(text, card.id);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    setIsClicked(true);
    audioSynth.playSuccessChime();
    setTimeout(() => setIsClicked(false), 800);
    onDiscuss(customInput, card.id);
    setCustomInput('');
  };

  const isDiscussing = card.status === 'discussing';

  if (isMinimized) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => {
          audioSynth.playHoverTick();
          setIsMinimized(false);
        }}
        className="px-4 py-2 rounded-full bg-slate-900/95 border-2 border-cyan-400 text-cyan-200 text-xs font-mono font-bold shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center gap-2 backdrop-blur-xl cursor-pointer hover:bg-slate-800 transition-all z-30"
      >
        <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
        <span>Topic Card: {card.title} [EXPAND]</span>
      </motion.button>
    );
  }

  return (
    <div className="relative group/card-wrapper w-full">
      {/* Soft Holographic Light Trail Floating Across Conference Table */}
      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: [0.3, 0.7, 0.4], scaleY: [0.8, 1.2, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-28 bg-gradient-to-b from-transparent via-cyan-500/25 to-cyan-400/40 blur-xl pointer-events-none rounded-t-full z-0"
      />
      <motion.div
        animate={{ y: [-15, 5, -15], opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-16 left-1/4 w-1 h-20 bg-cyan-400/50 blur-sm pointer-events-none z-0"
      />
      <motion.div
        animate={{ y: [-12, 8, -12], opacity: [0.2, 0.5, 0.2] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        className="absolute -top-16 right-1/4 w-1 h-20 bg-purple-400/40 blur-sm pointer-events-none z-0"
      />

      {/* Main Holographic Card Component */}
      <motion.div
        initial={{ opacity: 0, y: -40, scale: 0.92 }}
        animate={{
          opacity: 1,
          y: isClicked ? [0, -3, 1, 0] : [0, -4, 0],
          scale: isClicked ? [1, 1.02, 0.99, 1] : 1,
        }}
        exit={{ opacity: 0, scale: 0.92, y: 15 }}
        whileHover={{
          y: -6,
          scale: 1.015,
          boxShadow: '0 15px 45px rgba(6,182,212,0.35), 0 0 20px rgba(6,182,212,0.25)',
        }}
        whileTap={{ scale: 0.98 }}
        transition={{
          y: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        }}
        className={`relative w-full max-w-lg rounded-3xl p-4 md:p-5 backdrop-blur-2xl border transition-all duration-300 overflow-hidden cursor-pointer transform-gpu will-change-transform ${
          isDiscussing
            ? 'bg-slate-900/95 border-emerald-400/70 shadow-[0_15px_45px_rgba(16,185,129,0.25)] ring-1 ring-emerald-400/40'
            : 'bg-slate-900/95 border-cyan-400/60 shadow-[0_15px_45px_rgba(6,182,212,0.25)] ring-1 ring-cyan-500/30'
        }`}
      >
        {/* Click Reaction Burst Effect */}
        {isClicked && (
          <motion.div
            initial={{ opacity: 0.7, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute inset-0 bg-gradient-to-r from-cyan-400/35 via-emerald-400/30 to-purple-500/35 rounded-3xl pointer-events-none z-20 blur-md transform-gpu"
          />
        )}

        {/* Background Holographic Layered Glow Aura (Softened 25%) */}
        <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-cyan-500/18 via-purple-500/15 to-emerald-500/18 blur-xl pointer-events-none opacity-60" />

        {/* Shimmering Holographic Edge Light Sweep (Softened 10s cycle) */}
        <motion.div
          animate={{
            x: ['-100%', '200%'],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent pointer-events-none z-10"
        />

        {/* Refractive Specular Glass Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-cyan-500/10 pointer-events-none rounded-3xl z-10" />

        {/* Subtle Scanline Texture */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(6,182,212,0.04)_50%)] bg-[length:100%_4px] pointer-events-none z-10" />

        {/* Header Tag, Minimize & Dismiss */}
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-white/10 relative z-20">
          <div className="flex items-center gap-1.5 text-xs font-bold font-mono uppercase tracking-wider text-cyan-300 truncate">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin-slow flex-shrink-0" />
            <span className="truncate">CONVERSATIONAL TOPIC CARD</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider ${
                isDiscussing
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60 animate-pulse'
                  : 'bg-cyan-950 text-cyan-300 border-cyan-500/60'
              }`}
            >
              {isDiscussing ? 'ACTIVE' : 'ENGAGE'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                audioSynth.playHoverTick();
                setIsMinimized(true);
              }}
              className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-mono font-bold transition-colors cursor-pointer"
              title="Minimize card to view whiteboard"
            >
              MINIMIZE
            </button>
            {onDismiss && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(card.id);
                }}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Dismiss Card"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Card Body Container */}
        <div className="max-h-[240px] md:max-h-[280px] overflow-y-auto custom-scrollbar pr-1 relative z-20 space-y-2">

        {/* Main Question Heading */}
        <div className="flex items-start gap-2 mb-2 relative z-20">
          <HelpCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm md:text-base font-extrabold text-white tracking-wide leading-snug">
              {card.question}
            </h4>
          </div>
        </div>

        {/* Real Enterprise Scenario Highlight Box */}
        <div className="my-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-100 text-xs leading-relaxed flex items-start gap-2 shadow-inner relative z-20">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-300 block font-semibold mb-0.5">Real Enterprise Scenario:</strong>
            <span>{card.scenarioContext}</span>
          </div>
        </div>

        {/* Suggested Customer Prompts to Engage Room */}
        <div className="space-y-1.5 my-3 relative z-20">
          <p className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1">
            <MessageSquare className="w-3 h-3 text-cyan-400" />
            <span>Click to ask the briefing room on this topic:</span>
          </p>
          {(card.suggestedPrompts || []).map((prompt) => (
            <motion.button
              key={prompt.id}
              whileHover={{ scale: 1.01, x: 2 }}
              whileTap={{ scale: 0.97 }}
              onClick={(e) => {
                e.stopPropagation();
                handlePromptClick(prompt.messageText);
              }}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/90 hover:bg-cyan-950/80 border border-slate-700 hover:border-cyan-400 text-xs font-medium text-slate-100 hover:text-cyan-200 transition-all flex items-center justify-between group shadow-md"
            >
              <span className="leading-snug pr-2">{prompt.label}</span>
              <ChevronRight className="w-4 h-4 text-cyan-400 opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all flex-shrink-0" />
            </motion.button>
          ))}
        </div>

        {/* Custom Discussion Input Form */}
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            handleCustomSubmit(e);
          }}
          className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-2 relative z-20"
        >
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Or ask your own question on this topic..."
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all flex items-center gap-1.5 shadow-lg active:scale-95"
          >
            <span>DISCUSS</span>
            <Send className="w-3.5 h-3.5" />
          </motion.button>
        </form>
        </div>
      </motion.div>
    </div>
  );
};
