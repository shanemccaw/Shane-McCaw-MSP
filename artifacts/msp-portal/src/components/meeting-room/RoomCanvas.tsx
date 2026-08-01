import React from 'react';
import { motion } from 'motion/react';
import { Persona, WhiteboardNode, WhiteboardLink, ChatMessage, HandOffCardData, ContextAnchor } from '../types';
import { PersonaAvatar } from './PersonaAvatar';
import { FloatingChatBubble } from './FloatingChatBubble';
import { LiveWhiteboard } from './LiveWhiteboard';
import { HandOffCard } from './HandOffCard';
import { HumanInputBar } from './HumanInputBar';
import { CenterWhiteboardQA } from './CenterWhiteboardQA';
import { SOWPhasesDock } from './SOWPhasesDock';
import { FileText, Sparkles, ExternalLink, ShieldCheck, MessageSquare } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface RoomCanvasProps {
  personas: Persona[];
  activeBeatId: number;
  speakerHighlightId?: string;
  activeChatBubble?: ChatMessage | null;
  lastUserMessage?: ChatMessage | null;
  latestAiResponse?: ChatMessage | null;
  interjectionMessage?: ChatMessage | null;
  showCenterQA?: boolean;
  onCloseCenterQA?: () => void;
  onShowCenterQA?: () => void;
  nodes: WhiteboardNode[];
  links: WhiteboardLink[];
  readinessScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  dlpCoverage: number;
  oversharingSites: number;
  handOffCards?: HandOffCardData[];
  onDiscussHandOffCard: (promptText: string, cardId: string) => void;
  onDismissHandOffCard?: (cardId: string) => void;
  onOpenAnchor: (anchor: ContextAnchor) => void;
  onOpenDoc: (docId: string) => void;
  onSendMessage: (text: string) => void;
  isUserAddressed?: boolean;
  isLoadingAi?: boolean;
  isUserBouncing?: boolean;
  isInteractingHandOff?: boolean;
  onOpenInputBar?: () => void;
  onSelectNode?: (node: WhiteboardNode) => void;
  onSelectPersona?: (persona: Persona) => void;
  timeRemaining?: number;
  totalDuration?: number;
  isPaused?: boolean;
  isModalOpen?: boolean;
  onNextSpeech?: () => void;
  onTogglePause?: () => void;
  onCloseSpeech?: () => void;
  isSpeechDismissed?: boolean;
  onRestoreSpeech?: () => void;
}

