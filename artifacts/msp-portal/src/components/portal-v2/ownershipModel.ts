/**
 * ownershipModel.ts — every derived value on the Ownership matrix.
 *
 * Prototype references are to 'Ownership.dc.html'.
 *
 * The five counters above the matrix are ALL derived — none is a stored number
 * — and each one drives a panel listing the exact rows it counted. That makes
 * a wrong count a wrong list too, which is why every one of them is a named
 * function with a test rather than an expression inside the component.
 */

import {
  ESCALATION_DAYS,
  GAP_RISK,
  MISSING_OBJECTS,
  OBJECT_TYPES,
  OWN_OBJECTS,
  PENDING_ACCEPTANCE,
  PROVENANCE,
  PROVENANCE_DEFAULT,
  ROLE_KEYS,
  TYPE_SINGULAR,
  type ObjectTypeKey,
  type OwnObject,
  type Provenance,
  type RoleKey,
} from "./ownershipData";
import type { OwnPerson } from "./settingsData";

/** Local overrides applied on top of the fixture, keyed `${objectId}:${roleKey}`. */
export type OwnerOverrides = Readonly<Record<string, string>>;

/**
 * `owner(obj, k)` — prototype 733-736.
 *
 * An override of "" is a REAL value meaning "cleared to a gap", which is why
 * this tests for `undefined` rather than falsiness. Getting that wrong would
 * make un-assigning silently fall back to the fixture's original name.
 */
export function ownerOf(obj: OwnObject, k: RoleKey, ov: OwnerOverrides = {}): string {
  const v = ov[`${obj.id}:${k}`];
  return v === undefined ? obj[k] : v;
}

/** `gapOf` — prototype 783. The LABELS of the roles with no name, in column order. */
export function gapsOf(obj: OwnObject, ov: OwnerOverrides = {}): readonly string[] {
  return ROLE_KEYS.filter((rk) => !ownerOf(obj, rk.k, ov)).map((rk) => rk.label);
}

/** `onIt` — prototype 782. Is this person named in any of the four cells? */
export function isNamedOn(obj: OwnObject, personId: string, ov: OwnerOverrides = {}): boolean {
  return ROLE_KEYS.some((rk) => ownerOf(obj, rk.k, ov) === personId);
}

/** `provOf` — prototype 740. */
export function provenanceOf(objectId: string, k: RoleKey): Provenance {
  return { ...PROVENANCE_DEFAULT, ...(PROVENANCE[`${objectId}:${k}`] ?? {}) };
}

/**
 * `accOf` — prototype 741-746.
 *
 * Consulted and Informed carry NO acceptance state at all — being told is not
 * something you accept. Only Responsible and Accountable can be pending.
 */
export function acceptanceOf(objectId: string, k: RoleKey): "" | "pending" | "accepted" {
  if (k === "c" || k === "i") return "";
  return PENDING_ACCEPTANCE.includes(`${objectId}:${k}`) ? "pending" : "accepted";
}

/** `escOf` — prototype 747. */
export function escalationOf(objectId: string, k: RoleKey): number {
  return ESCALATION_DAYS[`${objectId}:${k}`] ?? 0;
}

/**
 * A cell is LATE when its idle days EXCEED the escalation threshold — prototype
 * 826 (`esc > S.escDays`). Strictly greater, so at exactly the threshold it is
 * not yet late; CR-0142's 7 days against the default 5 is late, MC1049877's 3
 * is not.
 */
export function isLate(objectId: string, k: RoleKey, escDays: number): boolean {
  return escalationOf(objectId, k) > escDays;
}

/* ────────────────────────────────────────────────────────────────────────────
   The five counters, and the four panels behind them
   ──────────────────────────────────────────────────────────────────────── */

export interface GapRow {
  id: string;
  type: string;
  typeKey: ObjectTypeKey;
  name: string;
  risk: string;
  action: string;
  /** The role key the "Assign …" button opens — the FIRST missing role. */
  roleKey: RoleKey;
}

/**
 * `gapList` — prototype 843-861.
 *
 * An object marked as knowingly unowned (`risks[id]`) drops OUT of the gap
 * list entirely: the page's position is that a recorded decision is not a gap.
 * It keeps its row and says so in the row's sub-line instead.
 */
