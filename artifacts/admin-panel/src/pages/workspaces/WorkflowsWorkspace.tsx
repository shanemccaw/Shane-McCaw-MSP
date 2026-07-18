import WorkflowListPage from "@/pages/workflows/WorkflowListPage";
import WorkflowBuilderPage from "@/pages/workflows/WorkflowBuilderPage";
import RunHistoryPage from "@/pages/workflows/RunHistoryPage";
import RunDetailPage from "@/pages/workflows/RunDetailPage";
import TriggersPage from "@/pages/workflows/TriggersPage";
import JsonViewer from "@/pages/workflows/JsonViewer";
import GraphApiResultsPage from "@/pages/workflows/GraphApiResultsPage";
import { Zap } from "lucide-react";
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
      <div className="flex flex-col items-center justify-center h-full text-center py-20 px-6">
        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4">
          <Zap className="w-6 h-6 text-muted-foreground/70" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">Select a workflow to view its triggers</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Open a workflow from the list, then use the Triggers button to configure when it runs.</p>
      </div>
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
    return <JsonViewer />;
  }

  if (section === "graph-api-results") {
    return <GraphApiResultsPage />;
  }

  if (section === "runs") {
    const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
    const defIdParam = searchParams.get("definitionId");
    return <RunHistoryPage initialDefinitionId={defIdParam ? parseInt(defIdParam, 10) : undefined} />;
  }

  return <WorkflowListPage />;
}