export const RoomCanvas: React.FC<RoomCanvasProps> = ({
  personas,
  activeBeatId,
  speakerHighlightId,
  activeChatBubble,
  lastUserMessage = null,
  latestAiResponse = null,
  interjectionMessage = null,
  showCenterQA = true,
  onCloseCenterQA,
  onShowCenterQA,
  nodes,
  links,
  readinessScore,
  riskLevel,
  dlpCoverage,
  oversharingSites,
  handOffCards = [],
  onDiscussHandOffCard,
  onDismissHandOffCard,
  onOpenAnchor,
  onOpenDoc,
  onSendMessage,
  isUserAddressed = false,
  isLoadingAi = false,
  isUserBouncing = false,
  isInteractingHandOff = false,
  onOpenInputBar,
  onSelectNode,
  onSelectPersona,
  timeRemaining = 8,
  totalDuration = 8,
  isPaused = false,
  isModalOpen = false,
  onNextSpeech,
  onTogglePause,
  onCloseSpeech,
  isSpeechDismissed = false,
  onRestoreSpeech,
}) => {
  const [activeCardIndex, setActiveCardIndex] = React.useState(0);
  const currentCardIndex = Math.min(activeCardIndex, Math.max(0, handOffCards.length - 1));

  // Active active personas filtered for current beat
  const activePersonasInBeat = React.useMemo(() => {
    return personas.filter((p) => p.activeInBeats.includes(activeBeatId));
  }, [personas, activeBeatId]);

  // Fixed Docking Zones Architecture (Top, Left, Right, Bottom)
  const getDockingPositionStyles = (persona: Persona): React.CSSProperties => {
    switch (persona.id) {
      case 'shane':
        // Top-center dock for Shane positioned above canvas header with hard boundary
        return { top: '1.5%', left: '50%', transform: 'translateX(-50%)' };
      case 'jane':
        // Left vertical dock: Top (Jane)
        return { top: '20%', left: '2.5%', transform: 'translateY(-50%)' };
      case 'marcus':
        // Left vertical dock: Mid (Marcus)
        return { top: '48%', left: '2.5%', transform: 'translateY(-50%)' };
      case 'priya':
        // Left vertical dock: Bottom (Priya)
        return { top: '76%', left: '2.5%', transform: 'translateY(-50%)' };
      case 'kirk':
        // Right vertical dock: Top/Mid (Kirk - conditional slide-in with hard right boundary)
        return { top: '30%', right: '2.5%', transform: 'translateY(-50%)' };
      case 'beth':
        // Right vertical dock: Bottom (Beth - conditional slide-in with hard right boundary)
        return { top: '65%', right: '2.5%', transform: 'translateY(-50%)' };
      case 'user':
      default:
        // Bottom-center dock for User Avatar attached to Speak Button
        return { bottom: '1.5%', left: '50%', transform: 'translateX(-50%)' };
    }
  };

  // Fixed Chat Bubble trajectories anchored to docking zones
  const getBubblePositionStyles = (pos: Persona['position'], speakerId?: string): React.CSSProperties => {
    let baseStyles: React.CSSProperties = {};
    let primaryQuadrant = 'head';

    if (speakerId === 'shane' || pos === 'head') {
      baseStyles = { top: '12%', left: '50%', transform: 'translateX(-50%)' };
      primaryQuadrant = 'head';
    } else if (speakerId === 'jane' || pos === 'left-top') {
      baseStyles = { top: '20%', left: '11%' };
      primaryQuadrant = 'left-top';
    } else if (speakerId === 'marcus' || pos === 'left-center') {
      baseStyles = { top: '48%', left: '11%' };
      primaryQuadrant = 'left-center';
    } else if (speakerId === 'priya' || pos === 'left-bottom') {
      baseStyles = { top: '74%', left: '11%' };
      primaryQuadrant = 'left-bottom';
    } else if (speakerId === 'kirk' || pos === 'right-top' || pos === 'right-center') {
      baseStyles = { top: '30%', right: '11%' };
      primaryQuadrant = 'right-center';
    } else if (speakerId === 'beth' || pos === 'right-bottom') {
      baseStyles = { top: '65%', right: '11%' };
      primaryQuadrant = 'right-bottom';
    } else if (speakerId === 'user' || pos === 'bottom-center') {
      baseStyles = { bottom: '13%', left: '50%', transform: 'translateX(-50%)' };
      primaryQuadrant = 'bottom-center';
    } else {
      baseStyles = { top: '12%', left: '50%', transform: 'translateX(-50%)' };
    }

    // Determine occupied center/head overlays
    const isHeadOccupied = showCenterQA && (lastUserMessage || isLoadingAi);
    const isCenterOccupied = handOffCards.length > 0 && handOffCards[currentCardIndex];

    let offsetY = 0;
    let offsetX = 0;

    if (primaryQuadrant === 'head' && isHeadOccupied) {
      offsetY = -18;
    } else if (primaryQuadrant === 'bottom-center' && isHeadOccupied) {
      offsetY = -12; // Shift upward into canvas
    } else if (isCenterOccupied && (primaryQuadrant === 'left-center' || primaryQuadrant === 'right-center')) {
      offsetX = primaryQuadrant === 'left-center' ? -12 : 12;
    }

    const transformBase = baseStyles.transform ? `${baseStyles.transform} ` : '';
    return {
      ...baseStyles,
      transform: `${transformBase}translate(${offsetX}px, ${offsetY}px)`,
      transition: 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), top 280ms cubic-bezier(0.22, 1, 0.36, 1), left 280ms cubic-bezier(0.22, 1, 0.36, 1), right 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    };
  };

  const currentSpeaker = personas.find((p) => p.id === activeChatBubble?.speakerId);

  // Computed state for narrative lighting and tension shifts
  const isTensionMode = activeBeatId === 2 || speakerHighlightId === 'kirk' || speakerHighlightId === 'beth' || riskLevel === 'Critical';
  const isClosingMode = activeBeatId === 4;

  const getBeatLightingGradient = () => {
    switch (activeBeatId) {
      case 1:
        // Warm lighting during introductions
        return [
          'radial-gradient(circle at 50% 30%, rgba(217, 119, 6, 0.35) 0%, rgba(126, 34, 206, 0.25) 45%, rgba(5, 5, 16, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(234, 88, 12, 0.32) 0%, rgba(88, 28, 135, 0.3) 45%, rgba(5, 5, 16, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(217, 119, 6, 0.35) 0%, rgba(126, 34, 206, 0.25) 45%, rgba(5, 5, 16, 0.98) 75%)',
        ];
      case 2:
        // Colder lighting during security / legal interjections
        return [
          'radial-gradient(circle at 50% 30%, rgba(225, 29, 72, 0.42) 0%, rgba(15, 23, 42, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(159, 18, 57, 0.38) 0%, rgba(30, 41, 59, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(225, 29, 72, 0.42) 0%, rgba(15, 23, 42, 0.98) 75%)',
        ];
      case 3:
        // Active remediation teal/cyan transition
        return [
          'radial-gradient(circle at 50% 30%, rgba(13, 148, 136, 0.42) 0%, rgba(6, 182, 212, 0.3) 50%, rgba(5, 5, 16, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(6, 182, 212, 0.38) 0%, rgba(15, 118, 110, 0.35) 50%, rgba(5, 5, 16, 0.98) 75%)',
          'radial-gradient(circle at 50% 30%, rgba(13, 148, 136, 0.42) 0%, rgba(6, 182, 212, 0.3) 50%, rgba(5, 5, 16, 0.98) 75%)',
        ];
      case 4:
      default:
        // Shane's closing moment & resolution: Bright clarity & warming atmosphere
        return [
          'radial-gradient(circle at 50% 30%, rgba(6, 182, 212, 0.42) 0%, rgba(16, 185, 129, 0.32) 40%, rgba(245, 158, 11, 0.22) 75%, rgba(5, 5, 16, 0.98) 100%)',
          'radial-gradient(circle at 50% 30%, rgba(16, 185, 129, 0.38) 0%, rgba(6, 182, 212, 0.4) 40%, rgba(217, 119, 6, 0.25) 75%, rgba(5, 5, 16, 0.98) 100%)',
          'radial-gradient(circle at 50% 30%, rgba(6, 182, 212, 0.42) 0%, rgba(16, 185, 129, 0.32) 40%, rgba(245, 158, 11, 0.22) 75%, rgba(5, 5, 16, 0.98) 100%)',
        ];
    }
  };

  return (
    <div className={`relative w-full min-h-[500px] md:min-h-[560px] h-[calc(100vh-95px)] max-h-[700px] rounded-3xl bg-[#050510] overflow-hidden border border-white/10 shadow-2xl flex flex-col items-center justify-between p-2 md:p-4 select-none transition-all duration-700 ${
      isTensionMode ? 'brightness-90 saturate-85' : isClosingMode ? 'brightness-105 saturate-110' : ''
    }`}>
      {/* 1. Atmospheric Ambient Room Lighting */}
      <motion.div
        animate={{
          background: getBeatLightingGradient(),
        }}
        transition={{ duration: isTensionMode ? 4 : isClosingMode ? 8 : 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 pointer-events-none z-0"
      />

      {/* Full-Room Slow Parallax Background Depth Layer */}
      <motion.div
        animate={{ x: [-15, 15, -15], y: [-10, 10, -10], rotate: [0, 0.8, -0.8, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 bg-[radial-gradient(#38bdf8_1.2px,transparent_1.2px)] [background-size:28px_28px] opacity-25 pointer-events-none z-0"
      />

      {/* Ambient Sweeping Room Light Beams */}
      <motion.div
        animate={{ x: ['-100%', '200%'], opacity: [0.15, 0.45, 0.15] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/20 via-purple-500/15 to-transparent pointer-events-none z-0"
      />

      {/* Volumetric Center Table Pedestal Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 rounded-full bg-gradient-to-tr from-cyan-500/15 via-purple-500/10 to-emerald-500/15 blur-3xl pointer-events-none z-0" />

      {/* Muted Room Tension Vignette Effect during Security/Legal Findings */}
      {isTensionMode && (
        <motion.div
          animate={{ opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 pointer-events-none z-0 shadow-[inset_0_0_120px_rgba(225,29,72,0.35)] border-2 border-rose-500/20"
        />
      )}

      {/* Shane's Closing Moment Serene Room Warming Overlay */}
      {isClosingMode && (
        <motion.div
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 pointer-events-none z-0 bg-gradient-to-t from-amber-500/10 via-cyan-500/5 to-emerald-500/10 backdrop-blur-[0.5px]"
        />
      )}

      {/* Floating Ambient Particles & Room Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

      {/* 2 & 3. Glass Conference Table Surface Overlay with Full-Size Holographic Whiteboard */}
      <div className="absolute top-[10%] bottom-[12%] left-[3%] right-[3%] sm:left-[5%] sm:right-[5%] z-10 rounded-[40px] sm:rounded-[60px] md:rounded-[75px] bg-gradient-to-b from-slate-950/90 via-slate-900/90 to-slate-950/95 border border-cyan-500/30 backdrop-blur-2xl shadow-[0_0_80px_rgba(6,182,212,0.15)] p-1.5 sm:p-2 overflow-hidden relative">
        {/* Dynamic Specular Glass Reflection Sheen */}
        <motion.div
          animate={{ x: ['-120%', '220%'] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 via-cyan-300/15 to-transparent pointer-events-none z-20"
        />

        <LiveWhiteboard
          nodes={nodes}
          links={links}
          readinessScore={readinessScore}
          riskLevel={riskLevel}
          dlpCoverage={dlpCoverage}
          oversharingSites={oversharingSites}
          highlightNodeId={activeChatBubble?.anchors?.[0]?.targetId}
          onSelectNode={onSelectNode}
          isTensionMode={isTensionMode}
          isClosingMode={isClosingMode}
        />
      </div>

      {/* Prominent Center Stage Whiteboard Human Q&A Display Card */}
      {showCenterQA && (lastUserMessage || isLoadingAi) && (
        <div className="absolute top-[48%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-35 w-full max-w-2xl px-3 sm:px-5 pointer-events-auto">
          <CenterWhiteboardQA
            lastUserMessage={lastUserMessage}
            latestAiResponse={latestAiResponse}
            interjectionMessage={interjectionMessage}
            isLoadingAi={isLoadingAi}
            personas={personas}
            onSendMessage={onSendMessage}
            onClose={() => onCloseCenterQA?.()}
          />
        </div>
      )}

      {/* Re-open Center Whiteboard Q&A Button if closed */}
      {!showCenterQA && lastUserMessage && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            audioSynth.playHoverTick();
            onShowCenterQA?.();
          }}
          className="absolute top-4 left-4 z-35 px-3 py-1.5 rounded-full bg-slate-950/90 border border-cyan-400 text-cyan-200 text-xs font-mono font-bold shadow-[0_0_20px_rgba(6,182,212,0.4)] backdrop-blur-md flex items-center gap-1.5 cursor-pointer hover:bg-slate-900 transition-all"
        >
          <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
          <span>SHOW CENTER WHITEBOARD Q&A</span>
        </motion.button>
      )}

      {/* SOW Phases & Findings Dock in Bottom-Left */}
      <SOWPhasesDock
        nodes={nodes}
        activeBeatId={activeBeatId}
        readinessScore={readinessScore}
        dlpCoverage={dlpCoverage}
        oversharingSites={oversharingSites}
        onSelectNode={onSelectNode}
        onDiscussFinding={(text) => onSendMessage(text)}
      />

      {/* Floating Holographic Audit Document Cards Launcher Deck */}
      <div className="absolute top-3 right-4 sm:right-8 z-30 pointer-events-auto flex items-center gap-1.5">
        <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-950/80 border border-cyan-500/40 backdrop-blur-md shadow-lg">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin-slow" />
          <span className="text-[10px] font-mono font-bold text-cyan-300 uppercase tracking-wider">
            Audit Documents Deck:
          </span>
        </div>

        {/* Document Card 1: Purview Security Audit */}
        <motion.button
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            audioSynth.playCardSwoosh();
            onOpenDoc('doc-security-audit');
          }}
          className="px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-mono font-bold shadow-[0_0_15px_rgba(244,63,94,0.3)] hover:shadow-[0_0_25px_rgba(244,63,94,0.6)] transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
          title="Open Purview Security Audit & Sensitivity Label Gap Analysis"
        >
          <FileText className="w-3.5 h-3.5 text-rose-400" />
          <span className="hidden sm:inline">Purview Audit</span>
          <span className="sm:hidden">Audit</span>
        </motion.button>

        {/* Document Card 2: Exposure Risk Matrix */}
        <motion.button
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            audioSynth.playCardSwoosh();
            onOpenDoc('doc-exposure-report');
          }}
          className="px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-amber-950/80 border border-amber-500/60 text-amber-200 text-xs font-mono font-bold shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_25px_rgba(245,158,11,0.6)] transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
          title="Open Copilot Semantic Search Exposure Risk Matrix"
        >
          <FileText className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Risk Matrix</span>
          <span className="sm:hidden">Risk</span>
        </motion.button>

        {/* Document Card 3: Copilot Roadmap */}
        <motion.button
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            audioSynth.playCardSwoosh();
            onOpenDoc('doc-copilot-spec');
          }}
          className="px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-emerald-950/80 border border-emerald-500/60 text-emerald-200 text-xs font-mono font-bold shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.6)] transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
          title="Open Microsoft 365 Copilot Deployment Roadmap"
        >
          <FileText className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Copilot Roadmap</span>
          <span className="sm:hidden">Roadmap</span>
        </motion.button>
      </div>

      {/* 4. Active Floating Chat Bubble */}
      {activeChatBubble && !isSpeechDismissed && (
        <FloatingChatBubble
          message={activeChatBubble}
          speakerHex={currentSpeaker?.glowHex || '#06b6d4'}
          speakerAvatarUrl={currentSpeaker?.avatarUrl}
          speakerPosition={currentSpeaker?.position || 'head'}
          isUser={activeChatBubble.isUserMessage}
          onOpenAnchor={onOpenAnchor}
          onOpenDoc={onOpenDoc}
          positionStyle={
            currentSpeaker
              ? getBubblePositionStyles(currentSpeaker.position, currentSpeaker.id)
              : { top: '12%', left: '50%', transform: 'translateX(-50%)' }
          }
          timeRemaining={timeRemaining}
          totalDuration={totalDuration}
          isPaused={isPaused}
          isModalOpen={isModalOpen}
          onNext={onNextSpeech}
          onTogglePause={onTogglePause}
          onClose={onCloseSpeech}
        />
      )}

      {/* Restore Closed Dialog Pill */}
      {activeChatBubble && isSpeechDismissed && (
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          onClick={onRestoreSpeech}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-cyan-950/90 border border-cyan-400/80 text-cyan-200 text-xs font-bold font-mono shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:bg-cyan-900/90 transition-all flex items-center gap-2 backdrop-blur-md active:scale-95 cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>Show Active Dialog ({currentSpeaker?.name || 'Speaker'})</span>
        </motion.button>
      )}

      {/* 5. Floating Interactive Hand-Off Cards Layer */}
      {handOffCards.length > 0 && handOffCards[currentCardIndex] && (
        <div className="absolute top-[52%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-25 w-full max-w-lg px-3 sm:px-4 pointer-events-auto flex flex-col items-center">
          {/* Multi-Card Navigation Tabs if more than 1 card */}
          {handOffCards.length > 1 && (
            <div className="flex items-center gap-1.5 mb-2 p-1 rounded-full bg-slate-950/90 border border-cyan-500/50 backdrop-blur-md shadow-xl z-30">
              <span className="text-[10px] font-mono font-bold text-cyan-300 px-2 uppercase">
                Topic Cards ({currentCardIndex + 1}/{handOffCards.length}):
              </span>
              {handOffCards.map((c, idx) => (
                <button
                  key={c.id}
                  onClick={() => {
                    audioSynth.playHoverTick();
                    setActiveCardIndex(idx);
                  }}
                  className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    currentCardIndex === idx
                      ? 'bg-cyan-400 text-slate-950 shadow-md font-extrabold'
                      : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Topic {idx + 1}
                </button>
              ))}
            </div>
          )}

          <HandOffCard
            key={handOffCards[currentCardIndex].id}
            card={handOffCards[currentCardIndex]}
            onDiscuss={(text, cardId) => onDiscussHandOffCard(text, cardId)}
            onDismiss={(cardId) => onDismissHandOffCard?.(cardId)}
          />
        </div>
      )}

      {/* 6. Personas Fixed Docking Zones */}
      {personas
        .filter((p) => p.activeInBeats.includes(activeBeatId))
        .map((persona) => {
          const isSpeaking = speakerHighlightId === persona.id;
          const isUserPersona = persona.id === 'user';

          return (
            <PersonaAvatar
              key={persona.id}
              persona={persona}
              isSpeaking={isSpeaking}
              isAddressed={isUserAddressed && isUserPersona}
              isBouncing={isUserPersona && isUserBouncing}
              isInteractingHandOff={isUserPersona && isInteractingHandOff}
              isTensionMode={isTensionMode}
              isClosingMode={isClosingMode}
              stylePosition={getDockingPositionStyles(persona)}
              onClick={() => onSelectPersona?.(persona)}
            />
          );
        })}

      {/* 7. Bottom Human Interaction Dock attached directly to User Avatar */}
      <div className="absolute bottom-1 sm:bottom-2 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center justify-center">
        <HumanInputBar
          onSendMessage={onSendMessage}
          isAddressed={isUserAddressed}
          isLoading={isLoadingAi}
          onOpenInputBar={onOpenInputBar}
        />
      </div>
    </div>
  );
};
