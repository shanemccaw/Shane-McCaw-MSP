import type { LucideIcon } from "lucide-react";

export interface ScanSurface {
  icon: LucideIcon;
  label: string;
  sublabel: string;
}

interface ScanSurfaceStripProps {
  items: ScanSurface[];
  className?: string;
}

/**
 * Icon-led strip naming the real surfaces a scan reads — pure iconography and
 * terminology, no data values, so it needs no illustrative badge. Reinforces a
 * prose enumeration ("the engine reads X, Y, Z…") with the site's established
 * icon-in-tinted-square idiom (Monitoring.tsx engine cards: w-11 h-11
 * rounded-xl bg-white/[0.06] tile + w-5 h-5 accent-blue icon).
 */
export function ScanSurfaceStrip({ items, className }: ScanSurfaceStripProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${className ?? ""}`}>
      {items.map(({ icon: Icon, label, sublabel }) => (
        <div
          key={label}
          className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-4 flex items-start gap-3"
        >
          <span className="shrink-0 w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
            <Icon className="w-5 h-5 text-accent-blue" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary leading-snug">
              {label}
            </span>
            <span className="block text-xs text-text-secondary mt-1 leading-relaxed">
              {sublabel}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
