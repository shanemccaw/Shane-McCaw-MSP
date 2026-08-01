import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Send, Mic, Sparkles, X, ChevronUp, Bot } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface HumanInputBarProps {
  onSendMessage: (text: string) => void;
  isAddressed?: boolean;
  isLoading?: boolean;
  onOpenInputBar?: () => void;
}

const PRESET_QUICK_QUESTIONS = [
  "Pause Briefing: Explain the Purview DLP gap findings in detail.",
  "Interject: How do we enforce Purview Auto-Labeling across SharePoint?",
  "Hold on: What is our immediate mitigation for Teams sprawl risks?",
  "Redirect: What is our projected ROI for 1,500 Copilot seats?",
];

export const HumanInputBar: React.FC<HumanInputBarProps> = ({
  onSendMessage,
  isAddressed = false,
  isLoading = false,
  onOpenInputBar,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const handleOpenBar = () => {
    audioSynth.playHoverTick();
    setIsOpen(true);
    onOpenInputBar?.();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isLoading) return;
    audioSynth.playCardSwoosh();
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleQuickQuestion = (q: string) => {
    audioSynth.playCardSwoosh();
    onSendMessage(q);
    setIsOpen(false);
  };

  const toggleMic = () => {
    audioSynth.playHoverTick();
    setIsRecording(!isRecording);
    if (!isRecording) {
      setTimeout(() => {
        setInputText("How do we ensure sensitivity labels protect executive files during Copilot indexing?");
        setIsRecording(false);
      }, 2000);
    }
  };

  return (
    <div className="relative z-40 flex flex-col items-center">
      {/* Closed State Floating Speak Button */}
      {!isOpen && (
        <motion.button
          onClick={handleOpenBar}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className={`relative px-6 py-3 rounded-full backdrop-blur-2xl border font-extrabold text-xs tracking-wider uppercase flex items-center gap-3 shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all duration-300 ${
            isAddressed
              ? 'bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 text-slate-950 border-emerald-300 ring-4 ring-emerald-400/50 animate-bounce'
              : 'bg-gradient-to-r from-emerald-950/90 via-slate-900/90 to-cyan-950/90 hover:from-emerald-900 hover:to-cyan-900 text-emerald-300 border-emerald-400/70 hover:border-emerald-300 ring-2 ring-emerald-500/20'
          }`}
        >
          {/* Animated Pulsing Ring Effect */}
          <span className="absolute -inset-1 rounded-full bg-emerald-500/20 animate-ping pointer-events-none" />

          <div className="relative flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
          </div>
          <span className="text-white font-extrabold drop-shadow">
            PARTICIPATE IN BRIEFING
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-widest shadow-sm">
            SPEAK
          </span>
          <ChevronUp className="w-4 h-4 text-emerald-400" />
        </motion.button>
      )}

      {/* Expanded Interactive Input Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="w-full max-w-xl rounded-2xl bg-slate-950/95 border border-emerald-500/60 p-4 backdrop-blur-2xl shadow-2xl ring-2 ring-emerald-500/20"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400">
                <Bot className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>HUMAN USER INPUT & DIRECT QUESTION ANCHOR</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Prompt Chips */}
            <div className="mb-3">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block mb-1.5">
                Suggested Direct Questions:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_QUICK_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickQuestion(q)}
                    className="text-[11px] text-slate-300 bg-slate-900 hover:bg-emerald-950 hover:text-emerald-300 border border-slate-800 hover:border-emerald-500/50 px-2.5 py-1 rounded-full transition-all text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask Shane, Kirk, or Jane a question..."
                className="flex-1 bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />

              {/* Simulated Voice Mic Button */}
              <button
                type="button"
                onClick={toggleMic}
                className={`p-2.5 rounded-xl border transition-all ${
                  isRecording
                    ? 'bg-rose-950 border-rose-500 text-rose-300 animate-pulse'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500'
                }`}
                title="Voice Input Simulator"
              >
                <Mic className="w-4 h-4" />
              </button>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                {isLoading ? (
                  <Sparkles className="w-4 h-4 animate-spin text-slate-950" />
                ) : (
                  <>
                    <span>SEND</span>
                    <Send className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
