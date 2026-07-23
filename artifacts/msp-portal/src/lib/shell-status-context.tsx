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
  const { accessToken, fetchWithAuth } = useAuth();
  const [scopeStatus, setScopeStatus] = useState<ScopeStatusPayload | null>(null);
  const [slaStatus, setSlaStatus] = useState<SlaStatusPayload | null>(null);
  const [complianceFindingCount, setComplianceFindingCount] = useState<number | null>(null);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      await Promise.allSettled([loadScope(), loadSla(), loadCompliance(), loadHealth()]);
      if (cancelled) return;
      setLoaded(true);
      timerRef.current = setTimeout(() => void tick(), REFRESH_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [accessToken, fetchWithAuth]);

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
