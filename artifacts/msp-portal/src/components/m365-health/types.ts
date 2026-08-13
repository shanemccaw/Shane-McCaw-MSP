export type TimeFrame = '24h' | '7d' | '30d' | 'YTD';

export interface PillarData {
  id: string;
  name: string;
  shortCode: 'SEC' | 'GOV' | 'COMP' | 'ADOP' | 'COPILOT' | 'ARCH' | 'LIC';
  score: number;
  change: number; // percentage change e.g. 12 or -2
  trend: 'up' | 'down' | 'stable';
  icon: string;
  color: string;
  bars: number[]; // heights e.g. [2, 4, 3, 6]
  description: string;
  targetScore: number;
  subMetrics: {
    name: string;
    value: string | number;
    status: 'good' | 'warning' | 'critical';
  }[];
  recommendations: string[];
}

export interface IntelligenceSignal {
  id: string;
  pillar: string;
  iconName: string;
  title: string;
  description: string;
  severity: 'Critical' | 'Warning' | 'Optimization';
  timestamp: string;
  acknowledged?: boolean;
  remediated?: boolean;
}

export interface RiskHeatmapCell {
  id: string;
  rowCategory: 'IDENTITY' | 'POLICIES' | 'DRIFT';
  colIndex: number;
  severityColor: string; // Tailwind class or hex
  label: string;
  riskScore: number; // 0-100
  affectedCount: number;
}

export interface CostBreakdownItem {
  label: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface SecurityTrendPoint {
  label: string;
  alerts: number;
  riskyUsers: number;
  privSignIns: number;
}

export interface ComplianceDriftData {
  labeledContentPercent: number;
  dlpOverridesLow: number;
  policyDriftMed: number;
}

export interface AdoptionMetricItem {
  id: string;
  name: string;
  percentage: number;
  icon: string;
  color: string;
}