export function gapRows(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  acceptedRisks: Readonly<Record<string, string>>,
): readonly GapRow[] {
  const out: GapRow[] = [];
  for (const o of objects) {
    const g = gapsOf(o, ov);
    if (!g.length || acceptedRisks[o.id]) continue;
    const firstMissing = ROLE_KEYS.find((rk) => rk.label === g[0]);
    out.push({
      id: o.id,
      typeKey: o.type,
      type: TYPE_SINGULAR[o.type],
      name: o.name,
      risk: GAP_RISK[o.id] ?? `No ${g.join(" or ").toLowerCase()} named.`,
      action: `Assign ${g[0].toLowerCase()}`,
      roleKey: firstMissing ? firstMissing.k : "r",
    });
  }
  return out;
}

export interface SodRow {
  id: string;
  name: string;
  detail: string;
  action: string;
  /** "assign" opens the assign panel on `roleKey`; "people" goes to Settings. */
  kind: "assign" | "people";
  roleKey?: RoleKey;
}

/**
 * `sod` — prototype 863-874. THREE separate separation-of-duty checks:
 *
 *  1. Responsible and Accountable are the same person — approving own work.
 *  2. Responsible is a Group or a Vendor — "Responsible has to be one person".
 *  3. Anyone accountable for MORE THAN HALF of all objects.
 *
 * The third is a strict `> 0.5` over the FULL object list, not the filtered
 * one, so switching the type filter cannot change whether someone is
 * over-concentrated — which is right: concentration is a property of the
 * estate, not of what you are looking at.
 */
export function sodRows(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  people: readonly OwnPerson[],
): readonly SodRow[] {
  const person = (id: string) => people.find((p) => p.id === id);
  const out: SodRow[] = [];

  for (const o of objects) {
    const r = ownerOf(o, "r", ov);
    const a = ownerOf(o, "a", ov);
    if (r && a && r === a) {
      const p = person(r);
      out.push({
        id: `${o.id}:same`,
        name: o.name,
        detail: `Responsible and accountable are the same person — ${p ? p.name : r} would be approving their own work.`,
        action: "Split it",
        kind: "assign",
        roleKey: "a",
      });
    }
    const rp = r ? person(r) : null;
    if (rp && rp.kind !== "Person") {
      out.push({
        id: `${o.id}:kind`,
        name: o.name,
        detail: `Responsible is a ${rp.kind.toLowerCase()} (${rp.name}). Responsible has to be one person, or nobody does it.`,
        action: "Name a person",
        kind: "assign",
        roleKey: "r",
      });
    }
  }

  const aCount: Record<string, number> = {};
  for (const o of objects) {
    const a = ownerOf(o, "a", ov);
    if (a) aCount[a] = (aCount[a] ?? 0) + 1;
  }
  for (const pid of Object.keys(aCount)) {
    if (aCount[pid] / objects.length > 0.5) {
      const p = person(pid);
      out.push({
        id: `${pid}:load`,
        name: p ? p.name : pid,
        detail: `Accountable for ${aCount[pid]} of ${objects.length} objects. One person answering for everything is the same as nobody answering.`,
        action: "Review",
        kind: "people",
      });
    }
  }
  return out;
}

export interface LoadWarnRow {
  id: string;
  name: string;
  detail: string;
  action: string;
}

/**
 * `loadWarn` — prototype 903-906.
 *
 * One check only, and a narrow one: away, no deputy, and STILL Responsible for
 * something live. Being merely busy is not a warning here — the page reserves
 * this counter for work that has nobody to do it right now.
 */
export function loadWarnRows(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  people: readonly OwnPerson[],
): readonly LoadWarnRow[] {
  return people
    .filter((p) => p.away && !p.deputy && objects.some((o) => ownerOf(o, "r", ov) === p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      detail: "Away with no cover, and still responsible for live work.",
      action: "Set cover",
    }));
}

/** `coverage` — prototype 876-882. Everything not yet given a row. */
export function coverageRows(added: readonly string[]) {
  return MISSING_OBJECTS.filter((m) => !added.includes(m.id)).map((m) => ({
    id: m.id,
    name: m.name,
    why: m.why,
    type: TYPE_SINGULAR[m.type],
  }));
}

