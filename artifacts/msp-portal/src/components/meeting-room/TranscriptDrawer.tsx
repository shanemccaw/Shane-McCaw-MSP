import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatMessage, PersonaId } from '../types';
import { MessageSquare, X, Search, Download, CheckCheck, Smartphone, Send, Bookmark, Filter } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface TranscriptDrawerProps {
  messages: ChatMessage[];
  unreadCount?: number;
  onJumpToBeat?: (beatIndex: number) => void;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  messages,
  unreadCount = 0,
  onJumpToBeat,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPersona, setSelectedPersona] = useState<PersonaId | 'all'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages]);

  const filteredMessages = messages.filter((msg) => {
    const matchesSearch =
      msg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.speakerName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSpeaker = selectedPersona === 'all' || msg.speakerId === selectedPersona;
    return matchesSearch && matchesSpeaker;
  });

  const handleExport = () => {
    audioSynth.playSuccessChime();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'copilot_readiness_transcript.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <>
      {/* Collapsed Android Floating Chat Action Button in Bottom-Right */}
      <div className="fixed bottom-5 right-5 z-40">
        <motion.button
          onClick={() => {
            audioSynth.playHoverTick();
            setIsOpen(!isOpen);
          }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          className="relative p-4 rounded-2xl bg-gradient-to-r from-blue-600 via-cyan-600 to-teal-500 text-white shadow-[0_10px_30px_rgba(37,99,235,0.4)] border border-white/20 backdrop-blur-xl hover:shadow-[0_15px_40px_rgba(6,182,212,0.5)] transition-all flex items-center gap-2.5 group"
          title="Open Android Chat Messages"
        >
          <div className="relative">
            <Smartphone className="w-5 h-5 text-white group-hover:rotate-6 transition-transform" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-300 animate-ping" />
          </div>
          <span className="text-xs font-bold font-sans tracking-wide hidden sm:inline">
            ANDROID MESSAGES
          </span>
          {unreadCount > 0 && !isOpen && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-extrabold text-[10px] shadow-md border border-rose-200 animate-pulse">
              {unreadCount}
            </span>
          )}
        </motion.button>
      </div>

      {/* Sliding Android Messages Drawer */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
            />

            {/* Slide-out Android Chat Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="relative w-full max-w-md h-full bg-[#0e1626] border-l border-blue-500/30 p-4 backdrop-blur-2xl shadow-2xl flex flex-col justify-between"
            >
              {/* Android Top App Bar */}
              <div className="pb-3 border-b border-slate-800/80">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white font-bold shadow-md ring-2 ring-blue-400/30">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-100 tracking-tight font-sans">
                          Copilot Executive Group
                        </h3>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      </div>
                      <p className="text-[11px] text-slate-400 font-sans">
                        7 Members · Real-time Android Chat
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Android Search Input & Beat Bookmarks */}
                <div className="mt-3 space-y-2">
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 absolute left-3 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search messages..."
                      className="w-full bg-[#182234] border border-slate-700/80 focus:border-blue-400 rounded-full pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-400 focus:outline-none transition-all"
                    />
                  </div>

                  {/* Beat Bookmarks Pill Row */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] text-slate-300 custom-scrollbar">
                    <span className="text-[10px] font-mono text-cyan-400 font-bold flex items-center gap-1 flex-shrink-0">
                      <Bookmark className="w-3 h-3" /> Beats:
                    </span>
                    {[1, 2, 3, 4].map((b) => (
                      <button
                        key={b}
                        onClick={() => onJumpToBeat?.(b)}
                        className="px-2.5 py-0.5 rounded-full bg-[#1e293b] hover:bg-blue-600/80 border border-slate-700 hover:border-blue-400 text-slate-200 hover:text-white transition-all whitespace-nowrap text-[10px] font-medium"
                      >
                        Beat {b}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Android Text Message Thread List */}
              <div
                ref={scrollRef}
                className="flex-1 my-3 overflow-y-auto pr-1 space-y-3 custom-scrollbar flex flex-col"
              >
                {filteredMessages.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-400 font-sans">
                    No Android text entries match your search query.
                  </div>
                ) : (
                  filteredMessages.map((msg) => {
                    const isUser = msg.isUserMessage || msg.speakerId === 'user';

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[88%] ${
                          isUser ? 'self-end' : 'self-start'
                        }`}
                      >
                        {/* Speaker Header label for incoming messages */}
                        {!isUser && (
                          <span className="text-[10px] font-semibold text-cyan-300 ml-2 mb-1">
                            {msg.speakerName}
                          </span>
                        )}

                        {/* Android Style Rounded Chat Bubble */}
                        <div
                          className={`p-3.5 shadow-md text-xs leading-relaxed transition-all ${
                            isUser
                              ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-2xl rounded-tr-xs shadow-blue-900/30'
                              : 'bg-[#1a2538] border border-slate-700/60 text-slate-100 rounded-2xl rounded-tl-xs shadow-slate-950/40'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                        </div>

                        {/* Android Timestamp & Status Row */}
                        <div className={`flex items-center gap-1 text-[10px] text-slate-400 mt-1 ${isUser ? 'mr-1' : 'ml-2'}`}>
                          <span>{msg.timestamp || 'Just now'}</span>
                          {isUser && <CheckCheck className="w-3 h-3 text-cyan-300" title="Delivered via RCS" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Android Bottom Footer Bar */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-[10px] text-slate-400 font-mono">
                  {messages.length} SMS/RCS Messages
                </span>
                <button
                  onClick={handleExport}
                  className="px-3 py-1.5 rounded-full bg-blue-950 border border-blue-500/50 hover:bg-blue-900 text-blue-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Chat History</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

