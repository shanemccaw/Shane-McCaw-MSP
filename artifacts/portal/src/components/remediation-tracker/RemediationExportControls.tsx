import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRemediationExport, type RemediationExportKind } from "@/lib/remediation-tracker-export-api";
import { cn } from "@/lib/utils";

const LABELS: Record<RemediationExportKind, string> = {
  csv: "Export CSV",
  pdf: "Export PDF",
  "evidence-pack": "Evidence pack",
};

/**
 * The three real export triggers (§1g, `docs/portal/remediation-tracking-contract-pack.md`):
 * every catalogue step's claim as CSV/PDF, or a verification-only evidence
 * pack. Each is a real file streamed from `portal-remediation-tracker-export.ts`
 * — nothing generated client-side.
 *
 * `verifiedCount`, when supplied by a caller that already has the full tracker
 * grid loaded (the §1a surface, out of this module's own scope), labels the
 * evidence-pack button honestly instead of guessing; omitted, the button
 * still works — the export route itself renders "nothing verified yet" when
 * that's the real state.
 */
export function RemediationExportControls({ verifiedCount }: { verifiedCount?: number }) {
  const csvExport = useRemediationExport("csv");
  const pdfExport = useRemediationExport("pdf");
  const evidenceExport = useRemediationExport("evidence-pack");

  const evidenceOff = verifiedCount === 0;

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="remediation-export-controls">
      <ExportButton
        kind="csv"
        mutation={csvExport}
        label={LABELS.csv}
      />
      <ExportButton
        kind="pdf"
        mutation={pdfExport}
        label={LABELS.pdf}
      />
      <ExportButton
        kind="evidence-pack"
        mutation={evidenceExport}
        label={
          evidenceOff
            ? "Evidence pack — nothing verified"
            : verifiedCount !== undefined
              ? `Evidence pack · ${verifiedCount}`
              : LABELS["evidence-pack"]
        }
        disabled={evidenceOff}
        emphasize={!evidenceOff}
      />
    </div>
  );
}

function ExportButton({
  kind,
  mutation,
  label,
  disabled,
  emphasize,
}: {
  kind: RemediationExportKind;
  mutation: ReturnType<typeof useRemediationExport>;
  label: string;
  disabled?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || mutation.isPending}
      onClick={() =>
        mutation.mutate(undefined, {
          onError: (err) => toast.error(err instanceof Error ? err.message : "Export failed"),
        })
      }
      data-testid={`remediation-export-${kind}`}
      className={cn(
        "gap-1.5 text-[11.5px] font-semibold",
        emphasize && "border-status-green/40 bg-status-green/10 text-status-green",
      )}
    >
      {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {label}
    </Button>
  );
}
