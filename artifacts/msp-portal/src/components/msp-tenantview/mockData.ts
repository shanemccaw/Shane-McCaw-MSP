import { Tenant, AppRegistration, NotificationItem } from '../types';

export const mockAppRegistrations: AppRegistration[] = [
  {
    id: '1',
    name: 'Graph Explorer',
    appId: '00000003-0000-0000-c000',
    riskScore: 8.2,
    riskLevel: 'HIGH',
    permissions: [
      { name: 'User.Read.All', isHighRisk: false },
      { name: 'Mail.ReadWrite', isHighRisk: true }
    ],
    status: 'Approved',
    iconName: 'terminal'
  },
  {
    id: '2',
    name: 'BI Dashboard Tool',
    appId: '882194-221a-4f2a-b102',
    riskScore: 2.4,
    riskLevel: 'LOW',
    permissions: [
      { name: 'Directory.Read.All', isHighRisk: false }
    ],
    status: 'Approved',
    iconName: 'query_stats'
  },
  {
    id: '3',
    name: 'Power Automate Legacy Sync',
    appId: '981204-1102-39aa-0982',
    riskScore: 7.8,
    riskLevel: 'HIGH',
    permissions: [
      { name: 'Files.ReadWrite.All', isHighRisk: true },
      { name: 'User.ReadWrite.All', isHighRisk: true }
    ],
    status: 'Pending Review',
    iconName: 'account_tree'
  },
  {
    id: '4',
    name: 'Slack M365 Integration',
    appId: '472019-99a0-221b-8871',
    riskScore: 4.1,
    riskLevel: 'MEDIUM',
    permissions: [
      { name: 'Presence.Read.All', isHighRisk: false },
      { name: 'User.Read', isHighRisk: false }
    ],
    status: 'Approved',
    iconName: 'chat'
  },
  {
    id: '5',
    name: 'Salesforce Sync Engine',
    appId: '109283-332a-4401-cc82',
    riskScore: 3.2,
    riskLevel: 'LOW',
    permissions: [
      { name: 'Contacts.Read', isHighRisk: false },
      { name: 'Calendars.Read', isHighRisk: false }
    ],
    status: 'Approved',
    iconName: 'cloud_sync'
  }
];

