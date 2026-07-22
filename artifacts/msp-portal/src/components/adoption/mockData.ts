import { HeatMapRow, CollaborationTrendPoint, CopilotBreakdownItem, Opportunity, AutomationAction } from '../types';

export const INITIAL_HEATMAP_DATA: HeatMapRow[] = [
  { department: 'Sales', meetings: 'High', chats: 'Mid', channels: 'High', meetingScore: 88, chatScore: 62, channelScore: 91 },
  { department: 'Marketing', meetings: 'Mid', chats: 'High', channels: 'Low', meetingScore: 58, chatScore: 85, channelScore: 32 },
  { department: 'Engineering', meetings: 'Low', chats: 'Mid', channels: 'High', meetingScore: 28, chatScore: 64, channelScore: 89 },
  { department: 'HR', meetings: 'Mid', chats: 'Low', channels: 'Mid', meetingScore: 54, chatScore: 26, channelScore: 58 },
  { department: 'Finance', meetings: 'High', chats: 'Low', channels: 'Mid', meetingScore: 82, chatScore: 31, channelScore: 60 },
];

export const COLLABORATION_TREND_DATA: CollaborationTrendPoint[] = [
  { day: 'Day 1', edits: 240, shares: 120 },
  { day: 'Day 5', edits: 380, shares: 190 },
  { day: 'Day 10', edits: 310, shares: 140 },
  { day: 'Day 15', edits: 490, shares: 260 },
  { day: 'Day 20', edits: 580, shares: 310 },
  { day: 'Day 25', edits: 360, shares: 180 },
  { day: 'Day 30', edits: 530, shares: 290 },
];

export const COPILOT_USAGE_DATA: CopilotBreakdownItem[] = [
  { key: 'email', label: 'Email', count: 442, color: '#479ef5', percentage: 40, description: 'Email Drafting & smart replies' },
  { key: 'recap', label: 'Recap', count: 276, color: '#dab9ff', percentage: 25, description: 'Meeting Recap & transcripts' },
  { key: 'doc', label: 'Doc', count: 221, color: '#f59e0b', percentage: 20, description: 'Word & PDF Summarization' },
  { key: 'code', label: 'Code', count: 166, color: '#22c55e', percentage: 15, description: 'GitHub / VS Code Assist' },
];

export const TOP_OPPORTUNITIES: Opportunity[] = [
  {
    id: 1,
    title: 'Departments with low Teams engagement',
    severity: 'CRITICAL',
    department: 'Engineering & Marketing',
    affectedCount: 1420,
    recommendedAction: 'Deploy Targeted Teams Channel Workflows campaign to lower friction in cross-functional messaging.',
    impactScore: '+12 Health Score Points',
  },
  {
    id: 2,
    title: 'Inactive collaboration sites (42 flagged)',
    severity: 'MEDIUM',
    department: 'SharePoint Tenant',
    affectedCount: 42,
    recommendedAction: 'Run automated archive prompt or re-assign site ownership to active department leads.',
    impactScore: 'Reclaim 1.8 TB Storage',
  },
  {
    id: 3,
    title: 'High unread backlog in key leadership teams',
    severity: 'ACTIONABLE',
    department: 'Executive / Finance',
    affectedCount: 890,
    recommendedAction: 'Trigger Copilot Inbox Summarization nudges to reduce email backlog processing time.',
    impactScore: '-45% Unread Backlog',
  },
  {
    id: 4,
    title: 'Low Copilot usage in eligible users (HR Dept)',
    severity: 'GROWTH',
    department: 'Human Resources',
    affectedCount: 310,
    recommendedAction: 'Send targeted HR Copilot Prompt Guides for document drafting and candidate summary prep.',
    impactScore: '+28% Active Copilot Users',
  },
  {
    id: 5,
    title: 'Users with active licenses but no platform activity',
    severity: 'RECLAIM',
    department: 'All Departments',
    affectedCount: 185,
    recommendedAction: 'Automate 14-day inactivity warning and offer license reallocation to waiting list.',
    impactScore: '$14,800/mo Saved',
  },
];

export const AUTOMATION_ACTIONS: AutomationAction[] = [
  {
    id: 'training',
    title: 'Targeted Training',
    icon: 'campaign',
    description: 'Automated campaigns for users with low feature adoption rates.',
    buttonLabel: 'APPLY',
    accentColor: '#479ef5',
    successMessage: 'Targeted training campaign dispatched to 1,730 low-adoption users across Teams and SharePoint.',
  },
  {
    id: 'nudges',
    title: 'Productivity Nudges',
    icon: 'bolt',
    description: 'System-level prompts suggesting collaboration shortcuts.',
    buttonLabel: 'EXECUTE',
    accentColor: '#dab9ff',
    successMessage: 'Productivity nudges enabled across 12 tenant communication channels.',
  },
  {
    id: 'onboarding',
    title: 'Copilot Onboarding',
    icon: 'auto_fix_high',
    description: 'Workflow to guide remaining licensed users through setup.',
    buttonLabel: 'APPLY',
    accentColor: '#f59e0b',
    successMessage: 'Copilot onboarding workflow initialized for 310 eligible HR and Sales users.',
  },
];
