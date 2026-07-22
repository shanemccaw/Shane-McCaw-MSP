import {
  ExecutiveMetrics,
  HeatmapEntity,
  LabelCoverageData,
  DlpMetric,
  EnablementControl,
  ReadinessBlocker,
  AutomationTask
} from '../types';

export const initialMetrics: ExecutiveMetrics = {
  aggregateReadiness: 82,
  readinessStatus: 'Ready for Scale',
  permissionsHygiene: 78,
  sensitiveDataProtection: 85,
  copilotRiskScore: 14,
  liveDataFeedActive: true,
  lastUpdated: '2026-07-22 14:20 UTC'
};

export const initialHeatmapEntities: HeatmapEntity[] = [
  {
    id: 'ent-1',
    name: 'Finance_Shared_H1',
    icon: 'cloud',
    anonymousLinks: 12,
    externalUsers: 45,
    broadInternal: 128,
    highPermissionApps: 67,
    riskLevel: 'high',
    type: 'SharePoint Site',
    owner: 'finance-admin@company.com',
    lastAudited: '2026-07-15'
  },
  {
    id: 'ent-2',
    name: 'HR_Global_Private',
    icon: 'cloud',
    anonymousLinks: 0,
    externalUsers: 4,
    broadInternal: 12,
    highPermissionApps: 2,
    riskLevel: 'low',
    type: 'Secure Vault',
    owner: 'hr-security@company.com',
    lastAudited: '2026-07-18'
  },
  {
    id: 'ent-3',
    name: 'Engineering_Internal_Wiki',
    icon: 'groups',
    anonymousLinks: 8,
    externalUsers: 22,
    broadInternal: 89,
    highPermissionApps: 14,
    riskLevel: 'medium',
    type: 'Teams Channel',
    owner: 'eng-lead@company.com',
    lastAudited: '2026-07-20'
  },
  {
    id: 'ent-4',
    name: 'Exec_Strategy_Vault',
    icon: 'cloud',
    anonymousLinks: 0,
    externalUsers: 1,
    broadInternal: 3,
    highPermissionApps: 2,
    riskLevel: 'low',
    type: 'Confidential Drive',
    owner: 'ciso-office@company.com',
    lastAudited: '2026-07-21'
  },
  {
    id: 'ent-5',
    name: 'Marketing_Asset_Library',
    icon: 'folder_open',
    anonymousLinks: 42,
    externalUsers: 156,
    broadInternal: 210,
    highPermissionApps: 38,
    riskLevel: 'critical',
    type: 'Public Asset Repository',
    owner: 'mktg-ops@company.com',
    lastAudited: '2026-07-10'
  }
];

export const initialLabelCoverage: LabelCoverageData = {
  labeledPercent: 75,
  labeledCount: '1.2M files',
  unlabeledPercent: 20,
  unlabeledCount: '320K files',
  mislabeledPercent: 5,
  mislabeledCount: '80K files'
};

export const initialDlpMetrics: DlpMetric[] = [
  {
    id: 'dlp-1',
    title: 'Critical Violations',
    blockedPercent: 82,
    overridePercent: 10,
    allowedPercent: 8
  },
  {
    id: 'dlp-2',
    title: 'External Exfiltration',
    blockedPercent: 94,
    overridePercent: 4,
    allowedPercent: 2
  },
  {
    id: 'dlp-3',
    title: 'Internal Sharing Drift',
    blockedPercent: 65,
    overridePercent: 20,
    allowedPercent: 15
  }
];

export const initialRadarData = [
  { axis: 'Permissions Hygiene', score: 78, target: 90 },
  { axis: 'Label Coverage', score: 75, target: 85 },
  { axis: 'DLP Alignment', score: 82, target: 95 },
  { axis: 'External Exposure', score: 62, target: 80 },
  { axis: 'Risky Identities', score: 88, target: 95 },
  { axis: 'Copilot Alerts', score: 70, target: 85 }
];

