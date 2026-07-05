import WorkflowListPage from "@/pages/workflows/WorkflowListPage";
import WorkflowBuilderPage from "@/pages/workflows/WorkflowBuilderPage";
import RunHistoryPage from "@/pages/workflows/RunHistoryPage";
import RunDetailPage from "@/pages/workflows/RunDetailPage";
import TriggersPage from "@/pages/workflows/TriggersPage";
import { useLocation } from "wouter";

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

  if (section === "triggers") {
    const defId = parseInt(params?.id ?? "0", 10);
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <TriggersPage defId={defId} />
        </div>
      </div>
    );
  }

  if (section === "runs") {
    if (params?.id) {
      const runId = parseInt(params.id, 10);
      return (
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <RunDetailPage runId={runId} />
          </div>
        </div>
      );
    }
    const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
    const defIdParam = searchParams.get("definitionId");
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <RunHistoryPage initialDefinitionId={defIdParam ? parseInt(defIdParam, 10) : undefined} />
        </div>
      </div>
    );
  }

  return <WorkflowListPage />;
}
