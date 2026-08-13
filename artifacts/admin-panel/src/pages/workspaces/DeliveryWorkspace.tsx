import { type ReactNode } from "react";
import ProjectsPage from "@/pages/crm/Projects";
import ClientsPage from "@/pages/crm/Clients";
import EngagementProjectsPage from "@/pages/EngagementProjects";
import TenantSignalsPage from "@/pages/TenantSignals";
import SignalRulesPage from "@/pages/SignalRules";
import WorkflowsPage from "@/pages/Workflows";
import ActivityLogPage from "@/pages/ActivityLog";
import SharePointPage from "@/pages/SharePoint";
import EnginePanel from "@/components/EnginePanel";
import FulfillmentQueuePage from "@/pages/FulfillmentQueue";
import FulfillmentTypesPage from "@/pages/FulfillmentTypes";
import MonitorChecksPage from "@/pages/MonitorChecks";
import MonitoringPackagesPage from "@/pages/MonitoringPackages";
import BaselineTemplatesPage from "@/pages/BaselineTemplates";
import EngagementOfferRules from "@/pages/delivery/EngagementOfferRules";

const ENGINE_KEYS = ["priority", "pricing", "health", "security", "drift", "forecasting", "crm", "msp", "sla", "monitoring", "sales_offer", "scope_creep"] as const;

function getContent(section: string): ReactNode {
  if (section.startsWith("engines/")) {
    const key = section.slice("engines/".length);
    if ((ENGINE_KEYS as readonly string[]).includes(key)) return <EnginePanel engineKey={key} />;
  }
  switch (section) {
    case "clients":              return <ClientsPage />;
    case "engagement-projects":  return <EngagementProjectsPage />;
    case "tenant-signals":       return <TenantSignalsPage />;
    case "signal-rules":         return <SignalRulesPage />;
    case "workflows":            return <WorkflowsPage />;
    case "activity-logs":        return <ActivityLogPage />;
    case "hub-storage":          return <SharePointPage />;
    case "fulfillment-queue":    return <FulfillmentQueuePage />;
    case "fulfillment-types":    return <FulfillmentTypesPage />;
    case "monitor-checks":       return <MonitorChecksPage />;
    case "monitoring-packages":  return <MonitoringPackagesPage />;
    case "baseline-templates":   return <BaselineTemplatesPage />;
    case "engagement-offers":    return <EngagementOfferRules />;
    default:                     return <ProjectsPage />;
  }
}

export default function DeliveryWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
