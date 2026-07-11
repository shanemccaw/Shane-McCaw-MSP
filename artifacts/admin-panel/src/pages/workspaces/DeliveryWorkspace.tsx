import { type ReactNode } from "react";
import WorkspaceLayout, { type WorkspaceNavItem } from "@/components/WorkspaceLayout";
import ProjectsPage from "@/pages/crm/Projects";
import ClientsPage from "@/pages/crm/Clients";
import EngagementProjectsPage from "@/pages/EngagementProjects";
import TenantSignalsPage from "@/pages/TenantSignals";
import WorkflowsPage from "@/pages/Workflows";
import ActivityLogPage from "@/pages/ActivityLog";
import SharePointPage from "@/pages/SharePoint";
import EnginePanel from "@/components/EnginePanel";
import FulfillmentQueuePage from "@/pages/FulfillmentQueue";
import FulfillmentTypesPage from "@/pages/FulfillmentTypes";
import MonitorChecksPage from "@/pages/MonitorChecks";
import MonitoringPackagesPage from "@/pages/MonitoringPackages";

const ENGINE_NAV_KEYS = ["priority", "pricing", "health", "drift", "forecasting", "crm", "msp", "sla", "monitoring", "sales_offer", "scope_creep"] as const;
const ENGINE_LABELS: Record<(typeof ENGINE_NAV_KEYS)[number], string> = {
  priority: "Priority Engine",
  pricing: "Pricing Engine",
  health: "Health Engine",
  drift: "Drift Engine",
  forecasting: "Forecasting Engine",
  crm: "CRM Engine",
  msp: "MSP Engine",
  sla: "SLA Engine",
  monitoring: "Monitoring Engine",
  sales_offer: "Sales Offer Engine",
  scope_creep: "Scope Creep",
};

const NAV_ITEMS: WorkspaceNavItem[] = [
  {
    label: "Projects",
    path: "/delivery/projects",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    label: "Clients",
    path: "/delivery/clients",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: "Engagement Projects",
    path: "/delivery/engagement-projects",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    label: "Workflows",
    path: "/delivery/workflows",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM8 6h8M6 8v8M18 8v8M8 18h8" />
      </svg>
    ),
  },
  {
    label: "Activity Logs",
    path: "/delivery/activity-logs",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    label: "Hub Storage",
    path: "/delivery/hub-storage",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    label: "Tenant Signals",
    path: "/delivery/tenant-signals",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
    ),
  },
  {
    label: "Fulfillment Queue",
    path: "/delivery/fulfillment-queue",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Fulfillment Types",
    path: "/delivery/fulfillment-types",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    label: "Monitor Checks",
    path: "/delivery/monitor-checks",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Monitoring Packages",
    path: "/delivery/monitoring-packages",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
      </svg>
    ),
  },
  ...ENGINE_NAV_KEYS.map((key): WorkspaceNavItem => ({
    label: ENGINE_LABELS[key],
    path: `/delivery/engines/${key}`,
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  })),
];

function getContent(section: string): ReactNode {
  if (section.startsWith("engines/")) {
    const key = section.slice("engines/".length);
    if ((ENGINE_NAV_KEYS as readonly string[]).includes(key)) return <EnginePanel engineKey={key} />;
  }
  switch (section) {
    case "clients":              return <ClientsPage />;
    case "engagement-projects":  return <EngagementProjectsPage />;
    case "tenant-signals":       return <TenantSignalsPage />;
    case "workflows":            return <WorkflowsPage />;
    case "activity-logs":        return <ActivityLogPage />;
    case "hub-storage":          return <SharePointPage />;
    case "fulfillment-queue":    return <FulfillmentQueuePage />;
    case "fulfillment-types":    return <FulfillmentTypesPage />;
    case "monitor-checks":       return <MonitorChecksPage />;
    case "monitoring-packages":  return <MonitoringPackagesPage />;
    default:                     return <ProjectsPage />;
  }
}

export default function DeliveryWorkspace({ section }: { section: string }) {
  return (
    <WorkspaceLayout
      title="Delivery"
      subtitle="Projects, workflows & client delivery"
      navItems={NAV_ITEMS}
    >
      {getContent(section)}
    </WorkspaceLayout>
  );
}
