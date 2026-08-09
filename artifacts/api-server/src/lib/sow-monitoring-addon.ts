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
 * `type_attributes.pricePerUserMonth`.
 *
 * Git #609 (supersedes the prior "customer picks Basic/Enhanced/Premium"
 * design): live-testing the 3-card picker showed all three quality tiers are
 * the same real feature set (Live Monitor Engine) — showing them as
 * selectable implied a choice that doesn't exist. Per Shane's 2026-08-08
 * confirmation, this resolves each quality tier's real price at this
 * tenant's real seat band exactly as before, then keeps only Enhanced (this
 * platform's one designated default) as the single tier the UI renders — no
 * band-selection UI, add/remove only.
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
 * Git #595 (supersedes #588's single-row wiring): the three real Architect
 * retainer rows (`architect-essentials-retainer` / `-growth-retainer` /
 * `-enterprise-retainer`), flat-priced (no `pricePerUserMonth`), one per real
 * seat band via `type_attributes.seatMin`/`seatMax` — the SAME three bands
 * (SMB/Mid-Market/Enterprise) Tenant Monitoring now prices against, per
 * Shane's 2026-08-08 scope: "the 3 Architect retainer tiers map 1:1 onto
 * those same 3 bands (Essentials=SMB, Growth=Mid-Market, Enterprise=Enterprise)".
 * All three are always offered (reuses #594's 3-box tier picker); the tier
 * whose band actually contains this tenant's real seat count gets
 * `emphasis: "seat-match"` and becomes `defaultTierId` — this addon's real
 * selection axis is seats, unlike Monitoring's quality-tier axis (see the
 * `emphasis` doc on `ResolvedAddonTier` below). `vCISO/Governance` and the
 * old single `copilot-governance-retainer` row are deliberately excluded from
 * this resolution (still in the catalog, just not queried here) per Shane's
 * explicit scope note — not deleted, not deactivated.
 *
 * When no real seat count is sourced, all three tiers are still returned
 * (unlike Monitoring, which omits the whole addon) — a retainer is a flat
 * monthly service the customer can pick manually; there is simply no
 * seat-matched default to pre-select, so `defaultTierId` falls back to the
 * lowest band (Essentials).
 *
 * Git #609: `defaultOn` is now always `true` — live-testing showed the prior
 * "enable the addon, THEN pick a tier" flow was a two-step opt-in for
 * something already pre-quoted at a real, seat-matched price. The seat-matched
 * tier (or the Essentials fallback with no sourced seats) starts active;
 * `StatementOfWorkBody.tsx` no longer renders an outer enable/disable step for
 * a tiered addon, only the tier picker plus a remove control.
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
import { and, eq, inArray } from "drizzle-orm";
import { resolvePaidSeatFigures } from "./license-waste-source.ts";
import { resolveEffectiveChargeCents, resolveTypeAttributesMonthlyPriceCents } from "./catalog-pricing.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.offer" });

/** Git #595 — real seat-banded order, lowest band first (Essentials/SMB → Enterprise). */
const ARCHITECT_RETAINER_SLUGS = [
  "architect-essentials-retainer",
  "architect-growth-retainer",
  "architect-enterprise-retainer",
] as const;

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
  /**
   * Git #593 — the Gantt's continuous-band flag, read off the real catalog
   * rows' `type_attributes.stage` (2026-08-08-sow-phase-stage-duration-593.sql)
   * rather than asserted here. `undefined` (not `false`) for an addon this
   * migration never tagged — the Architect Retainer has no bounded/continuous
   * claim on it either way, so it stays silent rather than guessing.
   */
  readonly stage?: "continuous";
}

type ServiceRow = typeof servicesTable.$inferSelect;

