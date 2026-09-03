/**
 * portal-ownership.ts — the mapping layer behind `GET /api/portal/ownership`.
 *
 * Everything here is pure: rows in, wire objects out, no database and no
 * express. That split exists so the part that decides WHAT A CUSTOMER SEES is
 * unit-testable without a tenant, which matters more than usual on this route
 * because most of what it returns is an absence rather than a value.
 *
 * ── The one fact that shapes this whole file: there is no RACI table ────────
 * The Ownership matrix asks four questions of every object — who is
 * Responsible, Accountable, Consulted, Informed. The schema answers at most two
 * of them, and only for change requests:
 *
 *   • `msp_change_requests.requested_by` — the person who raised it. That is a
 *     real Responsible name and it is used as one.
 *   • `msp_change_requests.approved_by` — the person who signed it. That is a
 *     real Accountable name, and it is NULL until someone signs, which is a
 *     real gap rather than a missing feature.
 *
 * Nothing else records a name at all. An `information_schema.columns` sweep of
 * the public schema for `%owner%` / `%assigned%` / `%responsib%` returns only
 * `kanban_tasks.assigned_to`, `opportunity_tasks.assigned_to`,
 * `msp_documents.owner_type`, `outbound_webhooks.owner_type`,
 * `ai_usage_events.cost_owner` and three MSP-side escalation/assignment
 * columns — none of them about these objects, none of them customer-facing.
 *
 * So the honest shape of this route is: REAL ROWS, REAL PEOPLE, and the two
 * REAL NAMES above. Every other cell comes back as `""`, which the page already
 * has a word for — a gap — and already makes loud. That is not the route
 * degrading: a cell nothing has ever assigned IS unassigned, and saying so is
 * the entire argument the page makes.
 *
 * ── Consulted and Informed are never guessed ───────────────────────────────
 * It would be easy to fill `c` with "the MSP" and `i` with "everyone else" and
 * produce a page with no gaps on it. That would be inventing an agreement
 * nobody made: Consulted means asked before the window opens, and no row in
 * this database says anyone was. They stay empty until something records them.
 *
 * ── The MSP is available, never assigned by default (#1520) ────────────────
 * A customer's MSP is available to every one of that customer's cells, by
 * virtue of being their MSP — never placed into one by default. There is no
 * MSP template, no standard position, no per-customer override: the customer
 * decides placement entirely, and every placement (R on everything, A on
 * everything, nowhere at all) is equally valid.
 *
 * "Available" means MSP staff (`usersTable` rows scoped by the customer's
 * `tenants.mspId` rather than by `tenantId`, with `mspRole` MSPAdmin or
 * MSPOperator) appear in `people` as real named individuals with
 * `side: "MSP"` — the same `toWirePerson` shape a customer's own team gets,
 * just a different roster. They start on no cell; a customer places one by
 * assigning them like anyone else on the roster. There is deliberately no
 * separate "the MSP" pseudo-person: that would be a fabricated entity with no
 * row behind it, which is exactly what this file exists to refuse to do.
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

/**
 * The row's link label. This is COPY, taken from the design, which is why it is
 * sent from here rather than re-derived in the component.
 */
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

/** The separator the design puts between facts on a row's sub-line. */
const DOT = " · ";

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
 * Which object types this route can answer for, and why the others are absent.
 * Sent on the wire so the page can state the limit in the same breath as the
 * data, rather than leaving a silently missing group.
 */
export interface WireOwnSource {
  readonly type: OwnObjectType;
  readonly live: boolean;
  readonly count: number;
  readonly note: string;
}

/**
 * The `side` values, with the customer's REAL name where the design fixture
 * says "Halden". `side` is rendered verbatim beside a person ("Priya Raman ·
 * IT Manager · Halden"), so leaving the fixture's fictional company name on a
 * real person's row would be a tenant fact invented in the UI layer.
 */
export function sidesFor(customerName: string): readonly string[] {
  const own = customerName.trim() || "Your organisation";
  return [own, "MSP", "External"];
}

/**
 * A person id that cannot collide with the design fixture's ids ("priya",
 * "dan", "desk") — both can be on screen in the same session, because the
 * fallback list renders until the fetch lands.
 */
