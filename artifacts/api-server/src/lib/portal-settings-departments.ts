/**
 * portal-settings-departments.ts — wire shapes and pure normalisation for the
 * Settings page's "Departments" section (Git #1592).
 *
 * Pure functions, no Express/DB — the router lives at
 * `routes/portal-settings-departments.ts`.
 *
 * ── Headcounts are real, computed live; only the mapping is stored ─────────
 * The design fixture (`DEPT_ROWS` / `DEPT_UNMAPPED` in the retired
 * `settingsData.ts`) hardcoded seven departments and a "204 unmapped" count for
 * the prototype's fictional tenant. There is no honest way to persist a
 * headcount — it changes every time a user is added, removed or re-tagged in
 * Entra — so this route computes it fresh from `users.department` on every
 * read (`portal-ownership.ts` already reads the same column for the exact
 * same tenant scoping). Only the customer's choice of "read this department
 * from a security group instead of the Entra attribute" is a durable setting,
 * and that is the one thing `portal_department_mappings` stores.
 */

import type { PortalDepartmentSource, PortalDepartmentUnmappedFallback } from "@workspace/db";

export interface DepartmentUserRow {
  readonly department: string | null;
}

export interface LiveDepartmentCount {
  readonly name: string;
  readonly n: number;
}

/** Groups active users by their real `department` value, dropping blank/null
 *  ones into the unmapped count instead of a fake "Unassigned" row. */
export function groupByDepartment(rows: readonly DepartmentUserRow[]): { counts: readonly LiveDepartmentCount[]; unmapped: number } {
  const tally = new Map<string, number>();
  let unmapped = 0;
  for (const row of rows) {
    const name = (row.department ?? "").trim();
    if (!name) {
      unmapped += 1;
      continue;
    }
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const counts = Array.from(tally.entries())
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { counts, unmapped };
}

export function isPortalDepartmentSource(v: unknown): v is PortalDepartmentSource {
  return v === "attribute" || v === "group";
}

export function isPortalDepartmentUnmappedFallback(v: unknown): v is PortalDepartmentUnmappedFallback {
  return v === "unmapped" || v === "attribute_fallback";
}
