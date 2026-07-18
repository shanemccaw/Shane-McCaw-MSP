import { type ReactNode } from "react";
import InvoicesPage from "@/pages/crm/Invoices";
import PurchasesPage from "@/pages/crm/Purchases";
import ContractsPage from "@/pages/crm/Contracts";
import CouponsPage from "@/pages/Coupons";
import ReportsPage from "@/pages/crm/Reports";

function getContent(section: string): ReactNode {
  switch (section) {
    case "purchases":  return <PurchasesPage />;
    case "contracts":  return <ContractsPage />;
    case "coupons":    return <CouponsPage />;
    case "reports":    return <ReportsPage />;
    default:           return <InvoicesPage />;
  }
}

export default function FinanceWorkspace({ section }: { section: string }) {
  return <>{getContent(section)}</>;
}
