/**
 * ownershipData.ts — the Ownership matrix fixture.
 *
 * Transcribed from 'Ownership.dc.html', which is a NEW file in this handoff
 * round: the round-one bundle had no Ownership module and no RACI anywhere —
 * `Responsible`/`Accountable` return ZERO hits in the round-one shell. So this
 * is a first build, not a port of anything we had.
 *
 *   • `TYPES`      — Ownership.dc.html 620-628 → OBJECT_TYPES
 *   • `OBJECTS`    — 630-660               → OWN_OBJECTS
 *   • `ROLE_KEYS`  — 712-717               → ROLE_KEYS
 *   • `MISSING`    — 613-618               → MISSING_OBJECTS
 *   • `PROV`       — 592-598               → PROVENANCE / PROVENANCE_DEFAULT
 *   • `ACC`        — 600-603               → PENDING_ACCEPTANCE
 *   • `ESC`        — 608                   → ESCALATION_DAYS
 *   • `RISK`       — 850-856               → GAP_RISK
 *
 * ── What the module argues ─────────────────────────────────────────────────
 * Four names against every object, and the page's whole job is to make the
 * MISSING ones loud. Its five counters lead with gaps, duty conflicts and
 * overload before it ever shows a total, and the matrix tints any row with a
 * gap amber. A row is not "done" when it has an owner — it is done when it has
 * four, none of them the same person doing and approving, and none of them a
 * group where the design says one person.
 *
 * ── Design content, not tenant data ────────────────────────────────────────
 * The prototype's fictional Halden Materials estate.
 */

import type { OwnPerson } from "./settingsData";

/* ────────────────────────────────────────────────────────────────────────────
   The four names
   ──────────────────────────────────────────────────────────────────────── */

export type RoleKey = "r" | "a" | "c" | "i";

export interface RoleDef {
  k: RoleKey;
  label: string;
  tone: string;
  /** The definition shown in the legend and in Settings' role key. */
  def: string;
}

/** Ownership.dc.html 712-717. Order is the matrix's column order. */
export const ROLE_KEYS: readonly RoleDef[] = [
  { k: "r", label: "Responsible", tone: "#f87171", def: "Does the work. One name, never a group." },
  { k: "a", label: "Accountable", tone: "#fbbf24", def: "Answers for it afterwards, and approves it beforehand." },
  { k: "c", label: "Consulted", tone: "#60a5fa", def: "Asked before the window opens, not told after it closes." },
  { k: "i", label: "Informed", tone: "#a78bfa", def: "Told once it is done, in language they use." },
];

/* ────────────────────────────────────────────────────────────────────────────
   Object types — these are also the shell sub-nav's eight entries
   ──────────────────────────────────────────────────────────────────────── */

export type ObjectTypeKey =
  | "service"
  | "change"
  | "cr"
  | "control"
  | "freeze"
  | "incident"
  | "announce";

export interface ObjectTypeDef {
  key: ObjectTypeKey;
  label: string;
  tone: string;
}

/** Ownership.dc.html 620-628. */
export const OBJECT_TYPES: readonly ObjectTypeDef[] = [
  { key: "service", label: "Microsoft services", tone: "#2dd4bf" },
  { key: "change", label: "Individual changes", tone: "#60a5fa" },
  { key: "cr", label: "Change requests", tone: "#0078D4" },
  { key: "control", label: "Compliance controls", tone: "#a78bfa" },
  { key: "freeze", label: "Freeze windows", tone: "#f87171" },
  { key: "incident", label: "Incidents", tone: "#fb923c" },
  { key: "announce", label: "Announcements", tone: "#fbbf24" },
];

/**
 * The singular noun each type shows on a gap/coverage row — Ownership.dc.html
 * 847 and 878. NOT the same strings as the plural `OBJECT_TYPES[].label`, which
 * is why it is its own map rather than a derivation.
 */
export const TYPE_SINGULAR: Readonly<Record<ObjectTypeKey, string>> = {
  service: "Service",
  change: "Change",
  cr: "Change request",
  control: "Control",
  freeze: "Freeze",
  incident: "Incident",
  announce: "Announcement",
};

