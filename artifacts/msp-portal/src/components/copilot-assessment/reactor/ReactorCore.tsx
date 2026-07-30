import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Flame, 
  Zap, 
  AlertTriangle, 
  Globe, 
  Lock, 
  FileCheck, 
  Shield, 
  Activity,
  Sliders,
  CheckCircle2,
  XCircle,
  Sparkles,
  Info
} from 'lucide-react';

export interface PillarRisk {
  id: string;
  name: string;
  shortName: string;
  riskValue: number; // 0 to 100 (Fill represents RISK)
  severity: 'Critical' | 'High' | 'Moderate' | 'Low' | 'Safe';
  details: string;
}

interface ReactorCoreProps {
  enableCopilot: boolean;
  onToggleEnableCopilot: () => void;
  tightenCA01: boolean;
  onToggleCA01: () => void;
  fixUnlabeled: boolean;
  onToggleUnlabeled: () => void;
  resolveDLP: boolean;
  onToggleDLP: () => void;
  removePermanentAdmins: boolean;
  onTogglePIM: () => void;
  externalGuestsLevel: number;
  onChangeExternalGuests: (val: number) => void;
  federatedDomainsLevel?: number;
  onChangeFederatedDomains?: (val: number) => void;
  selectedPillarId?: string;
  onSelectPillar?: (id: string) => void;
}

