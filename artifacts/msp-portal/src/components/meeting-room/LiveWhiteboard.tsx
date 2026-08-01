import React, { useState } from 'react';
import { WhiteboardNode, WhiteboardLink } from '../types';
import { HolographicRadarView } from './HolographicRadarView';
import { Radio, Layers } from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

interface LiveWhiteboardProps {
  nodes?: WhiteboardNode[];
  links?: WhiteboardLink[];
  readinessScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  dlpCoverage: number;
  oversharingSites: number;
  highlightNodeId?: string;
  onSelectNode?: (node: WhiteboardNode) => void;
  isTensionMode?: boolean;
  isClosingMode?: boolean;
  tenantName?: string;
}

export const LiveWhiteboard: React.FC<LiveWhiteboardProps> = ({
  readinessScore,
  riskLevel,
  highlightNodeId,
  onSelectNode,
  isTensionMode = false,
  isClosingMode = false,
  tenantName = 'Contoso Electronics (Prod)',
}) => {
  const [viewMode, setViewMode] = useState<'radar' | 'classic'>('radar');

  return (
    <div className="relative w-full h-full min-h-[500px] flex flex-col bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* Top View Toggle Tab */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1 rounded-full bg-slate-900/90 border border-slate-700/80 backdrop-blur-md shadow-xl text-[11px] font-mono font-bold">
        <button
          onClick={() => {
            audioSynth.playHoverTick();
            setViewMode('radar');
          }}
          className={`px-3 py-1 rounded-full transition-all cursor-pointer flex items-center gap-1.5 ${
            viewMode === 'radar'
              ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${viewMode === 'radar' ? 'animate-pulse text-slate-950' : 'text-cyan-400'}`} />
          <span>Holographic Radar View</span>
        </button>

        <button
          onClick={() => {
            audioSynth.playHoverTick();
            setViewMode('classic');
          }}
          className={`px-3 py-1 rounded-full transition-all cursor-pointer flex items-center gap-1.5 ${
            viewMode === 'classic'
              ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-purple-400" />
          <span>Topology Grid</span>
        </button>
      </div>

      {/* Main Holographic Radar View */}
      <HolographicRadarView
        tenantName={tenantName}
        readinessScore={readinessScore}
        riskLevel={riskLevel}
        highlightNodeId={highlightNodeId}
        onSelectNode={onSelectNode}
        isTensionMode={isTensionMode}
        isClosingMode={isClosingMode}
      />
    </div>
  );
};
