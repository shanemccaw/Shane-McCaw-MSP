// Zoho Deals page (#83) — list/search, detail, create, edit, stage + amount.

import { useState } from "react";
import ZohoEntityPage, { type ZohoEntityConfig, type ExtraActionContext } from "./ZohoEntityPage";

/**
 * Stage and amount get dedicated actions rather than living only in the edit
 * form: they are the two edits that actually happen day-to-day on a deals
 * board, and each has its own queued endpoint.
 */
function DealActions({ record, runWrite, busy }: ExtraActionContext) {
  const id = String(record.id ?? "");
  const [stage, setStage] = useState(typeof record.Stage === "string" ? record.Stage : "");
  const [amount, setAmount] = useState(
    record.Amount === null || record.Amount === undefined ? "" : String(record.Amount),
  );

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="border border-border rounded-lg p-4 space-y-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">Stage</span>
          <input
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            placeholder="e.g. Qualification"
          />
        </label>
        <button
          disabled={busy || !stage.trim() || !id}
          onClick={() => { void runWrite(`/api/zoho/crm/deals/${encodeURIComponent(id)}/stage`, "POST", { stage: stage.trim() }); }}
          className="px-4 py-2 rounded-lg border border-border text-sm text-foreground disabled:opacity-50"
        >
          Queue stage change
        </button>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">Amount</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          />
        </label>
        <button
          disabled={busy || amount.trim() === "" || !Number.isFinite(Number(amount)) || !id}
          onClick={() => { void runWrite(`/api/zoho/crm/deals/${encodeURIComponent(id)}/amount`, "POST", { amount: Number(amount) }); }}
          className="px-4 py-2 rounded-lg border border-border text-sm text-foreground disabled:opacity-50"
        >
          Queue amount change
        </button>
      </div>
    </div>
  );
}

const config: ZohoEntityConfig = {
  entity: "deals",
  title: "Zoho Deals",
  singular: "deal",
  description: "Deals read live from Zoho CRM. Stage, amount and field edits are queued and applied by the 5-minute sync.",
  supportsNotes: true,
  fields: [
    { name: "Deal_Name", label: "Deal", required: true },
    { name: "Stage", label: "Stage", required: true },
    { name: "Amount", label: "Amount", type: "number" },
    { name: "Closing_Date", label: "Closing date" },
    { name: "Account_Name", label: "Account", editable: false },
    { name: "Contact_Name", label: "Contact", inList: false, editable: false },
    { name: "Pipeline", label: "Pipeline", inList: false },
    { name: "Description", label: "Description", inList: false, type: "textarea" },
    { name: "Created_Time", label: "Created", inList: false, editable: false },
  ],
  extraActions: (ctx) => <DealActions {...ctx} />,
};

export default function ZohoDealsPage() {
  return <ZohoEntityPage config={config} />;
}