export const mockTenants: Tenant[] = [
  {
    id: 'tenant-1',
    name: 'Contoso Corp',
    directoryId: '4f82-a92c-912837fbc001',
    type: 'M365 ENTERPRISE TENANT',
    healthScore: 94,
    healthStatus: 'EXCELLENT',
    graphStatus: 'Healthy',
    syncStatus: 'Active (14m ago)',
    usersCount: 450,
    mfaPercentage: 97,
    licensesTotal: 500,
    licensesAvailable: 50,
    riskyUsersCount: 2,
    openAlertsCount: 2,
    services: {
      exchange: {
        status: 'HEALTHY',
        usageTb: 64.2,
        usagePercent: 68,
        latencyMs: 142,
        flowStatus: 'STABLE'
      },
      sharepoint: {
        status: 'QUOTA WARNING',
        storagePercent: 92,
        sitesCount: 1240,
        extSharing: 'RESTRICTED'
      },
      teams: {
        status: 'HEALTHY',
        dailyActiveUsers: 4120,
        callQualityPercent: 98.4,
        activeGuests: 85,
        usageTrend: [40, 60, 85, 50, 70]
      },
      entra: {
        status: '2 ALERTS',
        signInSuccessPercent: 99.9,
        identityProt: 'RISKY USERS',
        adSyncStatus: 'HEALTHY',
        alertsCount: 2
      }
    },
    securityControls: {
      passwordComplexity: true,
      mfaConditionalAccess: true,
      externalSharingRestriction: true,
      blockLegacyAuth: true
    },
    appRegistrations: mockAppRegistrations
  },
  {
    id: 'tenant-2',
    name: 'Fabrikam Inc',
    directoryId: '8201-f92e-339281a0092',
    type: 'M365 BUSINESS PREMIUM',
    healthScore: 78,
    healthStatus: 'WARNING',
    graphStatus: 'Healthy',
    syncStatus: 'Active (2m ago)',
    usersCount: 210,
    mfaPercentage: 82,
    licensesTotal: 250,
    licensesAvailable: 40,
    riskyUsersCount: 5,
    openAlertsCount: 4,
    services: {
      exchange: {
        status: 'HEALTHY',
        usageTb: 22.4,
        usagePercent: 45,
        latencyMs: 110,
        flowStatus: 'STABLE'
      },
      sharepoint: {
        status: 'HEALTHY',
        storagePercent: 64,
        sitesCount: 380,
        extSharing: 'RESTRICTED'
      },
      teams: {
        status: 'HEALTHY',
        dailyActiveUsers: 180,
        callQualityPercent: 96.2,
        activeGuests: 22,
        usageTrend: [30, 50, 70, 65, 80]
      },
      entra: {
        status: 'CRITICAL',
        signInSuccessPercent: 94.2,
        identityProt: 'HIGH RISK',
        adSyncStatus: 'DELAYED',
        alertsCount: 4
      }
    },
    securityControls: {
      passwordComplexity: true,
      mfaConditionalAccess: false,
      externalSharingRestriction: false,
      blockLegacyAuth: true
    },
    appRegistrations: mockAppRegistrations.slice(0, 3)
  },
  {
    id: 'tenant-3',
    name: 'Tailspin Toys',
    directoryId: '1029-a83d-99827110291',
    type: 'M365 E3 ENTERPRISE',
    healthScore: 88,
    healthStatus: 'GOOD',
    graphStatus: 'Healthy',
    syncStatus: 'Active (5m ago)',
    usersCount: 890,
    mfaPercentage: 91,
    licensesTotal: 1000,
    licensesAvailable: 110,
    riskyUsersCount: 1,
    openAlertsCount: 1,
    services: {
      exchange: {
        status: 'HEALTHY',
        usageTb: 112.5,
        usagePercent: 72,
        latencyMs: 130,
        flowStatus: 'STABLE'
      },
      sharepoint: {
        status: 'HEALTHY',
        storagePercent: 78,
        sitesCount: 2100,
        extSharing: 'RESTRICTED'
      },
      teams: {
        status: 'HEALTHY',
        dailyActiveUsers: 740,
        callQualityPercent: 99.1,
        activeGuests: 140,
        usageTrend: [50, 60, 70, 85, 90]
      },
      entra: {
        status: 'HEALTHY',
        signInSuccessPercent: 99.8,
        identityProt: 'HEALTHY',
        adSyncStatus: 'HEALTHY',
        alertsCount: 0
      }
    },
    securityControls: {
      passwordComplexity: true,
      mfaConditionalAccess: true,
      externalSharingRestriction: true,
      blockLegacyAuth: false
    },
    appRegistrations: mockAppRegistrations
  },
  {
    id: 'tenant-4',
    name: 'Northwind Traders',
    directoryId: '9982-b11c-44910283748',
    type: 'M365 E5 ENTERPRISE',
    healthScore: 96,
    healthStatus: 'EXCELLENT',
    graphStatus: 'Healthy',
    syncStatus: 'Active (1m ago)',
    usersCount: 1250,
    mfaPercentage: 99,
    licensesTotal: 1300,
    licensesAvailable: 50,
    riskyUsersCount: 0,
    openAlertsCount: 0,
    services: {
      exchange: {
        status: 'HEALTHY',
        usageTb: 180.0,
        usagePercent: 55,
        latencyMs: 98,
        flowStatus: 'STABLE'
      },
      sharepoint: {
        status: 'HEALTHY',
        storagePercent: 42,
        sitesCount: 3400,
        extSharing: 'RESTRICTED'
      },
      teams: {
        status: 'HEALTHY',
        dailyActiveUsers: 1180,
        callQualityPercent: 99.5,
        activeGuests: 310,
        usageTrend: [80, 85, 90, 95, 98]
      },
      entra: {
        status: 'HEALTHY',
        signInSuccessPercent: 100,
        identityProt: 'HEALTHY',
        adSyncStatus: 'HEALTHY',
        alertsCount: 0
      }
    },
    securityControls: {
      passwordComplexity: true,
      mfaConditionalAccess: true,
      externalSharingRestriction: true,
      blockLegacyAuth: true
    },
    appRegistrations: mockAppRegistrations
  }
];

