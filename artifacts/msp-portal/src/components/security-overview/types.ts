export type TimeFrame = '24h' | '7d' | '30d';

export interface SecurityMetrics {
  healthScore: number;
  highRiskIdentities: number;
  criticalAlerts24h: number;
  potentialRiskReduction: number;
  mtta: string;
}

export interface RiskDistribution {
  highRiskPercentage: number;
  mediumRiskPercentage: number;
  lowRiskPercentage: number;
}

export interface SignInTrendPoint {
  id: string;
  timeLabel: string;
  value: number; // percentage or count
  isCurrent?: boolean;
}

export interface PrivilegedMetrics {
  totalPrivileged: number;
  accountsWithRisk: number;
  radarScores: {
    totalPrivileged: number;
    highUserRisk: number;
    noMfaEnabled: number;
    riskySignIns: number;
  };
}

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface DailyAlertVolume {
  day: string;
  isToday?: boolean;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface SecurityRiskItem {
  id: string;
  rank: string; // "01", "02", etc.
  title: string;
  locationOrIdentity: string;
  severity: SeverityLevel;
  affectedUsers?: number;
  protocol?: string;
  scope?: string;
  latency?: string;
  detectedAt: string;
  status: 'active' | 'investigating' | 'mitigated';
  recommendation: string;
}

export interface AutomationPolicy {
  id: string;
  percentageOrCount: string;
  title: string;
  subtext: string;
  actionText: string;
  actionType: 'ENFORCE' | 'SYNC' | 'REVIEW';
  status: 'idle' | 'enforcing' | 'synced' | 'reviewed' | 'enforced';
  borderClass: string;
  btnBgClass: string;
  btnHoverClass: string;
  btnTextClass: string;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description: string;
}
