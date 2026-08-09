/**
 * Marketing — campaigns and site analytics, at `/adminv2/marketing`.
 *
 * `SHELL.md` section 1 names Marketing as one of the six screens the
 * fixed-tab audit stripped ("Endpoints, Money, SQL, Documents, Services and
 * Marketing all had per-record actions on their fixed tabs and were
 * stripped"), so every record-scoped action here — status changes, ad-copy
 * generation, delete — lives on the "Campaign Tools" contextual tab, never on
 * Home or Watch. `registerScreen` would throw otherwise.
 *
 * Scope: campaigns + analytics only — the design's `mk` ribbon area
 * (`Admin Shell.dc.html`). Articles, hero headlines and email templates are
 * the prototype's separate `co` ("Content") area, matching the OLD admin
 * panel's own distinct "Content" workspace nav (`con-articles`/
 * `con-hero-headlines`/`con-email-templates`) — see `marketingTypes.ts`'s doc
 * comment. `campaign` is a new peek kind — SHELL.md permits that for a
 * genuinely new record type, and a campaign is one: it is openable, has a
 * stable id, needs a name the tab strip and Back group can resolve, and
 * isn't a `service` (the catalog entry) or a `lead` (a person a campaign
 * might have generated).
 */

import { BarChart3, FileText, Megaphone, Plus, Tag } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { MarketingBody } from "./MarketingBody";
import { MarketingExplorer } from "./MarketingExplorer";
import { MarketingProperties } from "./MarketingProperties";
import {
  campaignAssets,
  campaignById,
  copyCampaignNumbers,
  createCampaignInteractive,
  deleteCampaign,
  getSnapshot,
  selectCampaign,
  setCampaignStatus,
  setTab,
  updateCampaignField,
  WATCH_WAITING_KEY,
  waitingOnYouCount,
} from "./marketingStore";
import { ASSET_TYPE_LABEL, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, CAMPAIGN_STATUS_TRANSITIONS, usd } from "./marketingTypes";

const ROUTE = "/marketing";

function goto(tab: Parameters<typeof setTab>[0]) {
  return () => {
    getShellApi()?.navigate(ROUTE);
    setTab(tab);
  };
}

function openCampaign(id: number): void {
  selectCampaign(id);
  getShellApi()?.openDoc({ kind: "campaign", id: String(id), screenId: "marketing" });
}

/** `SHELL.md` section 5: "Rows carry real data, not labels" — tile is the lead count, detail is status + offer. */
function campaignGalleryRows(): GalleryRow[] {
  const state = getSnapshot();
  return state.campaigns.map((c) => ({
    id: String(c.id),
    group: c.status === "draft" ? "Waiting on you" : c.status,
    tile: String(c.leadsGenerated),
    name: c.name,
    head: c.status,
    sub: c.offer,
    on: state.selectedCampaignId === c.id,
    onSelect: () => getShellApi()?.openPeek("campaign", String(c.id)),
  }));
}

