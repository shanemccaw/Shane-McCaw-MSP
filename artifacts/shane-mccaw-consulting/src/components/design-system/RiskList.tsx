import { AlertTriangle } from "lucide-react";

interface RiskListProps {
  items: string[];
}

/**
 * Risk/warning content ("Why This Product Matters" style) — one bordered amber card per
 * item, distinct from the flat checkmark-list treatment used for benefits/deliverables
 * (DeliverablesList). Flat amber, per the site's existing attention convention
 * (Checkout.tsx/Msp.tsx/Monitoring.tsx amber-500/10+amber-500/20 cards) — not a new color.
 */
export function RiskList({ items }: RiskListProps) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-text-secondary leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}
