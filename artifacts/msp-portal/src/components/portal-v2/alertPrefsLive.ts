/**
 * alertPrefsLive.ts — real persistence for the Alert preferences page (Part 12
 * fixture → Git #1276 live wiring).
 *
 * Talks to GET/PUT /api/portal/alert-preferences (routes/portal-alert-preferences.ts)
 * and normalizes the wire shape into the page's own AlertPrefs/AlertQuiet/
 * AlertRecipient types (alertPrefsData.ts) so alertPrefsModel.ts's pure
 * derivations (patchPref, applyPreset, ...) don't need to know persistence exists.
 */

import { ALERT_CATS, type AlertCatKey, type AlertPrefs, type AlertQuiet, type AlertRecipient } from "./alertPrefsData";
import type { AlertSelectValue } from "./alertPrefsModel";

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit, opts?: { silent?: boolean }) => Promise<Response>;

interface WireCategoryPref {
  enabled: boolean;
  emailEnabled: boolean;
  mode: "immediate" | "daily" | "weekly";
  threshold: string;
}

interface WireResponse {
  categories: Record<AlertCatKey, WireCategoryPref>;
  settings: {
    activePreset: AlertSelectValue;
    quietHoursEnabled: boolean;
    quietHoursFrom: string;
    quietHoursTo: string;
    quietBreakForCritical: boolean;
    updatedAt: string | null;
    updatedByName: string | null;
  };
  primaryRecipient: { email: string; name: string | null };
  recipients: { email: string; role: string | null; scopeCategories: AlertCatKey[] | null }[];
}

export interface LoadedAlertPrefs {
  prefs: AlertPrefs;
  preset: AlertSelectValue;
  quiet: AlertQuiet;
  recipients: AlertRecipient[];
  savedAtLabel: string;
}

function scopeLabel(scopeCategories: AlertCatKey[] | null): string {
  if (!scopeCategories || scopeCategories.length === 0) return "All categories";
  const names = scopeCategories.map((k) => ALERT_CATS.find((c) => c.key === k)?.name ?? k);
  return `${names.join(", ")} only`;
}

/** "Last saved 3 weeks ago by Jordan Diaz" — real data in the design's own copy shape. */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function buildSavedAtLabel(updatedAt: string | null, updatedByName: string | null): string {
  if (!updatedAt) return "Not yet saved";
  const who = updatedByName ? ` by ${updatedByName}` : "";
  return `Last saved ${relativeTime(updatedAt)}${who}`;
}

export async function fetchAlertPreferences(fetchWithAuth: FetchWithAuth): Promise<LoadedAlertPrefs> {
  const res = await fetchWithAuth("/api/portal/alert-preferences");
  if (!res.ok) throw new Error(`Failed to load alert preferences (${res.status})`);
  const data = (await res.json()) as WireResponse;

  const prefs = Object.fromEntries(
    ALERT_CATS.map((c) => {
      const p = data.categories[c.key];
      return [c.key, { on: p.enabled, email: p.emailEnabled, mode: p.mode, threshold: p.threshold }];
    }),
  ) as AlertPrefs;

  const quiet: AlertQuiet = {
    on: data.settings.quietHoursEnabled,
    from: data.settings.quietHoursFrom,
    to: data.settings.quietHoursTo,
    breakForCritical: data.settings.quietBreakForCritical,
  };

  const recipients: AlertRecipient[] = [
    { email: data.primaryRecipient.email, role: `IT Administrator${data.primaryRecipient.name ? ` · ${data.primaryRecipient.name}` : " · you"}`, scope: "All categories", primary: true, scopeCategories: null },
    ...data.recipients.map((r) => ({
      email: r.email,
      role: r.role ?? "Recipient",
      scope: scopeLabel(r.scopeCategories),
      primary: false,
      scopeCategories: r.scopeCategories,
    })),
  ];

  return {
    prefs,
    preset: data.settings.activePreset,
    quiet,
    recipients,
    savedAtLabel: buildSavedAtLabel(data.settings.updatedAt, data.settings.updatedByName),
  };
}

export interface SaveAlertPrefsInput {
  prefs: AlertPrefs;
  preset: AlertSelectValue;
  quiet: AlertQuiet;
  recipients: AlertRecipient[];
}

export async function saveAlertPreferences(fetchWithAuth: FetchWithAuth, input: SaveAlertPrefsInput): Promise<void> {
  const categories = Object.fromEntries(
    ALERT_CATS.map((c) => {
      const p = input.prefs[c.key];
      return [c.key, { enabled: p.on, emailEnabled: p.email, mode: p.mode, threshold: p.threshold }];
    }),
  );

  const body = {
    categories,
    settings: {
      activePreset: input.preset,
      quietHoursEnabled: input.quiet.on,
      quietHoursFrom: input.quiet.from,
      quietHoursTo: input.quiet.to,
      quietBreakForCritical: input.quiet.breakForCritical,
    },
    recipients: input.recipients
      .filter((r) => !r.primary)
      .map((r) => ({ email: r.email, role: r.role, scopeCategories: r.scopeCategories ?? null })),
  };

  const res = await fetchWithAuth("/api/portal/alert-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save alert preferences (${res.status})`);
}
