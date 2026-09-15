import { type ReactNode } from "react";
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
import ConfigResourceModelPage from "@/pages/ConfigResourceModel";
import ConfigSnapshotReportPage from "@/pages/ConfigSnapshotReport";
import ConfigDiffReportPage from "@/pages/ConfigDiffReport";
import BaselineTemplatesPage from "@/pages/BaselineTemplates";
import EngagementOfferRules from "@/pages/delivery/EngagementOfferRules";

const ENGINE_KEYS = ["priority", "pricing", "health", "security", "drift", "forecasting", "crm", "msp", "sla", "monitoring", "sales_offer", "scope_creep"] as const;

function getContent(section: string): ReactNode {
  if (section.startsWith("engines/")) {
    const key = section.slice("engines/".length);
    if ((ENGINE_KEYS as readonly string[]).includes(key)) return <EnginePanel engineKey={key} />;
  }
  switch (section) {
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
    case "config-resources":     return <ConfigResourceModelPage />;
    case "config-snapshots":     return <ConfigSnapshotReportPage />;
    case "config-diffs":         return <ConfigDiffReportPage />;
    case "baseline-templates":   return <BaselineTemplatesPage />;
    case "engagement-offers":    return <EngagementOfferRules />;
    // The Delivery Projects Kanban board (the old default here) relocated to
    // msp-console (Git #4246, #3433) — real drag-and-drop, live SSE, typed
    // cards, all moved rather than duplicated. Nothing left to render locally.
    default:                     return <ProjectsMovedNotice />;
  }
}

function ProjectsMovedNotice() {
  return (
    <div className="p-4 sm:p-6 max-w-[600px]">
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <h1 className="text-lg font-bold text-foreground mb-2">Projects moved to MSP Console</h1>
        <p className="text-sm text-muted-foreground mb-4">
          The Delivery Projects Kanban board now lives in MSP Console, under Operations → Client Delivery → Delivery Projects.
        </p>
        <a
          href="/msp-console/ops/delivery-projects"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          Open in MSP Console →
        </a>
      </div>
    </div>
  );
}

export default function DeliveryWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
