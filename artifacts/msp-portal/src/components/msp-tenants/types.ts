export type TenantStatus = 'critical' | 'healthy' | 'expired' | 'syncing' | 'warning';

export interface GdapInfo {
  text: string;
  daysLeft: number;
  percent: number;
  isCritical?: boolean;
  isExpired?: boolean;
}

export interface AutomationInfo {
  text: string;
  count?: number;
  isFailed?: boolean;
  isSyncing?: boolean;
  isIdle?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  shortLetter: string;
  status: TenantStatus;
  secureScore: number;
  securePtsDelta: number;
  secureSparkline: number[];
  complianceScore: number;
  compliancePtsDelta: number;
  complianceSparkline: number[];
  baselineAlignment: number;
  gdap: GdapInfo;
  automation: AutomationInfo;
  incidentsCount: number;
  hasWarning?: boolean;
  hasLockReset?: boolean;
  hasSyncIssue?: boolean;
  region: string;
  licenseCount: number;
  usersCount: number;
  mfaEnforcedPercent: number;
  conditionalAccessRules: number;
  failedWorkflowsDetails?: string[];
  notes?: string;
  primaryDomain: string;
}

export type IntentType = 'AUTO-FIX' | 'ALERT' | 'SIGNAL';

export interface IntentFeedItem {
  id: string;
  timestamp: string;
  type: IntentType;
  tenantName: string;
  message: string;
}

export type ViewMode = 'grid' | 'list' | 'map';

export type EngineType = 
  | 'dashboard'
  | 'tenants'
  | 'drift'
  | 'security'
  | 'health'
  | 'sla'
  | 'revenue';
