/**
 * m365-cloud-instance.ts — cloud instance as a first-class, filterable
 * dimension on Microsoft Changes (Git #1537, part of #1494).
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * `m365_roadmap_items.cloud_instances` (#1530) already carries Microsoft's own
 * real vocabulary per item — verified live against the public feed:
 * `["Worldwide (Standard Multi-Tenant)", "GCC"]` was one real sample's exact
 * value. In v1 this arrives as `tagsContainer.cloudInstances[].tagName`; in v2
 * OData it is the `availabilities` complex type's `cloudInstance` field. This
 * module does not invent a vocabulary — it classifies the strings Microsoft
 * itself ships.
 *
 * ── Why a dimension, not a hardcoded exclusion ──────────────────────────────
 * #1537's own issue: this platform and the (future) NASA extraction need
 * DIFFERENT behaviour from the SAME data — this platform excludes gov/GCC
 * (out of scope), NASA extraction filters TO GCC High / DoD (the signal, not
 * the noise). A hardcoded `!isGov` filter baked into one route can only serve
 * one of those. `matchesCloudInstanceFilter` takes an explicit mode so every
 * consumer — this platform's own default, and whatever the NASA extraction
 * turns out to need — reads the same real per-item data through the same
 * classifier, just with a different mode.
 *
 * ── Honest handling of items with no cloud instance data ────────────────────
 * An item with an empty `cloudInstances` array is not "confirmed worldwide"
 * and not "confirmed gov" — it is unclassified (Microsoft's own feed did not
 * tag it, or the item predates cloud-instance tagging). "worldwide" mode
 * (this platform's default) INCLUDES unclassified items rather than silently
 * dropping them — excluding on absent data would be enforcing scope from an
 * assumption, exactly what #1537 exists to stop. "gov" mode (the NASA
 * extraction's need) EXCLUDES unclassified items — an unproven item is noise
 * there, not signal, per #1537's own framing ("A Worldwide-only item is noise
 * there, and a GCC-delayed item is the thing that actually matters").
 */

/** Matches "GCC", "GCC High", "DoD" — every government cloud instance
 * Microsoft's roadmap feed has been observed to tag. Deliberately a substring
 * match rather than an exact-value enum: "extracted, not authored" per
 * CLAUDE.md — the real strings Microsoft ships are the vocabulary, and this
 * only needs to recognize the gov/DoD family within them, not enumerate every
 * exact tag Microsoft has ever used (e.g. "Worldwide (Standard Multi-Tenant)"
 * safely does not match). */
const GOV_CLOUD_RE = /\bGCC\b|\bDoD\b/i;

/** True iff a single cloud-instance tag names a government cloud (GCC, GCC
 * High, or DoD). */
export function isGovCloudInstance(tag: string): boolean {
  return GOV_CLOUD_RE.test(tag);
}

/** True iff at least one of an item's cloud-instance tags names a government
 * cloud. */
export function hasGovCloudInstance(cloudInstances: readonly string[]): boolean {
  return cloudInstances.some(isGovCloudInstance);
}

/**
 * The filter modes #1537 names:
 *  - "worldwide" — this platform's default. Keeps every item EXCEPT one that
 *    is gov-only (has at least one gov tag and no non-gov tag). An item that
 *    is unclassified (no cloud-instance data at all) is kept — see the module
 *    doc's honesty note.
 *  - "gov"       — the NASA extraction's need. Keeps only items with at least
 *    one gov cloud-instance tag (GCC / GCC High / DoD). Unclassified items are
 *    dropped — no data means no proven relevance there.
 *  - "all"       — no filtering; every item passes. The escape hatch for a
 *    surface (e.g. an admin author reviewing raw candidates) that wants the
 *    unfiltered set.
 */
export type CloudInstanceFilterMode = "worldwide" | "gov" | "all";

export const CLOUD_INSTANCE_FILTER_MODES: readonly CloudInstanceFilterMode[] = ["worldwide", "gov", "all"];

/** Parses a wire-supplied filter mode (e.g. a `?cloud=` query param), falling
 * back to `fallback` for anything unrecognized rather than throwing — a typo
 * or stale client value should degrade to the platform default, not 500. */
export function parseCloudInstanceFilterMode(
  value: unknown,
  fallback: CloudInstanceFilterMode = "worldwide",
): CloudInstanceFilterMode {
  return typeof value === "string" && (CLOUD_INSTANCE_FILTER_MODES as readonly string[]).includes(value)
    ? (value as CloudInstanceFilterMode)
    : fallback;
}

/** Applies one filter mode to one item's cloud-instance tags. */
export function matchesCloudInstanceFilter(
  cloudInstances: readonly string[],
  mode: CloudInstanceFilterMode,
): boolean {
  if (mode === "all") return true;
  const isGovOnly = cloudInstances.length > 0 && cloudInstances.every(isGovCloudInstance);
  if (mode === "worldwide") return !isGovOnly;
  // mode === "gov"
  return hasGovCloudInstance(cloudInstances);
}

/** Filters a list of items carrying `cloudInstances` by mode — the plural
 * convenience form callers actually use (a candidates list, a roadmap page). */
export function filterByCloudInstance<T extends { cloudInstances: readonly string[] }>(
  items: readonly T[],
  mode: CloudInstanceFilterMode,
): T[] {
  if (mode === "all") return items.slice();
  return items.filter((item) => matchesCloudInstanceFilter(item.cloudInstances, mode));
}
