import { type ReactNode } from "react";
import LeadsPage from "@/pages/crm/Leads";
import QuizLeadsPage from "@/pages/crm/QuizLeads";
import ChatQueuePage from "@/pages/crm/ChatQueue";
import OpportunitiesPage from "@/pages/crm/Opportunities";
import ClientsPage from "@/pages/crm/Clients";
import M365IntelligencePage from "@/pages/crm/M365Intelligence";
import DiagnosticSharesPage from "@/pages/crm/DiagnosticShares";

function getContent(section: string): ReactNode {
  switch (section) {
    case "quiz-leads":          return <QuizLeadsPage />;
    case "chat-queue":          return <ChatQueuePage />;
    case "opportunities":       return <OpportunitiesPage />;
    case "clients":             return <ClientsPage />;
    case "m365-intelligence":   return <M365IntelligencePage />;
    case "diagnostic-shares":   return <DiagnosticSharesPage />;
    default:                    return <LeadsPage />;
  }
}

export default function PipelineWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
