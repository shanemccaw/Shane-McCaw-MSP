import React from 'react';
import { 
  FileText, 
  MessageSquareCode, 
  Zap, 
  AlertTriangle, 
  ShieldAlert, 
  ArrowRight,
  CheckCircle2
} from 'lucide-react';

export interface SocEventCard {
  id: string;
  type: 'xpia' | 'prompt_risk';
  category: string;
  severity: 'Critical' | 'High' | 'Medium';
  title: string;
  description: string;
  impact: string;
  recommendedAction: string;
  timestamp: string;
}

interface SocSimulationStreamProps {
  mode: 'projected' | 'soc' | 'redteam';
  events: SocEventCard[];
  onTriggerCriticalCombination: () => void;
  onApplyFixAction?: (action: string) => void;
}

export const SocSimulationStream: React.FC<SocSimulationStreamProps> = ({
  mode,
  events,
  onTriggerCriticalCombination,
  onApplyFixAction
}) => {
  const isRedTeam = mode === 'redteam';

  return (
    <div className={`p-4 rounded-2xl border transition-all space-y-3 select-none ${
      isRedTeam
        ? 'bg-background border-destructive/60 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
        : 'bg-background border-border'
    }`}>
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
            <MessageSquareCode className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                SOC Telemetry Simulation Stream — What Copilot WOULD Do
              </h3>
              <span className="text-[9px] font-mono bg-accent text-accent border border-accent px-2 py-0.5 rounded font-bold">
                XPIA + Prompt Risk Analysis
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Simulated security event pipeline evaluating real-time document infiltration & bad prompts
            </p>
          </div>
        </div>

        <button
          onClick={onTriggerCriticalCombination}
          className="py-1.5 px-3 rounded-xl bg-gradient-to-r from-destructive via-accent to-accent hover:from-destructive hover:to-accent text-primary-foreground font-extrabold text-xs transition-all shadow-lg shadow-destructive/50 cursor-pointer flex items-center space-x-2 border border-destructive/50 shrink-0"
        >
          <Zap className="w-3.5 h-3.5 text-status-amber" />
          <span>💥 Trigger Critical Intent + Access Combination</span>
        </button>
      </div>

      {/* EVENT CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {events.map((evt) => {
          const isCritical = evt.severity === 'Critical';

          return (
            <div
              key={evt.id}
              className={`p-3 rounded-xl border transition-all relative flex flex-col justify-between space-y-2 ${
                isRedTeam
                  ? 'bg-destructive/10/30 border-destructive/50 text-destructive'
                  : isCritical
                  ? 'bg-destructive/10/40 border-destructive/60 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                  : 'bg-muted/60 border-border hover:border-border'
              }`}
            >
              {/* Event Top Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  {evt.type === 'xpia' ? (
                    <FileText className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <MessageSquareCode className="w-3.5 h-3.5 text-accent" />
                  )}
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">
                    {evt.category}
                  </span>
                </div>

                <div className="flex items-center space-x-1.5">
                  <span className="text-[8.5px] font-mono text-muted-foreground">
                    {evt.timestamp}
                  </span>
                  <span className={`text-[8.5px] font-mono font-extrabold px-1.5 py-0.2 rounded border ${
                    isCritical
                      ? 'bg-destructive/10 text-destructive border-destructive'
                      : 'bg-status-amber/10 text-status-amber border-status-amber'
                  }`}>
                    {evt.severity}
                  </span>
                </div>
              </div>

              {/* Event Description */}
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-foreground leading-tight">
                  {evt.title}
                </h5>
                <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">
                  "{evt.description}"
                </p>
              </div>

              {/* Impact Callout */}
              <div className="p-2 rounded-lg bg-muted/50 border border-border/50 text-[9.5px] font-mono text-muted-foreground">
                <span className="text-destructive font-bold block">Impact:</span>
                <span>{evt.impact}</span>
              </div>

              {/* Recommended Action Button */}
              {onApplyFixAction && (
                <button
                  onClick={() => onApplyFixAction(evt.recommendedAction)}
                  className="w-full mt-1 py-1 px-2 rounded-lg bg-secondary hover:bg-secondary text-primary text-[9.5px] font-mono border border-primary/30/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>Fix: {evt.recommendedAction}</span>
                  <ArrowRight className="w-3 h-3 text-primary" />
                </button>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
