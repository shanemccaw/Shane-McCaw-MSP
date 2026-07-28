import { X, Sparkles, Copy, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { CollapsibleSection, MonoPre } from "@/components/InsightsPayloadDialog";

interface DocumentTypePreviewDialogProps {
  onClose: () => void;
  docTypeLabel: string;
  preview: {
    dryRun: true;
    docTypeKey: string;
    assembledPrompt: string;
    stylePrefix: string;
    scopedProfile?: Record<string, unknown>;
    scopedFindings?: string[];
    priorFindings?: string[];
    sectionText?: string;
    promptKey: string;
    candidates?: {
      serviceId: number;
      serviceName: string;
      rationale: string;
      adjustedPriceCents: number;
      firedSignalKeys: string[];
    }[];
  };
}

export default function DocumentTypePreviewDialog({ onClose, docTypeLabel, preview }: DocumentTypePreviewDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const findings = preview.scopedFindings ?? preview.priorFindings ?? [];
  const findingsText = findings.length > 0 ? findings.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none)";

  const profileText = preview.scopedProfile && Object.keys(preview.scopedProfile).length > 0
    ? Object.entries(preview.scopedProfile).map(([k, v]) => `${k}: ${String(v)}`).join("\n")
    : "(no telemetry captured, or this document type has no profile scoping configured)";

  const candidatesText = preview.candidates && preview.candidates.length > 0
    ? preview.candidates.map((c, i) => `${i + 1}. ${c.serviceName} — $${(c.adjustedPriceCents / 100).toFixed(2)}\n   Rationale: ${c.rationale}`).join("\n\n")
    : null;

  const copyAll = async () => {
    const sections = [
      `=== DOCUMENT TYPE PREVIEW — ${docTypeLabel} ===\n`,
      `PROMPT KEY\n${preview.promptKey}`,
      `STYLE PREFIX\n${preview.stylePrefix}`,
      `ASSEMBLED PROMPT\n${preview.assembledPrompt}`,
      `SCOPED PROFILE\n${profileText}`,
      `FINDINGS\n${findingsText}`,
      candidatesText ? `SALES OFFER ENGINE CANDIDATES\n${candidatesText}` : null,
    ].filter(Boolean).join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(sections);
      setCopied(true);
      toast({ title: "Copied", description: "Full preview copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-background border border-gray-700/50 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-white font-semibold text-sm">Document Preview</div>
              <div className="text-gray-500 text-xs mt-0.5">{docTypeLabel} — real scoped data, no document generated</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void copyAll()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700/50 transition-colors">
              {copied ? <><CheckCircle className="w-3.5 h-3.5 text-green-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy all</>}
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 min-h-0">
          <CollapsibleSection title="Scoped profile telemetry" icon={<Sparkles className="w-3.5 h-3.5" />} defaultOpen badge={`${preview.scopedProfile ? Object.keys(preview.scopedProfile).length : 0} keys`}>
            <MonoPre text={profileText} />
          </CollapsibleSection>
          <CollapsibleSection title="Findings" icon={<Sparkles className="w-3.5 h-3.5" />} badge={`${findings.length}`}>
            <MonoPre text={findingsText} />
          </CollapsibleSection>
          {candidatesText && (
            <CollapsibleSection title="Sales Offer Engine candidates" icon={<Sparkles className="w-3.5 h-3.5" />} defaultOpen badge={`${preview.candidates?.length ?? 0}`}>
              <MonoPre text={candidatesText} />
            </CollapsibleSection>
          )}
          <CollapsibleSection title="Assembled prompt (sent to AI)" icon={<Sparkles className="w-3.5 h-3.5" />} defaultOpen>
            <MonoPre text={preview.assembledPrompt} />
          </CollapsibleSection>
          <CollapsibleSection title="Style prefix" icon={<Sparkles className="w-3.5 h-3.5" />}>
            <MonoPre text={preview.stylePrefix} />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
