export interface TenantScore {
  overall: number;
  projected: number;
  trend: string;
  summary: string;
  directoryHygiene: number;
  caArchitecture: number;
  oauthGovernance: number;
  collabStructure: number;
}

export interface RoleDensity {
  id: string;
  roleName: string;
  membersCount: number;
  isHighRisk?: boolean;
}

export interface RoleMatrix {
  privileged: number;
  totalRoles: number;
  unclearPurpose: number;
  redundant: number;
}

export interface CAPolicy {
  id: string;
  name: string;
  device: 'aligned' | 'misaligned' | 'unused';
  location: 'aligned' | 'misaligned' | 'unused';
  risk: 'aligned' | 'misaligned' | 'unused';
  app: 'aligned' | 'misaligned' | 'unused';
  enforcement: 'ACTIVE' | 'WARNING' | 'AUDIT' | 'DISABLED';
}

export interface AppInventory {
  total: number;
  healthy: number;
  mediumRisk: number;
  highRisk: number;
}

export interface OAuthRisk {
  highPercentage: number;
  medPercentage: number;
  lowPercentage: number;
  mostPrivilegedApp: string;
  totalAdminConsents: number;
}

export interface CollabItem {
  id: string;
  title: string;
  value: string;
  statusText?: string;
  statusType?: 'warning' | 'normal';
  icon: string;
}

export interface ArchitectureRisk {
  id: number;
  title: string;
  dataPath: string;
  severity: 'critical' | 'warning' | 'info';
  impactCount: number;
  description: string;
  remediation: string;
}

export interface AutomationTarget {
  id: string;
  title: string;
  targetMethod: string;
  targetPath: string;
  iconType: 'lightning' | 'wrench' | 'antenna';
  status: 'pending' | 'applying' | 'executed';
  scoreImpact: number;
}

export interface ScanLog {
  timestamp: string;
  module: string;
  status: 'success' | 'warning' | 'scanning';
  message: string;
}
