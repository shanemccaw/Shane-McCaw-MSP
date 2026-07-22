export type TimeFrame = '7d' | '30d' | '90d';

export type Department = 'All' | 'Sales' | 'Marketing' | 'Engineering' | 'HR' | 'Finance';

export type IntensityLevel = 'High' | 'Mid' | 'Low';

export interface HeatMapRow {
  department: Department;
  meetings: IntensityLevel;
  chats: IntensityLevel;
  channels: IntensityLevel;
  meetingScore: number;
  chatScore: number;
  channelScore: number;
}

export interface CollaborationTrendPoint {
  day: string;
  edits: number;
  shares: number;
}

export interface CopilotBreakdownItem {
  key: string;
  label: string;
  count: number;
  color: string;
  percentage: number;
  description: string;
}

export type OpportunitySeverity = 'CRITICAL' | 'MEDIUM' | 'ACTIONABLE' | 'GROWTH' | 'RECLAIM';

export interface Opportunity {
  id: number;
  title: string;
  severity: OpportunitySeverity;
  department?: string;
  affectedCount?: number;
  recommendedAction: string;
  impactScore: string;
}

export interface AutomationAction {
  id: string;
  title: string;
  icon: string;
  description: string;
  buttonLabel: 'APPLY' | 'EXECUTE';
  accentColor: string;
  successMessage: string;
}
