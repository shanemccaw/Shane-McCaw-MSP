/**
 * settingsModel.ts — every derived value on the Settings page.
 *
 * Split out of the component for the same reason riskRegisterModel.ts is: the
 * prototype computes these inline inside `renderVals()`, where a transcription
 * slip lands on screen as a plausible-looking number with nothing to contradict
 * it. Here each one is a named function with a test.
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'.
 */

import {
  OWN_AVAILABLE_LABEL,
  OWN_AWAY_DEFAULT,
  OWN_KINDS,
  OWN_SIDES,
  type CcPolicy,
  type OwnKind,
  type OwnPerson,
  type OwnSide,
} from "./settingsData";

/* ────────────────────────────────────────────────────────────────────────────
   People & roles
   ──────────────────────────────────────────────────────────────────────── */

/**
 * `ownPeopleFoot` — prototype 19996.
 *
 * "outside" is everyone whose side is NOT Halden, which folds MSP and External
 * into one number. The prototype counts it that way and the copy says "outside",
 * not "at the MSP", so the two-way split is the intent.
 */
export function ownPeopleFoot(people: readonly OwnPerson[]): string {
  const halden = people.filter((p) => p.side === "Halden").length;
  const outside = people.length - halden;
  return `${people.length} people · ${halden} at Halden, ${outside} outside`;
}

/** `away: p.away ? p.away : 'Available'` — prototype 19983. */
export function awayLabel(person: OwnPerson): string {
  return person.away ? person.away : OWN_AVAILABLE_LABEL;
}

/**
 * `deputy: p.deputy && findP(p.deputy) ? 'Cover · ' + findP(p.deputy).name.split(' ')[0] : 'No cover'`
 * — prototype 19987.
 *
 * FIRST WORD of the name, so "Service desk" shows as "Cover · Service". The
 * prototype's own output; kept because the column is 1/4 of a 4-across row and
 * the truncation is what makes it fit.
 *
 * A deputy id that no longer resolves — the person was removed — falls back to
 * "No cover" rather than rendering a dangling id, which is also what makes
 * removal safe without a cascade.
 */
export function deputyLabel(person: OwnPerson, people: readonly OwnPerson[]): string {
  if (!person.deputy) return "No cover";
  const dep = people.find((x) => x.id === person.deputy);
  if (!dep) return "No cover";
  return `Cover · ${dep.name.split(" ")[0]}`;
}

/** `sideGo` — prototype 19977. Wraps at the end of OWN_SIDES. */
export function cycleSide(side: OwnSide): OwnSide {
  return OWN_SIDES[(OWN_SIDES.indexOf(side) + 1) % OWN_SIDES.length];
}

/** `kindGo` — prototype 19980. */
export function cycleKind(kind: OwnKind): OwnKind {
  return OWN_KINDS[(OWN_KINDS.indexOf(kind) + 1) % OWN_KINDS.length];
}

/** `awayGo` — prototype 19984. Toggling ON writes the default return note. */
export function toggleAway(person: OwnPerson): string {
  return person.away ? "" : OWN_AWAY_DEFAULT;
}

/**
 * `deputyGo` — prototype 19988-19992.
 *
 * The candidate list is every OTHER person whose kind is Person, plus "" for no
 * cover, and the click advances one place through it.
 *
 * ── A quirk that is reproduced, not corrected ──────────────────────────────
 * The candidate list excludes Groups and Vendors, but a deputy ALREADY set to
 * one is not excluded from being the current value — Jo Feltham's seed deputy
 * is `desk`, which is a Group (settingsData OWN_PEOPLE_SEED). `indexOf` returns
 * -1 for it, so `(-1 + 1) % len` is 0 and the first click jumps to the first
 * eligible person rather than advancing from where it was. That is the
 * prototype's behaviour at 19990 exactly, and it is benign: the list is a
 * cycle, so "start at the beginning" is a defensible answer for a value that is
 * not in it. Changing it would be inventing a rule the design does not state.
 */
