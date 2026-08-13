/**
 * Services — the real shapes, and the pure helpers that operate on them.
 *
 * This is the Products Catalog `CLAUDE.md`'s no-hardcoding rule points at:
 * `services` (Drizzle `servicesTable`, `lib/db/src/schema/index.ts`), reached
 * through `admin-services.ts`. It is a large table — assessments, retainers,
 * monitoring tiers, projects, credit packs and more all live in one row shape,
 * disambiguated by `serviceClass`/`deliveryType`/`fulfillmentType`/`serviceType`
 * and a per-type `typeAttributes` bag (`artifacts/api-server/src/lib/
 * productTypeConfig.ts` owns the eight per-type schemas).
 *
 * `Service` here is wider than the earlier cut of this file — it now carries
 * every `target: "core"` field the eight `PRODUCT_TYPE_CONFIGS` sections
 * (`@/lib/productTypeConfig.ts`) can write to, because `ServiceEditorDialog`
 * renders those sections for real (via the v1 panel's own `SectionCard`/
 * `FieldRenderer`, imported rather than re-implemented) instead of a raw
 * `typeAttributes` JSON box. A field the config can write is a field
 * `toUpdatePayload` must serialise explicitly — see that function's doc
 * comment for why leaving one to `extra` is not just incomplete but unsafe.
 */

export type BillingType = "one_time" | "recurring_monthly" | "recurring" | "fixed";
export type Visibility = "public" | "private" | "landing_page_only";
export type ServiceClass = "project" | "add_on" | "subscription" | null;
export type DeliveryType = "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none" | null;

/**
 * A `services` row, as `GET /api/admin/services` returns it — the fields this
 * screen reads or writes. The real table carries more (monitoring-tier legacy
 * flat columns, `orderWorkflow`, `overviewPdfKey`, ...); those pass through
 * `extra` unexamined rather than being typed and silently dropped on save.
 */
export interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  categoryPath: string | null;
  tagline: string | null;
  deliverables: string[] | null;
  tags: string[] | null;
  billingType: BillingType;
  visibility: Visibility;
  isPublic: boolean;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  priceCents: number | null;
  internalCostCents: number | null;
  annualPriceCents: number | null;
  serviceClass: ServiceClass;
  deliveryType: DeliveryType;
  fulfillmentType: string | null;
  serviceType: string | null;
  typeAttributes: Record<string, unknown> | null;
  sortOrder: number;
  highlighted: boolean;
  isFreeOffering: boolean;
  overviewPdfKey: string | null;
  overviewPdfGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // ── The rest of PRODUCT_TYPE_CONFIGS' `target: "core"` field set ───────────
  durationDays: number | null;
  turnaround: string | null;
  hoursPerMonth: string | null;
  allowFreeCheckout: boolean;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  iconName: string | null;
  pageHref: string | null;
  badge: string | null;
  tier: string | null;
  fulfillmentTypeKey: string | null;
  triggeringSignalKeys: string[] | null;
  customerAgreementTemplate: string | null;
  requiredAppPermissions: { scope: string; reason: string }[] | null;

  /** Every other column the row carries. Preserved so a save never nulls a field this screen doesn't know about. */
  extra: Record<string, unknown>;
}

const KNOWN_KEYS = new Set<string>([
  "id", "slug", "name", "description", "category", "categoryPath", "tagline",
  "deliverables", "tags", "billingType", "visibility", "isPublic",
  "price", "basePrice", "maxPrice", "priceCents", "internalCostCents", "annualPriceCents",
  "serviceClass", "deliveryType", "fulfillmentType", "serviceType", "typeAttributes",
  "sortOrder", "highlighted", "isFreeOffering", "overviewPdfKey", "overviewPdfGeneratedAt",
  "createdAt", "updatedAt",
  "durationDays", "turnaround", "hoursPerMonth", "allowFreeCheckout", "targetAudience",
  "inclusions", "features", "iconName", "pageHref", "badge", "tier",
  "fulfillmentTypeKey", "triggeringSignalKeys", "customerAgreementTemplate", "requiredAppPermissions",
  // Computed fields `resolveCatalogPricing` spreads onto every GET row — not real columns, dropped rather than round-tripped.
  "wholesaleCostCents", "retailPriceCents", "mspMarginCents",
]);

