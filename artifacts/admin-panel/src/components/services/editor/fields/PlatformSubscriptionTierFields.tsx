import { PRODUCT_TYPE_CONFIGS } from "@/lib/productTypeConfig";
import SectionCard from "../SectionCard";
import type { FieldSectionsProps } from "./types";

const SECTIONS = PRODUCT_TYPE_CONFIGS.platform_subscription_tier.sections.filter(s => s.key !== "identity" && s.key !== "catalog");

export default function PlatformSubscriptionTierFields(props: FieldSectionsProps) {
  return <>{SECTIONS.map(section => <SectionCard key={section.key} section={section} {...props} />)}</>;
}
