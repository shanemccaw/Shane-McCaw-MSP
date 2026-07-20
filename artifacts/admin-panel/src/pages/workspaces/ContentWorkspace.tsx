import { type ReactNode } from "react";
import ArticlesPage from "@/pages/Articles";
import HeroHeadlinesPage from "@/pages/HeroHeadlines";
import ServicesPage from "@/pages/Services";
import EmailTemplatesPage from "@/pages/EmailTemplates";
import ContractTemplatesPage from "@/pages/ContractTemplates";
import TemplateLibraryPage from "@/pages/templates/TemplateLibrary";
import InstructionSetsPage from "@/pages/asset-library/InstructionSetsPage";
import DashboardDesignerPage from "@/pages/dashboard-designer";

function getContent(section: string): ReactNode {
  switch (section) {
    case "hero-headlines":        return <HeroHeadlinesPage />;
    case "services":              return <ServicesPage />;
    case "email-templates":       return <EmailTemplatesPage />;
    case "contract-templates":    return <ContractTemplatesPage />;
    case "template-library":      return <TemplateLibraryPage />;
    case "asset-library":         return <InstructionSetsPage />;
    case "dashboard-designer":    return <DashboardDesignerPage />;
    default:                      return <ArticlesPage />;
  }
}

export default function ContentWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
