import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useEngagementOffer } from "@/hooks/usePersonalizationData";
import { trackEvent } from "@/lib/analytics";

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Stage 4c — live Engagement Offer Engine bundle (website-rebuild-reference-v2.md §3).
 * Global, persistent-but-dismissible floating panel (mounted once in Layout.tsx, not a
 * per-page section) so a recognized visitor sees it wherever they're currently browsing,
 * without blocking the page — this is the in-session "show me right now" counterpart to
 * the separate delayed email follow-up (built elsewhere, not here). Renders nothing for
 * cold-tier visitors (no lead identity to check against) or while no offer is live.
 * Dismissal is per-mount state, not persisted storage — Layout never remounts across
 * client-side route changes, so "dismiss" holds for the rest of the browsing session and
 * naturally resets on a fresh page load, matching a live eligibility check that can also
 * change server-side in the meantime.
 */
export function EngagementOfferPanel() {
  const { tier } = usePersonalizationState();
  const { offer } = useEngagementOffer();
  const [dismissed, setDismissed] = useState(false);

  const visible = Boolean(offer && !dismissed && (tier === "quiz" || tier === "assessment"));

  useEffect(() => {
    if (visible && offer) {
      trackEvent("personalization_shown", { tier, surface: "engagement_offer_panel", rule: offer.ruleName });
    }
  }, [visible, offer, tier]);

  if (!visible || !offer) return null;

  const primaryService = offer.services[0];
  const extraCount = offer.services.length - 1;

  return (
    <div
      className="menu-panel fixed bottom-6 left-6 z-40 w-[calc(100vw-3rem)] max-w-sm rounded-2xl p-5 shadow-2xl"
      role="complementary"
      aria-label="Special bundle offer"
    >
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offer"
        className="absolute top-3 right-3 p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      {tier === "quiz" && (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
          Based on what you told us
        </span>
      )}

      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}
        >
          <Sparkles className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-text-primary leading-snug">
            {tier === "assessment"
              ? "Your tenant qualifies for a bundle right now"
              : "Looks like this might be a fit for you"}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            <span className="gradient-text font-numeric font-semibold">{offer.discountPct}% off</span>{" "}
            {primaryService.name}
            {extraCount > 0 && ` + ${extraCount} more service${extraCount === 1 ? "" : "s"}`} — while you're still here.
          </p>
          {primaryService.priceCents != null && (
            <p className="text-xs text-text-secondary mt-1 font-numeric">
              {formatUsd(Math.round(primaryService.priceCents * (1 - offer.discountPct / 100)))}{" "}
              <span className="line-through opacity-60">{formatUsd(primaryService.priceCents)}</span>
            </p>
          )}
        </div>
      </div>

      <Link
        href="/contact"
        className="mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-white text-sm transition-opacity hover:opacity-90"
        style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
        data-track="cta"
        onClick={() => trackEvent("personalization_nudge_click", { tier, surface: "engagement_offer_panel", rule: offer.ruleName })}
      >
        Claim this now
      </Link>
    </div>
  );
}