export function personIdForUser(userId: number): string {
  return "u" + String(userId);
}

/**
 * What to print where the design prints a job title.
 *
 * `users.job_title` and `users.department` are both real columns and both
 * usually NULL — no signup path fills them. The portal role is the only thing
 * always present, so it is the last resort, phrased as what it means to a
 * reader rather than as its enum spelling.
 */
export function personRoleLabel(
  jobTitle: string | null,
  department: string | null,
  mspRole: string | null,
): string {
  const title = (jobTitle ?? "").trim();
  if (title) return title;
  const dept = (department ?? "").trim();
  if (dept) return dept;
  switch ((mspRole ?? "").trim()) {
    case "CustomerUser":
      return "Team member";
    case "Assessment":
      return "Assessment access";
    case "Free":
      return "Free account";
    case "ServiceAccount":
      return "Service account";
    case "MSPAdmin":
      return "MSP Admin";
    case "MSPOperator":
      return "MSP Operator";
    default:
      return "Team member";
  }
}

export interface UserRow {
  readonly id: number;
  readonly email: string;
  readonly name: string | null;
  readonly jobTitle: string | null;
  readonly department: string | null;
  readonly mspRole: string | null;
}

/**
 * A real user as the matrix's people list wants them.
 *
 * `away` and `deputy` are "" because nothing records either. The prototype
 * stores a RETURN DATE in `away` rather than a boolean, so "" is its own word
 * for available — not a null standing in for one.
 */
export function toWirePerson(row: UserRow, side: string): WireOwnPerson {
  return {
    id: personIdForUser(row.id),
    name: (row.name ?? "").trim() || row.email,
    role: personRoleLabel(row.jobTitle, row.department, row.mspRole),
    side,
    kind: "Person",
    away: "",
    deputy: "",
  };
}

/** Lowercased email → person id, for `resolvePersonId`. */
export function emailIndex(rows: readonly UserRow[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.email.toLowerCase(), personIdForUser(row.id));
  return map;
}

/**
 * Resolves a stored name-or-email to a person id, or "" when it matches nobody.
 *
 * `msp_change_requests.requested_by` is free text and holds an email in every
 * live row, but nothing constrains it to one, so a display name is matched too.
 * A value matching no current user resolves to "" — a gap — rather than being
 * minted into a person who is not on the team: the people list is the tenant's
 * real roster, and a matrix cell naming someone absent from it would be
 * unactionable, which is worse than an honest blank.
 */
export function resolvePersonId(
  stored: string | null,
  people: readonly WireOwnPerson[],
  emails: ReadonlyMap<string, string>,
): string {
  const value = (stored ?? "").trim();
  if (!value) return "";
  const byEmail = emails.get(value.toLowerCase());
  if (byEmail) return byEmail;
  const lower = value.toLowerCase();
  const byName = people.find((p) => p.name.toLowerCase() === lower);
  return byName ? byName.id : "";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "6 November 2026" — the shape the design uses for a change's `when`
 * (Ownership.dc.html: "1 October 2026"). Deliberately not locale-dependent:
 * the design's format is the specification, and a locale-shifted date on one
 * tenant's screen and not another's is a difference nobody asked for.
 */
export function formatOwnDate(value: Date | string | null): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return String(d.getUTCDate()) + " " + MONTHS[d.getUTCMonth()] + " " + String(d.getUTCFullYear());
}

export interface ChangeRequestRow {
  readonly id: number;
  readonly title: string;
  readonly status: string;
  readonly scheduledFor: string | null;
  readonly requestedBy: string | null;
  readonly approvedBy: string | null;
}

/**
 * A change request as a matrix row.
 *
 * `r` and `a` are the only two cells in this entire route that come from a
 * stored name. `c` and `i` are empty for the reason in the header.
 */
export function crObject(
  row: ChangeRequestRow,
  code: string,
  statusLabel: string,
  responsible: string,
  accountable: string,
): WireOwnObject {
  const window = (row.scheduledFor ?? "").trim();
  return {
    type: "cr",
    id: code,
    name: row.title,
    sub: window ? statusLabel + DOT + window : statusLabel,
    r: responsible,
    a: accountable,
    c: "",
    i: "",
    link: OWN_LINK_LABEL.cr,
  };
}