export const initialEnablementControls: EnablementControl[] = [
  {
    id: 'ctrl-1',
    name: 'CA Policies Configured',
    statusText: 'ACTIVE',
    statusType: 'active',
    icon: 'check_circle',
    detail: 'Conditional Access rules active for Microsoft 365 Copilot endpoint access.'
  },
  {
    id: 'ctrl-2',
    name: 'MFA Enforcement',
    statusText: '100%',
    statusType: 'percent',
    icon: 'check_circle',
    detail: 'All licensed Copilot accounts strictly require Hardware/App MFA.'
  },
  {
    id: 'ctrl-3',
    name: 'Sensitive Data Labeled',
    statusText: '75%',
    statusType: 'warning',
    icon: 'warning',
    detail: 'Sensitivity labels missing on 25% of enterprise data repositories.'
  },
  {
    id: 'ctrl-4',
    name: 'DLP Rules Aligned',
    statusText: 'READY',
    statusType: 'ready',
    icon: 'check_circle',
    detail: 'Data Loss Prevention policies aligned across Exchange, OneDrive & Teams.'
  },
  {
    id: 'ctrl-5',
    name: 'Risky Identities Remediated',
    statusText: 'PENDING',
    statusType: 'pending',
    icon: 'pending',
    detail: '14 flagged high-risk user credentials awaiting automated sign-in block.'
  },
  {
    id: 'ctrl-6',
    name: 'Baseline Scan Status',
    statusText: 'RUNNING',
    statusType: 'running',
    icon: 'sync',
    detail: 'Real-time telemetry baseline scan currently auditing tenant object trees.'
  }
];

export const initialBlockers: ReadinessBlocker[] = [
  {
    id: 'blk-1',
    rank: '01',
    title: 'Shadow IT Teams Channels',
    description: '32 channels found with anonymous access enabled',
    severity: 'CRITICAL',
    source: 'Teams Admin',
    recommendation: 'Disable anonymous guest access policies across all 32 channels and enforce team privacy.',
    impactScore: 12
  },
  {
    id: 'blk-2',
    rank: '02',
    title: 'Legacy Guest Accounts',
    description: '450+ inactive guest accounts with global read access',
    severity: 'HIGH',
    source: 'Entra ID',
    recommendation: 'Run entitlement review and revoke guest memberships older than 60 days.',
    impactScore: 8
  },
  {
    id: 'blk-3',
    rank: '03',
    title: "Missing 'Highly Confidential' Labels",
    description: 'Recent financial audits lack MIP labeling',
    severity: 'HIGH',
    source: 'Purview',
    recommendation: 'Apply auto-labeling policy rule to all financial repository folders in SharePoint.',
    impactScore: 7
  },
  {
    id: 'blk-4',
    rank: '04',
    title: 'DLP Policy Conflict in OneDrive',
    description: 'Block override rules detected in EMEA region',
    severity: 'MEDIUM',
    source: 'DLP Engine',
    recommendation: 'Standardize European regional DLP exception lists to remove unrestricted overrides.',
    impactScore: 5
  },
  {
    id: 'blk-5',
    rank: '05',
    title: 'User Education Deficit',
    description: '60% of pilot group failed readiness assessment',
    severity: 'MEDIUM',
    source: 'HR Training',
    recommendation: 'Assign mandatory 15-minute Copilot Data Handling course via Viva Learning.',
    impactScore: 4
  }
];

export const initialAutomationTasks: AutomationTask[] = [
  {
    id: 'auto-1',
    type: 'PATCH',
    title: 'Auto-tighten permissions',
    description: "Remove sharing links that haven't been used in 90+ days across identified sites.",
    buttonText: 'DEPLOY FIX',
    accentColor: 'primary',
    status: 'idle',
    progress: 0
  },
  {
    id: 'auto-2',
    type: 'PATCH',
    title: 'Auto-label sensitive data',
    description: 'Execute AI-driven classification on the 20% of unlabeled identified sensitive files.',
    buttonText: 'START LABELING',
    accentColor: 'secondary',
    status: 'idle',
    progress: 0
  },
  {
    id: 'auto-3',
    type: 'DELETE',
    title: 'Enforce CA baseline',
    description: 'Purge legacy guest access and enforce strict MFA for all Copilot-enabled accounts.',
    buttonText: 'HARDEN TENANT',
    accentColor: 'error',
    status: 'idle',
    progress: 0
  }
];
