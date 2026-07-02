import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DocumentPanel from "./DocumentPanel";
import SowSelectorPanel from "./SowSelectorPanel";
import ContractSignPanel from "./ContractSignPanel";
import PaymentOptionsPanel from "./PaymentOptionsPanel";

interface PresentationDoc {
  id: number;
  title: string;
  category: "report" | "consulting";
  docType: string;
  htmlContent: string;
}

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
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
  signatureData: string | null;
  signedAt: string | null;
  signerName: string | null;
  paymentPlan: "full" | "phased" | null;
  status: "draft" | "signed" | "paid";
  projectTitle: string | null;
  clientName: string | null;
  contractBody: string | null;
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

  const [data, setData] = useState<PresentationData>(initialData);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const computeInitialStep = () => {
    if (!startAtPayment) return 0;
    const steps = buildSteps(initialData.documents, readOnly);
    const targetKind = initialData.status === "paid" ? "confirmation" : "payment";
    const idx = steps.findIndex(s => s.kind === targetKind);
    return idx >= 0 ? idx : 0;
  };
  const [stepIndex, setStepIndex] = useState(computeInitialStep);
  const [maxVisitedStep, setMaxVisitedStep] = useState(computeInitialStep);
  const [signerName, setSignerName] = useState(data.signerName ?? user?.name ?? "");

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0;
    }
  }, [stepIndex]);

  const [savingSelections, setSavingSelections] = useState(false);
  const [signing, setSigning] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showLoginGate, setShowLoginGate] = useState(false);

  const steps = buildSteps(data.documents, readOnly);
  const currentStep = steps[stepIndex];

  const currentSowPhases = data.sowPhases ?? [];
  const selectedPhaseIds = data.selectedPhaseIds ?? currentSowPhases.map(p => p.id);
  const phasesWithSelection = currentSowPhases.map(p => ({
    ...p,
    selected: selectedPhaseIds.includes(p.id),
  }));
  const selectedPhases = phasesWithSelection.filter(p => p.selected);
  const selectedTotal = selectedPhases.reduce((sum, p) => sum + p.price, 0) || data.totalPrice;

  const fetchFn = useCallback((url: string, opts?: RequestInit) => {
    if (user) return fetchWithAuth(url, opts);
    return fetch(url, opts);
  }, [user, fetchWithAuth]);

  const handleTogglePhase = async (phaseId: string) => {
    if (readOnly || !user) return;
    const newIds = selectedPhaseIds.includes(phaseId)
      ? selectedPhaseIds.filter(id => id !== phaseId)
      : [...selectedPhaseIds, phaseId];

    setData(prev => ({ ...prev, selectedPhaseIds: newIds }));
    setSavingSelections(true);
    try {
      const res = await fetchFn(`/api/portal/presentations/${presentationId}/selections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPhaseIds: newIds }),
      });
      if (res.ok) {
        const updated = await res.json() as { totalPrice: number; selectedPhaseIds: string[] };
        setData(prev => ({ ...prev, ...updated }));
      }
    } finally {
      setSavingSelections(false);
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

  const goNext = () => {
    if (readOnly && currentStep?.kind === "sow") {
      setShowLoginGate(true);
      return;
    }
    if (stepIndex < steps.length - 1) {
      setStepIndex(i => {
        const next = i + 1;
        setMaxVisitedStep(m => Math.max(m, next));
        return next;
      });
    }
  };

  const goPrev = () => {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  };

  const navigateToStep = (i: number) => {
    if (i <= maxVisitedStep) {
      setStepIndex(i);
      setSidebarOpen(false);
    }
  };

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
              title={isActive ? "Current step" : isVisited ? "Click to go back to this step" : "Complete previous steps to unlock"}
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
                ) : (
                  i + 1
                )}
              </span>
              <span className="text-[12px] font-medium leading-tight line-clamp-2">
                {stepLabel(step, data.documents)}
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
            {stepLabel(currentStep, data.documents)}
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
        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto">
          <div key={stepIndex} className="max-w-4xl mx-auto px-4 sm:px-6 py-6 h-full flex flex-col animate-step-in">

            {/* Welcome step */}
            {currentStep?.kind === "welcome" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 max-w-xl mx-auto">
                <div className="w-20 h-20 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
                  <svg className="w-10 h-10 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold text-[#0A2540]">
                    {data.projectTitle ?? "Your Assessment Results"}
                  </h1>
                  <p className="text-muted-foreground mt-2 leading-relaxed">
                    {data.clientName ? `Hi ${data.clientName.split(" ")[0]}, your` : "Your"} Microsoft 365 assessment is complete.
                    This presentation walks you through all generated deliverables, the recommended scope of work,
                    and your engagement options.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 w-full text-center">
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
                      ${Math.round((data.totalPrice ?? 0) / 1000)}k
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Investment</p>
                  </div>
                </div>
              </div>
            )}

            {/* Document panels */}
            {currentStep?.kind === "doc" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <DocumentPanel doc={data.documents[currentStep.index]} />
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
                  onTogglePhase={(id) => void handleTogglePhase(id)}
                />
              </div>
            )}

            {/* Contract & signature */}
            {currentStep?.kind === "contract" && (
              <div className="flex-1">
                <ContractSignPanel
                  signerName={signerName}
                  selectedPhases={selectedPhases}
                  totalPrice={selectedTotal}
                  onChangeName={setSignerName}
                  onSign={handleSign}
                  signing={signing}
                  alreadySigned={!!data.signedAt}
                  contractBody={data.contractBody}
                />
              </div>
            )}

            {/* Payment */}
            {currentStep?.kind === "payment" && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <PaymentOptionsPanel
                  totalPrice={selectedTotal}
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
                {stepLabel(currentStep, data.documents)}
              </p>

              {currentStep?.kind === "contract" && !data.signedAt ? (
                <span className="text-xs text-muted-foreground">Sign above to continue</span>
              ) : currentStep?.kind === "payment" ? (
                <span className="text-xs text-muted-foreground">Select a plan to continue</span>
              ) : !isLast ? (
                <button
                  onClick={goNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/90 transition-colors shadow-sm shadow-[#0078D4]/20"
                >
                  Next
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
