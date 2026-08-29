/**
 * settingsDepartmentsLive.ts — the Settings page's real "Departments" data
 * (Git #1592).
 *
 *   GET    /api/portal/settings/departments
 *   PUT    /api/portal/settings/departments/:name/mapping
 *   DELETE /api/portal/settings/departments/:name/mapping
 *
 * served by `artifacts/api-server/src/routes/portal-settings-departments.ts`,
 * scoped to the calling customer's own account. Headcounts are computed live
 * off `users.department`; only the group-mapping overlay is a stored setting.
 *
 * No page imports this yet — see the header of `settingsDepartmentsWire.ts`.
 */

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { toDeptRows, toUnmappedLabel, type DeptRow, type DeptUnmappedFallback, type WireDepartmentsPayload } from "./settingsDepartmentsWire";

const DEPARTMENTS_URL = "/api/portal/settings/departments";

export interface DepartmentsLiveState {
  readonly departments: readonly DeptRow[];
  readonly unmapped: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly saving: boolean;
  /** Maps a department to a security group. Resolves to null on success, or
   *  the reason it failed. */
  readonly mapToGroup: (
    name: string,
    securityGroupId: string,
    securityGroupName: string,
    unmappedFallback?: DeptUnmappedFallback,
  ) => Promise<string | null>;
  /** Reverts a department to reading from the Entra attribute. */
  readonly clearMapping: (name: string) => Promise<string | null>;
}

export function useDepartmentsLive(): DepartmentsLiveState {
  const { fetchWithAuth } = useAuth();
  const [departments, setDepartments] = useState<readonly DeptRow[]>([]);
  const [unmapped, setUnmapped] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetchWithAuth(DEPARTMENTS_URL, undefined, { silent: true });
      if (!res.ok) throw new Error(`departments ${res.status}`);
      const body = (await res.json()) as WireDepartmentsPayload;
      setDepartments(toDeptRows(body.departments));
      setUnmapped(toUnmappedLabel(body.unmapped));
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

  const mapToGroup = useCallback(
    async (
      name: string,
      securityGroupId: string,
      securityGroupName: string,
      unmappedFallback: DeptUnmappedFallback = "attribute_fallback",
    ): Promise<string | null> => {
      setSaving(true);
      try {
        const res = await fetchWithAuth(
          `${DEPARTMENTS_URL}/${encodeURIComponent(name)}/mapping`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "group", securityGroupId, securityGroupName, unmappedFallback }),
          },
          { silent: true },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return body?.error ?? `Could not map ${name} by group (${res.status})`;
        }
        await reload();
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth, reload],
  );

  const clearMapping = useCallback(
    async (name: string): Promise<string | null> => {
      setSaving(true);
      try {
        const res = await fetchWithAuth(`${DEPARTMENTS_URL}/${encodeURIComponent(name)}/mapping`, { method: "DELETE" }, { silent: true });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return body?.error ?? `Could not clear the mapping for ${name} (${res.status})`;
        }
        await reload();
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setSaving(false);
      }
    },
    [fetchWithAuth, reload],
  );

  return { departments, unmapped, loading, error, saving, mapToGroup, clearMapping };
}
