import { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import ChecklistClosureForm, {
  type ClosureField,
  type ChecklistClosureFormHandle,
} from "./ChecklistClosureForm";

interface Props {
  open: boolean;
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  itemId: string;
  itemLabel: string;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onSubmitted: (updatedMeta: Record<string, unknown>) => void;
  onCancel: () => void;
}

const FALLBACK_FIELD: ClosureField = {
  id: "closure_notes",
  label: "Closure notes",
  type: "textarea",
  placeholder: "Describe what was done, any relevant details…",
  required: false,
};

type Phase = "loading" | "ready" | "submitting";

export default function ChecklistClosureDialog({
  open,
  taskId,
  taskTitle,
  taskDescription,
  itemId,
  itemLabel,
  fetchWithAuth,
  onSubmitted,
  onCancel,
}: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [fields, setFields] = useState<ClosureField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<ChecklistClosureFormHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("loading");
    setFields([]);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timeout = setTimeout(() => ctrl.abort(), 6000);

    fetchWithAuth(
      `/api/admin/kanban-tasks/${taskId}/checklist/${encodeURIComponent(itemId)}/completion-schema`,
      { method: "POST", signal: ctrl.signal }
    )
      .then(async (res) => {
        clearTimeout(timeout);
        if (!res.ok) throw new Error("Schema fetch failed");
        const data = (await res.json()) as { fields?: ClosureField[] };
        const fetched = data.fields ?? [];
        setFields(fetched.length > 0 ? fetched : [FALLBACK_FIELD]);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        if ((err as { name?: string }).name === "AbortError") {
          setFields([FALLBACK_FIELD]);
          setPhase("ready");
        } else {
          setFields([FALLBACK_FIELD]);
          setPhase("ready");
        }
      });

    return () => {
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [open, taskId, itemId]);

  const handleSubmit = async () => {
    if (!formRef.current) return;
    const answers = formRef.current.getValues();
    setPhase("submitting");
    setError(null);

    try {
      const res = await fetchWithAuth(
        `/api/admin/kanban-tasks/${taskId}/checklist/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checked: true,
            closureData: { schema: fields, answers },
          }),
        }
      );
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to save");
        setPhase("ready");
        return;
      }
      const data = (await res.json()) as { taskMetadata: Record<string, unknown> };
      onSubmitted(data.taskMetadata);
    } catch {
      setError("Network error — please try again");
      setPhase("ready");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#0A2540] leading-snug">
            Complete checklist item
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            <span className="font-semibold text-[#0A2540]">{itemLabel}</span>
            {taskTitle && (
              <span> · {taskTitle}</span>
            )}
          </p>
        </DialogHeader>

        <div className="mt-2">
          {phase === "loading" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-3.5 h-3.5 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin flex-shrink-0" />
                Claude is generating tailored questions…
              </div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5 animate-pulse">
                  <div className="h-2.5 w-24 rounded bg-gray-200" />
                  <div className="h-9 w-full rounded-lg bg-gray-100" />
                </div>
              ))}
            </div>
          )}

          {(phase === "ready" || phase === "submitting") && (
            <ChecklistClosureForm ref={formRef} fields={fields} />
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={phase === "submitting"}
            className="text-sm font-semibold text-muted-foreground hover:text-[#0A2540] px-3 py-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={phase !== "ready"}
            className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
          >
            {phase === "submitting" && (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {phase === "submitting" ? "Saving…" : "Mark complete"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
