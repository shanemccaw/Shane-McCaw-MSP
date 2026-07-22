export interface MetricSummary {
  healthScore: number;
  healthChange: number;
  labeledRatio: number;
  totalItemsDetected: string;
  retentionCoverageRatio: number;
  workloadCount: number;
  auditCompletenessRatio: number;
  auditCheckStatus: string;
}

export interface LabelBreakdown {
  labeledPercentage: number;
  unlabeledPercentage: number;
  mislabeledPercentage: number;
  totalItemsCount: number;
}

export interface TrendDataPoint {
  month: string;
  value: number; // sensitivity index
  itemCount: number;
  highRiskPercentage: number;
}

export interface WorkloadRetention {
  id: string;
  name: string;
  iconName: string;
  percentage: number;
  statusText: string;
  statusType: 'covered' | 'partial' | 'gaps';
  segments: {
    covered: number;
    partial?: number;
    gaps?: number;
    unprotected?: number;
  };
  details: string;
}

export interface DlpActionCategory {
  name: 'BLOCK' | 'ALLOW' | 'OVERRIDE';
  blockPercent: number;
  allowPercent: number;
  overridePercent: number;
  totalEvents: number;
  description: string;
}

export interface AuditCell {
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  intensity: number; // 0.1 to 1.0
  status: 'complete' | 'partial' | 'critical';
  logCount: number;
  lastSync: string;
}

export interface AuditRow {
  workload: string;
  levels: AuditCell[];
}

export interface ComplianceRisk {
  id: string;
  rank: '01' | '02' | '03' | '04' | '05';
  title: string;
  severity: 'high' | 'medium' | 'low';
  affectedWorkloads: string[];
  impactScore: number;
  description: string;
  recommendedAction: string;
  status: 'open' | 'investigating' | 'mitigated';
}

export interface AutomationPatch {
  id: string;
  title: string;
  type: 'label' | 'dlp' | 'retention';
  borderAccent: 'primary' | 'amber' | 'green';
  predictedImpact: string;
  patchLabel: string;
  actionText: string;
  applied: boolean;
  details: {
    description: string;
    scope: string;
    riskScoreBefore: number;
    riskScoreAfter: number;
  };
}
