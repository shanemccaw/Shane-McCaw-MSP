export interface HeatmapEntity {
  id: string;
  name: string;
  icon: 'cloud' | 'groups' | 'folder_open' | 'database' | 'shield';
  anonymousLinks: number;
  externalUsers: number;
  broadInternal: number;
  highPermissionApps: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  owner: string;
  lastAudited: string;
}

export interface LabelCoverageData {
  labeledPercent: number;
  labeledCount: string;
  unlabeledPercent: number;
  unlabeledCount: string;
  mislabeledPercent: number;
  mislabeledCount: string;
}

export interface DlpMetric {
  id: string;
  title: string;
  blockedPercent: number;
  overridePercent: number;
  allowedPercent: number;
}

export interface RadarMetric {
  key: string;
  label: string;
  value: number; // 0 to 100
  target: number;
  x: number;
  y: number;
}

export interface EnablementControl {
  id: string;
  name: string;
  statusText: string;
  statusType: 'active' | 'percent' | 'warning' | 'ready' | 'pending' | 'running';
  icon: string;
  detail: string;
}

export interface ReadinessBlocker {
  id: string;
  rank: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source: string;
  remediated?: boolean;
  recommendation: string;
  impactScore: number;
}

export interface AutomationTask {
  id: string;
  type: 'PATCH' | 'DELETE';
  title: string;
  description: string;
  buttonText: string;
  accentColor: 'primary' | 'secondary' | 'error';
  status: 'idle' | 'running' | 'completed';
  progress: number;
}

export interface ExecutiveMetrics {
  aggregateReadiness: number;
  readinessStatus: string;
  permissionsHygiene: number;
  sensitiveDataProtection: number;
  copilotRiskScore: number;
  liveDataFeedActive: boolean;
  lastUpdated: string;
}
