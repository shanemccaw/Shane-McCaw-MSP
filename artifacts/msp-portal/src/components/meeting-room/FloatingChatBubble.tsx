import React from 'react';
import { motion } from 'motion/react';
import { ChatMessage, ContextAnchor, Persona } from '../types';
import { AlertTriangle, ShieldAlert, Users, Zap, FileText, ChevronRight, Play, Pause, SkipForward, Timer, CheckCheck, X } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface FloatingChatBubbleProps {
  message: ChatMessage;
  speakerHex?: string;
  speakerAvatarUrl?: string;
  speakerPosition?: Persona['position'];
  isUser?: boolean;
  onOpenAnchor?: (anchor: ContextAnchor) => void;
  onOpenDoc?: (docId: string) => void;
  positionStyle?: React.CSSProperties;
  timeRemaining?: number; // Seconds left (e.g. 7)
  totalDuration?: number; // Total seconds (e.g. 8)
  isPaused?: boolean;
  isModalOpen?: boolean;
  onNext?: () => void;
  onTogglePause?: () => void;
  onClose?: () => void;
}

export const FloatingChatBubble: React.FC<FloatingChatBubbleProps> = ({
  message,
  speakerHex = '#06b6d4',
  speakerAvatarUrl,
  speakerPosition = 'head',
  isUser = false,
  onOpenAnchor,
  onOpenDoc,
  positionStyle,
  timeRemaining = 8,
  totalDuration = 8,
  isPaused = false,
  isModalOpen = false,
  onNext,
  onTogglePause,
  onClose,
}) => {
  const progressPercent = Math.max(0, Math.min(100, (timeRemaining / totalDuration) * 100));
  const effectivelyPaused = isPaused || isModalOpen;

  // Bubble avoidance steering: adjust trajectory by 6–10 degrees during first 200ms of entrance
  const steerAngle = React.useMemo(() => {
    switch (speakerPosition) {
      case 'left-top':
      case 'left-center':
        return 8;
      case 'left-bottom':
        return 10;
      case 'right-top':
      case 'right-center':
        return -8;
      case 'right-bottom':
        return -10;
      case 'head':
        return -6;
      case 'bottom-center':
      default:
        return isUser ? 7 : -7;
    }
  }, [speakerPosition, isUser]);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'AlertTriangle':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
      case 'ShieldAlert':
        return <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />;
      case 'Users':
        return <Users className="w-3.5 h-3.5 text-purple-400" />;
      case 'Zap':
      default:
        return <Zap className="w-3.5 h-3.5 text-cyan-400" />;
    }
  };

  // Directional Speech Notch Tail calculation pointing directly at the speaker avatar
  const renderTail = () => {
    switch (speakerPosition) {
      case 'head':
        return (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-b-8 border-b-slate-900 filter drop-shadow-md" />
        );
      case 'left-top':
        return (
          <div className="absolute top-5 -left-2.5 w-0 h-0 border-y-8 border-y-transparent border-r-8 border-r-slate-900 filter drop-shadow-md" />
        );
      case 'left-bottom':
        return (
          <div className="absolute bottom-5 -left-2.5 w-0 h-0 border-y-8 border-y-transparent border-r-8 border-r-slate-900 filter drop-shadow-md" />
        );
      case 'right-top':
        return (
          <div className="absolute top-5 -right-2.5 w-0 h-0 border-y-8 border-y-transparent border-l-8 border-l-slate-900 filter drop-shadow-md" />
        );
      case 'right-bottom':
        return (
          <div className="absolute bottom-5 -right-2.5 w-0 h-0 border-y-8 border-y-transparent border-l-8 border-l-slate-900 filter drop-shadow-md" />
        );
      case 'bottom-center':
      default:
        return (
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-emerald-600 filter drop-shadow-md" />
        );
    }
  };

  return (
    <motion.div
      initial={{
        opacity: 0,
        scale: 0.92,
        y: isUser ? 22 : -12, // User chat bubbles animate upward toward the canvas
        rotate: steerAngle,
        filter: 'blur(4px)',
      }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        rotate: 0,
        filter: 'blur(0px)',
      }}
      exit={{
        opacity: 0,
        scale: 0.92,
        y: isUser ? 16 : -8,
        rotate: -steerAngle / 2,
        filter: 'blur(3px)',
      }}
      transition={{
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1],
        rotate: {
          duration: 0.20, // Steering only during first 200ms to avoid jitter
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      style={positionStyle}
      className="absolute z-30 w-[300px] sm:w-[360px] md:w-[420px] transform-gpu will-change-transform transition-all duration-300"
    >
      {/* Toned down Ambient Glow Aura (30% reduced intensity) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{
          opacity: isUser ? [0, 0.18, 0.08] : [0, 0.28, 0.12],
          scale: [0.8, 1.03, 1],
        }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -inset-2 rounded-[26px] blur-xl pointer-events-none transform-gpu"
        style={{
          background: isUser
            ? 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0) 70%)'
            : `radial-gradient(circle, ${speakerHex}22 0%, rgba(0,0,0,0) 70%)`,
        }}
      />

      <div
        className={`relative p-3.5 md:p-4 rounded-[22px] backdrop-blur-2xl shadow-2xl border transition-all duration-300 overflow-hidden ${
          isUser
            ? 'bg-gradient-to-br from-emerald-600/90 via-teal-700/90 to-cyan-800/90 border-emerald-400/60 text-white shadow-emerald-950/60 rounded-br-[4px]'
            : 'bg-slate-900/95 border-cyan-500/40 text-slate-100 shadow-[0_10px_40px_rgba(0,0,0,0.8)] rounded-bl-[4px] ring-1 ring-cyan-500/30'
        }`}
      >
        {/* Holographic Materialization Light Trail Shimmer Sweep (Soft gradient, no brightness spike) */}
        <motion.div
          initial={{ x: '-100%', opacity: 0.6 }}
          animate={{ x: '200%', opacity: 0 }}
          transition={{ duration: 0.65, ease: 'easeInOut', delay: 0.05 }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-300/25 via-emerald-200/30 to-transparent pointer-events-none z-20"
        />

        {/* Subtle Holographic Scanline Grid Effect */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(6,182,212,0.06)_50%)] bg-[length:100%_4px] pointer-events-none z-10 opacity-70" />

        {/* iPhone Tail / Speech Pointer */}
        {renderTail()}

        {/* 1. Top iMessage Style Timer Bar */}
        <div className="relative w-full h-1 bg-black/40 rounded-full overflow-hidden mb-2.5">
          <motion.div
            className={`h-full transition-all duration-200 ${
              effectivelyPaused
                ? 'bg-amber-400'
                : isUser
                ? 'bg-emerald-200'
                : 'bg-gradient-to-r from-cyan-400 to-purple-400'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* 2. iPhone iMessage Header with Avatar, Speaker Name & Controls */}
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-white/15">
          <div className="flex items-center gap-2">
            {speakerAvatarUrl ? (
              <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/40 shadow-md flex-shrink-0">
                <img src={speakerAvatarUrl} alt={message.speakerName} className="w-full h-full object-cover" />
              </div>
            ) : (
              <span
                className="w-3 h-3 rounded-full animate-pulse flex-shrink-0"
                style={{ backgroundColor: speakerHex }}
              />
            )}
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold tracking-tight text-white leading-tight">
                  {message.speakerName}
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-white/15 text-white/90 font-mono">
                  {isUser ? 'Enterprise Lead' : 'iMessage'}
                </span>
              </div>
            </div>
          </div>

          {/* iOS Style Timer & Controls */}
          <div className="flex items-center gap-1 font-mono text-[10px]">
            {effectivelyPaused ? (
              <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-400/60 text-amber-300 font-bold flex items-center gap-1">
                <Pause className="w-2.5 h-2.5" />
                <span>PAUSED</span>
              </span>
            ) : (
              <span className="text-cyan-300 font-bold flex items-center gap-1 bg-black/30 px-2 py-0.5 rounded-full">
                <Timer className="w-2.5 h-2.5 text-cyan-400" />
                <span>{Math.ceil(timeRemaining)}s</span>
              </span>
            )}

            {/* Pause/Play */}
            {onTogglePause && (
              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  onTogglePause();
                }}
                className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title={effectivelyPaused ? 'Resume' : 'Pause'}
              >
                {effectivelyPaused ? <Play className="w-2.5 h-2.5 text-emerald-300" /> : <Pause className="w-2.5 h-2.5 text-amber-200" />}
              </button>
            )}

            {/* Next Speech */}
            {onNext && (
              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  onNext();
                }}
                className="px-2 py-0.5 rounded-full bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-extrabold text-[9px] tracking-wider uppercase transition-all flex items-center gap-1 active:scale-95 shadow-sm"
                title="Next message"
              >
                <span>NEXT</span>
                <SkipForward className="w-2.5 h-2.5" />
              </button>
            )}

            {/* Close Speaking Dialog */}
            {onClose && (
              <button
                onClick={() => {
                  audioSynth.playHoverTick();
                  onClose();
                }}
                className="p-1 rounded-full bg-white/10 hover:bg-rose-500/80 hover:text-white text-slate-300 transition-colors ml-0.5"
                title="Dismiss dialog"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* 3. Message Body */}
        <div className="text-xs md:text-sm leading-relaxed font-normal text-white">
          {message.text}
        </div>

        {/* 4. Document Reference Attachment Pill */}
        {message.docId && (
          <div className="mt-2.5 pt-2 border-t border-white/15">
            <button
              onClick={() => {
                audioSynth.playCardSwoosh();
                onOpenDoc?.(message.docId!);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-black/30 hover:bg-black/50 border border-white/20 text-white text-xs font-medium transition-all group"
            >
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
                <span className="truncate">View Attached Audit Report</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-white/70 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}

        {/* 5. Contextual Action Anchors */}
        {message.anchors && message.anchors.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-white/15 flex flex-wrap gap-1.5">
            {message.anchors.map((anchor) => (
              <motion.button
                key={anchor.id}
                onClick={() => {
                  audioSynth.playHoverTick();
                  onOpenAnchor?.(anchor);
                }}
                whileHover={{ scale: 1.06, y: -1 }}
                whileTap={{ scale: 0.95 }}
                className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-cyan-400/40 hover:border-cyan-300 text-[11px] font-medium text-cyan-200 transition-all group overflow-hidden shadow-[0_0_10px_rgba(6,182,212,0.15)] hover:shadow-[0_0_18px_rgba(6,182,212,0.45)] cursor-pointer"
                title={anchor.description}
              >
                {/* Shimmering Hover Background Sweep */}
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent pointer-events-none"
                />

                <span className="relative z-10 w-1.5 h-1.5 rounded-full bg-cyan-400 group-hover:bg-emerald-400 transition-colors shadow-sm" />
                <span className="relative z-10 text-cyan-300 group-hover:text-cyan-100 group-hover:rotate-12 group-hover:scale-110 transition-transform duration-200">
                  {getIcon(anchor.iconName)}
                </span>
                <span className="relative z-10 font-semibold tracking-wide text-white group-hover:text-cyan-100">
                  {anchor.label}
                </span>
                <ChevronRight className="relative z-10 w-3 h-3 text-cyan-400/70 group-hover:text-cyan-200 group-hover:translate-x-0.5 transition-all" />
              </motion.button>
            ))}
          </div>
        )}

        {/* 6. iOS Delivered Timestamp Footer */}
        <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-white/70 font-mono">
          <span>{message.timestamp || 'Delivered'}</span>
          <CheckCheck className="w-3 h-3 text-cyan-300" />
        </div>
      </div>
    </motion.div>
  );
};
