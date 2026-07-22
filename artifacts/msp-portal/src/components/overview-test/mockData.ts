import {
  ScoreCardData,
  CriticalFinding,
  ScoreDriverCategory,
  LicenseMetric,
  IdentityMetrics,
  ComplianceData,
  AutomationTask,
  TenantConfig,
} from './types';

export const initialTenantConfig: TenantConfig = {
  name: 'Contoso Enterprise Global',
  domain: 'contoso.onmicrosoft.com',
  environment: 'Commercial Production (US East)',
  lastScanMinutesAgo: 12,
};

export const initialScoreCards: ScoreCardData[] = [
  {
    id: 'card-health',
    title: 'Tenant Health',
    score: 92,
    change: '+2.4%',
    trend: 'up',
    lastScan: '12 mins ago',
    category: 'health',
    description: 'Overall tenant posture across active workloads & services.',
  },
  {
    id: 'card-security',
    title: 'Security',
    score: 78,
    change: '-1.5%',
    trend: 'down',
    lastScan: '12 mins ago',
    category: 'security',
    description: 'Identity protection, legacy auth status, and threat detection.',
  },
  {
    id: 'card-governance',
    title: 'Governance',
    score: 85,
    change: 'Stable',
    trend: 'stable',
    lastScan: '12 mins ago',
    category: 'governance',
    description: 'Group sprawl, naming policy adherence, and lifecycle policies.',
  },
  {
    id: 'card-copilot',
    title: 'Copilot Readiness',
    score: 64,
    change: '+12%',
    trend: 'up',
    lastScan: '12 mins ago',
    category: 'copilot',
    description: 'Data classification, oversharing exposure, and licensing readiness.',
  },
];

export const initialCriticalFindings: CriticalFinding[] = [
  {
    id: 'finding-1',
    title: 'Admin MFA disabled',
    description: '4 Global Admins identified without multi-factor authentication active.',
    severity: 'red',
    category: 'Identity & Access',
    affectedEntities: 'Global Admin accounts (4 accounts: admin1@contoso.com, sec_lead@contoso.com, etc.)',
    impactScore: 92,
    status: 'active',
    details: 'Accounts with Global Administrator privileges do not have conditional access MFA enforcement enabled. This exposes the directory to credential harvesting and pass-the-hash attacks.',
    remediationSteps: [
      'Enforce Conditional Access Policy "CA001-Require-MFA-Admins"',
      'Configure FIDO2 hardware keys or Microsoft Authenticator for the 4 flagged admin accounts',
      'Revoke existing active sessions for unauthenticated admins',
    ],
    powershellCommand: 'Set-MgUserAuthenticationMethod -UserId "admin1@contoso.com" -RequireMFA $true',
    msGraphEndpoint: 'POST /v1.0/identity/conditionalAccess/policies',
  },
  {
    id: 'finding-2',
    title: 'Legacy Auth active',
    description: 'IMAP and POP3 protocols are enabled for 45% of user mailboxes.',
    severity: 'amber',
    category: 'Authentication',
    affectedEntities: '1,420 user mailboxes across Marketing and Sales departments',
    impactScore: 74,
    status: 'active',
    details: 'Legacy authentication protocols bypass MFA checks and do not support modern authentication tokens. 45% of mailboxes still allow connection over legacy IMAP/POP3.',
    remediationSteps: [
      'Block legacy authentication protocols at the tenant authentication policy level',
      'Transition legacy email clients to Outlook Modern Auth',
      'Audit POP/IMAP telemetry to verify active usage prior to hard block',
    ],
    powershellCommand: 'Set-AuthenticationPolicy -Identity "BlockLegacyAuth" -AllowBasicAuthImap $false -AllowBasicAuthPop $false',
    msGraphEndpoint: 'PATCH /v1.0/organization/{id}/authenticationPolicy',
  },
  {
    id: 'finding-3',
    title: 'Over-privileged app registration',
    description: "A third-party application has 'Directory.ReadWrite.All' permissions.",
    severity: 'amber',
    category: 'Application Security',
    affectedEntities: "App ID: 8f2390a1-4321-419b (Name: 'VendorAnalyticsSync')",
    impactScore: 68,
    status: 'active',
    details: "The application 'VendorAnalyticsSync' possesses full tenant Directory write permissions, allowing potential modification of user accounts, groups, and directory roles without human interaction.",
    remediationSteps: [
      'Revoke high-tier Directory.ReadWrite.All application permission',
      'Grant scoped Directory.Read.All or specific app role assignments',
      'Enable Azure AD Consent Governance policy for 3rd party enterprise applications',
    ],
    powershellCommand: 'Remove-MgServicePrincipalAppRoleAssignment -ServicePrincipalId "8f2390a1-4321-419b" -AppRoleAssignmentId "..."',
    msGraphEndpoint: 'DELETE /v1.0/servicePrincipals/{id}/appRoleAssignments/{id}',
  },
  {
    id: 'finding-4',
    title: 'Unrestricted Guest sharing',
    description: "SharePoint external sharing policy is set to 'Anyone' on 12 sites.",
    severity: 'yellow',
    category: 'Data Governance',
    affectedEntities: '12 SharePoint Sites (including /sites/Finance-Q3 and /sites/Executive-Strategy)',
    impactScore: 55,
    status: 'active',
    details: 'Anonymous "Anyone with the link" sharing is enabled for 12 confidential sites, creating high exposure for sensitive document leaks to unverified external guests.',
    remediationSteps: [
      'Restrict external sharing capability on these 12 sites to "Existing guests" or "New and existing guests"',
      'Set link expiration limits to a maximum of 30 days',
      'Run an automated sensitive data scan across the affected sites',
    ],
    powershellCommand: 'Set-SPOSite -Identity "https://contoso.sharepoint.com/sites/Executive-Strategy" -SharingCapability ExistingGuestSharingOnly',
    msGraphEndpoint: 'PATCH /v1.0/sites/{site-id}/drive',
  },
];

