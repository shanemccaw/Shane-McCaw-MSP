/**
 * Pure derivations that turn `WireOwnershipPayload` into the shapes the MSP
 * Console's Ownership module renders (Git #2594). Mirrors
 * `artifacts/portal/src/lib/ownership-matrix.ts`'s own merge semantics
 * exactly — same rule, same precedence — because the two apps read the
 * identical server assembly and must not disagree about what a cell's real
 * current holder is. It is a second file, not a forked import, only because
 * this repo's `artifacts/*` apps have no cross-app component/module sharing
 * mechanism other than a `lib/*` workspace package (CLAUDE.md); the READ
 * itself is shared server-side (`assembleOwnershipPayload`), which is the
 * rule #1686 actually states.
 *
 * The one fact every function here respects: `objects[].{r,a,c,i}` is only
 * ever a real value for `cr.r`/`cr.a` (the two DB columns that name someone
 * directly) — everywhere else it is `overlay.assignments` or nothing. A
 * saved assignment for a cell always takes precedence over that base seed.
 */
import type { OwnObjectType, OwnRoleKey, WireOwnAssignment, WireOwnObject, WireOwnershipPayload } from "@/api/ownership-api";

export interface MatrixCellHolder {
  readonly personId: string;
  readonly acceptance: string;
  readonly order: number;
  readonly setBy: string;
  readonly setAt: string;
  readonly respondedBy: string;
  readonly respondedAt: string;
  readonly declineReason: string;
  /** True when this holder came from the object's own base seed (cr.r/cr.a only), not a saved assignment. */
  readonly isBaseSeed: boolean;
}

export interface MatrixRow {
  readonly object: WireOwnObject;
  readonly cells: Readonly<Record<OwnRoleKey, readonly MatrixCellHolder[]>>;
}

function cellKey(objectId: string, roleKey: string): string {
  return `${objectId}:${roleKey}`;
}

function groupAssignments(assignments: readonly WireOwnAssignment[]): ReadonlyMap<string, WireOwnAssignment[]> {
  const map = new Map<string, WireOwnAssignment[]>();
  for (const a of assignments) {
    const key = cellKey(a.objectId, a.roleKey);
    const list = map.get(key);
    if (list) list.push(a);
    else map.set(key, [a]);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

function cellFor(object: WireOwnObject, roleKey: OwnRoleKey, byCell: ReadonlyMap<string, WireOwnAssignment[]>): readonly MatrixCellHolder[] {
  const saved = byCell.get(cellKey(object.id, roleKey));
  if (saved && saved.length > 0) {
    return saved
      .filter((a) => a.ownerPersonId)
      .map((a) => ({
        personId: a.ownerPersonId,
        acceptance: a.acceptance,
        order: a.order,
        setBy: a.setBy,
        setAt: a.setAt,
        respondedBy: a.respondedBy,
        respondedAt: a.respondedAt,
        declineReason: a.declineReason,
        isBaseSeed: false,
      }));
  }
  const base = object[roleKey];
  if (base) {
    return [{ personId: base, acceptance: "", order: 0, setBy: "", setAt: "", respondedBy: "", respondedAt: "", declineReason: "", isBaseSeed: true }];
  }
  return [];
}

/** Every real object, with its four cells resolved (saved assignment > base seed > gap). */
export function buildMatrixRows(payload: WireOwnershipPayload): readonly MatrixRow[] {
  const byCell = groupAssignments(payload.overlay.assignments);
  return payload.objects.map((object) => ({
    object,
    cells: {
      r: cellFor(object, "r", byCell),
      a: cellFor(object, "a", byCell),
      c: cellFor(object, "c", byCell),
      i: cellFor(object, "i", byCell),
    },
  }));
}

/** Groups rows by object type, in the source's own fixed live-type order. */
export function groupByType(rows: readonly MatrixRow[]): ReadonlyMap<OwnObjectType, MatrixRow[]> {
  const order: readonly OwnObjectType[] = ["workload", "service", "change", "cr", "freeze"];
  const map = new Map<OwnObjectType, MatrixRow[]>();
  for (const type of order) map.set(type, []);
  for (const row of rows) {
    const list = map.get(row.object.type);
    if (list) list.push(row);
    else map.set(row.object.type, [row]);
  }
  for (const [type, list] of map) if (list.length === 0) map.delete(type);
  return map;
}

/** One row with a genuine gap in R or A — the "missing owner" list #2594 asks the console to surface. */
export interface MissingOwnerRow {
  readonly object: WireOwnObject;
  readonly missing: readonly ("r" | "a")[];
}

export function findMissingOwners(rows: readonly MatrixRow[]): readonly MissingOwnerRow[] {
  const out: MissingOwnerRow[] = [];
  for (const row of rows) {
    const missing: ("r" | "a")[] = [];
    if (row.cells.r.length === 0) missing.push("r");
    if (row.cells.a.length === 0) missing.push("a");
    if (missing.length > 0) out.push({ object: row.object, missing });
  }
  return out;
}
