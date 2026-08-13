/**
 * The Marketing screen's shared state — a plain external store, not React
 * state. Same reason `enginesStore.ts`/`servicesStore.ts`/`moneyStore.ts` are
 * one (see any of their doc comments): the Home-tab and Watch-tab ribbon
 * groups this screen contributes are built once, at `registerScreen()`
 * module-load time, outside any component, so they cannot call
 * `useAdminFetch()`. The Home tab's "Browse campaigns" gallery and the Watch
 * tab's "Waiting on you" count both have to be right before `/marketing` has
 * ever been opened, which is what `MarketingFetchBridge` (always mounted, see
 * `AdminV2.tsx`) warms.
 *
 * Every figure in here comes from `routes/admin-marketing.ts`. Nothing is
 * computed client-side except formatting — a wrong number is a backend bug,
 * not a display one.
 *
 * Scope note: campaigns and site analytics only — see `marketingTypes.ts`'s
 * doc comment for why articles/hero headlines/email templates are not here.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import type { AdType, AdVariation, AnalyticsResponse, CampaignAsset, CampaignDetail, CampaignListRow, CampaignStatus, GenerateAdsResponse } from "./marketingTypes";

const log = logger.child({ channel: "admin.marketing" });

export type MarketingTab = "campaigns" | "analytics";

export interface MarketingState {
  tab: MarketingTab;

  campaigns: CampaignListRow[];
  campaignsLoading: boolean;
  campaignsError: string | null;
  selectedCampaignId: number | null;
  campaignDetails: Record<number, CampaignDetail>;
  campaignDetailBusy: number | null;
  campaignDetailError: string | null;

  analytics: AnalyticsResponse | null;
  analyticsLoading: boolean;
  analyticsError: string | null;

  /** The last ad-copy generation, shown under the campaign it was generated for. */
  adGen: { campaignId: number; adType: AdType; topic: string; result: GenerateAdsResponse | null; busy: boolean } | null;

  savingIds: Set<string>;
  /** The design's `enSay` — a transient line in the header, cleared after a few seconds. */
  message: string | null;
}

function initialState(): MarketingState {
  return {
    tab: "campaigns",

    campaigns: [],
    campaignsLoading: false,
    campaignsError: null,
    selectedCampaignId: null,
    campaignDetails: {},
    campaignDetailBusy: null,
    campaignDetailError: null,

    analytics: null,
    analyticsLoading: false,
    analyticsError: null,

    adGen: null,

    savingIds: new Set(),
    message: null,
  };
}

let state: MarketingState = initialState();

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

/** The Watch tab's "Waiting on you" button's live key — see `liveRibbon.ts`'s doc comment for why this can't just be a static `live:` number. */
export const WATCH_WAITING_KEY = "marketing:watch-waiting";

/** Draft campaigns — the design's "Waiting on you" group. */
export function waitingOnYouCount(s: MarketingState = state): number {
  return s.campaigns.filter((c) => c.status === "draft").length;
}

function syncLiveRibbon(): void {
  const count = waitingOnYouCount();
  setLiveRibbonValue(WATCH_WAITING_KEY, count > 0 ? { label: `${count} waiting on you`, color: ACCENT.amber } : { label: "Nothing waiting" });
}

function setState(patch: Partial<MarketingState>): void {
  state = { ...state, ...patch };
  syncLiveRibbon();
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): MarketingState {
  return state;
}

/** Called by `MarketingFetchBridge` on every render — see file doc comment. */
export function configureMarketingFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `{error}` out of a failed response body, falling back to the status line. */
async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON — the status is all there is */
  }
  return `${res.status} ${res.statusText}`;
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;

export function say(message: string): void {
  setState({ message });
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => setState({ message: null }), 3400);
}

function withSaving(id: string, on: boolean): void {
  const next = new Set(state.savingIds);
  if (on) next.add(id);
  else next.delete(id);
  setState({ savingIds: next });
}

export function setTab(tab: MarketingTab): void {
  setState({ tab });
  if (tab === "analytics") void loadAnalytics();
}

// ─── Warm load ────────────────────────────────────────────────────────────────

let warmed = false;

