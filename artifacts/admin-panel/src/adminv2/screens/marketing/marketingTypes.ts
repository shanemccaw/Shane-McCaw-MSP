/**
 * Wire shapes and formatters for the Marketing screen.
 *
 * Scope note: this screen owns campaigns and site analytics only — the
 * design's `mk` ribbon area (`Admin Shell.dc.html`). Articles, hero headlines
 * and email templates are the prototype's separate `co` ("Content") area,
 * which mirrors the OLD admin panel's own distinct "Content" workspace
 * (`workspaceNav.tsx`: `con-articles`/`con-hero-headlines`/
 * `con-email-templates`, alongside `con-services` — and Services already got
 * its own adminv2 screen separate from Content, so the same split applies
 * here) — left to that screen rather than duplicated here.
 *
 * Everything below mirrors what `routes/admin-marketing.ts` actually
 * returns — nothing is invented. The design's mockup has its own `CAMPAIGNS`/
 * `TRAFFIC` fixtures with the same field shapes; this is the real schema
 * those fixtures were standing in for (`campaigns`, `campaign_assets` in
 * `lib/db/src/schema`).
 */

import { ACCENT, ACCENT_TEXT, TEXT } from "../../theme";

// ─── Campaigns ──────────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

/** One row of GET /admin/marketing/campaigns. */
export interface CampaignListRow {
  id: number;
  name: string;
  goal: string;
  audience: string;
  offer: string;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  leadsGenerated: number;
  emailsSent: number;
  /** Numeric column — Postgres/Drizzle returns it as a decimal string. */
  revenueAttributed: string;
  createdAt: string;
  updatedAt: string;
  /** Real count from a join against `email_events`, not the manually-set `emailsSent`. */
  emailsSentAuto: number;
}

export type CampaignAssetType =
  | "landing_copy"
  | "email_sequence"
  | "social_post"
  | "follow_up_task"
  | "blog_post"
  | "linkedin_post"
  | "newsletter"
  | "seo_keywords"
  | "lead_magnet"
  | "ad_google"
  | "ad_linkedin"
  | "ad_retargeting"
  | "ad_creative"
  | "landing_page";

export interface CampaignAsset {
  id: number;
  campaignId: number | null;
  assetType: CampaignAssetType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  generatedWithOfferIds: number[] | null;
  createdAt: string;
}

export interface CampaignEmailEvent {
  id: number;
  subject: string | null;
  recipient: string | null;
  eventType: string;
  occurredAt: string;
}

/** GET /admin/marketing/campaigns/:id. */
export interface CampaignDetail {
  campaign: CampaignListRow;
  assets: CampaignAsset[];
  landingPages: Array<{ id: number; slug: string; title: string; headline: string | null; published: boolean; createdAt: string }>;
  offers: Array<{ id: number; name: string; pricing: unknown; deliverables: unknown; outcomes: unknown; createdAt: string }>;
  emailEvents: CampaignEmailEvent[];
}

export const AD_TYPES = ["ad_google", "ad_linkedin", "ad_retargeting", "ad_creative", "landing_page"] as const;
export type AdType = (typeof AD_TYPES)[number];

export const AD_TYPE_LABEL: Record<AdType, string> = {
  ad_google: "Google Search Ad",
  ad_linkedin: "LinkedIn Sponsored Content",
  ad_retargeting: "Retargeting ad",
  ad_creative: "Creative brief",
  landing_page: "Landing page copy",
};

export interface AdVariation {
  headline: string;
  description: string;
  cta: string;
  url?: string;
}

/** POST /admin/marketing/campaigns/generate-ads. */
export interface GenerateAdsResponse {
  adType: string;
  variations: AdVariation[];
  error?: string;
}

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, string> = {
  draft: ACCENT.amber,
  active: ACCENT.greenSoft,
  paused: TEXT.dim,
  completed: ACCENT.info,
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "draft — waiting on you",
  active: "active",
  paused: "paused",
  completed: "completed",
};

export interface CampaignStatusTransition {
  to: CampaignStatus;
  label: string;
}

/** The legal status moves from each state, in the order they should render. Shared between the body and the contextual tab so they can never disagree. */
export const CAMPAIGN_STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatusTransition[]> = {
  draft: [{ to: "active", label: "Set it active" }],
  active: [
    { to: "paused", label: "Pause it" },
    { to: "completed", label: "Mark completed" },
  ],
  paused: [
    { to: "active", label: "Set it active" },
    { to: "completed", label: "Mark completed" },
  ],
  completed: [],
};

// ─── Analytics ────────────────────────────────────────────────────────────────

/** GET /admin/marketing/analytics. */
export interface AnalyticsResponse {
  dailyVisitors: Array<{ day: string; visitors: number }>;
  topPages: Array<{ page: string; views: number }>;
  trafficSources: Array<{ source: string; sessions: number }>;
  conversionFunnel: Array<{ stage: string; value: number }>;
  campaignPerformance: Array<{
    id: number;
    name: string;
    status: string;
    assetCount: number;
    leadsGenerated: number;
    revenueAttributed: number;
    revenuePerLead: number | null;
  }>;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Dollars, as a plain number or the decimal string Postgres numeric columns return. */
export function usd(dollars: number | string): string {
  const n = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(n)) return "$0";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

export const ASSET_TYPE_LABEL: Record<CampaignAssetType, string> = {
  landing_copy: "Landing copy",
  email_sequence: "Email sequence",
  social_post: "Social post",
  follow_up_task: "Follow-up task",
  blog_post: "Blog post",
  linkedin_post: "LinkedIn post",
  newsletter: "Newsletter",
  seo_keywords: "SEO keywords",
  lead_magnet: "Lead magnet",
  ad_google: "Google ad",
  ad_linkedin: "LinkedIn ad",
  ad_retargeting: "Retargeting ad",
  ad_creative: "Creative brief",
  landing_page: "Landing page",
};

export function campaignStatusTone(status: CampaignStatus): string {
  return CAMPAIGN_STATUS_TONE[status] ?? ACCENT_TEXT.neutral;
}
