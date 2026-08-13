import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Blue -> violet gradient text, for headline emphasis (one line/phrase, not a whole headline),
 * primary CTAs, or live data numbers. Never a full-background wash — keep usage to 2-3 spots per page
 * (website-rebuild-reference-v2.md §5).
 */
export function GradientText({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("gradient-text", className)} {...props}>
      {children}
    </span>
  );
}
