import React from 'react';
import { Sparkles, AlertTriangle, FileText, MessageSquareCode, Zap, ShieldAlert, CheckCircle } from 'lucide-react';

export interface XpiaEvent {
  id: string;
  documentName: string;
  sensitivity: 'PHI' | 'PII' | 'CUI' | 'PCI' | 'Financial';
  action: string;
  timestamp: string;
  severity: 'Critical' | 'High' | 'Medium';
}

export interface PromptRiskEvent {
  id: string;
  promptText: string;
  intent: string;
  userRole: string;
  riskCategory: string;
  timestamp: string;
  severity: 'Critical' | 'High' | 'Medium';
}

interface ThreatPipelinesProps {
  mode: 'projected' | 'soc' | 'redteam';
  xpiaEvents: XpiaEvent[];
  promptEvents: PromptRiskEvent[];
  onTriggerCriticalEvent: () => void;
}

export const ThreatPipelines: React.FC<ThreatPipelinesProps> = ({
  mode,
  xpiaEvents,
  promptEvents,
  onTriggerCriticalEvent
}) => {
  const isProjected = mode === 'projected';
  const isRedTeam = mode === 'redteam';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-3 select-none">
      
      {/* -------------------------------------------------------------------- */}
      {/* LEFT PIPELINE — XPIA (DOCUMENT INFILTRATION)                         */}
      {/* -------------------------------------------------------------------- */}
      <div className="bg-[#070A14] border border-sky-500/30 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between">
        
        {/* Background Stream Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(#0078D4_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-sky-500/20 relative z-10">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <FileText className="w-3.5 h-3.5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-sky-300">
                  XPIA Pipeline
                </h4>
                <span className="text-[9px] font-mono bg-sky-950 text-sky-300 border border-sky-800 px-1.5 py-0.2 rounded font-bold">
                  Document Infiltration
                </span>
              </div>
              <p className="text-[9.5px] text-slate-400">
                {isProjected ? 'Ghost Stream: What Copilot WOULD touch' : 'Real-Time Data Ingestion Stream'}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-mono text-sky-400 font-bold bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800">
            {xpiaEvents.length} Pulses
          </span>
        </div>

        {/* Stream List */}
        <div className="space-y-2 relative z-10 max-h-[180px] overflow-y-auto scrollbar-thin pr-1">
          {xpiaEvents.map((evt) => (
            <div
              key={evt.id}
              className={`p-2.5 rounded-xl border transition-all duration-300 relative group ${
                isProjected
                  ? 'bg-sky-950/20 border-sky-900/40 opacity-75 hover:opacity-100'
                  : 'bg-sky-950/40 border-sky-500/40 shadow-[0_0_12px_rgba(0,120,212,0.2)]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-bold text-white block">
                    {evt.action}
                  </span>
                  <span className="text-[10px] text-slate-300 font-mono mt-0.5 block">
                    📄 {evt.documentName}
                  </span>
                </div>
                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  evt.severity === 'Critical'
                    ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  {evt.sensitivity}
                </span>
              </div>

              {/* Explainer tooltip on hover */}
              <div className="mt-1.5 pt-1 border-t border-sky-900/30 text-[9px] font-mono text-sky-300/80">
                {isProjected ? '🔍 Hover Explainer: XPIA tracks data Copilot WOULD access.' : `⚡ Timestamp: ${evt.timestamp}`}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Status */}
        <div className="pt-2 border-t border-sky-900/30 text-[9.5px] font-mono text-sky-400 flex items-center justify-between">
          <span>XPIA Sensor State:</span>
          <span className="font-bold text-emerald-400">GROUNDING MONITOR ACTIVE</span>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* RIGHT PIPELINE — PROMPT RISK ENGINE (BAD PROMPTS)                   */}
      {/* -------------------------------------------------------------------- */}
      <div className="bg-[#0A0714] border border-purple-500/30 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between">
        
        {/* Background Stream Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(#a855f7_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-purple-500/20 relative z-10">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <MessageSquareCode className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-purple-300">
                  Prompt Risk Engine
                </h4>
                <span className="text-[9px] font-mono bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.2 rounded font-bold">
                  User Intent Stream
                </span>
              </div>
              <p className="text-[9.5px] text-slate-400">
                {isProjected ? 'Ghost Bubbles: Prompts users COULD ask' : 'Real-Time Intent Analysis Stream'}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-mono text-purple-400 font-bold bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800">
            {promptEvents.length} Bubbles
          </span>
        </div>

        {/* Stream List */}
        <div className="space-y-2 relative z-10 max-h-[180px] overflow-y-auto scrollbar-thin pr-1">
          {promptEvents.map((pe) => (
            <div
              key={pe.id}
              className={`p-2.5 rounded-xl border transition-all duration-300 relative group ${
                isProjected
                  ? 'bg-purple-950/20 border-purple-900/40 opacity-75 hover:opacity-100'
                  : 'bg-purple-950/40 border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-extrabold text-purple-200 block font-mono">
                    "{pe.promptText}"
                  </span>
                  <div className="flex items-center space-x-2 text-[9.5px] text-slate-400 mt-1">
                    <span>Role: <strong className="text-purple-300">{pe.userRole}</strong></span>
                    <span>• Intent: <strong className="text-amber-300">{pe.intent}</strong></span>
                  </div>
                </div>
                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${
                  pe.severity === 'Critical'
                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  {pe.riskCategory}
                </span>
              </div>

              {/* Explainer tooltip on hover */}
              <div className="mt-1.5 pt-1 border-t border-purple-900/30 text-[9px] font-mono text-purple-300/80">
                {isProjected ? '💡 Hover Explainer: Prompt Risk Engine evaluates query intent.' : `⚡ User: ${pe.userRole}`}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Trigger Action for Critical Combination */}
        <button
          onClick={onTriggerCriticalEvent}
          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-rose-600 via-purple-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-xs transition-all shadow-lg shadow-rose-950/50 cursor-pointer flex items-center justify-center space-x-2 border border-rose-400/50"
        >
          <Zap className="w-4 h-4 text-amber-300 animate-bounce" />
          <span>💥 Trigger Critical Intent + Access Combination Event</span>
        </button>

      </div>

    </div>
  );
};
