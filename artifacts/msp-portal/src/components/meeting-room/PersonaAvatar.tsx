import React from 'react';
import { motion } from 'motion/react';
import { Persona } from '../types';
import { Shield, Sparkles, User, AlertCircle } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface PersonaAvatarProps {
  persona: Persona;
  isSpeaking: boolean;
  isAddressed: boolean;
  onClick?: () => void;
  stylePosition?: React.CSSProperties;
  isBouncing?: boolean;
  isInteractingHandOff?: boolean;
  isTensionMode?: boolean;
  isClosingMode?: boolean;
}

export const PersonaAvatar: React.FC<PersonaAvatarProps> = ({
  persona,
  isSpeaking,
  isAddressed,
  onClick,
  stylePosition,
  isBouncing = false,
  isInteractingHandOff = false,
  isTensionMode = false,
  isClosingMode = false,
}) => {
  const isUser = persona.id === 'user';
  const isShane = persona.id === 'shane';
  const isSecurity = persona.id === 'kirk' || persona.id === 'beth';

  return (
    <motion.div
      initial={{ opacity: 0, x: isSecurity ? 50 : 0, y: isSecurity ? 0 : 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: isSecurity ? 50 : 0, y: isSecurity ? 0 : -10 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={stylePosition}
      className="absolute flex flex-col items-center justify-center z-20 group cursor-pointer select-none transform-gpu will-change-transform"
      onClick={() => {
        audioSynth.playHoverTick();
        onClick?.();
      }}
    >
      {/* Soft Holographic Materialization Entrance Ripple Rings on Join */}
      <motion.div
        initial={{ scale: 0.2, opacity: 0.5 }}
        animate={{ scale: [0.2, 2.2], opacity: [0.5, 0] }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        className={`absolute -inset-6 rounded-full border-2 pointer-events-none blur-sm ${
          isSecurity ? 'border-rose-400/50 bg-rose-500/10' : 'border-cyan-400/50 bg-cyan-400/10'
        }`}
      />
      <motion.div
        initial={{ scale: 0.1, opacity: 0.4 }}
        animate={{ scale: [0.1, 1.8], opacity: [0.4, 0] }}
        transition={{ duration: 1.0, ease: 'easeOut', delay: 0.15 }}
        className="absolute -inset-4 rounded-full border border-purple-400/40 pointer-events-none blur-[1px]"
      />
      {/* Floating Avatar Container with Controlled Docking State */}
      <motion.div
        animate={
          isBouncing
            ? {
                y: [0, -8, 0],
                scale: [1, 1.05, 1],
              }
            : {
                y: 0, // Hard docking constraint: no vertical drift or floating motion
                scale: isSpeaking ? 1.03 : isAddressed || isInteractingHandOff ? 1.02 : 1,
              }
        }
        transition={
          isBouncing
            ? { duration: 0.5, ease: 'easeOut' }
            : {
                y: { duration: 0 },
                scale: { duration: 0.25, ease: 'easeOut' },
              }
        }
        className="relative flex items-center justify-center"
      >
        {/* Outer Subtle Breathing Glow Halo Ring (30% toned down glow & noise across all personas, zero pulse spikes) */}
        <motion.div
          animate={{
            scale: isShane
              ? isClosingMode ? [1.04, 1.08, 1.04] : [1.02, 1.06, 1.02]
              : isSecurity && isTensionMode
              ? [1.02, 1.06, 1.02]
              : isSpeaking
              ? [1.05, 1.10, 1.05]
              : [0.98, 1.02, 0.98],
            opacity: isShane
              ? [0.25, 0.38, 0.25] // 30% reduced glow for Shane
              : isSecurity && isTensionMode
              ? [0.22, 0.35, 0.22] // Colder, restrained security glow
              : isSpeaking
              ? [0.35, 0.45, 0.35]
              : isUser
              ? [0.05, 0.12, 0.05] // Minimal glow for User, no pulse spikes
              : [0.05, 0.12, 0.05],
          }}
          transition={{
            duration: isSecurity ? 5.2 : 4.5, // Slower pulse cycles for security/conditional personas
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="absolute -inset-3 rounded-full blur-md transition-all duration-300 pointer-events-none"
          style={{
            background: isShane && isClosingMode
              ? 'radial-gradient(circle, rgba(6, 182, 212, 0.35) 0%, rgba(245, 158, 11, 0.15) 60%, transparent 80%)'
              : isShane
              ? 'radial-gradient(circle, rgba(6, 182, 212, 0.3) 0%, rgba(14, 165, 233, 0.1) 60%, transparent 80%)'
              : isSecurity && isTensionMode
              ? 'radial-gradient(circle, rgba(225, 29, 72, 0.25) 0%, rgba(15, 23, 42, 0.2) 70%)'
              : isSecurity
              ? 'radial-gradient(circle, rgba(14, 116, 144, 0.2) 0%, rgba(15, 23, 42, 0) 70%)' // Cold slate/cyan palette for Kirk/Beth
              : isUser
              ? 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.05) 60%, transparent 80%)'
              : `radial-gradient(circle, ${persona.glowHex}44 0%, transparent 70%)`,
          }}
        />

        {/* Soft Controlled Security Tension Pulse Ring (30% reduced pulse, 5.2s slow cycle) */}
        {isSecurity && isTensionMode && (
          <>
            <motion.div
              animate={{ scale: [1, 1.04, 1], opacity: [0.15, 0.3, 0.15] }}
              transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -inset-2 rounded-full border border-rose-500/40 bg-slate-900/40 pointer-events-none"
            />
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-500 text-slate-200 flex items-center justify-center text-[9px] font-bold shadow-md z-30"
            >
              <AlertCircle className="w-2.5 h-2.5 text-rose-300" />
            </motion.div>
          </>
        )}

        {/* Soft Hand-Off Interaction Highlight Aura for User */}
        {isInteractingHandOff && isUser && (
          <motion.div
            animate={{ scale: [1, 1.06, 1], opacity: [0.2, 0.3, 0.2] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -inset-2 rounded-full border border-emerald-400/40 bg-emerald-500/5 pointer-events-none blur-[1px]"
          />
        )}

        {/* Soft Presence Ring Pulse */}
        <motion.div
          animate={{
            scale: isShane
              ? [1, 1.06, 1]
              : isSpeaking
              ? [1, 1.15, 1]
              : isAddressed
              ? [1, 1.1, 1]
              : [1, 1.02, 1],
            opacity: isShane
              ? [0.4, 0.6, 0.4]
              : isSpeaking
              ? [0.5, 0.7, 0.5]
              : isAddressed
              ? [0.4, 0.65, 0.4]
              : [0.05, 0.15, 0.05],
          }}
          transition={{
            duration: isSecurity ? 5.2 : 4.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="absolute -inset-1 rounded-full border pointer-events-none"
          style={{
            borderColor: isShane ? '#22d3ee' : isUser ? 'rgba(16, 185, 129, 0.35)' : persona.glowHex,
          }}
        />

        {/* Animated Rotating Border Beacon for Speaking Persona */}
        {isSpeaking && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            className="absolute -inset-2.5 rounded-full p-[2px] bg-conic-gradient from-cyan-400 via-purple-500 to-emerald-400 opacity-90 blur-[1px]"
          />
        )}

        {/* Addressed Pulse Rings */}
        {isAddressed && !isSpeaking && (
          <motion.div
            animate={{ scale: [1, 1.4], opacity: [0.8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border-2 border-emerald-400"
          />
        )}

        {/* Avatar Circle Frame */}
        <div
          className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full p-[2px] backdrop-blur-md bg-slate-900/80 border-2 transition-all duration-300 shadow-xl overflow-hidden ${
            isSpeaking
              ? 'border-cyan-300 shadow-cyan-500/50 ring-4 ring-cyan-500/30'
              : isSecurity
              ? 'border-rose-500/80 shadow-rose-900/50'
              : isShane
              ? 'border-cyan-400/80 shadow-cyan-900/50'
              : isUser
              ? 'border-emerald-500/50 shadow-emerald-950/30'
              : 'border-slate-700 hover:border-slate-400'
          }`}
        >
          {/* Avatar Image with Micro Head Tilt & Breathing */}
          <motion.img
            src={persona.avatarUrl}
            alt={persona.name}
            animate={{
              rotate: isSpeaking ? [0, 2.5, -2.5, 0] : [0, 1.2, -1.2, 0],
              scale: [1, 1.03, 1],
            }}
            transition={{
              rotate: {
                duration: (persona.idlePulseDuration || 2) * 2.2,
                repeat: Infinity,
                ease: 'easeInOut',
              },
              scale: {
                duration: (persona.idlePulseDuration || 2) * 1.8,
                repeat: Infinity,
                ease: 'easeInOut',
              },
            }}
            className="w-full h-full object-cover rounded-full filter contrast-102"
            loading="lazy"
          />

          {/* Holographic Scanline Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/10 to-transparent pointer-events-none animate-scanline" />

          {/* Active Speaking Beacon Icon */}
          {isSpeaking && (
            <div className="absolute bottom-1 right-1 bg-cyan-500 text-slate-950 p-1 rounded-full shadow-lg animate-pulse">
              <Sparkles className="w-3 h-3" />
            </div>
          )}
        </div>

        {/* Status Indicator Tag */}
        {isSecurity && (
          <div className="absolute -top-1 -right-1 bg-rose-600 text-white p-1 rounded-full text-[10px] shadow-md border border-rose-300 animate-pulse" title="Security Advisor Active">
            <Shield className="w-3 h-3" />
          </div>
        )}
      </motion.div>

      {/* Persona Label & Role Badge */}
      <motion.div
        animate={{ y: isSpeaking ? -2 : 0 }}
        className="mt-2 flex flex-col items-center text-center"
      >
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900/80 border border-slate-700/80 backdrop-blur-md shadow-lg group-hover:border-slate-500 transition-colors">
          <motion.span
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.7, 1, 0.7],
              boxShadow: [
                `0 0 0px ${persona.glowHex}`,
                `0 0 8px ${persona.glowHex}`,
                `0 0 0px ${persona.glowHex}`,
              ],
            }}
            transition={{
              duration: (persona.idlePulseDuration || 2) * 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: persona.glowHex }}
          />
          <span className="text-xs font-semibold tracking-wide text-slate-100 whitespace-nowrap">
            {persona.name}
          </span>
        </div>

        <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase mt-0.5">
          {persona.role}
        </span>
      </motion.div>
    </motion.div>
  );
};
