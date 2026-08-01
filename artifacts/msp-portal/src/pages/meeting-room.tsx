import React, { useState, useEffect, useRef } from 'react';
import {
  INITIAL_PERSONAS,
  INITIAL_WHITEBOARD_NODES,
  INITIAL_WHITEBOARD_LINKS,
  STORY_BEATS,
  MOCK_DOCUMENTS,
} from './data/mockData';
import {
  Persona,
  StoryBeat,
  ChatMessage,
  HandOffCardData,
  WhiteboardNode,
  WhiteboardLink,
  ContextAnchor,
  DocumentPreviewData,
} from './types';
import { TopTimelineControl } from './components/TopTimelineControl';
import { RoomCanvas } from './components/RoomCanvas';
import { InlineDocPreview } from './components/InlineDocPreview';
import { ContextModal } from './components/ContextModal';
import { PersonaModal } from './components/PersonaModal';
import { NodeDetailModal } from './components/NodeDetailModal';
import { TranscriptDrawer } from './components/TranscriptDrawer';
import { audioSynth } from './utils/audioSynth';

// Persona Priority Sequencing Mapping (Shane > User > Security > Legal > Employee)
const PERSONA_PRIORITY_MAP: Record<string, number> = {
  shane: 1,  // Lead Consultant
  user: 2,   // You (Enterprise Lead)
  kirk: 3,   // Security Expert
  beth: 4,   // Legal & Risk Advisor
  jane: 5,   // Employee Personas
  marcus: 5,
  priya: 5,
};

const getPersonaPriority = (speakerId?: string): number => {
  if (!speakerId) return 5;
  return PERSONA_PRIORITY_MAP[speakerId.toLowerCase()] ?? 5;
};

const DEFAULT_SPEECH_DURATION = 8; // 8 seconds per speech bubble