interface MonitoringAttrs {
  tenantTierLabel?: unknown;
  seatMin?: unknown;
  seatMax?: unknown;
  stage?: unknown;
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
 * The row (of a set of same-purpose rows, one per seat band) whose real seat
 * count contains `seats`, or — for a tenant outside every band this platform
 * has priced — the nearest band, so a real tenant is never left unpriced or
 * unmatched over an edge the catalog simply has not filled in. Shared by
 * Tenant Monitoring (bands within one quality tier) and the Architect
 * Retainer (bands across its three tiers directly, Git #595).
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

  // Git #595: visibility filter is required, not optional — a row set to
  // `visibility = "private"` (e.g. the retired Micro tier) must actually stop
  // being offered here, or the data-only fix does nothing.
  const rows = await db
    .select()
    .from(servicesTable)
    .where(
      and(eq(servicesTable.serviceType, "monitoring_tier"), eq(servicesTable.visibility, "public")),
    );

  const byLabel = new Map<string, ServiceRow[]>();
  for (const row of rows) {
    const ta = (row.typeAttributes ?? {}) as MonitoringAttrs;
    const label = typeof ta.tenantTierLabel === "string" ? ta.tenantTierLabel.trim() : "";
    if (!label) continue;
    const group = byLabel.get(label);
    if (group) group.push(row);
    else byLabel.set(label, [row]);
  }

  // Every real quality tier's own real price at this tenant's real seat band
  // — the same resolution as before Git #609, just no longer all exposed as
  // selectable alternatives (see the class doc above).
  const candidates: ResolvedAddonTier[] = [];
  for (const [label, group] of byLabel) {
    const row = pickBandRow(group, seats);
    if (!row) continue;
    const monthlyCents = resolveTypeAttributesMonthlyPriceCents(row, seats);
    if (monthlyCents <= 0) continue;
    candidates.push({
      id: slugify(label),
      label,
      upfrontUsd: 0,
      monthlyUsd: monthlyCents / 100,
      detail: (row.tagline ?? row.description ?? "").trim(),
    });
  }

  if (candidates.length === 0) {
    log.warn("sow-monitoring-addon: no priceable monitoring_tier rows — Tenant Monitoring add-on omitted");
    return null;
  }

  // Git #609: keep only the one this platform actually recommends (Enhanced),
  // falling back to whichever quality tier priced if Enhanced itself did not
  // — never an empty addon when at least one real tier is priceable.
  const resolved =
    candidates.find((t) => t.label.toLowerCase() === "enhanced") ??
    candidates.sort(
      (a, b) => (TIER_LABEL_ORDER[a.label.toLowerCase()] ?? 99) - (TIER_LABEL_ORDER[b.label.toLowerCase()] ?? 99),
    )[0];

  // Git #593 — real, not asserted: only set when at least one of this
  // tenant's actual band rows carries it (every monitoring_tier row does,
  // post-migration, but a stale/un-migrated environment should not claim it).
  const stage = rows.some((row) => (row.typeAttributes as MonitoringAttrs | null)?.stage === "continuous")
    ? ("continuous" as const)
    : undefined;

  return {
    id: "tenant-monitoring",
    title: "Tenant Monitoring",
    // Kept verbatim from the design (Shane, 2026-08-08): this is marketing
    // shorthand, not a literal per-tier engine count, and this platform does
    // not publish its internal engine roster as customer-facing copy.
    blurb:
      "Six signal engines against your tenant every hour. An assessment tells you what is wrong today; monitoring tells you the second it happens again.",
    defaultOn: true,
    defaultTierId: resolved.id,
    tiers: [resolved],
    stage,
  };
}

/** Real, customer-facing tier names for the three retainer slugs — not invented, these are the product names #595's issue body names them by. */
const ARCHITECT_RETAINER_LABELS: Readonly<Record<string, string>> = {
  "architect-essentials-retainer": "Essentials",
  "architect-growth-retainer": "Growth",
  "architect-enterprise-retainer": "Enterprise",
};

/**
 * The real Architect Retainer add-on — the three real seat-banded tiers
 * (Essentials/Growth/Enterprise), flat-priced off each row directly. The tier
 * whose band contains this tenant's real seat count is marked
 * `emphasis: "seat-match"` and pre-selected; with no sourced seat count every
 * tier still renders (a retainer is manually pickable, unlike Monitoring
 * which omits itself entirely when unpriced), defaulting to Essentials.
 */
export async function resolveArchitectRetainerAddon(
  tenantGuid: string | null,
): Promise<ResolvedSowAddon | null> {
  const rows = await db
    .select()
    .from(servicesTable)
    .where(inArray(servicesTable.slug, ARCHITECT_RETAINER_SLUGS));

  if (rows.length === 0) {
    log.warn({ slugs: ARCHITECT_RETAINER_SLUGS }, "sow-monitoring-addon: Architect Retainer service rows not found");
    return null;
  }

  const slugOrder = new Map<string, number>(ARCHITECT_RETAINER_SLUGS.map((slug, i) => [slug, i]));
  const ordered = [...rows].sort(
    (a, b) => (slugOrder.get(a.slug ?? "") ?? 99) - (slugOrder.get(b.slug ?? "") ?? 99),
  );

  const seatFigures = tenantGuid ? await resolvePaidSeatFigures(tenantGuid) : null;
  const seats = seatFigures?.provisioned ?? 0;
  const seatMatchedRow = seats > 0 ? pickBandRow(ordered, seats) : null;

  const tiers: ResolvedAddonTier[] = [];
  for (const row of ordered) {
    const monthlyCents = resolveEffectiveChargeCents(row);
    if (monthlyCents <= 0) continue;
    tiers.push({
      id: slugify(row.slug ?? row.name),
      label: (row.slug && ARCHITECT_RETAINER_LABELS[row.slug]) ?? row.name,
      upfrontUsd: 0,
      monthlyUsd: monthlyCents / 100,
      detail: (row.tagline ?? row.description ?? "").trim(),
      emphasis: seatMatchedRow && row.id === seatMatchedRow.id ? "seat-match" : undefined,
    });
  }

  if (tiers.length === 0) {
    log.warn("sow-monitoring-addon: no priceable Architect Retainer rows — Architect Retainer add-on omitted");
    return null;
  }

  const defaultTier = tiers.find((t) => t.emphasis === "seat-match") ?? tiers[0];

  return {
    id: "architect-retainer",
    title: "Architect Retainer",
    // Real per-row tagline/description, never invented — the Essentials row's
    // own copy (the group's entry-level tier) stands in for the addon-level
    // blurb, same as Monitoring's per-tier `detail` sourcing.
    blurb: (ordered[0]?.tagline ?? ordered[0]?.description ?? "").trim(),
    // Git #609: pre-selected/active by default, not a separate opt-in step —
    // see the function doc above.
    defaultOn: true,
    defaultTierId: defaultTier.id,
    tiers,
  };
}
