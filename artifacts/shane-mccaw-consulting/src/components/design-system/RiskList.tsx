import { AlertTriangle, type LucideIcon } from "lucide-react";

export interface RiskDetail {
  /** M365-concept icon replacing the generic AlertTriangle (e.g. Share2 for a
   *  SharePoint-sprawl risk) — keeps the amber attention color, adds specificity. */
  icon: LucideIcon;
  /** Short real-terminology tag naming the surface at risk (e.g. "Microsoft 365 Groups"). */
  tag: string;
}

interface RiskListProps {
  items: string[];
  /**
   * Optional per-item icon + tag, index-aligned with `items`. Callers without
   * it (every non-flagship topic) render exactly as before: uniform
   * AlertTriangle, no tag.
   */
  details?: RiskDetail[];
}

/**
 * Risk/warning content ("Why This Product Matters" style) — one bordered amber card per
 * item, distinct from the flat checkmark-list treatment used for benefits/deliverables
 * (DeliverablesList). Flat amber, per the site's existing attention convention
 * (Checkout.tsx/Msp.tsx/Monitoring.tsx amber-500/10+amber-500/20 cards) — not a new color.
 */
export function RiskList({ items, details }: RiskListProps) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const detail = details?.[i];
        const Icon = detail?.icon ?? AlertTriangle;
        return (
          <li
            key={item}
            className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4"
          >
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                {detail && (
                  <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-amber-400/90 mb-1.5">
                    {detail.tag}
                  </span>
                )}
                <span className="block text-text-secondary leading-relaxed">{item}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
