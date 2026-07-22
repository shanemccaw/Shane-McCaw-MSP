import { SecurityMetrics, RiskDistribution, SignInTrendPoint, PrivilegedMetrics, DailyAlertVolume, SecurityRiskItem, AutomationPolicy } from '../types';

export const initialMetrics: SecurityMetrics = {
  healthScore: 78,
  highRiskIdentities: 14,
  criticalAlerts24h: 5,
  potentialRiskReduction: 42,
  mtta: '14m 22s',
};

export const initialRiskDistribution: RiskDistribution = {
  highRiskPercentage: 12,
  mediumRiskPercentage: 28,
  lowRiskPercentage: 60,
};

export const initialSignInTrend: SignInTrendPoint[] = [
  { id: '1', timeLabel: '00:00', value: 40 },
  { id: '2', timeLabel: '04:00', value: 60 },
  { id: '3', timeLabel: '08:00', value: 30 },
  { id: '4', timeLabel: '12:00', value: 85, isCurrent: true },
  { id: '5', timeLabel: '16:00', value: 45 },
  { id: '6', timeLabel: '20:00', value: 55 },
  { id: '7', timeLabel: '23:59', value: 25 },
];

export const initialPrivilegedMetrics: PrivilegedMetrics = {
  totalPrivileged: 124,
  accountsWithRisk: 18,
  radarScores: {
    totalPrivileged: 85,
    highUserRisk: 65,
    noMfaEnabled: 40,
    riskySignIns: 75,
  },
};

export const initialAlertVolume: DailyAlertVolume[] = [
  { day: 'Day -4', counts: { critical: 12, high: 32, medium: 45, low: 22 } },
  { day: 'Day -3', counts: { critical: 18, high: 28, medium: 38, low: 28 } },
  { day: 'Day -2', counts: { critical: 6, high: 48, medium: 42, low: 12 } },
  { day: 'Day -1', counts: { critical: 22, high: 16, medium: 28, low: 44 } },
  { day: 'TODAY', isToday: true, counts: { critical: 11, high: 42, medium: 33, low: 21 } },
];

export const initialSecurityRisks: SecurityRiskItem[] = [
  {
    id: 'risk-01',
    rank: '01',
    title: 'High-risk user with repeated risky sign-ins',
    locationOrIdentity: 'Detected in: West US / Auth Flow',
    severity: 'critical',
    affectedUsers: 14,
    detectedAt: '12 mins ago',
    status: 'active',
    recommendation: 'Block sign-in immediately, revoke current OAuth tokens, and trigger step-up MFA verification.',
  },
  {
    id: 'risk-02',
    rank: '02',
    title: 'Privileged account with high-risk sign-ins',
    locationOrIdentity: 'Identity: Admin_Svc_Prod',
    severity: 'critical',
    protocol: 'Azure AD / Graph API',
    detectedAt: '34 mins ago',
    status: 'active',
    recommendation: 'Enforce PIM time-bound elevation approval and inspect recent service principal token grants.',
  },
  {
    id: 'risk-03',
    rank: '03',
    title: 'Excessive Graph API permissions for unverified app',
    locationOrIdentity: 'Scope: Directory.ReadWrite.All',
    severity: 'high',
    scope: 'Directory.ReadWrite.All',
    detectedAt: '1 hour ago',
    status: 'investigating',
    recommendation: 'Audit client ID registration grants and restrict permission scopes to admin-consent policies.',
  },
  {
    id: 'risk-04',
    rank: '04',
    title: 'Legacy Authentication attempt on Global Admin',
    locationOrIdentity: 'Protocol: IMAP4 / Pop3',
    severity: 'high',
    protocol: 'IMAP4 / Pop3',
    detectedAt: '2 hours ago',
    status: 'active',
    recommendation: 'Disable legacy auth endpoints across all tenant conditional access policies.',
  },
  {
    id: 'risk-05',
    rank: '05',
    title: 'Anomalous token claim from unfamiliar ISP',
    locationOrIdentity: 'Latency: +450ms from baseline',
    severity: 'medium',
    latency: '+450ms from baseline',
    detectedAt: '3 hours ago',
    status: 'investigating',
    recommendation: 'Correlate with threat intelligence IP list and issue mandatory token refresh.',
  },
];

export const initialAutomationPolicies: AutomationPolicy[] = [
  {
    id: 'auto-1',
    percentageOrCount: '85%',
    title: 'Auto-remediate risky users',
    subtext: 'Policy: CA-Risk-Block-01',
    actionText: 'ENFORCE',
    actionType: 'ENFORCE',
    status: 'idle',
    borderClass: 'border-l-[#479ef5]',
    btnBgClass: 'bg-[#a0c9ff]',
    btnHoverClass: 'hover:bg-[#0061a6]',
    btnTextClass: 'text-[#003259] hover:text-white',
  },
  {
    id: 'auto-2',
    percentageOrCount: '62%',
    title: 'Enforce CA baseline',
    subtext: 'Coverage: 14/22 Tenants',
    actionText: 'SYNC',
    actionType: 'SYNC',
    status: 'idle',
    borderClass: 'border-l-[#5a3289]',
    btnBgClass: 'bg-[#5a3289]',
    btnHoverClass: 'hover:bg-[#421871]',
    btnTextClass: 'text-[#eedbff]',
  },
  {
    id: 'auto-3',
    percentageOrCount: '12',
    title: 'Escalate critical alerts',
    subtext: 'Pending auto-SOC review',
    actionText: 'REVIEW',
    actionType: 'REVIEW',
    status: 'idle',
    borderClass: 'border-l-[#ffb4ab]',
    btnBgClass: 'bg-[#93000a]',
    btnHoverClass: 'hover:bg-[#ffb4ab]',
    btnTextClass: 'text-[#ffdad6] hover:text-[#690005]',
  },
];
