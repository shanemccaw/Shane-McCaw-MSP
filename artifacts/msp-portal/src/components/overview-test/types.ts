export type SeverityLevel = 'red' | 'amber' | 'yellow';

export interface ScoreCardData {
  id: string;
  title: string;
  score: number;
  change: string;
  trend: 'up' | 'down' | 'stable';
  lastScan: string;
  category: 'health' | 'security' | 'governance' | 'copilot';
  description: string;
}

export interface CriticalFinding {
  id: string;
  title: string;
  description: string;
  severity: SeverityLevel;
  category: string;
  affectedEntities: string;
  impactScore: number;
  status: 'active' | 'remediating' | 'remediated';
  details: string;
  remediationSteps: string[];
  powershellCommand?: string;
  msGraphEndpoint?: string;
}

export interface DriverItem {
  id: string;
  title: string;
  description?: string;
  progress?: number;
  status: 'compliant' | 'warning' | 'error';
}

export interface ScoreDriverCategory {
  title: string;
  type: 'security' | 'governance' | 'copilot';
  items: DriverItem[];
  sparklineData: number[];
}

export interface LicenseMetric {
  totalWasteFormatted: string;
  inactiveE5Count: number;
  duplicateSubMonthly: string;
  copilotReadyUsers: number;
  valueOpportunities: {
    id: string;
    title: string;
    description: string;
    amount: string;
    type: 'potential_roi' | 'monthly_save';
  }[];
}

export interface IdentityMetrics {
  privilegedRolesCount: number;
  privilegedRolesChange: string;
  mfaCoveragePercent: number;
  mfaGrowthText: string;
  conditionalAccessPercent: number;
  conditionalAccessStatus: string;
}

export interface ComplianceBaseline {
  id: string;
  name: string;
  score: number;
  status: 'compliant' | 'warning' | 'danger';
  driftNote?: string;
}

export interface ComplianceData {
  overallScore: number;
  baselines: ComplianceBaseline[];
}

export interface AutomationTask {
  id: string;
  title: string;
  description: string;
  actionText: string;
  icon: string;
  colorClass: string;
  badge?: string;
  badgeColor?: string;
  actionType: 'pdf' | 'sow' | 'plan' | 'alerts';
}

export interface TenantConfig {
  name: string;
  domain: string;
  environment: string;
  lastScanMinutesAgo: number;
}
