import WorkflowListPage from "@/pages/workflows/WorkflowListPage";
import WorkflowBuilderPage from "@/pages/workflows/WorkflowBuilderPage";
import RunHistoryPage from "@/pages/workflows/RunHistoryPage";
import RunDetailPage from "@/pages/workflows/RunDetailPage";
import TriggersPage from "@/pages/workflows/TriggersPage";
import JsonViewer from "@/pages/workflows/JsonViewer";
import GraphApiResultsPage from "@/pages/workflows/GraphApiResultsPage";
import WorkspaceLayout, { type WorkspaceNavItem } from "@/components/WorkspaceLayout";
import { useLocation } from "wouter";

const NAV_ITEMS: WorkspaceNavItem[] = [
  {
    label: "Workflows",
    path: "/workflows/list",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    label: "Run History",
    path: "/workflows/runs",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Triggers",
    path: "/workflows/triggers",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    label: "JSON Viewer",
    path: "/workflows/json-viewer",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    label: "Graph API Cache",
    path: "/workflows/graph-api-results",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
];

export default function WorkflowsWorkspace({ section, params }: { section: string; params?: Record<string, string> }) {
  const [location] = useLocation();

  if (section === "builder") {
    const defId = parseInt(params?.id ?? "0", 10);
    const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
    const versionId = searchParams.get("vid") ? parseInt(searchParams.get("vid")!, 10) : undefined;
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <WorkflowBuilderPage defId={defId} versionId={versionId} />
        </div>
      </div>
    );
  }

  if (section === "triggers" && params?.id) {
    const defId = parseInt(params.id, 10);
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <TriggersPage defId={defId} />
        </div>
      </div>
    );
  }

  if (section === "triggers") {
    return (
      <WorkspaceLayout
        title="Workflows"
        subtitle="Design, automate & monitor"
        navItems={NAV_ITEMS}
      >
        <div className="flex flex-col items-center justify-center h-full text-center py-20 px-6">
          <div className="w-12 h-12 bg-[#1C2128] rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[#7D8590]">Select a workflow to view its triggers</p>
          <p className="text-xs text-[#484F58] mt-1">Open a workflow from the list, then use the Triggers button to configure when it runs.</p>
        </div>
      </WorkspaceLayout>
    );
  }

  if (section === "runs" && params?.id) {
    const runId = parseInt(params.id, 10);
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <RunDetailPage runId={runId} />
        </div>
      </div>
    );
  }

  if (section === "json-viewer") {
    return (
      <WorkspaceLayout
        title="Workflows"
        subtitle="Design, automate & monitor"
        navItems={NAV_ITEMS}
      >
        <JsonViewer />
      </WorkspaceLayout>
    );
  }

  if (section === "graph-api-results") {
    return (
      <WorkspaceLayout
        title="Workflows"
        subtitle="Design, automate & monitor"
        navItems={NAV_ITEMS}
      >
        <GraphApiResultsPage />
      </WorkspaceLayout>
    );
  }

  if (section === "runs") {
    const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
    const defIdParam = searchParams.get("definitionId");
    return (
      <WorkspaceLayout
        title="Workflows"
        subtitle="Design, automate & monitor"
        navItems={NAV_ITEMS}
      >
        <RunHistoryPage initialDefinitionId={defIdParam ? parseInt(defIdParam, 10) : undefined} />
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout
      title="Workflows"
      subtitle="Design, automate & monitor"
      navItems={NAV_ITEMS}
    >
      <WorkflowListPage />
    </WorkspaceLayout>
  );
}
