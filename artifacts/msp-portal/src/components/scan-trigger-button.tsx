/**
 * scan-trigger-button.tsx
 *
 * ⚠️ TEMPORARY TESTING BYPASS — REMOVE BEFORE PRODUCTION ⚠️
 *
 * Shell-wide, testbed-only manual scan trigger. Rendered from app-shell.tsx
 * directly above the search box in the desktop sidebar, so testbed customers
 * can force a scan from any page without opening the Assessment wizard.
 * Mirrors AssessmentWizard.tsx's own debug trigger button: same
 * POST /api/portal/assessment/debug-trigger-scan endpoint, which is hard-gated
 * server-side to isTestbed=true customers — this client-side check is only a
 * second layer, not the real gate. Never render this for a real, non-testbed
 * customer.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function ScanTriggerButton() {
  const { accessToken, fetchWithAuth } = useAuth();
  const [isTestbed, setIsTestbed] = useState(false);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    fetchWithAuth("/api/portal/scan-status", undefined, { silent: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { isTestbed?: boolean } | null) => {
        if (data) setIsTestbed(data.isTestbed === true);
      })
      .catch(() => {
        // best-effort; button just stays hidden
      });
  }, [accessToken, fetchWithAuth]);

  const trigger = useCallback(async () => {
    setTriggering(true);
    try {
      await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", { method: "POST" });
    } finally {
      setTriggering(false);
    }
  }, [fetchWithAuth]);

  if (!isTestbed) return null;

  return (
    <button
      className="w-full flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/70 transition-colors disabled:opacity-50"
      onClick={() => void trigger()}
      disabled={triggering}
    >
      {triggering ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <PlayCircle className="size-3.5 shrink-0" />
      )}
      <span className="flex-1 text-left">[DEBUG] Trigger scan</span>
    </button>
  );
}
