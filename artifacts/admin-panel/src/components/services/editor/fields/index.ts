import type { ComponentType } from "react";
import type { ProductTypeKey } from "@/lib/productTypeConfig";
import type { FieldSectionsProps } from "./types";
import CreditPackFields from "./CreditPackFields";
import AssessmentFields from "./AssessmentFields";
import ProjectFields from "./ProjectFields";
import RetainerFields from "./RetainerFields";
import MonitoringTierFields from "./MonitoringTierFields";
import RecurringAddonFields from "./RecurringAddonFields";
import DocumentProductFields from "./DocumentProductFields";
import PlatformSubscriptionTierFields from "./PlatformSubscriptionTierFields";

export type { FieldSectionsProps } from "./types";

export const TYPE_FIELD_COMPONENTS: Record<ProductTypeKey, ComponentType<FieldSectionsProps>> = {
  credit_pack: CreditPackFields,
  assessment: AssessmentFields,
  project: ProjectFields,
  retainer: RetainerFields,
  monitoring_tier: MonitoringTierFields,
  recurring_addon: RecurringAddonFields,
  document_product: DocumentProductFields,
  platform_subscription_tier: PlatformSubscriptionTierFields,
};
