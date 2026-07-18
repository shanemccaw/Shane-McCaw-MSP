import { type ReactNode } from "react";
import ArticlesPage from "@/pages/Articles";
import ServicesPage from "@/pages/Services";
import ServicePageTriggersPage from "@/pages/ServicePageTriggers";
import EmailTemplatesPage from "@/pages/EmailTemplates";
import ContractTemplatesPage from "@/pages/ContractTemplates";
import TemplateLibraryPage from "@/pages/templates/TemplateLibrary";
import InstructionSetsPage from "@/pages/asset-library/InstructionSetsPage";

function getContent(section: string): ReactNode {
  switch (section) {
    case "services":              return <ServicesPage />;
    case "service-triggers":      return <ServicePageTriggersPage />;
    case "email-templates":       return <EmailTemplatesPage />;
    case "contract-templates":    return <ContractTemplatesPage />;
    case "template-library":      return <TemplateLibraryPage />;
    case "asset-library":         return <InstructionSetsPage />;
    default:                      return <ArticlesPage />;
  }
}

export default function ContentWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