export interface MessageCentreRow {
  readonly graphMessageId: string;
  readonly title: string;
  readonly category: string | null;
  readonly isMajorChange: boolean;
  readonly services: readonly string[] | null;
  readonly actionRequiredByDateTime: Date | string | null;
}

/**
 * A Microsoft change as a matrix row.
 *
 * The route asks only for items whose action-required date is still in the
 * FUTURE — 15 of this tenant's 501 stored items. That is the honest reading of
 * what belongs on an ownership matrix: a notice with a deadline nobody owns is
 * exactly what the page exists to surface, whereas a shipped or expired notice
 * has no decision left to assign to anyone.
 */
export function messageCentreObject(row: MessageCentreRow): WireOwnObject {
  const service = (row.services ?? [])[0] ?? "";
  const parts: string[] = [];
  if (service) parts.push(service);
  if (row.isMajorChange) parts.push("Major change");
  else if ((row.category ?? "").trim()) parts.push(String(row.category).trim());
  return {
    type: "change",
    id: row.graphMessageId,
    name: row.title,
    sub: parts.join(DOT),
    when: formatOwnDate(row.actionRequiredByDateTime),
    r: "",
    a: "",
    c: "",
    i: "",
    link: OWN_LINK_LABEL.change,
  };
}

export interface ClientServiceRow {
  readonly id: number;
  readonly name: string | null;
  readonly status: string | null;
  readonly nextMilestone: string | null;
}

/** A purchased service as a matrix row. */
export function serviceObject(row: ClientServiceRow): WireOwnObject {
  const status = (row.status ?? "").trim();
  const milestone = (row.nextMilestone ?? "").trim();
  const parts: string[] = [];
  if (status) parts.push(status.charAt(0).toUpperCase() + status.slice(1));
  if (milestone) parts.push(milestone);
  return {
    type: "service",
    id: "svc-" + String(row.id),
    name: (row.name ?? "").trim() || "Service " + String(row.id),
    sub: parts.join(DOT),
    r: "",
    a: "",
    c: "",
    i: "",
    link: OWN_LINK_LABEL.service,
  };
}

export interface WorkloadRow {
  /** The workload bucket key from tenant-workloads.ts (e.g. "exchange"). */
  readonly key: string;
  readonly label: string;
  /** The real Microsoft servicePlanName(s) enabled on the tenant behind this row. */
  readonly servicePlanNames: readonly string[];
}

/**
 * A real enabled M365 workload as a matrix row (Git #2008). Unlike every
 * other object type here, this one is not scoped to what the customer
 * purchased — it is scoped to what the tenant's own `subscribedSkus` says is
 * genuinely running, per #1523's settled rule. `sub` names the real service
 * plan(s) behind the row rather than inventing further description.
 */
export function workloadObject(row: WorkloadRow): WireOwnObject {
  return {
    type: "workload",
    id: "wl-" + row.key,
    name: row.label,
    sub: row.servicePlanNames.join(DOT),
    r: "",
    a: "",
    c: "",
    i: "",
    link: OWN_LINK_LABEL.workload,
  };
}

export interface HoldWindowRow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string | null;
}

/**
 * An open hold window as a `freeze` row.
 *
 * The mapping is stated rather than assumed: the design's `freeze` type is a
 * change freeze ("Quarter close", "Year end freeze"), and a portal hold window
 * is a period during which a runbook step is deliberately not actioned. Both
 * are "a window in which we have agreed not to change this", which is the thing
 * the matrix asks someone to be answerable for. Closed windows are excluded —
 * there is nothing left to own.
 */
export function holdWindowObject(row: HoldWindowRow): WireOwnObject {
  return {
    type: "freeze",
    id: row.holdKey,
    name: row.title,
    sub: (row.gates ?? "").trim(),
    r: "",
    a: "",
    c: "",
    i: "",
    link: OWN_LINK_LABEL.freeze,
  };
}

/**
 * The per-type note the page can print. The three `live: false` types are the
 * ones the schema has nothing for; saying so beats a silently missing group.
 */
