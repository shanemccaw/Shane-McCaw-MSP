/**
 * license-gap-purchase-links.ts — #489.
 *
 * Turns "this tenant has license_gap findings" into "here is where their own
 * admin would go and buy the thing" — tiered by how BROADLY they are gapped, so
 * a tenant missing one capability is pointed at one add-on and a tenant missing
 * all three is pointed at the one suite that covers all three instead of three
 * separate purchase asks.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * Not a resale. This platform sells configuration and consulting and never
 * resells Microsoft licensing (the standing decision recorded in
 * `2026-07-22-license-gap-sales-offer-wiring.sql`). Every link here points at
 * MICROSOFT, carries no price, and involves no pricing decision by us. It is a
 * courtesy: a finding that says "you are not licensed for X" is more useful
 * with a link to X than without one.
 *
 * ── WHY THERE IS NO "BUY NOW" URL ────────────────────────────────────────────
 * No generic cross-tenant purchase link exists. Buying a Microsoft 365 add-on
 * always happens inside the customer's OWN tenant, by their own admin, signed
 * in at admin.microsoft.com (Billing → Purchase products). These documents go
 * to that admin, so naming the path is the actionable part; the link is there
 * to tell them what to look for when they get there.
 *
 * ── WHY THE LINKS ARE PRICING PAGES AND NOT ADMIN-CENTER DEEP LINKS ──────────
 * #489 asked for an admin-center catalog deep link "where one reliably exists",
 * and a verified fallback otherwise. It does not reliably exist and cannot be
 * verified even in principle:
 *
 *   • `admin.microsoft.com/#/catalog` puts the route in a URL FRAGMENT, which
 *     is never sent to the server. No fetch can distinguish a correct catalog
 *     path from a typo — both return the same SPA shell, and both then redirect
 *     an unauthenticated visitor to login. A per-SKU fragment would be a guess
 *     shipped into a paid customer deliverable.
 *   • Microsoft Learn documents the NAVIGATION ("Billing > Purchase products")
 *     and the bare entry point `admin.microsoft.com`. It documents no per-SKU
 *     catalog URL.
 *
 * So `adminCenterPath` carries the documented navigation as words, and every
 * `url` below is a public Microsoft page that was fetched and confirmed to
 * resolve and to actually name its SKU (2026-08-06):
 *
 *   Entra ID P2   …/security/business/microsoft-entra-pricing
 *                 → names "Microsoft Entra ID P1" / "Microsoft Entra ID P2".
 *   Defender O365 …/security/business/siem-and-xdr/microsoft-defender-office-365
 *                 → names "Microsoft Defender for Office 365 (Plan 1)"/"(Plan 2)".
 *   Purview Suite …/security/business/purview-suite-pricing
 *                 → names "Microsoft Purview Suite".
 *   Microsoft 365 E7 …/microsoft-365/enterprise/microsoft365-plans-and-pricing
 *                 → names "Microsoft 365 E7" and labels it "The Frontier Suite".
 *                 There is no standalone /enterprise/e7 page; E7 is a row on the
 *                 enterprise plan comparison, which is also the page that lets a
 *                 reader see what it replaces.
 *
 * No price is stored here. Prices drift, we do not sell these, and a stale
 * figure in a customer's report is a liability with no upside.
 *
 * ── THE CATEGORIES ARE THE CORRECTED ONES ────────────────────────────────────
 * #489's ORIGINAL issue body mapped "Mail security" to eleven `exchange:*`
 * checks. That table is superseded by the 2026-08-06 correction comment and
 * must not be used: those eleven turned out not to be license-gated at all (the
 * real fault was executor wiring, #491), nine were never linked to
 * `assess:copilot-readiness` in the first place, and all eleven have since been
 * archived out of the product. Exchange contributes nothing here. The three
 * lists below are the corrected ones, and every key in them is a check whose
 * `license_gap` classification was confirmed against live tenant data.
 */

/** The three gap categories the tiering rule counts. Order is display order. */
export const LICENSE_GAP_CATEGORY_KEYS = ["identity", "mailSecurity", "compliance"] as const;
export type LicenseGapCategoryKey = (typeof LICENSE_GAP_CATEGORY_KEYS)[number];

/** One Microsoft SKU a gap points at. `url` is verified-resolving, never guessed. */
export interface LicenseGapSku {
  /** Stable id, so a consumer can key off the SKU without matching on its name. */
  readonly key: string;
  /** The SKU's own name, as Microsoft's page spells it. */
  readonly name: string;
  readonly url: string;
}

