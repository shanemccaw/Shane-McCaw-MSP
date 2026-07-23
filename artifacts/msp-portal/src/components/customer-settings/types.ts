export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastActive: string;
  avatarInitials: string;
  avatarBg?: string;
}

export interface NotificationSetting {
  id: string;
  title: string;
  category: 'ALERTS' | 'REPORTS' | 'SYSTEM';
  enabled: boolean;
}

export type MainTab = 'General Settings' | 'Dashboard' | 'Analytics' | 'Properties' | 'Tenants';

export type SidebarTab = 'Team' | 'Security' | 'Notifications' | 'Data & Billing';
