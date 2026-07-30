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
      <div className="bg-background border border-primary/30 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between">
        
        {/* Background Stream Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--primary))_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-primary/20 relative z-10">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
              <FileText className="w-3.5 h-3.5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-primary">
                  XPIA Pipeline
                </h4>
                <span className="text-[9px] font-mono bg-primary text-primary border border-primary/30 px-1.5 py-0.2 rounded font-bold">
                  Document Infiltration
                </span>
              </div>
              <p className="text-[9.5px] text-muted-foreground">
                {isProjected ? 'Ghost Stream: What Copilot WOULD touch' : 'Real-Time Data Ingestion Stream'}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-mono text-primary font-bold bg-primary/15 px-2 py-0.5 rounded border border-primary/30">
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
                  ? 'bg-primary/20 border-primary/40 opacity-75 hover:opacity-100'
                  : 'bg-primary/10 border-primary/40 shadow-[0_0_12px_rgba(0,120,212,0.2)]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-bold text-foreground block">
                    {evt.action}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">
                    📄 {evt.documentName}
                  </span>
                </div>
                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  evt.severity === 'Critical'
                    ? 'bg-destructive/10 text-destructive border-destructive/30 animate-pulse'
                    : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                }`}>
                  {evt.sensitivity}
                </span>
              </div>

              {/* Explainer tooltip on hover */}
              <div className="mt-1.5 pt-1 border-t border-primary/30 text-[9px] font-mono text-primary/80">
                {isProjected ? '🔍 Hover Explainer: XPIA tracks data Copilot WOULD access.' : `⚡ Timestamp: ${evt.timestamp}`}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Status */}
        <div className="pt-2 border-t border-primary/30 text-[9.5px] font-mono text-primary flex items-center justify-between">
          <span>XPIA Sensor State:</span>
          <span className="font-bold text-status-green">GROUNDING MONITOR ACTIVE</span>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* RIGHT PIPELINE — PROMPT RISK ENGINE (BAD PROMPTS)                   */}
      {/* -------------------------------------------------------------------- */}
      <div className="bg-background border border-accent/30 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between">
        
        {/* Background Stream Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--accent))_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-accent/20 relative z-10">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
              <MessageSquareCode className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-accent">
                  Prompt Risk Engine
                </h4>
                <span className="text-[9px] font-mono bg-accent text-accent border border-accent px-1.5 py-0.2 rounded font-bold">
                  User Intent Stream
                </span>
              </div>
              <p className="text-[9.5px] text-muted-foreground">
                {isProjected ? 'Ghost Bubbles: Prompts users COULD ask' : 'Real-Time Intent Analysis Stream'}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-mono text-accent font-bold bg-accent/80 px-2 py-0.5 rounded border border-accent">
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
                  ? 'bg-accent/20 border-accent/40 opacity-75 hover:opacity-100'
                  : 'bg-accent/10 border-accent/40 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-extrabold text-accent block font-mono">
                    "{pe.promptText}"
                  </span>
                  <div className="flex items-center space-x-2 text-[9.5px] text-muted-foreground mt-1">
                    <span>Role: <strong className="text-accent">{pe.userRole}</strong></span>
                    <span>• Intent: <strong className="text-status-amber">{pe.intent}</strong></span>
                  </div>
                </div>
                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${
                  pe.severity === 'Critical'
                    ? 'bg-destructive/10 text-destructive border-destructive/30'
                    : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                }`}>
                  {pe.riskCategory}
                </span>
              </div>

              {/* Explainer tooltip on hover */}
              <div className="mt-1.5 pt-1 border-t border-accent/30 text-[9px] font-mono text-accent/80">
                {isProjected ? '💡 Hover Explainer: Prompt Risk Engine evaluates query intent.' : `⚡ User: ${pe.userRole}`}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Trigger Action for Critical Combination */}
        <button
          onClick={onTriggerCriticalEvent}
          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-destructive via-accent to-accent hover:from-destructive hover:to-accent text-primary-foreground font-extrabold text-xs transition-all shadow-lg shadow-destructive/50 cursor-pointer flex items-center justify-center space-x-2 border border-destructive/50"
        >
          <Zap className="w-4 h-4 text-status-amber animate-bounce" />
          <span>💥 Trigger Critical Intent + Access Combination Event</span>
        </button>

      </div>

    </div>
  );
};
