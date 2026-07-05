import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import DocumentPanel from "./DocumentPanel";
import SowSelectorPanel from "./SowSelectorPanel";
import ContractSignPanel from "./ContractSignPanel";
import PaymentOptionsPanel from "./PaymentOptionsPanel";
import PayTodayBanner from "./PayTodayBanner";
import type { OfferState } from "./PayTodayBanner";
import AnimatedBackground from "../quickwin/AnimatedBackground";
import CopilotAura from "../wizard/CopilotAura";
import { computeOverviewStats } from "@/lib/doc-stat-extractors";
import ConfirmationStep from "./ConfirmationStep";
import SowGeneratingCard from "./SowGeneratingCard";
import PhaseGeneratingCard, { type PhaseGenPhase } from "./PhaseGeneratingCard";

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
  deliveryDate?: string | null;
  subtasks?: string[];
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
  discountedTotalCents?: number | null;
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
  | { kind: "phase_gen" }
  | { kind: "payment" }
  | { kind: "contract" }
  | { kind: "checkout" }
  | { kind: "confirmation" };

function buildSteps(docs: PresentationDoc[], readOnly: boolean): Step[] {
  const steps: Step[] = [{ kind: "welcome" }];
  for (let i = 0; i < docs.length; i++) steps.push({ kind: "doc", index: i });
  steps.push({ kind: "sow" });
  if (!readOnly) {
    // New flow: Scope & Pricing → AI Phase Gen (transient) → Payment Options → Agreement → Stripe Checkout → Confirmation
    steps.push({ kind: "phase_gen" });
    steps.push({ kind: "payment" });
    steps.push({ kind: "contract" });
    steps.push({ kind: "checkout" });
    steps.push({ kind: "confirmation" });
  }
  return steps;
}

