import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Loader2,
  FileText,
  Activity,
  Layers,
  Pause,
  Play
} from 'lucide-react';
import { TelemetryEngineDef, TelemetryDocDef } from '../telemetryCatalog';

export interface ExtendedEngineDef extends TelemetryEngineDef {
  status: 'pending' | 'running' | 'complete';
  progress: number;
  currentSseMsg: string;
}

export interface ExtendedDocDef extends TelemetryDocDef {
  status: 'pending' | 'running' | 'complete';
  progress: number;
  currentSseMsg: string;
}

interface UnifiedTelemetryCarouselProps {
  phase: 'phase1_graph' | 'phase2_engines' | 'phase3_docs' | 'complete';
  engines: ExtendedEngineDef[];
  completedEnginesCount: number;
  docs: ExtendedDocDef[];
  completedDocsCount: number;
  renderEngineIcon: (iconName: string) => React.ReactNode;
}

export const UnifiedTelemetryCarousel: React.FC<UnifiedTelemetryCarouselProps> = ({
  phase,
  engines,
  completedEnginesCount,
  docs,
  completedDocsCount,
  renderEngineIcon
}) => {
  const isDocumentMode = phase === 'phase3_docs' || phase === 'complete';

  // Carousel Pagination Index
  const [enginePageIndex, setEnginePageIndex] = useState(0);
  const [docPageIndex, setDocPageIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Responsive page sizing calculations
  // Engines: 3 to 4 items per page
  // Docs: 2 to 3 items per page
  const enginesPerPage = 4;
  const docsPerPage = 3;

  const maxEnginePages = Math.ceil(engines.length / enginesPerPage);
  const maxDocPages = Math.ceil(docs.length / docsPerPage);

  // Auto-scroll Timer (5 to 7 seconds -> 6 seconds)
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      if (!isDocumentMode) {
        setEnginePageIndex(prev => (prev + 1) % maxEnginePages);
      } else {
        setDocPageIndex(prev => (prev + 1) % maxDocPages);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [isDocumentMode, isPaused, maxEnginePages, maxDocPages]);

  // Current items to display on active slide
  const visibleEngines = engines.slice(
    enginePageIndex * enginesPerPage,
    (enginePageIndex + 1) * enginesPerPage
  );

  const visibleDocs = docs.slice(
    docPageIndex * docsPerPage,
    (docPageIndex + 1) * docsPerPage
  );

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative rounded-2xl overflow-hidden shadow-2xl transition-all duration-600 border border-border"
    >
      {/* BACKGROUND MODE 1 — DEEP BLUE TRANSLUCENT GLASS & HEARTBEAT WAVEFORM */}
      <div
        className={`absolute inset-0 transition-opacity duration-600 ${
          !isDocumentMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } bg-[#02152E]/90 backdrop-blur-xl animate-pulse-glow border border-[#0078D4]/40`}
      />

      {/* HEARTBEAT WAVEFORM DRIFT (MODE 1) */}
      <div
        className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-600 ${
          !isDocumentMode ? 'opacity-30' : 'opacity-0'
        }`}
      >
        <div className="w-[200%] h-full flex items-center animate-waveform">
          <svg className="w-full h-16 text-[#0078D4]" fill="none" viewBox="0 0 1200 60">
            <path
              d="M 0 30 Q 50 30 100 30 L 120 30 L 130 10 L 140 50 L 150 5 L 160 40 L 170 30 L 200 30 Q 300 30 400 30 L 420 30 L 430 10 L 440 50 L 450 5 L 460 40 L 470 30 L 500 30 Q 600 30 700 30 L 720 30 L 730 10 L 740 50 L 750 5 L 760 40 L 770 30 L 800 30 Q 900 30 1000 30 L 1020 30 L 1030 10 L 1040 50 L 1050 5 L 1060 40 L 1070 30 L 1100 30 Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* BACKGROUND MODE 2 — COPILOT GRADIENT & AI SPARKLE PARTICLES */}
      <div
        className={`absolute inset-0 transition-opacity duration-600 ${
          isDocumentMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } bg-gradient-to-r from-[#21093A]/90 via-[#0A1D3F]/90 to-[#022F43]/90 backdrop-blur-xl border border-purple-500/40`}
      />

      {/* SHIMMER SWEEP OVERLAY */}
      <div className="absolute inset-0 pointer-events-none animate-shimmer opacity-40" />

      {/* AI SPARKLE PARTICLES (MODE 2) */}
      <div
        className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-600 ${
          isDocumentMode ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Sparkles className="absolute left-[10%] bottom-0 w-4 h-4 text-purple-400 animate-sparkle-1" />
        <Sparkles className="absolute left-[30%] bottom-0 w-3.5 h-3.5 text-cyan-400 animate-sparkle-2" />
        <Sparkles className="absolute left-[55%] bottom-0 w-5 h-5 text-indigo-300 animate-sparkle-3" />
        <Sparkles className="absolute left-[75%] bottom-0 w-4 h-4 text-sky-400 animate-sparkle-4" />
        <Sparkles className="absolute left-[90%] bottom-0 w-3 h-3 text-purple-300 animate-sparkle-5" />
      </div>

      {/* CONTENT RAIL */}
      <div className="relative z-10 p-4 space-y-3.5">
        {/* CAROUSEL HEADER RAIL */}
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2.5">
            {!isDocumentMode ? (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-primary/20 border border-primary/50 text-primary">
                <Activity className="w-4 h-4 animate-pulse" />
                <span className="text-xs font-bold font-mono tracking-wider uppercase">
                  MODE 1: TENANT CORRELATION ENGINES (12)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-accent/20 border border-accent/50 text-accent">
                <Sparkles className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-xs font-bold font-mono tracking-wider uppercase">
                  MODE 2: ASSESSMENT DELIVERABLES (6)
                </span>
              </div>
            )}

            <span className="text-xs font-mono font-bold text-foreground/80">
              {!isDocumentMode
                ? `${completedEnginesCount}/12 Complete`
                : `${completedDocsCount}/6 Generated`}
            </span>
          </div>

          {/* CONTROLS & PAGINATION INDICATOR */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="p-1 hover:bg-foreground/10 rounded text-foreground/60 hover:text-foreground transition-colors"
              title={isPaused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>

            <div className="flex items-center gap-1">
              {Array.from({
                length: !isDocumentMode ? maxEnginePages : maxDocPages
              }).map((_, idx) => {
                const isActive = !isDocumentMode
                  ? idx === enginePageIndex
                  : idx === docPageIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (!isDocumentMode) setEnginePageIndex(idx);
                      else setDocPageIndex(idx);
                    }}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      isActive
                        ? !isDocumentMode
                          ? 'w-5 bg-primary'
                          : 'w-5 bg-accent'
                        : 'w-1.5 bg-foreground/20 hover:bg-foreground/40'
                    }`}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-0.5 border border-border rounded bg-muted/30">
              <button
                onClick={() => {
                  if (!isDocumentMode) {
                    setEnginePageIndex(prev => (prev - 1 + maxEnginePages) % maxEnginePages);
                  } else {
                    setDocPageIndex(prev => (prev - 1 + maxDocPages) % maxDocPages);
                  }
                }}
                className="p-1 hover:bg-foreground/15 rounded-l text-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (!isDocumentMode) {
                    setEnginePageIndex(prev => (prev + 1) % maxEnginePages);
                  } else {
                    setDocPageIndex(prev => (prev + 1) % maxDocPages);
                  }
                }}
                className="p-1 hover:bg-foreground/15 rounded-r text-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* CAROUSEL SLIDE CONTAINER */}
        <div className="relative min-h-[160px]">
          {/* MODE 1: ENGINE TILES SLIDE */}
          <div
            className={`transition-all duration-600 ${
              !isDocumentMode
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-8 pointer-events-none absolute inset-0'
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {visibleEngines.map(eng => {
                const isRunning = eng.status === 'running';
                const isComplete = eng.status === 'complete';

                return (
                  <div
                    key={eng.id}
                    className={`p-3.5 rounded-xl border transition-all duration-300 flex flex-col justify-between ${
                      isRunning
                        ? 'bg-background/90 border-primary ring-1 ring-primary/50 shadow-lg shadow-primary/10'
                        : isComplete
                        ? 'bg-background/80 border-status-green/40'
                        : 'bg-muted/40 border-border opacity-60'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                              isComplete
                                ? 'bg-status-green/15 border-status-green text-status-green'
                                : isRunning
                                ? 'bg-primary/30 border-primary text-primary'
                                : 'bg-foreground/5 border-border text-foreground/50'
                            }`}
                          >
                            {isComplete ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : isRunning ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              renderEngineIcon(eng.icon)
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-foreground truncate">{eng.name}</h4>
                        </div>

                        {/* Severity Badge */}
                        <span
                          className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 font-bold ${
                            eng.severity === 'High'
                              ? 'bg-rose-950/90 text-rose-300 border-rose-700'
                              : eng.severity === 'Medium'
                              ? 'bg-amber-950/90 text-amber-300 border-amber-700'
                              : eng.severity === 'Low'
                              ? 'bg-sky-950/90 text-sky-300 border-sky-700'
                              : 'bg-emerald-950/90 text-emerald-300 border-emerald-700'
                          }`}
                        >
                          {eng.severity}
                        </span>
                      </div>

                      <p className="text-[10.5px] text-primary/70 line-clamp-2 leading-relaxed">
                        {eng.description}
                      </p>
                    </div>

                    {/* Bottom Status & SSE Stream */}
                    <div className="mt-3 pt-2 border-t border-border space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-foreground/60">Finding:</span>
                        <span className="text-foreground font-bold">{eng.findingLabel}</span>
                      </div>

                      <div className="text-[9.5px] font-mono text-primary truncate">
                        ↳ {eng.currentSseMsg}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* MODE 2: DOCUMENT TILES SLIDE */}
          <div
            className={`transition-all duration-600 ${
              isDocumentMode
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 translate-x-8 pointer-events-none absolute inset-0'
            }`}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {visibleDocs.map(doc => {
                const isRunning = doc.status === 'running';
                const isComplete = doc.status === 'complete';

                return (
                  <div
                    key={doc.id}
                    className={`p-3.5 rounded-xl border transition-all duration-300 flex flex-col justify-between ${
                      isRunning
                        ? 'bg-background/90 border-accent ring-1 ring-accent/50 shadow-lg shadow-accent/20'
                        : isComplete
                        ? 'bg-background/80 border-status-green/50'
                        : 'bg-muted/40 border-border opacity-60'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                              isComplete
                                ? 'bg-status-green/15 border-status-green text-status-green'
                                : isRunning
                                ? 'bg-accent/30 border-accent text-accent'
                                : 'bg-foreground/5 border-border text-primary-foreground/50'
                            }`}
                          >
                            {isComplete ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : isRunning ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-foreground truncate">{doc.name}</h4>
                        </div>

                        <span className="text-xs font-mono font-bold text-accent">
                          {doc.progress}%
                        </span>
                      </div>

                      <p className="text-[10.5px] text-accent/70 line-clamp-2 leading-relaxed">
                        {doc.description}
                      </p>
                    </div>

                    {/* Progress Bar & SSE Msg */}
                    <div className="mt-3 space-y-1.5">
                      <div className="w-full bg-muted/50 h-1.5 rounded-full overflow-hidden border border-border">
                        <div
                          className="bg-gradient-to-r from-accent to-primary h-full transition-all duration-300"
                          style={{ width: `${doc.progress}%` }}
                        />
                      </div>
                      <div className="text-[9.5px] font-mono text-status-green truncate">
                        ↳ {doc.currentSseMsg}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
