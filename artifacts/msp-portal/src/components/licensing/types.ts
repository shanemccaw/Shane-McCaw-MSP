export type SeverityLevel = 'high' | 'medium' | 'low' | 'info';

export interface MetricCardData {
  id: string;
  title: string;
  value: string | number;
  subValue?: string;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
  color?: string;
  iconName?: string;
}

export interface SkuItem {
  id: string;
  name: string;
  utilizationPercent: number;
  assignedCount: number;
  totalCount: number;
  unassignedCount: number;
  monthlyCostPerSeat: number;
  category: string;
}

export interface HygieneDeptRow {
  department: string;
  inactive: number;
  disabled: number;
  overlap: number;
}

export interface PriorityInsight {
  id: number;
  title: string;
  description: string;
  severity: SeverityLevel;
  affectedCount: number;
  potentialSavings?: string;
  skuTarget?: string;
}

export type ActionType = 'DELETE' | 'PATCH' | 'DEPLOY';

export interface AutomationCandidate {
  id: string;
  type: ActionType;
  confidence: number;
  title: string;
  description: string;
  estimatedMonthlySavings: string;
  icon: string;
  status: 'idle' | 'running' | 'applied';
}

export interface AffectedUser {
  id: string;
  name: string;
  email: string;
  department: string;
  sku: string;
  issue: string;
  lastActive: string;
  potentialAction: string;
}

export interface FilterState {
  timeRange: '30d' | '90d' | 'ytd' | 'all';
  department: string;
  instance: string;
}