registerScreen({
  id: "marketing",
  title: "Marketing",
  area: "marketing",
  icon: Megaphone,
  route: ROUTE,

  render: (ctx) => {
    // A campaign opened from a peek, the palette or the "Browse campaigns"
    // gallery routes here with the campaign id as `recordId` — mirrors
    // `screens/engines/index.tsx`'s adoption of `ctx.recordId`.
    if (ctx.kind === "campaign" && ctx.recordId) selectCampaign(Number(ctx.recordId));
    return <MarketingBody recordId={ctx.recordId} />;
  },

  ribbon: [
    {
      tab: "home",
      order: 45,
      group: {
        label: "Marketing",
        large: [
          {
            label: "All campaigns",
            icon: Megaphone,
            intent: "open",
            onSelect: goto("campaigns"),
            title: "Campaigns and site analytics",
          },
        ],
        small: [
          {
            label: "Browse campaigns",
            icon: Tag,
            intent: "open",
            onSelect: goto("campaigns"),
            gallery: {
              id: "campaigns",
              title: "Campaigns",
              searchable: true,
              searchPlaceholder: "Type part of a name",
              get rows() {
                return campaignGalleryRows();
              },
              footer: { label: "Open the campaign list…", onSelect: goto("campaigns") },
            },
          },
          {
            label: "New campaign",
            icon: Plus,
            intent: "create",
            onSelect: () => {
              void createCampaignInteractive().then((created) => {
                if (created) openCampaign(created.id);
              });
            },
          },
          {
            label: "Traffic & results",
            icon: BarChart3,
            intent: "open",
            onSelect: goto("analytics"),
          },
        ],
      },
    },
    {
      tab: "watch",
      order: 45,
      group: {
        label: "Marketing",
        large: [
          {
            label: "Waiting on you",
            icon: FileText,
            intent: "open",
            color: waitingOnYouCount() > 0 ? ACCENT.amber : undefined,
            // SHELL.md's exception to "no badge counts": a draft campaign is
            // something nothing else will act on until a person does.
            // Carried through `liveKey`, not `live` — see
            // `marketingStore.ts`'s `WATCH_WAITING_KEY` doc comment for why a
            // plain number here would freeze at 0 forever.
            liveKey: WATCH_WAITING_KEY,
            onSelect: goto("campaigns"),
            title: "Draft campaigns waiting to be reviewed and set active",
          },
        ],
      },
    },
  ],

  /**
   * Campaign Tools. The Back group is spliced in at position 2 by the shell —
   * do not add one here (`SHELL.md` section 2).
   */
  contextualTab: (ctx) => {
    if (ctx.kind !== "campaign" || !ctx.recordId) return null;
    const campaign = campaignById(ctx.recordId);
    if (!campaign) return null;
    const transitions = CAMPAIGN_STATUS_TRANSITIONS[campaign.status];
    const [primary, ...rest] = transitions;

    return {
      id: "campaign-tools",
      label: "Campaign Tools",
      groups: [
        {
          label: "Status",
          large: primary
            ? [{ label: primary.label, icon: Megaphone, intent: "record", color: primary.to === "active" ? ACCENT.greenSoft : undefined, onSelect: () => void setCampaignStatus(campaign.id, primary.to) }]
            : [{ label: "Completed", icon: Megaphone, intent: "record", onSelect: () => {}, disabled: true }],
          small: rest.map((t) => ({ label: t.label, icon: Megaphone, intent: "record" as const, onSelect: () => void setCampaignStatus(campaign.id, t.to) })),
        },
        {
          label: "Everything",
          small: [
            { label: "Copy the numbers", icon: FileText, intent: "record", onSelect: () => copyCampaignNumbers(campaign.id) },
            { label: "All campaigns", icon: Tag, intent: "open", onSelect: goto("campaigns") },
          ],
        },
      ],
    };
  },

  peeks: {
    campaign: (id) => {
      const campaign = campaignById(id);
      if (!campaign) return null;
      const assets = campaignAssets(campaign.id);

      return {
        kind: "campaign",
        eyebrow: "CAMPAIGN",
        title: campaign.name,
        sub: campaign.offer,
        icon: Megaphone,
        tone: CAMPAIGN_STATUS_TONE[campaign.status],
        tag: CAMPAIGN_STATUS_LABEL[campaign.status],
        tagTone: CAMPAIGN_STATUS_TONE[campaign.status],
        facts: [
          { label: "Leads", value: String(campaign.leadsGenerated) },
          { label: "Revenue attributed", value: usd(campaign.revenueAttributed) },
          { label: "Emails sent", value: String(campaign.emailsSentAuto) },
          { label: "Goal", value: campaign.goal, prose: true },
        ],
        edits: [
          { key: "name", label: "Name", value: campaign.name, onChange: (next) => void updateCampaignField(campaign.id, { name: next }) },
          { key: "audience", label: "Audience", value: campaign.audience, area: true, onChange: (next) => void updateCampaignField(campaign.id, { audience: next }) },
          { key: "offer", label: "Offer", value: campaign.offer, area: true, onChange: (next) => void updateCampaignField(campaign.id, { offer: next }) },
        ],
        list:
          assets.length > 0
            ? { title: "Assets", rows: assets.slice(0, 10).map((a) => ({ id: String(a.id), name: a.title, sub: ASSET_TYPE_LABEL[a.assetType] })) }
            : undefined,
        open: () => openCampaign(campaign.id),
        openLabel: "Open it properly",
        actions: [
          { label: "Copy the numbers", onSelect: () => copyCampaignNumbers(campaign.id) },
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deleteCampaign(campaign.id) },
        ],
      };
    },
  },

  commands: (): CommandItem[] => {
    const state = getSnapshot();

    const campaignRecords: CommandItem[] = state.campaigns.map((c) => ({
      id: `rec:campaign-${c.id}`,
      type: "record",
      kind: "campaign",
      name: c.name,
      sub: `${c.status} · ${c.offer}`,
      tag: c.status === "draft" ? "waiting on you" : undefined,
      area: "marketing",
      live: c.leadsGenerated ? `${c.leadsGenerated} leads` : undefined,
      run: () => getShellApi()?.openPeek("campaign", String(c.id)),
    }));

    const waiting = waitingOnYouCount(state);
    const answers: CommandItem[] = [
      {
        id: "ans:marketing-waiting",
        type: "answer",
        name: "Draft campaigns waiting on you",
        sub: "Not yet set active",
        area: "marketing",
        live: String(waiting),
        run: goto("campaigns"),
      },
    ];

    const actions: CommandItem[] = [
      { id: "act:marketing-new-campaign", type: "action", kind: "run", name: "New campaign", sub: "Starts as a draft", area: "marketing", run: () => void createCampaignInteractive().then((c) => { if (c) openCampaign(c.id); }) },
      { id: "act:marketing-analytics", type: "action", kind: "run", name: "Traffic & results", sub: "Visitors, sources, the conversion funnel", area: "marketing", run: goto("analytics") },
    ];

    return [...campaignRecords, ...answers, ...actions];
  },

  left: { title: "Marketing", render: () => <MarketingExplorer /> },
  right: { title: "Properties", render: () => <MarketingProperties /> },
});