export const ReactorCore: React.FC<ReactorCoreProps> = ({
  enableCopilot,
  onToggleEnableCopilot,
  tightenCA01,
  onToggleCA01,
  fixUnlabeled,
  onToggleUnlabeled,
  resolveDLP,
  onToggleDLP,
  removePermanentAdmins,
  onTogglePIM,
  externalGuestsLevel,
  onChangeExternalGuests,
  federatedDomainsLevel = 88,
  onChangeFederatedDomains,
  selectedPillarId,
  onSelectPillar
}) => {
  const [hoveredAxisIdx, setHoveredAxisIdx] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // CALCULATE SAFEGUARD COVERAGE VALUES FOR THE 6 AXES (0 to 100%)
  // Outer Fill represents SECURITY COVERAGE & GUARDRAIL STRENGTH (Higher = Stronger Protection)
  // ---------------------------------------------------------------------------
  // 1. Overexposure (MOOX) Scoping: 20% baseline, rises to 92% if fixUnlabeled
  const baseExposed = fixUnlabeled ? 12 : 78;
  const graphScopingCoverage = Math.round(100 - (baseExposed * (0.5 + (externalGuestsLevel / 200))));
  
  // 2. Roles & Admin Protection (PIM): 15% baseline, rises to 98% if removePermanentAdmins
  const pimProtectionCoverage = removePermanentAdmins ? 98 : 15;

  // 3. CA Policy Zero Trust Strictness: 12% baseline, rises to 95% if tightenCA01
  const ca01StrictnessCoverage = tightenCA01 ? 95 : 12;

  // 4. External Sharing Containment: derived from guest and federated domain sliders (10% to 92%)
  const externalContainmentCoverage = Math.max(8, Math.round(100 - (externalGuestsLevel * 0.45 + federatedDomainsLevel * 0.45)));

  // 5. DLP Rules Flow Protection: 18% baseline, rises to 92% if resolveDLP
  const dlpCoverage = resolveDLP ? 92 : 18;

  // 6. Label Coverage & Drift Prevention: 38% baseline, rises to 92% if fixUnlabeled
  const labelCoverage = fixUnlabeled ? 92 : 38;

  // 6 Axes matching Security Safeguard Coverage
  const pillars: PillarRisk[] = [
    {
      id: 'labels',
      name: 'Sensitivity Label Coverage',
      shortName: 'Sensitivity Labels',
      riskValue: labelCoverage, // represents COVERAGE %
      severity: labelCoverage > 75 ? 'Safe' : labelCoverage > 50 ? 'Moderate' : 'Critical',
      details: fixUnlabeled ? '92% files classified with Purview labels' : '38% label coverage — 24 drifted libraries'
    },
    {
      id: 'permissions',
      name: 'Privileged Identity (PIM)',
      shortName: 'Privileged Roles',
      riskValue: pimProtectionCoverage,
      severity: pimProtectionCoverage > 75 ? 'Safe' : 'Critical',
      details: removePermanentAdmins ? 'JIT PIM active — 0 permanent Global Admins' : '12 permanent Global Admin accounts active'
    },
    {
      id: 'conditional_access',
      name: 'Zero Trust CA01 Policy',
      shortName: 'CA01 Zero Trust',
      riskValue: ca01StrictnessCoverage,
      severity: ca01StrictnessCoverage > 75 ? 'Safe' : 'Critical',
      details: tightenCA01 ? 'CA01 strict Zero Trust policy enforced' : 'CA01 disabled — open device posture risk'
    },
    {
      id: 'eeeu',
      name: 'External Sharing Containment',
      shortName: 'External Containment',
      riskValue: externalContainmentCoverage,
      severity: externalContainmentCoverage > 70 ? 'Safe' : externalContainmentCoverage > 40 ? 'Moderate' : 'High',
      details: `${Math.round((externalGuestsLevel / 100) * 1700)} external guest accounts & ${Math.round((federatedDomainsLevel / 100) * 88)} domains`
    },
    {
      id: 'dlp',
      name: 'DLP Flow Protection',
      shortName: 'DLP Protection',
      riskValue: dlpCoverage,
      severity: dlpCoverage > 75 ? 'Safe' : 'Critical',
      details: resolveDLP ? 'DLP active with zero policy conflicts' : '18 active DLP policy conflicts blocking automated flows'
    },
    {
      id: 'overexposure',
      name: 'Graph Scoping & Boundary',
      shortName: 'Graph Scoping',
      riskValue: Math.min(100, Math.max(10, graphScopingCoverage)),
      severity: graphScopingCoverage > 70 ? 'Safe' : graphScopingCoverage > 40 ? 'High' : 'Critical',
      details: fixUnlabeled ? 'Strict Graph scoping — oversharing remediated' : '62% unlabeled files & 142 overshared SharePoint sites'
    }
  ];

  // Calculate Average Safeguard Coverage (0 - 100%)
  const avgCoverage = Math.round(pillars.reduce((acc, p) => acc + p.riskValue, 0) / 6);
  // Blast Radius Score is Inverse of Safeguard Coverage (100 - Coverage)
  const blastRadiusScore = Math.min(95, Math.max(8, 100 - avgCoverage));
  const exposedDataGB = Math.round((blastRadiusScore / 100) * 1420);

  // ---------------------------------------------------------------------------
  // GENERATE DYNAMIC 3-5 SENTENCE SECURITY STORY BASED ON SIMULATED STATE
  // ---------------------------------------------------------------------------
  let storyText = '';
  if (!tightenCA01 && !fixUnlabeled && !resolveDLP && !removePermanentAdmins) {
    storyText = `Your tenant is structurally overshared, with 62% unlabeled files and 142 overshared SharePoint sites. Conditional Access is currently disabled, and external exposure plus label drift mean Copilot would inherit an unconstrained blast radius. If Copilot were enabled today, it could summarize sensitive PHI and CUI across 1,240 external guests and 88 federated domains. Enabling Copilot now creates an immediate multi-vector data exfiltration path.`;
  } else if (tightenCA01 && fixUnlabeled && !removePermanentAdmins) {
    storyText = `After tightening CA01 and fixing unlabeled files, Copilot's blast radius is significantly reduced. Unlabeled PHI and CUI exposure drops by 88%, and Zero Trust device posture ensures only compliant sessions interact with Microsoft Graph. Residual risk remains around 12 permanent Global Admin accounts that could bypass scoping controls.`;
  } else if (tightenCA01 && fixUnlabeled && resolveDLP && removePermanentAdmins) {
    storyText = `With CA01 strictly enforced, sensitivity labels applied across 92% of libraries, DLP flow protection active, and JIT PIM enabled, Copilot's blast radius is fully governed. Microsoft Graph queries are scoped to verified identities with zero permanent admin escalation risks. The tenant is safe for full Copilot deployment.`;
  } else {
    storyText = `With partial guardrails active, Copilot's blast radius is partially mitigated. Sensitivity labels and Conditional Access policies constrain automated Graph discovery, but residual overexposure exists across external guest sharing and unprotected DLP flows. Enabling Copilot requires resolving remaining DLP conflicts.`;
  }

  // Radar SVG Math (Center = 200, 200; Radius = 130)
  const cx = 200;
  const cy = 200;
  const maxRadius = 130;

  const getAxisAngle = (index: number) => -Math.PI / 2 + (index * Math.PI) / 3;

  const getPoint = (index: number, ratio: number) => {
    const angle = getAxisAngle(index);
    const r = maxRadius * Math.min(1.0, Math.max(0.12, ratio));
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const riskPoints = pillars.map((p, idx) => {
    const pt = getPoint(idx, p.riskValue / 100);
    return `${pt.x},${pt.y}`;
  }).join(' ');

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'Critical': return '#EF4444'; // Red
      case 'High': return '#F59E0B';     // Amber
      case 'Moderate': return '#EAB308'; // Yellow
      case 'Safe': return '#10B981';     // Green
      default: return '#3B82F6';
    }
  };

  // Outer blast radius ring calculation
  const blastRadiusRingSize = 140 + (blastRadiusScore * 0.45);

  return (
    <div className="bg-[#060913] border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow-2xl h-full select-none overflow-hidden relative">
      
      {/* ==================================================================== */}
      {/* LAYER 1: SHORT SECURITY STORY (TOP OF CENTER PANEL)                  */}
      {/* ==================================================================== */}
      <div className="bg-[#0B101E] border border-white/10 rounded-xl p-3.5 space-y-2 relative overflow-hidden shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              Copilot Security Narrative & Risk Analysis
            </h4>
          </div>
          <span className={`text-[9.5px] font-mono font-extrabold px-2 py-0.5 rounded border uppercase ${
            blastRadiusScore > 65
              ? 'bg-rose-950 text-rose-300 border-rose-700'
              : blastRadiusScore > 35
              ? 'bg-amber-950 text-amber-300 border-amber-700'
              : 'bg-emerald-950 text-emerald-300 border-emerald-700'
          }`}>
            {blastRadiusScore > 65 ? 'High Blast Radius' : blastRadiusScore > 35 ? 'Moderate Risk' : 'Governed State'}
          </span>
        </div>

        <p className="text-xs font-mono leading-relaxed text-slate-200 bg-black/40 p-2.5 rounded-lg border border-white/5">
          "{storyText}"
        </p>
      </div>

      {/* ==================================================================== */}
      {/* LAYER 2: COPILOT SECURITY RADAR + BLAST RADIUS HEATMAP & TENANT HEALTH */}
      {/* ==================================================================== */}
      <div className="relative flex-1 flex flex-col items-center justify-center min-h-[310px] space-y-2">
        
        {/* RADAR & BLAST TOP HEADER STRIP */}
        <div className="w-full flex flex-wrap items-center justify-between text-[10px] font-mono text-slate-400 z-10 px-2 gap-2">
          <div className="flex items-center space-x-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-slate-200 uppercase tracking-wider">
              1. Safeguard Coverage Radar:
            </span>
            <span className="font-extrabold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-700">
              {avgCoverage}% Guardrails Active
            </span>
          </div>

          {/* TENANT SENTIMENT MASCOT BADGE ("Happier" as blast radius contracts) */}
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-xl border transition-all duration-500 shadow-lg ${
            blastRadiusScore > 60
              ? 'bg-rose-950/80 border-rose-600 text-rose-200 shadow-rose-950/50'
              : blastRadiusScore > 30
              ? 'bg-amber-950/80 border-amber-600 text-amber-200 shadow-amber-950/50'
              : 'bg-emerald-950/90 border-emerald-500 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
          }`}>
            <span className="text-sm">
              {blastRadiusScore > 60 ? '🚨 🤬' : blastRadiusScore > 30 ? '⚠️ 😐' : '✨ 😊 🛡️'}
            </span>
            <div>
              <div className="font-black text-[9.5px] uppercase tracking-wider flex items-center gap-1">
                <span>Blast Radius:</span>
                <span className={blastRadiusScore > 60 ? 'text-rose-400' : blastRadiusScore > 30 ? 'text-amber-400' : 'text-emerald-300'}>
                  {blastRadiusScore}% ({exposedDataGB} GB)
                </span>
              </div>
              <p className="text-[8.5px] font-mono opacity-90">
                {blastRadiusScore > 60
                  ? 'Tenant Alarmed! Copilot has wide exposure hazard'
                  : blastRadiusScore > 30
                  ? 'Tenant Cautious: Partial guardrails active'
                  : 'Tenant Happy! Blast radius fully contained & safe'}
              </p>
            </div>
          </div>
        </div>

        {/* RADAR SVG + BLAST SPHERE OVERLAY */}
        <div className="relative w-full max-w-[380px] h-[280px] flex items-center justify-center">
          <svg viewBox="0 0 400 400" className="w-full h-full max-h-[280px] overflow-visible">
            <defs>
              {/* Coverage Gradient (Outward fill when guardrails enabled) */}
              <radialGradient id="radarShieldGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.80" />
                <stop offset="70%" stopColor="#10B981" stopOpacity="0.60" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0.30" />
              </radialGradient>

              {/* Blast Radius Hazard Gradient */}
              <radialGradient id="blastHazardGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#EF4444" stopOpacity="0.75" />
                <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#7F1D1D" stopOpacity="0.0" />
              </radialGradient>

              <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* 1. CONCENTRIC GRID HEXAGONS (25%, 50%, 75%, 100% COVERAGE) */}
            {[0.25, 0.50, 0.75, 1.0].map((level, lIdx) => {
              const gridPts = pillars.map((_, idx) => {
                const angle = getAxisAngle(idx);
                const r = maxRadius * level;
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ');

              return (
                <g key={lIdx}>
                  <polygon
                    points={gridPts}
                    fill="none"
                    stroke={level === 1.0 ? '#475569' : '#334155'}
                    strokeWidth={level === 1.0 ? '1.5' : '0.75'}
                    strokeDasharray={level === 1.0 ? 'none' : '3 3'}
                    opacity={0.6}
                  />
                  <text
                    x={cx + 6}
                    y={cy - maxRadius * level + 10}
                    fill="#64748B"
                    fontSize="7.5"
                    fontFamily="monospace"
                  >
                    {Math.round(level * 100)}%
                  </text>
                </g>
              );
            })}

            {/* 2. DYNAMIC BLAST RADIUS HAZARD ZONE (Shrinks & contracts as blast radius decreases) */}
            <circle
              cx={cx}
              cy={cy}
              r={blastRadiusRingSize}
              fill="url(#blastHazardGradient)"
              stroke={blastRadiusScore > 60 ? '#EF4444' : blastRadiusScore > 30 ? '#F59E0B' : '#10B981'}
              strokeWidth={blastRadiusScore > 60 ? '2' : '1'}
              strokeDasharray="4 4"
              opacity={0.65}
              filter="url(#radarGlow)"
              className="transition-all duration-700"
            />

            {/* 3. AXIS LINES & TEXT LABELS */}
            {pillars.map((pillar, idx) => {
              const angle = getAxisAngle(idx);
              const edgePt = { cx: cx + maxRadius * Math.cos(angle), cy: cy + maxRadius * Math.sin(angle) };
              const labelPt = { cx: cx + (maxRadius + 28) * Math.cos(angle), cy: cy + (maxRadius + 20) * Math.sin(angle) };
              const isHovered = hoveredAxisIdx === idx || selectedPillarId === pillar.id;

              return (
                <g 
                  key={pillar.id}
                  onMouseEnter={() => setHoveredAxisIdx(idx)}
                  onMouseLeave={() => setHoveredAxisIdx(null)}
                  onClick={() => onSelectPillar && onSelectPillar(pillar.id)}
                  className="cursor-pointer"
                >
                  {/* Axis Line */}
                  <line
                    x1={cx}
                    y1={cy}
                    x2={edgePt.cx}
                    y2={edgePt.cy}
                    stroke={isHovered ? '#38BDF8' : '#64748B'}
                    strokeWidth={isHovered ? '2.5' : '1'}
                    opacity={isHovered ? 1 : 0.6}
                  />

                  {/* Axis Edge Point */}
                  <circle
                    cx={edgePt.cx}
                    cy={edgePt.cy}
                    r={isHovered ? '4' : '2.5'}
                    fill={getSeverityColor(pillar.severity)}
                  />

                  {/* Axis Text Label */}
                  <text
                    x={labelPt.cx}
                    y={labelPt.cy}
                    fill={isHovered ? '#38BDF8' : '#E2E8F0'}
                    fontSize="9"
                    fontWeight="800"
                    fontFamily="monospace"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {pillar.shortName}
                  </text>

                  {/* Coverage Value Subtext */}
                  <text
                    x={labelPt.cx}
                    y={labelPt.cy + 10}
                    fill={pillar.riskValue > 70 ? '#34D399' : pillar.riskValue > 40 ? '#FBBF24' : '#F87171'}
                    fontSize="8.5"
                    fontWeight="900"
                    fontFamily="monospace"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {pillar.riskValue}% Guarded
                  </text>
                </g>
              );
            })}

            {/* 4. FILLED COVERAGE POLYGON (Fill represents SAFEGUARD COVERAGE) */}
            <polygon
              points={pillars.map((p, idx) => {
                const pt = getPoint(idx, p.riskValue / 100);
                return `${pt.x},${pt.y}`;
              }).join(' ')}
              fill="url(#radarShieldGradient)"
              stroke="#34D399"
              strokeWidth="2.5"
              filter="url(#radarGlow)"
              className="transition-all duration-700 opacity-90"
            />

            {/* 5. VERTEX COVERAGE NODES */}
            {pillars.map((pillar, idx) => {
              const pt = getPoint(idx, pillar.riskValue / 100);
              return (
                <circle
                  key={`node-${idx}`}
                  cx={pt.x}
                  cy={pt.y}
                  r="4.5"
                  fill={pillar.riskValue > 70 ? '#10B981' : pillar.riskValue > 40 ? '#F59E0B' : '#EF4444'}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                  className="transition-all duration-700"
                />
              );
            })}

            {/* CENTER TARGET SHIELD EMBLEM */}
            <circle cx={cx} cy={cy} r="12" fill="#090D16" stroke="#10B981" strokeWidth="2" />
            <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="10" fill="#34D399" fontWeight="bold">
              {blastRadiusScore < 30 ? '😊' : blastRadiusScore < 60 ? '😐' : '🤬'}
            </text>
          </svg>
        </div>

        {/* AXIS HOVER TOOLTIP CARD */}
        {hoveredAxisIdx !== null && (
          <div className="bg-black/90 border border-sky-500 text-sky-200 text-[10px] font-mono px-3 py-1 rounded-lg shadow-xl z-20 whitespace-nowrap">
            <strong className="text-white font-bold">{pillars[hoveredAxisIdx].name}:</strong> {pillars[hoveredAxisIdx].details} ({pillars[hoveredAxisIdx].riskValue}% Guardrail Coverage)
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* LAYER 3: SIMULATION CONTROLS (BOTTOM OF CENTER PANEL)                */}
      {/* ==================================================================== */}
      <div className="bg-[#0A0E1A] border border-white/10 rounded-xl p-3 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between text-[10.5px] font-mono font-extrabold text-white border-b border-white/10 pb-1.5">
          <span className="uppercase tracking-wider flex items-center gap-1.5 text-amber-300">
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Simulation Controls — Adjust Governance to Shrink Radar</span>
          </span>
          <span className="text-slate-400 font-normal">Live Blast Radius Modeling</span>
        </div>

        {/* CONTROLS STRIP GRID */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
          
          {/* 1. Enable Copilot Now */}
          <button
            onClick={onToggleEnableCopilot}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
              enableCopilot
                ? 'bg-amber-950/60 border-amber-500 text-amber-200 font-bold'
                : 'bg-slate-900 border-white/10 text-slate-400'
            }`}
          >
            <span>Enable Copilot</span>
            <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-black ${
              enableCopilot ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300'
            }`}>
              {enableCopilot ? 'PROJECTED' : 'OFF'}
            </span>
          </button>

          {/* 2. Tighten CA01 */}
          <button
            onClick={onToggleCA01}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
              tightenCA01
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 font-bold'
                : 'bg-rose-950/50 border-rose-800 text-rose-300'
            }`}
          >
            <span>Tighten CA01</span>
            <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-black ${
              tightenCA01 ? 'bg-emerald-500 text-black' : 'bg-rose-900 text-rose-200'
            }`}>
              {tightenCA01 ? 'ENFORCED' : 'OFF'}
            </span>
          </button>

          {/* 3. Fix Unlabeled Files */}
          <button
            onClick={onToggleUnlabeled}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
              fixUnlabeled
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 font-bold'
                : 'bg-amber-950/50 border-amber-800 text-amber-300'
            }`}
          >
            <span>Fix Unlabeled Files</span>
            <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-black ${
              fixUnlabeled ? 'bg-emerald-500 text-black' : 'bg-amber-900 text-amber-200'
            }`}>
              {fixUnlabeled ? 'FIXED' : 'OFF'}
            </span>
          </button>

          {/* 4. Resolve DLP Conflicts */}
          <button
            onClick={onToggleDLP}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
              resolveDLP
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 font-bold'
                : 'bg-purple-950/50 border-purple-800 text-purple-300'
            }`}
          >
            <span>Resolve DLP Conflicts</span>
            <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-black ${
              resolveDLP ? 'bg-emerald-500 text-black' : 'bg-purple-900 text-purple-200'
            }`}>
              {resolveDLP ? 'ACTIVE' : 'OFF'}
            </span>
          </button>

          {/* 5. Remove Permanent Admins */}
          <button
            onClick={onTogglePIM}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
              removePermanentAdmins
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 font-bold'
                : 'bg-rose-950/50 border-rose-800 text-rose-300'
            }`}
          >
            <span>Remove Perm Admins</span>
            <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-black ${
              removePermanentAdmins ? 'bg-emerald-500 text-black' : 'bg-rose-900 text-rose-200'
            }`}>
              {removePermanentAdmins ? 'JIT PIM' : 'OFF'}
            </span>
          </button>

          {/* 6. Reduce External Guests Slider */}
          <div className="p-1 rounded-lg border border-white/10 bg-black/60 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[8.5px] font-mono">
              <span className="text-slate-300 font-bold">External Guests:</span>
              <span className="text-amber-300 font-extrabold">{Math.round((externalGuestsLevel / 100) * 1700)}</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={externalGuestsLevel}
              onChange={(e) => onChangeExternalGuests(Number(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-400 mt-0.5"
            />
          </div>

          {/* 7. Reduce Federated Domains Slider */}
          <div className="p-1 rounded-lg border border-white/10 bg-black/60 flex flex-col justify-between col-span-2 md:col-span-1">
            <div className="flex items-center justify-between text-[8.5px] font-mono">
              <span className="text-slate-300 font-bold">Federated Domains:</span>
              <span className="text-sky-300 font-extrabold">{Math.round((federatedDomainsLevel / 100) * 88)}</span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              value={federatedDomainsLevel}
              onChange={(e) => onChangeFederatedDomains && onChangeFederatedDomains(Number(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400 mt-0.5"
            />
          </div>

        </div>
      </div>

    </div>
  );
};
