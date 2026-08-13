/**
 * shell-status-context.tsx
 *
 * Single shared source of truth for the shell top bar's real status
 * indicators (Project Scope, Service Status, Compliance, Open Requests) and
 * the shell sidebar's M365 Health circle. All CustomerUser-only.
 *
 * Deliberately a slow-refreshing, fetch-once-then-poll-every-5-minutes
 * context — these are not fast-moving signals like the scan-status poll
 * (see scan-status-context.tsx), so there is no need to hit them every
 * 30-45s from every page in the shell.
 *
 * Reuses four pre-existing, real endpoints — no new server-side logic:
 *   - GET /api/portal/customer/scope-status   — Scope Creep Engine (Project Scope indicator)
 *   - GET /api/portal/customer/sla-status     — SLA Engine (Service Status indicator + Open Requests count)
 *   - GET /api/portal/mission-control/overview — real findings feed (Compliance count, via the
 *     same TOPIC_KEYWORDS filter compliance.tsx already uses)
 *   - GET /api/portal/assessment/status       — real pillar radar (M365 Health circle score)
 *
 * The first three are requireRole("CustomerUser") server-side; Assessment/Free
 * accounts sit below that floor and skip them entirely (#317) rather than
 * polling a guaranteed 403 every 5 minutes. assessment/status is floored at
 * "Assessment" itself, so it stays on for every role.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";
import { filterFindingsByTopic, type TopicFinding } from "@/components/health-suite/useTopicHealthLive";

const COMPLIANCE_KEYWORDS = [
  "compliance",
  "dlp",
  "label",
  "retention",
  "ediscovery",
  "audit",
  "shar",
  "guest",
  "external",
  "public channel",
  "onedrive",
];

type OverallStatus = "on_track" | "attention_needed" | "action_required";

export interface ScopeStatusPayload {
  overall: OverallStatus;
  headline: string;
  openItems: number;
}

export interface SlaStatusPayload {
  overall: OverallStatus;
  headline: string;
  openRequests: number;
}

export interface HealthRadarPillar {
  pillar: string;
  label: string;
  score: number;
}

interface ShellStatusValue {
  loaded: boolean;
  scopeStatus: ScopeStatusPayload | null;
  slaStatus: SlaStatusPayload | null;
  complianceFindingCount: number | null;
  healthScore: number | null;
}

const ShellStatusContext = createContext<ShellStatusValue | null>(null);

const REFRESH_MS = 5 * 60_000;

export function ShellStatusProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const [scopeStatus, setScopeStatus] = useState<ScopeStatusPayload | null>(null);
  const [slaStatus, setSlaStatus] = useState<SlaStatusPayload | null>(null);
  const [complianceFindingCount, setComplianceFindingCount] = useState<number | null>(null);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // scope-status/sla-status/mission-control/overview are all requireRole("CustomerUser")
  // server-side, and Assessment/Free both sit below that floor (see ROLE_ORDER in
  // requireAuth.ts) — for those two roles every one of these three calls is a
  // guaranteed 403, every 5 minutes, for data that isn't meaningful for that role
  // in the first place. #317: `silent: true` already suppresses any toast for that
  // 403 (see fetchWithAuth), so this isn't fixing a visible bug — it's cutting the
  // dead traffic these roles can never get a real answer from. `assessment/status`
  // below is floored at "Assessment" itself, so it stays on for every role.
  const belowCustomerFloor = user?.mspRole === "Assessment" || user?.mspRole === "Free";

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    const loadScope = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/customer/scope-status", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as ScopeStatusPayload;
        if (!cancelled) setScopeStatus(data);
      } catch {
        // best-effort — shell renders honest empty state
      }
    };

    const loadSla = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/customer/sla-status", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as SlaStatusPayload;
        if (!cancelled) setSlaStatus(data);
      } catch {
        // best-effort
      }
    };

    const loadCompliance = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/mission-control/overview", undefined, { silent: true });
        if (!res.ok) return; // 403 for Assessment-role viewers → honest empty
        const data = (await res.json()) as { findings?: TopicFinding[] };
        const findings = Array.isArray(data.findings) ? data.findings : [];
        if (!cancelled) setComplianceFindingCount(filterFindingsByTopic(findings, COMPLIANCE_KEYWORDS).length);
      } catch {
        // best-effort
      }
    };

    const loadHealth = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/assessment/status", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as { radar?: { pillars?: HealthRadarPillar[] } };
        const pillars = Array.isArray(data.radar?.pillars) ? data.radar!.pillars! : [];
        if (!cancelled) {
          setHealthScore(
            pillars.length > 0
              ? Math.round(pillars.reduce((sum, p) => sum + p.score, 0) / pillars.length)
              : null,
          );
        }
      } catch {
        // best-effort
      }
    };

    const tick = async () => {
      if (cancelled) return;
      await Promise.allSettled(
        belowCustomerFloor ? [loadHealth()] : [loadScope(), loadSla(), loadCompliance(), loadHealth()],
      );
      if (cancelled) return;
      setLoaded(true);
      timerRef.current = setTimeout(() => void tick(), REFRESH_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [accessToken, fetchWithAuth, belowCustomerFloor]);

  return (
    <ShellStatusContext.Provider value={{ loaded, scopeStatus, slaStatus, complianceFindingCount, healthScore }}>
      {children}
    </ShellStatusContext.Provider>
  );
}

export function useShellStatus(): ShellStatusValue {
  const ctx = useContext(ShellStatusContext);
  if (!ctx) throw new Error("useShellStatus must be used within a ShellStatusProvider");
  return ctx;
}
