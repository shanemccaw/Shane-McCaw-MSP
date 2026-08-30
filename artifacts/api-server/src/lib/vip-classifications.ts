/**
 * vip-classifications.ts — pure, DB-free shaping + validation for the Policy
 * Engine's VIP classification object (#1552).
 *
 * #1552's own resolution (2026-08-28): a user becomes VIP by one of three
 * routes — Told, group membership, AD attribute — but they are NOT equal
 * truth-holders. THE PLATFORM IS AUTHORITATIVE, not the tenant. "Told" is a
 * decision made HERE and is the only source that may move the current value.
 * Group membership / AD attribute are read hints used only for DISCOVERY, to
 * seed who is already VIP in an existing estate at onboarding — once the
 * platform holds a classification for a principal, a tenant-side change to it
 * is DRIFT to correct (#1553), never a value this object adopts.
 *
 * Kept DB-free so the wire contract and the source vocabulary can be
 * unit-tested against plain rows, the same pattern standing-policies.ts uses.
 */

import {
  VIP_CLASSIFICATION_SOURCES,
  type VipClassification,
  type VipClassificationSource,
} from "@workspace/db";

/** The wire contract for a VIP classification. Ends at the wire — no portal page (#1552 scope stop). */
export interface WireVipClassification {
  readonly id: number;
  readonly customerId: number;
  readonly principalId: string;
  readonly principalUpn: string;
  readonly isVip: boolean;
  readonly source: VipClassificationSource;
  readonly discoveryDetail: Record<string, unknown> | null;
  readonly classifiedByName: string | null;
  readonly classifiedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Human labels for the source vocabulary. Display copy only — the raw value is the contract. */
export const VIP_CLASSIFICATION_SOURCE_LABELS: Record<VipClassificationSource, string> = {
  told: "Told (set in platform)",
  discovered_group: "Discovered — group membership",
  discovered_attribute: "Discovered — AD attribute",
};

/** Narrows an arbitrary value to a real classification source — no fallback, no invented member. */
export function isVipClassificationSource(value: unknown): value is VipClassificationSource {
  return typeof value === "string" && (VIP_CLASSIFICATION_SOURCES as readonly string[]).includes(value);
}

/** Whether a source is one of the two read-hint discovery routes, as opposed to "told". */
export function isDiscoverySource(source: VipClassificationSource): boolean {
  return source === "discovered_group" || source === "discovered_attribute";
}

/**
 * The two read-hint routes a discovery seed call may claim — everything in
 * `VIP_CLASSIFICATION_SOURCES` except "told", which is never something a
 * batch import declares; it is only ever a deliberate, individual act.
 */
export const VIP_DISCOVERY_SOURCES = ["discovered_group", "discovered_attribute"] as const;
export type VipDiscoverySource = (typeof VIP_DISCOVERY_SOURCES)[number];

/**
 * Maps a real `vip_classifications` row to its wire shape. Nulls are served as
 * nulls; discoveryDetail is served exactly as stored.
 */
export function toWireVipClassification(row: VipClassification): WireVipClassification {
  return {
    id: row.id,
    customerId: row.customerId,
    principalId: row.principalId,
    principalUpn: row.principalUpn,
    isVip: row.isVip,
    source: row.source,
    discoveryDetail: row.discoveryDetail ?? null,
    classifiedByName: row.classifiedByName,
    classifiedAt: row.classifiedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
