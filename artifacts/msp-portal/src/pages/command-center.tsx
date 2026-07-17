import { AppShell } from "@/components/app-shell";
import { DashboardTemplate } from "@/components/dashboard/DashboardTemplate";
import { ExecutiveDashboardTab } from "@/components/dashboard/tabs/ExecutiveDashboardTab";
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
  Activity 
} from "lucide-react";

export default function CommandCenterPage() {
  const tabs = [
    {
      id: "executive",
      label: "Executive Dashboard",
      icon: BarChart3,
      component: <ExecutiveDashboardTab />,
    },
    {
      id: "identity",
      label: "Identity & Access",
      icon: Lock,
      component: <div className="p-8 text-center text-slate-500">Identity & Access components coming soon</div>,
    },
    {
      id: "security",
      label: "Security Posture",
      icon: ShieldCheck,
      component: <div className="p-8 text-center text-slate-500">Security Posture components coming soon</div>,
    },
    {
      id: "compliance",
      label: "Compliance & Governance",
      icon: FileWarning,
      component: <div className="p-8 text-center text-slate-500">Compliance & Governance components coming soon</div>,
    },
    {
      id: "collaboration",
      label: "Collaboration & Sharing",
      icon: FolderSync,
      component: <div className="p-8 text-center text-slate-500">Collaboration & Sharing components coming soon</div>,
    },
    {
      id: "licensing",
      label: "Licensing & Cost",
      icon: DollarSign,
      component: <div className="p-8 text-center text-slate-500">Licensing & Cost components coming soon</div>,
    },
    {
      id: "drift",
      label: "Configuration Drift",
      icon: History,
      component: <div className="p-8 text-center text-slate-500">Configuration Drift components coming soon</div>,
    },
    {
      id: "intune",
      label: "Intune & Devices",
      icon: Smartphone,
      component: <div className="p-8 text-center text-slate-500">Intune & Devices components coming soon</div>,
    },
    {
      id: "adoption",
      label: "Usage & Adoption",
      icon: Users,
      component: <div className="p-8 text-center text-slate-500">Usage & Adoption components coming soon</div>,
    },
    {
      id: "operations",
      label: "Operational Maturity",
      icon: Activity,
      component: <div className="p-8 text-center text-slate-500">Operational Maturity components coming soon</div>,
    },
  ];

  return (
    <AppShell title="Command Center">
      <div className="p-6 h-[calc(100vh-4rem)] max-w-[1600px] mx-auto">
        <DashboardTemplate
          title="M365 Command Center"
          description="Enterprise monitoring, visualization, and drift detection"
          tabs={tabs}
          defaultTabId="executive"
        />
      </div>
    </AppShell>
  );
}
