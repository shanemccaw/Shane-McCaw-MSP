/**
 * settingsDepartmentsWire.ts — the wire shapes behind
 * GET /api/portal/settings/departments, the real backend for the Settings
 * page's "Departments" section (Git #1592).
 *
 * Pure functions, no React — the fetching lives in
 * `settingsDepartmentsLive.ts`. There is no `Design/portal/` export for
 * Settings yet, so nothing in `artifacts/portal/src/pages` consumes this file
 * today; it exists so wiring the page is a straight import once that design
 * lands. `DeptRow` matches the retired `settingsData.ts`'s field names on
 * purpose (see `portal-archive-2026-08-29`), except `n` here is a REAL live
 * count off `users.department`, not a fixture number.
 */

export type DeptSource = "attribute" | "group";
export type DeptUnmappedFallback = "unmapped" | "attribute_fallback";

export interface DeptRow {
  readonly name: string;
  readonly n: number;
  readonly src: DeptSource;
  readonly group: string;
  readonly unmappedFallback: DeptUnmappedFallback;
}

export interface WireDepartmentsPayload {
  readonly departments?: unknown;
  readonly unmapped?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toSource(v: unknown): DeptSource {
  return v === "group" ? "group" : "attribute";
}

function toFallback(v: unknown): DeptUnmappedFallback {
  return v === "unmapped" ? "unmapped" : "attribute_fallback";
}

export function toDeptRows(raw: unknown): readonly DeptRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => {
      const row = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
      return {
        name: str(row.name),
        n: typeof row.n === "number" && Number.isFinite(row.n) ? row.n : 0,
        src: toSource(row.src),
        group: str(row.group) || "Not set",
        unmappedFallback: toFallback(row.unmappedFallback),
      };
    })
    .filter((d) => d.name !== "");
}

/** A whole-number count, or "0" for anything that did not resolve — mirrors
 *  the design's own STRING field (`DEPT_UNMAPPED`), which the "people have no
 *  usable department" line renders verbatim. */
export function toUnmappedLabel(raw: unknown): string {
  return typeof raw === "number" && Number.isFinite(raw) ? String(Math.trunc(raw)) : "0";
}
