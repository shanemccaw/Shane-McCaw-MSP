import { SimulatorStudioPage } from "@/pages/SimulatorStudioPage";
import { PccDashboard } from "@/pages/PccDashboard";
import { type ReactNode } from "react";
import InboxPage from "@/pages/inbox/Inbox";
import AdminSecurityPage from "@/pages/AdminSecurity";
import QuizPainConfigPage from "@/pages/crm/QuizPainConfig";
import SowDebugPage from "@/pages/SowDebugPage";
import PlatformAgreementsPage from "@/pages/PlatformAgreements";
import ObservabilityDashboard from "@/pages/ObservabilityDashboard";
import PlatformRevenueDashboard from "@/pages/PlatformRevenueDashboard";
import AlertRulesPage from "@/pages/AlertRulesPage";
import ExceptionTracking from "@/pages/ExceptionTracking";
import DashboardDesignerPage from "@/pages/dashboard-designer";

function getContent(section: string): ReactNode {
  switch (section) {
    case "observability":         return <ObservabilityDashboard />;
    case "alert-rules":           return <AlertRulesPage />;
    case "exceptions":            return <ExceptionTracking />;
    case "platform-revenue":      return <PlatformRevenueDashboard />;
    case "security":              return <AdminSecurityPage />;
    case "signal-mappings":       return <QuizPainConfigPage />;
    case "sow-debug":             return <SowDebugPage />;
    case "platform-agreements":   return <PlatformAgreementsPage />;
    case "simulator":             return <SimulatorStudioPage />;
    case "pcc":                   return <PccDashboard />;
    case "dashboard-designer":    return <DashboardDesignerPage />;
    default:                      return <InboxPage />;
  }
}

export default function SystemWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
