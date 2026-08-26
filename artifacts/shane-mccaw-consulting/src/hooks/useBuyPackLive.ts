// useBuyPackLive — Git #1316 (Phase 7 of Epic #1309).
//
// The live data layer behind Buy.tsx's pack dry-run/approve/execute stages:
//   GET  /api/public/purchase/pack-dry-run    → the REAL dry-run (every write the
//        paid packs will perform, with the tenant's ACTUAL current value read
//        live), mapped into the same row shape the page's authored fixture
//        (buyCheckout.ts DRY_ACTIONS) renders, so the dry-run UI is identical
//        whether it is showing the demo fixture or real tenant state.
//   POST /api/public/purchase/pack-execute    → fires the purchased packs through
//        the real workflow engine (config-pack-orchestrator.ts).
//   GET  /api/public/purchase/pack-run-status → real per-step progress, polled
//        while the executing screen is up.
//
// Live mode engages only when a REAL checkout session id is present — from
// ?session= (a resume link / the post-payment redirect) or the flow's own
// localStorage slot (same convention as AssessmentFlow.tsx's session key).
// Without one, Buy.tsx keeps its authored-fixture demo behavior unchanged;
// with one, fixture values are never shown — a failed live read is surfaced
// as an explicit error with a retry, never silently swapped for demo numbers.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DryAction, Impact } from "../marketing/data/buyCheckout";

export const BUY_SESSION_STORAGE_KEY = "smc_buy_flow_session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BuyLiveAction = DryAction & {
  pack: string;
  packName: string;
  satisfied: boolean;
  templateId: string | null;
};

export interface BuyLivePack {
  serviceSlug: string;
  serviceName: string;
  priceCents: number | null;
  packKey: string | null;
  executable: boolean;
  missingOperatorVariables: string[];
  gated: boolean;
}

interface WireDryRunAction {
  templateId: string | null;
  checkKey: string | null;
  label: string;
  method: string | null;
  endpoint: string | null;
  plannedWrite: Record<string, unknown> | null;
  changeKind: "create" | "update" | "delete" | "check";
  currentState: { fetched: boolean; values?: Record<string, unknown>; status?: number; note?: string };
  alreadySatisfied: boolean | null;
  reversible: boolean;
  gatedHere: boolean;
  dependsOnRunOutputs: string[];
  missingVariables: string[];
}

interface WireDryRunPack {
  serviceSlug: string;
  serviceName: string;
  priceCents: number | null;
  packKey: string | null;
  executable?: boolean;
  missingOperatorVariables?: string[];
  gated?: boolean;
  actions?: WireDryRunAction[];
  readAt?: string;
  error?: { code: string; message: string };
}

interface WireRunStatusPack {
  serviceSlug: string;
  packKey: string | null;
  runId?: number;
  status: string;
  gated?: boolean;
  errorMessage?: string | null;
  steps?: Array<{ nodeId: string; label: string; status: "ok" | "error" | "skipped" | "pending" }>;
  completedWrites?: number;
  totalWrites?: number;
}

export type BuyLiveRunPhase =
  | "idle"
  | "starting"
  | "running"
  | "awaiting_verification"
  | "completed"
  | "failed"
  | "error";

export interface BuyLiveRunState {
  phase: BuyLiveRunPhase;
  error: string | null;
  runIds: number[];
  completed: number;
  total: number;
  currentLabel: string | null;
  /** templateId → real per-step outcome, for the change-record table. */
  stepResults: Record<string, "ok" | "error" | "skipped" | "pending">;
}

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return "not set";
  let s: string;
  if (typeof v === "object") {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  return s.length > 64 ? s.slice(0, 61) + "…" : s;
};

const fmtFields = (obj: Record<string, unknown> | null): string => {
  const entries = Object.entries(obj ?? {});
  if (!entries.length) return "not set";
  const shown = entries.slice(0, 3).map(([k, v]) => `${k}: ${fmtVal(v)}`);
  return shown.join(" · ") + (entries.length > 3 ? ` · +${entries.length - 3} more` : "");
};

const KIND_IMPACT: Record<WireDryRunAction["changeKind"], Impact> = {
  create: "safe",
  update: "notice",
  delete: "disruptive",
  check: "safe",
};

