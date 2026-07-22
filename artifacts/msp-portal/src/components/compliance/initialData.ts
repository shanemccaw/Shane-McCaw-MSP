import {
  MetricSummary,
  LabelBreakdown,
  TrendDataPoint,
  WorkloadRetention,
  DlpActionCategory,
  AuditRow,
  ComplianceRisk,
  AutomationPatch
} from './types';

export const initialMetricSummary: MetricSummary = {
  healthScore: 81,
  healthChange: 2.4,
  labeledRatio: 68,
  totalItemsDetected: '3.2M items detected',
  retentionCoverageRatio: 92,
  workloadCount: 4,
  auditCompletenessRatio: 88,
  auditCheckStatus: 'Data integrity check passed'
};

export const initialLabelBreakdown: LabelBreakdown = {
  labeledPercentage: 68,
  unlabeledPercentage: 24,
  mislabeledPercentage: 8,
  totalItemsCount: 3200000
};

export const initialTrendData: TrendDataPoint[] = [
  { month: 'JAN', value: 30, itemCount: 142000, highRiskPercentage: 12 },
  { month: 'FEB', value: 45, itemCount: 189000, highRiskPercentage: 18 },
  { month: 'MAR', value: 72, itemCount: 254000, highRiskPercentage: 24 },
  { month: 'APR', value: 65, itemCount: 221000, highRiskPercentage: 21 },
  { month: 'MAY', value: 50, itemCount: 198000, highRiskPercentage: 16 },
  { month: 'JUN', value: 95, itemCount: 312000, highRiskPercentage: 32 }
];

export const initialWorkloads: WorkloadRetention[] = [
  {
    id: 'sharepoint',
    name: 'SharePoint',
    iconName: 'hub',
    percentage: 98,
    statusText: '98% Covered',
    statusType: 'covered',
    segments: { covered: 98, unprotected: 2 },
    details: '1.8M documents across 420 site collections. Full 7-year regulatory retention applied.'
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    iconName: 'cloud',
    percentage: 85,
    statusText: '85% Partial',
    statusType: 'partial',
    segments: { covered: 85, partial: 15 },
    details: '820K personal drives. Partial policy enforcement pending user quota reconciliation.'
  },
  {
    id: 'exchange',
    name: 'Exchange',
    iconName: 'mail',
    percentage: 92,
    statusText: '92% Covered',
    statusType: 'covered',
    segments: { covered: 92, unprotected: 8 },
    details: '4.5M email mailboxes and archives. Automated journal rule enforcement active.'
  },
  {
    id: 'teams',
    name: 'Teams',
    iconName: 'groups',
    percentage: 42,
    statusText: '42% Gaps Detected',
    statusType: 'gaps',
    segments: { covered: 42, gaps: 30, unprotected: 28 },
    details: '650 channels analyzed. Private channel chat logs currently missing default retention tags.'
  }
];

export const initialDlpBreakdown: DlpActionCategory[] = [
  {
    name: 'BLOCK',
    blockPercent: 50,
    allowPercent: 25,
    overridePercent: 25,
    totalEvents: 14250,
    description: 'Proactive transport rule blocks on confidential documents shared externally.'
  },
  {
    name: 'ALLOW',
    allowPercent: 65,
    blockPercent: 35,
    overridePercent: 0,
    totalEvents: 89100,
    description: 'Authorized data transmissions with valid business justification headers.'
  },
  {
    name: 'OVERRIDE',
    overridePercent: 75,
    allowPercent: 15,
    blockPercent: 10,
    totalEvents: 3410,
    description: 'User policy overrides with secondary manager approvals.'
  }
];

export const initialAuditMatrix: AuditRow[] = [
  {
    workload: 'Identity',
    levels: [
      { level: 'L1', intensity: 0.2, status: 'complete', logCount: 145000, lastSync: '2 mins ago' },
      { level: 'L2', intensity: 0.4, status: 'complete', logCount: 298000, lastSync: '1 min ago' },
      { level: 'L3', intensity: 0.6, status: 'complete', logCount: 420000, lastSync: 'Just now' },
      { level: 'L4', intensity: 1.0, status: 'complete', logCount: 890000, lastSync: 'Just now' },
      { level: 'L5', intensity: 1.0, status: 'complete', logCount: 910000, lastSync: 'Just now' }
    ]
  },
  {
    workload: 'Directory',
    levels: [
      { level: 'L1', intensity: 0.2, status: 'complete', logCount: 88000, lastSync: '5 mins ago' },
      { level: 'L2', intensity: 0.4, status: 'complete', logCount: 140000, lastSync: '3 mins ago' },
      { level: 'L3', intensity: 0.6, status: 'complete', logCount: 230000, lastSync: '1 min ago' },
      { level: 'L4', intensity: 0.8, status: 'complete', logCount: 510000, lastSync: 'Just now' },
      { level: 'L5', intensity: 0.9, status: 'complete', logCount: 680000, lastSync: 'Just now' }
    ]
  },
  {
    workload: 'SharePoint',
    levels: [
      { level: 'L1', intensity: 0.1, status: 'complete', logCount: 45000, lastSync: '12 mins ago' },
      { level: 'L2', intensity: 0.2, status: 'complete', logCount: 92000, lastSync: '8 mins ago' },
      { level: 'L3', intensity: 0.4, status: 'critical', logCount: 18000, lastSync: '4 hours ago' },
      { level: 'L4', intensity: 0.6, status: 'critical', logCount: 22000, lastSync: '6 hours ago' },
      { level: 'L5', intensity: 0.8, status: 'critical', logCount: 31000, lastSync: '12 hours ago' }
    ]
  },
  {
    workload: 'Teams',
    levels: [
      { level: 'L1', intensity: 0.2, status: 'complete', logCount: 120000, lastSync: '4 mins ago' },
      { level: 'L2', intensity: 0.3, status: 'complete', logCount: 180000, lastSync: '3 mins ago' },
      { level: 'L3', intensity: 0.4, status: 'complete', logCount: 240000, lastSync: '2 mins ago' },
      { level: 'L4', intensity: 0.5, status: 'complete', logCount: 320000, lastSync: '1 min ago' },
      { level: 'L5', intensity: 0.6, status: 'complete', logCount: 410000, lastSync: 'Just now' }
    ]
  },
  {
    workload: 'Exchange',
    levels: [
      { level: 'L1', intensity: 1.0, status: 'complete', logCount: 950000, lastSync: 'Just now' },
      { level: 'L2', intensity: 1.0, status: 'complete', logCount: 980000, lastSync: 'Just now' },
      { level: 'L3', intensity: 1.0, status: 'complete', logCount: 1050000, lastSync: 'Just now' },
      { level: 'L4', intensity: 1.0, status: 'complete', logCount: 1120000, lastSync: 'Just now' },
      { level: 'L5', intensity: 1.0, status: 'complete', logCount: 1200000, lastSync: 'Just now' }
    ]
  }
];

