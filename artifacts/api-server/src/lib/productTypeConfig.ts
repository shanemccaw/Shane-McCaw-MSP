// ─── Product Type Config (API Server) ────────────────────────────────────────
// Single source of truth for product type detection, import/export field sets,
// and JSON template generation. Shared with the admin panel frontend (same
// module structure, duplicated per-artifact since we can't import across libs).

export type ProductTypeKey =
  | "credit_pack"
  | "assessment"
  | "project"
  | "retainer"
  | "monitoring_tier"
  | "recurring_addon"
  | "document_product"
  | "platform_subscription_tier";

// ── Detection ─────────────────────────────────────────────────────────────────

export function detectProductType(
  serviceClass: string | null | undefined,
  deliveryType: string | null | undefined,
  billingType?: string | null,
  fulfillmentType?: string | null,
): ProductTypeKey {
  if (fulfillmentType === "msp_monthly_subscription") return "platform_subscription_tier";
  if (serviceClass === "subscription" && deliveryType === "bundle_subscription") return "monitoring_tier";
  if (serviceClass === "add_on" && deliveryType === "none") {
    return billingType === "recurring_monthly" ? "recurring_addon" : "credit_pack";
  }
  if (deliveryType === "document_generation") return "document_product";
  if (deliveryType === "assessment") return "assessment";
  if (deliveryType === "retainer") return "retainer";
  return "project";
}

// ── Common import fields (all types) ─────────────────────────────────────────

export const COMMON_IMPORT_FIELDS = new Set([
  "slug", "name", "description", "category", "categoryPath", "tagline", "serviceType",
  "billingType", "visibility", "isPublic", "isActive", "label",
  "tier", "highlighted", "badge", "iconName", "sortOrder", "tags", "isFreeOffering",
  "serviceClass", "deliveryType", "fulfillmentType",
  "typeAttributes",
]);

// ── Per-type import field allow-lists ─────────────────────────────────────────

export const PRODUCT_TYPE_IMPORT_FIELDS: Record<ProductTypeKey, Set<string>> = {
  credit_pack: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "deliverables", "inclusions", "features", "targetAudience",
    "allowFreeCheckout",
  ]),
  assessment: new Set([
    ...COMMON_IMPORT_FIELDS,
    "basePrice", "maxPrice", "durationDays", "deliverables", "inclusions", "features",
    "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys",
    "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "hoursPerMonth",
    "allowFreeCheckout",
  ]),
  project: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "basePrice", "maxPrice", "durationDays", "turnaround", "deliverables",
    "inclusions", "features", "requiredAppPermissions", "fulfillmentTypeKey",
    "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId",
    "targetAudience", "hoursPerMonth", "allowFreeCheckout",
  ]),
  retainer: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "hoursPerMonth", "deliverables", "inclusions", "features",
    "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys",
    "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "allowFreeCheckout",
  ]),
  monitoring_tier: new Set([
    ...COMMON_IMPORT_FIELDS,
    // All monitoring-tier-specific data goes into typeAttributes
  ]),
  recurring_addon: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "deliverables", "inclusions", "features", "targetAudience",
    "allowFreeCheckout",
  ]),
  document_product: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "basePrice", "maxPrice", "deliverables", "inclusions", "features",
    "targetAudience", "allowFreeCheckout",
  ]),
  platform_subscription_tier: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "features", "inclusions", "badge", "highlighted", "sortOrder",
    "fulfillmentTypeKey",
  ]),
};

// ── Per-type export field lists ───────────────────────────────────────────────

const COMMON_EXPORT_FIELDS = [
  "slug", "name", "description", "category", "categoryPath", "tagline", "serviceType",
  "billingType", "visibility", "isPublic", "tier", "highlighted", "badge",
  "iconName", "sortOrder", "tags", "isFreeOffering", "serviceClass", "deliveryType",
];

