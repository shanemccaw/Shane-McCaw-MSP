import { useState } from "react";
import { X, ArrowRight, ArrowLeft, CheckCircle, Sparkles, Edit2 } from "lucide-react";

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  priceAdjustment: number;
}

export interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

export interface WizardSelection {
  stepId: string;
  stepTitle: string;
  optionId: string;
  optionLabel: string;
  priceAdjustment: number;
}

interface Props {
  serviceName: string;
  basePrice: number;
  steps: WizardStep[];
  onComplete: (finalPrice: number, selections: WizardSelection[]) => void;
  onCancel: () => void;
}

type Phase = "questions" | "review";

export default function OrderWizard({ serviceName, basePrice, steps, onComplete, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("questions");
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, WizardSelection>>({});

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const currentSelection = step ? selections[step.id] : undefined;

  const completedSelections = steps
    .map(s => selections[s.id])
    .filter(Boolean) as WizardSelection[];

  const runningTotal = basePrice + Object.values(selections).reduce((s, sel) => s + sel.priceAdjustment, 0);

  const handleSelect = (option: WizardOption) => {
    if (!step) return;
    setSelections(prev => ({
      ...prev,
      [step.id]: {
        stepId: step.id,
        stepTitle: step.title,
        optionId: option.id,
        optionLabel: option.label,
        priceAdjustment: option.priceAdjustment,
      },
    }));
  };

  const handleNext = () => {
    if (!currentSelection) return;
    if (isLast) {
      setPhase("review");
    } else {
      setCurrentStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (phase === "review") {
      setPhase("questions");
      return;
    }
    if (currentStep === 0) {
      onCancel();
    } else {
      setCurrentStep(s => s - 1);
    }
  };

  const handleConfirm = () => {
    onComplete(runningTotal, completedSelections);
  };

  const jumpToStep = (idx: number) => {
    setCurrentStep(idx);
    setPhase("questions");
  };

  if (!step && phase === "questions") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-[#0A2540] px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />
              <span className="text-white/70 text-xs font-medium truncate">{serviceName}</span>
            </div>
            <h2 className="text-white font-bold text-base leading-snug">
              {phase === "review" ? "Review your selections" : "Configure your order"}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-white/50 hover:text-white transition-colors flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === "questions" && step ? (
          <>
            {/* Progress */}
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">
                  Step {currentStep + 1} of {steps.length}
                </span>
                <span className="text-xs font-bold text-[#0078D4]">
                  ${runningTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </span>
              </div>
              <div className="w-full bg-[#F7F9FC] rounded-full h-1.5 mb-4">
                <div
                  className="h-1.5 rounded-full bg-[#0078D4] transition-all duration-300"
                  style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                />
              </div>

              <h3 className="text-[#0A2540] font-bold text-sm mb-3">{step.title}</h3>

              <div className="space-y-2">
                {step.options.map(option => {
                  const isSelected = currentSelection?.optionId === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => handleSelect(option)}
                      className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all focus:outline-none ${
                        isSelected
                          ? "border-[#0078D4] bg-[#0078D4]/5"
                          : "border-border bg-white hover:border-[#0078D4]/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                            isSelected ? "border-[#0078D4] bg-[#0078D4]" : "border-border"
                          }`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${isSelected ? "text-[#0078D4]" : "text-[#0A2540]"}`}>
                              {option.label}
                            </p>
                            {option.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{option.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {option.priceAdjustment === 0 ? (
                            <span className="text-xs text-muted-foreground">Included</span>
                          ) : (
                            <span className={`text-sm font-bold ${isSelected ? "text-[#0078D4]" : "text-[#0A2540]"}`}>
                              +${option.priceAdjustment.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-4 pt-3 border-t border-border mt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">Running total</span>
                <span className="text-base font-extrabold text-[#0A2540]">
                  ${runningTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0A2540] px-4 py-2.5 border border-border rounded-xl bg-white transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {currentStep === 0 ? "Cancel" : "Back"}
                </button>
                <button
                  onClick={handleNext}
                  disabled={!currentSelection}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                >
                  {isLast ? (
                    <>
                      Review & Confirm
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Review screen */
          <>
            <div className="px-6 pt-5 pb-2">
              <p className="text-sm text-muted-foreground mb-4">
                Please confirm your selections below. This is the price that will appear in your contract.
              </p>

              <div className="bg-[#F7F9FC] rounded-xl border border-border divide-y divide-border mb-4">
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Starting price</span>
                  <span className="text-sm font-semibold text-[#0A2540]">
                    ${basePrice.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </span>
                </div>
                {completedSelections.map(sel => (
                  <div key={sel.stepId} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{sel.stepTitle}</p>
                        <p className="text-sm font-medium text-[#0A2540]">{sel.optionLabel}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-semibold text-[#0078D4]">
                          {sel.priceAdjustment === 0
                            ? <span className="text-muted-foreground font-normal">Included</span>
                            : `+$${sel.priceAdjustment.toLocaleString("en-US")}`
                          }
                        </span>
                        <button
                          onClick={() => jumpToStep(steps.findIndex(s => s.id === sel.stepId))}
                          className="text-muted-foreground hover:text-[#0078D4] transition-colors"
                          title="Edit this choice"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="px-4 py-3 bg-[#0078D4]/5 flex items-center justify-between rounded-b-xl">
                  <span className="text-sm font-bold text-[#0A2540]">Total for {serviceName}</span>
                  <span className="text-lg font-extrabold text-[#0078D4]">
                    ${runningTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                This price will be validated and confirmed when you sign the service agreement on the next step.
              </p>
            </div>

            <div className="px-6 pb-5 pt-3 border-t border-border mt-2">
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0A2540] px-4 py-2.5 border border-border rounded-xl bg-white transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  Confirm & Continue to Agreement
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
