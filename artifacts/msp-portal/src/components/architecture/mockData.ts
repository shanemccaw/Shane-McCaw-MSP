import {
  TenantScore,
  RoleDensity,
  RoleMatrix,
  CAPolicy,
  AppInventory,
  OAuthRisk,
  CollabItem,
  ArchitectureRisk,
  AutomationTarget,
} from './types';

export const initialTenantScore: TenantScore = {
  overall: 88,
  projected: 94,
  trend: '+3.2% from last week',
  summary:
    'Alignment is high, but CA policies and OAuth governance require immediate attention.',
  directoryHygiene: 92,
  caArchitecture: 74,
  oauthGovernance: 65,
  collabStructure: 81,
};

export const initialRoleDensity: RoleDensity[] = [
  { id: '1', roleName: 'Global Administrator', membersCount: 24, isHighRisk: true },
  { id: '2', roleName: 'Privileged Role Admin', membersCount: 8 },
  { id: '3', roleName: 'User Administrator', membersCount: 14 },
];

export const initialRoleMatrix: RoleMatrix = {
  privileged: 42,
  totalRoles: 156,
  unclearPurpose: 28,
  redundant: 14,
};

export const initialCAPolicies: CAPolicy[] = [
  {
    id: 'ca-1',
    name: 'MFA for Admins',
    device: 'aligned',
    location: 'aligned',
    risk: 'aligned',
    app: 'unused',
    enforcement: 'ACTIVE',
  },
  {
    id: 'ca-2',
    name: 'Legacy Auth Block',
    device: 'aligned',
    location: 'unused',
    risk: 'unused',
    app: 'aligned',
    enforcement: 'ACTIVE',
  },
  {
    id: 'ca-3',
    name: 'External User Access',
    device: 'misaligned',
    location: 'aligned',
    risk: 'misaligned',
    app: 'aligned',
    enforcement: 'WARNING',
  },
  {
    id: 'ca-4',
    name: 'Intune Compliance Only',
    device: 'unused',
    location: 'unused',
    risk: 'misaligned',
    app: 'misaligned',
    enforcement: 'AUDIT',
  },
];

export const initialAppInventory: AppInventory = {
  total: 142,
  healthy: 84,
  mediumRisk: 42,
  highRisk: 16,
};

export const initialOAuthRisk: OAuthRisk = {
  highPercentage: 15,
  medPercentage: 25,
  lowPercentage: 60,
  mostPrivilegedApp: 'Backup-Svc-Main',
  totalAdminConsents: 32,
};

export const initialCollabItems: CollabItem[] = [
  {
    id: 'collab-1',
    title: 'MS Teams Nodes',
    value: '84 Teams',
    icon: 'users',
  },
  {
    id: 'collab-2',
    title: 'SharePoint Sites',
    value: '2 Misaligned',
    statusText: '2 Misaligned',
    statusType: 'warning',
    icon: 'folder',
  },
  {
    id: 'collab-3',
    title: 'Orphaned Structures',
    value: '4 Orphaned',
    statusText: '4 Orphaned',
    statusType: 'warning',
    icon: 'unlink',
  },
  {
    id: 'collab-4',
    title: 'OneDrive Personal',
    value: '1.2k Drives',
    icon: 'cloud',
  },
];

export const initialRisks: ArchitectureRisk[] = [
  {
    id: 1,
    title: 'Excessive admin roles',
    dataPath: '/directoryRoles',
    severity: 'critical',
    impactCount: 24,
    description:
      '24 users hold active Global Administrator assignments. Standard security baseline recommends fewer than 5 active Global Admins.',
    remediation:
      'Convert excess Global Admin accounts to Just-In-Time Privileged Identity Management (PIM) eligible assignments.',
  },
  {
    id: 2,
    title: 'Misaligned CA policies',
    dataPath: '/identity/conditionalAccess/policies',
    severity: 'warning',
    impactCount: 2,
    description:
      'Conditional Access policies "External User Access" and "Intune Compliance Only" have gaps in device baseline and risk evaluation.',
    remediation:
      'Apply standardized CA policy blueprint to enforce risk-based conditional prompts for guest tenants.',
  },
  {
    id: 3,
    title: 'High-risk OAuth grants',
    dataPath: '/oauth2PermissionGrants',
    severity: 'warning',
    impactCount: 16,
    description:
      '16 multi-tenant applications possess Directory.ReadWrite.All or full admin consent without active publisher verification.',
    remediation:
      'Revoke high-risk unverified admin consent grants and restrict non-admin consent settings.',
  },
  {
    id: 4,
    title: 'Orphaned collaboration structures',
    dataPath: '/sites',
    severity: 'info',
    impactCount: 4,
    description:
      '4 SharePoint sites and MS Teams containers have no active owners assigned after organizational unit restructuring.',
    remediation:
      'Assign backup secondary owners or initiate automated archiving workflow.',
  },
  {
    id: 5,
    title: 'Redundant or conflicting groups',
    dataPath: '/groups',
    severity: 'info',
    impactCount: 14,
    description:
      '14 security groups share 98% member overlap and circular nested references.',
    remediation:
      'Consolidate circular nested groups into unified dynamic security groups.',
  },
];

export const initialAutomationTargets: AutomationTarget[] = [
  {
    id: 'auto-1',
    title: 'Enforce CA blueprint',
    targetMethod: 'PATCH',
    targetPath: '/conditionalAccess',
    iconType: 'lightning',
    status: 'pending',
    scoreImpact: 3,
  },
  {
    id: 'auto-2',
    title: 'Clean up OAuth grants',
    targetMethod: 'DELETE',
    targetPath: '/oauth2PermissionGrants',
    iconType: 'wrench',
    status: 'pending',
    scoreImpact: 2,
  },
  {
    id: 'auto-3',
    title: 'Normalize collab structures',
    targetMethod: 'PATCH',
    targetPath: '/sites',
    iconType: 'antenna',
    status: 'pending',
    scoreImpact: 1,
  },
];