/**
 * A coverage item promoted to a real row — prototype 772-775. It arrives with
 * FOUR gaps, which is the point: giving something a row does not give it an
 * owner, and the gap counter goes up, not down.
 */
export function addedObject(id: string): OwnObject | null {
  const m = MISSING_OBJECTS.find((x) => x.id === id);
  if (!m) return null;
  return {
    type: m.type,
    id: m.id,
    name: m.name,
    sub: "Added from the coverage list · nobody named yet",
    r: "",
    a: "",
    c: "",
    i: "",
    link: "Open →",
  };
}

export interface CounterSpec {
  k: "gaps" | "sod" | "load" | "cov" | "all";
  value: string;
  label: string;
  tone: string;
}

/**
 * The five counters — prototype 909-914.
 *
 * ── Round Two: pills became boxes, in a fixed five-column row ──────────────
 * "The five counters above the matrix ... changed from pill-shaped inline
 * buttons to box-shaped cards in a fixed 5-column grid (`repeat(5, 1fr)`) so
 * they never wrap to a second row; labels wrap to two lines instead of
 * truncating." Both halves are in the artefact: the grid at Ownership.dc.html
 * 107 is `repeat(5,minmax(0,1fr))`, and the label style at 919 carries
 * `white-space:normal;text-wrap:pretty` where a pill would have had `nowrap`.
 * The component reproduces both; this function is only the numbers and copy.
 *
 * THREE of the five singularise their label and two do not — "ownership gap" /
 * "duty conflict" have singular forms, "carrying too much" and "not in the
 * matrix" read the same either way, and "objects owned here" is never one in
 * practice. Reproduced exactly rather than regularised.
 */
export function counters(args: {
  gaps: number;
  sod: number;
  load: number;
  coverage: number;
  total: number;
}): readonly CounterSpec[] {
  return [
    { k: "gaps", value: String(args.gaps), label: args.gaps === 1 ? "ownership gap" : "ownership gaps", tone: "#fbbf24" },
    { k: "sod", value: String(args.sod), label: args.sod === 1 ? "duty conflict" : "duty conflicts", tone: "#f87171" },
    { k: "load", value: String(args.load), label: "carrying too much", tone: "#fb923c" },
    { k: "cov", value: String(args.coverage), label: "not in the matrix", tone: "#60a5fa" },
    { k: "all", value: String(args.total), label: "objects owned here", tone: "#2dd4bf" },
  ];
}

/**
 * Which counter is highlighted — prototype 916. `all` is on whenever NO panel
 * is open, so the row always has exactly one lit box rather than none.
 */
export function counterOn(k: CounterSpec["k"], panel: string | null): boolean {
  return panel === k || (k === "all" && !panel);
}

/**
 * Clicking a counter — prototype 918. `all` always closes; any other toggles.
 * So the total is a "show me everything" button, not a fifth panel.
 */
export function nextPanel(k: CounterSpec["k"], panel: string | null): string | null {
  return k === "all" || panel === k ? null : k;
}

/* ── Panel intros — prototype 1225, 1107, 1159, 1114 ─────────────────────── */

export function gapMeta(gaps: number, total: number): string {
  return `${gaps} of ${total} objects are missing a name. Nothing is blocked — it is just nobody’s job yet.`;
}

export function sodMeta(n: number): string {
  return `${n} places where the four names do not separate the work from the sign-off`;
}

export function loadMeta(n: number): string {
  return `${n} people carrying more than the matrix should let them`;
}

export function covMeta(n: number): string {
  return `${n} things in the estate have no row here at all, so nothing routes for them`;
}

/** prototype 1226. */
export function matrixMeta(shown: number, total: number): string {
  return `${shown} of ${total} shown · click any name to change it`;
}

/** prototype 1228. */
export function noRowsLine(personName: string | null): string {
  return personName
    ? `${personName} is not named on anything in this category.`
    : "Nothing in this category yet — add a row and give it four names.";
}

/** prototype 1153. */
export function reviewLine(reviewedAt: string, dueDays: number): string {
  return `Reviewed ${reviewedAt} · next review in ${dueDays} days`;
}

/* ────────────────────────────────────────────────────────────────────────────
   The matrix itself
   ──────────────────────────────────────────────────────────────────────── */

