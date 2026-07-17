export interface TrendDataPoint {
  date: string;
  value: number;
}

export interface HeatmapDataPoint {
  x: string;
  y: string;
  value: number;
}

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  time: string;
  status?: "default" | "success" | "warning" | "error" | "info";
}

export interface DistributionDataPoint {
  name: string;
  value: number;
  color: string;
}

export interface BarDataPoint {
  name: string;
  value: number;
}

// ── Executive Dashboard ────────────────────────────────────────────────────────

export interface ExecutiveTelemetry {
  overallSecureScore: number;
  complianceScore: number;
  licenseWasteCost: number;
  deviceCompliancePct: number;
  postureTrend: TrendDataPoint[];
  topRisks: BarDataPoint[];
  driftEventCount: number;
  adoptionScore: number;
  externalSharingRisk: "Low" | "Moderate" | "High" | "Critical";
}

// ── Identity & Access ──────────────────────────────────────────────────────────

export interface IdentityTelemetry {
  mfaCoverage: DistributionDataPoint[];
  legacyAuthTrend: TrendDataPoint[];
  signInHeatmap: HeatmapDataPoint[];
  highRiskSignIns: BarDataPoint[];
  pimActivations: TimelineEvent[];
  riskyUsersTrend: TrendDataPoint[];
  riskDetectionsByCategory: DistributionDataPoint[];
}

// ── Security Posture ───────────────────────────────────────────────────────────

export interface SecurityPostureTelemetry {
  secureScoreTrend: TrendDataPoint[];
  secureScoreByCategory: DistributionDataPoint[];
  alertsBySeverity: DistributionDataPoint[];
  alertsByWorkload: DistributionDataPoint[];
  missingPatches: BarDataPoint[];
  vulnerabilitiesBySeverity: BarDataPoint[];
}

// ── Compliance & Governance ────────────────────────────────────────────────────

export interface ComplianceTelemetry {
  dlpMatchFrequency: TrendDataPoint[];
  dlpIncidentsBySensitivity: DistributionDataPoint[];
  dlpEffectiveness: DistributionDataPoint[];
  retentionPolicyCoverage: DistributionDataPoint[];
  complianceScoreTrend: TrendDataPoint[];
  controlPassFail: DistributionDataPoint[];
}

// ── Collaboration & Sharing ────────────────────────────────────────────────────

export interface CollaborationTelemetry {
  oversharedSites: number;
  storageGrowthTrend: TrendDataPoint[];
  fileActivityHeatmap: HeatmapDataPoint[];
  teamsUsageTrend: TrendDataPoint[];
  callQualityMetrics: BarDataPoint[];
  emailActivityTrend: TrendDataPoint[];
  spamPhishingDetections: TrendDataPoint[];
}

// ── Licensing & Cost ───────────────────────────────────────────────────────────

export interface LicensingTelemetry {
  licenseUtilization: DistributionDataPoint[];
  licenseCostBySku: BarDataPoint[];
  costTrend: TrendDataPoint[];
  copilotUsageTrend: TrendDataPoint[];
  recoverableSpend: number;
  skuWasteByDept: BarDataPoint[];
}

// ── Configuration Drift ────────────────────────────────────────────────────────

export interface DriftTelemetry {
  driftEvents: TimelineEvent[];
  policyChangesCount: number;
  adminRoleChangesCount: number;
  criticalAlerts: TimelineEvent[];
}

// ── Intune & Device Management ─────────────────────────────────────────────────

export interface DeviceTelemetry {
  deviceCompliance: DistributionDataPoint[];
  complianceTrend: TrendDataPoint[];
  profileAssignmentStatus: DistributionDataPoint[];
  antivirusStatus: DistributionDataPoint[];
  firewallStatus: DistributionDataPoint[];
}

// ── Usage & Adoption ───────────────────────────────────────────────────────────

export interface AdoptionTelemetry {
  activeUsersTrend: TrendDataPoint[];
  meetingsPerUserTrend: TrendDataPoint[];
  siteVisitsTrend: TrendDataPoint[];
  mobileVsDesktop: DistributionDataPoint[];
  copilotPromptsPerUser: TrendDataPoint[];
}

// ── Operational Maturity ───────────────────────────────────────────────────────

export interface OperationsTelemetry {
  ticketResolutionSlaPct: number;
  automatedVsManual: DistributionDataPoint[];
  workflowSuccessRate: number;
  identityMaturityScore: number;
  deviceMaturityScore: number;
  collaborationMaturityScore: number;
}

// ── Master Payload ─────────────────────────────────────────────────────────────

export interface CommandCenterPayload {
  lastUpdated: string;
  executive: ExecutiveTelemetry;
  identity: IdentityTelemetry;
  security: SecurityPostureTelemetry;
  compliance: ComplianceTelemetry;
  collaboration: CollaborationTelemetry;
  licensing: LicensingTelemetry;
  drift: DriftTelemetry;
  devices: DeviceTelemetry;
  adoption: AdoptionTelemetry;
  operations: OperationsTelemetry;
}
