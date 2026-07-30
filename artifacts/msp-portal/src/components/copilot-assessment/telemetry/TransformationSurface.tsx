import React from 'react';
import { 
  Sparkles, 
  AlertTriangle, 
  Zap, 
  ChevronDown, 
  ChevronUp, 
  ShieldAlert, 
  CheckCircle2, 
  Layers, 
  ArrowRight,
  Activity,
  Sliders,
  TrendingUp,
  Lock,
  RefreshCw
} from 'lucide-react';

export interface TransformationItem {
  label: string;
  value: string;
  severity?: 'High' | 'Medium' | 'Low';
  impact?: string;
}

export interface TransformationData {
  title: string;
  category: string;
  
  // BEFORE State (Telemetry Reality)
  before: {
    headline: string;
    telemetryItems: TransformationItem[];
    frictionPoints: string[];
    riskSummary: string;
  };

  // AFTER State (Copilot-Optimized)
  after: {
    headline: string;
    copilotUnlocks: TransformationItem[];
    optimizations: string[];
    roiOutcome: string;
  };
}

interface TransformationSurfaceProps {
  data: TransformationData;
  sliderPos: number; // 0 to 100
  onSliderChange: (pos: number) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const TransformationSurface: React.FC<TransformationSurfaceProps> = ({
  data,
  sliderPos,
  onSliderChange,
  isExpanded,
  onToggleExpand
}) => {
  const beforeOpacity = Math.max(0.15, (100 - sliderPos) / 100);
  const afterOpacity = Math.max(0.15, sliderPos / 100);

  return (
    <div className="w-full my-3 transition-all duration-500">
      
      {/* ------------------------------------------------------------------ */}
      {/* COLLAPSED MODE — GLASS BAR UNDER SHORT STORY                       */}
      {/* ------------------------------------------------------------------ */}
      {!isExpanded ? (
        <div 
          onClick={onToggleExpand}
          className="p-3.5 rounded-xl bg-gradient-to-r from-slate-900/90 via-[#0B132B]/90 to-slate-900/90 border border-sky-500/30 hover:border-purple-500/60 hover:shadow-[0_0_25px_rgba(168,85,247,0.25)] transition-all duration-300 cursor-pointer flex items-center justify-between group relative overflow-hidden select-none"
        >
          {/* Subtle Ambient Pulse Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-rose-500/5 via-sky-500/10 to-purple-500/10 opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none" />

          <div className="flex items-center space-x-3 relative z-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-sky-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 group-hover:scale-110 transition-transform">
              <Sparkles className="w-4 h-4 text-purple-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors">
                  Transformation Preview → Slide to Compare
                </span>
                <span className="text-[9px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider">
                  Interactive Split
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Compare current Telemetry Reality vs Copilot-Optimized Future State
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 relative z-10">
            <span className="text-[10px] font-mono text-sky-400 group-hover:translate-x-1 transition-transform font-bold">
              Expand BEFORE → AFTER
            </span>
            <ChevronDown className="w-4 h-4 text-sky-400 group-hover:translate-y-0.5 transition-transform" />
          </div>
        </div>
      ) : (
        /* ------------------------------------------------------------------ */
        /* EXPANDED MODE — INTERACTIVE SPLIT PANEL                           */
        /* ------------------------------------------------------------------ */
        <div className="rounded-2xl bg-[#090D18] border border-purple-500/40 shadow-[0_0_35px_rgba(168,85,247,0.15)] overflow-hidden transition-all duration-500 space-y-4 p-4 relative">
          
          {/* Header Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-purple-300">
                <Sliders className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-xs font-extrabold text-white tracking-wide uppercase">
                    Workflow Transformation Surface
                  </h3>
                  <span className="text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.2 rounded font-bold">
                    {sliderPos}% OPTIMIZED
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Slide control bar below to crossfade between Telemetry Reality and Copilot State
                </p>
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex items-center space-x-1.5 self-end sm:self-auto">
              <button
                onClick={() => onSliderChange(0)}
                className={`text-[9.5px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  sliderPos === 0
                    ? 'bg-rose-950 text-rose-300 border-rose-500 font-bold shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                0% BEFORE
              </button>
              <button
                onClick={() => onSliderChange(50)}
                className={`text-[9.5px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  sliderPos === 50
                    ? 'bg-sky-950 text-sky-300 border-sky-500 font-bold shadow-[0_0_10px_rgba(0,120,212,0.3)]'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                50% TRANSITION
              </button>
              <button
                onClick={() => onSliderChange(100)}
                className={`text-[9.5px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  sliderPos === 100
                    ? 'bg-purple-950 text-purple-300 border-purple-500 font-bold shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                100% AFTER
              </button>

              <button
                onClick={onToggleExpand}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors cursor-pointer ml-2"
                title="Collapse Surface"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* CONTINUOUS INTERACTIVE SLIDER TRACK                                */}
          {/* ------------------------------------------------------------------ */}
          <div className="space-y-1 bg-black/40 p-2.5 rounded-xl border border-white/5 relative">
            <div className="flex justify-between items-center text-[10px] font-mono font-bold mb-1">
              <span className="text-rose-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                TELEMETRY REALITY (BEFORE)
              </span>
              <span className="text-purple-300 flex items-center gap-1">
                COPILOT-OPTIMIZED (AFTER)
                <Sparkles className="w-3 h-3" />
              </span>
            </div>

            <div className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={100}
                value={sliderPos}
                onChange={(e) => onSliderChange(Number(e.target.value))}
                className="w-full h-2.5 bg-gradient-to-r from-rose-600 via-sky-500 to-purple-600 rounded-lg appearance-none cursor-pointer accent-purple-400 focus:outline-none shadow-inner"
              />
            </div>

            <div className="flex justify-between text-[8.5px] font-mono text-slate-500 pt-0.5">
              <span>High Risk / Manual Friction</span>
              <span className="text-sky-400 font-bold">{sliderPos}% Transformation Ratio</span>
              <span>Automated / 100% Governance</span>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* DUAL SPLIT CARDS (BEFORE vs AFTER)                                  */}
          {/* ------------------------------------------------------------------ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
            
            {/* LEFT CARD — BEFORE (TELEMETRY REALITY) */}
            <div 
              className="p-4 rounded-xl border transition-all duration-300 relative overflow-hidden flex flex-col justify-between space-y-3"
              style={{
                backgroundColor: `rgba(28, 12, 18, ${beforeOpacity * 0.95})`,
                borderColor: `rgba(244, 63, 94, ${beforeOpacity * 0.6})`,
                boxShadow: beforeOpacity > 0.5 ? '0 0 20px rgba(244,63,94,0.15)' : 'none'
              }}
            >
              {/* Background Grid & Heartbeat Ring */}
              <div className="absolute inset-0 bg-[radial-gradient(#f43f5e_1px,transparent_1px)] [background-size:16px_16px] opacity-15 pointer-events-none" />
              <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full border border-rose-500/20 animate-pulse pointer-events-none" />

              <div className="relative z-10 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-rose-500/30">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
                    <span className="text-xs font-extrabold text-rose-300 uppercase tracking-wide">
                      BEFORE: Telemetry Reality
                    </span>
                  </div>
                  <span className="text-[9px] font-mono bg-rose-950/80 text-rose-300 border border-rose-800 px-2 py-0.2 rounded font-bold">
                    Risk Active
                  </span>
                </div>

                <p className="text-xs text-rose-200/90 font-medium leading-relaxed">
                  {data.before.headline}
                </p>

                {/* Telemetry Items */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9.5px] font-mono text-slate-400 uppercase font-bold block">
                    Detected Telemetry Exposures
                  </span>
                  {data.before.telemetryItems.map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between text-[11px] bg-black/60 p-2 rounded-lg border border-rose-900/50"
                    >
                      <span className="text-slate-300 font-medium">{item.label}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                        item.severity === 'High' 
                          ? 'bg-rose-950 text-rose-300 border-rose-800'
                          : 'bg-amber-950 text-amber-300 border-amber-800'
                      }`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Workflow Friction */}
                <div className="space-y-1 pt-1">
                  <span className="text-[9.5px] font-mono text-slate-400 uppercase font-bold block">
                    Workflow Friction Bottlenecks
                  </span>
                  <ul className="space-y-1 text-[10.5px] text-slate-300 list-disc list-inside">
                    {data.before.frictionPoints.map((pt, idx) => (
                      <li key={idx} className="text-rose-200/80">{pt}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Bottom Risk Summary */}
              <div className="relative z-10 pt-2 border-t border-rose-900/40 text-[10px] font-mono text-rose-300 bg-rose-950/40 p-2 rounded-lg flex items-center justify-between">
                <span>Diagnostic Assessment:</span>
                <span className="font-bold">{data.before.riskSummary}</span>
              </div>
            </div>

            {/* RIGHT CARD — AFTER (COPILOT-OPTIMIZED) */}
            <div 
              className="p-4 rounded-xl border transition-all duration-300 relative overflow-hidden flex flex-col justify-between space-y-3"
              style={{
                backgroundColor: `rgba(18, 12, 32, ${afterOpacity * 0.95})`,
                borderColor: `rgba(168, 85, 247, ${afterOpacity * 0.6})`,
                boxShadow: afterOpacity > 0.5 ? '0 0 25px rgba(168,85,247,0.2)' : 'none'
              }}
            >
              {/* Background Copilot Gradient & Sparkles */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-sky-900/20 to-indigo-900/20 pointer-events-none" />
              <div className="absolute top-10 right-10 w-32 h-32 rounded-full bg-purple-500/10 blur-xl pointer-events-none animate-pulse" />

              <div className="relative z-10 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-purple-500/30">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-purple-300 animate-spin-slow" />
                    <span className="text-xs font-extrabold text-purple-200 uppercase tracking-wide">
                      AFTER: Copilot Optimized
                    </span>
                  </div>
                  <span className="text-[9px] font-mono bg-purple-950/80 text-purple-300 border border-purple-800 px-2 py-0.2 rounded font-bold">
                    Zero Risk
                  </span>
                </div>

                <p className="text-xs text-purple-200/90 font-medium leading-relaxed">
                  {data.after.headline}
                </p>

                {/* Copilot Unlocks */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9.5px] font-mono text-slate-400 uppercase font-bold block">
                    Copilot Value Unlocks
                  </span>
                  {data.after.copilotUnlocks.map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between text-[11px] bg-black/60 p-2 rounded-lg border border-purple-900/50"
                    >
                      <span className="text-slate-200 font-medium">{item.label}</span>
                      <span className="text-[9px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.2 rounded">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Optimizations */}
                <div className="space-y-1 pt-1">
                  <span className="text-[9.5px] font-mono text-slate-400 uppercase font-bold block">
                    Automated Workflow Fixes
                  </span>
                  <ul className="space-y-1 text-[10.5px] text-slate-200 list-disc list-inside">
                    {data.after.optimizations.map((opt, idx) => (
                      <li key={idx} className="text-purple-200/90">{opt}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Bottom ROI Summary */}
              <div className="relative z-10 pt-2 border-t border-purple-900/40 text-[10px] font-mono text-emerald-300 bg-emerald-950/30 p-2 rounded-lg flex items-center justify-between border-emerald-900/40">
                <span>Value Outcome:</span>
                <span className="font-extrabold text-emerald-400">{data.after.roiOutcome}</span>
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
};