/* ────────────────────────────────────────────────────────────────────────────
   The estate
   ──────────────────────────────────────────────────────────────────────── */

export interface OwnObject {
  type: ObjectTypeKey;
  id: string;
  name: string;
  sub: string;
  /** Person ids, or "" for a gap. These are the four RACI cells. */
  r: string;
  a: string;
  c: string;
  i: string;
  /** Present on `change` rows only — the service the change lands on. */
  svc?: string;
  when?: string;
  /** A change that OVERRIDES its service's owner rather than inheriting. */
  over?: boolean;
  link: string;
}

/**
 * Ownership.dc.html 630-660.
 *
 * The prototype's `href` field is dropped: every value is a sibling
 * `.dc.html` filename ("Change Control.dc.html" / "Microsoft Changes.dc.html"),
 * which is prototype plumbing, not a spec. `link` — the visible label, "CR →" /
 * "Notice →" / "Changes →" — is kept, because it is copy.
 *
 * Note the deliberate gaps, which are the whole point of the page: `svc-copilot`
 * has no Responsible, `CR-0149` no Accountable, `RSK-004` no Responsible,
 * `ANN-share` no Accountable, `ANN-copilot` no Responsible, `ANN-teams-recap`
 * no Informed.
 */
export const OWN_OBJECTS: readonly OwnObject[] = [
  { type: "service", id: "svc-exo", name: "Exchange Online & Apps", sub: "1,240 mailboxes · 11 on legacy auth", r: "priya", a: "dan", c: "shane", i: "desk", link: "Changes →" },
  { type: "service", id: "svc-teams", name: "Microsoft Teams", sub: "1,240 users · 3 meeting policies", r: "priya", a: "dan", c: "jo", i: "desk", link: "Changes →" },
  { type: "service", id: "svc-spo", name: "SharePoint & OneDrive", sub: "212 libraries · 84 anonymous links a month", r: "marcus", a: "dan", c: "ruth", i: "desk", link: "Changes →" },
  { type: "service", id: "svc-entra", name: "Entra ID", sub: "2 admin accounts without MFA", r: "shane", a: "dan", c: "priya", i: "aisha", link: "Changes →" },
  { type: "service", id: "svc-purview", name: "Purview", sub: "6 retention labels in use", r: "aisha", a: "court", c: "shane", i: "desk", link: "Changes →" },
  { type: "service", id: "svc-copilot", name: "Copilot", sub: "No licences assigned · pilot only", r: "", a: "dan", c: "shane", i: "priya", link: "Changes →" },

  { type: "change", id: "MC1042318", name: "Basic authentication disabled", sub: "Overrides Exchange · Bay 3 scanners", svc: "svc-exo", when: "1 October 2026", r: "marcus", a: "dan", c: "shane", i: "desk", over: true, link: "Notice →" },
  { type: "change", id: "MC1049877", name: "Default sharing link changes", sub: "Overrides SharePoint · Sales tenders", svc: "svc-spo", when: "22 September 2026", r: "marcus", a: "priya", c: "ruth", i: "jo", over: true, link: "Notice →" },
  { type: "change", id: "MC1051144", name: "Anonymous meeting join flips", sub: "Inherits Microsoft Teams", svc: "svc-teams", when: "26 September 2026", r: "priya", a: "dan", c: "jo", i: "desk", link: "Notice →" },
  { type: "change", id: "MC1054920", name: "MFA required on admin portals", sub: "Inherits Entra ID", svc: "svc-entra", when: "15 November 2026", r: "shane", a: "dan", c: "priya", i: "aisha", link: "Notice →" },

  { type: "cr", id: "CR-0142", name: "Disable legacy auth ahead of Microsoft", sub: "Awaiting approval · window 25 August", r: "marcus", a: "dan", c: "shane", i: "desk", link: "CR →" },
  { type: "cr", id: "CR-0149", name: "Pin the tenant sharing default", sub: "Draft · opt-out closes 18 September", r: "marcus", a: "", c: "ruth", i: "jo", link: "CR →" },
  { type: "cr", id: "CR-0136", name: "Confidential label rollout", sub: "Closed 30 July · 3 libraries left restricted", r: "aisha", a: "court", c: "shane", i: "desk", link: "CR →" },

  { type: "control", id: "CMP-011", name: "External access · anonymous join", sub: "Cited by MC1051144", r: "aisha", a: "dan", c: "shane", i: "court", link: "Control →" },
  { type: "control", id: "ISO-A942", name: "ISO 27001 A.9.4.2 · secure log-on", sub: "Cited by MC1042318, MC1054920", r: "aisha", a: "court", c: "shane", i: "dan", link: "Control →" },
  { type: "control", id: "CE-AUTH", name: "Cyber Essentials Plus · authentication", sub: "Assessment due November", r: "shane", a: "shane", c: "aisha", i: "court", link: "Control →" },
  { type: "control", id: "RSK-004", name: "Break-glass account procedure", sub: "Must be updated before 15 November", r: "", a: "dan", c: "shane", i: "aisha", link: "Control →" },

  { type: "freeze", id: "FRZ-Q3", name: "Quarter close", sub: "29 – 30 September · Microsoft ships through it", r: "priya", a: "dan", c: "aisha", i: "desk", link: "Freeze →" },
  { type: "freeze", id: "FRZ-YE", name: "Year end freeze", sub: "22 December – 2 January", r: "priya", a: "dan", c: "ruth", i: "desk", link: "Freeze →" },

  { type: "incident", id: "INC-2291", name: "Invoice export failed for two days", sub: "July wave · EWS throttling", r: "marcus", a: "priya", c: "shane", i: "dan", link: "Incident →" },
  { type: "incident", id: "INC-2274", name: "Meeting chat permissions surprise", sub: "Closed · 14 tickets in three days", r: "desk", a: "dan", c: "jo", i: "desk", link: "Incident →" },

  { type: "announce", id: "ANN-teams-recap", name: "Teams toolbar and recap tab", sub: "Lands 21 September · not sent", r: "jo", a: "priya", c: "desk", i: "", link: "Notice →" },
  { type: "announce", id: "ANN-share", name: "Share dialog looks different", sub: "Lands 22 September · not sent", r: "jo", a: "", c: "ruth", i: "desk", link: "Notice →" },
  { type: "announce", id: "ANN-copilot", name: "Copilot button appears in Teams", sub: "Lands 6 October · not sent", r: "", a: "priya", c: "shane", i: "desk", link: "Notice →" },
];

