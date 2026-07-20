import { type ReactNode, lazy, Suspense } from "react";
import OverviewPage from "@/pages/Overview";
import MessagesPage from "@/pages/crm/Messages";
import AnalyticsPage from "@/pages/Analytics";
import AnalyticsHeatmapPage from "@/pages/AnalyticsHeatmap";
import ScriptGeneratorPage from "@/pages/ScriptGeneratorPage";
import RunningScriptsPage from "@/pages/RunningScriptsPage";
import PromptCenterPage from "@/pages/PromptCenter";
import InsightsOutputsPage from "@/pages/InsightsOutputs";
import PresentationsPage from "@/pages/workspaces/command/PresentationsPage";
import SessionReplayPage from "@/pages/SessionReplay";
import AttributionPage from "@/pages/Attribution";

const MarketingCommandCenterPage = lazy(() => import("@/pages/MarketingCommandCenter"));

function getContent(section: string): ReactNode {
  switch (section) {
    case "messages":         return <MessagesPage />;
    case "analytics":        return <AnalyticsPage />;
    case "session-replay":   return <SessionReplayPage />;
    case "attribution":      return <AttributionPage />;
    case "heatmap":          return <AnalyticsHeatmapPage />;
    case "scripts":          return <ScriptGeneratorPage />;
    case "running-scripts":  return <RunningScriptsPage />;
    case "prompts":          return <PromptCenterPage />;
    case "marketing":        return (
      <Suspense fallback={
        <div className="h-full flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <MarketingCommandCenterPage />
      </Suspense>
    );
    case "insights":         return <InsightsOutputsPage />;
    case "presentations":    return <PresentationsPage />;
    default:                 return <OverviewPage />;
  }
}

export default function CommandWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
