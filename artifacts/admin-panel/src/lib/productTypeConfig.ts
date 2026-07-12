// ─── Product Type Config (Admin Panel) ───────────────────────────────────────
// Single source of truth for product type detection, editor field definitions,
// and import/export validation. Mirrors the backend version in api-server.

export type ProductTypeKey =
  | "credit_pack"
  | "assessment"
  | "project"
  | "retainer"
  | "monitoring_tier"
  | "recurring_addon"
  | "document_product"
  | "platform_subscription_tier";

export type FieldKind =
  | "text"
  | "textarea"
  | "currency"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "jsonb-array"
  | "seat-range"
  | "engine-picker"
  | "feature-picker"
  | "capabilities-editor"
  | "icon-picker"
  | "category-path"
  | "permissions-array";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** Property key on the service object (core) or typeAttributes key (typeAttributes) */
  key: string;
  label: string;
  kind: FieldKind;
  /** "core" = top-level service field; "typeAttributes" = inside service.typeAttributes */
  target: "core" | "typeAttributes";
  options?: SelectOption[];
  placeholder?: string;
  hint?: string;
}

export interface SectionDef {
  key: string;
  label: string;
  fields: FieldDef[];
}

export interface ProductTypeConfig {
  key: ProductTypeKey;
  label: string;
  description: string;
  serviceClass: "project" | "add_on" | "subscription" | null;
  deliveryType: "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none" | null;
  defaultBillingType: "one_time" | "recurring_monthly";
  fulfillmentType?: "standard" | "msp_monthly_subscription";
  /** Ordered list of editor sections; rendered top-to-bottom */
  sections: SectionDef[];
  showGenPdf: boolean;
  showWorkflowTemplate: boolean;
  /** Legacy compat — used by ServiceEditorSidePanel and CatalogProductList */
  showFields: {
    priceFixed: boolean;
    priceRange: boolean;
    duration: boolean;
    turnaround: boolean;
    assignToClient: boolean;
    projectTemplate: boolean;
    genPdf: boolean;
    monitoringTier: boolean;
  };
}

// ── Shared section fragments ──────────────────────────────────────────────────

const IDENTITY_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", kind: "text", target: "core", placeholder: "Service name" },
  { key: "slug", label: "Slug", kind: "text", target: "core", placeholder: "url-friendly-slug" },
  { key: "tagline", label: "Tagline", kind: "text", target: "core", placeholder: "One-line summary" },
  { key: "description", label: "Description", kind: "textarea", target: "core", placeholder: "Full description…" },
];

const CATALOG_FIELDS: FieldDef[] = [
  { key: "category", label: "Category", kind: "text", target: "core" },
  { key: "categoryPath", label: "Category Path", kind: "category-path", target: "core", hint: "Slash-delimited, e.g. Monitoring/Core" },
  { key: "sortOrder", label: "Sort Order", kind: "number", target: "core" },
  { key: "iconName", label: "Icon Name", kind: "icon-picker", target: "core" },
  { key: "pageHref", label: "Page Href", kind: "text", target: "core", placeholder: "/services/..." },
  { key: "badge", label: "Badge", kind: "text", target: "core", placeholder: "e.g. Popular, New" },
  { key: "highlighted", label: "Highlighted", kind: "boolean", target: "core" },
  { key: "tier", label: "Tier Label", kind: "text", target: "core" },
  { key: "tags", label: "Tags", kind: "jsonb-array", target: "core" },
  {
    key: "visibility", label: "Visibility", kind: "select", target: "core",
    options: [
      { value: "public", label: "Public" },
      { value: "private", label: "Private" },
      { value: "landing_page_only", label: "Landing Page Only" },
    ],
  },
  { key: "isFreeOffering", label: "Free Offering", kind: "boolean", target: "core", hint: "Skips Stripe checkout — clients accept at $0" },
];

const FULFILLMENT_FIELDS: FieldDef[] = [
  { key: "fulfillmentTypeKey", label: "Fulfillment Type", kind: "select", target: "core", hint: "Lifecycle type triggered at checkout" },
  { key: "triggeringSignalKeys", label: "Triggering Signals", kind: "multiselect", target: "core", hint: "Tenant signals that auto-trigger fulfillment" },
  { key: "customerAgreementTemplate", label: "Customer Agreement Template", kind: "textarea", target: "core", placeholder: "Per-service agreement text shown to clients…" },
  { key: "requiredAppPermissions", label: "Required App Permissions", kind: "permissions-array", target: "core", hint: "MS Graph / AAD scopes required by this service's runbooks" },
];

