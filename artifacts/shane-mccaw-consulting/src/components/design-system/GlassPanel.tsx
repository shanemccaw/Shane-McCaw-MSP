import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Frosted glass surface — backdrop-blur(24px) + glass fill + glass border.
 * Reserved for live-data moments and key conversion points (website-rebuild-reference-v2.md §5):
 * not a default card style. Use flat charcoal-1 cards for everything else.
 */
export const GlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass-panel rounded-2xl", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassPanel.displayName = "GlassPanel";
