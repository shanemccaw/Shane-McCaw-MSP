// Zoho Contacts page (#83) — list/search, detail, create, edit.

import ZohoEntityPage, { type ZohoEntityConfig } from "./ZohoEntityPage";

const config: ZohoEntityConfig = {
  entity: "contacts",
  title: "Zoho Contacts",
  singular: "contact",
  description: "Contacts read live from Zoho CRM. Edits are queued and applied by the 5-minute sync.",
  fields: [
    { name: "Full_Name", label: "Name", editable: false },
    { name: "First_Name", label: "First name", inList: false },
    // Zoho requires Last_Name on every Contact.
    { name: "Last_Name", label: "Last name", inList: false, required: true },
    { name: "Email", label: "Email", type: "email" },
    { name: "Phone", label: "Phone" },
    { name: "Account_Name", label: "Account", editable: false },
    { name: "Title", label: "Title" },
    { name: "Description", label: "Description", inList: false, type: "textarea" },
    { name: "Created_Time", label: "Created", inList: false, editable: false },
  ],
};

export default function ZohoContactsPage() {
  return <ZohoEntityPage config={config} />;
}