export const ENTRA_ID_P2: LicenseGapSku = {
  key: "entra-id-p2",
  name: "Microsoft Entra ID P2",
  url: "https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing",
};

export const DEFENDER_FOR_OFFICE_365: LicenseGapSku = {
  key: "defender-for-office-365",
  name: "Microsoft Defender for Office 365",
  url: "https://www.microsoft.com/en-us/security/business/siem-and-xdr/microsoft-defender-office-365",
};

export const PURVIEW_SUITE: LicenseGapSku = {
  key: "purview-suite",
  name: "Microsoft Purview Suite",
  url: "https://www.microsoft.com/en-us/security/business/purview-suite-pricing",
};

/**
 * The tier-3 consolidation. E7 bundles E5 + Microsoft 365 Copilot natively + the
 * full Entra Suite (a superset of Entra ID P2) + Agent 365, so it genuinely
 * covers all three categories at once — which is the only reason it is allowed
 * to REPLACE the three specific links rather than sit beside them.
 *
 * That every customer reaching this platform is here for a Copilot Readiness
 * Assessment is what makes it the better recommendation at tier 3 specifically:
 * a tenant gapped in all three is buying Copilot licensing anyway, and three
 * stacked add-ons is the more expensive way to arrive at less.
 */
export const MICROSOFT_365_E7: LicenseGapSku = {
  key: "microsoft-365-e7",
  name: "Microsoft 365 E7",
  url: "https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft365-plans-and-pricing",
};

/**
 * Where the customer's own admin actually completes the purchase. Microsoft
 * Learn's own navigation, quoted rather than linked — see the header.
 */
export const LICENSE_GAP_ADMIN_CENTER_PATH =
  "your own Microsoft 365 admin center (admin.microsoft.com → Billing → Purchase products)";

export interface LicenseGapCategory {
  readonly key: LicenseGapCategoryKey;
  readonly label: string;
  /** The real `monitor_checks.key`s whose licence gap puts a tenant in this category. */
  readonly checkKeys: readonly string[];
  readonly sku: LicenseGapSku;
}

/**
 * The corrected 3-category table (#489, 2026-08-06 comment). Every key here is
 * a check confirmed to classify as `license_gap` against real tenant data:
 * the two PIM checks via a live `AadPremiumLicenseRequired` Graph error
 * (#488/#495), the four Defender for Office 365 checks confirmed already
 * correctly classified, and the six compliance/retention checks confirmed by
 * #484 and #486.
 */
export const LICENSE_GAP_CATEGORIES: Readonly<Record<LicenseGapCategoryKey, LicenseGapCategory>> = {
  identity: {
    key: "identity",
    label: "Identity & privileged access",
    checkKeys: ["identity:pim-eligible-roles", "identity:pim-groups"],
    sku: ENTRA_ID_P2,
  },
  mailSecurity: {
    key: "mailSecurity",
    label: "Mail security",
    checkKeys: [
      "security:antiphishing-coverage",
      "security:safe-attachments-coverage",
      "security:safe-links-coverage",
      "security:dlp-violations",
    ],
    sku: DEFENDER_FOR_OFFICE_365,
  },
  compliance: {
    key: "compliance",
    label: "Compliance & data governance",
    checkKeys: [
      "governance:retention-label-adoption",
      "governance:retention-policy-coverage",
      "compliance:weak-dlp-policies",
      "compliance:label-errors",
      "compliance:dlp-incidents",
      "compliance:missing-labels",
    ],
    sku: PURVIEW_SUITE,
  },
};

const CATEGORY_BY_CHECK_KEY = new Map<string, LicenseGapCategoryKey>();
for (const key of LICENSE_GAP_CATEGORY_KEYS) {
  for (const checkKey of LICENSE_GAP_CATEGORIES[key].checkKeys) {
    CATEGORY_BY_CHECK_KEY.set(checkKey, key);
  }
}

/** Which of the three categories a check key belongs to, or null. Pure. */
export function licenseGapCategoryForCheckKey(
  checkKey: string | null | undefined,
): LicenseGapCategoryKey | null {
  if (!checkKey) return null;
  return CATEGORY_BY_CHECK_KEY.get(String(checkKey).trim()) ?? null;
}

/** One purchase call-to-action: a SKU, the categories it answers, the tenant's own evidence. */
export interface LicenseGapRecommendation {
  /** Every gapped category this one link covers. Length 3 only at tier 3 (E7). */
  readonly categoryKeys: readonly LicenseGapCategoryKey[];
  /**
   * The same categories' customer-facing names, resolved here so a renderer
   * never has to hold its own copy of the category table to say what a link
   * covers. The labels are data about the categories, which this file owns;
   * the sentence they end up inside is each surface's own copy.
   */
  readonly categoryLabels: readonly string[];
  readonly sku: LicenseGapSku;
  /** THIS tenant's real gapped check keys behind the link — never the full category list. */
  readonly checkKeys: readonly string[];
}

