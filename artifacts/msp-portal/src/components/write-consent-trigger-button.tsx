/**
 * write-consent-trigger-button.tsx
 *
 * ⚠️ TEMPORARY TESTING BYPASS — REMOVE BEFORE PRODUCTION ⚠️
 *
 * Shell-wide, testbed-only manual write-consent trigger. Rendered from app-shell.tsx
 * directly below the scan trigger button in the desktop sidebar, so testbed customers
 * can force a write-consent from any page.
 */

import { useCallback, useState } from "react";
import { Loader2, Key } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import { toast } from "@/hooks/use-toast";

export function WriteConsentTriggerButton() {
  const { fetchWithAuth } = useAuth();
  const { data } = useScanStatus();
  const [triggering, setTriggering] = useState(false);

  const trigger = useCallback(async () => {
    setTriggering(true);
    try {
      const res = await fetchWithAuth("/api/portal/consent/debug-write-reconsent-link", { method: "POST" });
      if (res.ok) {
        const body = await res.json();
        if (body.consentUrl) {
          window.location.href = body.consentUrl;
        } else {
          toast({ title: "Failed", description: "No consent URL returned", variant: "destructive" });
        }
      } else {
        let message = `Trigger request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body — keep the status-code message
        }
        toast({ title: "Failed", description: message, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Network error triggering write consent", variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }, [fetchWithAuth]);

  if (!data?.isTestbed) return null;

  return (
    <button
      className="w-full mt-1 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/70 transition-colors disabled:opacity-50"
      onClick={() => void trigger()}
      disabled={triggering}
    >
      {triggering ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Key className="size-3.5 shrink-0" />
      )}
      <span className="flex-1 text-left">[DEBUG] Reconsent WRITE</span>
    </button>
  );
}

