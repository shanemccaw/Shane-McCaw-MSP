import { type ReactNode } from "react";
import LeadsPage from "@/pages/crm/Leads";
import QuizLeadsPage from "@/pages/crm/QuizLeads";
import ChatQueuePage from "@/pages/crm/ChatQueue";
import OpportunitiesPage from "@/pages/crm/Opportunities";
import ClientsPage from "@/pages/crm/Clients";
import M365IntelligencePage from "@/pages/crm/M365Intelligence";
import DiagnosticSharesPage from "@/pages/crm/DiagnosticShares";
// Zoho CRM (#83). These sit alongside the existing local-DB pages rather than
// replacing them — decommissioning the old CRM pages is #84's job, gated on
// this phase landing.
import ZohoLeadsPage from "@/pages/crm/zoho/ZohoLeads";
import ZohoDealsPage from "@/pages/crm/zoho/ZohoDeals";
import ZohoContactsPage from "@/pages/crm/zoho/ZohoContacts";
import ZohoAccountsPage from "@/pages/crm/zoho/ZohoAccounts";
// EngageBay Admin Panel: Contacts (#106). Own nav group, same reasoning as
// Zoho CRM above — these read EngageBay, not the local tables.
import EngageBayContactsPage from "@/pages/crm/engagebay/EngageBayContacts";

function getContent(section: string): ReactNode {
  switch (section) {
    case "quiz-leads":          return <QuizLeadsPage />;
    case "chat-queue":          return <ChatQueuePage />;
    case "opportunities":       return <OpportunitiesPage />;
    case "clients":             return <ClientsPage />;
    case "m365-intelligence":   return <M365IntelligencePage />;
    case "diagnostic-shares":   return <DiagnosticSharesPage />;
    case "zoho-leads":          return <ZohoLeadsPage />;
    case "zoho-deals":          return <ZohoDealsPage />;
    case "zoho-contacts":       return <ZohoContactsPage />;
    case "zoho-accounts":       return <ZohoAccountsPage />;
    case "engagebay-contacts":  return <EngageBayContactsPage />;
    default:                    return <LeadsPage />;
  }
}

export default function PipelineWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
