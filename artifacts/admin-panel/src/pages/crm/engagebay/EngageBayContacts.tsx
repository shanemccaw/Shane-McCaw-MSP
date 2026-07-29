// EngageBay Contacts page (#106) — list/search, detail, create, edit, tag.

import EngageBayEntityPage, { type EngageBayEntityConfig } from "./EngageBayEntityPage";

const config: EngageBayEntityConfig = {
  entity: "contacts",
  title: "EngageBay Contacts",
  singular: "contact",
  description: "Contacts read live from EngageBay. Edits are queued and applied by the 5-minute sync.",
  supportsTags: true,
  fields: [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "name", label: "Name" },
    { name: "status", label: "Status", editable: false },
    { name: "score", label: "Score", editable: false, inList: false },
    { name: "created_time", label: "Created", editable: false, inList: false },
  ],
};

export default function EngageBayContactsPage() {
  return <EngageBayEntityPage config={config} />;
}
