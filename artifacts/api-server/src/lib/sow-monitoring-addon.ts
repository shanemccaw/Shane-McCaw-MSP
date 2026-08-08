/**
 * sow-monitoring-addon.ts
 *
 * Resolves the two real, already-priced optional services the SOW's add-on
 * section is allowed to show — Tenant Monitoring and the Architect Retainer —
 * from the real catalog rows, never from a second/invented pricing path.
 *
 * TENANT MONITORING
 * ------------------
 * `services` carries 12 real monitoring_tier rows: 3 quality tiers (Basic /
 * Enhanced / Premium, `type_attributes.tenantTierLabel`) × 4 seat bands
 * (`type_attributes.seatMin`/`seatMax`), each per-seat priced via
 * `type_attributes.pricePerUserMonth`. Per Shane (2026-08-08): the seat count
 * decides the PRICE (which band row prices each tier at this tenant's real
 * seat count) — it does not decide which quality tier is shown or pre-picked.
 * The customer picks Basic/Enhanced/Premium; Enhanced is the recommended
 * default. This mirrors `ProposalAddonCard.tsx`'s existing `"recommended"`
 * emphasis (a quality/delivery axis), not its `"seat-match"` emphasis (a seat
 * axis) — Monitoring's real axis here is the former, not the seat-banded axis
 * the design's own preview fixture used.
 *
 * Reuses `resolveTypeAttributesMonthlyPriceCents` (catalog-pricing.ts) for the
 * actual per-seat arithmetic rather than re-deriving it — that is the one real
 * tier-pricing mechanism this platform has.
 *
 * Seats come from `resolvePaidSeatFigures` (license-waste-source.ts) — the
 * same real, already-wired paid-seat count the Licensing pillar card uses.
 * `null` when this tenant's paid seat count cannot be sourced, in which case
 * the addon is omitted entirely rather than priced against a guess.
 *
 * ARCHITECT RETAINER
 * ------------------
 * One real row (`services.slug = "copilot-governance-retainer"`), no tiering —
 * wired directly per #588's scope note.
 *
 * PER-TIER COPY
 * -------------
 * `detail` on each tier is the service row's own customer-facing `tagline` /
 * `description` — never the raw `includedEngines`/`includedFeatures` keys.
 * Those are an internal targeting vocabulary (same status as the pricing
 * engine's other internal signals), not marketing copy this platform
 * publishes about itself.
 */

import { db, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolvePaidSeatFigures } from "./license-waste-source.ts";
import { resolveEffectiveChargeCents, resolveTypeAttributesMonthlyPriceCents } from "./catalog-pricing.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.offer" });

const ARCHITECT_RETAINER_SLUG = "copilot-governance-retainer";

export interface ResolvedAddonTier {
  readonly id: string;
  readonly label: string;
  readonly upfrontUsd: number;
  readonly monthlyUsd: number;
  readonly detail: string;
  readonly emphasis?: "seat-match" | "recommended";
}

export interface ResolvedSowAddon {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly defaultOn: boolean;
  readonly defaultTierId: string | null;
  readonly tiers: readonly ResolvedAddonTier[];
}

type ServiceRow = typeof servicesTable.$inferSelect;