/** `shown` — prototype 782. Person filter AND type filter, both optional. */
export function shownObjects(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  filter: string,
  personId: string | null,
): readonly OwnObject[] {
  return objects.filter(
    (o) => (!personId || isNamedOn(o, personId, ov)) && (filter === "all" || o.type === filter),
  );
}

/**
 * `groups` — prototype 801-803. Only types that actually have a visible row get
 * a panel, so an empty category disappears rather than rendering a bare header.
 */
export function groupedByType(shown: readonly OwnObject[], ov: OwnerOverrides) {
  return OBJECT_TYPES.filter((t) => shown.some((o) => o.type === t.key)).map((t) => {
    const rows = shown.filter((o) => o.type === t.key);
    const gaps = rows.filter((o) => gapsOf(o, ov).length).length;
    return {
      type: t,
      rows,
      gaps,
      /** prototype 806 — "fully owned" is stated, not left blank. */
      meta: `${rows.length}${gaps ? ` · ${gaps} with a gap` : " · fully owned"}`,
    };
  });
}

/** The row's sub-line, which a recorded risk decision replaces — prototype 815. */
export function rowSub(obj: OwnObject, acceptedRisks: Readonly<Record<string, string>>): string {
  const risk = acceptedRisks[obj.id];
  return risk ? `Unowned by choice · ${risk}` : obj.sub;
}

/**
 * The cell's tooltip — prototype 830. It is the only place the provenance,
 * the acceptance state, the away note and the escalation clock are all stated
 * together, which is why it is assembled here rather than inline.
 */
export function cellTitle(args: {
  obj: OwnObject;
  k: RoleKey;
  roleLabel: string;
  person: OwnPerson | null;
  escDays: number;
}): string {
  const { obj, k, roleLabel, person, escDays } = args;
  if (!person) return `Nobody is ${roleLabel.toLowerCase()} for this`;
  const acc = acceptanceOf(obj.id, k);
  const esc = escalationOf(obj.id, k);
  const late = esc > escDays;
  const prov = provenanceOf(obj.id, k);
  return (
    person.name +
    (person.away ? ` · away, ${person.away}` : "") +
    (acc === "pending" ? " · has not accepted yet" : "") +
    (late ? ` · ${esc} days with no movement` : "") +
    ` — set by ${prov.by} on ${prov.at}`
  );
}

/** Which of the three cell marks applies — prototype 828-831, in priority order. */
export function cellMark(args: {
  objectId: string;
  k: RoleKey;
  person: OwnPerson | null;
  escDays: number;
}): "late" | "pending" | "away" | null {
  const { objectId, k, person, escDays } = args;
  if (!person) return null;
  if (isLate(objectId, k, escDays)) return "late";
  if (acceptanceOf(objectId, k) === "pending") return "pending";
  if (person.away) return "away";
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
   The load sidebar
   ──────────────────────────────────────────────────────────────────────── */

/**
 * `loadAll` — prototype 928-932, split into people and groups by the markup at
 * Ownership.dc.html 43 and 58.
 *
 * Only people who are named on SOMETHING appear. Someone in the roster with no
 * assignments is not listed, because the panel's question is "who is carrying
 * what", not "who exists".
 */
export function loadRows(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  people: readonly OwnPerson[],
  search: string,
) {
  const q = search.trim().toLowerCase();
  return people
    .filter((p) => objects.some((o) => isNamedOn(o, p.id, ov)))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
    .map((p) => {
      const r = objects.filter((o) => ownerOf(o, "r", ov) === p.id).length;
      const a = objects.filter((o) => ownerOf(o, "a", ov) === p.id).length;
      return { person: p, r, a, meta: `R on ${r} · A on ${a}` };
    });
}

/** Per-person RACI counts for the selected-person band — prototype 1065-1068. */
export function personCounts(
  objects: readonly OwnObject[],
  ov: OwnerOverrides,
  personId: string,
) {
  return ROLE_KEYS.map((rk) => ({
    role: rk,
    value: String(objects.filter((o) => ownerOf(o, rk.k, ov) === personId).length),
  }));
}

/** The whole object list including anything promoted from coverage — 776. */
export function allObjects(added: readonly string[]): readonly OwnObject[] {
  return OWN_OBJECTS.concat(added.map(addedObject).filter((x): x is OwnObject => x !== null));
}
