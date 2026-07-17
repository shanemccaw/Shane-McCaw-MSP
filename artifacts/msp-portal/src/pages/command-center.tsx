import { useState, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { DashboardTemplate } from "@/components/dashboard/DashboardTemplate";
import { 
  BarChart3, 
  ShieldCheck, 
  Lock, 
  FileWarning, 
  FolderSync, 
  DollarSign, 
  History, 
  Smartphone, 
  Users, 
  Activity,
  Loader2
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// Tabs
import { ExecutiveDashboardTab } from "@/components/dashboard/tabs/ExecutiveDashboardTab";
import { IdentityAccessTab } from "@/components/dashboard/tabs/IdentityAccessTab";
import { SecurityPostureTab } from "@/components/dashboard/tabs/SecurityPostureTab";
import { ComplianceGovernanceTab } from "@/components/dashboard/tabs/ComplianceGovernanceTab";
import { CollaborationSharingTab } from "@/components/dashboard/tabs/CollaborationSharingTab";
import { LicensingCostTab } from "@/components/dashboard/tabs/LicensingCostTab";
import { ConfigurationDriftTab } from "@/components/dashboard/tabs/ConfigurationDriftTab";
import { IntuneDeviceTab } from "@/components/dashboard/tabs/IntuneDeviceTab";
import { UsageAdoptionTab } from "@/components/dashboard/tabs/UsageAdoptionTab";
import { OperationalMaturityTab } from "@/components/dashboard/tabs/OperationalMaturityTab";

// Types
import type { CommandCenterPayload } from "@/components/dashboard/command-center-types";

// ── Mock Data Fetcher ──────────────────────────────────────────────────────────
// TODO: Replace with actual backend fetch when Health Engine telemetry is expanded
const fetchTelemetryData = async (): Promise<CommandCenterPayload> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        lastUpdated: new Date().toISOString(),
        executive: {
          overallHealthScore: 10,
          lastUpdated: "July 1, 2026",
          pillarScores: {
            compliance: 0,
            copilot: 20,
            governance: 0,
            adoption: 9,
            security: 22,
          },
          overallSecureScore: 74,
          complianceScore: 68,
          licenseWasteCost: 1240,
          deviceCompliancePct: 89,
          postureTrend: [{ date: "2026-06-16", value: 62 }, { date: "2026-07-16", value: 74 }],
          topRisks: [{ name: "Legacy Auth Enabled", value: 85 }],
          driftEventCount: 3,
          adoptionScore: 84,
          externalSharingRisk: "Moderate",
        },
        identity: {
          mfaCoverage: [
            { name: "MFA Enabled", value: 85, color: "hsl(var(--primary))" },
            { name: "No MFA", value: 15, color: "hsl(var(--destructive))" },
          ],
          legacyAuthTrend: [{ date: "2026-07-01", value: 12 }, { date: "2026-07-16", value: 4 }],
          signInHeatmap: [{ x: "Mon", y: "08:00", value: 42 }, { x: "Tue", y: "09:00", value: 15 }],
          highRiskSignIns: [{ name: "Impossible Travel", value: 2 }],
          pimActivations: [{ id: "1", title: "Global Admin Activated", time: "2 hours ago", status: "warning" }],
          riskyUsersTrend: [{ date: "2026-07-01", value: 2 }, { date: "2026-07-16", value: 0 }],
          riskDetectionsByCategory: [{ name: "Unfamiliar Sign-in", value: 4, color: "hsl(var(--warning))" }],
        },
        security: {
          secureScoreTrend: [{ date: "2026-07-01", value: 65 }, { date: "2026-07-16", value: 74 }],
          secureScoreByCategory: [{ name: "Identity", value: 45, color: "hsl(var(--primary))" }, { name: "Data", value: 20, color: "#10b981" }],
          alertsBySeverity: [{ name: "High", value: 2, color: "hsl(var(--destructive))" }, { name: "Low", value: 14, color: "hsl(var(--muted))" }],
          alertsByWorkload: [{ name: "Defender", value: 8, color: "#3b82f6" }],
          missingPatches: [{ name: "DESKTOP-ABC", value: 4 }],
          vulnerabilitiesBySeverity: [{ name: "CVE-2024-1234", value: 1 }],
        },
        compliance: {
          dlpMatchFrequency: [{ date: "2026-07-01", value: 5 }],
          dlpIncidentsBySensitivity: [{ name: "Confidential", value: 3, color: "hsl(var(--destructive))" }],
          dlpEffectiveness: [{ name: "Blocked", value: 42, color: "#10b981" }],
          retentionPolicyCoverage: [{ name: "Covered", value: 80, color: "hsl(var(--primary))" }],
          complianceScoreTrend: [{ date: "2026-07-01", value: 60 }],
          controlPassFail: [{ name: "Passed", value: 140, color: "#10b981" }, { name: "Failed", value: 24, color: "hsl(var(--destructive))" }],
        },
        collaboration: {
          oversharedSites: 12,
          storageGrowthTrend: [{ date: "2026-07-01", value: 450 }],
          fileActivityHeatmap: [{ x: "Mon", y: "09:00", value: 120 }],
          teamsUsageTrend: [{ date: "2026-07-01", value: 85 }],
          callQualityMetrics: [{ name: "Poor Quality", value: 2 }],
          emailActivityTrend: [{ date: "2026-07-01", value: 5000 }],
          spamPhishingDetections: [{ date: "2026-07-01", value: 45 }],
        },
        licensing: {
          licenseUtilization: [{ name: "Assigned", value: 120, color: "hsl(var(--primary))" }, { name: "Unassigned", value: 15, color: "hsl(var(--muted))" }],
          licenseCostBySku: [{ name: "E5", value: 4500 }],
          costTrend: [{ date: "2026-06", value: 4500 }, { date: "2026-07", value: 4400 }],
          copilotUsageTrend: [{ date: "2026-07-01", value: 12 }],
          recoverableSpend: 1240,
          skuWasteByDept: [{ name: "Sales", value: 450 }],
        },
        drift: {
          driftEvents: [{ id: "1", title: "Conditional Access Modified", time: "Yesterday", status: "error" }],
          policyChangesCount: 5,
          adminRoleChangesCount: 0,
          criticalAlerts: [{ id: "1", title: "MFA Baseline Disabled", time: "2 days ago", status: "error" }],
        },
        devices: {
          deviceCompliance: [{ name: "Compliant", value: 142, color: "#10b981" }, { name: "Non-Compliant", value: 12, color: "hsl(var(--destructive))" }],
          complianceTrend: [{ date: "2026-07-01", value: 130 }, { date: "2026-07-16", value: 142 }],
          profileAssignmentStatus: [{ name: "Success", value: 100, color: "#10b981" }],
          antivirusStatus: [{ name: "Active", value: 154, color: "#10b981" }],
          firewallStatus: [{ name: "Enabled", value: 154, color: "#10b981" }],
        },
        adoption: {
          activeUsersTrend: [{ date: "2026-07-01", value: 140 }],
          meetingsPerUserTrend: [{ date: "2026-07-01", value: 4.2 }],
          siteVisitsTrend: [{ date: "2026-07-01", value: 450 }],
          mobileVsDesktop: [{ name: "Desktop", value: 80, color: "hsl(var(--primary))" }, { name: "Mobile", value: 20, color: "#8b5cf6" }],
          copilotPromptsPerUser: [{ date: "2026-07-01", value: 8.5 }],
        },
        operations: {
          ticketResolutionSlaPct: 98,
          automatedVsManual: [{ name: "Automated", value: 65, color: "#10b981" }, { name: "Manual", value: 35, color: "hsl(var(--muted))" }],
          workflowSuccessRate: 99.2,
          identityMaturityScore: 82,
          deviceMaturityScore: 78,
          collaborationMaturityScore: 65,
        },
      });
    }, 800);
  });
};

