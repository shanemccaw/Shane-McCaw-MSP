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
 *
 * No toast/notification feedback here by design — a click drives the real,
 * shared ScanStatusIndicator (via ScanStatusContext) into its live
 * "active scan, X% progress" state instead. If the trigger request itself
 * fails, that failure is surfaced on the same shared indicator too (a red
 * "scan trigger failed" state), never silently swallowed.
 */

import { useCallback, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

export function ScanTriggerButton() {
  const { fetchWithAuth } = useAuth();
  const { data, reportTriggerStarted, reportTriggerError } = useScanStatus();
  const [triggering, setTriggering] = useState(false);

  const trigger = useCallback(async () => {
    setTriggering(true);
    try {
      const res = await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", { method: "POST" });
      if (res.ok) {
        reportTriggerStarted();
      } else {
        let message = `Trigger request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body — keep the status-code message
        }
        reportTriggerError(message);
      }
    } catch (err) {
      reportTriggerError(err instanceof Error ? err.message : "Network error triggering scan");
    } finally {
      setTriggering(false);
    }
  }, [fetchWithAuth, reportTriggerStarted, reportTriggerError]);

  if (!data?.isTestbed) return null;

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
