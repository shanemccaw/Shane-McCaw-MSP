import React from 'react';
import {
  Sparkles,
  ArrowRight,
  Award,
  Search,
  Zap,
  Server,
  Shield,
  Sliders,
  Activity,
  Rocket,
  HeartPulse,
  Landmark,
  Factory,
  Code,
  Building2
} from 'lucide-react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from 'recharts';
import { UnifiedTelemetryCarousel, type ExtendedEngineDef } from '../telemetry/UnifiedTelemetryCarousel';
import { PHASE2_ENGINES } from '../telemetryCatalog';
import { QUIZ_NAV_ITEMS, INDUSTRY_OPTIONS } from '../quizCatalog';

interface HomeScreenProps {
  onStart: () => void;
}

const ENGINE_ICON_MAP: Record<string, React.ElementType> = { Zap, Server, Shield, Sliders, Activity };
const renderEngineIcon = (iconName: string) => {
  const Icon = ENGINE_ICON_MAP[iconName] ?? Server;
  return <Icon className="w-3.5 h-3.5" />;
};

// The real correlation-engine catalog (telemetryCatalog.ts), shown pending --
// this is a preview of the wizard's own Telemetry carousel component, not a
// live run. Every name/description here is the same one the real Telemetry
// step shows once a scan is underway.
const PREVIEW_ENGINES: ExtendedEngineDef[] = PHASE2_ENGINES.map(engine => ({
  id: engine.id,
  name: engine.name,
  description: engine.description,
  icon: engine.icon,
  status: 'pending',
  currentSseMsg: 'Runs live during your real assessment'
}));

const QUIZ_ICON_MAP: Record<string, React.ElementType> = { Rocket, HeartPulse, Landmark, Factory, Code, Building2 };
const PREVIEW_INDUSTRY_IDS = ['space', 'healthcare', 'finance', 'manufacturing', 'technology', 'government'];
const PREVIEW_INDUSTRIES = INDUSTRY_OPTIONS.filter(opt => PREVIEW_INDUSTRY_IDS.includes(opt.id));

const RADAR_AXES = ['Governance', 'Compliance', 'Adoption', 'Copilot', 'Architecture', 'Licensing', 'Security'];
// Illustrative shape only -- these are the real seven pillar names the
// Telemetry radar plots (telemetryComparison.ts), not a real tenant's scores.
const RADAR_PREVIEW_DATA = RADAR_AXES.map((axis, idx) => ({ axis, value: 50 + ((idx * 7) % 30) }));

const GAUGE_RADIUS = 26;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

