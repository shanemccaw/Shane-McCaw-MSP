/**
 * Pure derivations that turn `WireOwnershipPayload` into the shapes the
 * Ownership / RACI page renders (#3040). Kept pure and separate from the
 * components for the same reason the backend's own mappers are
 * (`portal-ownership.ts`'s own header): what a cell's real current holder IS
 * is testable without a component tree.
 *
 * The one fact every function here respects: `objects[].{r,a,c,i}` is only
 * ever a real value for `cr.r`/`cr.a` (the two DB columns that name someone
 * directly) — everywhere else it is `overlay.assignments` or nothing
 * (contract pack §2/§5). A saved assignment for a cell always takes
 * precedence over that base seed.
 */
import type {
  OwnObjectType,
  OwnRoleKey,
  WireOwnAssignment,
  WireOwnObject,
  WireOwnershipPayload,
} from "@/lib/ownership-types";

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

function groupAssignments(
  assignments: readonly WireOwnAssignment[],
): ReadonlyMap<string, WireOwnAssignment[]> {
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

function cellFor(
  object: WireOwnObject,
  roleKey: OwnRoleKey,
  byCell: ReadonlyMap<string, WireOwnAssignment[]>,
): readonly MatrixCellHolder[] {
  const saved = byCell.get(cellKey(object.id, roleKey));
  if (saved && saved.length > 0) {
    return saved.map((a) => ({
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
    return [
      {
        personId: base,
        acceptance: "",
        order: 0,
        setBy: "",
        setAt: "",
        respondedBy: "",
        respondedAt: "",
        declineReason: "",
        isBaseSeed: true,
      },
    ];
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

/** One "your place on the matrix" line — every cell the signed-in person holds. */
export interface MineEntry {
  readonly object: WireOwnObject;
  readonly roleKey: OwnRoleKey;
  readonly holder: MatrixCellHolder;
}

export function buildMineEntries(rows: readonly MatrixRow[], currentUserId: string): readonly MineEntry[] {
  if (!currentUserId) return [];
  const out: MineEntry[] = [];
  const roleKeys: readonly OwnRoleKey[] = ["r", "a", "c", "i"];
  for (const row of rows) {
    for (const roleKey of roleKeys) {
      for (const holder of row.cells[roleKey]) {
        if (holder.personId === currentUserId) out.push({ object: row.object, roleKey, holder });
      }
    }
  }
  return out;
}

export interface MatrixGaps {
  readonly noAccountable: number;
  readonly noResponsible: number;
  readonly awaitingAcceptance: number;
}

export function computeGaps(rows: readonly MatrixRow[]): MatrixGaps {
  let noAccountable = 0;
  let noResponsible = 0;
  let awaitingAcceptance = 0;
  for (const row of rows) {
    if (row.cells.a.length === 0) noAccountable++;
    if (row.cells.r.length === 0) noResponsible++;
    for (const roleKey of ["r", "a"] as const) {
      for (const holder of row.cells[roleKey]) {
        if (holder.acceptance === "pending") awaitingAcceptance++;
      }
    }
  }
  return { noAccountable, noResponsible, awaitingAcceptance };
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