/** Warm load — see the file doc comment. Safe to call repeatedly. */
export function warmMarketing(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadCampaigns();
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function loadCampaigns(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.campaignsLoading || state.campaigns.length > 0)) return;
  setState({ campaignsLoading: true, campaignsError: null });
  try {
    const res = await adminFetchRef("/api/admin/marketing/campaigns");
    if (!res.ok) {
      setState({ campaignsLoading: false, campaignsError: await failureOf(res) });
      return;
    }
    const campaigns = (await res.json()) as CampaignListRow[];
    setState({ campaignsLoading: false, campaigns });
  } catch (err) {
    log.warn({ err }, "campaigns failed to load");
    setState({ campaignsLoading: false, campaignsError: errorText(err) });
  }
}

export function campaignById(id: number | string | null | undefined): CampaignListRow | undefined {
  if (id === null || id === undefined) return undefined;
  const n = typeof id === "string" ? Number(id) : id;
  return state.campaigns.find((c) => c.id === n);
}

export function selectCampaign(id: number | null): void {
  setState({ selectedCampaignId: id });
  if (id !== null) void loadCampaignDetail(id);
}

export async function loadCampaignDetail(id: number, force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && state.campaignDetails[id]) return;
  setState({ campaignDetailBusy: id, campaignDetailError: null });
  try {
    const res = await adminFetchRef(`/api/admin/marketing/campaigns/${id}`);
    if (!res.ok) {
      setState({ campaignDetailBusy: null, campaignDetailError: await failureOf(res) });
      return;
    }
    const detail = (await res.json()) as CampaignDetail;
    setState({ campaignDetailBusy: null, campaignDetails: { ...state.campaignDetails, [id]: detail } });
  } catch (err) {
    log.warn({ err, id }, "campaign detail failed to load");
    setState({ campaignDetailBusy: null, campaignDetailError: errorText(err) });
  }
}

export async function createCampaign(input: { name: string; goal: string; audience: string; offer: string }): Promise<CampaignListRow | null> {
  if (!adminFetchRef) return null;
  withSaving("campaign:new", true);
  try {
    const res = await adminFetchRef("/api/admin/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, status: "draft" }),
    });
    if (!res.ok) {
      say(await failureOf(res));
      return null;
    }
    const row = (await res.json()) as CampaignListRow;
    setState({ campaigns: [row, ...state.campaigns] });
    say(`${row.name} created, as a draft.`);
    return row;
  } catch (err) {
    log.warn({ err }, "campaign create failed");
    say(errorText(err));
    return null;
  } finally {
    withSaving("campaign:new", false);
  }
}

/** The Home tab's "New campaign" ribbon button — same `window.prompt` shape as `servicesStore.ts`'s `createServiceInteractive`. */
export async function createCampaignInteractive(): Promise<CampaignListRow | null> {
  if (!adminFetchRef) return null;
  const name = window.prompt("New campaign name:");
  if (!name?.trim()) return null;
  const goal = window.prompt("Goal — what does this campaign need to achieve?");
  if (!goal?.trim()) return null;
  const audience = window.prompt("Audience — who is this for?");
  if (!audience?.trim()) return null;
  const offer = window.prompt("Offer — what are you offering them?");
  if (!offer?.trim()) return null;
  return createCampaign({ name: name.trim(), goal: goal.trim(), audience: audience.trim(), offer: offer.trim() });
}

async function patchCampaign(id: number, patch: Record<string, unknown>): Promise<CampaignListRow | null> {
  if (!adminFetchRef) return null;
  const key = `campaign:${id}`;
  withSaving(key, true);
  try {
    const res = await adminFetchRef(`/api/admin/marketing/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      say(await failureOf(res));
      return null;
    }
    const row = (await res.json()) as CampaignListRow;
    setState({
      campaigns: state.campaigns.map((c) => (c.id === id ? { ...c, ...row } : c)),
      campaignDetails: state.campaignDetails[id]
        ? { ...state.campaignDetails, [id]: { ...state.campaignDetails[id], campaign: { ...state.campaignDetails[id].campaign, ...row } } }
        : state.campaignDetails,
    });
    return row;
  } catch (err) {
    log.warn({ err, id }, "campaign update failed");
    say(errorText(err));
    return null;
  } finally {
    withSaving(key, false);
  }
}

export async function updateCampaignField(id: number, patch: { name?: string; goal?: string; audience?: string; offer?: string }): Promise<void> {
  const row = await patchCampaign(id, patch);
  if (row) say("Saved.");
}

export async function setCampaignStatus(id: number, status: CampaignStatus): Promise<void> {
  const row = await patchCampaign(id, { status });
  if (row) say(status === "active" ? `${row.name} is live.` : status === "paused" ? `${row.name} paused.` : status === "completed" ? "Marked completed." : "Saved.");
}

export async function deleteCampaign(id: number): Promise<boolean> {
  if (!adminFetchRef) return false;
  const key = `campaign:${id}`;
  withSaving(key, true);
  try {
    const res = await adminFetchRef(`/api/admin/marketing/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      say(await failureOf(res));
      return false;
    }
    const { [id]: _removed, ...rest } = state.campaignDetails;
    setState({
      campaigns: state.campaigns.filter((c) => c.id !== id),
      campaignDetails: rest,
      selectedCampaignId: state.selectedCampaignId === id ? null : state.selectedCampaignId,
    });
    say("Deleted.");
    return true;
  } catch (err) {
    log.warn({ err, id }, "campaign delete failed");
    say(errorText(err));
    return false;
  } finally {
    withSaving(key, false);
  }
}