export const HomeScreen: React.FC<HomeScreenProps> = ({ onStart }) => {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#0F0F0F] scrollbar-thin">
      {/* Hero -- same purple/cyan Copilot gradient language as the wizard's own carousel */}
      <div className="relative overflow-hidden shrink-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/40 via-[#0A1D3F]/30 to-cyan-950/20 pointer-events-none" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <Sparkles className="absolute left-[10%] top-[22%] w-4 h-4 text-purple-400 animate-sparkle-1" />
          <Sparkles className="absolute left-[85%] top-[18%] w-3.5 h-3.5 text-cyan-400 animate-sparkle-2" />
          <Sparkles className="absolute left-[50%] top-[10%] w-5 h-5 text-indigo-300 animate-sparkle-3" />
        </div>

        <div className="relative px-8 py-14 md:px-12 md:py-16 flex flex-col items-center text-center">
          <div className="mb-5 flex items-center gap-2 px-4 py-1.5 border border-purple-500/40 bg-purple-500/10 rounded-full">
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span className="text-purple-300 text-[10px] font-bold uppercase tracking-[2px]">Copilot Readiness Assessment</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-light text-white mb-6 tracking-tight leading-tight max-w-2xl">
            Start Your Copilot{' '}
            <span className="font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Assessment
            </span>
          </h1>
          <p className="text-base md:text-lg text-[#A1A1A1] max-w-xl mb-10 leading-relaxed">
            A {QUIZ_NAV_ITEMS.length}-step guided quiz, a real scan of your Microsoft 365 tenant, and real document
            generation -- combined into a readiness report, governance roadmap, and ROI model built from your own
            tenant.
          </p>
          <button
            onClick={onStart}
            className="group px-10 py-4 bg-gradient-to-r from-purple-500 to-cyan-400 text-white font-bold rounded-md hover:brightness-110 transition-all active:scale-95 shadow-lg shadow-purple-500/30 cursor-pointer text-sm inline-flex items-center gap-2"
          >
            Begin Assessment
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>

      {/* Real preview -- built from the same components the wizard itself uses,
          shown static/pending rather than wired to a live run. */}
      <div className="px-6 md:px-10 pb-6 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[2px] font-bold text-white/40 justify-center">
            <span className="h-px w-8 bg-white/10" />
            A preview of the real assessment
            <span className="h-px w-8 bg-white/10" />
          </div>

          {/* Guided quiz preview -- real step rail + real industry option icons */}
          <div className="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-white/80">Guided Quiz</span>
              <span className="text-[10px] font-mono text-white/50">{QUIZ_NAV_ITEMS.length} real steps</span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
              {QUIZ_NAV_ITEMS.map((item, idx) => (
                <div
                  key={item.id}
                  className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-mono ${
                    idx === 0
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-white/10 bg-white/5 text-white/50'
                  }`}
                >
                  <span className="font-bold">{String(item.stepNumber).padStart(2, '0')}</span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
              {PREVIEW_INDUSTRIES.map(opt => {
                const Icon = QUIZ_ICON_MAP[opt.iconName] ?? Sparkles;
                return (
                  <div
                    key={opt.id}
                    title={opt.title}
                    className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60"
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                );
              })}
              <span className="text-[10px] text-white/40 ml-1">
                Personas, use cases, and industry context -- the same option tiles you'll answer
              </span>
            </div>
          </div>

          {/* The real Telemetry carousel component, shown pending */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold text-white/80">Correlation Engines</span>
              <span className="text-[10px] font-mono text-white/50">Runs after your quiz + scan</span>
            </div>
            <UnifiedTelemetryCarousel
              phase="phase2_engines"
              engines={PREVIEW_ENGINES}
              completedEnginesCount={0}
              docs={[]}
              completedDocsCount={0}
              renderEngineIcon={renderEngineIcon}
            />
          </div>

          {/* Readiness gauge + radar glimpse -- same visual pattern as the
              Telemetry right panel, illustrative values only. */}
          <div className="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-4 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-center">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-[10px] font-mono text-white/50">Readiness Score</span>
              <div className="relative w-16 h-16 flex items-center justify-center">
                <svg className="w-16 h-16 transform -rotate-90">
                  <circle cx="32" cy="32" r={GAUGE_RADIUS} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="transparent" />
                  <circle
                    cx="32"
                    cy="32"
                    r={GAUGE_RADIUS}
                    stroke="url(#homeGaugePreviewGradient)"
                    strokeWidth="5"
                    strokeDasharray={GAUGE_CIRCUMFERENCE}
                    strokeDashoffset={GAUGE_CIRCUMFERENCE * 0.4}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                  <defs>
                    <linearGradient id="homeGaugePreviewGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#22d3ee" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="absolute text-sm font-extrabold text-white font-mono">?</span>
              </div>
              <span className="text-[9px] font-mono text-white/40">Sample layout</span>
            </div>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={RADAR_PREVIEW_DATA}>
                  <PolarGrid stroke="rgba(255,255,255,0.15)" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: '#A1A1A1', fontSize: 8 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Sample" dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Info Cards Section */}
      <div className="p-8 bg-[#161616] border-t border-[#2D2D2D] shrink-0">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-purple-500/40 transition-colors">
            <div className="text-purple-400 mb-3">
              <Award className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">What You'll Get</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              A readiness report, governance roadmap, and personalized ROI model built from your real tenant
              telemetry.
            </p>
          </div>

          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-purple-500/40 transition-colors">
            <div className="text-purple-400 mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">How It Works</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              A {QUIZ_NAV_ITEMS.length}-step guided quiz, then a real scan of your Microsoft 365 tenant and real
              document generation -- this is genuine analysis, not a quick form, so it takes longer than a few
              minutes.
            </p>
          </div>

          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-purple-500/40 transition-colors">
            <div className="text-purple-400 mb-3">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">What We Analyze</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              Correlation between tenant signals, persona behaviors, use-case intensity, and security risk levels.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
