import React from 'react';
import { motion } from 'motion/react';
import { Play, Pause, SkipForward, Volume2, VolumeX, RotateCcw, Sparkles } from 'lucide-react';
import { StoryBeat } from '../types';
import { audioSynth } from '../utils/audioSynth';

interface TopTimelineControlProps {
  beats: StoryBeat[];
  currentBeatId: number;
  isPlaying: boolean;
  isMuted: boolean;
  onSelectBeat: (beatId: number) => void;
  onTogglePlay: () => void;
  onSkipBeat: () => void;
  onToggleMute: () => void;
  onReset: () => void;
}

export const TopTimelineControl: React.FC<TopTimelineControlProps> = ({
  beats,
  currentBeatId,
  isPlaying,
  isMuted,
  onSelectBeat,
  onTogglePlay,
  onSkipBeat,
  onToggleMute,
  onReset,
}) => {
  return (
    <div className="relative z-30 w-full max-w-6xl mx-auto px-4 py-2">
      <div className="rounded-2xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-2xl p-2 md:px-4 md:py-2.5 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Brand Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-slate-950 font-black shadow-lg">
            <Sparkles className="w-4 h-4 text-slate-950 animate-spin-slow" />
          </div>
          <div>
            <h1 className="text-xs md:text-sm font-black text-slate-100 tracking-wider flex items-center gap-2 font-mono">
              <span>COPILOT READINESS BRIEFING ROOM</span>
              <span className="hidden sm:inline-block text-[9px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-500/40">
                M365 Briefing
              </span>
            </h1>
          </div>
        </div>

        {/* Center: Story Beat Scene Stepper */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto justify-center py-1">
          {beats.map((beat) => {
            const isActive = beat.id === currentBeatId;
            return (
              <button
                key={beat.id}
                onClick={() => {
                  audioSynth.playHoverTick();
                  onSelectBeat(beat.id);
                }}
                className={`relative px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all duration-300 whitespace-nowrap flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-cyan-950/90 text-cyan-300 border-cyan-400 shadow-lg shadow-cyan-950/80 ring-1 ring-cyan-500/40'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span>{beat.id}.</span>
                <span>{beat.shortTitle}</span>

                {isActive && (
                  <motion.span
                    layoutId="activeBeatIndicator"
                    className="absolute inset-0 rounded-xl border-2 border-cyan-400 pointer-events-none"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Controls (Play/Pause, Skip Beat, Mute, Reset) */}
        <div className="flex items-center gap-2">
          {/* Auto Presentation Play / Pause */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onTogglePlay();
            }}
            className={`p-2 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
              isPlaying
                ? 'bg-amber-950 text-amber-300 border-amber-500/60 animate-pulse'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
            title={isPlaying ? 'Pause Auto Presentation' : 'Play Story Mode Presentation'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPlaying ? 'PAUSE' : 'AUTO PLAY'}</span>
          </button>

          {/* Skip Beat */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onSkipBeat();
            }}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 text-xs font-mono transition-colors flex items-center gap-1"
            title="Skip to next scene beat"
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SKIP BEAT</span>
          </button>

          {/* Mute Toggle */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onToggleMute();
            }}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
            title={isMuted ? 'Unmute Web Audio' : 'Mute Web Audio'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Reset Assessment */}
          <button
            onClick={() => {
              audioSynth.playHoverTick();
              onReset();
            }}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-900 transition-colors"
            title="Reset Assessment State"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
