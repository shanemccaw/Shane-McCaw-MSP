export type AssessmentStageStatus = 'done' | 'in_progress' | 'pending';

export interface PipelineDocumentData {
  severity: 'red' | 'yellow' | 'green';
  omgHeroTitle: string;
  omgHeroStat: string;
  omgHeroHighlight: string;
  omgHeroBadge: string;
  executiveSummaryText: string;
  annualWasteCost?: string;
  monthlyWasteCost?: string;
  affectedItemsCount?: number;
  keyFindings: {
    title: string;
    riskLevel: 'CRITICAL' | 'WARNING' | 'INFO';
    detail: string;
    impact: string;
  }[];
  recommendedActions: string[];
  powershellSnippet?: string;
}

export interface AssessmentStage {
  id: string;
  title: string;
  status: AssessmentStageStatus;
  completedAt?: string;
  description?: string;
  documentData?: PipelineDocumentData;
}

export interface MetricGauge {
  id: string;
  title: string;
  score: number; // 0 to 100
  color?: string;
  scanDelay?: string;
  description: string;
  benchmark: string;
  trend: 'up' | 'down' | 'neutral';
  trendValue: string;
}

export interface TelemetryItem {
  id: string;
  type: 'security' | 'groups' | 'licenses' | 'copilot' | 'identity';
  title: string;
  description: string;
  icon: string;
  iconColor: 'green' | 'amber' | 'blue' | 'red';
  architectSays: string;
  architectStatus?: 'success' | 'warning' | 'error' | 'info';
  affectedCount?: number;
  remediationStep?: string;
  powershellSnippet?: string;
}

export interface TenantHealthMetric {
  subject: string;
  score: number;
  fullMark: number;
}

export interface TenantHealthData {
  unifiedScore: number;
  metrics: TenantHealthMetric[];
}

export interface SecurityCoverageData {
  mfaActivePercentage: number;
  conditionalAccessEnforced: number;
  legacyAuthBlocked: number;
  totalUsers: number;
}

export interface GroupLifecycleData {
  activeCount: number;
  staleCount: number;
  orphanCount: number;
  totalGroups: number;
}

export interface LicenseOptimizationData {
  potentialMonthlySavings: number;
  unassignedCount: number;
  idleSKUs: number;
  topSavingsProduct: string;
}

export interface CopilotReadinessData {
  readyUsers: number;
  needsActionUsers: number;
  totalEligible: number;
  topBlocker: string;
}
