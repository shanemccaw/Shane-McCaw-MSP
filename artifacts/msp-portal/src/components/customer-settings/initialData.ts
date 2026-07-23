import { TeamMember, NotificationSetting } from '../types';

export const INITIAL_TEAM_MEMBERS: TeamMember[] = [
  {
    id: '1',
    name: 'Alexander Lowenthal',
    email: 'a.lowenthal@tenant-intel.io',
    role: 'OWNER',
    lastActive: 'Now',
    avatarInitials: 'AL',
    avatarBg: 'bg-[#6b339c]'
  },
  {
    id: '2',
    name: 'Sarah Nguyen',
    email: 's.nguyen@tenant-intel.io',
    role: 'ADMIN',
    lastActive: '2h ago',
    avatarInitials: 'SN',
    avatarBg: 'bg-[#282a2b]'
  },
  {
    id: '3',
    name: 'James Dalton',
    email: 'j.dalton@tenant-intel.io',
    role: 'MEMBER',
    lastActive: 'Dec 12',
    avatarInitials: 'JD',
    avatarBg: 'bg-[#282a2b]'
  }
];

export const INITIAL_NOTIFICATIONS: NotificationSetting[] = [
  {
    id: 'n1',
    title: 'Critical System Anomalies',
    category: 'ALERTS',
    enabled: false
  },
  {
    id: 'n2',
    title: 'New Tenant Onboarding',
    category: 'ALERTS',
    enabled: true
  },
  {
    id: 'n3',
    title: 'Daily Portfolio Snapshot',
    category: 'REPORTS',
    enabled: true
  },
  {
    id: 'n4',
    title: 'Weekly Analytics Summary',
    category: 'REPORTS',
    enabled: true
  },
  {
    id: 'n5',
    title: 'Product Updates & Features',
    category: 'SYSTEM',
    enabled: false
  }
];