export const scoreDriverCategories: ScoreDriverCategory[] = [
  {
    title: 'Security',
    type: 'security',
    sparklineData: [20, 35, 25, 45, 60, 50, 78],
    items: [
      {
        id: 'sec-1',
        title: 'Global MFA Compliance',
        progress: 88,
        status: 'compliant',
      },
      {
        id: 'sec-2',
        title: 'Shadow IT Discovery',
        description: '12 unauthorized apps found',
        status: 'error',
      },
    ],
  },
  {
    title: 'Governance',
    type: 'governance',
    sparklineData: [40, 50, 55, 65, 70, 80, 85],
    items: [
      {
        id: 'gov-1',
        title: 'Naming Policy Adherence',
        description: '98% compliance on new teams',
        status: 'compliant',
      },
      {
        id: 'gov-2',
        title: 'Stale Groups (90d+)',
        description: '214 inactive groups identified',
        status: 'warning',
      },
    ],
  },
  {
    title: 'Copilot',
    type: 'copilot',
    sparklineData: [15, 25, 30, 42, 50, 58, 64],
    items: [
      {
        id: 'cop-1',
        title: 'Over-shared Content',
        description: 'Risk of sensitive data leakage',
        status: 'error',
      },
      {
        id: 'cop-2',
        title: 'E5 License Eligibility',
        description: '1,200 users ready for deployment',
        status: 'compliant',
      },
    ],
  },
];

export const licenseMetrics: LicenseMetric = {
  totalWasteFormatted: '$12k',
  inactiveE5Count: 142,
  duplicateSubMonthly: '$2.4k/mo',
  copilotReadyUsers: 850,
  valueOpportunities: [
    {
      id: 'val-1',
      title: 'Unused E5 Security Features',
      description: 'Sentinel & Defender for Identity underutilized across E5 seats.',
      amount: '$4.2k',
      type: 'potential_roi',
    },
    {
      id: 'val-2',
      title: 'Optimization Opportunity',
      description: 'Downgrade 200 non-active users to F3 license tiers.',
      amount: '$1.8k',
      type: 'monthly_save',
    },
  ],
};

export const identityMetrics: IdentityMetrics = {
  privilegedRolesCount: 12,
  privilegedRolesChange: '+2 since Monday',
  mfaCoveragePercent: 88,
  mfaGrowthText: '↑ 4% growth',
  conditionalAccessPercent: 100,
  conditionalAccessStatus: 'Optimal',
};

export const complianceData: ComplianceData = {
  overallScore: 82,
  baselines: [
    {
      id: 'base-win11',
      name: 'Windows 11 Baseline',
      score: 94,
      status: 'compliant',
    },
    {
      id: 'base-ios',
      name: 'iOS Security Policy',
      score: 68,
      status: 'danger',
      driftNote: 'Drift detected: 12 devices missing latest OS update.',
    },
    {
      id: 'base-macos',
      name: 'MacOS Compliance',
      score: 81,
      status: 'compliant',
    },
  ],
};

export const automationTasks: AutomationTask[] = [
  {
    id: 'task-1',
    title: 'Monthly Health Report',
    description: 'Comprehensive audit of tenant state across all M365 workloads.',
    actionText: 'Download PDF',
    icon: 'file-text',
    colorClass: 'text-primary',
    actionType: 'pdf',
  },
  {
    id: 'task-2',
    title: 'Auto-generated SOW',
    description: 'Scope of work based on current identified tenant security gaps.',
    actionText: 'Generate Now',
    icon: 'edit-3',
    colorClass: 'text-accent',
    actionType: 'sow',
  },
  {
    id: 'task-3',
    title: 'Remediation Plans',
    description: 'Step-by-step instructions for closing critical tenant findings.',
    actionText: 'Review Plan',
    icon: 'wrench',
    colorClass: 'text-[hsl(40,65%,55%)]',
    actionType: 'plan',
  },
  {
    id: 'task-4',
    title: 'Weekly Drift Alerts',
    description: 'Automated notifications when configuration deviates from baseline.',
    actionText: 'Manage Schedule',
    icon: 'bell-ring',
    colorClass: 'text-destructive',
    badge: 'Active',
    badgeColor: 'bg-[hsl(149,36%,49%)]/20 text-[hsl(149,36%,49%)]',
    actionType: 'alerts',
  },
];
