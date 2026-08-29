/**
 * settingsChangeControlLive.ts — the Settings page's real "Change control
 * policy" data (Git #1592).
 *
 *   GET /api/portal/settings/change-control
 *   PUT /api/portal/settings/change-control/policy
 *   PUT /api/portal/settings/change-control/approvers
 *   PUT /api/portal/settings/change-control/notifications/:eventKey
 *
 * served by `artifacts/api-server/src/routes/portal-settings-change-control.ts`,
 * scoped to the calling customer's own account.
 *
 * No page imports this yet — there is no `Design/portal/` Settings export to
 * wire it into (see the header of `settingsChangeControlWire.ts`). This file
 * exists so that work is a straight import once the design lands, rather than
 * a second pass through the endpoint.
 */

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { toNotifRules, toPeople, toPolicy, type CcApproverBand, type CcNotifRule, type CcPerson, type CcPolicy, type WireChangeControlSettings } from "./settingsChangeControlWire";

const CHANGE_CONTROL_URL = "/api/portal/settings/change-control";

export interface ChangeControlLiveState {
  readonly policy: CcPolicy;
  readonly notifications: readonly CcNotifRule[];
  readonly people: readonly CcPerson[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly saving: boolean;
  /** Persists a partial policy patch. Resolves to null on success, or the
   *  reason it failed. */
  readonly savePolicy: (patch: Partial<Omit<CcPolicy, "approvers">>) => Promise<string | null>;
  /** Replaces the full approver set for one band. */
  readonly saveApprovers: (band: CcApproverBand, personIds: readonly string[]) => Promise<string | null>;
  /** Saves one notification rule by its event key. */
  readonly saveNotifRule: (event: string, patch: Partial<Pick<CcNotifRule, "channel" | "to" | "lead" | "on">>) => Promise<string | null>;
}

export function useChangeControlSettingsLive(): ChangeControlLiveState {
  const { fetchWithAuth } = useAuth();
  const [policy, setPolicy] = useState<CcPolicy>(toPolicy(undefined));
  const [notifications, setNotifications] = useState<readonly CcNotifRule[]>([]);
  const [people, setPeople] = useState<readonly CcPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetchWithAuth(CHANGE_CONTROL_URL, undefined, { silent: true });
      if (!res.ok) throw new Error(`change-control ${res.status}`);
      const body = (await res.json()) as WireChangeControlSettings;
      setPolicy(toPolicy(body.policy));
      setNotifications(toNotifRules(body.notifications));
      setPeople(toPeople(body.people));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const savePolicy = useCallback(
    async (patch: Partial<Omit<CcPolicy, "approvers">>): Promise<string | null> => {
      setSaving(true);
      try {
        const merged = { ...policy, ...patch };
        const res = await fetchWithAuth(
          `${CHANGE_CONTROL_URL}/policy`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged),
          },
          { silent: true },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return body?.error ?? `Could not save the change control policy (${res.status})`;
        }
        setPolicy(merged);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth, policy],
  );

  const saveApprovers = useCallback(
    async (band: CcApproverBand, personIds: readonly string[]): Promise<string | null> => {
      setSaving(true);
      try {
        const res = await fetchWithAuth(
          `${CHANGE_CONTROL_URL}/approvers`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ band, personIds }),
          },
          { silent: true },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return body?.error ?? `Could not save approvers (${res.status})`;
        }
        setPolicy((cur) => ({ ...cur, approvers: { ...cur.approvers, [band]: personIds } }));
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth],
  );

  const saveNotifRule = useCallback(
    async (event: string, patch: Partial<Pick<CcNotifRule, "channel" | "to" | "lead" | "on">>): Promise<string | null> => {
      setSaving(true);
      try {
        const current = notifications.find((n) => n.event === event);
        const merged = { channel: current?.channel ?? "", to: current?.to ?? "", lead: current?.lead ?? "", on: current?.on ?? true, ...patch };
        const res = await fetchWithAuth(
          `${CHANGE_CONTROL_URL}/notifications/${encodeURIComponent(event)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged),
          },
          { silent: true },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return body?.error ?? `Could not save that notification rule (${res.status})`;
        }
        setNotifications((cur) => cur.map((n) => (n.event === event ? { ...n, ...merged } : n)));
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth, notifications],
  );

  return { policy, notifications, people, loading, error, saving, savePolicy, saveApprovers, saveNotifRule };
}
