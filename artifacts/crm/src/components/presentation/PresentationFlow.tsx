import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import DocumentPanel from "./DocumentPanel";
import SowSelectorPanel from "./SowSelectorPanel";
import ContractSignPanel from "./ContractSignPanel";
import PaymentOptionsPanel from "./PaymentOptionsPanel";
import AnimatedBackground from "../quickwin/AnimatedBackground";
import { computeOverviewStats } from "@/lib/doc-stat-extractors";

interface PresentationDoc {
  id: number;
  title: string;
  category: "report" | "consulting";
  docType: string;
  htmlContent: string;
  createdAt: string | null;
}

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
}

interface AdjustmentLine {
  title: string;
  description: string;
  price: number;
}

interface PresentationData {
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  shareToken: string | null;
  documents: PresentationDoc[];
  sowPhases: SowPhase[];
  selectedPhaseIds: string[];
  totalPrice: number;
  adjustmentsTotal?: number;
  adjustmentLines?: AdjustmentLine[];
  sowVersion?: string;
  signatureData: string | null;
  signedAt: string | null;
  signerName: string | null;
  paymentPlan: "full" | "phased" | null;
  status: "draft" | "signed" | "paid";
  projectTitle: string | null;
  clientName: string | null;
  contractBody: string | null;
  workflowName: string | null;
  scopedSowHtml?: string | null;
  scopedTotalPrice?: number | null;
  scopedPhaseIds?: string[] | null;
}

interface PresentationFlowProps {
  presentationId: number;
  initialData: PresentationData;
  startAtPayment?: boolean;
  readOnly?: boolean;
  shareToken?: string;
  onClose: () => void;
}

type Step =
  | { kind: "welcome" }
  | { kind: "doc"; index: number }
  | { kind: "sow" }
  | { kind: "contract" }
  | { kind: "payment" }
  | { kind: "confirmation" };

function buildSteps(docs: PresentationDoc[], readOnly: boolean): Step[] {
  const steps: Step[] = [{ kind: "welcome" }];
  for (let i = 0; i < docs.length; i++) steps.push({ kind: "doc", index: i });
  steps.push({ kind: "sow" });
  if (!readOnly) {
    steps.push({ kind: "contract" });
    steps.push({ kind: "payment" });
    steps.push({ kind: "confirmation" });
  }
  return steps;
}

function stepLabel(step: Step, docs: PresentationDoc[]): string {
  if (step.kind === "welcome") return "Overview";
  if (step.kind === "doc") return docs[step.index]?.title ?? `Document ${step.index + 1}`;
  if (step.kind === "sow") return "Scope & Pricing";
  if (step.kind === "contract") return "Agreement";
  if (step.kind === "payment") return "Payment";
  if (step.kind === "confirmation") return "Confirmed";
  return "";
}

function stepIcon(step: Step) {
  if (step.kind === "welcome") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    );
  }
  if (step.kind === "doc") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (step.kind === "sow") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    );
  }
  if (step.kind === "contract") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    );
  }
  if (step.kind === "payment") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    );
  }
  if (step.kind === "confirmation") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  return null;
}

