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
        ? 'bg-[#0D0407] border-rose-600/60 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
        : 'bg-[#070B14] border-white/10'
    }`}>
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <MessageSquareCode className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                SOC Telemetry Simulation Stream — What Copilot WOULD Do
              </h3>
              <span className="text-[9px] font-mono bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded font-bold">
                XPIA + Prompt Risk Analysis
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Simulated security event pipeline evaluating real-time document infiltration & bad prompts
            </p>
          </div>
        </div>

        <button
          onClick={onTriggerCriticalCombination}
          className="py-1.5 px-3 rounded-xl bg-gradient-to-r from-rose-600 via-purple-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-xs transition-all shadow-lg shadow-rose-950/50 cursor-pointer flex items-center space-x-2 border border-rose-400/50 shrink-0"
        >
          <Zap className="w-3.5 h-3.5 text-amber-300" />
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
                  ? 'bg-rose-950/30 border-rose-500/50 text-rose-100'
                  : isCritical
                  ? 'bg-rose-950/40 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                  : 'bg-black/60 border-white/10 hover:border-slate-700'
              }`}
            >
              {/* Event Top Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  {evt.type === 'xpia' ? (
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                  ) : (
                    <MessageSquareCode className="w-3.5 h-3.5 text-purple-400" />
                  )}
                  <span className="text-[10px] font-mono font-bold text-slate-300 uppercase">
                    {evt.category}
                  </span>
                </div>

                <div className="flex items-center space-x-1.5">
                  <span className="text-[8.5px] font-mono text-slate-400">
                    {evt.timestamp}
                  </span>
                  <span className={`text-[8.5px] font-mono font-extrabold px-1.5 py-0.2 rounded border ${
                    isCritical
                      ? 'bg-rose-950 text-rose-300 border-rose-700'
                      : 'bg-amber-950 text-amber-300 border-amber-700'
                  }`}>
                    {evt.severity}
                  </span>
                </div>
              </div>

              {/* Event Description */}
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-white leading-tight">
                  {evt.title}
                </h5>
                <p className="text-[10px] text-slate-300 font-mono leading-relaxed">
                  "{evt.description}"
                </p>
              </div>

              {/* Impact Callout */}
              <div className="p-2 rounded-lg bg-black/50 border border-white/5 text-[9.5px] font-mono text-slate-300">
                <span className="text-rose-300 font-bold block">Impact:</span>
                <span>{evt.impact}</span>
              </div>

              {/* Recommended Action Button */}
              {onApplyFixAction && (
                <button
                  onClick={() => onApplyFixAction(evt.recommendedAction)}
                  className="w-full mt-1 py-1 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-300 text-[9.5px] font-mono border border-sky-800/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>Fix: {evt.recommendedAction}</span>
                  <ArrowRight className="w-3 h-3 text-sky-400" />
                </button>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
