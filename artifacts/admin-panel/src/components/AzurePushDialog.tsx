import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export type AzureStepStatus = "idle" | "running" | "done" | "error";

export interface AzurePushDialogState {
  open: boolean;
  stepStatus: [AzureStepStatus, AzureStepStatus, AzureStepStatus];
  error: string | null;
}

export const AZURE_PUSH_STEPS = [
  "Uploading script to Azure draft…",
  "Publishing runbook…",
  "Done",
] as const;

function StepIcon({ status }: { status: AzureStepStatus }) {
  if (status === "running") {
    return (
      <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin flex-shrink-0" />
    );
  }
  if (status === "done") {
    return (
      <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />;
}

export function AzurePushDialog({
  state,
  onClose,
}: {
  state: AzurePushDialogState;
  onClose: () => void;
}) {
  const hasError = state.error !== null;
  const allDone = state.stepStatus.every(s => s === "done") && !hasError;
  const isDismissible = allDone || hasError;

  return (
    <Dialog open={state.open} onOpenChange={() => { /* controlled externally */ }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-sm translate-x-[-50%] translate-y-[-50%] rounded-lg border border-border bg-card shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          onInteractOutside={e => { if (!isDismissible) e.preventDefault(); }}
          onEscapeKeyDown={e => { if (!isDismissible) e.preventDefault(); else onClose(); }}
        >
          <div className="px-6 pt-6 pb-5">
            <div className="flex items-center gap-2 mb-5">
              <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <h2 className="text-sm font-semibold text-foreground">Push to Azure Automation</h2>
            </div>

            <ol className="space-y-3">
              {AZURE_PUSH_STEPS.map((label, i) => {
                const status = state.stepStatus[i as 0 | 1 | 2];
                return (
                  <li key={label} className="flex items-center gap-3">
                    <StepIcon status={status} />
                    <span className={`text-sm ${
                      status === "running" ? "text-foreground" :
                      status === "done" ? "text-green-400" :
                      status === "error" ? "text-red-400" :
                      "text-muted-foreground/60"
                    }`}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {hasError && (
              <div className="mt-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs leading-relaxed">
                {state.error}
              </div>
            )}

            {isDismissible && (
              <button
                onClick={onClose}
                className="mt-5 w-full py-2 rounded text-sm font-medium bg-accent border border-border text-foreground hover:bg-border transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
