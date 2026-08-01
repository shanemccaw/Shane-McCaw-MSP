import React, { useMemo } from 'react';
import {
  ShieldAlert,
  Users,
  Lock,
  Building2,
  Mail,
  DollarSign,
  Crown,
  Shield,
  Layers,
  KeyRound,
  Sparkles,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { M365DomainCategory } from '../m365ActionRegistry';

// Virtual canvas dimensions the node coordinates below are authored against.
export const CANVAS_WIDTH = 2400;
export const CANVAS_HEIGHT = 1500;

export type ClusterGroup =
  | 'Security'
  | 'Governance'
  | 'Licensing'
  | 'Adoption'
  | 'Copilot'
  | 'Compliance'
  | 'Health';

export interface MapNode {
  id: string;
  label: string;
  category: M365DomainCategory;
  clusterGroup: ClusterGroup;
  isCategoryHub?: boolean;
  isCoreNode?: boolean;
  x: number; // exact canvas pixel X (0..2400)
  y: number; // exact canvas pixel Y (0..1500)
  status: 'healthy' | 'drift' | 'alert';
  healthScore: number;
  activeAlerts: number;
  endpointPath: string;
  endpointCount: number;
  connectedTo: string[]; // Node IDs to draw links to
  latencyHistory: number[];
  drifts: { id: string; title: string; severity: 'High' | 'Medium' | 'Low'; detectedAt: string }[];
  colorHex?: string;
}

// Helper function to generate smooth SVG annular wedge paths for pie chart pillar sectors
export const getPieSectorPath = (
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngleDeg: number,
  endAngleDeg: number
): string => {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;

  const x1 = cx + rOuter * Math.cos(startRad);
  const y1 = cy + rOuter * Math.sin(startRad);

  const x2 = cx + rOuter * Math.cos(endRad);
  const y2 = cy + rOuter * Math.sin(endRad);

  const x3 = cx + rInner * Math.cos(endRad);
  const y3 = cy + rInner * Math.sin(endRad);

  const x4 = cx + rInner * Math.cos(startRad);
  const y4 = cy + rInner * Math.sin(startRad);

  const largeArcFlag = Math.abs(endAngleDeg - startAngleDeg) <= 180 ? 0 : 1;

  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArcFlag} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArcFlag} 0 ${x4} ${y4} Z`;
};

export const PILLAR_SECTORS: { group: ClusterGroup; colorHex: string }[] = [
  { group: 'Security', colorHex: '#0078D4' },
  { group: 'Governance', colorHex: '#6B4EFF' },
  { group: 'Licensing', colorHex: '#009CA6' },
  { group: 'Adoption', colorHex: '#43A047' },
  { group: 'Copilot', colorHex: '#00B7C3' },
  { group: 'Compliance', colorHex: '#5A2D91' },
  { group: 'Health', colorHex: '#F7630C' },
];

export interface BusinessImpactSegmentConfig {
  id: string;
  label: 'Risk' | 'Cost' | 'Productivity' | 'Compliance' | 'Experience';
  iconKey: 'ShieldAlert' | 'DollarSign' | 'Zap' | 'Scale' | 'HeartPulse';
  startAngleDeg: number;
  endAngleDeg: number;
  contributingPillars: { group: ClusterGroup; weight: number }[];
  description: string;
  businessOutcomes: {
    stable: string;
    elevated: string;
    critical: string;
  };
}

export const BUSINESS_IMPACT_SEGMENTS: BusinessImpactSegmentConfig[] = [
  {
    id: 'risk',
    label: 'Risk',
    iconKey: 'ShieldAlert',
    startAngleDeg: -90 + 0.8,
    endAngleDeg: -18 - 0.8,
    contributingPillars: [
      { group: 'Security', weight: 0.5 },
      { group: 'Governance', weight: 0.5 },
    ],
    description: 'Converts identity posture, threat signals, PIM drift, and privileged exposure into enterprise breach risk.',
    businessOutcomes: {
      stable: 'Identity posture is resilient; low probability of breach or credential compromise.',
      elevated: 'MFA coverage or PIM role drift detected; elevated exposure to unauthorized privilege escalation.',
      critical: 'Critical identity gaps and active security alerts expose tenant to severe compromise risks.',
    },
  },
  {
    id: 'cost',
    label: 'Cost',
    iconKey: 'DollarSign',
    startAngleDeg: -18 + 0.8,
    endAngleDeg: 54 - 0.8,
    contributingPillars: [
      { group: 'Licensing', weight: 0.6 },
      { group: 'Compliance', weight: 0.4 },
    ],
    description: 'Translates SKU allocation efficiency, unassigned E5 seats, idle license accumulation, and regulatory fine risks into financial impact.',
    businessOutcomes: {
      stable: 'License spend is optimal; zero unassigned high-tier seats or regulatory penalty exposures.',
      elevated: 'Unassigned E5/Copilot seats detected; estimated $8,400/mo in optimizeable software waste.',
      critical: 'Severe license underutilization and non-compliance fines impacting operational margin.',
    },
  },
  {
    id: 'productivity',
    label: 'Productivity',
    iconKey: 'Zap',
    startAngleDeg: 54 + 0.8,
    endAngleDeg: 126 - 0.8,
    contributingPillars: [
      { group: 'Adoption', weight: 0.4 },
      { group: 'Copilot', weight: 0.4 },
      { group: 'Health', weight: 0.2 },
    ],
    description: 'Quantifies M365 app adoption, AI assist velocity, collaboration depth, and platform availability impact on output.',
    businessOutcomes: {
      stable: 'High M365 collaboration and Copilot usage driving maximum workforce throughput.',
      elevated: 'Copilot usage lagging target benchmarks; user enablement workflow recommended.',
      critical: 'Workload outages or tool adoption bottlenecks causing measurable productivity drop.',
    },
  },
  {
    id: 'compliance',
    label: 'Compliance',
    iconKey: 'Scale',
    startAngleDeg: 126 + 0.8,
    endAngleDeg: 198 - 0.8,
    contributingPillars: [
      { group: 'Compliance', weight: 0.4 },
      { group: 'Security', weight: 0.3 },
      { group: 'Governance', weight: 0.3 },
    ],
    description: 'Measures regulatory alignment (GDPR, HIPAA, ISO27001), DLP enforcement, retention policies, and audit readiness.',
    businessOutcomes: {
      stable: 'Full regulatory compliance across data loss prevention, audit logs, and access policies.',
      elevated: 'Unlabeled sensitive documents and unbacked retention rules present compliance gaps.',
      critical: 'Active DLP policy violations and unfulfilled regulatory requirements expose tenant to regulatory audit penalties.',
    },
  },
  {
    id: 'experience',
    label: 'Experience',
    iconKey: 'HeartPulse',
    startAngleDeg: 198 + 0.8,
    endAngleDeg: 270 - 0.8,
    contributingPillars: [
      { group: 'Adoption', weight: 0.5 },
      { group: 'Health', weight: 0.5 },
    ],
    description: 'Evaluates employee satisfaction, helpdesk ticket aging, endpoint latency, and M365 service friction.',
    businessOutcomes: {
      stable: 'Seamless user experience; low ticket resolution times and high digital satisfaction.',
      elevated: 'Elevated ticket aging in Outlook/Teams issues impacting employee sentiment.',
      critical: 'Service degradation and high ticket backlogs causing end-user friction and support overload.',
    },
  },
];

export interface ImpactRingSegment extends BusinessImpactSegmentConfig {
  weightedPillarScore: number;
  impactScore: number;
  severity: 'stable' | 'elevated' | 'critical';
  rInner: number;
  rOuter: number;
  thicknessDelta: number;
  colorHex: string;
  glowColor: string;
  glowPx: number;
  fillOpacity: number;
  strokeOpacity: number;
  outcomeText: string;
}

// Calculate average health scores for each of the 7 pillars
export const computePillarScores = (nodes: MapNode[]): Record<ClusterGroup, number> => {
  const scores: Record<ClusterGroup, number> = {
    Security: 0,
    Governance: 0,
    Licensing: 0,
    Adoption: 0,
    Copilot: 0,
    Compliance: 0,
    Health: 0,
  };

  (Object.keys(scores) as ClusterGroup[]).forEach((group) => {
    const groupNodes = nodes.filter((n) => n.clusterGroup === group && !n.isCoreNode);
    if (groupNodes.length === 0) {
      scores[group] = 90;
    } else {
      const sum = groupNodes.reduce((acc, n) => acc + n.healthScore, 0);
      scores[group] = Math.round(sum / groupNodes.length);
    }
  });

  return scores;
};

// Dynamic Impact Calculations for the 5 Business Impact Ring Segments
export const computeImpactRingSegments = (
  pillarScores: Record<ClusterGroup, number>
): ImpactRingSegment[] => {
  return BUSINESS_IMPACT_SEGMENTS.map((seg) => {
    // Weighted average of contributing pillar health scores
    let weightedPillarScoreSum = 0;
    let totalWeight = 0;

    seg.contributingPillars.forEach(({ group, weight }) => {
      const pillarScore = pillarScores[group] ?? 85;
      weightedPillarScoreSum += pillarScore * weight;
      totalWeight += weight;
    });

    const weightedPillarScore = totalWeight > 0 ? Math.round(weightedPillarScoreSum / totalWeight) : 85;
    const impactScore = Math.max(0, Math.min(100, 100 - weightedPillarScore));

    // Severity classification
    let severity: 'stable' | 'elevated' | 'critical' = 'stable';
    if (impactScore > 30) {
      severity = 'critical';
    } else if (impactScore > 15) {
      severity = 'elevated';
    }

    // Dynamic visual properties (Thickness, Opacity, Glow, Colors)
    const rInner = 685;
    const rOuterBase = 765;
    const thicknessDelta = Math.round((impactScore / 100) * 18); // expands up to +18px
    const rOuter = rOuterBase + thicknessDelta;

    let colorHex = '#10B981'; // Vibrant Emerald Green when Good / Stable
    let glowColor = 'rgba(16, 185, 129, 0.35)';
    let glowPx = 6;
    let fillOpacity = 0.35;
    let strokeOpacity = 0.65;

    if (severity === 'critical') {
      colorHex = '#D13438'; // Fluent Crimson
      glowColor = 'rgba(209, 52, 56, 0.6)';
      glowPx = 16;
      fillOpacity = 0.78;
      strokeOpacity = 0.95;
    } else if (severity === 'elevated') {
      colorHex = '#D97706'; // Fluent Amber
      glowColor = 'rgba(217, 119, 6, 0.45)';
      glowPx = 8;
      fillOpacity = 0.48;
      strokeOpacity = 0.75;
    } else {
      colorHex = '#10B981'; // Emerald Green for Good / Stable State
      glowColor = 'rgba(16, 185, 129, 0.35)';
      glowPx = 6;
      fillOpacity = 0.35;
      strokeOpacity = 0.65;
    }

    const outcomeText = seg.businessOutcomes[severity];

    return {
      ...seg,
      weightedPillarScore,
      impactScore,
      severity,
      rInner,
      rOuter,
      thicknessDelta,
      colorHex,
      glowColor,
      glowPx,
      fillOpacity,
      strokeOpacity,
      outcomeText,
    };
  });
};

export const getDomainIcon = (category: M365DomainCategory, className = 'w-4 h-4') => {
  switch (category) {
    case 'Auth & MFA':
      return <KeyRound className={className} />;
    case 'Conditional Access':
      return <Lock className={className} />;
    case 'Exchange & Mailbox':
      return <Mail className={className} />;
    case 'Licensing & Billing':
      return <DollarSign className={className} />;
    case 'PIM & Privileged Roles':
      return <Crown className={className} />;
    case 'Security & Defender':
      return <Shield className={className} />;
    case 'Tenant & GDAP':
      return <Building2 className={className} />;
    default:
      return <Layers className={className} />;
  }
};

export interface TopologyCenterPieceProps {
  /** Full topology registry. Connector lines and the derived pillar / impact-ring
   *  scores are always computed from this complete set. */
  nodes: MapNode[];
  selectedNode: MapNode | null;
  onSelectNode: (node: MapNode) => void;
  /** Subset of `nodes` whose badges are actually drawn (toolbar filters live in the
   *  parent). Defaults to `nodes` when the parent does no filtering. */
  filteredNodes?: MapNode[];
  /** Business Impact Ring segment currently opened in the parent's detail drawer. */
  selectedImpactSegment?: string | null;
  onSelectImpactSegment?: (segmentId: string) => void;
}

/**
 * The center-piece of the Tenant Topology Map: the Business Impact Ring, the 7 pillar
 * zone wedges, the animated connector lines, and the core / hub / leaf node badges.
 * Renders into a parent-owned pan & zoom transform box sized CANVAS_WIDTH x CANVAS_HEIGHT.
 */
export const TopologyCenterPiece: React.FC<TopologyCenterPieceProps> = ({
  nodes,
  selectedNode,
  onSelectNode,
  filteredNodes,
  selectedImpactSegment = null,
  onSelectImpactSegment,
}) => {
  const nodesToRender = filteredNodes ?? nodes;

  const pillarScores = useMemo(() => computePillarScores(nodes), [nodes]);

  const impactRingSegmentsCalculated = useMemo(
    () => computeImpactRingSegments(pillarScores),
    [pillarScores]
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* LAYER 3: BUSINESS IMPACT RING (OUTER RING) */}
      {/* ========================================================================= */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {/* Outer Vibrant Green Circle Ring */}
        <div className="w-[1360px] h-[1360px] rounded-full border-2 border-dashed border-emerald-500/30 shadow-[0_0_80px_rgba(16,185,129,0.06)] flex items-center justify-center relative">
          {/* Ring Dimension Badges */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            <span>Business Impact: RISK</span>
          </div>

          <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span>Business Impact: COST</span>
          </div>

          <div className="absolute bottom-6 right-1/4 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            <span>Business Impact: PRODUCTIVITY</span>
          </div>

          <div className="absolute bottom-6 left-1/4 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-purple-400" />
            <span>Business Impact: COMPLIANCE</span>
          </div>

          <div className="absolute left-2 top-1/2 -translate-y-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span>Business Impact: EXPERIENCE</span>
          </div>
        </div>
      </div>

      {/* CSS Animations for Flowing Signal Particles */}
      <style>{`
        @keyframes flowDashAnimation {
          0% { stroke-dashoffset: 40; }
          100% { stroke-dashoffset: 0; }
        }
        .animate-flow-dash {
          animation: flowDashAnimation 1.6s linear infinite;
        }
        .animate-flow-dash-fast {
          animation: flowDashAnimation 1.1s linear infinite;
        }
      `}</style>

      {/* SVG CONNECTION LINES & CROSS-PILLAR LINKS */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      >
        <defs>
          <filter id="fluent-glow-amber" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="fluent-glow-red" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="16" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <marker
            id="arrow-core"
            viewBox="0 0 10 10"
            refX="28"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6" />
          </marker>
          <marker
            id="arrow-cross"
            viewBox="0 0 10 10"
            refX="20"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#a855f7" />
          </marker>
        </defs>

        {/* ========================================================================= */}
        {/* BUSINESS IMPACT RING (5 Circular Segments Surrounding Pillar Layer)       */}
        {/* ========================================================================= */}
        <g className="business-impact-ring-layer">
          {/* Ring Outer Track Backdrop */}
          <circle
            cx={1200}
            cy={750}
            r={725}
            fill="none"
            stroke="#C8C8C8"
            strokeWidth="80"
            strokeOpacity="0.06"
          />

          {/* 5 Segments */}
          {impactRingSegmentsCalculated.map((seg) => {
            const segWedgePath = getPieSectorPath(
              1200,
              750,
              seg.rInner,
              seg.rOuter,
              seg.startAngleDeg,
              seg.endAngleDeg
            );

            const midAngleDeg = (seg.startAngleDeg + seg.endAngleDeg) / 2;
            const labelRad = (midAngleDeg * Math.PI) / 180;
            const labelRadius = seg.rOuter + 42;
            const labelX = 1200 + labelRadius * Math.cos(labelRad);
            const labelY = 750 + labelRadius * Math.sin(labelRad);

            const isSelected = selectedImpactSegment === seg.id;

            return (
              <g
                key={`impact-ring-seg-${seg.id}`}
                className="cursor-pointer group pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectImpactSegment) onSelectImpactSegment(seg.id);
                }}
              >
                {/* Segment Arc Path */}
                <path
                  d={segWedgePath}
                  fill={seg.colorHex}
                  fillOpacity={isSelected ? 0.90 : seg.fillOpacity}
                  stroke={seg.colorHex}
                  strokeWidth={isSelected ? 4 : 2}
                  strokeOpacity={isSelected ? 1.0 : seg.strokeOpacity}
                  filter={
                    seg.severity === 'critical'
                      ? 'url(#fluent-glow-red)'
                      : seg.severity === 'elevated'
                      ? 'url(#fluent-glow-amber)'
                      : undefined
                  }
                  className="transition-all duration-300 group-hover:fill-opacity-90 group-hover:stroke-white"
                />

                {/* Segment Pulsing Edge Accent when Elevated or Critical */}
                {seg.severity !== 'stable' && (
                  <path
                    d={getPieSectorPath(
                      1200,
                      750,
                      seg.rOuter - 4,
                      seg.rOuter,
                      seg.startAngleDeg,
                      seg.endAngleDeg
                    )}
                    fill={seg.colorHex}
                    fillOpacity={0.9}
                    className="animate-pulse"
                  />
                )}

                {/* M365 Business Impact Label Badge */}
                <g transform={`translate(${labelX}, ${labelY})`}>
                  <rect
                    x="-85"
                    y="-16"
                    width="170"
                    height="32"
                    rx="16"
                    fill="#090D16"
                    fillOpacity="0.96"
                    stroke={isSelected ? '#FFFFFF' : seg.colorHex}
                    strokeWidth={isSelected ? '2.5' : '1.5'}
                    strokeOpacity={isSelected ? '1' : '0.8'}
                    className="shadow-xl"
                  />
                  <text
                    x="0"
                    y="-2"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="11"
                    fontWeight="900"
                    letterSpacing="1"
                    fontFamily="sans-serif"
                  >
                    {seg.label.toUpperCase()}
                  </text>
                  <text
                    x="0"
                    y="10"
                    textAnchor="middle"
                    fill={seg.colorHex}
                    fontSize="9"
                    fontWeight="800"
                    fontFamily="monospace"
                  >
                    {seg.impactScore}% IMPACT
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {/* ========================================================================= */}
        {/* PIE CHART SECTOR ZONES (7 Equal Ring Sectors Cut Around the Core)        */}
        {/* ========================================================================= */}
        {PILLAR_SECTORS.map((sector, index) => {
          const sectorAngle = 360 / 7;
          const midAngleDeg = -90 + index * sectorAngle;
          const gapDeg = 0.6;
          const startAngleDeg = midAngleDeg - sectorAngle / 2 + gapDeg;
          const endAngleDeg = midAngleDeg + sectorAngle / 2 - gapDeg;

          const wedgePath = getPieSectorPath(1200, 750, 160, 670, startAngleDeg, endAngleDeg);

          const tagRad = (midAngleDeg * Math.PI) / 180;
          const tagX = 1200 + 640 * Math.cos(tagRad);
          const tagY = 750 + 640 * Math.sin(tagRad);

          // Watermark Background Icon position (centered at radius ~410px in each zone)
          const bgIconX = 1200 + 410 * Math.cos(tagRad);
          const bgIconY = 750 + 410 * Math.sin(tagRad);
          const iconScale = 6.8; // ~163px watermark
          const iconOffset = -12 * iconScale;

          return (
            <g key={`pie-sector-${sector.group}`} className="pie-sector-group">
              {/* Translucent Pie Slice Background */}
              <path
                d={wedgePath}
                fill={sector.colorHex}
                fillOpacity={0.09}
                stroke={sector.colorHex}
                strokeWidth={1.5}
                strokeOpacity={0.4}
              />

              {/* Sector Inner Border Glow */}
              <path
                d={wedgePath}
                fill="none"
                stroke={sector.colorHex}
                strokeWidth={3}
                strokeOpacity={0.12}
              />

              {/* Subtle Large Background Watermark Icon for Zone */}
              <g
                transform={`translate(${bgIconX + iconOffset}, ${bgIconY + iconOffset}) scale(${iconScale})`}
                className="pointer-events-none opacity-25"
              >
                {sector.group === 'Security' && (
                  <path
                    d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                    fill={sector.colorHex}
                    fillOpacity="0.08"
                    stroke={sector.colorHex}
                    strokeWidth="1.6"
                    strokeOpacity="0.6"
                  />
                )}
                {sector.group === 'Governance' && (
                  <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                    <line x1="2" y1="22" x2="22" y2="22" />
                    <line x1="6" y1="18" x2="6" y2="11" />
                    <line x1="10" y1="18" x2="10" y2="11" />
                    <line x1="14" y1="18" x2="14" y2="11" />
                    <line x1="18" y1="18" x2="18" y2="11" />
                    <polygon points="12 2 20 7 4 7 12 2" fill={sector.colorHex} fillOpacity="0.08" />
                    <line x1="2" y1="11" x2="22" y2="11" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </g>
                )}
                {sector.group === 'Licensing' && (
                  <g stroke={sector.colorHex} strokeWidth="2.0" strokeOpacity="0.7" fill="none">
                    <line x1="12" y1="2" x2="12" y2="22" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </g>
                )}
                {sector.group === 'Adoption' && (
                  <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" fill={sector.colorHex} fillOpacity="0.08" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </g>
                )}
                {sector.group === 'Copilot' && (
                  <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.7" fill="none">
                    {/* Primary 4-point AI Sparkle */}
                    <path
                      d="M12 2L13.9 7.8A2 2 0 0 0 15.2 9.1L21 11L15.2 12.9A2 2 0 0 0 13.9 14.2L12 20L10.1 14.2A2 2 0 0 0 8.8 12.9L3 11L8.8 9.1A2 2 0 0 0 10.1 7.8L12 2Z"
                      fill={sector.colorHex}
                      fillOpacity="0.14"
                    />
                    {/* Satellite Sparkle 1 */}
                    <path
                      d="M19 2L19.8 4.2A1 1 0 0 0 20.8 5.2L23 6L20.8 6.8A1 1 0 0 0 19.8 7.8L19 10L18.2 7.8A1 1 0 0 0 17.2 6.8L15 6L17.2 5.2A1 1 0 0 0 18.2 4.2L19 2Z"
                      fill={sector.colorHex}
                      fillOpacity="0.20"
                    />
                    {/* Satellite Sparkle 2 */}
                    <path
                      d="M5 16L5.6 17.6A1 1 0 0 0 6.4 18.4L8 19L6.4 19.6A1 1 0 0 0 5.6 20.4L5 22L4.4 20.4A1 1 0 0 0 3.6 19.6L2 19L3.6 18.4A1 1 0 0 0 4.4 17.6L5 16Z"
                      fill={sector.colorHex}
                      fillOpacity="0.20"
                    />
                  </g>
                )}
                {sector.group === 'Compliance' && (
                  <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" fill={sector.colorHex} fillOpacity="0.08" />
                    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" fill={sector.colorHex} fillOpacity="0.08" />
                    <path d="M7 21h10" />
                    <path d="M12 3v18" />
                    <path d="M3 7h18" />
                  </g>
                )}
                {sector.group === 'Health' && (
                  <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                    <path
                      d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
                      fill={sector.colorHex}
                      fillOpacity="0.08"
                    />
                    <path
                      d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"
                      stroke={sector.colorHex}
                      strokeWidth="2"
                      strokeOpacity="0.8"
                    />
                  </g>
                )}
              </g>

              {/* Sector Tag Badge Header */}
              <g transform={`translate(${tagX}, ${tagY})`}>
                <rect
                  x="-65"
                  y="-12"
                  width="130"
                  height="24"
                  rx="12"
                  fill="#090d16"
                  fillOpacity="0.95"
                  stroke={sector.colorHex}
                  strokeWidth="1.5"
                  strokeOpacity="0.8"
                />
                <text
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fill={sector.colorHex}
                  fontSize="10"
                  fontWeight="800"
                  letterSpacing="1"
                  fontFamily="monospace"
                >
                  {sector.group.toUpperCase()} ZONE
                </text>
              </g>
            </g>
          );
        })}

        {/* Render Connection Lines between Nodes */}
        {nodes.map((sourceNode) => {
          return sourceNode.connectedTo.map((targetId) => {
            const targetNode = nodes.find((n) => n.id === targetId);
            if (!targetNode) return null;

            const isHighlighted =
              selectedNode?.id === sourceNode.id || selectedNode?.id === targetNode.id;

            const isCoreLink = targetNode.id === 'hub-core' || sourceNode.id === 'hub-core';
            const isCrossLink = !isCoreLink && !sourceNode.isCategoryHub && !targetNode.isCategoryHub;

            const strokeColor = isHighlighted
              ? '#38bdf8'
              : isCrossLink
              ? '#a855f7'
              : isCoreLink
              ? '#3b82f6'
              : sourceNode.colorHex || '#1e293b';

            const particleColor = isCrossLink
              ? '#c084fc'
              : isCoreLink
              ? '#60a5fa'
              : '#38bdf8';

            return (
              <g key={`${sourceNode.id}-${targetNode.id}`}>
                {/* Base Line */}
                <line
                  x1={sourceNode.x}
                  y1={sourceNode.y}
                  x2={targetNode.x}
                  y2={targetNode.y}
                  stroke={strokeColor}
                  strokeWidth={isHighlighted ? 3 : isCoreLink ? 2.5 : isCrossLink ? 1.8 : 1.4}
                  strokeOpacity={isHighlighted ? 0.9 : isCrossLink ? 0.6 : 0.45}
                  strokeDasharray={isCrossLink ? '4,6' : undefined}
                />

                {/* Animated Flow Line Overlay */}
                <line
                  x1={sourceNode.x}
                  y1={sourceNode.y}
                  x2={targetNode.x}
                  y2={targetNode.y}
                  stroke={particleColor}
                  strokeWidth={isCoreLink ? 2.2 : 1.5}
                  strokeDasharray={isCoreLink ? '8,12' : '6,10'}
                  strokeOpacity={0.7}
                  className={isCoreLink ? 'animate-flow-dash-fast' : 'animate-flow-dash'}
                />

                {/* Traveling Pulse Circle Particle */}
                <circle r={isCoreLink ? 4 : 2.5} fill={particleColor}>
                  <animateMotion
                    path={`M ${sourceNode.x} ${sourceNode.y} L ${targetNode.x} ${targetNode.y}`}
                    dur={isCoreLink ? '1.8s' : '2.2s'}
                    repeatCount="indefinite"
                  />
                </circle>
              </g>
            );
          });
        })}
      </svg>

      {/* ========================================================================= */}
      {/* LAYER 1 & LAYER 2: INTERACTIVE RADIAL MAP NODES */}
      {/* ========================================================================= */}
      {nodesToRender.map((node) => {
        const isSelected = selectedNode?.id === node.id;

        // Render Center Core Node (Tenant Intelligence Core)
        if (node.isCoreNode) {
          return (
            <div
              key={node.id}
              onClick={() => onSelectNode(node)}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-30 cursor-pointer group"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
            >
              {/* Glowing Core Aura */}
              <div className="w-40 h-40 rounded-full bg-white/10 border-2 border-white/60 shadow-[0_0_60px_rgba(255,255,255,0.4)] backdrop-blur-md flex flex-col items-center justify-center p-3 text-center transition-transform group-hover:scale-105 active:scale-95">
                <div className="w-10 h-10 rounded-full bg-white text-slate-950 flex items-center justify-center font-black shadow-lg mb-1">
                  <Sparkles className="w-5 h-5 text-blue-600 animate-spin-slow" />
                </div>
                <div className="text-xs font-black text-white tracking-tight uppercase leading-tight font-mono">
                  Tenant Intelligence
                </div>
                <div className="text-[10px] font-bold text-blue-200">CORE LAYER</div>
                <div className="mt-1 px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-[9px] font-mono border border-blue-400/40">
                  122 Signals Polled
                </div>
              </div>
            </div>
          );
        }

        // Render Category Pillar Hub Nodes (Layer 2)
        if (node.isCategoryHub) {
          return (
            <div
              key={node.id}
              onClick={() => onSelectNode(node)}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
            >
              <div
                className={`px-4 py-2.5 rounded-2xl border-2 backdrop-blur-md shadow-2xl flex items-center gap-3 transition-transform group-hover:scale-105 active:scale-95 ${
                  node.status === 'alert'
                    ? 'bg-red-950/80 border-red-500 text-red-200 shadow-[0_0_25px_rgba(239,68,68,0.4)] animate-pulse'
                    : node.status === 'drift'
                    ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                    : 'bg-slate-900/90 border-slate-700 text-slate-100'
                }`}
                style={{
                  borderColor: node.colorHex || undefined,
                }}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shadow-md"
                  style={{ backgroundColor: node.colorHex || '#3b82f6' }}
                >
                  {getDomainIcon(node.category, 'w-4 h-4')}
                </div>
                <div>
                  <div className="text-xs font-black tracking-tight flex items-center gap-1.5">
                    <span>{node.label}</span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.2 rounded font-bold"
                      style={{ backgroundColor: `${node.colorHex}33`, color: node.colorHex }}
                    >
                      {node.healthScore}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <span>{node.clusterGroup} Pillar</span>
                    {node.activeAlerts > 0 && (
                      <span className="text-red-400 font-bold">• {node.activeAlerts} Alerts</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Render Primary Pillar Sub-Nodes (35 Nodes)
        return (
          <div
            key={node.id}
            onClick={() => onSelectNode(node)}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 cursor-pointer group"
            style={{ left: `${node.x}px`, top: `${node.y}px` }}
          >
            <div
              className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-2 backdrop-blur-xs shadow-md transition-all group-hover:scale-110 active:scale-95 ${
                isSelected
                  ? 'ring-2 ring-blue-400 bg-blue-900/80 border-blue-400 text-white z-30 scale-110'
                  : node.status === 'alert'
                  ? 'bg-red-950/70 border-red-500/80 text-red-200'
                  : node.status === 'drift'
                  ? 'bg-amber-950/70 border-amber-500/80 text-amber-200'
                  : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:border-slate-600'
              }`}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: node.colorHex || '#38bdf8' }}
              />
              <span className="font-semibold text-[11px] whitespace-nowrap">{node.label}</span>
            </div>
          </div>
        );
      })}
    </>
  );
};