function toDisplayAction(pack: WireDryRunPack, a: WireDryRunAction): BuyLiveAction {
  const from =
    a.changeKind === "create"
      ? "None exists"
      : a.currentState.fetched
        ? fmtFields(a.currentState.values ?? null)
        : (a.currentState.note ?? "Current value not readable");
  const to =
    a.changeKind === "check"
      ? "Read-only check — nothing written"
      : fmtFields(a.plannedWrite);
  const noteParts: string[] = [];
  if (a.gatedHere) noteParts.push("Pauses for tenant-admin verification before the next step.");
  if (a.missingVariables.length > 0)
    noteParts.push(`Needs configuration from your architect: ${a.missingVariables.join(", ")}.`);
  return {
    id: a.templateId ?? a.checkKey ?? `${pack.serviceSlug}-${a.label}`,
    templateId: a.templateId,
    title: a.label,
    touches: a.method && a.endpoint ? `${a.method} ${a.endpoint}` : "Read-only monitor check",
    from,
    to,
    impact: KIND_IMPACT[a.changeKind],
    reversible: a.reversible,
    ...(noteParts.length ? { note: noteParts.join(" ") } : {}),
    pack: pack.serviceSlug,
    packName: pack.serviceName,
    satisfied: a.alreadySatisfied === true,
  };
}

/** The step node id the materialized graph uses for a template (mirrors
 *  config-pack-graph.ts's templateNodeId — dots sanitized). */
const templateNodeId = (templateId: string): string => `tpl-${templateId.replace(/\./g, "-")}`;

export interface BuyPackLive {
  sessionId: string | null;
  dryStatus: "idle" | "loading" | "ready" | "error";
  dryError: string | null;
  packs: BuyLivePack[];
  actions: BuyLiveAction[];
  readAt: string | null;
  fetchDryRun: () => Promise<boolean>;
  run: BuyLiveRunState;
  startExecution: () => Promise<boolean>;
}

