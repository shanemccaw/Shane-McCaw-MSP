import { type ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { cn } from "@/lib/utils";

interface StatPanelProps {
  label: string;
  value: ReactNode;
  className?: string;
}

/**
 * Signature element: the floating glass stat panel (e.g. "Tenant health — 98.2").
 * Doubles as brand signature and literal product preview — reusable across Home,
 * Assessment, and Monitoring hero sections (website-rebuild-reference-v2.md §5).
 * Value renders in IBM Plex Mono per the "every number that matters gets monospace" rule.
 */
export function StatPanel({ label, value, className }: StatPanelProps) {
  return (
    <GlassPanel className={cn("px-5 py-4 flex flex-col gap-1", className)}>
      <span className="text-xs uppercase tracking-wider text-text-secondary">{label}</span>
      <span className="font-numeric text-2xl font-medium text-text-primary">{value}</span>
    </GlassPanel>
  );
}