export default function PresentationFlow({
  presentationId,
  initialData,
  readOnly = false,
  shareToken,
  startAtPayment = false,
  onClose,
}: PresentationFlowProps) {
  const { fetchWithAuth, user } = useAuth();
  const search = useSearch();

  const [data, setData] = useState<PresentationData>(initialData);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Track the SOW version that was in effect when the page first loaded.
  // If a poll or SSE push reveals a different version the stale-scope banner appears.
  const initialSowVersionRef = useRef<string | undefined>(initialData.sowVersion);
  const initialDocFingerprintRef = useRef<string>(
    [...initialData.documents].map(d => d.id).sort((a, b) => a - b).join(","),
  );
  const [scopeStale, setScopeStale] = useState(false);
  const [docsStale, setDocsStale] = useState(false);
  const [refreshingScope, setRefreshingScope] = useState(false);

  // Dwell-time tracking: record when the client entered the current doc step
  const docStepStartRef = useRef<{ stepIndex: number; docId: number | null; docTitle: string; startMs: number } | null>(null);

  const computeInitialStep = () => {
    if (startAtPayment) {
      const steps = buildSteps(initialData.documents, readOnly);
      const targetKind = initialData.status === "paid" ? "confirmation" : "payment";
      const idx = steps.findIndex(s => s.kind === targetKind);
      return idx >= 0 ? idx : 0;
    }
    const urlStep = parseInt(new URLSearchParams(search).get("step") ?? "", 10);
    if (!isNaN(urlStep) && urlStep >= 0) {
      const steps = buildSteps(initialData.documents, readOnly);
      return Math.min(urlStep, steps.length - 1);
    }
    return 0;
  };

  const lsKey = `pf-progress-${presentationId}`;

  const computeInitialMaxVisited = () => {
    const base = computeInitialStep();
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored !== null) return Math.max(base, parseInt(stored, 10) || 0);
    } catch {
      // localStorage unavailable (private browsing, etc.) — fall through
    }
    return base;
  };

  const [stepIndex, setStepIndex] = useState(computeInitialStep);
  const [maxVisitedStep, setMaxVisitedStep] = useState(computeInitialMaxVisited);
  const [signerName, setSignerName] = useState(data.signerName ?? user?.name ?? "");

  // Keep ?step=N in the URL in sync with the active slide so refresh / shared
  // links land on the right slide.  Using replaceState avoids polluting the
  // back-button history with every slide advance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("step", String(stepIndex));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [stepIndex]);

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Slide-transition state
  const directionRef      = useRef<"forward" | "back">("forward");
  const pendingStepRef    = useRef<number | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  const sortedDocs = useMemo(() => {
    const isSow = (d: PresentationDoc) =>
      d.docType === "consolidated_sow" || d.docType === "sow";
    return [...data.documents].sort((a, b) => {
      if (isSow(a) && !isSow(b)) return 1;
      if (!isSow(a) && isSow(b)) return -1;
      return 0;
    });
  }, [data.documents]);

  const steps = buildSteps(sortedDocs, readOnly);
  const currentStep = steps[stepIndex];

  const [stepReady, setStepReady] = useState(() => {
    const s = steps[computeInitialStep()];
    return s?.kind !== "doc" && s?.kind !== "contract" && s?.kind !== "sow";
  });
  const stepReadyRef = useRef(stepReady);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const handleStepReady = useCallback(() => {
    if (!stepReadyRef.current) {
      stepReadyRef.current = true;
      setStepReady(true);
    }
    setLoadingTimedOut(false);
  }, []);

  useEffect(() => {
    if (stepReady) return;
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      if (!stepReadyRef.current) {
        stepReadyRef.current = true;
        setStepReady(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [stepReady]);

  const [savingSelections, setSavingSelections] = useState(false);
  const [signing, setSigning] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showLoginGate, setShowLoginGate] = useState(false);
  const [freeClaimError, setFreeClaimError] = useState<string | null>(null);

  // ── Scoped SOW regeneration state ─────────────────────────────────────────
  const [scopedSowDoc, setScopedSowDoc] = useState<string | null>(initialData.scopedSowHtml ?? null);
  const [scopedTotalPriceDollars, setScopedTotalPriceDollars] = useState<number | null>(initialData.scopedTotalPrice ?? null);
  const [lastRegenPhaseIds, setLastRegenPhaseIds] = useState<string[] | null>(initialData.scopedPhaseIds ?? null);
  const [regeneratingSow, setRegeneratingSow] = useState(false);

  const currentSowPhases = data.sowPhases ?? [];
  const selectedPhaseIds = data.selectedPhaseIds ?? currentSowPhases.map(p => p.id);
  const phasesWithSelection = currentSowPhases.map(p => ({
    ...p,
    selected: selectedPhaseIds.includes(p.id),
  }));
  const selectedPhases = phasesWithSelection.filter(p => p.selected);
  // selectedTotal is the workstream-only subtotal (what the Scoping panel shows as toggleable)
  const selectedTotal = selectedPhases.reduce((sum, p) => sum + p.price, 0) || data.totalPrice;
  // grandTotal includes price adjustments — used in Agreement, Payment, and checkout
  const grandTotal = selectedTotal + (data.adjustmentsTotal ?? 0);

  // ── Scoped SOW detection ───────────────────────────────────────────────────
  const allPhaseIds = currentSowPhases.map(p => p.id);
  const hasScopeReduction = allPhaseIds.length > 0 && !allPhaseIds.every(id => selectedPhaseIds.includes(id));
  // True when the last regeneration exactly matches the current selection
  const arraysMatch = (a: string[], b: string[]) =>
    a.length === b.length && a.every(id => b.includes(id));
  const scopedDocMatchesSelection = hasScopeReduction && scopedSowDoc !== null && lastRegenPhaseIds !== null && arraysMatch(lastRegenPhaseIds, selectedPhaseIds);
  // True when we need a (re)generation before the client can proceed
  const needsRegeneration = hasScopeReduction && !scopedDocMatchesSelection;
  // Effective price used for contract/payment steps
  const effectivePrice = hasScopeReduction && scopedDocMatchesSelection && scopedTotalPriceDollars !== null
    ? scopedTotalPriceDollars
    : grandTotal;

  // Aggregate stats for the Overview teaser cards — uses the same per-family
  // extractors as DocumentPanel's OMG panel so both surfaces show identical numbers.
  const overviewStats = useMemo(
    () => computeOverviewStats(data.documents),
    [data.documents]
  );

  const fetchFn = useCallback((url: string, opts?: RequestInit) => {
    if (user) return fetchWithAuth(url, opts);
    return fetch(url, opts);
  }, [user, fetchWithAuth]);

  // ── Stale-scope detection: SSE + 30-second polling fallback ──────────────
  // The page may stay open while Shane regenerates the SOW on the admin side.
  // When that happens, we need to alert the client before they sign/pay.

  const checkScopeVersion = useCallback(async () => {
    try {
      const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      const res = await fetchFn(`/api/portal/presentations/${presentationId}${tokenParam}`);
      if (!res.ok) return;
      const fresh = await res.json() as { sowVersion?: string; documents?: { id: number }[] };
      // Check SOW version staleness
      if (initialSowVersionRef.current && fresh.sowVersion && fresh.sowVersion !== initialSowVersionRef.current) {
        setScopeStale(true);
      }
      // Check document staleness (any doc added, removed, or replaced)
      const freshFingerprint = [...(fresh.documents ?? [])].map(d => d.id).sort((a, b) => a - b).join(",");
      if (freshFingerprint !== initialDocFingerprintRef.current) {
        setDocsStale(true);
      }
    } catch { /* non-fatal — ignore network errors */ }
  }, [fetchFn, presentationId, shareToken]);

  // SSE subscription — receives immediate push when Shane regenerates the SOW
  useEffect(() => {
    if (readOnly && !shareToken) return;
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    const url = `/api/portal/presentations/${presentationId}/scope-events${tokenParam}`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
      es.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string) as { type?: string; sowVersion?: string };
          if (payload.type === "scope_changed" || payload.type === "docs_changed") {
            void checkScopeVersion();
          }
        } catch { /* ignore malformed events */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
      };
    } catch { /* EventSource not available in this context */ }
    return () => { es?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId, shareToken]);

  // Polling fallback — checks every 30 seconds regardless of SSE
  useEffect(() => {
    const interval = setInterval(() => { void checkScopeVersion(); }, 30_000);
    return () => clearInterval(interval);
  }, [checkScopeVersion]);

  // Reload the presentation data after the admin updates the SOW
  const handleRefreshScope = useCallback(async () => {
    setRefreshingScope(true);
    try {
      const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      const res = await fetchFn(`/api/portal/presentations/${presentationId}${tokenParam}`);
      if (res.ok) {
        const fresh = await res.json() as PresentationData;
        // Update refs so future polls don't immediately re-trigger the banners
        initialSowVersionRef.current = fresh.sowVersion;
        initialDocFingerprintRef.current = [...(fresh.documents ?? [])].map(d => d.id).sort((a, b) => a - b).join(",");
        // Recompute the step list from fresh docs to get the new count before clamping
        const isSowDoc = (d: PresentationDoc) => d.docType === "consolidated_sow" || d.docType === "sow";
        const freshSortedDocs = [...(fresh.documents ?? [])].sort((a, b) => {
          if (isSowDoc(a) && !isSowDoc(b)) return 1;
          if (!isSowDoc(a) && isSowDoc(b)) return -1;
          return 0;
        });
        const freshStepCount = buildSteps(freshSortedDocs, readOnly).length;
        // Clamp current position and max-visited to the new step list size
        setStepIndex(prev => Math.min(prev, freshStepCount - 1));
        setMaxVisitedStep(prev => Math.min(prev, freshStepCount - 1));
        setData(fresh);
        setScopeStale(false);
        setDocsStale(false);
      }
    } catch { /* non-fatal */ } finally {
      setRefreshingScope(false);
    }
  }, [fetchFn, presentationId, shareToken, readOnly]);

  // Flush dwell time for the doc step that was just left
  const flushDocDwell = useCallback((leavingStepIndex: number) => {
    const entry = docStepStartRef.current;
    if (!entry || entry.stepIndex !== leavingStepIndex) return;
    docStepStartRef.current = null;
    const dwellSeconds = Math.max(0, Math.round((Date.now() - entry.startMs) / 1000));
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    void fetchFn(`/api/portal/presentations/${presentationId}/doc-views${tokenParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: entry.docId,
        documentTitle: entry.docTitle,
        dwellSeconds,
      }),
    }).catch(() => { /* fire-and-forget */ });
  }, [fetchFn, presentationId, shareToken]);

  const handleTogglePhase = async (phaseId: string) => {
    if (readOnly || !user) return;
    const newIds = selectedPhaseIds.includes(phaseId)
      ? selectedPhaseIds.filter(id => id !== phaseId)
      : [...selectedPhaseIds, phaseId];

    setData(prev => ({ ...prev, selectedPhaseIds: newIds }));

    // If the client re-selects all phases, clear the scoped SOW — it's no longer needed
    const isFullSelection = allPhaseIds.every(id => newIds.includes(id));
    if (isFullSelection) {
      setScopedSowDoc(null);
      setScopedTotalPriceDollars(null);
      setLastRegenPhaseIds(null);
    }

    setSavingSelections(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/selections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPhaseIds: newIds }),
      });
      if (res.ok) {
        const updated = await res.json() as { totalPrice: number; adjustmentsTotal?: number; adjustmentLines?: AdjustmentLine[]; selectedPhaseIds: string[] };
        setData(prev => ({ ...prev, ...updated }));
      }
    } finally {
      setSavingSelections(false);
    }
  };

  const handleRegenerateSow = async () => {
    if (!user || regeneratingSow) return;
    setRegeneratingSow(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/regenerate-scoped-sow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPhaseIds }),
      });
      if (res.ok) {
        const result = await res.json() as { scopedSowHtml: string; scopedTotalPrice: number; scopedPhaseIds: string[] };
        setScopedSowDoc(result.scopedSowHtml);
        setScopedTotalPriceDollars(result.scopedTotalPrice);
        setLastRegenPhaseIds(result.scopedPhaseIds);
      }
    } finally {
      setRegeneratingSow(false);
    }
  };

  const handleSign = async (signatureData: string, name: string) => {
    setSigning(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData, signerName: name }),
      });
      if (res.ok) {
        // Zero-price offers skip Stripe entirely — call claim-free and jump to confirmation
        if (grandTotal === 0) {
          setCheckingOut(true);
          setFreeClaimError(null);
          try {
            const claimRes = await fetchFn(`/api/portal/presentations/${presentationId}/claim-free`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });
            if (claimRes.ok) {
              window.location.href = `${window.location.pathname}?payment=success`;
            } else {
              const body = await claimRes.json().catch(() => ({})) as { error?: string };
              setFreeClaimError(body.error ?? "Something went wrong. Please try again or contact support.");
            }
          } catch {
            setFreeClaimError("Network error. Please check your connection and try again.");
          } finally {
            setCheckingOut(false);
          }
          return;
        }

        setData(prev => ({
          ...prev,
          signatureData,
          signerName: name,
          signedAt: new Date().toISOString(),
          status: "signed",
        }));
        goNext();
      }
    } finally {
      setSigning(false);
    }
  };

  const handleCheckout = async (plan: "full" | "phased") => {
    setCheckingOut(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPlan: plan }),
      });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        window.location.href = url;
      }
    } finally {
      setCheckingOut(false);
    }
  };

  const isAsyncStep = (step: Step | undefined) =>
    step?.kind === "doc" || step?.kind === "contract" || step?.kind === "sow";

  const applyStepChange = useCallback((nextIndex: number) => {
    // Flush dwell time for the step we're leaving if it was a doc step
    flushDocDwell(stepIndex);
    // Cancel any in-progress transition before starting a new one
    if (transitionTimerRef.current !== null) {
      clearTimeout(transitionTimerRef.current);
    }
    pendingStepRef.current = nextIndex;
    setIsExiting(true);
    // After exit animation completes (~220ms), commit the step change and scroll reset
    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      const next = pendingStepRef.current;
      if (next === null) return;
      pendingStepRef.current = null;
      if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = 0;
      const nextStep = steps[next];
      const ready = !isAsyncStep(nextStep);
      stepReadyRef.current = ready;
      setStepReady(ready);
      setLoadingTimedOut(false);
      setStepIndex(next);
      setIsExiting(false);
    }, 220);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, stepIndex, flushDocDwell]);

  // Persist visited progress across sessions — keyed by presentationId
  useEffect(() => {
    try {
      localStorage.setItem(lsKey, String(maxVisitedStep));
    } catch {
      // localStorage unavailable — silently skip
    }
  }, [lsKey, maxVisitedStep]);

  // Track when we enter a doc step — record start time
  useEffect(() => {
    if (currentStep?.kind === "doc") {
      const doc = sortedDocs[currentStep.index];
      docStepStartRef.current = {
        stepIndex,
        docId: doc?.id ?? null,
        docTitle: doc?.title ?? `Document ${currentStep.index + 1}`,
        startMs: Date.now(),
      };
    } else {
      docStepStartRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const goNext = () => {
    if (readOnly && currentStep?.kind === "sow") {
      setShowLoginGate(true);
      return;
    }
    if (stepIndex < steps.length - 1) {
      const next = stepIndex + 1;
      directionRef.current = "forward";
      setMaxVisitedStep(m => Math.max(m, next));
      applyStepChange(next);
    }
  };

  const goPrev = () => {
    if (stepIndex > 0) {
      directionRef.current = "back";
      applyStepChange(stepIndex - 1);
    }
  };

  const navigateToStep = (i: number) => {
    if (i <= maxVisitedStep) {
      directionRef.current = i > stepIndex ? "forward" : "back";
      applyStepChange(i);
      setSidebarOpen(false);
    }
  };

  // Tracks which card names have already fired a card_click event this session.
  // Prevents duplicate events when the client returns to the Overview and re-clicks.
  const firedCardClicks = useRef(new Set<string>());

  // Jump from the Overview teaser cards — unlocks the target step and navigates immediately
  // Also fires a fire-and-forget card_click event (first click per cardName only)
  const jumpToStep = useCallback((idx: number, cardName?: string) => {
    if (idx < 0 || idx >= steps.length) return;
    if (cardName && !firedCardClicks.current.has(cardName)) {
      firedCardClicks.current.add(cardName);
      const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      void fetchFn(`/api/portal/presentations/${presentationId}/doc-views${tokenParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "card_click", cardName }),
      }).catch(() => { /* fire-and-forget */ });
    }
    directionRef.current = idx > stepIndex ? "forward" : "back";
    setMaxVisitedStep(m => Math.max(m, idx));
    applyStepChange(idx);
  }, [steps.length, applyStepChange, stepIndex, fetchFn, presentationId, shareToken]);

  const firstDocStepIndex = steps.findIndex(s => s.kind === "doc");
  const sowStepIndex      = steps.findIndex(s => s.kind === "sow");
  const contractStepIndex = steps.findIndex(s => s.kind === "contract");
  const paymentStepIndex  = steps.findIndex(s => s.kind === "payment");

  // Flush on unmount (e.g. user closes via browser back / ESC) for the current doc step
  // Also cancel any pending slide transition timer
  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        clearTimeout(transitionTimerRef.current);
      }
      const entry = docStepStartRef.current;
      if (!entry) return;
      const dwellSeconds = Math.max(0, Math.round((Date.now() - entry.startMs) / 1000));
      const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      // Use fetch directly (fetchFn may be stale at unmount time)
      fetch(`/api/portal/presentations/${presentationId}/doc-views${tokenParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: entry.docId,
          documentTitle: entry.docTitle,
          dwellSeconds,
        }),
      }).catch(() => { /* fire-and-forget */ });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isConfirmation = currentStep?.kind === "confirmation";
  const isPaid = data.status === "paid";

  const SidebarContent = () => (
    <div className="flex flex-col h-full min-h-0">
      {/* Sidebar header */}
      <div className="flex-shrink-0 px-4 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight truncate">
                {data.projectTitle ?? "Your Assessment Results"}
              </p>
              {readOnly && (
                <p className="text-white/40 text-[10px] mt-0.5">Preview — sign in to proceed</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Step list */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {steps.map((step, i) => {
          const isActive = i === stepIndex;
          const isVisited = i <= maxVisitedStep && i !== stepIndex;
          const isFuture = i > maxVisitedStep;
          return (
            <button
              key={i}
              onClick={() => { if (!isFuture) navigateToStep(i); }}
              title={isActive ? "Current step" : isVisited ? "Click to go back to this step" : `Complete step ${i} to unlock`}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all mb-0.5 ${
                isActive
                  ? "bg-[#0078D4] text-white cursor-pointer"
                  : isVisited
                  ? "text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
                  : isFuture
                  ? "text-white/25 cursor-not-allowed"
                  : ""
              }`}
            >
              {/* Step number dot */}
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                isActive
                  ? "bg-white/20 text-white"
                  : isVisited
                  ? "bg-white/20 text-white/70"
                  : "bg-white/10 text-white/30"
              }`}>
                {isVisited ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isFuture ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="text-[12px] font-medium leading-tight line-clamp-2">
                {stepLabel(step, sortedDocs)}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Sidebar footer: progress */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white/50 text-[11px]">Progress</span>
          <span className="text-white/70 text-[11px] font-semibold">Step {stepIndex + 1} of {steps.length}</span>
        </div>
        <div className="flex gap-0.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all ${
                i < stepIndex
                  ? "bg-[#0078D4]"
                  : i === stepIndex
                  ? "bg-white"
                  : "bg-white/15"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[10000] flex bg-[#F7F9FC]">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden sm:flex flex-col w-[220px] flex-shrink-0 bg-[#0A2540]">
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar drawer overlay ── */}
      {sidebarOpen && (
        <div className="sm:hidden fixed inset-0 z-[10002] flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-[260px] flex flex-col bg-[#0A2540] h-full shadow-2xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Stale banner — shown when documents or scope have changed since the page loaded */}
        {(scopeStale || docsStale) && (
          <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="flex-1 text-sm text-amber-800 font-medium">
              {scopeStale && docsStale
                ? "Your documents and scope of work have been updated — refresh to see the latest."
                : docsStale
                ? "New or updated documents are available — refresh to see them."
                : "The scope of work has been updated. Please review the latest pricing before signing or paying."}
            </p>
            <button
              onClick={() => { void handleRefreshScope(); }}
              disabled={refreshingScope}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 transition-colors"
            >
              {refreshingScope ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {refreshingScope ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={() => { setScopeStale(false); setDocsStale(false); }}
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-amber-600 hover:bg-amber-200 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Mobile top bar */}
        <div className="sm:hidden flex-shrink-0 bg-[#0A2540] border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
            aria-label="Open navigation"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <p className="text-white text-sm font-semibold truncate flex-1 text-center">
            {stepLabel(currentStep, sortedDocs)}
          </p>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto relative">
          {/* Timeout notice — shown when content took longer than 3s to signal ready */}
          {loadingTimedOut && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-700 text-xs font-medium">
              <svg className="w-3.5 h-3.5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Still loading… content may be incomplete until fully available.
            </div>
          )}
          {/* Skeleton overlay — shown while async steps (doc, contract) are loading */}
          {!stepReady && (
            <div className="absolute inset-0 z-10 max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4 pointer-events-none">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-10 h-10 rounded-xl bg-slate-200 overflow-hidden relative flex-shrink-0">
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-4 bg-slate-200 rounded w-2/5 overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
                  </div>
                  <div className="h-3 bg-slate-200 rounded w-1/4 overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
              <div className="flex-1 bg-slate-100 rounded-xl overflow-hidden relative">
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]" />
              </div>
            </div>
          )}
          <div key={stepIndex} className={`max-w-4xl mx-auto px-4 sm:px-6 py-6 h-full flex flex-col ${
            isExiting
              ? (directionRef.current === "forward" ? "animate-slide-out-left" : "animate-slide-out-right")
              : stepReady
              ? (directionRef.current === "forward" ? "animate-slide-in-from-right" : "animate-slide-in-from-left")
              : "invisible"
          }`}>

            {/* Welcome step */}
            {currentStep?.kind === "welcome" && (() => {
              const total      = selectedTotal || data.totalPrice;
              const fmtCur     = (n: number) =>
                new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
              const totalFmt   = total > 0 ? fmtCur(total) : "";
              const upfrontFmt = total > 0 ? fmtCur(Math.round(total * 0.2)) : "";
              const topPhases  = (data.sowPhases ?? []).slice(0, 3);
              const extraPhases = Math.max(0, (data.sowPhases?.length ?? 0) - 3);
              return (
                <>
                  <div className="fixed inset-0 -z-10 pointer-events-none">
                    <AnimatedBackground />
                  </div>
                  <div className="relative z-10 flex-1 flex flex-col items-center text-center gap-6 py-2 max-w-2xl mx-auto w-full">

                    {/* Icon + heading */}
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
                        <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <h1 className="text-2xl font-extrabold text-[#0A2540]">
                          {data.projectTitle ?? "Your Assessment Results"}
                        </h1>
                        <p className="text-muted-foreground mt-1.5 leading-relaxed max-w-md mx-auto text-sm">
                          {data.clientName ? `Hi ${data.clientName.split(" ")[0]}, your` : "Your"} {data.workflowName ?? "assessment"} is complete.
                          Walk through your deliverables, scope, and engagement options below.
                        </p>
                      </div>
                    </div>

                    {/* Summary counters */}
                    <div className="grid grid-cols-3 gap-3 w-full text-center">
                      <div className="bg-white rounded-xl border border-border p-4">
                        <p className="text-2xl font-extrabold text-[#0078D4]">{data.documents.length}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Reports</p>
                      </div>
                      <div className="bg-white rounded-xl border border-border p-4">
                        <p className="text-2xl font-extrabold text-[#0078D4]">{data.sowPhases?.length ?? 0}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Phases</p>
                      </div>
                      <div className="bg-white rounded-xl border border-border p-4">
                        <p className="text-2xl font-extrabold text-[#0078D4]">
                          {total >= 1000 ? `$${Math.round(total / 1000)}k` : total > 0 ? `$${total}` : "TBD"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Investment</p>
                      </div>
                    </div>

                    {/* ── Teaser cards ────────────────────────────────────────── */}
                    {(() => {
                      const docsVisited     = firstDocStepIndex >= 0 && maxVisitedStep >= firstDocStepIndex;
                      const docsReviewedCount = firstDocStepIndex >= 0
                        ? Math.min(sortedDocs.length, Math.max(0, maxVisitedStep - firstDocStepIndex + 1))
                        : 0;
                      const sowVisited      = sowStepIndex >= 0 && maxVisitedStep >= sowStepIndex;
                      const contractVisited = contractStepIndex >= 0 && maxVisitedStep >= contractStepIndex;
                      const paymentVisited  = paymentStepIndex >= 0 && maxVisitedStep >= paymentStepIndex;

                      const ReviewedBadge = () => (
                        <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full leading-none">
                          <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Reviewed
                        </span>
                      );

                      const totalSections = [firstDocStepIndex, sowStepIndex, contractStepIndex, paymentStepIndex].filter(i => i >= 0).length;
                      const reviewedSections = [docsVisited, sowVisited, contractVisited, paymentVisited].filter(Boolean).length;
                      const allReviewed = reviewedSections === totalSections && totalSections > 0;

                      return (
                        <>
                        {maxVisitedStep > 0 && totalSections > 0 && (
                          <div className={`flex items-center gap-3 w-full mb-4 px-4 py-3 rounded-xl border ${allReviewed ? "bg-emerald-50 border-emerald-200" : "bg-blue-50 border-blue-200"}`}>
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${allReviewed ? "bg-emerald-100" : "bg-[#0078D4]/10"}`}>
                              {allReviewed ? (
                                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold ${allReviewed ? "text-emerald-700" : "text-[#0078D4]"}`}>
                                {allReviewed ? "All sections reviewed — you're all caught up!" : `${reviewedSections} of ${totalSections} section${totalSections !== 1 ? "s" : ""} reviewed`}
                              </p>
                              <div className="mt-1.5 h-1.5 w-full bg-white/70 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${allReviewed ? "bg-emerald-500" : "bg-[#0078D4]"}`}
                                  style={{ width: `${Math.round((reviewedSections / totalSections) * 100)}%` }}
                                />
                              </div>
                            </div>
                            <span className={`text-xs font-bold flex-shrink-0 ${allReviewed ? "text-emerald-700" : "text-[#0078D4]"}`}>
                              {Math.round((reviewedSections / totalSections) * 100)}%
                            </span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full text-left">

                          {/* 1 — Documents / findings */}
                          {firstDocStepIndex >= 0 && (
                            <button
                              onClick={() => jumpToStep(firstDocStepIndex, "documents")}
                              className="group relative bg-white rounded-xl border border-border p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${docsVisited ? "bg-emerald-500" : "bg-red-500"}`} />
                              {docsVisited && <ReviewedBadge />}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${docsVisited ? "bg-emerald-50" : "bg-red-50"}`}>
                                  <svg className={`w-4 h-4 ${docsVisited ? "text-emerald-600" : "text-red-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${docsVisited ? "text-emerald-600" : "text-red-500"}`}>Your Reports</span>
                              </div>
                              {/* Stat grid — shows whichever of the four metrics were found */}
                              {(overviewStats.criticalMentions > 0 || overviewStats.worstScore !== null || overviewStats.wastedLicenses !== null || overviewStats.annualWaste !== null || overviewStats.hasZeroDlp) ? (
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  {overviewStats.criticalMentions > 0 && (
                                    <div>
                                      <p className="text-2xl font-extrabold text-red-600">{overviewStats.criticalMentions}</p>
                                      <p className="text-[11px] text-muted-foreground leading-tight">Critical issues found</p>
                                    </div>
                                  )}
                                  {overviewStats.worstScore !== null && (
                                    <div>
                                      <p className={`text-2xl font-extrabold ${overviewStats.worstScore <= 20 ? "text-red-600" : overviewStats.worstScore <= 40 ? "text-amber-600" : "text-[#0078D4]"}`}>
                                        {overviewStats.worstScore}/100
                                      </p>
                                      <p className="text-[11px] text-muted-foreground leading-tight">Lowest security score</p>
                                    </div>
                                  )}
                                  {(overviewStats.wastedLicenses !== null || overviewStats.annualWaste !== null) && (
                                    <div>
                                      <p className="text-2xl font-extrabold text-amber-600">
                                        {overviewStats.annualWaste ?? `${overviewStats.wastedLicenses}`}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground leading-tight">
                                        {overviewStats.annualWaste ? "Annual license waste" : "Unused licenses"}
                                      </p>
                                    </div>
                                  )}
                                  {overviewStats.hasZeroDlp && (
                                    <div>
                                      <p className="text-2xl font-extrabold text-red-600">ZERO</p>
                                      <p className="text-[11px] text-muted-foreground leading-tight">DLP policies active</p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="mb-4 min-h-[3rem]">
                                  <p className="text-sm font-bold text-[#0A2540]">{data.documents.length} report{data.documents.length !== 1 ? "s" : ""} ready</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">Your full assessment is waiting</p>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                {docsVisited ? (
                                  <span className="text-[11px] font-semibold text-emerald-700">
                                    {docsReviewedCount} of {sortedDocs.length} doc{sortedDocs.length !== 1 ? "s" : ""} read
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">{data.documents.length} report{data.documents.length !== 1 ? "s" : ""} included</span>
                                )}
                                <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${docsVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>
                                  {docsVisited ? "Review again" : "See your reports"}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </span>
                              </div>
                            </button>
                          )}

                          {/* 2 — Scope & Investment */}
                          {sowStepIndex >= 0 && (
                            <button
                              onClick={() => jumpToStep(sowStepIndex, "scope")}
                              className="group relative bg-white rounded-xl border border-border p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${sowVisited ? "bg-emerald-500" : "bg-[#0078D4]"}`} />
                              {sowVisited && <ReviewedBadge />}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${sowVisited ? "bg-emerald-50" : "bg-[#0078D4]/10"}`}>
                                  <svg className={`w-4 h-4 ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>Scope & Investment</span>
                              </div>
                              <div className="mb-4 min-h-[3rem]">
                                {totalFmt && (
                                  <p className="text-2xl font-extrabold text-[#0A2540] mb-2">{totalFmt}</p>
                                )}
                                {topPhases.length > 0 && (
                                  <ul className="space-y-0.5">
                                    {topPhases.map((phase, i) => (
                                      <li key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <div className={`w-1 h-1 rounded-full flex-shrink-0 ${sowVisited ? "bg-emerald-500" : "bg-[#0078D4]"}`} />
                                        <span className="truncate">{phase.title}</span>
                                      </li>
                                    ))}
                                    {extraPhases > 0 && (
                                      <li className="text-[11px] text-muted-foreground ml-2.5">+{extraPhases} more phase{extraPhases !== 1 ? "s" : ""}</li>
                                    )}
                                  </ul>
                                )}
                              </div>
                              <div className="flex items-center justify-end">
                                <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>
                                  {sowVisited ? "Review again" : "Review scope"}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </span>
                              </div>
                            </button>
                          )}

                          {/* 3 — Agreement */}
                          {contractStepIndex >= 0 && (
                            <button
                              onClick={() => jumpToStep(contractStepIndex, "agreement")}
                              className="group relative bg-white rounded-xl border border-border p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${contractVisited ? "bg-emerald-500" : "bg-slate-400"}`} />
                              {contractVisited && <ReviewedBadge />}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${contractVisited ? "bg-emerald-50" : "bg-slate-100"}`}>
                                  <svg className={`w-4 h-4 ${contractVisited ? "text-emerald-600" : "text-slate-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${contractVisited ? "text-emerald-600" : "text-slate-500"}`}>Agreement</span>
                              </div>
                              <p className="text-sm font-bold text-[#0A2540] mb-3">Personalised, legally binding e-signature contract</p>
                              <div className="flex flex-wrap gap-1.5 mb-4">
                                {(["E-Signature", "Legally Binding", "Personalised Contract"] as const).map(pill => (
                                  <span key={pill} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${contractVisited ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    {pill}
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center justify-end">
                                <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${contractVisited ? "text-emerald-600" : "text-slate-500"}`}>
                                  {contractVisited ? "Review again" : "Preview agreement"}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </span>
                              </div>
                            </button>
                          )}

                          {/* 4 — Payment */}
                          {paymentStepIndex >= 0 && (
                            <button
                              onClick={() => jumpToStep(paymentStepIndex, "payment")}
                              className="group relative bg-white rounded-xl border border-border p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${paymentVisited ? "bg-emerald-500" : "bg-purple-500"}`} />
                              {paymentVisited && <ReviewedBadge />}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${paymentVisited ? "bg-emerald-50" : "bg-purple-50"}`}>
                                  <svg className={`w-4 h-4 ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`}>Payment</span>
                              </div>
                              {upfrontFmt ? (
                                <div className="mb-3 min-h-[3rem]">
                                  <p className="text-2xl font-extrabold text-[#0A2540]">
                                    {upfrontFmt} <span className="text-sm font-bold text-muted-foreground">to start</span>
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">20% deposit · remaining billed per milestone</p>
                                </div>
                              ) : (
                                <div className="mb-3 min-h-[3rem]">
                                  <p className="text-sm font-bold text-[#0A2540]">Flexible payment options</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">Pay in full or by milestone</p>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 mb-4">
                                <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${paymentVisited ? "bg-emerald-50 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>Milestone billing</span>
                                <span className="inline-flex items-center text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Or pay in full</span>
                              </div>
                              <div className="flex items-center justify-end">
                                <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`}>
                                  {paymentVisited ? "Review again" : "View payment options"}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </span>
                              </div>
                            </button>
                          )}

                        </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              );
            })()}

            {/* Document panels */}
            {currentStep?.kind === "doc" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <DocumentPanel doc={sortedDocs[currentStep.index]} onReady={handleStepReady} />
              </div>
            )}

            {/* SOW selector */}
            {currentStep?.kind === "sow" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <SowSelectorPanel
                  phases={phasesWithSelection}
                  totalPrice={selectedTotal}
                  saving={savingSelections}
                  readOnly={readOnly}
                  onReady={handleStepReady}
                  onTogglePhase={(id) => void handleTogglePhase(id)}
                  scopedSowHtml={scopedDocMatchesSelection ? scopedSowDoc : null}
                  originalSowHtml={sortedDocs.find(d => d.docType === "consolidated_sow" || d.docType === "sow")?.htmlContent ?? null}
                />
              </div>
            )}

            {/* Contract & signature */}
            {currentStep?.kind === "contract" && (
              <div className="flex-1 flex flex-col">
                <ContractSignPanel
                  signerName={signerName}
                  selectedPhases={selectedPhases}
                  adjustmentsTotal={data.adjustmentsTotal ?? 0}
                  adjustmentLines={data.adjustmentLines ?? []}
                  totalPrice={effectivePrice}
                  onChangeName={setSignerName}
                  onSign={handleSign}
                  signing={signing || checkingOut}
                  alreadySigned={!!data.signedAt}
                  contractBody={data.contractBody}
                  scopedSowHtml={scopedDocMatchesSelection ? scopedSowDoc : null}
                  onReady={handleStepReady}
                />
                {freeClaimError && (
                  <div className="mx-4 mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-sm text-red-700 flex-1">{freeClaimError}</p>
                    <button
                      onClick={() => setFreeClaimError(null)}
                      className="text-red-400 hover:text-red-600 flex-shrink-0"
                      aria-label="Dismiss"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Payment */}
            {currentStep?.kind === "payment" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <PaymentOptionsPanel
                  totalPrice={effectivePrice}
                  onCheckout={handleCheckout}
                  loading={checkingOut}
                  alreadyPaid={isPaid}
                />
              </div>
            )}

            {/* Confirmation */}
            {currentStep?.kind === "confirmation" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-[#0A2540]">You're All Set!</h2>
                  <p className="text-muted-foreground mt-2 max-w-sm">
                    Your agreement is signed and payment is confirmed. Shane will reach out within one business day to kick off your engagement.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="px-8 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 shadow-lg shadow-[#0078D4]/20 transition-all"
                >
                  Return to Portal
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer navigation */}
        {!isConfirmation && (
          <div className="flex-shrink-0 bg-white border-t border-border">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
              <button
                onClick={goPrev}
                disabled={isFirst}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-[#0A2540] hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <p className="text-xs text-muted-foreground hidden sm:block">
                {stepLabel(currentStep, sortedDocs)}
              </p>

              {currentStep?.kind === "contract" && !data.signedAt ? (
                <span className="text-xs text-muted-foreground">Sign above to continue</span>
              ) : currentStep?.kind === "payment" ? (
                <span className="text-xs text-muted-foreground">Select a plan to continue</span>
              ) : currentStep?.kind === "sow" && needsRegeneration && !readOnly && user ? (
                <button
                  onClick={() => void handleRegenerateSow()}
                  disabled={regeneratingSow || savingSelections}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20 disabled:opacity-60"
                >
                  {regeneratingSow ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      <span>Generating…</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>Regenerate SOW</span>
                    </>
                  )}
                </button>
              ) : !isLast ? (
                <button
                  onClick={goNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20"
                >
                  <span>
                    Next
                    {steps[stepIndex + 1] && (
                      <span className="opacity-80">: {stepLabel(steps[stepIndex + 1], sortedDocs)}</span>
                    )}
                  </span>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Login gate overlay for public read-only links */}
      {showLoginGate && (
        <div className="fixed inset-0 z-[10001] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Sign In to Continue</h3>
            <p className="text-muted-foreground text-sm mb-6">
              You need to sign in or create an account to review, sign, and pay for this engagement.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href="/"
                className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 transition-colors text-center block"
              >
                Sign In
              </a>
              <button
                onClick={() => setShowLoginGate(false)}
                className="w-full py-3 rounded-xl border border-border text-sm font-semibold text-[#0A2540] hover:bg-gray-50 transition-colors"
              >
                Continue Browsing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
