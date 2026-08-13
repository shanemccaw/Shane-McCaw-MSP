import { CheckCircle2 } from "lucide-react";

interface DeliverablesListProps {
  items: string[];
}

/**
 * Benefits/deliverables content ("What You Get", "Product Modules & Features" style) —
 * checkmark list kept (appropriate for this content type), wrapped in one flat charcoal-1
 * card so it reads as a distinct block, not the same bare list as RiskList/WorkflowSteps.
 */
export function DeliverablesList({ items }: DeliverablesListProps) {
  return (
    <ul className="space-y-3 rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
          <span className="text-text-secondary leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}