export function useBuyPackLive(enabled: boolean, sessionIdFromState?: string | null): BuyPackLive {
  const [storedSessionId] = useState<string | null>(() => {
    if (!enabled) return null;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("session");
      if (fromUrl && UUID_RE.test(fromUrl)) {
        try {
          window.localStorage.setItem(BUY_SESSION_STORAGE_KEY, fromUrl);
        } catch {
          /* storage unavailable — param alone still works */
        }
        return fromUrl;
      }
      const stored = window.localStorage.getItem(BUY_SESSION_STORAGE_KEY);
      return stored && UUID_RE.test(stored) ? stored : null;
    } catch {
      return null;
    }
  });
  // The stage machine's own session (minted by the real payment wiring, #1308)
  // wins over a resumed ?session=/storage id.
  const sessionId =
    enabled && sessionIdFromState && UUID_RE.test(sessionIdFromState)
      ? sessionIdFromState
      : storedSessionId;

  const [dryStatus, setDryStatus] = useState<BuyPackLive["dryStatus"]>("idle");
  const [dryError, setDryError] = useState<string | null>(null);
  const [packs, setPacks] = useState<BuyLivePack[]>([]);
  const [actions, setActions] = useState<BuyLiveAction[]>([]);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [run, setRun] = useState<BuyLiveRunState>({
    phase: "idle",
    error: null,
    runIds: [],
    completed: 0,
    total: 0,
    currentLabel: null,
    stepResults: {},
  });
  const pollTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  const fetchDryRun = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    setDryStatus("loading");
    setDryError(null);
    try {
      const res = await fetch(`/api/public/purchase/pack-dry-run?sessionId=${encodeURIComponent(sessionId)}`);
      const body = (await res.json()) as { packs?: WireDryRunPack[]; error?: string };
      if (!res.ok || !Array.isArray(body.packs)) {
        setDryStatus("error");
        setDryError(body.error ?? `read_failed_${res.status}`);
        return false;
      }
      const nextPacks: BuyLivePack[] = body.packs.map((p) => ({
        serviceSlug: p.serviceSlug,
        serviceName: p.serviceName,
        priceCents: p.priceCents,
        packKey: p.packKey ?? null,
        executable: p.executable === true,
        missingOperatorVariables: p.missingOperatorVariables ?? [],
        gated: p.gated === true,
      }));
      const nextActions = body.packs.flatMap((p) => (p.actions ?? []).map((a) => toDisplayAction(p, a)));
      setPacks(nextPacks);
      setActions(nextActions);
      setReadAt(body.packs.find((p) => p.readAt)?.readAt ?? null);
      setDryStatus("ready");
      return true;
    } catch {
      setDryStatus("error");
      setDryError("network_error");
      return false;
    }
  }, [sessionId]);

  const applyRunStatus = useCallback(
    (wirePacks: WireRunStatusPack[]): BuyLiveRunPhase => {
      const runIds = wirePacks.map((p) => p.runId).filter((id): id is number => typeof id === "number");
      const stepResults: Record<string, "ok" | "error" | "skipped" | "pending"> = {};
      let completed = 0;
      let total = 0;
      let currentLabel: string | null = null;
      for (const p of wirePacks) {
        for (const s of p.steps ?? []) {
          stepResults[s.nodeId] = s.status;
          total += 1;
          if (s.status === "ok") completed += 1;
          else if (currentLabel === null && s.status === "pending") currentLabel = s.label;
        }
      }
      const started = wirePacks.filter((p) => p.runId !== undefined);
      const anyFailed = started.some((p) => p.status === "failed" || p.status === "cancelled");
      const anyLive = started.some((p) => p.status === "pending" || p.status === "running");
      const anyAwaiting = started.some((p) => p.status === "awaiting_approval");
      const phase: BuyLiveRunPhase =
        started.length === 0
          ? "error"
          : anyLive
            ? "running"
            : anyFailed
              ? "failed"
              : anyAwaiting
                ? "awaiting_verification"
                : "completed";
      setRun((prev) => ({
        ...prev,
        phase,
        runIds,
        completed,
        total,
        currentLabel,
        stepResults,
        error: phase === "error" ? (prev.error ?? "run_not_started") : prev.error,
      }));
      return phase;
    },
    [],
  );

  const pollRunStatus = useCallback(() => {
    if (!sessionId) return;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/public/purchase/pack-run-status?sessionId=${encodeURIComponent(sessionId)}`,
        );
        const body = (await res.json()) as { packs?: WireRunStatusPack[] };
        if (res.ok && Array.isArray(body.packs)) {
          const phase = applyRunStatus(body.packs);
          if (phase === "running") {
            pollTimer.current = window.setTimeout(tick, 1200);
          }
          return;
        }
      } catch {
        /* transient poll failure — retry below */
      }
      pollTimer.current = window.setTimeout(tick, 2000);
    };
    void tick();
  }, [sessionId, applyRunStatus]);

  const startExecution = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    setRun((prev) => ({ ...prev, phase: "starting", error: null }));
    try {
      const res = await fetch("/api/public/purchase/pack-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = (await res.json()) as {
        results?: Array<{ runId?: number; refused?: { code: string; message: string } }>;
        error?: string;
      };
      const fired = (body.results ?? []).some((r) => r.runId !== undefined);
      if (!res.ok && !fired) {
        const refusal = (body.results ?? []).find((r) => r.refused)?.refused;
        setRun((prev) => ({
          ...prev,
          phase: "error",
          error: refusal?.message ?? body.error ?? `execute_failed_${res.status}`,
        }));
        return false;
      }
      setRun((prev) => ({ ...prev, phase: "running" }));
      pollRunStatus();
      return true;
    } catch {
      setRun((prev) => ({ ...prev, phase: "error", error: "network_error" }));
      return false;
    }
  }, [sessionId, pollRunStatus]);

  return {
    sessionId,
    dryStatus,
    dryError,
    packs,
    actions,
    readAt,
    fetchDryRun,
    run,
    startExecution,
  };
}

/** Per-row outcome for the change record, from real step results. Accepts any
 *  action row shape — fixture rows (no templateId) simply report "pending". */
export function liveStepOutcome(
  action: { satisfied: boolean; templateId?: string | null },
  run: BuyLiveRunState,
): "applied" | "failed" | "pending" | "satisfied" {
  if (action.satisfied) return "satisfied";
  const nodeStatus = action.templateId ? run.stepResults[templateNodeId(action.templateId)] : undefined;
  if (nodeStatus === "ok") return "applied";
  if (nodeStatus === "error") return "failed";
  return "pending";
}
