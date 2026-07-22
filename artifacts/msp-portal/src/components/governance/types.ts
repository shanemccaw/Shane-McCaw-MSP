export interface GovernanceHealth {
  score: number;
  maxScore: number;
  driftEvents30D: number;
  driftTrendPercent: number;
  adminAccounts: number;
  pendingReviewsCount: number;
  groupSprawlIndex: number;
}

export interface RoleInventoryItem {
  id: string;
  roleName: string;
  count: number;
  maxRecommended: number;
  barColor: string;
  badgeText?: string;
}

export interface AdminExposureMetric {
  key: string;
  label: string;
  value: number; // 0 to 100
  rawValue: string;
  description: string;
}

export interface GroupStat {
  label: string;
  value: string;
  numericValue: number;
  icon: string;
  colorClass: string;
  borderLeft?: boolean;
}

export interface HeatmapCell {
  id: number;
  row: number;
  col: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  category: 'ownerless' | 'external' | 'stale';
  groupName: string;
  membersCount: number;
  lastAudited: string;
}

export interface PolicyDriftPoint {
  date: string;
  changes: number;
  driftScore: number;
}

export interface GovernanceRisk {
  id: string;
  rank: string;
  title: string;
  description: string;
  priority: 'CRITICAL PRIORITY' | 'HIGH PRIORITY' | 'MEDIUM PRIORITY';
  category: string;
  affectedItemsCount: number;
  remediationPath?: string;
}

export interface GovernanceAutomation {
  id: string;
  title: string;
  description: string;
  httpMethod: 'PATCH' | 'POST' | 'DELETE';
  endpoint: string;
  status: 'READY' | 'EXECUTING' | 'EXECUTED';
  icon: string;
  actionText: string;
  accentColor: string; // 'primary' | 'violet' | 'green'
}

export interface ThreatLandscapeInfo {
  title: string;
  subtitle: string;
  increasePercentage: number;
  imageUrl: string;
}
