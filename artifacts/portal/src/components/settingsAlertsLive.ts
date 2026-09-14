/**
 * settingsAlertsLive.ts — the Settings page's real "Alert preferences" data
 * (Git #1276/#1278, wired by #1736).
 *
 *   GET /api/portal/alert-preferences
 *   PUT /api/portal/alert-preferences
 *   GET /api/portal/alert-preferences/rules
 *
 * served by `artifacts/api-server/src/routes/portal-alert-preferences.ts`,
 * scoped to the calling customer's own tenant off the JWT. No saved rows
 * degrades to the route's own Balanced-preset defaults — the same
 * "unset = default" convention the route documents, not a fixture fallback.
 */

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  ALERT_CATEGORIES,
  toAlertPreferencesProfile,
  toAlertRules,
  type AlertCategory,
  type AlertCategoryPref,
  type AlertPreferencesProfile,
  type AlertRecipient,
  type AlertRule,
  type AlertSettings,
} from "./settingsAlertsWire";

const PREFS_URL = "/api/portal/alert-preferences";
const RULES_URL = "/api/portal/alert-preferences/rules";

export type AlertsDataState = "loading" | "live" | "failed";

export interface AlertPreferencesLiveState {
  readonly dataState: AlertsDataState;
  readonly profile: AlertPreferencesProfile | null;
  readonly rules: readonly AlertRule[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly reload: () => Promise<void>;
  readonly save: (
    categories: Record<AlertCategory, AlertCategoryPref>,
    settings: AlertSettings,
    recipients: readonly AlertRecipient[],
  ) => Promise<boolean>;
}

export function useAlertPreferencesLive(): AlertPreferencesLiveState {
  const { fetchWithAuth } = useAuth();
  const [dataState, setDataState] = useState<AlertsDataState>("loading");
  const [profile, setProfile] = useState<AlertPreferencesProfile | null>(null);
  const [rules, setRules] = useState<readonly AlertRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setDataState("loading");
    try {
      const res = await fetchWithAuth(PREFS_URL);
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const body = await res.json();
      setProfile(toAlertPreferencesProfile(body));
      setDataState("live");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDataState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth(RULES_URL, undefined, { silent: true });
        if (!res.ok) return;
        const body = await res.json();
        setRules(toAlertRules(body));
      } catch {
        // The rule catalog is advisory display only (per-category chips) —
        // a failed fetch here doesn't block the page, it just leaves the
        // chips empty for that category.
      }
    })();
  }, [fetchWithAuth]);

  const save = useCallback(
    async (
      categories: Record<AlertCategory, AlertCategoryPref>,
      settings: AlertSettings,
      recipients: readonly AlertRecipient[],
    ): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const payload = {
          categories: Object.fromEntries(ALERT_CATEGORIES.map((cat) => [cat, categories[cat]])),
          settings: {
            activePreset: settings.activePreset,
            quietHoursEnabled: settings.quietHoursEnabled,
            quietHoursFrom: settings.quietHoursFrom,
            quietHoursTo: settings.quietHoursTo,
            quietBreakForCritical: settings.quietBreakForCritical,
          },
          recipients: recipients.map((r) => ({
            email: r.email,
            role: r.role,
            scopeCategories: r.scopeCategories,
          })),
        };
        const res = await fetchWithAuth(PREFS_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
        await reload();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth, reload],
  );

  return { dataState, profile, rules, saving, error, reload, save };
}