/* ────────────────────────────────────────────────────────────────────────────
   Things with no row at all
   ──────────────────────────────────────────────────────────────────────── */

export interface MissingObject {
  id: string;
  type: "change" | "cr" | "control";
  name: string;
  why: string;
}

/**
 * Ownership.dc.html 613-618 — the "not in the matrix" counter's list.
 *
 * These are NOT gaps. A gap is a row missing a name; these have no row, so
 * nothing routes for them at all, which the page treats as the worse state and
 * gives its own counter and its own blue panel.
 */
export const MISSING_OBJECTS: readonly MissingObject[] = [
  {
    id: "MC1057733",
    type: "change",
    name: "Retention labels move to the new Purview portal",
    why: "Lands in October and has no row, so no name is on it at all.",
  },
  {
    id: "MC1063118",
    type: "change",
    name: "Semantic index becomes a Copilot prerequisite",
    why: "December. Copilot has no responsible owner either, so this is a gap on a gap.",
  },
  {
    id: "CR-0151",
    type: "cr",
    name: "Register MFA on both break-glass accounts",
    why: "Raised yesterday from MC1054920. Nothing routes until it has a row.",
  },
  {
    id: "CMP-004",
    type: "control",
    name: "Compliance finding CMP-004 · external sharing",
    why: "Cited by the sharing change on 22 September and owned by nobody.",
  },
];

