import { type ReactNode } from "react";
import WorkspaceLayout, { type WorkspaceNavItem } from "@/components/WorkspaceLayout";
import InvoicesPage from "@/pages/crm/Invoices";
import PurchasesPage from "@/pages/crm/Purchases";
import ContractsPage from "@/pages/crm/Contracts";
import CouponsPage from "@/pages/Coupons";
import ReportsPage from "@/pages/crm/Reports";

const NAV_ITEMS: WorkspaceNavItem[] = [
  {
    label: "Invoices",
    path: "/finance/invoices",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    label: "Purchases",
    path: "/finance/purchases",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    label: "Contracts",
    path: "/finance/contracts",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
  },
  {
    label: "Coupons",
    path: "/finance/coupons",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M17 17h.01M9 3H5a2 2 0 00-2 2v4l9.5 9.5a2 2 0 002.83 0l4.17-4.17a2 2 0 000-2.83L10 3H9z" />
      </svg>
    ),
  },
  {
    label: "Reports",
    path: "/finance/reports",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

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
  return (
    <WorkspaceLayout
      title="Finance"
      subtitle="Invoices, purchases & revenue"
      navItems={NAV_ITEMS}
    >
      {getContent(section)}
    </WorkspaceLayout>
  );
}