export const initialRisks: ComplianceRisk[] = [
  {
    id: 'risk-01',
    rank: '01',
    title: 'High-sensitivity unlabeled content in overshared sites',
    severity: 'high',
    affectedWorkloads: ['SharePoint', 'OneDrive'],
    impactScore: 88,
    description: 'Found 14,200 confidential documents with financial PII accessible to anonymous link holders across 12 SharePoint site collections.',
    recommendedAction: 'Apply automated sensitivity tagging and revoke anonymous share links on affected document libraries.',
    status: 'open'
  },
  {
    id: 'risk-02',
    rank: '02',
    title: 'Missing audit logs for critical workloads',
    severity: 'high',
    affectedWorkloads: ['SharePoint', 'Teams'],
    impactScore: 76,
    description: 'Audit log synchronization for SharePoint level L3-L5 telemetry experienced a 6-hour logging delay during system maintenance.',
    recommendedAction: 'Flush log buffer queue and re-sync audit agent endpoints.',
    status: 'open'
  },
  {
    id: 'risk-03',
    rank: '03',
    title: 'Frequent DLP overrides in sensitive locations',
    severity: 'medium',
    affectedWorkloads: ['Exchange', 'Teams'],
    impactScore: 64,
    description: 'Users bypassed DLP prompts 3,410 times in the past 30 days when transferring code snippets and customer identifiers.',
    recommendedAction: 'Enforce step-up multi-factor secondary authentication before allowing override submission.',
    status: 'open'
  },
  {
    id: 'risk-04',
    rank: '04',
    title: 'Retention gaps for regulated data',
    severity: 'medium',
    affectedWorkloads: ['Teams', 'OneDrive'],
    impactScore: 58,
    description: '30% of Teams channels lack mandatory 7-year regulatory retention locks, exposing chat logs to auto-purge policies.',
    recommendedAction: 'Deploy global retention baseline policy rule to all newly provisioned Teams channels.',
    status: 'open'
  },
  {
    id: 'risk-05',
    rank: '05',
    title: 'Policies not aligned with baseline',
    severity: 'low',
    affectedWorkloads: ['Exchange'],
    impactScore: 35,
    description: '14 legacy transport rules are utilizing outdated classification regex patterns for credit card detection.',
    recommendedAction: 'Update regex patterns to compliance standard v4.2.',
    status: 'open'
  }
];

export const initialPatches: AutomationPatch[] = [
  {
    id: 'patch-01',
    title: 'Auto-apply sensitivity labels',
    type: 'label',
    borderAccent: 'primary',
    predictedImpact: 'Predicted increase: +12% label coverage across Teams and Exchange.',
    patchLabel: 'PATCH',
    actionText: 'Apply Configuration',
    applied: false,
    details: {
      description: 'Automatically analyzes unlabeled file contents using server-side classifier and attaches baseline sensitivity tags.',
      scope: '650 Teams Channels, 1,200 Exchange Distribution Groups',
      riskScoreBefore: 42,
      riskScoreAfter: 32
    }
  },
  {
    id: 'patch-02',
    title: 'Tighten DLP rules',
    type: 'dlp',
    borderAccent: 'amber',
    predictedImpact: 'Reduces override risk score from 42 to 28 by enforcing secondary auth.',
    patchLabel: 'PATCH',
    actionText: 'Review Changes',
    applied: false,
    details: {
      description: 'Requires mandatory business justification and biometric/MFA step-up authentication prior to overriding DLP blocks.',
      scope: 'Global DLP Policy Scope (All Workloads)',
      riskScoreBefore: 42,
      riskScoreAfter: 28
    }
  },
  {
    id: 'patch-03',
    title: 'Enforce retention baseline',
    type: 'retention',
    borderAccent: 'green',
    predictedImpact: 'Aligns all 4 workloads to the global 7-year regulatory requirement.',
    patchLabel: 'PATCH',
    actionText: 'Deploy Baseline',
    applied: false,
    details: {
      description: 'Locks retention policies across SharePoint, OneDrive, Exchange, and Teams channels to guarantee regulatory auditability.',
      scope: 'SharePoint, OneDrive, Exchange, Teams',
      riskScoreBefore: 42,
      riskScoreAfter: 18
    }
  }
];