/** Parses one raw `admin-services.ts` row into a `Service`, keeping anything unknown in `extra`. */
export function parseService(raw: Record<string, unknown>): Service {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }
  return {
    id: Number(raw.id),
    slug: (raw.slug as string) ?? null,
    name: String(raw.name ?? ""),
    description: (raw.description as string) ?? null,
    category: (raw.category as string) ?? null,
    categoryPath: (raw.categoryPath as string) ?? null,
    tagline: (raw.tagline as string) ?? null,
    deliverables: Array.isArray(raw.deliverables) ? (raw.deliverables as string[]) : null,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : null,
    billingType: (raw.billingType as BillingType) ?? "one_time",
    visibility: (raw.visibility as Visibility) ?? (raw.isPublic ? "public" : "private"),
    isPublic: Boolean(raw.isPublic),
    price: raw.price != null ? String(raw.price) : null,
    basePrice: raw.basePrice != null ? String(raw.basePrice) : null,
    maxPrice: raw.maxPrice != null ? String(raw.maxPrice) : null,
    priceCents: raw.priceCents != null ? Number(raw.priceCents) : null,
    internalCostCents: raw.internalCostCents != null ? Number(raw.internalCostCents) : null,
    annualPriceCents: raw.annualPriceCents != null ? Number(raw.annualPriceCents) : null,
    serviceClass: (raw.serviceClass as ServiceClass) ?? null,
    deliveryType: (raw.deliveryType as DeliveryType) ?? null,
    fulfillmentType: (raw.fulfillmentType as string) ?? null,
    serviceType: (raw.serviceType as string) ?? null,
    typeAttributes: raw.typeAttributes && typeof raw.typeAttributes === "object" ? (raw.typeAttributes as Record<string, unknown>) : null,
    sortOrder: Number(raw.sortOrder ?? 0),
    highlighted: Boolean(raw.highlighted),
    isFreeOffering: Boolean(raw.isFreeOffering),
    overviewPdfKey: (raw.overviewPdfKey as string) ?? null,
    overviewPdfGeneratedAt: (raw.overviewPdfGeneratedAt as string) ?? null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    durationDays: raw.durationDays != null ? Number(raw.durationDays) : null,
    turnaround: (raw.turnaround as string) ?? null,
    hoursPerMonth: raw.hoursPerMonth != null ? String(raw.hoursPerMonth) : null,
    allowFreeCheckout: Boolean(raw.allowFreeCheckout),
    targetAudience: (raw.targetAudience as string) ?? null,
    inclusions: Array.isArray(raw.inclusions) ? (raw.inclusions as string[]) : null,
    features: Array.isArray(raw.features) ? (raw.features as string[]) : null,
    iconName: (raw.iconName as string) ?? null,
    pageHref: (raw.pageHref as string) ?? null,
    badge: (raw.badge as string) ?? null,
    tier: (raw.tier as string) ?? null,
    fulfillmentTypeKey: (raw.fulfillmentTypeKey as string) ?? null,
    triggeringSignalKeys: Array.isArray(raw.triggeringSignalKeys) ? (raw.triggeringSignalKeys as string[]) : null,
    customerAgreementTemplate: (raw.customerAgreementTemplate as string) ?? null,
    requiredAppPermissions: Array.isArray(raw.requiredAppPermissions) ? (raw.requiredAppPermissions as { scope: string; reason: string }[]) : null,
    extra,
  };
}

/**
 * Serialises a `Service` back to the shape `PUT /admin/services/:id` expects.
 *
 * The route sets almost every column unconditionally from the body — a field
 * missing from the request is written as NULL (see `admin-services.ts`'s own
 * `centsColumnUpdates` comment, which documents exactly this bug class for the
 * three cents columns and had to special-case them). The only safe PUT is
 * therefore the FULL current record with edits merged in, never a partial
 * patch — which is why `updateService` (`servicesStore.ts`) always sends this,
 * built from a row this screen already has in memory rather than a sparse diff.
 */
