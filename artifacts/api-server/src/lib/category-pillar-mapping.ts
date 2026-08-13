import type { RadarPillar } from "./pillar-coverage";

/**
 * Single source of truth for category -> pillar assignment on new
 * `signal_derivation_rules` / `signal_rule_groups` rows (Git #469).
 *
 * Previously this mapping existed only as a `CASE` statement inside a
 * one-time bulk-insert seed script
 * (`lib/db/migrations/manual/2026-07-23-close-signal-coverage-gaps.sql`),
 * which nothing re-runs when a new check/rule is added, and which silently
 * defaulted any unrecognized domain to `governance`. This module is the
 * forward-only replacement: it is consulted at row-creation time, not
 * re-applied retroactively to the existing corpus.
 */

/** `category` values are `domain:subcategory` (or a bare domain). This extracts the domain. */
export function categoryDomain(category: string): string {
  const trimmed = category.trim().toLowerCase();
  const colonIndex = trimmed.indexOf(":");
  return colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex);
}

/**
 * Domains that resolve to a health/radar pillar. The appgov/teams/sharepoint,
 * compliance/dlp/sensitivity-labels/retention-labels, and
 * identity/identitygov/security/defender/exchange entries are the mappings
 * confirmed in Git #469's body. The bare `governance`/`compliance`/`security`
 * self-entries and the `adoption`/`copilot`/`architecture`/`licensing`
 * self-entries are not part of that audit — they are the pre-existing,
 * already-unambiguous 1:1 domain-equals-pillar mappings the seed script also
 * encoded, included here only so removing the seed script's silent `ELSE`
 * doesn't newly break rule creation for those pillars.
 */
const GOVERNED_CATEGORY_DOMAIN_TO_PILLAR: Readonly<Record<string, RadarPillar>> = {
  // Git #469 confirmed mappings.
  appgov: "governance",
  teams: "governance",
  sharepoint: "governance",
  compliance: "compliance",
  dlp: "compliance",
  "sensitivity-labels": "compliance",
  "retention-labels": "compliance",
  identity: "security",
  identitygov: "security",
  security: "security",
  defender: "security",
  exchange: "security",
  // Pre-existing unambiguous self-mappings (domain name === pillar name).
  governance: "governance",
  adoption: "adoption",
  copilot: "copilot",
  architecture: "architecture",
  licensing: "licensing",
};

/**
 * `devices` is intentionally excluded from this pass per product decision
 * (Git #469) — a known, deliberate gap, not a bug. Category domains here
 * must fail loudly with a distinct, clearly-labeled reason rather than the
 * generic "unmapped domain" error, so the gap reads as expected rather than
 * as broken.
 */
const DELIBERATELY_UNMAPPED_CATEGORY_DOMAINS = new Set(["devices"]);

/**
 * Category domains belonging to another engine's own scoring taxonomy that
 * reuses the same `signal_derivation_rules`/`signal_rule_groups` table
 * format but is explicitly out of scope for Git #469 (per the issue body):
 * `example:*` (admin-panel documentation), `adj:*`/SOW pricing adjustors,
 * `crm.*` (CRM Intelligence Engine), and the priority engine's own
 * pricing/priority/workflow/drift/forecasting/msp categories. These never
 * resolve to a health/radar pillar, so they are not this mapping's concern
 * and pass through unvalidated exactly as before.
 */
const OUT_OF_SCOPE_CATEGORY_DOMAINS = new Set([
  "example",
  "adj",
  "pricing",
  "priority",
  "crm",
  "msp",
  "workflow",
  "drift",
  "forecasting",
]);

export class DeliberatelyUnmappedCategoryDomainError extends Error {
  readonly code = "CATEGORY_DOMAIN_DELIBERATELY_UNMAPPED";
  constructor(readonly domain: string) {
    super(
      `Category domain "${domain}" has no pillar mapping by deliberate product decision (Git #469) — ` +
        `this is a known, intentional gap, not a bug. Do not guess a pillar for it.`,
    );
    this.name = "DeliberatelyUnmappedCategoryDomainError";
  }
}

export class UnmappedCategoryDomainError extends Error {
  readonly code = "CATEGORY_DOMAIN_UNMAPPED";
  constructor(readonly domain: string) {
    super(
      `Category domain "${domain}" has no pillar mapping. Add it to GOVERNED_CATEGORY_DOMAIN_TO_PILLAR in ` +
        `category-pillar-mapping.ts (if it belongs to a health/radar pillar) or to OUT_OF_SCOPE_CATEGORY_DOMAINS ` +
        `(if it belongs to another engine's own taxonomy) — it will not silently default to "governance".`,
    );
    this.name = "UnmappedCategoryDomainError";
  }
}

/**
 * Resolves the pillar for a new row's `category` value.
 *
 * Returns `null` when the category is blank (nothing to derive from yet) or
 * when its domain belongs to another engine's out-of-scope taxonomy — both
 * cases leave the caller's existing `pillar` handling untouched. Throws for
 * `devices` (deliberate gap) and for any other unrecognized domain (the
 * removed silent `ELSE 'governance'`).
 */
export function resolveCategoryPillar(category: string): RadarPillar | null {
  const domain = categoryDomain(category);
  if (!domain) return null;
  if (domain in GOVERNED_CATEGORY_DOMAIN_TO_PILLAR) {
    return GOVERNED_CATEGORY_DOMAIN_TO_PILLAR[domain];
  }
  if (DELIBERATELY_UNMAPPED_CATEGORY_DOMAINS.has(domain)) {
    throw new DeliberatelyUnmappedCategoryDomainError(domain);
  }
  if (OUT_OF_SCOPE_CATEGORY_DOMAINS.has(domain)) {
    return null;
  }
  throw new UnmappedCategoryDomainError(domain);
}