// ─── Ad copy generation ─────────────────────────────────────────────────────────

/**
 * Generates ad copy for real, via the AI endpoint — not a preview. `save-ads`
 * is a separate, explicit step (`saveGeneratedAds`); generating alone writes
 * nothing.
 */
export async function generateAds(campaignId: number, adType: AdType, topic: string): Promise<void> {
  if (!adminFetchRef) return;
  setState({ adGen: { campaignId, adType, topic, result: null, busy: true } });
  try {
    const res = await adminFetchRef("/api/admin/marketing/campaigns/generate-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, adType, topic }),
    });
    if (!res.ok) {
      say(await failureOf(res));
      setState({ adGen: { campaignId, adType, topic, result: null, busy: false } });
      return;
    }
    const result = (await res.json()) as GenerateAdsResponse;
    setState({ adGen: { campaignId, adType, topic, result, busy: false } });
    if (result.error) say(result.error);
  } catch (err) {
    log.warn({ err, campaignId, adType }, "ad generation failed");
    say(errorText(err));
    setState({ adGen: { campaignId, adType, topic, result: null, busy: false } });
  }
}

export function clearAdGen(): void {
  setState({ adGen: null });
}

/** Writes the generated variations to `campaign_assets`, for real — nothing was saved until this is pressed. */
export async function saveGeneratedAds(campaignId: number, adType: AdType, title: string, variations: AdVariation[]): Promise<void> {
  if (!adminFetchRef) return;
  const key = `campaign:${campaignId}`;
  withSaving(key, true);
  try {
    const res = await adminFetchRef("/api/admin/marketing/campaigns/save-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, adType, title, variations }),
    });
    if (!res.ok) {
      say(await failureOf(res));
      return;
    }
    say("Saved as campaign assets.");
    setState({ adGen: null });
    void loadCampaignDetail(campaignId, true);
  } catch (err) {
    log.warn({ err, campaignId }, "save-ads failed");
    say(errorText(err));
  } finally {
    withSaving(key, false);
  }
}

export function campaignAssets(campaignId: number): CampaignAsset[] {
  return state.campaignDetails[campaignId]?.assets ?? [];
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function loadAnalytics(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.analyticsLoading || state.analytics)) return;
  setState({ analyticsLoading: true, analyticsError: null });
  try {
    const res = await adminFetchRef("/api/admin/marketing/analytics");
    if (!res.ok) {
      setState({ analyticsLoading: false, analyticsError: await failureOf(res) });
      return;
    }
    const analytics = (await res.json()) as AnalyticsResponse;
    setState({ analyticsLoading: false, analytics });
  } catch (err) {
    log.warn({ err }, "analytics failed to load");
    setState({ analyticsLoading: false, analyticsError: errorText(err) });
  }
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

export function copyCampaignNumbers(id: number): void {
  const c = campaignById(id);
  if (!c) return;
  copyToClipboard(JSON.stringify({ leadsGenerated: c.leadsGenerated, revenueAttributed: c.revenueAttributed, emailsSent: c.emailsSent, emailsSentAuto: c.emailsSentAuto }, null, 2));
  say("Copied.");
}

/** Test seam. Not used by the app. */
export function resetMarketingStore(): void {
  adminFetchRef = null;
  warmed = false;
  clearTimeout(messageTimer);
  state = initialState();
}