export function toUpdatePayload(s: Service): Record<string, unknown> {
  return {
    ...s.extra,
    name: s.name,
    slug: s.slug,
    description: s.description,
    category: s.category,
    categoryPath: s.categoryPath,
    tagline: s.tagline,
    deliverables: s.deliverables,
    tags: s.tags,
    billingType: s.billingType,
    visibility: s.visibility,
    isPublic: s.visibility === "public",
    price: s.price,
    basePrice: s.basePrice,
    maxPrice: s.maxPrice,
    priceCents: s.priceCents,
    internalCostCents: s.internalCostCents,
    annualPriceCents: s.annualPriceCents,
    serviceClass: s.serviceClass,
    deliveryType: s.deliveryType,
    fulfillmentType: s.fulfillmentType,
    serviceType: s.serviceType,
    typeAttributes: s.typeAttributes,
    sortOrder: s.sortOrder,
    highlighted: s.highlighted,
    isFreeOffering: s.isFreeOffering,
    durationDays: s.durationDays,
    turnaround: s.turnaround,
    hoursPerMonth: s.hoursPerMonth,
    allowFreeCheckout: s.allowFreeCheckout,
    targetAudience: s.targetAudience,
    inclusions: s.inclusions,
    features: s.features,
    iconName: s.iconName,
    pageHref: s.pageHref,
    badge: s.badge,
    tier: s.tier,
    fulfillmentTypeKey: s.fulfillmentTypeKey,
    triggeringSignalKeys: s.triggeringSignalKeys,
    customerAgreementTemplate: s.customerAgreementTemplate,
    requiredAppPermissions: s.requiredAppPermissions,
  };
}

export function usd(cents: number): string {
  return "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Effective retail price in cents — `price`/`basePrice` (dollars) fallback for
 * rows the legacy editor wrote, `priceCents` (the canonical column) otherwise.
 * Ported from `resolveServicePriceCents` (`catalog-pricing.ts`) rather than
 * imported — no shared-code channel between `api-server` and `admin-panel`
 * other than a `lib/*` workspace package, and this is the platform's own
 * canonical resolver, not a screen-local guess.
 *
 * Worth keeping separate from the `retailPriceCents` the GET route spreads
 * onto every row: that field is `resolveCatalogPricing({priceCents: s.priceCents
 * ?? 0, ...})` — it reads `priceCents` ONLY, so it shows $0 for a legacy row
 * whose real price only ever landed in `price`/`basePrice`. Using it here would
 * make this screen the guilty backfill this platform is still repairing.
 */
export function effectivePriceCents(s: Service): number {
  if (s.priceCents != null && s.priceCents > 0) return Math.round(s.priceCents);
  const legacy = s.price ?? s.basePrice;
  if (legacy != null) {
    const dollars = parseFloat(legacy);
    if (!isNaN(dollars) && dollars > 0) return Math.round(dollars * 100);
  }
  return 0;
}

export function dollarsInputToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[^0-9.]/g, "");
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : Math.round(n * 100);
}

export function centsToDollarsInput(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

export const BILLING_LABEL: Record<BillingType, string> = {
  one_time: "one-time",
  recurring_monthly: "per month",
  recurring: "recurring (legacy)",
  fixed: "fixed",
};

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Public",
  private: "Private",
  landing_page_only: "Landing page only",
};

export const BILLING_TYPES: BillingType[] = ["one_time", "recurring_monthly"];
export const VISIBILITIES: Visibility[] = ["public", "private", "landing_page_only"];
export const SERVICE_CLASSES: ServiceClass[] = ["project", "add_on", "subscription", null];
export const DELIVERY_TYPES: DeliveryType[] = ["assessment", "bundle_subscription", "retainer", "document_generation", "none", null];

/**
 * `services` has no true category tree — `categoryPath` is an operator-typed
 * `/`-separated string (`admin-services.ts`'s `reparent-category` route treats
 * it as a path, not a foreign key). This screen groups by its FIRST segment
 * only, the same one-level-deep choice `endpointsTypes.ts`'s `domainOf` makes
 * for check keys: a full nested tree view is real UI on its own, and one level
 * is enough to make a 40-row catalog scannable, which is what the Explorer
 * panel needs it for.
 */
export function topCategory(s: Service): string {
  const path = s.categoryPath || s.category;
  if (!path) return "Uncategorised";
  const idx = path.indexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

/** A service the public catalog shows but nobody can actually buy — real, actionable, Watch-tab material. */
export function hasNoPrice(s: Service): boolean {
  return s.visibility === "public" && !s.isFreeOffering && effectivePriceCents(s) === 0;
}

export function suggestSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
