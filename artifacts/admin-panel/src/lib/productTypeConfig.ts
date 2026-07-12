export type ProductTypeKey = "credit_pack" | "assessment" | "project" | "retainer" | "monitoring_tier";

export interface ProductTypeFields {
  priceFixed: boolean;
  priceRange: boolean;
  duration: boolean;
  turnaround: boolean;
  assignToClient: boolean;
  projectTemplate: boolean;
  genPdf: boolean;
  monitoringTier: boolean;
}

export interface ProductTypeConfig {
  key: ProductTypeKey;
  label: string;
  description: string;
  serviceClass: "project" | "add_on" | "subscription" | null;
  deliveryType: "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none" | null;
  defaultBillingType: "one_time" | "recurring_monthly" | "recurring" | "fixed";
  showFields: ProductTypeFields;
}

export const PRODUCT_TYPE_CONFIGS: Record<ProductTypeKey, ProductTypeConfig> = {
  credit_pack: {
    key: "credit_pack",
    label: "Credit Pack",
    description: "A one-time add-on purchase — no deliverables, no signature, instant checkout.",
    serviceClass: "add_on",
    deliveryType: "none",
    defaultBillingType: "one_time",
    showFields: {
      priceFixed: true,
      priceRange: false,
      duration: false,
      turnaround: false,
      assignToClient: false,
      projectTemplate: false,
      genPdf: false,
      monitoringTier: false,
    },
  },
  assessment: {
    key: "assessment",
    label: "Assessment",
    description: "A diagnostic engagement with a price range, duration, and PDF deliverable.",
    serviceClass: null,
    deliveryType: "assessment",
    defaultBillingType: "one_time",
    showFields: {
      priceFixed: false,
      priceRange: true,
      duration: true,
      turnaround: false,
      assignToClient: true,
      projectTemplate: false,
      genPdf: true,
      monitoringTier: false,
    },
  },
  project: {
    key: "project",
    label: "Project",
    description: "A scoped engagement with SOW, signature, price range, and project template.",
    serviceClass: "project",
    deliveryType: null,
    defaultBillingType: "fixed",
    showFields: {
      priceFixed: true,
      priceRange: true,
      duration: true,
      turnaround: true,
      assignToClient: true,
      projectTemplate: true,
      genPdf: true,
      monitoringTier: false,
    },
  },
  retainer: {
    key: "retainer",
    label: "Retainer",
    description: "A recurring monthly engagement billed as a fixed subscription.",
    serviceClass: null,
    deliveryType: "retainer",
    defaultBillingType: "recurring_monthly",
    showFields: {
      priceFixed: true,
      priceRange: false,
      duration: false,
      turnaround: false,
      assignToClient: true,
      projectTemplate: false,
      genPdf: true,
      monitoringTier: false,
    },
  },
  monitoring_tier: {
    key: "monitoring_tier",
    label: "Monitoring Tier",
    description: "An MSP platform subscription tier with seat pricing and included engines.",
    serviceClass: "subscription",
    deliveryType: "bundle_subscription",
    defaultBillingType: "recurring_monthly",
    showFields: {
      priceFixed: false,
      priceRange: false,
      duration: false,
      turnaround: false,
      assignToClient: false,
      projectTemplate: false,
      genPdf: false,
      monitoringTier: true,
    },
  },
};

export const PRODUCT_TYPE_LIST: ProductTypeConfig[] = Object.values(PRODUCT_TYPE_CONFIGS);

export function detectProductType(
  serviceClass: string | null | undefined,
  deliveryType: string | null | undefined,
): ProductTypeKey {
  if (serviceClass === "subscription" && deliveryType === "bundle_subscription") return "monitoring_tier";
  if (serviceClass === "add_on" && deliveryType === "none") return "credit_pack";
  if (deliveryType === "assessment") return "assessment";
  if (deliveryType === "retainer") return "retainer";
  if (serviceClass === "project") return "project";
  return "project";
}

const COMMON_IMPORT_FIELDS = new Set([
  "slug", "name", "description", "category", "categoryPath", "tagline", "serviceType",
  "billingType", "visibility", "isPublic", "isActive", "label",
  "tier", "highlighted", "badge", "iconName", "sortOrder", "tags", "isFreeOffering",
  "serviceClass", "deliveryType",
]);

export const PRODUCT_TYPE_IMPORT_FIELDS: Record<ProductTypeKey, Set<string>> = {
  credit_pack: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "deliverables", "inclusions", "features", "targetAudience",
  ]),
  assessment: new Set([
    ...COMMON_IMPORT_FIELDS,
    "basePrice", "maxPrice", "durationDays", "deliverables", "inclusions", "features",
    "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys",
    "customerAgreementTemplate", "workflowTemplateId", "targetAudience", "hoursPerMonth",
  ]),
  project: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "basePrice", "maxPrice", "durationDays", "turnaround", "deliverables",
    "inclusions", "features", "requiredAppPermissions", "fulfillmentTypeKey",
    "triggeringSignalKeys", "customerAgreementTemplate", "workflowTemplateId",
    "targetAudience", "hoursPerMonth",
  ]),
  retainer: new Set([
    ...COMMON_IMPORT_FIELDS,
    "price", "hoursPerMonth", "deliverables", "inclusions", "features",
    "requiredAppPermissions", "fulfillmentTypeKey", "triggeringSignalKeys",
    "customerAgreementTemplate", "workflowTemplateId", "targetAudience",
  ]),
  monitoring_tier: new Set([
    ...COMMON_IMPORT_FIELDS,
    "tenantTierLabel", "seatMin", "seatMax", "includedEngines", "includedFeatures",
    "pricePerUserMonth", "seatCountFloor", "minMspPlanTier",
  ]),
};