const CONTENT_FIELDS: FieldDef[] = [
  { key: "targetAudience", label: "Target Audience", kind: "textarea", target: "core" },
  { key: "deliverables", label: "Deliverables", kind: "jsonb-array", target: "core" },
  { key: "inclusions", label: "Inclusions", kind: "jsonb-array", target: "core" },
  { key: "features", label: "Features", kind: "jsonb-array", target: "core" },
];

const BILLING_TYPE_FIELD = (options: SelectOption[]): FieldDef => ({
  key: "billingType", label: "Billing Type", kind: "select", target: "core", options,
});

// ── Type configurations ───────────────────────────────────────────────────────

export const PRODUCT_TYPE_CONFIGS: Record<ProductTypeKey, ProductTypeConfig> = {
  credit_pack: {
    key: "credit_pack",
    label: "Credit Pack",
    description: "A one-time add-on purchase — no deliverables, no signature, instant checkout.",
    serviceClass: "add_on",
    deliveryType: "none",
    defaultBillingType: "one_time",
    showGenPdf: false,
    showWorkflowTemplate: false,
    showFields: { priceFixed: true, priceRange: false, duration: false, turnaround: false, assignToClient: false, projectTemplate: false, genPdf: false, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Price", kind: "currency", target: "core" },
          BILLING_TYPE_FIELD([{ value: "one_time", label: "One-time" }]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  assessment: {
    key: "assessment",
    label: "Assessment",
    description: "A diagnostic engagement with a price range, duration, and PDF deliverable.",
    serviceClass: null,
    deliveryType: "assessment",
    defaultBillingType: "one_time",
    showGenPdf: true,
    showWorkflowTemplate: false,
    showFields: { priceFixed: false, priceRange: true, duration: true, turnaround: false, assignToClient: true, projectTemplate: false, genPdf: true, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "basePrice", label: "Base Price", kind: "currency", target: "core" },
          { key: "maxPrice", label: "Max Price", kind: "currency", target: "core" },
          { key: "durationDays", label: "Duration (days)", kind: "number", target: "core" },
          { key: "hoursPerMonth", label: "Hours", kind: "text", target: "core" },
          BILLING_TYPE_FIELD([{ value: "one_time", label: "One-time" }]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "fulfillment", label: "Fulfillment", fields: FULFILLMENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  project: {
    key: "project",
    label: "Project",
    description: "A scoped engagement with SOW, signature, price range, and project template.",
    serviceClass: "project",
    deliveryType: null,
    defaultBillingType: "one_time",
    showGenPdf: true,
    showWorkflowTemplate: true,
    showFields: { priceFixed: true, priceRange: true, duration: true, turnaround: true, assignToClient: true, projectTemplate: true, genPdf: true, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Price", kind: "currency", target: "core" },
          { key: "basePrice", label: "Base Price", kind: "currency", target: "core" },
          { key: "maxPrice", label: "Max Price", kind: "currency", target: "core" },
          { key: "durationDays", label: "Duration (days)", kind: "number", target: "core" },
          { key: "turnaround", label: "Turnaround", kind: "text", target: "core", placeholder: "e.g. 4 weeks" },
          { key: "hoursPerMonth", label: "Hours", kind: "text", target: "core" },
          BILLING_TYPE_FIELD([
            { value: "one_time", label: "One-time" },
            { value: "recurring_monthly", label: "Recurring Monthly" },
          ]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "fulfillment", label: "Fulfillment", fields: FULFILLMENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  retainer: {
    key: "retainer",
    label: "Retainer",
    description: "A recurring monthly engagement billed as a fixed subscription.",
    serviceClass: null,
    deliveryType: "retainer",
    defaultBillingType: "recurring_monthly",
    showGenPdf: true,
    showWorkflowTemplate: false,
    showFields: { priceFixed: true, priceRange: false, duration: false, turnaround: false, assignToClient: true, projectTemplate: false, genPdf: true, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Monthly Price", kind: "currency", target: "core" },
          { key: "hoursPerMonth", label: "Hours / Month", kind: "text", target: "core" },
          BILLING_TYPE_FIELD([{ value: "recurring_monthly", label: "Recurring Monthly" }]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "fulfillment", label: "Fulfillment", fields: FULFILLMENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  monitoring_tier: {
    key: "monitoring_tier",
    label: "Monitoring Tier",
    description: "An MSP monitoring bundle with per-seat pricing and included engines.",
    serviceClass: "subscription",
    deliveryType: "bundle_subscription",
    defaultBillingType: "recurring_monthly",
    showGenPdf: false,
    showWorkflowTemplate: false,
    showFields: { priceFixed: false, priceRange: false, duration: false, turnaround: false, assignToClient: false, projectTemplate: false, genPdf: false, monitoringTier: true },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "tier_config", label: "Tier Configuration", fields: [
          { key: "tenantTierLabel", label: "Tier Label", kind: "text", target: "typeAttributes", placeholder: "e.g. Core, Pro, Enterprise" },
          { key: "seatRange", label: "Seat Range (Min / Max)", kind: "seat-range", target: "typeAttributes", hint: "Inclusive seat range for this tier" },
          { key: "pricePerUserMonth", label: "Price / User / Month ($)", kind: "currency", target: "typeAttributes" },
          { key: "seatCountFloor", label: "Seat Count Floor", kind: "number", target: "typeAttributes", hint: "Minimum billable seat count" },
          { key: "flatMonthlySurcharge", label: "Flat Monthly Surcharge ($)", kind: "currency", target: "typeAttributes", hint: "Optional flat monthly add-on to per-seat pricing" },
          {
            key: "minMspPlanTier", label: "Min MSP Plan Tier", kind: "select", target: "typeAttributes",
            options: [
              { value: "", label: "— Any —" },
              { value: "starter", label: "Starter" },
              { value: "pro", label: "Pro" },
              { value: "business", label: "Business" },
              { value: "enterprise", label: "Enterprise" },
            ],
          },
        ],
      },
      {
        key: "engines", label: "Included Engines", fields: [
          { key: "includedEngines", label: "Engines", kind: "engine-picker", target: "typeAttributes", hint: "Engine Registry keys available on this tier" },
        ],
      },
      {
        key: "features", label: "Included Features", fields: [
          { key: "includedFeatures", label: "Plan Features", kind: "feature-picker", target: "typeAttributes", hint: "Plan-feature keys gated to this tier" },
        ],
      },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  recurring_addon: {
    key: "recurring_addon",
    label: "Recurring Add-on",
    description: "A monthly recurring add-on billed at a flat monthly rate.",
    serviceClass: "add_on",
    deliveryType: "none",
    defaultBillingType: "recurring_monthly",
    showGenPdf: false,
    showWorkflowTemplate: false,
    showFields: { priceFixed: true, priceRange: false, duration: false, turnaround: false, assignToClient: false, projectTemplate: false, genPdf: false, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Price (catalogue display)", kind: "currency", target: "core" },
          { key: "flatMonthlyPrice", label: "Flat Monthly Price ($)", kind: "currency", target: "typeAttributes" },
          BILLING_TYPE_FIELD([{ value: "recurring_monthly", label: "Recurring Monthly" }]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  document_product: {
    key: "document_product",
    label: "Document Product",
    description: "An automated document generation product (reports, proposals, etc.).",
    serviceClass: null,
    deliveryType: "document_generation",
    defaultBillingType: "one_time",
    showGenPdf: false,
    showWorkflowTemplate: false,
    showFields: { priceFixed: true, priceRange: true, duration: false, turnaround: false, assignToClient: false, projectTemplate: false, genPdf: false, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "doc_config", label: "Document Configuration", fields: [
          {
            key: "documentTier", label: "Document Tier", kind: "select", target: "typeAttributes",
            options: [
              { value: "standard", label: "Standard" },
              { value: "premium", label: "Premium" },
              { value: "enterprise", label: "Enterprise" },
            ],
          },
          { key: "relatedProductSlug", label: "Related Product Slug", kind: "text", target: "typeAttributes", hint: "Slug of the parent service this document supplements" },
        ],
      },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Price", kind: "currency", target: "core" },
          { key: "basePrice", label: "Base Price", kind: "currency", target: "core" },
          { key: "maxPrice", label: "Max Price", kind: "currency", target: "core" },
          BILLING_TYPE_FIELD([{ value: "one_time", label: "One-time" }]),
          { key: "allowFreeCheckout", label: "Allow Free Checkout", kind: "boolean", target: "core" },
        ],
      },
      { key: "content", label: "Content", fields: CONTENT_FIELDS },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },

  platform_subscription_tier: {
    key: "platform_subscription_tier",
    label: "Platform Subscription Tier",
    description: "An MSP platform billing tier — controls tenant allowances and capability gating.",
    serviceClass: "subscription",
    deliveryType: "bundle_subscription",
    defaultBillingType: "recurring_monthly",
    fulfillmentType: "msp_monthly_subscription",
    showGenPdf: false,
    showWorkflowTemplate: false,
    showFields: { priceFixed: true, priceRange: false, duration: false, turnaround: false, assignToClient: false, projectTemplate: false, genPdf: false, monitoringTier: false },
    sections: [
      { key: "identity", label: "Identity", fields: IDENTITY_FIELDS },
      {
        key: "pricing", label: "Pricing", fields: [
          { key: "price", label: "Monthly Price", kind: "currency", target: "core" },
          BILLING_TYPE_FIELD([{ value: "recurring_monthly", label: "Recurring Monthly" }]),
        ],
      },
      {
        key: "tenant_allowance", label: "Tenant Allowance", fields: [
          { key: "tenantAllowance", label: "Tenant Allowance", kind: "number", target: "typeAttributes", hint: "Max customer tenants included in flat fee (0 = unlimited)" },
          { key: "overageRateCents", label: "Overage Rate (¢/tenant/month)", kind: "number", target: "typeAttributes", hint: "Per-additional-tenant overage billed monthly" },
        ],
      },
      {
        key: "ai_credits", label: "AI Credits", fields: [
          { key: "aiCreditAllowancePlatformValue", label: "Platform AI Credit Allowance", kind: "number", target: "typeAttributes" },
          { key: "aiCreditAllowanceMspValue", label: "MSP AI Credit Allowance", kind: "number", target: "typeAttributes" },
          { key: "aiCreditOverageRateCents", label: "AI Credit Overage Rate (¢)", kind: "number", target: "typeAttributes" },
        ],
      },
      {
        key: "capabilities", label: "Tier Capabilities", fields: [
          { key: "tierCapabilities", label: "Capabilities Map", kind: "capabilities-editor", target: "typeAttributes", hint: "Feature keys set to false are blocked on this tier" },
        ],
      },
      {
        key: "marketing", label: "Marketing", fields: [
          { key: "features", label: "Feature Bullets", kind: "jsonb-array", target: "core" },
          { key: "inclusions", label: "Inclusions", kind: "jsonb-array", target: "core" },
          { key: "badge", label: "Badge", kind: "text", target: "core" },
          { key: "highlighted", label: "Highlighted", kind: "boolean", target: "core" },
        ],
      },
      { key: "catalog", label: "Catalog", fields: CATALOG_FIELDS },
    ],
  },
};

export const PRODUCT_TYPE_LIST: ProductTypeConfig[] = Object.values(PRODUCT_TYPE_CONFIGS);

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

// ── Import / Export field sets ────────────────────────────────────────────────
// Shared with backend; kept here for client-side import validation in
// the Download Template → Import round-trip test.

const COMMON_IMPORT_FIELDS = new Set([
  "slug", "name", "description", "category", "categoryPath", "tagline", "serviceType",
  "billingType", "visibility", "isPublic", "isActive", "label",
  "tier", "highlighted", "badge", "iconName", "sortOrder", "tags", "isFreeOffering",
  "serviceClass", "deliveryType", "fulfillmentType",
  "typeAttributes",
]);

export const PRODUCT_TYPE_IMPORT_FIELDS: Record<ProductTypeKey, Set<string>> = {
  credit_pack: new Set([...COMMON_IMPORT_FIELDS, "price", "deliverables", "inclusions", "features", "targetAudience", "allowFreeCheckout"]),
  assessment: new Set([...COMMON_IMPORT_FIELDS, "basePrice", "maxPrice", "durationDays", "deliverables", "inclusions", "features", "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "hoursPerMonth", "allowFreeCheckout"]),
  project: new Set([...COMMON_IMPORT_FIELDS, "price", "basePrice", "maxPrice", "durationDays", "turnaround", "deliverables", "inclusions", "features", "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "hoursPerMonth", "allowFreeCheckout"]),
  retainer: new Set([...COMMON_IMPORT_FIELDS, "price", "hoursPerMonth", "deliverables", "inclusions", "features", "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "allowFreeCheckout"]),
  monitoring_tier: new Set([...COMMON_IMPORT_FIELDS]),
  recurring_addon: new Set([...COMMON_IMPORT_FIELDS, "price", "deliverables", "inclusions", "features", "targetAudience", "allowFreeCheckout"]),
  document_product: new Set([...COMMON_IMPORT_FIELDS, "price", "basePrice", "maxPrice", "deliverables", "inclusions", "features", "targetAudience", "allowFreeCheckout"]),
  platform_subscription_tier: new Set([...COMMON_IMPORT_FIELDS, "price", "features", "inclusions", "badge", "highlighted", "sortOrder", "fulfillmentTypeKey"]),
};
