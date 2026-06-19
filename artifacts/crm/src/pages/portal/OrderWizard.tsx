import { useState } from "react";
import { X, ArrowRight, ArrowLeft, CheckCircle, Sparkles } from "lucide-react";

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

export default function OrderWizard({ serviceName, basePrice, steps, onComplete, onCancel }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, WizardSelection>>({});

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const currentSelection = step ? selections[step.id] : undefined;

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
      onComplete(runningTotal, Object.values(selections));
    } else {
      setCurrentStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep === 0) {
      onCancel();
    } else {
      setCurrentStep(s => s - 1);
    }
  };

  if (!step) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-[#0A2540] px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />
              <span className="text-white/70 text-xs font-medium truncate">{serviceName}</span>
            </div>
            <h2 className="text-white font-bold text-base leading-snug">Configure your order</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-white/50 hover:text-white transition-colors flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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

        <div className="px-6 pb-4 pt-3 border-t border-border mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">
              {isLast ? "Final price" : "Running total"}
            </span>
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
                  <CheckCircle className="w-4 h-4" />
                  Confirm & Continue
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
      </div>
    </div>
  );
}