export const PRODUCT_TYPE_EXPORT_FIELDS: Record<ProductTypeKey, string[]> = {
  credit_pack: [
    ...COMMON_EXPORT_FIELDS,
    "price", "deliverables", "inclusions", "features", "targetAudience", "allowFreeCheckout",
    "typeAttributes",
  ],
  assessment: [
    ...COMMON_EXPORT_FIELDS,
    "basePrice", "maxPrice", "durationDays", "deliverables", "inclusions", "features",
    "targetAudience", "hoursPerMonth", "requiredAppPermissions", "fulfillmentTypeKey",
    "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId",
    "allowFreeCheckout", "typeAttributes",
  ],
  project: [
    ...COMMON_EXPORT_FIELDS,
    "price", "basePrice", "maxPrice", "durationDays", "turnaround", "deliverables",
    "inclusions", "features", "targetAudience", "hoursPerMonth", "requiredAppPermissions",
    "fulfillmentTypeKey", "triggeringSignalKeys", "customerAgreementTemplate",
    "workflowTemplateId", "allowFreeCheckout", "typeAttributes",
  ],
  retainer: [
    ...COMMON_EXPORT_FIELDS,
    "price", "hoursPerMonth", "deliverables", "inclusions", "features", "targetAudience",
    "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys",
    "customerAgreementTemplate", "workflowTemplateId", "allowFreeCheckout", "typeAttributes",
  ],
  monitoring_tier: [
    ...COMMON_EXPORT_FIELDS,
    "typeAttributes",
  ],
  recurring_addon: [
    ...COMMON_EXPORT_FIELDS,
    "price", "deliverables", "inclusions", "features", "targetAudience",
    "allowFreeCheckout", "typeAttributes",
  ],
  document_product: [
    ...COMMON_EXPORT_FIELDS,
    "price", "basePrice", "maxPrice", "deliverables", "inclusions", "features",
    "targetAudience", "allowFreeCheckout", "typeAttributes",
  ],
  platform_subscription_tier: [
    ...COMMON_EXPORT_FIELDS,
    "fulfillmentType", "price", "features", "inclusions", "badge", "highlighted",
    "sortOrder", "fulfillmentTypeKey", "typeAttributes",
  ],
};

// ── JSON download templates ───────────────────────────────────────────────────

