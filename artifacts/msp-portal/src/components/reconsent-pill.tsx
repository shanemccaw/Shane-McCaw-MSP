/**
 * ReconsentPill
 *
 * Subtle sidebar nudge shown when the logged-in customer's real
 * tenant_consent.consent_status (polled via ScanStatusProvider's
 * GET /api/portal/scan-status) is "revoked" or "declined" — meaning Microsoft
 * Graph access is genuinely broken. Deliberately quiet by design: a small
 * amber pill in the left nav (above the search box), not a modal or a red
 * banner — it nudges, it doesn't interrupt.
 *
 * Clicking it starts the existing, real admin-consent OAuth flow (consent.ts)
 * via POST /api/portal/consent/reconsent-link; no second consent mechanism.
 * Replaces the previous ReconsentModal + full-width ReconsentBanner.
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

export function useNeedsReconsent(): boolean {
  const { user } = useAuth();
  const { data } = useScanStatus();
  return (
    user?.role === "client" &&
    (data?.consentStatus === "revoked" || data?.consentStatus === "declined")
  );
}

export function useStartReconsent() {
  const { fetchWithAuth } = useAuth();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portal/consent/reconsent-link", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start reconsent");
      }
      const { consentUrl } = (await res.json()) as { consentUrl: string };
      window.location.href = consentUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start reconsent");
      setStarting(false);
    }
  };
  return { start, starting, error };
}

/**
 * The pill itself. Renders nothing unless reconsent is genuinely needed.
 * `collapsed` mirrors the sidebar's collapsed state: expanded shows the
 * labeled pill; collapsed shows just the amber dot button.
 */
export function ReconsentPill({ collapsed }: { collapsed: boolean }) {
  const needsReconsent = useNeedsReconsent();
  const { start, starting, error } = useStartReconsent();

  if (!needsReconsent) return null;

  if (collapsed) {
    return (
      <div className="px-2 pt-1 pb-0.5">
        <button
          onClick={() => void start()}
          disabled={starting}
          title={error ?? "Microsoft 365 reconnect needed — click to re-authorize"}
          aria-label="Microsoft 365 reconnect needed"
          className="w-full flex justify-center rounded-md py-1.5 text-amber-600 dark:text-amber-500 hover:bg-amber-500/10 transition-colors disabled:opacity-60"
        >
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500/50 animate-ping [animation-duration:2.5s]" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pt-1 pb-0.5">
      <button
        onClick={() => void start()}
        disabled={starting}
        title={error ?? "Your Microsoft 365 connection is no longer active. Click to re-approve access."}
        className="group w-full flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 transition-colors disabled:opacity-60"
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500/50 animate-ping [animation-duration:2.5s]" />
          <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
        </span>
        <span className="flex-1 text-left truncate">
          {starting ? "Opening Microsoft…" : error ? "Reconnect failed — retry" : "Reconnect needed"}
        </span>
        <span className="text-amber-600/60 dark:text-amber-500/60 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
          →
        </span>
      </button>
    </div>
  );
}
