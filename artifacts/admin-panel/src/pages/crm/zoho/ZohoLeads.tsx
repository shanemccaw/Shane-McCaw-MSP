// Zoho Leads page (#83) — list/search, detail, create, edit, convert.

import { useState } from "react";
import ZohoEntityPage, { type ZohoEntityConfig, type ExtraActionContext } from "./ZohoEntityPage";

/**
 * The funnel-transition action. Convert is irreversible in Zoho (the Lead stops
 * being a Lead), so it is confirmed explicitly rather than fired from a single
 * click, and it is queued like every other write.
 */
function ConvertAction({ record, runWrite, busy }: ExtraActionContext) {
  const [confirming, setConfirming] = useState(false);
  const [dealName, setDealName] = useState("");
  const id = String(record.id ?? "");

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        disabled={busy || !id}
        className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
      >
        Convert lead
      </button>
    );
  }

  return (
    <div className="w-full border border-border rounded-lg p-4 space-y-3">
      <p className="text-sm text-foreground font-semibold">Convert this lead?</p>
      <p className="text-xs text-muted-foreground">
        Zoho creates a Contact, an Account and (optionally) a Deal, and the Lead stops existing as a Lead.
        This cannot be undone from here. The conversion is queued and runs on the next sync.
      </p>
      <label className="block">
        <span className="text-xs text-muted-foreground">Deal name (optional — leave blank to convert without a deal)</span>
        <input
          value={dealName}
          onChange={(e) => setDealName(e.target.value)}
          className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        />
      </label>
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={() => {
            void runWrite(
              `/api/zoho/crm/leads/${encodeURIComponent(id)}/convert`,
              "POST",
              dealName.trim() ? { deal: { Deal_Name: dealName.trim() } } : {},
            ).then(() => setConfirming(false));
          }}
          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          Queue conversion
        </button>
        <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

const config: ZohoEntityConfig = {
  entity: "leads",
  title: "Zoho Leads",
  singular: "lead",
  description: "Leads read live from Zoho CRM, the system of record. Edits are queued and applied by the 5-minute sync.",
  supportsNotes: true,
  fields: [
    { name: "Full_Name", label: "Name", editable: false },
    { name: "First_Name", label: "First name", inList: false },
    // Zoho requires Last_Name on every Lead.
    { name: "Last_Name", label: "Last name", inList: false, required: true },
    { name: "Email", label: "Email", type: "email" },
    { name: "Company", label: "Company", required: true },
    { name: "Phone", label: "Phone" },
    { name: "Lead_Status", label: "Status", inList: false },
    { name: "Lead_Source", label: "Source", inList: false },
    { name: "Industry", label: "Industry", inList: false },
    { name: "Description", label: "Description", inList: false, type: "textarea" },
    { name: "Created_Time", label: "Created", inList: false, editable: false },
  ],
  extraActions: (ctx) => <ConvertAction {...ctx} />,
};

export default function ZohoLeadsPage() {
  return <ZohoEntityPage config={config} />;
}