export const PRODUCT_TYPE_TEMPLATES: Record<ProductTypeKey, Record<string, unknown>> = {
  credit_pack: {
    serviceClass: "add_on",
    deliveryType: "none",
    billingType: "one_time",
    slug: "example-credit-pack",
    name: "Example Credit Pack",
    description: "A bundle of AI credits redeemable across any tenant.",
    category: "Add-ons",
    categoryPath: "Add-ons",
    price: 299,
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["credits", "add-on"],
    deliverables: ["Credit bundle applied to tenant account"],
    inclusions: ["Immediate activation"],
    features: ["AI credit top-up", "No expiry"],
    targetAudience: "MSPs who need additional AI credits",
    typeAttributes: {},
  },
  assessment: {
    serviceClass: null,
    deliveryType: "assessment",
    billingType: "one_time",
    slug: "example-assessment",
    name: "Example Assessment",
    description: "A one-time diagnostic review with a detailed findings report.",
    category: "Assessments",
    categoryPath: "Assessments",
    basePrice: 1500,
    maxPrice: 3000,
    durationDays: 14,
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["assessment", "diagnostic"],
    deliverables: ["Written findings report", "Remediation roadmap"],
    inclusions: ["Two stakeholder interviews", "Tenant health scan"],
    features: ["Actionable recommendations", "Executive summary"],
    targetAudience: "IT leaders evaluating their M365 posture",
    requiredAppPermissions: [
      { scope: "User.Read.All", reason: "Enumerate licensed users" },
    ],
    fulfillmentTypeKey: null,
    triggeringSignalKeys: [],
    customerAgreementTemplate: null,
    workflowTemplateId: null,
    hoursPerMonth: null,
    typeAttributes: {},
  },
  project: {
    serviceClass: "project",
    deliveryType: null,
    billingType: "one_time",
    slug: "example-project",
    name: "Example Project",
    description: "A scoped implementation project requiring a signed SOW.",
    category: "Projects",
    categoryPath: "Projects",
    price: 5000,
    basePrice: 4000,
    maxPrice: 8000,
    durationDays: 30,
    turnaround: "4 weeks",
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["project", "implementation"],
    deliverables: ["Configured environment", "Training session", "Handover documentation"],
    inclusions: ["Project kickoff", "Weekly status calls", "Post-launch support (14 days)"],
    features: ["Dedicated PM", "Change management guidance"],
    targetAudience: "Organisations migrating to M365",
    requiredAppPermissions: [],
    fulfillmentTypeKey: null,
    triggeringSignalKeys: [],
    customerAgreementTemplate: null,
    workflowTemplateId: null,
    hoursPerMonth: null,
    typeAttributes: {},
  },
  retainer: {
    serviceClass: null,
    deliveryType: "retainer",
    billingType: "recurring_monthly",
    slug: "example-retainer",
    name: "Example Retainer",
    description: "An ongoing monthly engagement billed at a fixed rate.",
    category: "Retainers",
    categoryPath: "Retainers",
    price: 1200,
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["retainer", "ongoing"],
    deliverables: ["Monthly status report"],
    inclusions: ["On-call advisory (business hours)", "Quarterly review call"],
    features: ["Flexible scope", "Priority response"],
    targetAudience: "Clients needing ongoing M365 advisory",
    hoursPerMonth: "10 hours",
    requiredAppPermissions: [],
    fulfillmentTypeKey: null,
    triggeringSignalKeys: [],
    customerAgreementTemplate: null,
    workflowTemplateId: null,
    typeAttributes: {},
  },
  monitoring_tier: {
    serviceClass: "subscription",
    deliveryType: "bundle_subscription",
    billingType: "recurring_monthly",
    slug: "example-monitoring-tier",
    name: "Example Monitoring Tier",
    description: "An MSP monitoring bundle with per-seat pricing and included engines.",
    category: "Monitoring",
    categoryPath: "Monitoring",
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["monitoring", "msp"],
    typeAttributes: {
      tenantTierLabel: "Core",
      seatMin: 1,
      seatMax: 50,
      includedEngines: ["priority", "health", "drift"],
      includedFeatures: ["advanced_signals", "custom_workflows"],
      pricePerUserMonth: "8.00",
      seatCountFloor: 5,
      minMspPlanTier: "starter",
      flatMonthlySurcharge: null,
    },
  },
  recurring_addon: {
    serviceClass: "add_on",
    deliveryType: "none",
    billingType: "recurring_monthly",
    slug: "example-recurring-addon",
    name: "Example Recurring Add-on",
    description: "A monthly recurring add-on with a flat monthly price.",
    category: "Add-ons",
    categoryPath: "Add-ons",
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["addon", "recurring"],
    deliverables: [],
    inclusions: [],
    features: [],
    targetAudience: null,
    typeAttributes: {
      flatMonthlyPrice: "29.00",
    },
  },
  document_product: {
    serviceClass: null,
    deliveryType: "document_generation",
    billingType: "one_time",
    slug: "example-document-product",
    name: "Example Document Product",
    description: "An automated document generation product.",
    category: "Documents",
    categoryPath: "Documents",
    price: 199,
    basePrice: 149,
    maxPrice: 299,
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    tags: ["document", "report"],
    deliverables: ["Generated document"],
    inclusions: [],
    features: [],
    targetAudience: null,
    typeAttributes: {
      documentTier: "standard",
      relatedProductSlug: null,
    },
  },
  platform_subscription_tier: {
    serviceClass: "subscription",
    deliveryType: "bundle_subscription",
    fulfillmentType: "msp_monthly_subscription",
    billingType: "recurring_monthly",
    slug: "example-platform-tier",
    name: "Example Platform Tier",
    description: "An MSP platform subscription tier.",
    category: "Platform",
    categoryPath: "Platform",
    price: 99,
    visibility: "private",
    isPublic: false,
    isFreeOffering: false,
    sortOrder: 0,
    badge: null,
    highlighted: false,
    tags: ["platform", "msp"],
    features: ["Dedicated MSP dashboard", "Priority support"],
    inclusions: ["Platform access", "Onboarding session"],
    typeAttributes: {
      tenantAllowance: 50,
      aiCreditAllowancePlatformValue: 1000,
      aiCreditAllowanceMspValue: 500,
      aiCreditOverageRateCents: 5,
      overageRateCents: 1000,
      tierCapabilities: {
        advanced_signals: true,
        custom_workflows: false,
        sla_scope_creep_custom_rules: false,
        sales_offers: false,
        custom_bundle_composition: false,
      },
    },
  },
};
