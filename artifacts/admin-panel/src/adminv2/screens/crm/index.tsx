/**
 * CRM screen — real Zoho Leads/Deals, real EngageBay contacts/activity.
 *
 * No fixed tab of its own (the seven are closed, SHELL.md section "Registering
 * a screen" — `home` `inbox` `money` `watch` `view` | `git` `run`): it
 * contributes an open/create/global group to the fixed `home` tab, the same
 * placement SHELL.md's own worked example uses for Endpoints. Anything that
 * needs one specific lead open — convert, refresh, copy its email — lives on
 * the "Lead Tools" contextual tab instead, per the audited open/create/global
 * rule (`registry.ts`'s `auditFixedTabIntents`).
 */

import { RefreshCw, Mail, Plus, Users, ArrowRightLeft } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import { CrmBody } from "./CrmBody";
import { CrmExplorerPanel } from "./CrmExplorerPanel";
import { DealPropertiesPanel } from "./DealPropertiesPanel";
import { convertLead, getSnapshot, openNewLeadForm, patchLead, refreshLead, refreshAll, setView } from "./crmStore";
import { leadCompany, leadDisplayName } from "./zohoTypes";

function openAllLeads() {
  setView("leads");
  getShellApi()?.navigate("/crm");
}

function openPipeline() {
  setView("pipeline");
  getShellApi()?.navigate("/crm");
}

function openNewLead() {
  openNewLeadForm();
  getShellApi()?.navigate("/crm");
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

registerScreen({
  id: "crm",
  title: "CRM",
  area: "crm",
  icon: Users,
  route: "/crm",
  render: (ctx) => <CrmBody recordId={ctx.recordId} />,

  left: { title: "CRM", render: () => <CrmExplorerPanel /> },
  right: { title: "Deal", render: () => <DealPropertiesPanel /> },

  ribbon: [
    {
      tab: "crm",
      group: {
        label: "CRM",
        large: [{ label: "Pipeline", icon: Users, intent: "open", onSelect: openPipeline, color: ACCENT.green }],
        small: [
          { label: "All leads", icon: Users, intent: "open", onSelect: openAllLeads },
          { label: "New lead", icon: Plus, intent: "create", onSelect: openNewLead },
          { label: "Refresh from Zoho", icon: RefreshCw, intent: "global", onSelect: () => refreshAll() },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    const recordId = ctx.recordId;
    if (!recordId) return null;
    return {
      id: "lead-tools",
      label: "Lead Tools",
      groups: [
        {
          label: "This lead",
          large: [
            {
              label: "Convert to deal",
              icon: ArrowRightLeft,
              intent: "record",
              onSelect: () => void convertLead(recordId),
              color: ACCENT.green,
              title: "Zoho creates a Contact, an Account and (optionally) a Deal. Queued, applies on the next sync.",
            },
          ],
          small: [
            { label: "Refresh this lead", icon: RefreshCw, intent: "record", onSelect: () => void refreshLead(recordId) },
            {
              label: "Copy email",
              icon: Mail,
              intent: "record",
              onSelect: () => {
                const lead = getSnapshot().leads.find((l) => String(l.id) === recordId);
                copyToClipboard(String(lead?.Email ?? ""));
              },
            },
          ],
        },
      ],
    };
  },

  peeks: {
    lead: (id) => {
      const lead = getSnapshot().leads.find((l) => String(l.id) === id);
      if (!lead) return null;
      const email = String(lead.Email ?? "");

      return {
        kind: "lead",
        eyebrow: "Zoho lead",
        title: leadCompany(lead),
        sub: `${leadDisplayName(lead)}${email ? ` · ${email}` : ""}`,
        icon: Users,
        tone: ACCENT.green,
        tag: String(lead.Lead_Status ?? "") || undefined,
        note: getSnapshot().noteByLeadId[id],
        facts: [
          { label: "Status", value: String(lead.Lead_Status ?? "—") },
          { label: "Source", value: String(lead.Lead_Source ?? "—"), prose: true },
        ],
        edits: [
          { key: "company", label: "Company", value: String(lead.Company ?? ""), onChange: (v) => void patchLead(id, { Company: v }) },
          { key: "email", label: "Email", value: email, mono: true, onChange: (v) => void patchLead(id, { Email: v }) },
          { key: "phone", label: "Phone", value: String(lead.Phone ?? ""), onChange: (v) => void patchLead(id, { Phone: v }) },
          { key: "status", label: "Status", value: String(lead.Lead_Status ?? ""), onChange: (v) => void patchLead(id, { Lead_Status: v }) },
        ],
        actions: [
          { label: "Convert to deal", tone: "primary", onSelect: () => void convertLead(id) },
          { label: "Copy email", onSelect: () => copyToClipboard(email) },
        ],
        open: () => getShellApi()?.openDoc({ kind: "lead", id, screenId: "crm" }),
      };
    },
  },

  commands: () => {
    const state = getSnapshot();
    const records = state.leads.map((lead) => ({
      id: `rec:lead-${lead.id}`,
      type: "record" as const,
      kind: "lead" as const,
      name: leadCompany(lead),
      sub: `${leadDisplayName(lead)} · ${String(lead.Lead_Status ?? "—")}`,
      area: "crm",
      run: () => getShellApi()?.openPeek("lead", String(lead.id)),
    }));

    return [
      {
        id: "act:crm-new-lead",
        type: "action",
        kind: "run",
        name: "New lead",
        sub: "Queues a real Zoho Lead — applies on the next sync",
        area: "crm",
        run: openNewLead,
      },
      {
        id: "act:crm-refresh",
        type: "action",
        kind: "run",
        name: "Refresh CRM from Zoho",
        sub: "Reloads leads, deals and connection status",
        area: "crm",
        run: () => refreshAll(),
      },
      {
        id: "ans:crm-leads-loaded",
        type: "answer",
        name: "Leads loaded from Zoho",
        sub: "First page — Zoho may hold more",
        area: "crm",
        live: String(state.leads.length),
        run: openAllLeads,
      },
      ...records,
    ];
  },
});
