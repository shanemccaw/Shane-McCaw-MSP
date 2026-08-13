import {
  GovernanceHealth,
  RoleInventoryItem,
  AdminExposureMetric,
  GroupStat,
  HeatmapCell,
  PolicyDriftPoint,
  GovernanceRisk,
  GovernanceAutomation,
  ThreatLandscapeInfo
} from './types';

export const initialHealthData: GovernanceHealth = {
  score: 74,
  maxScore: 100,
  driftEvents30D: 142,
  driftTrendPercent: 12,
  adminAccounts: 28,
  pendingReviewsCount: 4,
  groupSprawlIndex: 68
};

export const initialRoleInventory: RoleInventoryItem[] = [
  {
    id: 'role-1',
    roleName: 'Global Administrator',
    count: 4,
    maxRecommended: 20,
    barColor: '#ef4444', // status-red
    badgeText: 'Critical Access'
  },
  {
    id: 'role-2',
    roleName: 'User Administrator',
    count: 12,
    maxRecommended: 20,
    barColor: '#479ef5', // primary
    badgeText: 'Active'
  },
  {
    id: 'role-3',
    roleName: 'Security Reader',
    count: 18,
    maxRecommended: 20,
    barColor: '#22c55e', // status-green
    badgeText: 'Compliant'
  },
  {
    id: 'role-4',
    roleName: 'Exchange Admin',
    count: 6,
    maxRecommended: 20,
    barColor: '#c084fc', // status-violet
    badgeText: 'Review Soon'
  }
];

export const initialAdminExposure: AdminExposureMetric[] = [
  {
    key: 'adminCount',
    label: 'Admin Count',
    value: 75,
    rawValue: '28 Total',
    description: 'High ratio of privileged admins relative to tenant size.'
  },
  {
    key: 'noCA',
    label: 'No CA Enforced',
    value: 45,
    rawValue: '3 Policies Unenforced',
    description: '3 admin accounts lack mandatory conditional access policies.'
  },
  {
    key: 'staleAccounts',
    label: 'Stale Accounts',
    value: 62,
    rawValue: '8 Inactive > 90d',
    description: '8 admin credentials haven\'t authenticated in over 90 days.'
  },
  {
    key: 'riskySignIns',
    label: 'Risky Sign-ins',
    value: 80,
    rawValue: '14 Anomalies Flagged',
    description: '14 suspicious authentication requests logged in past 30 days.'
  }
];

export const initialGroupStats: GroupStat[] = [
  {
    label: 'TOTAL GROUPS',
    value: '1,402',
    numericValue: 1402,
    icon: 'Users',
    colorClass: 'text-[#479ef5]'
  },
  {
    label: 'EMPTY GROUPS',
    value: '312',
    numericValue: 312,
    icon: 'UserMinus',
    colorClass: 'text-[#eab308]'
  },
  {
    label: 'WITHOUT OWNERS',
    value: '42',
    numericValue: 42,
    icon: 'AlertTriangle',
    colorClass: 'text-[#ef4444]',
    borderLeft: true
  },
  {
    label: 'EXTERNAL MEMBERS',
    value: '156',
    numericValue: 156,
    icon: 'Globe',
    colorClass: 'text-[#c084fc]'
  }
];

// Generate deterministic 12x6 heatmap cells
export const generateHeatmapCells = (): HeatmapCell[] => {
  const cells: HeatmapCell[] = [];
  const riskLevels: ('low' | 'medium' | 'high' | 'critical')[] = ['low', 'medium', 'high', 'critical'];
  const categories: ('ownerless' | 'external' | 'stale')[] = ['ownerless', 'external', 'stale'];

  // Fixed pattern matching the image representation
  const criticalIndices = [4, 13, 21, 32, 45, 54, 61];
  const mediumIndices = [0, 5, 8, 14, 17, 24, 28, 38, 41, 49, 58, 67, 70];
  const highIndices = [2, 9, 19, 29, 36, 47, 52, 63, 68];

  for (let i = 0; i < 72; i++) {
    const row = Math.floor(i / 12);
    const col = i % 12;

    let category: 'ownerless' | 'external' | 'stale' = 'ownerless';
    if (col >= 4 && col < 8) category = 'external';
    if (col >= 8) category = 'stale';

    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (criticalIndices.includes(i)) riskLevel = 'critical';
    else if (highIndices.includes(i)) riskLevel = 'high';
    else if (mediumIndices.includes(i)) riskLevel = 'medium';

    cells.push({
      id: i,
      row,
      col,
      riskLevel,
      category,
      groupName: `Sec-Group-${(i + 101).toString(16).toUpperCase()}-${category.toUpperCase()}`,
      membersCount: Math.floor(Math.random() * 85) + 3,
      lastAudited: `${Math.floor(Math.random() * 28) + 1} days ago`
    });
  }

  return cells;
};

