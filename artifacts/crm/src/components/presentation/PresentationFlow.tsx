import { useState, useCallback } from "react";
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

function stepShortLabel(step: Step, docs: PresentationDoc[]): string {
  if (step.kind === "welcome") return "Overview";
  if (step.kind === "doc") return `Doc ${(step.index) + 1}`;
  if (step.kind === "sow") return "Scope";
  if (step.kind === "contract") return "Sign";
  if (step.kind === "payment") return "Pay";
  if (step.kind === "confirmation") return "Done";
  return "";
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

  const computeInitialStep = () => {
    if (!startAtPayment) return 0;
    const steps = buildSteps(initialData.documents, readOnly);
    // If already paid, jump to confirmation; otherwise payment step
    const targetKind = initialData.status === "paid" ? "confirmation" : "payment";
    const idx = steps.findIndex(s => s.kind === targetKind);
    return idx >= 0 ? idx : 0;
  };
  const [stepIndex, setStepIndex] = useState(computeInitialStep);
  const [signerName, setSignerName] = useState(data.signerName ?? user?.name ?? "");

  // Operation states
  const [savingSelections, setSavingSelections] = useState(false);
  const [signing, setSigning] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  // Login gate for public read-only links when user tries to proceed past SOW
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
    if (stepIndex < steps.length - 1) setStepIndex(i => i + 1);
  };

  const goPrev = () => {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  };

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isConfirmation = currentStep?.kind === "confirmation";
  const isPaid = data.status === "paid";

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#F7F9FC]">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#0A2540] border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm truncate">
                {data.projectTitle ?? "Your Assessment Results"}
              </p>
              {readOnly && (
                <p className="text-white/50 text-[10px]">Preview — sign in to proceed</p>
              )}
            </div>
          </div>

          {/* Step progress */}
          <div className="hidden sm:flex items-center gap-1 flex-1 max-w-xs">
            {steps.map((step, i) => (
              <div
                key={i}
                title={stepLabel(step, data.documents)}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i < stepIndex
                    ? "bg-[#0078D4]"
                    : i === stepIndex
                    ? "bg-white"
                    : "bg-white/20"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/50 text-xs hidden sm:block">
              {stepIndex + 1} / {steps.length}
            </span>
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
        </div>

        {/* Step tabs (scrollable on mobile) */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-0 min-w-max">
            {steps.map((step, i) => (
              <button
                key={i}
                onClick={() => i < stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
                className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  i === stepIndex
                    ? "border-white text-white"
                    : i < stepIndex
                    ? "border-transparent text-white/50 hover:text-white/80 cursor-pointer"
                    : "border-transparent text-white/30 cursor-not-allowed"
                }`}
              >
                {stepShortLabel(step, data.documents)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 h-full flex flex-col">

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
            <div className="flex-1 overflow-y-auto">
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
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
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