export function buildSources(
  counts: Readonly<Record<OwnObjectType, number>>,
): readonly WireOwnSource[] {
  return [
    { type: "workload", live: true, count: counts.workload, note: "Workloads enabled in your tenant's Microsoft 365 licensing." },
    { type: "service", live: true, count: counts.service, note: "Your purchased services." },
    { type: "change", live: true, count: counts.change, note: "Microsoft changes with an action still due." },
    { type: "cr", live: true, count: counts.cr, note: "Your change requests." },
    { type: "freeze", live: true, count: counts.freeze, note: "Your open hold windows." },
    { type: "control", live: false, count: 0, note: "No control register is stored yet." },
    { type: "incident", live: false, count: 0, note: "No incident record is stored yet." },
    { type: "announce", live: false, count: 0, note: "No announcement record is stored yet." },
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
   The WRITE overlay — the customer's own assignments, handovers and added rows.

   These are the shapes the matrix's mutations persist to, layered on top of the
   objects the read assembles. They are kept here, pure, for the same reason the
   read mappers are: what a customer's saved edit MEANS (a "" owner is an explicit
   gap, only r/a carry acceptance) is testable without a database.
   ──────────────────────────────────────────────────────────────────────────── */

/** The four role keys the matrix assigns against. */
export const OWN_ROLE_KEYS: readonly OwnRoleKey[] = ["r", "a", "c", "i"];

/** True only for one of the four role keys — the write routes' input guard. */
export function isOwnRoleKey(value: unknown): value is OwnRoleKey {
  return value === "r" || value === "a" || value === "c" || value === "i";
}

/**
 * The acceptance a freshly-set cell starts at. Setting a name starts the accept
 * clock (`pending`) ONLY when this customer's gate is "strict" (#2162, redo of
 * #1518 — the gate is now a per-customer Settings toggle, not universal).
 * Clearing to a gap carries none; Consulted/Informed never carry acceptance at
 * all — being told is not something you accept. In "loose" mode an R/A
 * assignment is effective immediately: "" is the same "no acceptance to
 * track" value C/I already use, not a null standing in for `pending`. This
 * mirrors the client's `acceptanceOf`, so a reload reads the same chip.
 */
export function initialAcceptance(
  ownerPersonId: string,
  roleKey: OwnRoleKey,
  gateMode: "strict" | "loose",
): string {
  if (!ownerPersonId) return "";
  if (roleKey === "c" || roleKey === "i") return "";
  return gateMode === "strict" ? "pending" : "";
}

/**
 * Whether an actor may accept/decline a given cell holder (#2162). #1518's
 * gate is that whoever is NAMED must agree themselves — so in strict mode the
 * actor must BE that holder, not merely a teammate on the same tenant (or,
 * cross-boundary, the same MSP). Loose mode has no acceptance step to gate,
 * so every actor passes. Both ids are wire person ids ("u{id}"), the same
 * identity scheme on both sides of the tenant boundary (#1592/#1759).
 */
export function actorMayRespond(
  gateMode: "strict" | "loose",
  ownerPersonId: string,
  actorPersonId: string,
): boolean {
  if (gateMode !== "strict") return true;
  return !!ownerPersonId && ownerPersonId === actorPersonId;
}

/** One stored cell as the wire shape the overlay sends. */
export interface WireOwnAssignment {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly acceptance: string;
  readonly setBy: string;
  readonly setAt: string;
  readonly setWhy: string;
  /**
   * Precedence within this (objectId, roleKey) cell — 0 is first/primary, 1 is
   * second, and so on (#1517). Informational only: every holder in a cell has
   * identical authority, and nothing reads this to activate, escalate or route
   * — it exists so the UI can render "primary / second / third" and so a
   * customer can reorder a cell (`POST /portal/ownership/reorder`) explicitly.
   */
  readonly order: number;
  /**
   * Who actually responded (accepted/declined) and when — text provenance,
   * same shape as `setBy`/`setAt` but a DIFFERENT party at a DIFFERENT moment
   * (#1519): `setBy` is who ASSIGNED the holder, `respondedBy` is the named
   * holder themselves agreeing or refusing. "" until the cell has been
   * responded to.
   */
  readonly respondedBy: string;
  readonly respondedAt: string;
  /**
   * Free-text reason for a decline (#1519) — a genuinely different field from
   * `setWhy` (the assigner's reason for setting the cell in the first place).
   * "" for every acceptance value other than "declined". Was being stored
   * since #2162 but never reached this wire shape until now, so a declined
   * cell's own "why" was unreadable by any client.
   */
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
 * The whole write overlay for one customer. The client seeds its assign /
 * acceptance / provenance / delegation / added-row state from this, so a reload
 * shows the real saved matrix rather than only what was in memory.
 */
export interface WireOwnershipOverlay {
  readonly assignments: readonly WireOwnAssignment[];
  readonly delegations: readonly WireOwnDelegation[];
  readonly rows: readonly WireOwnRow[];
}

export interface AssignmentRow {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string | null;
  readonly acceptance: string | null;
  readonly setBy: string | null;
  readonly setAt: string | null;
  readonly setWhy: string | null;
  readonly orderRank?: number | null;
  readonly respondedBy?: string | null;
  readonly respondedAt?: string | null;
  readonly declineReason?: string | null;
}

export function toWireAssignment(row: AssignmentRow): WireOwnAssignment {
  return {
    objectId: row.objectId,
    roleKey: row.roleKey,
    ownerPersonId: row.ownerPersonId ?? "",
    acceptance: row.acceptance ?? "",
    setBy: row.setBy ?? "",
    setAt: row.setAt ?? "",
    setWhy: row.setWhy ?? "",
    order: row.orderRank ?? 0,
    respondedBy: row.respondedBy ?? "",
    respondedAt: row.respondedAt ?? "",
    declineReason: row.declineReason ?? "",
  };
}

export interface DelegationRow {
  readonly fromPersonId: string;
  readonly toPersonId: string;
  readonly until: string;
  readonly scope: string | null;
  readonly done: boolean;
}

export function toWireDelegation(row: DelegationRow): WireOwnDelegation {
  return {
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    until: row.until,
    scope: row.scope ?? "all",
    done: row.done,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   The event log — the append-only history behind one cell holder (#1522).

   `portal_ownership_assignments` above is CURRENT STATE, overwritten in place on
   every re-assert. This is the record that survives the overwrite: every write
   route inserts an event here in the same transaction as its current-state
   write, and nothing ever updates or deletes a row.
   ──────────────────────────────────────────────────────────────────────────── */

/** The five things that can happen to one cell holder — nothing else is recorded. */
export type OwnEventType = "assigned" | "accepted" | "declined" | "cleared" | "reassigned";

/** One append-only event as the wire shape the history endpoint sends. */
export interface WireOwnEvent {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly eventType: OwnEventType;
  readonly actor: string;
  readonly reason: string;
  readonly at: string;
}

export interface OwnEventRow {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly eventType: string;
  readonly actor: string;
  readonly reason: string;
  readonly createdAt: Date | string;
}

export function toWireEvent(row: OwnEventRow): WireOwnEvent {
  return {
    objectId: row.objectId,
    roleKey: row.roleKey,
    ownerPersonId: row.ownerPersonId,
    eventType: row.eventType as OwnEventType,
    actor: row.actor,
    reason: row.reason,
    at: formatOwnDate(row.createdAt),
  };
}

/**
 * Which event an assign write represents, given whether this exact
 * (customer, object, role, owner) row already existed. An empty `ownerPersonId`
 * is always `cleared` — declaring a gap — regardless of whether the gap row
 * itself is new or being re-asserted; a non-empty owner is `assigned` the first
 * time that holder appears in the cell and `reassigned` on every re-assert
 * after (the same holder's provenance being overwritten).
 */
export function assignEventType(ownerPersonId: string, rowAlreadyExisted: boolean): OwnEventType {
  if (!ownerPersonId) return "cleared";
  return rowAlreadyExisted ? "reassigned" : "assigned";
}

export interface OwnRowRecord {
  readonly rowId: string;
  readonly source: string;
  readonly objType: string | null;
  readonly name: string | null;
  readonly sub: string | null;
}

export function toWireRow(row: OwnRowRecord): WireOwnRow {
  return {
    rowId: row.rowId,
    source: row.source,
    objType: row.objType ?? "",
    name: row.name ?? "",
    sub: row.sub ?? "",
  };
}
