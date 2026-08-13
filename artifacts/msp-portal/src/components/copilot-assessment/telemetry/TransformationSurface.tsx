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
          className="p-3.5 rounded-xl bg-gradient-to-r from-secondary/90 via-background/90 to-secondary/90 border border-primary/30 hover:border-accent/60 hover:shadow-[0_0_25px_rgba(168,85,247,0.25)] transition-all duration-300 cursor-pointer flex items-center justify-between group relative overflow-hidden select-none"
        >
          {/* Subtle Ambient Pulse Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-destructive/5 via-primary/10 to-accent/10 opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none" />

          <div className="flex items-center space-x-3 relative z-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-primary/20 border border-accent/40 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
              <Sparkles className="w-4 h-4 text-accent animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                  Transformation Preview → Slide to Compare
                </span>
                <span className="text-[9px] font-mono bg-accent/20 text-accent border border-accent/40 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider">
                  Interactive Split
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Compare current Telemetry Reality vs Copilot-Optimized Future State
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 relative z-10">
            <span className="text-[10px] font-mono text-primary group-hover:translate-x-1 transition-transform font-bold">
              Expand BEFORE → AFTER
            </span>
            <ChevronDown className="w-4 h-4 text-primary group-hover:translate-y-0.5 transition-transform" />
          </div>
        </div>
      ) : (
        /* ------------------------------------------------------------------ */
        /* EXPANDED MODE — INTERACTIVE SPLIT PANEL                           */
        /* ------------------------------------------------------------------ */
        <div className="rounded-2xl bg-background border border-accent/40 shadow-[0_0_35px_rgba(168,85,247,0.15)] overflow-hidden transition-all duration-500 space-y-4 p-4 relative">
          
          {/* Header Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                <Sliders className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-xs font-extrabold text-foreground tracking-wide uppercase">
                    Workflow Transformation Surface
                  </h3>
                  <span className="text-[9px] font-mono bg-status-green/20 text-status-green border border-status-green/30 px-2 py-0.2 rounded font-bold">
                    {sliderPos}% OPTIMIZED
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
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
                    ? 'bg-destructive/10 text-destructive border-destructive font-bold shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                0% BEFORE
              </button>
              <button
                onClick={() => onSliderChange(50)}
                className={`text-[9.5px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  sliderPos === 50
                    ? 'bg-primary/10 text-primary border-primary font-bold shadow-[0_0_10px_rgba(0,120,212,0.3)]'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                50% TRANSITION
              </button>
              <button
                onClick={() => onSliderChange(100)}
                className={`text-[9.5px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                  sliderPos === 100
                    ? 'bg-accent/10 text-accent border-accent font-bold shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                100% AFTER
              </button>

              <button
                onClick={onToggleExpand}
                className="p-1.5 rounded-lg bg-secondary hover:bg-secondary text-muted-foreground hover:text-foreground border border-border transition-colors cursor-pointer ml-2"
                title="Collapse Surface"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* CONTINUOUS INTERACTIVE SLIDER TRACK                                */}
          {/* ------------------------------------------------------------------ */}
          <div className="space-y-1 bg-muted/40 p-2.5 rounded-xl border border-border/50 relative">
            <div className="flex justify-between items-center text-[10px] font-mono font-bold mb-1">
              <span className="text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                TELEMETRY REALITY (BEFORE)
              </span>
              <span className="text-accent flex items-center gap-1">
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
                className="w-full h-2.5 bg-gradient-to-r from-destructive via-primary to-accent rounded-lg appearance-none cursor-pointer accent-accent focus:outline-none shadow-inner"
              />
            </div>

            <div className="flex justify-between text-[8.5px] font-mono text-muted-foreground pt-0.5">
              <span>High Risk / Manual Friction</span>
              <span className="text-primary font-bold">{sliderPos}% Transformation Ratio</span>
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
              <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--destructive))_1px,transparent_1px)] [background-size:16px_16px] opacity-15 pointer-events-none" />
              <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full border border-destructive/20 animate-pulse pointer-events-none" />

              <div className="relative z-10 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-destructive/30">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-destructive animate-pulse" />
                    <span className="text-xs font-extrabold text-destructive uppercase tracking-wide">
                      BEFORE: Telemetry Reality
                    </span>
                  </div>
                  <span className="text-[9px] font-mono bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.2 rounded font-bold">
                    Risk Active
                  </span>
                </div>

                <p className="text-xs text-destructive/90 font-medium leading-relaxed">
                  {data.before.headline}
                </p>

                {/* Telemetry Items */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9.5px] font-mono text-muted-foreground uppercase font-bold block">
                    Detected Telemetry Exposures
                  </span>
                  {data.before.telemetryItems.map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between text-[11px] bg-muted/60 p-2 rounded-lg border border-destructive/30"
                    >
                      <span className="text-muted-foreground font-medium">{item.label}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                        item.severity === 'High' 
                          ? 'bg-destructive/10 text-destructive border-destructive/30'
                          : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                      }`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Workflow Friction */}
                <div className="space-y-1 pt-1">
                  <span className="text-[9.5px] font-mono text-muted-foreground uppercase font-bold block">
                    Workflow Friction Bottlenecks
                  </span>
                  <ul className="space-y-1 text-[10.5px] text-muted-foreground list-disc list-inside">
                    {data.before.frictionPoints.map((pt, idx) => (
                      <li key={idx} className="text-destructive/80">{pt}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Bottom Risk Summary */}
              <div className="relative z-10 pt-2 border-t border-destructive/40 text-[10px] font-mono text-destructive bg-destructive/10 p-2 rounded-lg flex items-center justify-between">
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
              <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-primary/20 to-accent/20 pointer-events-none" />
              <div className="absolute top-10 right-10 w-32 h-32 rounded-full bg-accent/10 blur-xl pointer-events-none animate-pulse" />

              <div className="relative z-10 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-accent/30">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-accent animate-spin-slow" />
                    <span className="text-xs font-extrabold text-accent uppercase tracking-wide">
                      AFTER: Copilot Optimized
                    </span>
                  </div>
                  <span className="text-[9px] font-mono bg-accent/80 text-accent border border-accent px-2 py-0.2 rounded font-bold">
                    Zero Risk
                  </span>
                </div>

                <p className="text-xs text-accent font-medium leading-relaxed">
                  {data.after.headline}
                </p>

                {/* Copilot Unlocks */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9.5px] font-mono text-muted-foreground uppercase font-bold block">
                    Copilot Value Unlocks
                  </span>
                  {data.after.copilotUnlocks.map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between text-[11px] bg-muted/60 p-2 rounded-lg border border-accent/50"
                    >
                      <span className="text-foreground font-medium">{item.label}</span>
                      <span className="text-[9px] font-mono font-bold bg-accent/10 text-accent border border-accent px-1.5 py-0.2 rounded">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Optimizations */}
                <div className="space-y-1 pt-1">
                  <span className="text-[9.5px] font-mono text-muted-foreground uppercase font-bold block">
                    Automated Workflow Fixes
                  </span>
                  <ul className="space-y-1 text-[10.5px] text-foreground list-disc list-inside">
                    {data.after.optimizations.map((opt, idx) => (
                      <li key={idx} className="text-accent">{opt}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Bottom ROI Summary */}
              <div className="relative z-10 pt-2 border-t border-accent/40 text-[10px] font-mono text-status-green bg-status-green/10 p-2 rounded-lg flex items-center justify-between border-status-green/30">
                <span>Value Outcome:</span>
                <span className="font-extrabold text-status-green">{data.after.roiOutcome}</span>
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
};
