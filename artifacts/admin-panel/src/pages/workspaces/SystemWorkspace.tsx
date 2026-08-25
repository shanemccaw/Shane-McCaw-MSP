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
import CustomerAlertRulesPage from "@/pages/CustomerAlertRulesPage";
import ExceptionTracking from "@/pages/ExceptionTracking";
import IncidentsAdminPage from "@/pages/IncidentsAdminPage";
import { ActiveDirectoryPage } from "@/pages/ActiveDirectoryPage";
import AiBillingPage from "@/pages/AiBillingPage";
import ZohoIntegrationPage from "@/pages/integrations/ZohoIntegrationPage";

function getContent(section: string): ReactNode {
  switch (section) {
    case "observability":         return <ObservabilityDashboard />;
    case "alert-rules":           return <AlertRulesPage />;
    case "customer-alert-rules":  return <CustomerAlertRulesPage />;
    case "exceptions":            return <ExceptionTracking />;
    case "incidents":             return <IncidentsAdminPage />;
    case "platform-revenue":      return <PlatformRevenueDashboard />;
    case "security":              return <AdminSecurityPage />;
    case "signal-mappings":       return <QuizPainConfigPage />;
    case "sow-debug":             return <SowDebugPage />;
    case "platform-agreements":   return <PlatformAgreementsPage />;
    case "simulator":             return <SimulatorStudioPage />;
    case "active-directory":      return <ActiveDirectoryPage />;
    case "ai-billing":            return <AiBillingPage />;
    case "integrations-zoho":     return <ZohoIntegrationPage />;
    case "pcc":                   return <PccDashboard />;
    default:                      return <InboxPage />;
  }
}

export default function SystemWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