function stepLabel(step: Step, docs: PresentationDoc[]): string {
  if (step.kind === "welcome") return "Overview";
  if (step.kind === "doc") return docs[step.index]?.title ?? `Document ${step.index + 1}`;
  if (step.kind === "sow") return "Scope & Pricing";
  if (step.kind === "phase_gen") return "Building Plan";
  if (step.kind === "payment") return "Payment Options";
  if (step.kind === "contract") return "Agreement";
  if (step.kind === "checkout") return "Complete Payment";
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
  if (step.kind === "phase_gen") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
  if (step.kind === "checkout") {
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
    // Docs hidden from the left nav: SOW documents (shown in the Scope step) and
    // task execution guides (internal-only; never surfaced to clients).
    const isNavHidden = (d: PresentationDoc) =>
      d.docType === "consolidated_sow" || d.docType === "sow" || d.docType === "task_execution_guide";
    if (startAtPayment) {
      const steps = buildSteps(initialData.documents.filter(d => !isNavHidden(d)), readOnly);
      // New flow: Payment Options → Agreement → Checkout → Confirmation
      // After Stripe redirect (startAtPayment=true):
      //   paid               → confirmation (payment complete)
      //   signed (not paid)  → checkout step (payment failed/cancelled, retry)
      //   anything else      → back to payment options
      let targetKind: Step["kind"];
      if (initialData.status === "paid") {
        targetKind = "confirmation";
      } else if (initialData.status === "signed") {
        targetKind = "checkout";
      } else {
        targetKind = "payment";
      }
      const idx = steps.findIndex(s => s.kind === targetKind);
      return idx >= 0 ? idx : 0;
    }
    const urlStep = parseInt(new URLSearchParams(search).get("step") ?? "", 10);
    if (!isNaN(urlStep) && urlStep >= 0) {
      const steps = buildSteps(initialData.documents.filter(d => !isNavHidden(d)), readOnly);
      const clamped = Math.min(urlStep, steps.length - 1);
      // If there's no SOW document, hard-lock all sow-gated steps — deep-links land on step 0.
      const hasSOW = initialData.documents.some(
        d => d.docType === "consolidated_sow" || d.docType === "sow"
      );
      const sowGated = new Set<Step["kind"]>(["payment", "contract", "checkout", "confirmation"]);
      if (!hasSOW && steps[clamped] && sowGated.has(steps[clamped].kind)) {
        return 0;
      }
      // If the URL tries to land on the Agreement step but no plan has been chosen,
      // redirect to the Payment Options step so the client picks a plan first.
      if (steps[clamped]?.kind === "contract" && !initialData.paymentPlan) {
        const pmtIdx = steps.findIndex(s => s.kind === "payment");
        return pmtIdx >= 0 ? pmtIdx : clamped;
      }
      return clamped;
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

  // True when the presentation has an uploaded SOW document (consolidated_sow or sow type).
  // When false, the Scope, Payment, Agreement, Checkout, and Confirmation steps are all locked —
  // the client can review presentation documents but cannot proceed to scoping or payment.
  const hasSowDocument = sortedDocs.some(
    d => d.docType === "consolidated_sow" || d.docType === "sow"
  );

  // Navigation docs — sortedDocs minus SOW documents. SOW content is already
  // surfaced by the dedicated "Scope & Pricing" step, so a separate nav entry
  // for each SOW document would be redundant and confusing for clients.
  // task_execution_guide docs are internal-only and must never be shown to clients.
  // All step-index arithmetic (buildSteps, stepLabel, doc panel) uses navDocs;
  // SOW-gating checks and document-content lookups keep using sortedDocs.
  const navDocs = useMemo(
    () => sortedDocs.filter(
      d => d.docType !== "consolidated_sow" && d.docType !== "sow" && d.docType !== "task_execution_guide"
    ),
    [sortedDocs],
  );

  // The set of step kinds that require an SOW document to be unlocked.
  const sowGatedKinds = new Set<Step["kind"]>(["phase_gen", "payment", "contract", "checkout", "confirmation"]);

  const steps = buildSteps(navDocs, readOnly);
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
  // Plan selection is lifted here so the checkout step can access it.
  // The payment step just selects full/phased; actual Stripe happens at checkout.
  // Seed from the server-persisted paymentPlan so returning clients (or deep-links)
  // always see plan-specific Agreement terms even if they skip the payment step.
  const [selectedPlan, setSelectedPlan] = useState<"full" | "phased" | null>(initialData.paymentPlan ?? null);
  const [showLoginGate, setShowLoginGate] = useState(false);
  const [freeClaimError, setFreeClaimError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferState | null>(null);

  // Fetch PAY-TODAY offer state on mount and whenever the user enters the payment
  // step — the offer amount can change mid-session (e.g. after a scoped SOW
  // regeneration updates adjustmentsTotal) so we always want fresh data there.
  const fetchOffer = () => {
    if (readOnly) return;
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    void fetchFn(`/api/portal/presentations/${presentationId}/offer${tokenParam}`)
      .then(r => r.ok ? r.json() : null)
      .then((o: OfferState | null) => { if (o) setOffer(o); })
      .catch(() => { /* non-fatal */ });
  };

  useEffect(() => {
    fetchOffer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId, readOnly, shareToken]);

  // Refresh offer whenever the user arrives at the payment step so it always
  // reflects the latest adjusted price (avoids stale data from mount-time fetch).
  useEffect(() => {
    if (currentStep?.kind === "payment") fetchOffer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.kind]);

  // ── Runtime safety net: if currentStep is "contract" but no plan is chosen,
  // redirect to payment. Catches any path not covered by the init / nav guards
  // (e.g. localStorage restoring a visited step from a prior session where plan
  // was never persisted server-side).
  useEffect(() => {
    if (currentStep?.kind === "contract" && !selectedPlan) {
      const pmtIdx = steps.findIndex(s => s.kind === "payment");
      if (pmtIdx >= 0) {
        directionRef.current = "back";
        applyStepChange(pmtIdx);
      }
    }
  // Only re-run when the active step or plan changes — not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.kind, selectedPlan]);

  // ── Phase generation state ─────────────────────────────────────────────────
  // Tracks the latest SSE event from the phase-gen workflow so PhaseGeneratingCard
  // can react to progress, complete, and error events without its own EventSource.
  const [phaseGenEvent, setPhaseGenEvent] = useState<{
    type: string;
    message?: string;
    current?: number;
    total?: number;
    phases?: PhaseGenPhase[];
  } | null>(null);

  // Track which selectedPhaseIds were active when phase gen last ran.
  // On mount, if sowPhases are already saved, assume they were generated for the current selection.
  const [phaseGenScopeIds, setPhaseGenScopeIds] = useState<string[] | null>(
    initialData.sowPhases.length > 0 ? (initialData.selectedPhaseIds ?? []) : null
  );

  // ── Scoped SOW regeneration state ─────────────────────────────────────────
  const [scopedSowDoc, setScopedSowDoc] = useState<string | null>(initialData.scopedSowHtml ?? null);
  const [scopedTotalPriceDollars, setScopedTotalPriceDollars] = useState<number | null>(initialData.scopedTotalPrice ?? null);
  const [lastRegenPhaseIds, setLastRegenPhaseIds] = useState<string[] | null>(initialData.scopedPhaseIds ?? null);
  const [regeneratingSow, setRegeneratingSow] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  // True when a previously generated scoped SOW was invalidated by a pricing update.
  // Stays true until the client successfully regenerates a new scoped SOW.
  const [scopedSowWasReset, setScopedSowWasReset] = useState(false);

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
  // True when sowPhases are already saved and were generated for the current scope selection.
  // When true, the "Build Your Project Plan" step can be skipped entirely.
  const hasSavedPhasesForCurrentScope =
    data.sowPhases.length > 0 &&
    phaseGenScopeIds !== null &&
    arraysMatch(selectedPhaseIds, phaseGenScopeIds);
  const scopedDocMatchesSelection = hasScopeReduction && scopedSowDoc !== null && lastRegenPhaseIds !== null && arraysMatch(lastRegenPhaseIds, selectedPhaseIds);
  // True when we need a (re)generation before the client can proceed
  const needsRegeneration = hasScopeReduction && !scopedDocMatchesSelection;
  // True when the scoped SOW was invalidated mid-session (pricing updated) and the
  // client has a scope reduction active. While this is true, signing and payment are
  // hard-blocked — the client must regenerate a fresh scoped SOW first.
  const sowResetBlocked = scopedSowWasReset && hasScopeReduction;
  // Effective price used for payment step (list price before any discount)
  const effectivePrice = hasScopeReduction && scopedDocMatchesSelection && scopedTotalPriceDollars !== null
    ? scopedTotalPriceDollars
    : grandTotal;

  // Whether the PAY-TODAY offer is currently live (active flag set and countdown not expired).
  // Computed inline so the Agreement step always reflects the real-time offer state without
  // needing an extra hook — mirrors useIsOfferLive inside PaymentOptionsPanel.
  const offerIsLive = !!(
    offer?.active &&
    offer.expiresAt &&
    new Date(offer.expiresAt).getTime() > Date.now()
  );
  // Pre-checkout: the offer discount applies when the client has actively selected "Pay in Full"
  // and the offer window is still open. This lets the Agreement page mirror exactly what the
  // Payment Options page showed, so there is no jarring price jump between the two steps.
  const preCheckoutOfferApplies =
    offerIsLive &&
    selectedPlan === "full" &&
    (data.adjustmentsTotal ?? 0) > 0 &&
    offer?.discountedTotal != null;

  // Contract step shows the actual price paid:
  //  1. Post-checkout: use server-confirmed discountedTotalCents
  //  2. Pre-checkout with live offer + full payment selected: use offer.discountedTotal
  //  3. Otherwise: use the list price (effectivePrice)
  const contractPrice = data.discountedTotalCents != null
    ? Math.round(data.discountedTotalCents) / 100
    : preCheckoutOfferApplies
    ? offer!.discountedTotal
    : effectivePrice;

  // Per-phase billing amounts for the 20% upfront + per-phase plan.
  // The deposit is 20% of effectivePrice. The remaining 80% is split across phases
  // proportionally by their raw SOW price weight — mirroring the server formula in portal.ts.
  // This ensures the "Due at completion" display matches what Stripe will actually charge.
  const _phasedDeposit = Math.round(effectivePrice * 0.2 * 100) / 100;
  const _phasedRemaining = effectivePrice - _phasedDeposit;
  const _phasesRawTotal = selectedPhases.reduce((s, p) => s + p.price, 0) || 1;
  let _phasesAllocated = 0;
  const phasedPhaseAmounts: number[] = selectedPhases.map((p, i) => {
    if (i === selectedPhases.length - 1) {
      const last = Math.round((_phasedRemaining - _phasesAllocated) * 100) / 100;
      return last;
    }
    const amount = Math.round((_phasedRemaining * (p.price / _phasesRawTotal)) * 100) / 100;
    _phasesAllocated += amount;
    return amount;
  });

  // When PAY-TODAY "adjustments_waived" is in effect the discount equals adjustmentsTotal,
  // so contractPrice already has them factored out. Passing the original adjustmentsTotal
  // to ContractSignPanel would cause it to subtract them again ("Workstream Subtotal" =
  // contractPrice - adjustmentsTotal = effectivePrice - 2*adjustmentsTotal — wrong).
  // Zero the adjustment props so the breakdown stays internally consistent.
  // This covers both the post-checkout case (discountedTotalCents set by server after Stripe)
  // and the pre-checkout case (offer live + client selected full payment).
  const contractAdjustmentsWaived =
    (data.discountedTotalCents != null && (data.adjustmentsTotal ?? 0) > 0) ||
    preCheckoutOfferApplies;
  const contractAdjustmentsTotal = contractAdjustmentsWaived ? 0 : (data.adjustmentsTotal ?? 0);
  const contractAdjustmentLines  = contractAdjustmentsWaived ? [] : (data.adjustmentLines ?? []);

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
        // Immediately invalidate any previously generated scoped SOW — it was
        // built with now-stale line prices and must not be used for sign/pay.
        setScopedSowDoc(prev => {
          if (prev !== null) {
            setScopedSowWasReset(true);
          }
          return null;
        });
        setScopedTotalPriceDollars(null);
        setLastRegenPhaseIds(null);
      }
      // Check document staleness (any doc added, removed, or replaced)
      const freshFingerprint = [...(fresh.documents ?? [])].map(d => d.id).sort((a, b) => a - b).join(",");
      if (freshFingerprint !== initialDocFingerprintRef.current) {
        setDocsStale(true);
      }
    } catch (err) {
      console.warn("[PresentationFlow] Scope version check failed (non-fatal):", err);
    }
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
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            sowVersion?: string;
            message?: string;
            current?: number;
            total?: number;
            phases?: PhaseGenPhase[];
          };
          if (payload.type === "scope_changed" || payload.type === "docs_changed") {
            void checkScopeVersion();
          } else if (
            payload.type === "phase_gen_progress" ||
            payload.type === "phase_gen_complete" ||
            payload.type === "phase_gen_error"
          ) {
            setPhaseGenEvent({
              type: payload.type,
              message: payload.message,
              current: payload.current,
              total: payload.total,
              phases: payload.phases,
            });
          }
        } catch { /* ignore malformed events */ }
      };
      es.onerror = () => {
        // Do NOT close() here — let the browser's built-in EventSource reconnection
        // fire automatically. Calling close() prevents any reconnect attempt and
        // causes phase_gen.complete events to be permanently missed if the
        // connection drops during the ~30-second AI generation window.
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
        const isNavHiddenDoc = (d: PresentationDoc) =>
          isSowDoc(d) || d.docType === "task_execution_guide";
        const freshSortedDocs = [...(fresh.documents ?? [])].sort((a, b) => {
          if (isSowDoc(a) && !isSowDoc(b)) return 1;
          if (!isSowDoc(a) && isSowDoc(b)) return -1;
          return 0;
        });
        const freshNavDocs = freshSortedDocs.filter(d => !isNavHiddenDoc(d));
        const freshStepCount = buildSteps(freshNavDocs, readOnly).length;
        // Clamp current position and max-visited to the new step list size
        setStepIndex(prev => Math.min(prev, freshStepCount - 1));
        setMaxVisitedStep(prev => Math.min(prev, freshStepCount - 1));
        // Sync scoped SOW state from fresh server data.
        // The server clears the scoped SOW when it detects pricing drift, so
        // we must reflect that here rather than keep showing a stale document.
        const freshScopedSow = fresh.scopedSowHtml ?? null;
        setScopedSowDoc(prev => {
          if (prev !== null && freshScopedSow === null) {
            // Server cleared the scoped SOW due to pricing drift
            setScopedSowWasReset(true);
          }
          return freshScopedSow;
        });
        setScopedTotalPriceDollars(fresh.scopedTotalPrice ?? null);
        setLastRegenPhaseIds(fresh.scopedPhaseIds ?? null);
        setData(fresh);
        setScopeStale(false);
        setDocsStale(false);
      }
    } catch (err) {
      console.warn("[PresentationFlow] Refresh scope failed (non-fatal):", err);
    } finally {
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
    setRegenerateError(null);
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
        // Client has regenerated with the current pricing — clear the reset notice
        setScopedSowWasReset(false);
        // Refresh offer so the payment step reflects the updated scoped price
        fetchOffer();
      } else {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        setRegenerateError(errBody.error ?? "Failed to regenerate your Statement of Work. Please try again.");
      }
    } catch {
      setRegenerateError("Connection error — please check your internet and try again.");
    } finally {
      setRegeneratingSow(false);
    }
  };

  // ── Phase generation handlers ──────────────────────────────────────────────

  const handleStartPhaseGen = async (force = false) => {
    if (!hasSowDocument || readOnly) return;

    // If phases are already saved for the current scope selection, skip phase gen entirely
    // and advance straight to Payment Options — unless a forced regeneration was requested.
    if (!force && hasSavedPhasesForCurrentScope) {
      const pmtIdx = steps.findIndex(s => s.kind === "payment");
      if (pmtIdx >= 0) {
        directionRef.current = "forward";
        setMaxVisitedStep(m => Math.max(m, pmtIdx));
        applyStepChange(pmtIdx);
      }
      return;
    }

    // Reset any previous phase-gen event so the card starts fresh
    setPhaseGenEvent(null);

    // Advance to the phase_gen step
    const pgIdx = steps.findIndex(s => s.kind === "phase_gen");
    if (pgIdx >= 0) {
      directionRef.current = "forward";
      setMaxVisitedStep(m => Math.max(m, pgIdx));
      applyStepChange(pgIdx);
    }

    // Fire the workflow. If the POST fails (network error or non-2xx), immediately
    // inject a phase_gen_error event so the locked screen shows the escape-hatch card.
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    const sowDoc = sortedDocs.find(d => d.docType === "consolidated_sow" || d.docType === "sow");
    const sowHtmlSnippet = (scopedSowDoc ?? sowDoc?.htmlContent ?? "").slice(0, 8000);
    try {
      const resp = await fetchFn(`/api/portal/presentations/${presentationId}/generate-phases${tokenParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalPrice: effectivePrice,
          sowHtml: sowHtmlSnippet,
          projectTitle: data.projectTitle ?? "",
          adjustmentsTotal: data.adjustmentsTotal ?? 0,
          adjustmentLines: (data.adjustmentLines ?? []).map(a => ({ title: a.title, price: a.price })),
          selectedPhases: selectedPhases.map(p => ({ id: p.id, title: p.title, price: p.price })),
          force,
        }),
      });
      if (!resp.ok) {
        // Server returned an error before any workflow run started — no SSE event will arrive.
        setPhaseGenEvent({ type: "phase_gen_error", message: "Couldn't start plan generation. You can continue to Payment Options." });
      }
    } catch {
      // Network failure — no SSE event will arrive, so surface the escape-hatch card immediately.
      setPhaseGenEvent({ type: "phase_gen_error", message: "Couldn't reach the server. You can continue to Payment Options." });
    }
  };

  const handlePhaseGenComplete = (phases: PhaseGenPhase[]) => {
    // Update sowPhases in local state so PaymentOptionsPanel sees the new AI-generated phases
    if (phases.length > 0) {
      setData(prev => ({
        ...prev,
        sowPhases: phases.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description,
          price: p.price,
          selected: true,
          subtasks: p.subtasks,
        })),
        selectedPhaseIds: phases.map(p => p.id),
      }));
    }
    // Record the generated phase IDs as the "scope" baseline.
    // After setData runs, data.selectedPhaseIds will equal phases.map(p => p.id), so
    // we use the same value here to keep phaseGenScopeIds in sync with selectedPhaseIds.
    // This lets hasSavedPhasesForCurrentScope correctly evaluate to true immediately
    // after a successful generation, and to false when the client later changes their selection.
    setPhaseGenScopeIds(phases.map(p => p.id));
    // Advance to payment options
    const pmtIdx = steps.findIndex(s => s.kind === "payment");
    if (pmtIdx >= 0) {
      directionRef.current = "forward";
      setMaxVisitedStep(m => Math.max(m, pmtIdx));
      applyStepChange(pmtIdx);
    }
  };

  const handlePhaseGenError = () => {
    // Skip phase gen — go straight to payment options even without AI phases
    const pmtIdx = steps.findIndex(s => s.kind === "payment");
    if (pmtIdx >= 0) {
      directionRef.current = "forward";
      setMaxVisitedStep(m => Math.max(m, pmtIdx));
      applyStepChange(pmtIdx);
    }
  };

  // Polling fallback for phase gen completion.
  // If the SSE event fires during a connection gap (e.g. EventSource is
  // reconnecting after an error), the client will miss the phase_gen.complete
  // push. Poll the presentation endpoint every 6 s while on the phase_gen
  // step; if the server already persisted phases, synthesise the complete
  // event locally so the UI transitions normally.
  useEffect(() => {
    if (currentStep?.kind !== "phase_gen") return;
    if (phaseGenEvent?.type === "phase_gen_complete" || phaseGenEvent?.type === "phase_gen_error") return;
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    const id = setInterval(async () => {
      try {
        const res = await fetchFn(`/api/portal/presentations/${presentationId}${tokenParam}`);
        if (!res.ok) return;
        const fresh = await res.json() as { sowPhases?: PhaseGenPhase[] };
        const phases = fresh.sowPhases ?? [];
        if (phases.length > 0) {
          setPhaseGenEvent({ type: "phase_gen_complete", phases });
        }
      } catch { /* non-fatal */ }
    }, 6000);
    return () => clearInterval(id);
  }, [currentStep?.kind, phaseGenEvent?.type, presentationId, shareToken, fetchFn]);

  const handleSign = async (signatureData: string, name: string) => {
    // Hard-block signing when the scoped SOW was reset mid-session and scope reduction is active.
    // This guard covers the case where the reset fires while the client is already on the contract step.
    if (sowResetBlocked) return;
    setSigning(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData, signerName: name }),
      });
      if (res.ok) {
        // Payment was completed before this step — just record signature and proceed.
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

  // Zero-price path: claim the engagement for free (no Stripe) from the Payment step.
  const handleClaimFree = async () => {
    if (sowResetBlocked) return;
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
  };

  const handleCheckout = async (plan: "full" | "phased", applyPayToday: boolean) => {
    // Hard-block checkout when the scoped SOW was reset mid-session and scope reduction is active.
    // This guard covers the case where the reset fires while the client is already on the payment step.
    if (sowResetBlocked) return;
    setCheckingOut(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPlan: plan, applyPayToday }),
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
      const doc = navDocs[currentStep.index];
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

  // In the new flow (Payment Options → Agreement → Checkout), "signed" means
  // committed but not yet paid. isPaid is true only after Stripe payment completes.
  const isPaid = data.status === "paid";

  const goNext = () => {
    // Hard-block Next entirely when the next step would be SOW-gated and there's no SOW document.
    if (!hasSowDocument && currentStep && sowGatedKinds.has(currentStep.kind)) return;
    if (!hasSowDocument) {
      const nextStep = steps[stepIndex + 1];
      if (nextStep && sowGatedKinds.has(nextStep.kind)) return;
    }
    if (readOnly && currentStep?.kind === "sow") {
      setShowLoginGate(true);
      return;
    }
    // Hard-block advancing from the SOW step when SOW needs regeneration or was reset.
    // The client must regenerate a fresh scoped SOW before they can sign or pay.
    if ((sowResetBlocked || needsRegeneration) && currentStep?.kind === "sow") {
      return;
    }
    // Hard-block advancing from the payment options step until a plan is selected.
    if (currentStep?.kind === "payment" && !selectedPlan) {
      return;
    }
    if (stepIndex < steps.length - 1) {
      const next = stepIndex + 1;
      const nextStep = steps[next];
      // Hard-block jumping into payment/contract/checkout when SOW needs regeneration.
      if ((sowResetBlocked || needsRegeneration) && (nextStep?.kind === "payment" || nextStep?.kind === "contract" || nextStep?.kind === "checkout")) {
        return;
      }
      // Hard-block advancing to checkout (Stripe) without a signed agreement.
      if (nextStep?.kind === "checkout" && !data.signedAt) {
        return;
      }
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
    const targetStep = steps[i];
    // Hard-block sidebar navigation to payment/contract/checkout when SOW needs regeneration.
    const blockedByReset = (sowResetBlocked || needsRegeneration) && (targetStep?.kind === "payment" || targetStep?.kind === "contract" || targetStep?.kind === "checkout");
    // Hard-block sidebar navigation to checkout without a signed agreement.
    const blockedByUnsigned = targetStep?.kind === "checkout" && !data.signedAt;
    // Hard-block sidebar navigation to contract when no payment plan has been chosen.
    // Redirect to the payment step so the client picks a plan first.
    const blockedByNoPlan = targetStep?.kind === "contract" && !selectedPlan;
    // Hard-block all SOW-gated steps when no SOW document is present.
    const blockedByNoSow = !hasSowDocument && !!targetStep && sowGatedKinds.has(targetStep.kind);
    if (i <= maxVisitedStep && !blockedByReset && !blockedByUnsigned && !blockedByNoPlan && !blockedByNoSow) {
      directionRef.current = i > stepIndex ? "forward" : "back";
      applyStepChange(i);
      setSidebarOpen(false);
    } else if (blockedByNoPlan && paymentStepIndex >= 0) {
      // Redirect them to pick a plan first
      directionRef.current = "back";
      applyStepChange(paymentStepIndex);
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
    const targetStep = steps[idx];
    // Hard-block jumps to any SOW-gated step when no SOW document exists.
    if (!hasSowDocument && targetStep && sowGatedKinds.has(targetStep.kind)) return;
    // Hard-block jumps to payment/contract/checkout when SOW needs regeneration.
    if ((sowResetBlocked || needsRegeneration) && (targetStep?.kind === "payment" || targetStep?.kind === "contract" || targetStep?.kind === "checkout")) return;
    // Hard-block jumps to checkout without a signed agreement.
    if (targetStep?.kind === "checkout" && !data.signedAt) return;
    // Hard-block jumps to contract when no payment plan has been chosen — redirect to payment.
    if (targetStep?.kind === "contract" && !selectedPlan) {
      const pmtIdx = steps.findIndex(s => s.kind === "payment");
      if (pmtIdx >= 0) {
        directionRef.current = "back";
        setMaxVisitedStep(m => Math.max(m, pmtIdx));
        applyStepChange(pmtIdx);
      }
      return;
    }
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
  }, [steps.length, applyStepChange, stepIndex, fetchFn, presentationId, shareToken, sowResetBlocked, needsRegeneration, data.signedAt, steps, selectedPlan, hasSowDocument]);

  const firstDocStepIndex    = steps.findIndex(s => s.kind === "doc");
  const sowStepIndex         = steps.findIndex(s => s.kind === "sow");
  const paymentStepIndex     = steps.findIndex(s => s.kind === "payment");
  const contractStepIndex    = steps.findIndex(s => s.kind === "contract");
  const checkoutStepIndex    = steps.findIndex(s => s.kind === "checkout");
  const confirmationStepIndex = steps.findIndex(s => s.kind === "confirmation");

  // Note: no auto-advance on the payment step. When already paid, PaymentOptionsPanel
  // renders "Payment Confirmed!" with a "Continue to Agreement →" button (onContinue).
  // Auto-advancing was removed because it also fired on deliberate forward navigation
  // through a completed presentation, skipping the payment step unexpectedly.

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
          const isResetBlocked = (sowResetBlocked || needsRegeneration) && (step.kind === "payment" || step.kind === "contract" || step.kind === "checkout");
          const isUnsignedGated = step.kind === "checkout" && !data.signedAt;
          const isNoSowGated = !hasSowDocument && sowGatedKinds.has(step.kind);
          const isBlocked = isResetBlocked || isUnsignedGated || isNoSowGated;
          return (
            <button
              key={i}
              onClick={() => { if (!isFuture && !isBlocked) navigateToStep(i); }}
              title={
                isNoSowGated
                  ? "Statement of Work not yet available"
                  : isResetBlocked
                  ? "Regenerate your scoped SOW before signing or paying"
                  : isUnsignedGated
                  ? "Sign the agreement to unlock payment"
                  : isActive
                  ? "Current step"
                  : isVisited
                  ? "Click to go back to this step"
                  : `Complete step ${i} to unlock`
              }
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all mb-0.5 ${
                isNoSowGated
                  ? "text-white/20 cursor-not-allowed"
                  : isBlocked
                  ? "text-amber-400/60 cursor-not-allowed"
                  : isActive
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
                isNoSowGated
                  ? "bg-white/5 text-white/20"
                  : isResetBlocked
                  ? "bg-amber-400/20 text-amber-400/60"
                  : isActive
                  ? "bg-white/20 text-white"
                  : isVisited
                  ? "bg-white/20 text-white/70"
                  : "bg-white/10 text-white/30"
              }`}>
                {isNoSowGated ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                ) : isResetBlocked ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : isVisited ? (
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
                {stepLabel(step, navDocs)}
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
          <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-800 font-medium">
                {scopeStale && docsStale
                  ? "Your documents and scope of work have been updated — refresh to see the latest."
                  : docsStale
                  ? "New or updated documents are available — refresh to see them."
                  : "The scope of work has been updated. Please review the latest pricing before signing or paying."}
              </p>
              {scopedSowWasReset && scopeStale && (
                <p className="text-sm text-amber-700 mt-1">
                  Your scoped document has been reset because the pricing was updated — please regenerate.
                </p>
              )}
            </div>
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

        {/* Scoped SOW reset notice — non-dismissable; only clears when the client
            successfully regenerates a new scoped SOW (or the server confirms a fresh one).
            Do NOT add a dismiss button here — it would allow bypassing the sign/pay block. */}
        {scopedSowWasReset && !scopeStale && !docsStale && (
          <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="flex-1 text-sm text-amber-800 font-medium">
              Your scoped document was reset because the pricing was updated — please regenerate it on the Scope &amp; Pricing step to continue.
            </p>
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
            {stepLabel(currentStep, navDocs)}
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

        {/* Timeout notice — outside the scroll area so it doesn't add scrollable height */}
        {loadingTimedOut && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-700 text-xs font-medium">
            <svg className="w-3.5 h-3.5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Still loading… content may be incomplete until fully available.
          </div>
        )}

        {/* Body */}
        <div ref={scrollAreaRef} className="flex-1 overflow-x-hidden overflow-y-auto relative">
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
          <div key={stepIndex} className={`${currentStep?.kind === "sow" ? "w-full" : "max-w-4xl mx-auto px-4 sm:px-6 py-6"} ${currentStep?.kind === "doc" ? "" : "h-full"} flex flex-col ${
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
              // True only after the client has actually visited the SOW step with a fresh document
              const sowReviewed = hasSowDocument && sowStepIndex >= 0 && maxVisitedStep >= sowStepIndex && !scopeStale;
              return (
                <>
                  <AnimatedBackground fullScreen />
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
                        {!sowReviewed ? (
                          <div className="flex items-center justify-center gap-1.5 h-8">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4]/50 animate-pulse" />
                            <span className="text-sm font-semibold text-muted-foreground">Calculating…</span>
                          </div>
                        ) : (
                          <p className="text-2xl font-extrabold text-[#0078D4]">
                            {total >= 1000 ? `$${Math.round(total / 1000)}k` : total > 0 ? `$${total}` : "TBD"}
                          </p>
                        )}
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
                      const docsActuallyReviewed = docsVisited && !docsStale;
                      const sowActuallyReviewed  = sowVisited && !scopeStale && hasSowDocument;
                      const reviewedSections = [docsActuallyReviewed, sowActuallyReviewed, contractVisited, paymentVisited].filter(Boolean).length;
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
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${docsStale ? "bg-amber-400" : docsVisited ? "bg-emerald-500" : "bg-red-500"}`} />
                              {docsVisited && !docsStale && <ReviewedBadge />}
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
                                {docsStale ? (
                                  <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-amber-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                    Refreshing your analysis…
                                  </span>
                                ) : (
                                  <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${docsVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>
                                    {docsVisited ? "Review again" : "See your reports"}
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                  </span>
                                )}
                              </div>
                            </button>
                          )}

                          {/* 2 — Scope & Investment */}
                          {sowStepIndex >= 0 && (
                            <button
                              onClick={() => !hasSowDocument ? undefined : jumpToStep(sowStepIndex, "scope")}
                              disabled={!hasSowDocument}
                              title={!hasSowDocument ? "Statement of Work not yet available" : undefined}
                              className={`group relative bg-white rounded-xl border border-border p-5 text-left transition-all overflow-hidden ${!hasSowDocument ? "opacity-40 cursor-not-allowed" : "hover:shadow-md hover:-translate-y-0.5"}`}
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${(scopeStale || !hasSowDocument) ? "bg-amber-400" : sowVisited ? "bg-emerald-500" : "bg-[#0078D4]"}`} />
                              {sowVisited && !scopeStale && hasSowDocument && <ReviewedBadge />}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${sowVisited ? "bg-emerald-50" : "bg-[#0078D4]/10"}`}>
                                  <svg className={`w-4 h-4 ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>Scope & Investment</span>
                              </div>
                              <div className="mb-4 min-h-[3rem]">
                                {!sowActuallyReviewed ? (
                                  <div className="flex items-center gap-1.5 mb-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4]/50 animate-pulse" />
                                    <span className="text-sm font-semibold text-muted-foreground">Calculating…</span>
                                  </div>
                                ) : totalFmt ? (
                                  <p className="text-2xl font-extrabold text-[#0A2540] mb-2">{totalFmt}</p>
                                ) : null}
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
                                {!hasSowDocument ? (
                                  <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-amber-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                    Building your plan…
                                  </span>
                                ) : scopeStale ? (
                                  <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-amber-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                    Building customized plan…
                                  </span>
                                ) : (
                                  <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${sowVisited ? "text-emerald-600" : "text-[#0078D4]"}`}>
                                    {sowVisited ? "Review again" : "Review scope"}
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                  </span>
                                )}
                              </div>
                            </button>
                          )}

                          {/* 3 — Payment */}
                          {paymentStepIndex >= 0 && (
                            <button
                              onClick={() => (!hasSowDocument || sowResetBlocked || needsRegeneration) ? undefined : jumpToStep(paymentStepIndex, "payment")}
                              disabled={!hasSowDocument || sowResetBlocked || needsRegeneration}
                              title={!hasSowDocument ? "Statement of Work not yet available" : (sowResetBlocked || needsRegeneration) ? "Regenerate your scoped SOW before paying" : undefined}
                              className={`group relative bg-white rounded-xl border border-border p-5 text-left transition-all overflow-hidden ${(!hasSowDocument || sowResetBlocked || needsRegeneration) ? "opacity-40 cursor-not-allowed" : "hover:shadow-md hover:-translate-y-0.5"}`}
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${(sowResetBlocked || needsRegeneration) ? "bg-amber-400" : paymentVisited ? "bg-emerald-500" : "bg-purple-500"}`} />
                              {paymentVisited && !(sowResetBlocked || needsRegeneration) && <ReviewedBadge />}
                              {(sowResetBlocked || needsRegeneration) && (
                                <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full leading-none">
                                  <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" /></svg>
                                  Blocked
                                </span>
                              )}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${paymentVisited ? "bg-emerald-50" : "bg-purple-50"}`}>
                                  <svg className={`w-4 h-4 ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`}>Payment</span>
                              </div>
                              {(sowResetBlocked || needsRegeneration) ? (
                                <p className="text-xs text-amber-700 mb-4 min-h-[3rem]">Regenerate your scoped SOW on the Scope & Pricing step to unlock payment.</p>
                              ) : !sowActuallyReviewed ? (
                                <div className="mb-3 min-h-[3rem] flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" />
                                  <span className="text-sm font-semibold text-muted-foreground">Calculating…</span>
                                </div>
                              ) : upfrontFmt ? (
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
                              {!(sowResetBlocked || needsRegeneration) && (
                                <>
                                  <div className="flex items-center gap-1.5 mb-4">
                                    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${paymentVisited ? "bg-emerald-50 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>Milestone billing</span>
                                    <span className="inline-flex items-center text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Or pay in full</span>
                                  </div>
                                  <div className="flex items-center justify-end">
                                    {(!hasSowDocument || scopeStale) ? (
                                      <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-amber-600">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                        Building customized plan…
                                      </span>
                                    ) : (
                                      <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${paymentVisited ? "text-emerald-600" : "text-purple-600"}`}>
                                        {paymentVisited ? "Review again" : "View payment options"}
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                            </button>
                          )}

                          {/* 4 — Agreement */}
                          {contractStepIndex >= 0 && (
                            <button
                              onClick={() => (!hasSowDocument || sowResetBlocked || needsRegeneration) ? undefined : jumpToStep(contractStepIndex, "agreement")}
                              disabled={!hasSowDocument || sowResetBlocked || needsRegeneration}
                              title={!hasSowDocument ? "Statement of Work not yet available" : (sowResetBlocked || needsRegeneration) ? "Regenerate your scoped SOW before signing" : undefined}
                              className={`group relative bg-white rounded-xl border border-border p-5 text-left transition-all overflow-hidden ${(!hasSowDocument || sowResetBlocked || needsRegeneration) ? "opacity-40 cursor-not-allowed" : "hover:shadow-md hover:-translate-y-0.5"}`}
                            >
                              <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-xl ${(sowResetBlocked || needsRegeneration) ? "bg-amber-400" : contractVisited ? "bg-emerald-500" : "bg-slate-400"}`} />
                              {contractVisited && !(sowResetBlocked || needsRegeneration) && <ReviewedBadge />}
                              {(sowResetBlocked || needsRegeneration) && (
                                <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full leading-none">
                                  <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" /></svg>
                                  Blocked
                                </span>
                              )}
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${contractVisited ? "bg-emerald-50" : "bg-slate-100"}`}>
                                  <svg className={`w-4 h-4 ${contractVisited ? "text-emerald-600" : "text-slate-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-widest ${contractVisited ? "text-emerald-600" : "text-slate-500"}`}>Agreement</span>
                              </div>
                              <p className="text-sm font-bold text-[#0A2540] mb-3">Personalised, legally binding e-signature contract</p>
                              {(sowResetBlocked || needsRegeneration) ? (
                                <p className="text-xs text-amber-700 mb-4">Regenerate your scoped SOW on the Scope & Pricing step to unlock signing.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                  {(["E-Signature", "Legally Binding", "Personalised Contract"] as const).map(pill => (
                                    <span key={pill} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${contractVisited ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                      {pill}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {!(sowResetBlocked || needsRegeneration) && (
                                <div className="flex items-center justify-end">
                                  {(!hasSowDocument || scopeStale) ? (
                                    <span className="text-xs font-semibold inline-flex items-center gap-1.5 text-amber-600">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                      Building customized plan…
                                    </span>
                                  ) : (
                                    <span className={`text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 ${contractVisited ? "text-emerald-600" : "text-slate-500"}`}>
                                      {contractVisited ? "Review again" : "Preview agreement"}
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                    </span>
                                  )}
                                </div>
                              )}
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
                <DocumentPanel doc={navDocs[currentStep.index]} onReady={handleStepReady} />
              </div>
            )}

            {/* SOW selector */}
            {currentStep?.kind === "sow" && (!hasSowDocument || regeneratingSow) && (
              <div className="flex-1 relative overflow-hidden flex flex-col items-center justify-center" style={{ backgroundColor: "rgb(243,246,250)" }}>
                {/* Torus knot — z-[1] so it sits above the panel background but below z-10 content */}
                <AnimatedBackground />

                {/* Screen-edge Copilot Aura */}
                <CopilotAura />

                {/* "Proposal in progress" pill */}
                <div className="relative z-10 flex justify-center mb-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/20 text-[#0078D4] text-[11px] font-bold" style={{ backdropFilter: "blur(8px)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse" />
                    PROPOSAL IN PROGRESS
                  </div>
                </div>

                {/* Generating card with staged progress */}
                <div className="relative z-10 w-full max-w-sm mx-auto px-4">
                  <SowGeneratingCard
                    clientName={data.clientName}
                    projectTitle={data.projectTitle}
                    presentationId={presentationId}
                    shareToken={shareToken}
                    onClose={onClose}
                  />
                </div>
              </div>
            )}
            {currentStep?.kind === "sow" && hasSowDocument && !regeneratingSow && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <PayTodayBanner offer={offer} />
                <SowSelectorPanel
                  phases={phasesWithSelection}
                  totalPrice={selectedTotal}
                  saving={savingSelections}
                  readOnly={readOnly}
                  onReady={handleStepReady}
                  onTogglePhase={(id) => void handleTogglePhase(id)}
                  scopedSowHtml={scopedDocMatchesSelection ? scopedSowDoc : null}
                  originalSowHtml={sortedDocs.find(d => d.docType === "consolidated_sow" || d.docType === "sow")?.htmlContent ?? null}
                  adjustmentLines={data.adjustmentLines}
                  adjustmentsTotal={data.adjustmentsTotal}
                  scopedCalculated={scopedDocMatchesSelection}
                  originalTotalPrice={data.totalPrice + (data.adjustmentsTotal ?? 0)}
                />
              </div>
            )}

            {/* Contract & signature */}
            {currentStep?.kind === "contract" && (
              <div className="flex-1 flex flex-col">
                <ContractSignPanel
                  signerName={signerName}
                  selectedPhases={selectedPhases}
                  adjustmentsTotal={contractAdjustmentsTotal}
                  adjustmentLines={contractAdjustmentLines}
                  totalPrice={contractPrice}
                  onChangeName={setSignerName}
                  onSign={handleSign}
                  signing={signing}
                  alreadySigned={!!data.signedAt}
                  contractBody={data.contractBody}
                  scopedSowHtml={scopedDocMatchesSelection ? scopedSowDoc : null}
                  onReady={handleStepReady}
                  selectedPlan={selectedPlan}
                  waivedAdjustmentsTotal={contractAdjustmentsWaived ? (data.adjustmentsTotal ?? 0) : 0}
                  waivedAdjustmentLines={contractAdjustmentsWaived ? (data.adjustmentLines ?? []) : []}
                />
              </div>
            )}

            {/* Payment Options — plan selection only, no Stripe yet */}
            {currentStep?.kind === "payment" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-auto px-4 sm:px-6 py-6">
                  <PaymentOptionsPanel
                    totalPrice={effectivePrice}
                    onPlanSelected={setSelectedPlan}
                    initialPlan={selectedPlan}
                    loading={false}
                    alreadyPaid={isPaid}
                    onContinue={isPaid ? () => {
                      const target = confirmationStepIndex >= 0 ? confirmationStepIndex : checkoutStepIndex >= 0 ? checkoutStepIndex : -1;
                      if (target < 0) return;
                      directionRef.current = "forward";
                      setMaxVisitedStep(m => Math.max(m, target));
                      applyStepChange(target);
                    } : undefined}
                    offer={offer}
                    freeClaimError={freeClaimError}
                    onDismissFreeClaimError={() => setFreeClaimError(null)}
                    sowPhases={selectedPhases.length > 0 ? selectedPhases.map((p, i) => ({ id: p.id, title: p.title, description: p.description, price: phasedPhaseAmounts[i] ?? 0, deliveryDate: p.deliveryDate, subtasks: p.subtasks })) : undefined}
                    selectedPhases={selectedPhases.length > 0 ? selectedPhases.map(p => ({ title: p.title, price: p.price })) : undefined}
                    adjustmentLines={data.adjustmentLines?.map(a => ({ title: a.title, price: a.price }))}
                  />
                </div>
              </div>
            )}

            {/* Checkout — actual Stripe payment (after signing the agreement) */}
            {currentStep?.kind === "checkout" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <PayTodayBanner offer={offer} />
                <div className="flex-1 overflow-auto px-4 sm:px-6 py-6">
                  {grandTotal === 0 ? (
                    <PaymentOptionsPanel
                      totalPrice={0}
                      onClaimFree={handleClaimFree}
                      loading={checkingOut}
                      offer={offer}
                      freeClaimError={freeClaimError}
                      onDismissFreeClaimError={() => setFreeClaimError(null)}
                    />
                  ) : (
                    <PaymentOptionsPanel
                      totalPrice={effectivePrice}
                      onCheckout={handleCheckout}
                      initialPlan={selectedPlan}
                      loading={checkingOut}
                      alreadyPaid={isPaid}
                      offer={offer}
                      freeClaimError={freeClaimError}
                      onDismissFreeClaimError={() => setFreeClaimError(null)}
                      sowPhases={selectedPhases.length > 0 ? selectedPhases.map((p, i) => ({ id: p.id, title: p.title, description: p.description, price: phasedPhaseAmounts[i] ?? 0, deliveryDate: p.deliveryDate, subtasks: p.subtasks })) : undefined}
                      selectedPhases={selectedPhases.length > 0 ? selectedPhases.map(p => ({ title: p.title, price: p.price })) : undefined}
                      adjustmentLines={data.adjustmentLines?.map(a => ({ title: a.title, price: a.price }))}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Confirmation */}
            {currentStep?.kind === "confirmation" && (
              <ConfirmationStep
                clientName={data.clientName ?? null}
                projectTitle={data.projectTitle ?? null}
                onClose={onClose}
              />
            )}
          </div>
        </div>

        {/* Phase generation — full-screen overlay (no chrome) */}
        {currentStep?.kind === "phase_gen" && (
          <PhaseGeneratingCard
            presentationId={presentationId}
            shareToken={shareToken}
            clientName={data.clientName}
            projectTitle={data.projectTitle}
            phaseGenEvent={phaseGenEvent}
            onComplete={handlePhaseGenComplete}
            onError={handlePhaseGenError}
          />
        )}

        {/* Footer navigation */}
        {!isConfirmation && currentStep?.kind !== "phase_gen" && (
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
                {stepLabel(currentStep, navDocs)}
              </p>

              {currentStep?.kind === "contract" && !data.signedAt ? (
                <span className="text-xs text-muted-foreground">
                  {sowResetBlocked ? "Go back and regenerate your scoped SOW to sign" : "Sign above to continue"}
                </span>
              ) : currentStep?.kind === "payment" && !selectedPlan ? (
                <span className="text-xs text-muted-foreground">
                  {sowResetBlocked ? "Go back and regenerate your scoped SOW to pay" : "Select a payment plan above to continue"}
                </span>
              ) : currentStep?.kind === "checkout" ? (
                null
              ) : currentStep?.kind === "sow" && hasSowDocument && sowResetBlocked ? (
                /* Scoped SOW was invalidated mid-session — show Regenerate (if can) + disabled Continue */
                <div className="flex flex-col items-end gap-2">
                  {regenerateError && (
                    <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 max-w-xs text-right">
                      {regenerateError}
                    </p>
                  )}
                <div className="flex items-center gap-2">
                  {!readOnly && user && (
                    <button
                      onClick={() => void handleRegenerateSow()}
                      disabled={regeneratingSow || savingSelections}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20 disabled:opacity-60"
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
                  )}
                  <button
                    disabled
                    title="Your scoped SOW was updated — regenerate it before continuing to the agreement"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 text-sm font-semibold cursor-not-allowed select-none"
                  >
                    <span>Continue to Agreement</span>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                </div>
              ) : currentStep?.kind === "sow" && hasSowDocument && needsRegeneration && !readOnly && user ? (
                <div className="flex flex-col items-end gap-2">
                  {regenerateError && (
                    <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 max-w-xs text-right">
                      {regenerateError}
                    </p>
                  )}
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
                </div>
              ) : currentStep?.kind === "sow" && !hasSowDocument ? (
                <div className="flex items-center gap-2 text-sm text-black/40 font-medium select-none">
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-40" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0078D4]/60" />
                  </span>
                  <span>Your Statement of Work is being prepared</span>
                </div>
              ) : currentStep?.kind === "sow" && hasSowDocument && !sowResetBlocked && !needsRegeneration && !readOnly ? (
                <button
                  onClick={() => void handleStartPhaseGen()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20"
                >
                  <span>{hasSavedPhasesForCurrentScope ? "Continue to Payment Options" : "Build Your Project Plan"}</span>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : !isLast ? (
                <button
                  onClick={goNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20"
                >
                  <span>
                    Next
                    {steps[stepIndex + 1] && (
                      <span className="opacity-80 hidden sm:inline">: {stepLabel(steps[stepIndex + 1], navDocs)}</span>
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
