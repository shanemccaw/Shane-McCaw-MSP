/**
 * ownershipWire.ts — the seam between `GET /api/portal/ownership` and the
 * Ownership matrix's own types.
 *
 * The endpoint already speaks the page's shapes, so this file is small on
 * purpose. What it exists for is the three decisions that should not live in a
 * component or in a fetch hook:
 *
 *   1. WHICH SOURCE IS ON SCREEN. The design's fixture stays as the fallback —
 *      a failed or unscoped read renders the prototype's own estate rather than
 *      an empty matrix — and `dataState` says which of the two a reader is
 *      looking at, so nothing has to infer it from a row count.
 *   2. WHAT COUNTS AS A USABLE PAYLOAD. A live read that resolves to zero
 *      objects is NOT treated as live: an empty matrix and a broken matrix look
 *      identical on screen, and the fixture is the more useful of the two
 *      wrong answers to show while a tenant has nothing to own yet.
 *   3. TRUSTING THE WIRE NO FURTHER THAN ITS SHAPE. Everything is validated
 *      structurally before it becomes an `OwnObject`, because a field this page
 *      renders into a matrix cell arriving as `undefined` would read as a gap —
 *      i.e. as a real statement about ownership — rather than as a bad payload.
 *
 * ── What is real once this lands, and what is not ──────────────────────────
 * Real: the matrix ROWS (the tenant's purchased services, their Microsoft
 * changes with an action still due, their change requests, their open hold
 * windows), the PEOPLE list, and the Responsible/Accountable names on a change
 * request — the requester and the approver, which are the only two owner names
 * the database stores for anything.
 *
 * Not real, and deliberately not faked: Consulted and Informed on every row,
 * and Responsible/Accountable on everything that is not a change request. There
 * is no ownership/RACI table in the schema (see the api-server route's header
 * for the sweep that establishes it), so those cells arrive as gaps and the
 * page counts them as gaps. Provenance, acceptance, escalation clocks,
 * delegation, prior holders and the "not in the matrix" list stay on the
 * design's fixtures — they describe assignments that have nowhere to be stored.
 */

import type { ObjectTypeKey, OwnObject } from "./ownershipData";
import { OBJECT_TYPES, OWN_OBJECTS } from "./ownershipData";
import { OWN_PEOPLE_SEED, OWN_SIDES, type OwnPerson } from "./settingsData";

/** Which of the two sources the page is currently rendering. */
export type OwnDataState = "loading" | "live" | "fixture";

export interface WireOwnSource {
  readonly type: string;
  readonly live: boolean;
  readonly count: number;
  readonly note: string;
}

export interface WireOwnershipPayload {
  readonly customer?: { readonly id?: number; readonly name?: string };
  readonly sides?: readonly string[];
  readonly people?: readonly unknown[];
  readonly objects?: readonly unknown[];
  readonly sources?: readonly WireOwnSource[];
  readonly currentUserId?: string;
  readonly currentUserName?: string;
  readonly tenantScoped?: boolean;
}

/** The page's whole data surface, from whichever source supplied it. */
export interface OwnershipData {
  readonly people: readonly OwnPerson[];
  readonly objects: readonly OwnObject[];
  readonly sides: readonly string[];
  readonly sources: readonly WireOwnSource[];
  readonly customerName: string;
  readonly currentUserName: string;
  readonly tenantScoped: boolean;
}

const TYPE_KEYS = new Set<string>(OBJECT_TYPES.map((t) => t.key));

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One wire object as an `OwnObject`, or null if it is not one.
 *
 * `type` must be one of the seven the matrix groups by — `groupedByType` walks
 * OBJECT_TYPES, so a row carrying anything else would be silently dropped from
 * the matrix while still counting towards every total above it.
 */
export function toOwnObject(raw: unknown): OwnObject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = str(o.type);
  const id = str(o.id);
  const name = str(o.name);
  if (!TYPE_KEYS.has(type) || !id || !name) return null;
  const obj: OwnObject = {
    type: type as ObjectTypeKey,
    id,
    name,
    sub: str(o.sub),
    r: str(o.r),
    a: str(o.a),
    c: str(o.c),
    i: str(o.i),
    link: str(o.link) || "Open →",
  };
  const svc = str(o.svc);
  const when = str(o.when);
  return {
    ...obj,
    ...(svc ? { svc } : {}),
    ...(when ? { when } : {}),
    ...(o.over === true ? { over: true } : {}),
  };
}

/**
 * One wire person as an `OwnPerson`, or null if it is not one.
 *
 * `kind` is validated against the three the matrix branches on — Responsible
 * may not be a Group (proto: "One name, never a group"), and the load panel
 * splits people from groups — so an unrecognised kind would quietly change what
 * the page is willing to assign.
 */
export function toOwnPerson(raw: unknown): OwnPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id);
  const name = str(p.name);
  if (!id || !name) return null;
  const kind = str(p.kind);
  return {
    id,
    name,
    role: str(p.role),
    side: str(p.side) || OWN_SIDES[0],
    kind: kind === "Group" || kind === "Vendor" ? kind : "Person",
    away: str(p.away),
    deputy: str(p.deputy),
  };
}

/** The design's own estate, used until the read lands and if it fails. */
export const OWNERSHIP_FIXTURE: OwnershipData = {
  people: OWN_PEOPLE_SEED,
  objects: OWN_OBJECTS,
  sides: OWN_SIDES,
  sources: [],
  customerName: OWN_SIDES[0],
  currentUserName: "",
  tenantScoped: false,
};

/**
 * A payload as the page's data, or null when it carries nothing to render.
 *
 * Null — not an empty `OwnershipData` — because the caller's decision is which
 * SOURCE to render, and "the read succeeded but there is nothing in it" belongs
 * to the fixture branch: a matrix with no rows cannot be told apart from a
 * matrix that failed to load, and the fixture at least explains what the page
 * is for. Zero PEOPLE is treated the same way: every assign flow reads that
 * list, so an empty one is a page whose controls all open onto nothing.
 */
export function toOwnershipData(payload: WireOwnershipPayload | null): OwnershipData | null {
  if (!payload) return null;

  const objects = (payload.objects ?? [])
    .map(toOwnObject)
    .filter((o): o is OwnObject => o !== null);
  const people = (payload.people ?? [])
    .map(toOwnPerson)
    .filter((p): p is OwnPerson => p !== null);
  if (!objects.length || !people.length) return null;

  const sides = (payload.sides ?? []).filter((s): s is string => typeof s === "string" && !!s);
  const customerName = str(payload.customer?.name) || sides[0] || OWN_SIDES[0];

  return {
    people,
    objects,
    sides: sides.length ? sides : OWN_SIDES,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    customerName,
    currentUserName: str(payload.currentUserName),
    tenantScoped: payload.tenantScoped === true,
  };
}