export default function CommandCenterPage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<CommandCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    // In production, this would be: fetchWithAuth("/api/portal/command-center")
    fetchTelemetryData().then((res) => {
      if (mounted) {
        setData(res);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, [fetchWithAuth]);

  if (loading) {
    return (
      <AppShell title="Command Center">
        <div className="min-h-[600px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-slate-500">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p>Loading telemetry data...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const tabs = [
    {
      id: "executive",
      label: "Executive Dashboard",
      icon: BarChart3,
      component: <ExecutiveDashboardTab data={data?.executive || null} />,
    },
    {
      id: "identity",
      label: "Identity & Access",
      icon: Lock,
      component: <IdentityAccessTab data={data?.identity || null} />,
    },
    {
      id: "security",
      label: "Security Posture",
      icon: ShieldCheck,
      component: <SecurityPostureTab data={data?.security || null} />,
    },
    {
      id: "compliance",
      label: "Compliance & Governance",
      icon: FileWarning,
      component: <ComplianceGovernanceTab data={data?.compliance || null} />,
    },
    {
      id: "collaboration",
      label: "Collaboration & Sharing",
      icon: FolderSync,
      component: <CollaborationSharingTab data={data?.collaboration || null} />,
    },
    {
      id: "licensing",
      label: "Licensing & Cost",
      icon: DollarSign,
      component: <LicensingCostTab data={data?.licensing || null} />,
    },
    {
      id: "drift",
      label: "Configuration Drift",
      icon: History,
      component: <ConfigurationDriftTab data={data?.drift || null} />,
    },
    {
      id: "intune",
      label: "Intune & Devices",
      icon: Smartphone,
      component: <IntuneDeviceTab data={data?.devices || null} />,
    },
    {
      id: "adoption",
      label: "Usage & Adoption",
      icon: Users,
      component: <UsageAdoptionTab data={data?.adoption || null} />,
    },
    {
      id: "operations",
      label: "Operational Maturity",
      icon: Activity,
      component: <OperationalMaturityTab data={data?.operations || null} />,
    },
  ];

  return (
    <AppShell title="Command Center">
      <div className="p-6 h-[calc(100vh-4rem)] max-w-[1600px] mx-auto">
        <DashboardTemplate
          title="M365 Command Center"
          description="Enterprise monitoring, visualization, and drift detection powered by Health Engine Telemetry"
          tabs={tabs}
          defaultTabId="executive"
        />
      </div>
    </AppShell>
  );
}
