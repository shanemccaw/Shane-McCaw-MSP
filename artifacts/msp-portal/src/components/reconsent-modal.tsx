/**
 * ReconsentModal
 *
 * Shows when the logged-in customer's real tenant_consent.consent_status
 * (polled via ScanStatusProvider's GET /api/portal/scan-status) is "revoked"
 * or "declined" — meaning Microsoft Graph access is genuinely broken. The
 * button starts the existing, real admin-consent OAuth flow (consent.ts)
 * via POST /api/portal/consent/reconsent-link; no second consent mechanism.
 *
 * Dismissible per browser session (sessionStorage) so it doesn't nag on every
 * page load — it resurfaces on the next new session/tab if still unresolved.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

const DISMISS_KEY = "reconsent-modal-dismissed";

export function ReconsentModal() {
  const { user, fetchWithAuth } = useAuth();
  const { data } = useScanStatus();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReconsent =
    user?.role === "client" &&
    (data?.consentStatus === "revoked" || data?.consentStatus === "declined");

  // A newly-broken consent state should resurface even if an earlier state was dismissed.
  useEffect(() => {
    if (needsReconsent && sessionStorage.getItem(DISMISS_KEY) !== "1") {
      setDismissed(false);
    }
  }, [needsReconsent]);

  const open = needsReconsent && !dismissed;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleReconsent = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portal/consent/reconsent-link", {
        method: "POST",
      });
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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleDismiss(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Microsoft 365 connection needs to be re-authorized</DialogTitle>
          <DialogDescription>
            Your organization's Microsoft 365 connection is no longer active, so scans and
            reports can't run. A Global Administrator needs to re-approve access to restore
            it.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={handleDismiss} disabled={starting}>
            Remind me later
          </Button>
          <Button onClick={() => void handleReconsent()} disabled={starting}>
            {starting ? "Starting…" : "Re-authorize access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
