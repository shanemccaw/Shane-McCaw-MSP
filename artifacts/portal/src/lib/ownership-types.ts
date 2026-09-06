/**
 * Wire types for the customer-facing Ownership / RACI read surface (#3040,
 * Feature #1491).
 *
 * Mirrored verbatim from the real route's own interfaces — see
 * `docs/ownership-raci-contract-pack.md` §1a/§1b/§2/§3 and
 * `artifacts/api-server/src/lib/portal-ownership.ts` /
 * `artifacts/api-server/src/routes/portal-ownership.ts`. This module has no
 * shared wire-types package to import from (each `artifacts/*` app is its own
 * independent Vite/Node app), so these are a local copy, not a redeclaration
 * of a different shape.
 *
 * This build (#3040) wires ONLY `GET /api/portal/ownership` (surface A). The
 * five write routes + the per-cell event log (surface B, contract pack §1b)
 * are sibling issue #3041's scope — nothing here should be read as claiming
 * those are wired.
 */

/** The four names, in the matrix's own column order. */
export type OwnRoleKey = "r" | "a" | "c" | "i";

/** The eight object types the matrix groups by. */
export type OwnObjectType =
  | "service"
  | "change"
  | "cr"
  | "control"
  | "freeze"
  | "incident"
  | "announce"
  | "workload";

export interface WireOwnPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** The customer's own name, "MSP", or "External" — see `sidesFor`. */
  readonly side: string;
  readonly kind: "Person" | "Group" | "Vendor";
  /** A return date, or "" for available. No column records this yet. */
  readonly away: string;
  /** Another person's id, or "" for no cover. No column records this yet. */
  readonly deputy: string;
}

export interface WireOwnObject {
  readonly type: OwnObjectType;
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly r: string;
  readonly a: string;
  readonly c: string;
  readonly i: string;
  readonly svc?: string;
  readonly when?: string;
  readonly over?: boolean;
  readonly link: string;
}

/**
 * Which object types this route can answer for, and why the others are
 * absent. Sent on the wire so the page can state the limit in the same
 * breath as the data, rather than leaving a silently missing group.
 */
export interface WireOwnSource {
  readonly type: OwnObjectType;
  readonly live: boolean;
  readonly count: number;
  readonly note: string;
}

/** One saved assignment — a cell's current holder, per contract pack §1b. */
export interface WireOwnAssignment {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly acceptance: string;
  readonly setBy: string;
  readonly setAt: string;
  readonly setWhy: string;
  readonly order: number;
  readonly respondedBy: string;
  readonly respondedAt: string;
  readonly declineReason: string;
}

/** One stored handover as the wire shape the overlay sends. */
export interface WireOwnDelegation {
  readonly fromPersonId: string;
  readonly toPersonId: string;
  readonly until: string;
  readonly scope: string;
  readonly done: boolean;
}

/** One customer-added row as the wire shape the overlay sends. */
export interface WireOwnRow {
  readonly rowId: string;
  readonly source: string;
  readonly objType: string;
  readonly name: string;
  readonly sub: string;
}

/**
 * The whole write overlay for one customer — seeded into surface A's own
 * payload so a reload shows real saved state, not memory. Reading and
 * displaying this is in #3040's scope even though *writing* it (the five
 * routes in contract pack §1b) is #3041's.
 */
export interface WireOwnershipOverlay {
  readonly assignments: readonly WireOwnAssignment[];
  readonly delegations: readonly WireOwnDelegation[];
  readonly rows: readonly WireOwnRow[];
}

export interface WireOwnershipPayload {
  readonly customer: { readonly id: number; readonly name: string };
  readonly sides: readonly string[];
  readonly people: readonly WireOwnPerson[];
  readonly objects: readonly WireOwnObject[];
  readonly sources: readonly WireOwnSource[];
  readonly currentUserId: string;
  readonly currentUserName: string;
  readonly tenantScoped: boolean;
  readonly overlay: WireOwnershipOverlay;
  readonly gateMode: "strict" | "loose";
}

export interface ApiErrorBody {
  readonly error?: { readonly message?: string } | string;
  readonly code?: string;
}

/** The row's link label — copy taken from the design (`OWN_LINK_LABEL`). */
export const OWN_LINK_LABEL: Readonly<Record<OwnObjectType, string>> = {
  service: "Changes →",
  change: "Notice →",
  cr: "CR →",
  control: "Control →",
  freeze: "Freeze →",
  incident: "Incident →",
  announce: "Notice →",
  workload: "Workload →",
};

/** Display order + short label for the four groups the matrix always shows. */
export const OWN_ROLE_KEYS: readonly { readonly key: OwnRoleKey; readonly letter: string; readonly word: string }[] = [
  { key: "r", letter: "R", word: "Responsible" },
  { key: "a", letter: "A", word: "Accountable" },
  { key: "c", letter: "C", word: "Consulted" },
  { key: "i", letter: "I", word: "Informed" },
];

/** Group label + accent per object type, in the source's own fixed order. */
export const OWN_TYPE_LABEL: Readonly<Record<OwnObjectType, string>> = {
  workload: "Workloads",
  service: "Services",
  change: "Microsoft changes",
  cr: "Change requests",
  freeze: "Hold windows",
  control: "Controls",
  incident: "Incidents",
  announce: "Announcements",
};
