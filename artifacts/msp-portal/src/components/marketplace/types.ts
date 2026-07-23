export type BadgeType = 'PREMIUM' | 'ENTERPRISE' | 'CORE' | 'ADD-ON' | 'PROTECT' | 'ESG';

export type CategoryType = 'All Products' | 'Intelligence' | 'Security' | 'Automation' | 'Compliance';

export type TopTabType = 'Intelligence' | 'Security' | 'Automation' | 'All';

export interface ColorTheme {
  bg: string;
  text: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  category: 'Intelligence' | 'Security' | 'Automation' | 'Compliance';
  badge: BadgeType;
  priceMonthly: number;
  priceYearly: number;
  iconName: 'analytics' | 'shield' | 'sparkles' | 'message' | 'lock' | 'leaf';
  colorTheme: ColorTheme;
  accuracy?: string;
  features: string[];
  rating: number;
  reviewsCount: number;
  activeTeams: number;
  status?: string;
  provider: string;
}

export interface TeamMember {
  id: string;
  name: string;
  initials: string;
  bgColor: string;
  textColor: string;
  role: string;
  avatarUrl?: string;
}

export interface DashboardMetric {
  id: string;
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
  chartData: number[];
}
