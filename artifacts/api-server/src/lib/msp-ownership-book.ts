/**
 * msp-ownership-book.ts — the mapping layer behind `GET /api/msp/ownership/mine`
 * (Ownership / RACI: Cross-customer MSP view, #1521).
 *
 * ── The question this answers ────────────────────────────────────────────────
 * Every RACI cell lives inside one customer's own `portal_ownership_assignments`
 * row set (#1491's architecture note 7). There is no query anywhere that asks
 * "what do I, the MSP, hold — across every customer I serve." This route is
 * that query: it scans every tenant in the caller's book for assignment rows
 * whose `owner_person_id` belongs to an MSP-side person, and resolves each hit
 * back to the real object it names via `gatherOwnershipObjects` (the same
 * assembly `GET /portal/ownership` uses for its own customer).
 *
 * ── Who counts as "the MSP" here, and why this isn't re-deciding #1520 ──────
 * #1520 (open) is about giving a CUSTOMER's matrix a second person source so
 * their own people list can offer an MSP holder to assign. This route does not
 * touch that: it is a READ over whatever `owner_person_id` values already
 * exist, using the identity scheme `personIdForUser` already establishes
 * (#1592/#1759) and the identity boundary the schema itself already enforces
 * — `users_role_scope_check` requires MSPAdmin/MSPOperator/ServiceAccount to
 * carry `mspId`, and PlatformAdmin to carry neither. "MSP-side person" is
 * exactly the set that check already defines; nothing new is invented here.
 * `assign` never validated `ownerPersonId` against the calling tenant's own
 * people list, so this route's result is honest today even though no page
 * currently offers "assign the MSP" as a choice — it will just be empty until
 * one does, which is a real state of the world, not a missing backend.
 *
 * ── Emergent, not predictable (#1491 note 7) ─────────────────────────────────
 * Dense for one customer, empty for another, is the real shape of an MSP's
 * relationships — not a data quality problem. `byCustomer` carries every
 * in-scope customer, including the zero-count ones, so that shape is visible
 * rather than silently dropped.
 */

import type { OwnObjectType, OwnRoleKey, WireOwnObject } from "./portal-ownership.ts";
import { isOwnRoleKey } from "./portal-ownership.ts";

/** One matrix cell the MSP holds, resolved to the real object it names. */
export interface WireMspOwnHolding {
  readonly customerId: number;
  readonly customerName: string;
  readonly objectType: OwnObjectType;
  readonly objectId: string;
  readonly objectName: string;
  readonly sub: string;
  readonly link: string;
  readonly roleKey: OwnRoleKey;
  readonly holderPersonId: string;
  readonly acceptance: string;
  readonly order: number;
  /** Free-text reason for a decline (#1519) — "" unless `acceptance` is "declined". */
  readonly declineReason: string;
}

/** Per-customer coverage — present for every in-scope customer, zero included. */
export interface WireMspOwnCustomerCoverage {
  readonly customerId: number;
  readonly customerName: string;
  readonly count: number;
}

export interface WireMspOwnershipBook {
  readonly mspPersonCount: number;
  readonly customerCount: number;
  readonly holdings: readonly WireMspOwnHolding[];
  readonly byCustomer: readonly WireMspOwnCustomerCoverage[];
}

export interface RawMspAssignmentRow {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly acceptance: string | null;
  readonly orderRank: number | null;
  readonly declineReason?: string | null;
}

/**
 * Resolves one customer's MSP-held assignment rows against that customer's
 * real objects. An assignment naming an object id no longer present in the
 * live object list (deleted CR, closed freeze window since re-opened under a
 * new key, etc.) is skipped rather than rendered with an invented name — the
 * same "unresolvable resolves to a gap" rule `resolvePersonId` already
 * follows in the sibling customer-scoped route.
 */
export function resolveHoldingsForCustomer(
  customerId: number,
  customerName: string,
  objects: readonly WireOwnObject[],
  assignmentRows: readonly RawMspAssignmentRow[],
): WireMspOwnHolding[] {
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const holdings: WireMspOwnHolding[] = [];
  for (const row of assignmentRows) {
    if (!isOwnRoleKey(row.roleKey)) continue;
    const obj = objectById.get(row.objectId);
    if (!obj) continue;
    holdings.push({
      customerId,
      customerName,
      objectType: obj.type,
      objectId: obj.id,
      objectName: obj.name,
      sub: obj.sub,
      link: obj.link,
      roleKey: row.roleKey,
      holderPersonId: row.ownerPersonId,
      acceptance: row.acceptance ?? "",
      order: row.orderRank ?? 0,
      declineReason: row.declineReason ?? "",
    });
  }
  return holdings;
}
