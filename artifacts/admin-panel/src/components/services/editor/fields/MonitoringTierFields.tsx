import { PRODUCT_TYPE_CONFIGS } from "@/lib/productTypeConfig";
import SectionCard from "../SectionCard";
import type { FieldSectionsProps } from "./types";

const SECTIONS = PRODUCT_TYPE_CONFIGS.monitoring_tier.sections.filter(s => s.key !== "identity" && s.key !== "catalog");

export default function MonitoringTierFields(props: FieldSectionsProps) {
  return <>{SECTIONS.map(section => <SectionCard key={section.key} section={section} {...props} />)}</>;
}