export default function App() {
  // Story Beat State
  const [currentBeatId, setCurrentBeatId] = useState<number>(1);
  const [personas, setPersonas] = useState<Persona[]>(INITIAL_PERSONAS);
  const [nodes, setNodes] = useState<WhiteboardNode[]>(INITIAL_WHITEBOARD_NODES);
  const [links, setLinks] = useState<WhiteboardLink[]>(INITIAL_WHITEBOARD_LINKS);

  // Metrics State
  const [readinessScore, setReadinessScore] = useState<number>(42);
  const [riskLevel, setRiskLevel] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [dlpCoverage, setDlpCoverage] = useState<number>(35);
  const [oversharingSites, setOversharingSites] = useState<number>(1240);

  // Chat & Story Messages
  const [allMessages, setAllMessages] = useState<ChatMessage[]>(STORY_BEATS[0].messages);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number>(0);
  const [handOffCards, setHandOffCards] = useState<HandOffCardData[]>([]);

  // Speech Bubble Countdown Timer State
  const [timeRemaining, setTimeRemaining] = useState<number>(DEFAULT_SPEECH_DURATION);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);
  const [isSpeechDismissed, setIsSpeechDismissed] = useState<boolean>(false);
  const [isUserInterrupting, setIsUserInterrupting] = useState<boolean>(false);

  // Interjection Timer Ref
  const interjectionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Modals & Overlays State
  const [activeDoc, setActiveDoc] = useState<DocumentPreviewData | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<ContextAnchor | null>(null);
  const [selectedNode, setSelectedNode] = useState<WhiteboardNode | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [showCenterQA, setShowCenterQA] = useState<boolean>(true);

  // Controls State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [isUserAddressed, setIsUserAddressed] = useState<boolean>(false);
  const [isUserBouncing, setIsUserBouncing] = useState<boolean>(false);
  const [isInteractingHandOff, setIsInteractingHandOff] = useState<boolean>(false);

  // Check if ANY dialog or modal is open
  const isAnyModalOpen = Boolean(
    activeDoc || activeAnchor || selectedNode || selectedPersona || handOffCards.some((c) => c.status === 'pending')
  );

  // Sync state whenever Beat changes
  useEffect(() => {
    const currentBeat = STORY_BEATS.find((b) => b.id === currentBeatId) || STORY_BEATS[0];

    // Update metrics from beat
    setReadinessScore(currentBeat.readinessScore);
    setRiskLevel(currentBeat.riskLevel);
    setDlpCoverage(currentBeat.dlpCoverage);
    setOversharingSites(currentBeat.oversharingSites);

    // Update beat messages with priority sequencing: Shane (1) > User (2) > Security (3) > Legal (4) > Employee (5)
    setAllMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newBeatMsgs = currentBeat.messages.filter((m) => !existingIds.has(m.id));
      const sortedMsgs = [...newBeatMsgs].sort(
        (a, b) => getPersonaPriority(a.speakerId) - getPersonaPriority(b.speakerId)
      );
      return [...prev, ...sortedMsgs];
    });

    setActiveMessageIndex(0);
    setTimeRemaining(DEFAULT_SPEECH_DURATION);
    setIsSpeechDismissed(false);

    // Hand-off cards for beat
    if (currentBeat.handOffCards) {
      setHandOffCards(currentBeat.handOffCards);
      audioSynth.playCardSwoosh();
    } else {
      setHandOffCards([]);
    }

    // Play atmosphere sound effect
    if (currentBeatId === 2) {
      audioSynth.playAlertPulse();
    }
  }, [currentBeatId]);

  // Current active chat bubble
  const currentBeatMsgs = STORY_BEATS.find((b) => b.id === currentBeatId)?.messages || [];
  const activeChatBubble = currentBeatMsgs[activeMessageIndex] || allMessages[allMessages.length - 1] || null;

  // Next speech bubble handler
  const handleNextSpeech = () => {
    audioSynth.playHoverTick();
    setIsSpeechDismissed(false);
    const currentBeat = STORY_BEATS.find((b) => b.id === currentBeatId) || STORY_BEATS[0];
    const beatMsgs = currentBeat.messages;

    if (activeMessageIndex < beatMsgs.length - 1) {
      setActiveMessageIndex((prev) => prev + 1);
      setTimeRemaining(DEFAULT_SPEECH_DURATION);
    } else {
      // Advance to next story beat if available
      if (currentBeatId < STORY_BEATS.length) {
        setCurrentBeatId((prevBeat) => prevBeat + 1);
      } else {
        // Stay on last speech, pause timer
        setIsTimerPaused(true);
      }
    }
  };

  // Speech Bubble Timer Ticker
  useEffect(() => {
    // DO NOT DECREMENT TIMER IF MODAL IS OPEN, PAUSED, AI IS LOADING, OR USER IS INTERRUPTING
    if (isAnyModalOpen || isTimerPaused || isLoadingAi || isUserInterrupting) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 0.2) {
          handleNextSpeech();
          return DEFAULT_SPEECH_DURATION;
        }
        return prev - 0.1;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isAnyModalOpen, isTimerPaused, isLoadingAi, isUserInterrupting, activeMessageIndex, currentBeatId]);

  // Discuss Conversational Topic Card action
  const handleDiscussHandOffCard = (promptText: string, cardId: string) => {
    setIsInteractingHandOff(true);
    setTimeout(() => setIsInteractingHandOff(false), 2200);

    // Animate readiness scores rising, risk gauges stabilizing, and dlp coverage
    setReadinessScore((prev) => Math.min(94, prev + 26));
    setRiskLevel('Low');
    setDlpCoverage((prev) => Math.min(92, prev + 32));
    setOversharingSites((prev) => Math.max(32, Math.round(prev * 0.18)));

    // Re-link whiteboard nodes smoothly with safe status
    setNodes((prevNodes) =>
      prevNodes.map((n) =>
        n.status === 'danger' || n.status === 'warning'
          ? {
              ...n,
              status: 'safe',
              value: n.value.includes('Gaps') || n.value.includes('Unbounded') ? 'Remediated (Purview)' : n.value,
            }
          : n
      )
    );
    setLinks((prevLinks) => prevLinks.map((l) => ({ ...l, status: 'safe' })));

    setHandOffCards((prev) =>
      prev.map((card) => {
        if (card.id === cardId) {
          return { ...card, status: 'discussing' };
        }
        return card;
      })
    );

    // Trigger room discussion on this topic
    handleSendMessage(promptText);
  };

  // Human user submits direct question or response with Interruption logic
  const handleSendMessage = async (text: string) => {
    // 1. User Interruption: Clear any pending interjections & pause persona message rendering
    if (interjectionTimerRef.current) {
      clearTimeout(interjectionTimerRef.current);
      interjectionTimerRef.current = null;
    }
    setIsUserInterrupting(true);
    setIsTimerPaused(true);

    // Trigger User Avatar Spring Bounce & Open Center Whiteboard Q&A
    setIsUserBouncing(true);
    setShowCenterQA(true);

    // Automatically close any open dialogs & dismiss active hand-off cards
    setHandOffCards([]);
    setSelectedNode(null);
    setSelectedPersona(null);
    setActiveDoc(null);
    setActiveAnchor(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      speakerId: 'user',
      speakerName: 'You (Enterprise Lead)',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      beatIndex: currentBeatId,
      isUserMessage: true,
    };

    setAllMessages((prev) => [...prev, userMsg]);
    setIsLoadingAi(true);

    // 2. Wait for user bubble animation cycle (1000ms) before resuming conversation queue
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsUserBouncing(false);

    try {
      const res = await fetch('/api/copilot-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: text,
          currentBeat: STORY_BEATS.find((b) => b.id === currentBeatId)?.title,
          activePersonas: personas.map((p) => p.name),
          metrics: { readinessScore, riskLevel, dlpCoverage, oversharingSites },
        }),
      });

      const data = await res.json();
      setIsLoadingAi(false);
      setIsUserInterrupting(false);
      setIsTimerPaused(false);

      if (data && data.message) {
        const primarySpeakerId = data.speakerId || 'shane';
        const primaryPriority = getPersonaPriority(primarySpeakerId);

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          speakerId: primarySpeakerId,
          speakerName: data.speakerName || 'Shane — Lead Consultant',
          text: data.message,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          beatIndex: currentBeatId,
        };

        // If secondary persona interjection exists, verify persona priority sequencing
        if (data.interjection && data.interjection.message) {
          const interjectionSpeakerId = data.interjection.speakerId || 'kirk';
          const interjectionPriority = getPersonaPriority(interjectionSpeakerId);

          const interjectionMsg: ChatMessage = {
            id: `interject-${Date.now()}`,
            speakerId: interjectionSpeakerId,
            speakerName: data.interjection.speakerName || 'Kirk — Security Expert',
            text: data.interjection.message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            beatIndex: currentBeatId,
          };

          // Sequence messages: Higher priority speaks first, lower priority waits for primary speech to finish
          if (interjectionPriority < primaryPriority) {
            // Interjection has higher priority than primary response (e.g. Shane interjecting on Security)
            setAllMessages((prev) => [...prev, interjectionMsg]);
            setTimeRemaining(DEFAULT_SPEECH_DURATION);

            interjectionTimerRef.current = setTimeout(() => {
              audioSynth.playAlertPulse();
              setAllMessages((prev) => [...prev, aiMsg]);
              setTimeRemaining(DEFAULT_SPEECH_DURATION);
            }, DEFAULT_SPEECH_DURATION * 500); // Wait for higher priority to finish rendering
          } else {
            // Primary response is higher priority (e.g. Shane speaks first, Security/Legal waits)
            setAllMessages((prev) => [...prev, aiMsg]);
            setTimeRemaining(DEFAULT_SPEECH_DURATION);

            interjectionTimerRef.current = setTimeout(() => {
              audioSynth.playAlertPulse();
              setAllMessages((prev) => [...prev, interjectionMsg]);
              setTimeRemaining(DEFAULT_SPEECH_DURATION);
            }, DEFAULT_SPEECH_DURATION * 500); // Lower-priority persona waits for higher-priority speech to render
          }
        } else {
          setAllMessages((prev) => [...prev, aiMsg]);
          setTimeRemaining(DEFAULT_SPEECH_DURATION);
        }

        // Whiteboard update if provided
        if (data.whiteboardUpdate?.scoreDelta) {
          setReadinessScore((prev) => Math.min(98, prev + data.whiteboardUpdate.scoreDelta));
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsLoadingAi(false);
      setIsUserInterrupting(false);
      setIsTimerPaused(false);
    }
  };

  // Reset Assessment State
  const handleReset = () => {
    setCurrentBeatId(1);
    setReadinessScore(42);
    setRiskLevel('Medium');
    setDlpCoverage(35);
    setOversharingSites(1240);
    setNodes(INITIAL_WHITEBOARD_NODES);
    setLinks(INITIAL_WHITEBOARD_LINKS);
    setAllMessages(STORY_BEATS[0].messages);
    setActiveMessageIndex(0);
    setHandOffCards([]);
    setIsPlaying(false);
    setIsTimerPaused(false);
    setTimeRemaining(DEFAULT_SPEECH_DURATION);
  };

  // Derive latest user Q&A exchange
  const lastUserMessage = [...allMessages].reverse().find((m) => m.isUserMessage || m.speakerId === 'user') || null;
  const userMsgIndex = lastUserMessage ? allMessages.findIndex((m) => m.id === lastUserMessage.id) : -1;
  const latestAiResponse = userMsgIndex !== -1 ? allMessages[userMsgIndex + 1] || null : null;
  const interjectionMessage = userMsgIndex !== -1 ? allMessages[userMsgIndex + 2] || null : null;

  return (
    <div className="min-h-screen bg-[#050510] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Story Beat & Control Header */}
      <TopTimelineControl
        beats={STORY_BEATS}
        currentBeatId={currentBeatId}
        isPlaying={isPlaying}
        isMuted={isMuted}
        onSelectBeat={(id) => setCurrentBeatId(id)}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSkipBeat={() => setCurrentBeatId((prev) => (prev < 4 ? prev + 1 : 1))}
        onToggleMute={() => setIsMuted(audioSynth.toggleMute())}
        onReset={handleReset}
      />

      {/* Main Cinematic Virtual Room Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 md:p-6 flex flex-col justify-center">
        <RoomCanvas
          personas={personas}
          activeBeatId={currentBeatId}
          speakerHighlightId={activeChatBubble?.speakerId}
          activeChatBubble={activeChatBubble}
          lastUserMessage={lastUserMessage}
          latestAiResponse={latestAiResponse}
          interjectionMessage={interjectionMessage}
          showCenterQA={showCenterQA}
          onCloseCenterQA={() => setShowCenterQA(false)}
          onShowCenterQA={() => setShowCenterQA(true)}
          nodes={nodes}
          links={links}
          readinessScore={readinessScore}
          riskLevel={riskLevel}
          dlpCoverage={dlpCoverage}
          oversharingSites={oversharingSites}
          handOffCards={handOffCards}
          onDiscussHandOffCard={handleDiscussHandOffCard}
          onDismissHandOffCard={(cardId) => setHandOffCards((prev) => prev.filter((c) => c.id !== cardId))}
          onOpenAnchor={(anchor) => setActiveAnchor(anchor)}
          onOpenDoc={(docId) => setActiveDoc(MOCK_DOCUMENTS[docId] || null)}
          onSendMessage={handleSendMessage}
          isUserAddressed={isUserAddressed}
          isLoadingAi={isLoadingAi}
          isUserBouncing={isUserBouncing}
          isInteractingHandOff={isInteractingHandOff}
          onOpenInputBar={() => setIsTimerPaused(true)}
          onSelectNode={(node) => setSelectedNode(node)}
          onSelectPersona={(persona) => setSelectedPersona(persona)}
          timeRemaining={timeRemaining}
          totalDuration={DEFAULT_SPEECH_DURATION}
          isPaused={isTimerPaused}
          isModalOpen={isAnyModalOpen}
          onNextSpeech={handleNextSpeech}
          onTogglePause={() => setIsTimerPaused(!isTimerPaused)}
          onCloseSpeech={() => setIsSpeechDismissed(true)}
          isSpeechDismissed={isSpeechDismissed}
          onRestoreSpeech={() => setIsSpeechDismissed(false)}
        />
      </main>

      {/* Transcript Log Drawer in Bottom-Right */}
      <TranscriptDrawer
        messages={allMessages}
        unreadCount={allMessages.length}
        onJumpToBeat={(beatId) => setCurrentBeatId(beatId)}
      />

      {/* Inline Document Preview Overlay */}
      <InlineDocPreview
        document={activeDoc}
        onClose={() => setActiveDoc(null)}
        onApplyRemediation={() => {
          setReadinessScore(92);
          setRiskLevel('Low');
          setDlpCoverage(94);
          setOversharingSites(28);
          setNodes((prevNodes) =>
            prevNodes.map((n) => ({
              ...n,
              status: 'safe',
              value: n.value.includes('Gaps') || n.value.includes('Unbounded') ? 'Remediated (Purview)' : n.value,
            }))
          );
          setLinks((prevLinks) => prevLinks.map((l) => ({ ...l, status: 'safe' })));
        }}
      />

      {/* Contextual Anchor Details Modal */}
      <ContextModal
        anchor={activeAnchor}
        onClose={() => setActiveAnchor(null)}
        onApplyFix={() => {
          setReadinessScore((prev) => Math.min(94, prev + 15));
        }}
      />

      {/* Persona Card Detail Modal */}
      <PersonaModal
        persona={selectedPersona}
        onClose={() => setSelectedPersona(null)}
        onAskQuestion={(qText) => handleSendMessage(qText)}
      />

      {/* Whiteboard Node Plain-English Detail Modal */}
      <NodeDetailModal
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onDiscussTopic={(qText) => handleSendMessage(qText)}
        onOpenDoc={(docId) => {
          setSelectedNode(null);
          setActiveDoc(MOCK_DOCUMENTS[docId] || null);
        }}
      />
    </div>
  );
}