export const initialPolicyDriftTrend: PolicyDriftPoint[] = [
  { date: '01 SEP', changes: 42, driftScore: 18 },
  { date: '08 SEP', changes: 68, driftScore: 32 },
  { date: '15 SEP', changes: 51, driftScore: 49 },
  { date: '22 SEP', changes: 89, driftScore: 64 },
  { date: '30 SEP', changes: 112, driftScore: 82 }
];

export const initialGovernanceRisks: GovernanceRisk[] = [
  {
    id: 'risk-1',
    rank: '01',
    title: 'Ownerless high-privilege groups',
    description: '12 groups with Tier-0 access lack assigned owners.',
    priority: 'CRITICAL PRIORITY',
    category: 'Group Governance',
    affectedItemsCount: 12,
    remediationPath: 'PATCH /groups/{id}/owners'
  },
  {
    id: 'risk-2',
    rank: '02',
    title: 'Admin roles with excessive membership',
    description: 'Global Admin count exceeds threshold (Recommended: 5, Actual: 28).',
    priority: 'CRITICAL PRIORITY',
    category: 'Identity & Access',
    affectedItemsCount: 23,
    remediationPath: 'PATCH /roles/global-admin/members'
  },
  {
    id: 'risk-3',
    rank: '03',
    title: 'Frequent policy changes without approvals',
    description: '86 changes detected in last 48 hours without corresponding Jira tickets.',
    priority: 'HIGH PRIORITY',
    category: 'Policy Audit',
    affectedItemsCount: 86,
    remediationPath: 'POST /audit/policy-verify'
  },
  {
    id: 'risk-4',
    rank: '04',
    title: 'External users in sensitive groups',
    description: "Unverified external domains found in 'Financial Data' security group.",
    priority: 'HIGH PRIORITY',
    category: 'External Access',
    affectedItemsCount: 19,
    remediationPath: 'DELETE /groups/financial-data/external'
  },
  {
    id: 'risk-5',
    rank: '05',
    title: 'Conditional Access policies misaligned with baseline',
    description: '3 policies found with MFA bypass enabled for admin roles.',
    priority: 'HIGH PRIORITY',
    category: 'Conditional Access',
    affectedItemsCount: 3,
    remediationPath: 'PATCH /conditionalAccess/policies/{id}'
  }
];

export const initialAutomations: GovernanceAutomation[] = [
  {
    id: 'auto-1',
    title: 'Auto-assign group owners',
    description: 'Remediation for ownerless groups based on most active members.',
    httpMethod: 'PATCH',
    endpoint: '/groups/{id}',
    status: 'READY',
    icon: 'UserPlus',
    actionText: 'Apply Policy',
    accentColor: 'primary'
  },
  {
    id: 'auto-2',
    title: 'Reduce admin role membership',
    description: 'Downgrade stale admin accounts to standard user roles.',
    httpMethod: 'PATCH',
    endpoint: '/users/{id}',
    status: 'READY',
    icon: 'UserMinus',
    actionText: 'Execute Batch',
    accentColor: 'violet'
  },
  {
    id: 'auto-3',
    title: 'Enforce CA baseline',
    description: 'Overwrite misconfigured CA policies with corporate baseline templates.',
    httpMethod: 'PATCH',
    endpoint: '.../conditionalAccess/policies/{id}',
    status: 'READY',
    icon: 'ShieldCheck',
    actionText: 'Standardize',
    accentColor: 'green'
  }
];

export const threatLandscapeInfo: ThreatLandscapeInfo = {
  title: 'Threat Landscape Analysis',
  subtitle: 'Governance risk profiles are currently tracking 24% higher than the previous quarter due to increased lateral movement risks.',
  increasePercentage: 24,
  imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD3Oa8bGqNIW7V4XTANAt5VGoU-ui5wgrg2Js63e9AyMTNDs5Wg7Vxb-LG_81ydo8_DYEcBFofqFg3kGUxTTTKpTggGF8tlzh0isHsXx8ujQFPmEmgtPbi7rOIARQ248dZxb-A6W24Wa4iP2KgBXOQj9lsPrRCAubnaiL9Gd9QVvYooKWD8SZdTm8HfJAoPLsFrUe-Rr6MlnVw7k6_C8K9a_cUgWUghHSkh-AY3mMkIC3b6jhpkOCCX'
};
