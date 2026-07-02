import WorkspaceLayout, { type WorkspaceNavItem } from "@/components/WorkspaceLayout";
import WorkflowListPage from "@/pages/workflows/WorkflowListPage";
import WorkflowBuilderPage from "@/pages/workflows/WorkflowBuilderPage";
import RunHistoryPage from "@/pages/workflows/RunHistoryPage";
import RunDetailPage from "@/pages/workflows/RunDetailPage";
import TriggersPage from "@/pages/workflows/TriggersPage";
import { useLocation } from "wouter";

const NAV_ITEMS: WorkspaceNavItem[] = [
  {
    label: "Workflows",
    path: "/workflows/list",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
  {
    label: "Run History",
    path: "/workflows/runs",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
];

export default function WorkflowsWorkspace({ section, params }: { section: string; params?: Record<string, string> }) {
  const [location] = useLocation();

  function getContent() {
    if (section === "builder") {
      const defId = parseInt(params?.id ?? "0", 10);
      const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
      const versionId = searchParams.get("vid") ? parseInt(searchParams.get("vid")!, 10) : undefined;
      return <WorkflowBuilderPage defId={defId} versionId={versionId} />;
    }

    if (section === "triggers") {
      const defId = parseInt(params?.id ?? "0", 10);
      return <TriggersPage defId={defId} />;
    }

    if (section === "runs") {
      if (params?.id) {
        const runId = parseInt(params.id, 10);
        return <RunDetailPage runId={runId} />;
      }
      const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
      const defIdParam = searchParams.get("definitionId");
      return <RunHistoryPage initialDefinitionId={defIdParam ? parseInt(defIdParam, 10) : undefined} />;
    }

    return <WorkflowListPage />;
  }

  const isBuilder = section === "builder";
  const isRunDetail = section === "runs" && !!params?.id;
  const isTriggers = section === "triggers";

  if (isBuilder || isRunDetail || isTriggers) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {getContent()}
        </div>
      </div>
    );
  }

  return (
    <WorkspaceLayout
      title="Workflow Engine"
      subtitle="Design, automate & monitor workflows"
      navItems={NAV_ITEMS}
    >
      {getContent()}
    </WorkspaceLayout>
  );
}
