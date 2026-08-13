export type TabType = 'tenant-intelligence' | 'multi-tenant' | 'compliance-ops';

export type NavSection = 'overview' | 'security' | 'compliance' | 'users' | 'billing';

export interface Tenant {
  id: string;
  name: string;
  directoryId: string;
  type: string;
  healthScore: number;
  healthStatus: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';
  graphStatus: 'Healthy' | 'Degraded' | 'Incident';
  syncStatus: string;
  usersCount: number;
  mfaPercentage: number;
  licensesTotal: number;
  licensesAvailable: number;
  riskyUsersCount: number;
  openAlertsCount: number;
  services: {
    exchange: {
      status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
      usageTb: number;
      usagePercent: number;
      latencyMs: number;
      flowStatus: string;
    };
    sharepoint: {
      status: 'HEALTHY' | 'QUOTA WARNING' | 'CRITICAL';
      storagePercent: number;
      sitesCount: number;
      extSharing: 'RESTRICTED' | 'ANYONE' | 'EXISTING_GUESTS';
    };
    teams: {
      status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
      dailyActiveUsers: number;
      callQualityPercent: number;
      activeGuests: number;
      usageTrend: number[];
    };
    entra: {
      status: 'HEALTHY' | '2 ALERTS' | 'WARNING' | 'CRITICAL';
      signInSuccessPercent: number;
      identityProt: 'RISKY USERS' | 'HEALTHY' | 'HIGH RISK';
      adSyncStatus: 'HEALTHY' | 'DELAYED' | 'ERROR';
      alertsCount: number;
    };
  };
  securityControls: {
    passwordComplexity: boolean;
    mfaConditionalAccess: boolean;
    externalSharingRestriction: boolean;
    blockLegacyAuth: boolean;
  };
  appRegistrations: AppRegistration[];
}

export interface AppRegistration {
  id: string;
  name: string;
  appId: string;
  riskScore: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  permissions: { name: string; isHighRisk?: boolean }[];
  status: 'Approved' | 'Revoked' | 'Pending Review';
  iconName: string;
}

export interface NotificationItem {
  id: string;
  tenantName: string;
  title: string;
  message: string;
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  read: boolean;
}
