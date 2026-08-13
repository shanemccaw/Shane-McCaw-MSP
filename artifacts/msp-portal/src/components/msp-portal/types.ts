export type SyncStatusType = 'Healthy' | 'Warning' | 'Sync Failed' | 'Syncing';
export type LicenseTier = 'Business Premium' | 'E3' | 'E5' | 'F3';
export type SeverityLevel = 'HIGH' | 'MED' | 'LOW' | 'CRITICAL';

export interface LicenseUsage {
  assigned: number;
  total: number;
  tier: LicenseTier;
}

export interface Tenant {
  id: string;
  name: string;
  code: string;
  primaryDomain: string;
  tenantId: string; // Azure Directory Tenant ID GUID
  licenseUsage: LicenseUsage;
  mfaPercentage: number;
  secureScore: number;
  maxSecureScore: number;
  syncStatus: SyncStatusType;
  lastSyncTimestamp: string;
  activeAlertsCount: number;
  adminCount: number;
  userCount: number;
  globalAdminUPNs: string[];
  conditionalAccessPoliciesCount: number;
  pimEnabled: boolean;
  securityDefaults: boolean;
}

export interface ThreatFeedItem {
  id: string;
  tenantId: string;
  tenantName: string;
  severity: SeverityLevel;
  timestamp: string;
  title: string;
  sourceModule: 'Azure AD' | 'PIM' | 'Teams' | 'Defender' | 'Exchange' | 'Intune' | 'Conditional Access';
  description: string;
  targetUPN?: string;
  actionRequired: string;
  actionType: 'FIX_NOW' | 'REVIEW' | 'ACKNOWLEDGE' | 'VIEW_DIFF' | 'REVOKE_SESSIONS';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
}

export interface PendingRemediation {
  id: string;
  tenantName: string;
  tenantId: string;
  title: string;
  category: 'Identity' | 'License' | 'Policy Drift' | 'Security';
  severity: SeverityLevel;
  affectedTarget: string;
  createdTime: string;
  suggestedAction: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  tenantName: string;
  initiatedBy: string;
  action: string;
  status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
  details: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  description: string;
  timestamp: string;
}