export const mockNotifications: NotificationItem[] = [
  {
    id: 'n1',
    tenantName: 'Contoso Corp',
    title: 'High Risk App Registration',
    message: 'Graph Explorer (00000003-0000-0000-c000) requested Mail.ReadWrite OAuth permission.',
    timestamp: '10 mins ago',
    severity: 'critical',
    read: false
  },
  {
    id: 'n2',
    tenantName: 'Contoso Corp',
    title: 'SharePoint Storage Quota',
    message: 'Storage reached 92% of maximum tenant limit (1.8 TB / 2.0 TB).',
    timestamp: '25 mins ago',
    severity: 'warning',
    read: false
  },
  {
    id: 'n3',
    tenantName: 'Fabrikam Inc',
    title: 'Risky Sign-in Detected',
    message: 'Impossible travel detected for user admin@fabrikam.com from IP 185.220.101.4.',
    timestamp: '1 hour ago',
    severity: 'critical',
    read: false
  },
  {
    id: 'n4',
    tenantName: 'Tailspin Toys',
    title: 'Policy Drift Resolved',
    message: 'Conditional Access policy #CA-04 sync completed successfully.',
    timestamp: '3 hours ago',
    severity: 'info',
    read: true
  }
];

export const mockUserList = [
  { name: 'Adele Vance', email: 'adele.vance@contoso.com', role: 'Global Administrator', mfa: 'Enforced', status: 'Active', department: 'Executive' },
  { name: 'Alex Wilber', email: 'alex.wilber@contoso.com', role: 'Security Administrator', mfa: 'Enforced', status: 'Active', department: 'IT Operations' },
  { name: 'Diego Siciliani', email: 'diego.s@contoso.com', role: 'User Administrator', mfa: 'Enforced', status: 'Active', department: 'HR' },
  { name: 'Megan Bowen', email: 'megan.b@contoso.com', role: 'Exchange Administrator', mfa: 'Enforced', status: 'Active', department: 'IT Operations' },
  { name: 'Pradeep Gupta', email: 'pradeep.g@contoso.com', role: 'User', mfa: 'Enforced', status: 'Risky Sign-In', department: 'Finance' },
  { name: 'Patti Fernandez', email: 'patti.f@contoso.com', role: 'User', mfa: 'Disabled', status: 'Risky Sign-In', department: 'Sales' },
  { name: 'Isaiah Langer', email: 'isaiah.l@contoso.com', role: 'Compliance Admin', mfa: 'Enforced', status: 'Active', department: 'Legal' }
];

export const mockCompliancePolicies = [
  { name: 'DLP - Financial Data Protection', category: 'Data Loss Prevention', status: 'Enforcing', matchesToday: 14, lastAudit: 'Today, 04:30 AM' },
  { name: 'HIPAA Health Record Guardian', category: 'Data Loss Prevention', status: 'Enforcing', matchesToday: 2, lastAudit: 'Today, 05:15 AM' },
  { name: '7-Year Executive Email Retention', category: 'Retention Policy', status: 'Active', matchesToday: 0, lastAudit: 'Yesterday' },
  { name: 'GDPR Customer Data Erasure Sync', category: 'Privacy Governance', status: 'Active', matchesToday: 0, lastAudit: 'Today, 01:00 AM' },
  { name: 'Sensitivity Labels - Confidential', category: 'Information Protection', status: 'Auto-apply', matchesToday: 48, lastAudit: 'Today, 06:00 AM' }
];
