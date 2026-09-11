import { type ReactNode, lazy, Suspense } from "react";
import AnalyticsPage from "@/pages/Analytics";
import ScriptGeneratorPage from "@/pages/ScriptGeneratorPage";
import PromptCenterPage from "@/pages/PromptCenter";

const MarketingCommandCenterPage = lazy(() => import("@/pages/MarketingCommandCenter"));

function getContent(section: string): ReactNode {
  switch (section) {
    case "analytics":        return <AnalyticsPage />;
    case "scripts":          return <ScriptGeneratorPage />;
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
    default:                 return <PromptCenterPage />;
  }
}

export default function CommandWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
