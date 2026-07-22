// 'pending' = real waiting state (document not started yet); 'failed' widens
// the original mock union to carry the real backend document status value —
// a failed generation must render honestly, never as a perpetual "pending".
export type AssessmentStageStatus = 'done' | 'in_progress' | 'pending' | 'failed';

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

// Widened for real data (same real-data-first discipline as /overview-test's
// types reconstruction): `score`/`title` are the only fields the real pillar
// data (status.radar.pillars) actually provides. Benchmark/trend/velocity have
// no real backend source yet, so they are optional and simply not rendered for
// real gauges — never fabricated. `notCovered` is the honest state for a
// pillar the customer's scanned package genuinely doesn't cover.
export interface MetricGauge {
  id: string;
  title: string;
  score: number; // 0 to 100
  color?: string;
  scanDelay?: string;
  description?: string;
  benchmark?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  /** True when the scanned package doesn't cover this pillar — renders an
   * honest "not covered by this scan" state instead of a fabricated score. */
  notCovered?: boolean;
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
