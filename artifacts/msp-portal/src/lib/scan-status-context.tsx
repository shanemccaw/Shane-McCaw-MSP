/**
 * scan-status-context.tsx
 *
 * Single shared source of truth for the shell-wide monitoring scan status,
 * polled from GET /api/portal/scan-status. Both ScanStatusIndicator (the
 * always-visible shell display) and ScanTriggerButton (the testbed-only
 * manual trigger) consume this same context so a click on the trigger
 * button visibly drives the real indicator instead of the two components
 * running independent, disconnected fetches.
 *
 * Polls every 45s while idle; switches to a fast 3s cadence while a scan is
 * active (or immediately after a trigger, before the run row has even been
 * picked up yet) so the progress bar actually looks live.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";

export interface ScanStatusPayload {
  everScanned: boolean;
  lastScanAt: string | null;
  active: {
    status: string;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    checksTotal: number;
    startedAt: string;
  } | null;
  isTestbed: boolean;
}

interface ScanStatusContextValue {
  data: ScanStatusPayload | null;
  /** Set when the trigger request itself failed — distinct from a normal poll miss. */
  triggerError: string | null;
  /** Called right after a trigger POST succeeds, to start fast polling immediately. */
  reportTriggerStarted: () => void;
  /** Called when the trigger POST itself fails (network error, non-2xx, etc). */
  reportTriggerError: (message: string) => void;
}

const ScanStatusContext = createContext<ScanStatusContextValue | null>(null);

const IDLE_POLL_MS = 45_000;
const ACTIVE_POLL_MS = 3_000;

export function ScanStatusProvider({ children }: { children: ReactNode }) {
  const { accessToken, fetchWithAuth } = useAuth();
  const [data, setData] = useState<ScanStatusPayload | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const fastUntilRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetchWithAuth("/api/portal/scan-status", undefined, { silent: true });
      if (res.ok) {
        const payload = (await res.json()) as ScanStatusPayload;
        setData(payload);
        // A real active scan clears any stale trigger-error banner and keeps
        // the poll cadence fast for as long as it stays active.
        if (payload.active) {
          setTriggerError(null);
          fastUntilRef.current = Date.now() + ACTIVE_POLL_MS * 2;
        }
      }
    } catch {
      // best-effort — keep showing the last known state rather than clearing it
    }
  }, [accessToken, fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await load();
      if (cancelled) return;
      const fast = Date.now() < fastUntilRef.current;
      timerRef.current = setTimeout(() => void tick(), fast ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    // Exposed so reportTriggerStarted can re-enter the same self-rescheduling
    // loop instead of firing a one-off load() that would leave polling dead.
    tickRef.current = tick;

    void tick();

    return () => {
      cancelled = true;
      tickRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  const reportTriggerStarted = useCallback(() => {
    setTriggerError(null);
    // Force fast polling right away, then poll immediately rather than
    // waiting out whatever's left of the current interval.
    fastUntilRef.current = Date.now() + ACTIVE_POLL_MS * 4;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void tickRef.current?.(), 250);
  }, []);

  const reportTriggerError = useCallback((message: string) => {
    setTriggerError(message);
  }, []);

  return (
    <ScanStatusContext.Provider value={{ data, triggerError, reportTriggerStarted, reportTriggerError }}>
      {children}
    </ScanStatusContext.Provider>
  );
}

export function useScanStatus(): ScanStatusContextValue {
  const ctx = useContext(ScanStatusContext);
  if (!ctx) throw new Error("useScanStatus must be used within a ScanStatusProvider");
  return ctx;
}
