import { useState } from "react";
import { Link } from "wouter";
import { MessageSquareText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTestimonialPromptDue } from "@/lib/testimonials-api";

/**
 * Testimonial prompt banner (#3894, Feature #3436). The real entry point for
 * the standing testimonial-collection surface — surfaces
 * `GET /api/portal/testimonials/prompt-due` (#3892's cadence: 30 days after
 * the tenant starts, then every 90 days, reset by any submission) as a
 * frame-level banner rather than a modal/toast, so it's visible without
 * interrupting whatever page the customer landed on, and dismissing it for
 * this visit doesn't need its own backend (there is no "snooze" endpoint —
 * the real due-check itself is what resets on a submission).
 *
 * STUB UI PENDING DESIGN REVIEW (#3894) — no `Design/portal/` export exists
 * yet for how this prompt should look; Shane authorized a real stub
 * (2026-09-15) against the live `/prompt-due` contract instead of continuing
 * to wait. Mounted in `PortalShell` so it surfaces regardless of which page
 * is open, matching how the periodic-trigger backend is scoped (tenant-wide,
 * not per-page).
 */
export function TestimonialPromptBanner() {
  const promptDue = useTestimonialPromptDue();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !promptDue.isSuccess || !promptDue.data.due) return null;

  return (
    <div
      className="flex flex-none items-center gap-3 border-b px-4 py-2"
      style={{ borderColor: "rgba(255,255,255,.09)", background: "rgba(0,120,212,.06)" }}
      data-testid="testimonial-prompt-banner"
    >
      <MessageSquareText className="size-4 flex-none" style={{ color: "#60a5fa" }} strokeWidth={1.75} />
      <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground">
        How has it been going with your provider? A minute of feedback helps — and if you're willing, it may become a
        testimonial once reviewed.
      </span>
      <Button asChild size="sm" variant="secondary" data-testid="testimonial-prompt-cta">
        <Link href="/testimonials">Share feedback</Link>
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex-none rounded-md p-1 text-muted-foreground hover:bg-white/[.06]"
        data-testid="testimonial-prompt-dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
