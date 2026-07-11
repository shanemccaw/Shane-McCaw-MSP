import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ImportJsonDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (records: unknown[]) => void;
}

export function ImportJsonDialog({ open, onClose, onConfirm }: ImportJsonDialogProps) {
  const [raw, setRaw] = useState("");
  const [validation, setValidation] = useState<{ ok: boolean; message: string; records: unknown[] | null }>({
    ok: false,
    message: "",
    records: null,
  });

  useEffect(() => {
    if (!open) {
      setRaw("");
      setValidation({ ok: false, message: "", records: null });
    }
  }, [open]);

  useEffect(() => {
    if (!raw.trim()) {
      setValidation({ ok: false, message: "", records: null });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setValidation({ ok: false, message: "JSON must be an array of records", records: null });
        return;
      }
      setValidation({ ok: true, message: `✓ Valid — ${parsed.length} record${parsed.length === 1 ? "" : "s"}`, records: parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON";
      setValidation({ ok: false, message: msg, records: null });
    }
  }, [raw]);

  const handleConfirm = () => {
    if (!validation.records) return;
    onConfirm(validation.records);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="bg-[#161B22] border-[#30363D] text-white max-w-xl">
        <DialogHeader>
          <DialogTitle>Import JSON</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Paste a JSON array of records below. Existing records with matching keys will be updated; new keys will be created.
          </p>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Paste JSON array here…"
            rows={12}
            className="bg-[#0D1117] border-[#30363D] text-white font-mono text-xs resize-none"
            spellCheck={false}
          />
          {raw.trim() && (
            <p className={`text-sm font-medium ${validation.ok ? "text-green-400" : "text-red-400"}`}>
              {validation.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-gray-400">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!validation.ok}
            className="bg-[#0078D4] hover:bg-[#006cbf] text-white disabled:opacity-50"
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
