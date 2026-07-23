/**
 * ReconsentPill
 *
 * Subtle sidebar nudge shown when the logged-in customer's real Microsoft
 * consent state (polled via ScanStatusProvider's GET /api/portal/scan-status)
 * needs attention. Three genuinely different real states, in priority order:
 *
 *   1. Graph BROKEN — tenant_consent.consent_status is "revoked"/"declined".
 *      Nothing works; highest priority.
 *   2. Graph STALE — consent is "granted" but scopesStale is true, meaning
 *      REQUIRED_MT_SCOPES has grown since this tenant last consented.
 *   3. SharePoint MISSING/STALE — tenant_sharepoint_consent has no row, is
 *      revoked/declined, or is granted with a permissionsGranted snapshot that
 *      no longer covers REQUIRED_SHAREPOINT_APP_PERMISSIONS.
 *
 * SharePoint is a SEPARATE Azure resource from Graph (Office 365 SharePoint
 * Online, appId 00000003-0000-0ff1-ce00-000000000000, permission
 * Sites.FullControl.All), consented independently and tracked in its own
 * per-tenant table — so it is NOT inferred from the Graph consent state, and it
 * gets its own consent link (POST /api/portal/consent/sharepoint-link) rather
 * than reusing the Graph reconsent link, which cannot grant it.
 *
 * Graph state outranks SharePoint state: if Graph access is broken or stale
 * that's the thing to fix first, and one pill never shows two problems at once.
 *
 * Deliberately quiet by design: a small amber pill in the left nav (above the
 * search box), not a modal or a red banner — it nudges, it doesn't interrupt.
 * Clicking it starts the real admin-consent OAuth flow in consent.ts; no second
 * consent mechanism. Replaces the previous ReconsentModal + ReconsentBanner.
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

/** Which real consent problem (if any) this customer currently has, highest priority first. */
export type ReconsentKind = "graph-broken" | "graph-scope-upgrade" | "sharepoint" | null;

export function useReconsentKind(): ReconsentKind {
  const { user } = useAuth();
  const { data } = useScanStatus();
  if (user?.role !== "client" || !data) return null;

  if (data.consentStatus === "revoked" || data.consentStatus === "declined") return "graph-broken";
  if (data.consentStatus === "granted" && data.scopesStale === true) return "graph-scope-upgrade";

  // SharePoint: an explicit null (row absent) is a real "never granted" state —
  // the tenant simply has not been through this separate consent flow yet.
  // The field being MISSING from the payload entirely is different: the server
  // couldn't read it, so the state is genuinely unknown and the pill stays
  // silent rather than nagging about something it can't verify.
  // Only surfaced once Graph itself is healthy, so the customer is never asked
  // to fix two things at once.
  if (data.consentStatus === "granted" && "sharePointConsentStatus" in data) {
    const sp = data.sharePointConsentStatus;
    if (sp === null || sp === "pending" || sp === "revoked" || sp === "declined") return "sharepoint";
    if (sp === "granted" && data.sharePointPermissionsStale === true) return "sharepoint";
  }

  return null;
}

export function useNeedsReconsent(): boolean {
  return useReconsentKind() !== null;
}

/** True only for the "access still works, just needs a top-up" Graph case — distinct copy from a genuinely broken connection. */
export function useReconsentIsScopeUpgrade(): boolean {
  return useReconsentKind() === "graph-scope-upgrade";
}

export function useStartReconsent() {
  const { fetchWithAuth } = useAuth();
  const kind = useReconsentKind();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SharePoint consent CANNOT be obtained through the Graph reconsent link —
  // it is a different resource, so it has its own endpoint.
  const endpoint =
    kind === "sharepoint"
      ? "/api/portal/consent/sharepoint-link"
      : "/api/portal/consent/reconsent-link";
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(endpoint, { method: "POST" });
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
 * The pill itself. Renders nothing unless a real consent problem exists.
 * `collapsed` mirrors the sidebar's collapsed state: expanded shows the
 * labeled pill; collapsed shows just the amber dot button.
 */
export function ReconsentPill({ collapsed }: { collapsed: boolean }) {
  const kind = useReconsentKind();
  const { start, starting, error } = useStartReconsent();

  if (kind === null) return null;

  const idleTitle =
    kind === "sharepoint"
      ? "SharePoint access hasn't been approved for your tenant yet. Click to approve it."
      : kind === "graph-scope-upgrade"
        ? "Additional Microsoft 365 permissions are available. Click to approve them."
        : "Your Microsoft 365 connection is no longer active. Click to re-approve access.";

  const idleLabel =
    kind === "sharepoint"
      ? "SharePoint access needed"
      : kind === "graph-scope-upgrade"
        ? "Permission update available"
        : "Reconnect needed";

  const errorLabel = kind === "sharepoint" ? "Approval failed — retry" : "Reconnect failed — retry";

  if (collapsed) {
    return (
      <div className="px-2 pt-1 pb-0.5">
        <button
          onClick={() => void start()}
          disabled={starting}
          title={error ?? idleTitle}
          aria-label={idleTitle}
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
        title={error ?? idleTitle}
        className="group w-full flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 transition-colors disabled:opacity-60"
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500/50 animate-ping [animation-duration:2.5s]" />
          <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
        </span>
        <span className="flex-1 text-left truncate">
          {starting ? "Opening Microsoft…" : error ? errorLabel : idleLabel}
        </span>
        <span className="text-amber-600/60 dark:text-amber-500/60 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
          →
        </span>
      </button>
    </div>
  );
}
