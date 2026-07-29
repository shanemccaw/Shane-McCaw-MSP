// Zoho Accounts page (#83) — list/search, detail, create, edit.

import ZohoEntityPage, { type ZohoEntityConfig } from "./ZohoEntityPage";

const config: ZohoEntityConfig = {
  entity: "accounts",
  title: "Zoho Accounts",
  singular: "account",
  description: "Accounts read live from Zoho CRM. Edits are queued and applied by the 5-minute sync.",
  fields: [
    { name: "Account_Name", label: "Account", required: true },
    { name: "Website", label: "Website" },
    { name: "Phone", label: "Phone" },
    { name: "Industry", label: "Industry" },
    { name: "Billing_City", label: "City" },
    { name: "Billing_State", label: "State", inList: false },
    { name: "Description", label: "Description", inList: false, type: "textarea" },
    { name: "Created_Time", label: "Created", inList: false, editable: false },
  ],
};

export default function ZohoAccountsPage() {
  return <ZohoEntityPage config={config} />;
}
