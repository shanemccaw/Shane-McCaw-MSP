import type { ProductTypeKey } from "@/lib/productTypeConfig";

// Visual-only badge colors keyed by ProductTypeKey — shared between the
// product list row badge and the editor header badge so both panels agree
// on a color per type. Not part of productTypeConfig.ts (data/detection
// stays there); this is presentation only.
export const PRODUCT_TYPE_BADGE_COLORS: Record<ProductTypeKey, string> = {
  credit_pack: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  assessment: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  project: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  retainer: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  monitoring_tier: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  recurring_addon: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  document_product: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  platform_subscription_tier: "bg-violet-500/15 text-violet-400 border-violet-500/20",
};