/**
 * Per-object gap copy — Ownership.dc.html 850-856.
 *
 * Five objects get a written consequence; every other gap falls back to the
 * generated "No responsible or informed named." sentence. Keeping the fallback
 * generated rather than authoring 24 sentences is the prototype's own choice.
 */
export const GAP_RISK: Readonly<Record<string, string>> = {
  "svc-copilot": "Every Copilot change lands with nobody to action it, and the pilot group has no route to ask.",
  "CR-0149": "Cannot be approved. The sharing opt-out closes on 18 September whether or not it is.",
  "RSK-004": "MFA is enforced on admin portals on 15 November. Nobody is updating the break-glass procedure.",
  "ANN-share": "The change lands 22 September. Nobody signs off the wording, so nobody sends it.",
  "ANN-copilot": "A button appears in every Teams chat on 6 October and no announcement is owned.",
};

/* ────────────────────────────────────────────────────────────────────────────
   Provenance, acceptance and the escalation clock
   ──────────────────────────────────────────────────────────────────────── */

export interface Provenance {
  by: string;
  at: string;
  why: string;
  from: string;
}

/** Ownership.dc.html 591. Every cell falls back to this. */
export const PROVENANCE_DEFAULT: Provenance = {
  by: "Shane McCaw",
  at: "12 Aug 2026",
  why: "Initial matrix, built from the tenant scan",
  from: "12 Aug 2026",
};

/** Ownership.dc.html 592-598, keyed `${objectId}:${roleKey}`. */
export const PROVENANCE: Readonly<Record<string, Provenance>> = {
  "svc-copilot:a": { by: "Dan Whitlock", at: "3 Aug 2026", why: "Took it himself until the pilot has an owner", from: "3 Aug 2026" },
  "MC1042318:r": { by: "Priya Raman", at: "13 Aug 2026", why: "Marcus owns the Bay 3 hardware, so he owns this one, not Exchange as a whole", from: "13 Aug 2026" },
  "MC1049877:r": { by: "Priya Raman", at: "18 Aug 2026", why: "Sales tenders are the only thing affected and Marcus holds the tenant setting", from: "1 Sep 2026" },
  "CR-0142:a": { by: "Priya Raman", at: "18 Aug 2026", why: "Raised for the 25 August window — Dan approves anything that touches authentication", from: "18 Aug 2026" },
  "svc-entra:r": { by: "Priya Raman", at: "19 Aug 2026", why: "Break-glass work sits with the architect while MFA enforcement is open", from: "19 Aug 2026" },
};

/**
 * Cells where the named person has NOT yet accepted — Ownership.dc.html 600-603.
 * Everything else with a name counts as accepted (`accOf`, 741-746).
 * Consulted and Informed never carry acceptance at all.
 */
export const PENDING_ACCEPTANCE: readonly string[] = [
  "svc-entra:r",
  "MC1049877:r",
  "CR-0142:a",
  "svc-copilot:a",
  "ANN-teams-recap:r",
];

/**
 * Days with no movement, keyed `${objectId}:${roleKey}` — Ownership.dc.html 608.
 * A cell is LATE when this exceeds the escalation threshold set in
 * Settings → Ownership routing, which is why the number lives there and the
 * comparison lives in the model rather than in this fixture.
 */
export const ESCALATION_DAYS: Readonly<Record<string, number>> = {
  "CR-0142:a": 7,
  "ANN-teams-recap:r": 6,
  "MC1049877:r": 3,
};

/* ────────────────────────────────────────────────────────────────────────────
   Review state
   ──────────────────────────────────────────────────────────────────────── */

/** Ownership.dc.html 563 — `reviewedAt` / `reviewDue`. */
export const MATRIX_REVIEWED_AT = "12 Aug 2026";
export const MATRIX_REVIEW_DUE_DAYS = 82;

/** The threshold below which the review line turns amber — 1154. */
export const MATRIX_REVIEW_WARN_DAYS = 14;

/** Ownership.dc.html 581 — the signed-in customer in the prototype. */
export const CURRENT_USER = "Priya Raman";

/** Re-exported so a caller does not have to know people live in settingsData. */
export type { OwnPerson };
