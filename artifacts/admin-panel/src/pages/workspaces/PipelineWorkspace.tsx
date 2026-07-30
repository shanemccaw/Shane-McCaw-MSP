import { type ReactNode } from "react";
import QuizLeadsPage from "@/pages/crm/QuizLeads";
import ChatQueuePage from "@/pages/crm/ChatQueue";
import ClientsPage from "@/pages/crm/Clients";
import M365IntelligencePage from "@/pages/crm/M365Intelligence";
import DiagnosticSharesPage from "@/pages/crm/DiagnosticShares";
// Zoho CRM (#83). As of #135 (Decommission Legacy CRM Phase A) these have fully
// replaced the local-DB Leads/Opportunities pages, which are deleted — Zoho Leads
// is now this workspace's default section.
import ZohoLeadsPage from "@/pages/crm/zoho/ZohoLeads";
import ZohoDealsPage from "@/pages/crm/zoho/ZohoDeals";
import ZohoContactsPage from "@/pages/crm/zoho/ZohoContacts";
import ZohoAccountsPage from "@/pages/crm/zoho/ZohoAccounts";
// EngageBay Admin Panel: Contacts (#106). Own nav group, same reasoning as
// Zoho CRM above — these read EngageBay, not the local tables.
import EngageBayContactsPage from "@/pages/crm/engagebay/EngageBayContacts";
// EngageBay Admin Panel: Tags (#107) — list-only, no create/edit/detail exists.
import EngageBayTagsPage from "@/pages/crm/engagebay/EngageBayTags";
// EngageBay Admin Panel: Activity Log + Settings (#109).
import EngageBayActivityLogPage from "@/pages/crm/engagebay/EngageBayActivityLog";
import EngageBaySettingsPage from "@/pages/crm/engagebay/EngageBaySettings";

function getContent(section: string): ReactNode {
  switch (section) {
    case "quiz-leads":          return <QuizLeadsPage />;
    case "chat-queue":          return <ChatQueuePage />;
    case "clients":             return <ClientsPage />;
    case "m365-intelligence":   return <M365IntelligencePage />;
    case "diagnostic-shares":   return <DiagnosticSharesPage />;
    case "zoho-leads":          return <ZohoLeadsPage />;
    case "zoho-deals":          return <ZohoDealsPage />;
    case "zoho-contacts":       return <ZohoContactsPage />;
    case "zoho-accounts":       return <ZohoAccountsPage />;
    case "engagebay-contacts":  return <EngageBayContactsPage />;
    case "engagebay-tags":      return <EngageBayTagsPage />;
    case "engagebay-activity":  return <EngageBayActivityLogPage />;
    case "engagebay-settings":  return <EngageBaySettingsPage />;
    // #135: the default was the deleted local-CRM LeadsPage. Zoho Leads is the
    // section that superseded it, so an unknown/absent section lands there.
    default:                    return <ZohoLeadsPage />;
  }
}

export default function PipelineWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