export interface LicenseGapPurchase {
  /** How many of the three categories are gapped — the tier itself. */
  readonly tier: 1 | 2 | 3;
  readonly gappedCategories: readonly LicenseGapCategoryKey[];
  /** True at tier 3 only: one consolidated ask replaced three separate ones. */
  readonly consolidated: boolean;
  readonly recommendations: readonly LicenseGapRecommendation[];
  readonly adminCenterPath: string;
  /**
   * Gapped checks belonging to none of the three categories. Carried, not
   * dropped: they are real gaps this tenant has and the absence of a link for
   * them is a fact about OUR mapping, not about their tenant. The caller logs
   * them; nothing renders a purchase link from them.
   */
  readonly uncategorisedCheckKeys: readonly string[];
}

/**
 * The 1/2/3 tiering rule, over the check keys this tenant's own latest run
 * classified as `license_gap`.
 *
 *   1 category gapped  → that category's specific add-on.
 *   2 categories       → both specific add-ons, individually. Explicitly NOT E7:
 *                        two add-ons is genuinely cheaper than the suite, and
 *                        recommending the suite here would be an upsell dressed
 *                        as advice.
 *   3 categories       → Microsoft 365 E7, as the single consolidated path.
 *                        The individual findings still say exactly what is
 *                        missing — that is what makes the recommendation
 *                        credible — but the call to action is one link, not
 *                        three separate purchase asks.
 *
 * Returns null when nothing is gapped. A tenant with no licence gap gets no
 * section, no link and no mention: there is nothing to recommend.
 */
export function buildLicenseGapPurchase(
  gappedCheckKeys: Iterable<string>,
): LicenseGapPurchase | null {
  const byCategory = new Map<LicenseGapCategoryKey, string[]>();
  const uncategorised: string[] = [];
  const seen = new Set<string>();

  for (const raw of gappedCheckKeys) {
    const checkKey = String(raw ?? "").trim();
    if (!checkKey || seen.has(checkKey)) continue;
    seen.add(checkKey);

    const category = licenseGapCategoryForCheckKey(checkKey);
    if (!category) {
      uncategorised.push(checkKey);
      continue;
    }
    const list = byCategory.get(category) ?? [];
    list.push(checkKey);
    byCategory.set(category, list);
  }

  // Declared order, not discovery order, so two runs of the same tenant cannot
  // render the same recommendation in two different sequences.
  const gappedCategories = LICENSE_GAP_CATEGORY_KEYS.filter((k) => byCategory.has(k));
  if (gappedCategories.length === 0) return null;

  const tier = gappedCategories.length as 1 | 2 | 3;
  const consolidated = tier === 3;

  const recommendations: LicenseGapRecommendation[] = consolidated
    ? [
        {
          categoryKeys: gappedCategories,
          categoryLabels: gappedCategories.map((k) => LICENSE_GAP_CATEGORIES[k].label),
          sku: MICROSOFT_365_E7,
          checkKeys: gappedCategories.flatMap((k) => byCategory.get(k) ?? []),
        },
      ]
    : gappedCategories.map((k) => ({
        categoryKeys: [k],
        categoryLabels: [LICENSE_GAP_CATEGORIES[k].label],
        sku: LICENSE_GAP_CATEGORIES[k].sku,
        checkKeys: byCategory.get(k) ?? [],
      }));

  return {
    tier,
    gappedCategories,
    consolidated,
    recommendations,
    adminCenterPath: LICENSE_GAP_ADMIN_CENTER_PATH,
    uncategorisedCheckKeys: uncategorised,
  };
}

/**
 * The recommendation covering one check key, or null when that check is not one
 * of the twelve. This is how a per-finding link is resolved: the tier was
 * already decided tenant-wide, so at tier 3 every gapped check resolves to the
 * SAME E7 recommendation and no caller can accidentally re-derive three links
 * out of a consolidated one.
 */
export function recommendationForCheckKey(
  purchase: LicenseGapPurchase | null | undefined,
  checkKey: string | null | undefined,
): LicenseGapRecommendation | null {
  if (!purchase || !checkKey) return null;
  const key = String(checkKey).trim();
  return purchase.recommendations.find((r) => r.checkKeys.includes(key)) ?? null;
}
