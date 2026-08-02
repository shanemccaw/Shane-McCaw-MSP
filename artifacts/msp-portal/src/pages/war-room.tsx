import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { WarRoomLogic } from "@/components/war-room/WarRoomLogic";
import { warRoomUrlSync } from "@/components/war-room/warRoomSections";
import { deriveWarRoomScan } from "@/components/war-room/warRoomScan";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import "@/components/war-room/war-room.css";

/**
 * M365 War Room — the full-screen Copilot readiness briefing.
 *
 * Ported from the Claude Design prototype "M365 War Room.dc.html". The experience owns
 * the whole viewport (its root is `position:fixed; inset:0`), so it deliberately renders
 * outside AppShell rather than inside it — the shell would be covered either way.
 *
 * Route: /war-room/:section? — each of the stops the transport jump-menu already names
 * (introductions, the six pillar deep-dives, the live demo, readiness, SOW, remediation,
 * timeline, documents) is its own deep-linkable URL, so the position survives a refresh
 * and Back/Forward work (#303). The `:section` param is optional rather than the
 * redirect-to-a-default shape /copilot-assessment/:step uses, for two reasons: the War
 * Room opens on a hero prelude that is genuinely not one of the named stops, so there is
 * nothing honest to redirect a bare /war-room to; and a single route keeps this one
 * component mounted across every section change, which is the remount concern that
 * pattern exists to solve in the first place.
 *
 * The exit control below is the one piece of chrome that is NOT in the design: the
 * prototype was a standalone page with nowhere to return to, and without it a user who
 * opens this route inside the portal has no way back out.
 *
 * Real scan (#305): the intro's progress bar and pillar states are driven from the real
 * diagnostics run via `useScanStatus()`. That hook has to be called here rather than in
 * WarRoomLogic because the briefing is a class component; the derived state and the
 * trigger go down as props, the same shape #303's `section`/`onSectionChange` already
 * established. `ScanStatusProvider` wraps the router in App.tsx, so it is in scope here
 * even though the War Room renders outside AppShell.
 */
export default function WarRoomPage() {
  const [, setLocation] = useLocation();
  const { section } = useParams<{ section?: string }>();
  const { fetchWithAuth } = useAuth();
  const { data, scanCheckResults, streamedRunId, triggeredRunId, reportTriggerStarted, reportTriggerError } =
    useScanStatus();

  // Real tenant identity (#315): the prelude used to hardcode the demo org's
  // name ("Northline Health") where the actual customer's company name
  // belongs. `/portal/dashboard` is the cheapest existing source for it —
  // same endpoint customer-home.tsx/app-shell.tsx already call — so this
  // fetches it directly rather than adding a new endpoint.
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/portal/dashboard")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        // Non-fatal — the prelude falls back to a generic label.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // Hold on to the last per-check results we really saw. The provider empties
  // `scanCheckResults` as soon as a run finishes (it releases the held runId,
  // which tears the subscription down), so without this the pillar row would
  // light up check by check all the way through the scan and then blank back to
  // all-queued at the very moment it completed. Tagged with its runId so a
  // later run never inherits an earlier one's pillars.
  const [retained, setRetained] = useState<{ runId: string | null; results: typeof scanCheckResults }>({
    runId: null,
    results: [],
  });
  useEffect(() => {
    if (streamedRunId && scanCheckResults.length > 0) {
      setRetained({ runId: streamedRunId, results: scanCheckResults });
    }
  }, [streamedRunId, scanCheckResults]);

  const scan = useMemo(
    () =>
      deriveWarRoomScan({
        scanCheckResults,
        streamedRunId,
        triggeredRunId,
        active: data?.active ?? null,
        lastRunSummary: data?.lastRunSummary ?? null,
        retainedResults: retained.results,
        retainedRunId: retained.runId,
      }),
    [scanCheckResults, streamedRunId, triggeredRunId, data?.active, data?.lastRunSummary, retained],
  );

  /**
   * Start a real scan, when this account is actually allowed to start one.
   *
   * `debug-trigger-scan` is the ONLY customer-reachable trigger in the platform and it
   * is hard-gated server-side to testbed tenants — its own header says real customers
   * never get a self-serve trigger, to stop AI-credit spam. So for a real customer this
   * deliberately does not POST: a guaranteed 403 would surface as a trigger error on a
   * narrative button, and it is not needed. Their scan is the real one that already
   * fired at consent time (consent.ts fires runDiagnostics for every assessment order),
   * which is exactly the run `scan` above is reporting — the room reads it rather than
   * starting a second one.
   *
   * Nothing about the intro's progress depends on who started the run, so the button
   * advances the conversation either way.
   */
  const handleTriggerScan = useCallback(async () => {
    if (!data?.isTestbed) return;
    try {
      const res = await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", { method: "POST" });
      if (!res.ok) {
        let message = `Trigger request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body — keep the status-code message
        }
        reportTriggerError(message);
        return;
      }
      // Hand the 202 body's own runId straight over so the run's SSE stream opens now
      // rather than only if the poll happens to catch the run active (#243).
      let startedRunId: string | null = null;
      try {
        const body = (await res.json()) as { runId?: unknown };
        if (typeof body?.runId === "string" && body.runId) startedRunId = body.runId;
      } catch {
        // No/unreadable body — fall back to poll discovery.
      }
      reportTriggerStarted(startedRunId);
    } catch (err) {
      reportTriggerError(err instanceof Error ? err.message : "Network error triggering scan");
    }
  }, [data?.isTestbed, fetchWithAuth, reportTriggerStarted, reportTriggerError]);

  // The briefing's own beat machine still owns navigation; this only mirrors it
  // into the address bar. An explicitly chosen stop pushes a history entry, a
  // position the briefing reached on its own replaces one — see warRoomUrlSync.
  const handleSectionChange = useCallback(
    (next: string, explicit: boolean) => {
      const { path, replace } = warRoomUrlSync(next, explicit);
      setLocation(path, { replace });
    },
    [setLocation],
  );

  return (
    <div className="wr-root">
      <WarRoomLogic
        section={section}
        onSectionChange={handleSectionChange}
        scan={scan}
        docWorkflow={data?.docWorkflow ?? null}
        onTriggerScan={handleTriggerScan}
        customerName={customerName}
      />

      <button
        type="button"
        onClick={() => setLocation("/")}
        aria-label="Exit the War Room and return to the portal"
        style={{
          position: "fixed",
          left: 14,
          top: 14,
          zIndex: 400,
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 28,
          padding: "0 12px",
          borderRadius: 9,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".04em",
          color: "#94a3b8",
          border: "1px solid rgba(51,65,85,.85)",
          background: "rgba(8,15,30,.72)",
          backdropFilter: "blur(6px)",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Exit
      </button>
    </div>
  );
}
