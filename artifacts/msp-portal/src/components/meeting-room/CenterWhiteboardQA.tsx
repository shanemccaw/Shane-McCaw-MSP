import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatMessage, Persona } from '../types';
import {
  MessageSquare,
  Sparkles,
  Send,
  X,
  HelpCircle,
  UserCheck,
  Bot,
  ShieldCheck,
  ArrowRight,
  ChevronRight,
  Radio,
} from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface CenterWhiteboardQAProps {
  lastUserMessage: ChatMessage | null;
  latestAiResponse: ChatMessage | null;
  interjectionMessage?: ChatMessage | null;
  isLoadingAi: boolean;
  personas: Persona[];
  onSendMessage: (text: string) => void;
  onClose: () => void;
}

export const CenterWhiteboardQA: React.FC<CenterWhiteboardQAProps> = ({
  lastUserMessage,
  latestAiResponse,
  interjectionMessage,
  isLoadingAi,
  personas,
  onSendMessage,
  onClose,
}) => {
  const [followUpText, setFollowUpText] = useState('');

  if (!lastUserMessage) return null;

  // Find responding persona metadata
  const respondingPersona = personas.find(
    (p) => p.id === latestAiResponse?.speakerId || (p.id === 'shane' && !latestAiResponse)
  ) || personas.find((p) => p.id === 'shane')!;

  const interjectionPersona = interjectionMessage
    ? personas.find((p) => p.id === interjectionMessage.speakerId)
    : null;

  const handleSendFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpText.trim()) return;
    audioSynth.playCardSwoosh();
    onSendMessage(followUpText.trim());
    setFollowUpText('');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-30 w-full max-w-2xl mx-auto rounded-3xl bg-gradient-to-b from-slate-950/95 via-slate-900/95 to-slate-950/98 border border-cyan-400/60 shadow-[0_0_50px_rgba(6,182,212,0.25)] backdrop-blur-3xl p-4 sm:p-6 overflow-hidden my-auto transform-gpu will-change-transform"
      >
        {/* Softened Specular Glow Edge Sweep (12s sweep cycle) */}
        <motion.div
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/12 via-emerald-400/10 to-transparent pointer-events-none z-0 transform-gpu"
        />

        {/* Ambient Scanline Grid Texture */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(6,182,212,0.03)_50%)] bg-[length:100%_4px] pointer-events-none z-0" />

        {/* Header Bar */}
        <div className="relative z-10 flex items-center justify-between pb-3 mb-3 border-b border-cyan-500/30">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-2xl bg-cyan-950 border border-cyan-500/60 text-cyan-400 shadow-md flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 animate-spin-slow" />
              <Radio className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold font-mono text-cyan-200 uppercase tracking-wider">
                  WHITEBOARD HUMAN QUESTION & DIRECT ANSWER
                </span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/50 text-[9px] font-mono font-bold uppercase">
                  Briefing Room Live
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Direct response from Shane & Expert Advisory Panel</p>
            </div>
          </div>

          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onClose();
            }}
            className="p-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer border border-slate-700"
            title="Minimize Center Q&A to view underlying Whiteboard Nodes"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Content Scroll Container */}
        <div className="relative z-10 max-h-[360px] sm:max-h-[420px] overflow-y-auto custom-scrollbar pr-1 space-y-3">
          {/* 1. Human Question Card */}
          <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/40 shadow-inner">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-full overflow-hidden border border-emerald-400 shadow-md">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80"
                  alt="You"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider">
                {lastUserMessage.speakerName || 'You (Enterprise Lead)'} Asked:
              </span>
              <span className="text-[10px] text-slate-500 ml-auto font-mono">{lastUserMessage.timestamp}</span>
            </div>
            <p className="text-sm font-semibold text-slate-100 leading-relaxed pl-1 italic border-l-2 border-emerald-400">
              "{lastUserMessage.text}"
            </p>
          </div>

          {/* 2. Direct Answer Card */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-purple-500/40 shadow-lg relative overflow-hidden">
            {/* Loading AI State */}
            {isLoadingAi ? (
              <div className="py-4 flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="p-2 rounded-full bg-cyan-950 border border-cyan-400 text-cyan-300"
                  >
                    <Sparkles className="w-5 h-5" />
                  </motion.div>
                  <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider">
                    {respondingPersona.name} & Advisory Panel Synthesizing Direct Answer...
                  </span>
                </div>

                {/* Animated Equalizer Waveforms */}
                <div className="flex items-center justify-center gap-1 my-1">
                  {[12, 28, 18, 36, 24, 16, 32, 20].map((h, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [6, h, 6] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' }}
                      className="w-1 bg-cyan-400 rounded-full"
                    />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  Grounding against tenant Purview security graph & DLP policies...
                </p>
              </div>
            ) : latestAiResponse ? (
              <div className="space-y-2">
                {/* Responding Persona Badge */}
                <div className="flex items-center gap-2.5 pb-2 border-b border-white/10">
                  <div
                    className="w-9 h-9 rounded-full overflow-hidden border-2 shadow-lg"
                    style={{ borderColor: respondingPersona.glowHex }}
                  >
                    <img
                      src={respondingPersona.avatarUrl}
                      alt={respondingPersona.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-white">{respondingPersona.name}</span>
                      <span
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider"
                        style={{
                          backgroundColor: `${respondingPersona.glowHex}20`,
                          borderColor: respondingPersona.glowHex,
                          color: respondingPersona.glowHex,
                        }}
                      >
                        {respondingPersona.role}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">{respondingPersona.title}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 ml-auto font-mono">{latestAiResponse.timestamp}</span>
                </div>

                {/* Responding Persona Direct Answer Text */}
                <div className="text-xs sm:text-sm text-slate-200 leading-relaxed font-sans pt-1">
                  {latestAiResponse.text}
                </div>

                {/* Secondary Persona Interjection if available */}
                {interjectionMessage && interjectionPersona && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-100 flex items-start gap-2.5 shadow-inner"
                  >
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-rose-400 flex-shrink-0 mt-0.5">
                      <img src={interjectionPersona.avatarUrl} alt={interjectionPersona.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="text-xs">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-extrabold text-rose-200">{interjectionPersona.name}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-900/80 text-rose-300 font-bold uppercase">
                          {interjectionPersona.role}
                        </span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">{interjectionMessage.text}</p>
                    </div>
                  </motion.div>
                )}
              </div>
            ) : null}
          </div>

          {/* Quick Follow-up Suggestions */}
          {!isLoadingAi && (
            <div className="pt-1">
              <span className="text-[10px] font-mono font-bold text-cyan-300 uppercase tracking-wider block mb-1.5">
                Quick Follow-up Questions for the Room:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  `Ask Shane: What is the estimated budget to fix this?`,
                  `Ask Kirk: Which executive compensation files are exposed?`,
                  `Ask Beth: What is our legal compliance liability?`,
                ].map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      audioSynth.playCardSwoosh();
                      onSendMessage(prompt);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500/60 text-slate-300 hover:text-cyan-200 text-[10px] font-mono font-semibold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronRight className="w-3 h-3 text-cyan-400" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Direct Follow-up Input Bar inside Center Q&A Stage */}
        <form onSubmit={handleSendFollowUp} className="relative z-10 mt-3 pt-3 border-t border-slate-800 flex items-center gap-2">
          <input
            type="text"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="Ask a direct follow-up question on the whiteboard..."
            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 text-xs text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={!followUpText.trim() || isLoadingAi}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition-all flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <span>Ask Room</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </motion.div>
    </AnimatePresence>
  );
};