export function cycleDeputy(person: OwnPerson, people: readonly OwnPerson[]): string {
  const ids = people
    .filter((x) => x.id !== person.id && x.kind === "Person")
    .map((x) => x.id)
    .concat([""]);
  return ids[(ids.indexOf(person.deputy) + 1) % ids.length];
}

/**
 * `addOwnPerson` — prototype 19995.
 *
 * ── A defect fixed deliberately, and it is the SAME defect Round Two fixed ──
 * The prototype pushes `{ id, name, role, side }` and stops: no `kind`, no
 * `away`, no `deputy`. The consequences are visible on the row it creates —
 * `kind` renders as an EMPTY BUTTON (19979 prints `p.kind`), and `kindCss`
 * (19981) tests `p.kind === 'Person'`, which `undefined` fails, so the blank
 * button is also drawn in the amber "not a person" colour.
 *
 * That is exactly the failure Round Two's own bug-fix entry describes for
 * Active Runbooks — a row rendering a blank label because the data does not
 * carry the field the template reads. Fixing it here rather than reproducing it
 * is the same call, and the type system now makes the omission impossible.
 *
 * `id` is passed in rather than generated so the caller owns the clock; the
 * prototype uses `Date.now()`, which is untestable and would make two people
 * added in the same millisecond collide.
 */
export function newOwnPerson(id: string): OwnPerson {
  return { id, name: "New person", role: "Role", side: "Halden", kind: "Person", away: "", deputy: "" };
}

/* ────────────────────────────────────────────────────────────────────────────
   Ownership routing
   ──────────────────────────────────────────────────────────────────────── */

/**
 * `const on = (this.state.ownRules || {})[r.k] !== false` — prototype 20013.
 *
 * Absent means ON. The seed is `ownRules: {}` (7234), so all six rules start
 * live without the seed having to list them, and only an explicit `false` turns
 * one off.
 */
export function routingRuleOn(rules: Readonly<Record<string, boolean>>, k: string): boolean {
  return rules[k] !== false;
}

/* ────────────────────────────────────────────────────────────────────────────
   Change control policy
   ──────────────────────────────────────────────────────────────────────── */

/** `ccMasterTitle` — prototype 19327. */
export function ccMasterTitle(policy: CcPolicy): string {
  return policy.on ? "Change control is on" : "Change control is off";
}

/**
 * `ccMasterNote` — prototype 19328-19330.
 *
 * The ON note INTERPOLATES the signature count, so changing "Signatures
 * required" below rewrites this sentence. That is the design's way of making
 * the master band state the current policy rather than a generic promise.
 */
export function ccMasterNote(policy: CcPolicy): string {
  return policy.on
    ? `Nothing this portal can execute runs without a change request behind it and ${policy.approvals} signatures on the record.`
    : "Actions run the moment you click them. Each one still lands in the register marked run without approval, so the history stays complete.";
}

/**
 * `togglePolicyApprover` — prototype 8182-8186. Membership toggle on one band.
 */
export function toggleApprover(
  current: readonly string[],
  id: string,
): readonly string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : current.concat([id]);
}

/**
 * `initialsOf` for the approver chips — prototype 19369 calls it, and the
 * matching helper in Ownership.dc.html (704-706) is the one with a body:
 * split on spaces and middots, keep the parts that START WITH A CAPITAL, take
 * the first two, join their first letters. "—" when nothing qualifies.
 *
 * The capital test is what makes "R. Court" give "RC" and "Service desk" give
 * "S" rather than "Sd" — lowercase words are skipped, not initialised.
 */
export function initialsOf(name: string): string {
  const parts = (name || "")
    .split(/[ ·]+/)
    .filter((x) => /^[A-Z]/.test(x))
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
  return parts || "—";
}

/* ────────────────────────────────────────────────────────────────────────────
   Departments
   ──────────────────────────────────────────────────────────────────────── */

/** `srcLabel` — prototype 19954. */
export function deptSrcLabel(src: "group" | "attribute"): string {
  return src === "group" ? "Set by group" : "From the attribute";
}