interface MonitoringAttrs {
  tenantTierLabel?: unknown;
  seatMin?: unknown;
  seatMax?: unknown;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tier";
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The band row (of one quality tier's rows) whose real seat count contains
 * `seats`, or — for a tenant outside every band this platform has priced —
 * the nearest band, so a real tenant is never left unpriced over an edge the
 * catalog simply has not filled in.
 */
function pickBandRow(rows: readonly ServiceRow[], seats: number): ServiceRow | null {
  let best: ServiceRow | null = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const ta = (row.typeAttributes ?? {}) as MonitoringAttrs;
    const min = toFiniteNumber(ta.seatMin) ?? 0;
    const max = toFiniteNumber(ta.seatMax);
    if (seats >= min && (max === null || seats <= max)) return row;
    const distance = seats < min ? min - seats : max !== null ? seats - max : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
}

const TIER_LABEL_ORDER: Readonly<Record<string, number>> = { basic: 0, enhanced: 1, premium: 2 };

/**
 * The real Tenant Monitoring add-on, priced for this tenant's real seat
 * count, or `null` when there is no honest way to price it — no seat count
 * sourced, or the catalog carries no usable monitoring_tier rows.
 */
export async function resolveTenantMonitoringAddon(
  tenantGuid: string | null,
): Promise<ResolvedSowAddon | null> {
  if (!tenantGuid) return null;

  const seatFigures = await resolvePaidSeatFigures(tenantGuid);
  const seats = seatFigures?.provisioned ?? 0;
  if (!seatFigures || seats <= 0) {
    log.info({ tenantGuid }, "sow-monitoring-addon: no real paid seat count — Tenant Monitoring add-on omitted");
    return null;
  }

  const rows = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.serviceType, "monitoring_tier"));

  const byLabel = new Map<string, ServiceRow[]>();
  for (const row of rows) {
    const ta = (row.typeAttributes ?? {}) as MonitoringAttrs;
    const label = typeof ta.tenantTierLabel === "string" ? ta.tenantTierLabel.trim() : "";
    if (!label) continue;
    const group = byLabel.get(label);
    if (group) group.push(row);
    else byLabel.set(label, [row]);
  }

  const tiers: ResolvedAddonTier[] = [];
  for (const [label, group] of byLabel) {
    const row = pickBandRow(group, seats);
    if (!row) continue;
    const monthlyCents = resolveTypeAttributesMonthlyPriceCents(row, seats);
    if (monthlyCents <= 0) continue;
    tiers.push({
      id: slugify(label),
      label,
      upfrontUsd: 0,
      monthlyUsd: monthlyCents / 100,
      detail: (row.tagline ?? row.description ?? "").trim(),
      emphasis: label.toLowerCase() === "enhanced" ? "recommended" : undefined,
    });
  }

  if (tiers.length === 0) {
    log.warn("sow-monitoring-addon: no priceable monitoring_tier rows — Tenant Monitoring add-on omitted");
    return null;
  }

  tiers.sort((a, b) => (TIER_LABEL_ORDER[a.label.toLowerCase()] ?? 99) - (TIER_LABEL_ORDER[b.label.toLowerCase()] ?? 99));
  const defaultTier = tiers.find((t) => t.emphasis === "recommended") ?? tiers[0];

  return {
    id: "tenant-monitoring",
    title: "Tenant Monitoring",
    // Kept verbatim from the design (Shane, 2026-08-08): this is marketing
    // shorthand, not a literal per-tier engine count, and this platform does
    // not publish its internal engine roster as customer-facing copy.
    blurb:
      "Six signal engines against your tenant every hour. An assessment tells you what is wrong today; monitoring tells you the second it happens again.",
    defaultOn: true,
    defaultTierId: defaultTier.id,
    tiers,
  };
}

/** The real Architect Retainer add-on — one catalog row, no tiering. */
export async function resolveArchitectRetainerAddon(): Promise<ResolvedSowAddon | null> {
  const [row] = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.slug, ARCHITECT_RETAINER_SLUG))
    .limit(1);

  if (!row) {
    log.warn({ slug: ARCHITECT_RETAINER_SLUG }, "sow-monitoring-addon: Architect Retainer service row not found");
    return null;
  }

  const monthlyCents = resolveEffectiveChargeCents(row);
  if (monthlyCents <= 0) {
    log.warn({ serviceId: row.id }, "sow-monitoring-addon: Architect Retainer resolved to no positive price");
    return null;
  }

  return {
    id: "architect-retainer",
    title: row.name,
    blurb: (row.tagline ?? row.description ?? "").trim(),
    defaultOn: false,
    defaultTierId: "standard",
    tiers: [
      {
        id: "standard",
        label: row.hoursPerMonth ?? "Retainer",
        upfrontUsd: 0,
        monthlyUsd: monthlyCents / 100,
        detail: (row.tagline ?? row.description ?? "").trim(),
      },
    ],
  };
}
