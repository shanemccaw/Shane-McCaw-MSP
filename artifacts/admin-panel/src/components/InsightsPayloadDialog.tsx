import { useState } from "react";
import { X, Copy, CheckCircle, ChevronDown, ChevronRight, Cpu, FileText, List, BarChart2, Users, DollarSign, Tag, BookOpen, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface PayloadPreview {
  model: string;
  maxTokens: number;
  stylePrefix: string;
  assembledPrompt: string;
  scores: {
    security: number; compliance: number; copilot: number;
    governance: number; productivity: number; composite: number;
  };
  findings: string[];
  recommendations: string[];
  profileSample: [string, string][];
  tenantFacts?: string;
  pricingFormula?: string;
  existingDocsSummary?: string;
  engagementProjectsSummary?: string;
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}

function CollapsibleSection({ title, icon, defaultOpen = false, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-background hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <span className="text-blue-400">{icon}</span>
          {title}
          {badge && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">
              {badge}
            </span>
          )}
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
        }
      </button>
      {open && (
        <div className="px-4 py-3 bg-background/60 border-t border-gray-700/50">
          {children}
        </div>
      )}
    </div>
  );
}

function MonoPre({ text }: { text: string }) {
  return (
    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed bg-card rounded-lg p-3 overflow-auto max-h-80">
      {text}
    </pre>
  );
}

interface InsightsPayloadDialogProps {
  open: boolean;
  onClose: () => void;
  payload: PayloadPreview;
  docTypeLabel: string;
}

export function InsightsPayloadDialog({ open, onClose, payload, docTypeLabel }: InsightsPayloadDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const scoresText = [
    `Security:     ${payload.scores.security}/100`,
    `Compliance:   ${payload.scores.compliance}/100`,
    `Copilot:      ${payload.scores.copilot}/100`,
    `Governance:   ${payload.scores.governance}/100`,
    `Productivity: ${payload.scores.productivity}/100`,
    `Composite:    ${payload.scores.composite}/100`,
  ].join("\n");

  const findingsText = payload.findings.length > 0
    ? payload.findings.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "(no findings recorded)";

  const recommendationsText = payload.recommendations.length > 0
    ? payload.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(no recommendations recorded)";

  const profileText = payload.profileSample.length > 0
    ? payload.profileSample.map(([k, v]) => `${k}: ${v}`).join("\n")
    : "(no telemetry captured)";

  const copyAll = async () => {
    const sections = [
      `=== AI PAYLOAD INSPECTOR — ${docTypeLabel} ===\n`,
      `MODEL & SETTINGS\nModel: ${payload.model}\nMax Tokens: ${payload.maxTokens}`,
      payload.stylePrefix ? `DOCUMENT STYLE PREFIX\n${payload.stylePrefix}` : null,
      `ASSEMBLED PROMPT\n${payload.assembledPrompt}`,
      `SCORES\n${scoresText}`,
      `FINDINGS (${payload.findings.length})\n${findingsText}`,
      `RECOMMENDATIONS (${payload.recommendations.length})\n${recommendationsText}`,
      payload.profileSample.length > 0 ? `PROFILE SAMPLE\n${profileText}` : null,
      payload.tenantFacts ? `SOW EXTRAS — TENANT FACTS\n${payload.tenantFacts}` : null,
      payload.pricingFormula ? `SOW EXTRAS — PRICING FORMULA\n${payload.pricingFormula}` : null,
    ].filter(Boolean).join("\n\n---\n\n");

    try {
      await navigator.clipboard.writeText(sections);
      setCopied(true);
      toast({ title: "Copied", description: "Full payload copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-background border border-gray-700/50 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-white font-semibold text-sm">AI Payload Inspector</div>
              <div className="text-gray-500 text-xs mt-0.5">{docTypeLabel} — read-only preview, no document generated</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void copyAll()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700/50 transition-colors"
            >
              {copied
                ? <><CheckCircle className="w-3.5 h-3.5 text-green-400" /> Copied!</>
                : <><Copy className="w-3.5 h-3.5" /> Copy all</>
              }
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 min-h-0">

          {/* Model & Settings */}
          <CollapsibleSection
            title="Model & settings"
            icon={<Cpu className="w-3.5 h-3.5" />}
            defaultOpen
          >
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-card rounded-lg px-3 py-2">
                <div className="text-gray-500 mb-0.5">Model</div>
                <div className="text-gray-200 font-mono">{payload.model}</div>
              </div>
              <div className="bg-card rounded-lg px-3 py-2">
                <div className="text-gray-500 mb-0.5">Max tokens</div>
                <div className="text-gray-200 font-mono">{payload.maxTokens.toLocaleString()}</div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Document style prefix */}
          <CollapsibleSection
            title="Document style prefix"
            icon={<Tag className="w-3.5 h-3.5" />}
          >
            {payload.stylePrefix ? (
              <MonoPre text={payload.stylePrefix} />
            ) : (
              <p className="text-xs text-gray-500 italic">No style prefix configured (set "insights-document-style" prompt in AI Prompts).</p>
            )}
          </CollapsibleSection>

          {/* Assembled prompt */}
          <CollapsibleSection
            title="Assembled prompt"
            icon={<FileText className="w-3.5 h-3.5" />}
            badge={`${payload.assembledPrompt.length.toLocaleString()} chars`}
            defaultOpen
          >
            <MonoPre text={payload.assembledPrompt} />
          </CollapsibleSection>

          {/* Scores */}
          <CollapsibleSection
            title="Scores"
            icon={<BarChart2 className="w-3.5 h-3.5" />}
            defaultOpen
          >
            <div className="grid grid-cols-3 gap-2">
              {(["security", "compliance", "copilot", "governance", "productivity", "composite"] as const).map(key => (
                <div key={key} className="bg-card rounded-lg px-3 py-2 text-xs">
                  <div className="text-gray-500 capitalize mb-0.5">{key}</div>
                  <div className="text-white font-mono font-semibold">{payload.scores[key]}<span className="text-gray-500">/100</span></div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* Findings */}
          <CollapsibleSection
            title="Findings"
            icon={<List className="w-3.5 h-3.5" />}
            badge={String(payload.findings.length)}
          >
            {payload.findings.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No findings recorded yet — run assessment scripts first.</p>
            ) : (
              <ol className="flex flex-col gap-1.5 list-none">
                {payload.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-300">
                    <span className="text-gray-600 font-mono shrink-0 w-5">{i + 1}.</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ol>
            )}
          </CollapsibleSection>

          {/* Recommendations */}
          <CollapsibleSection
            title="Recommendations"
            icon={<CheckCircle className="w-3.5 h-3.5" />}
            badge={String(payload.recommendations.length)}
          >
            {payload.recommendations.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No recommendations recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-1.5 list-none">
                {payload.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-300">
                    <span className="text-gray-600 font-mono shrink-0 w-5">{i + 1}.</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            )}
          </CollapsibleSection>

          {/* Profile sample */}
          <CollapsibleSection
            title="Profile sample"
            icon={<Users className="w-3.5 h-3.5" />}
            badge={`${payload.profileSample.length} key-value pairs`}
          >
            {payload.profileSample.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No telemetry captured — run assessment scripts first.</p>
            ) : (
              <div className="overflow-auto max-h-64">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="pb-1.5 pr-4 text-gray-500 font-medium">Key</th>
                      <th className="pb-1.5 text-gray-500 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.profileSample.map(([k, v], i) => (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                        <td className="py-1 pr-4 text-gray-400 font-mono">{k}</td>
                        <td className="py-1 text-gray-300 font-mono">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>

          {/* Existing docs — only shown for consolidated SOW */}
          {payload.existingDocsSummary !== undefined && (
            <CollapsibleSection
              title="Existing client documents"
              icon={<BookOpen className="w-3.5 h-3.5" />}
              defaultOpen
            >
              <MonoPre text={payload.existingDocsSummary || "(none found for this client)"} />
            </CollapsibleSection>
          )}

          {/* Engagement projects — only shown for consolidated SOW */}
          {payload.engagementProjectsSummary !== undefined && (
            <CollapsibleSection
              title="Engagement project catalogue"
              icon={<Briefcase className="w-3.5 h-3.5" />}
              defaultOpen
            >
              <MonoPre text={payload.engagementProjectsSummary || "(no visible engagement projects configured)"} />
            </CollapsibleSection>
          )}

          {/* SOW extras — only shown for SOW types */}
          {(payload.tenantFacts || payload.pricingFormula) && (
            <CollapsibleSection
              title="SOW extras"
              icon={<DollarSign className="w-3.5 h-3.5" />}
            >
              <div className="flex flex-col gap-3">
                {payload.tenantFacts && (
                  <div>
                    <div className="text-xs text-gray-500 font-medium mb-1.5">Tenant facts</div>
                    <MonoPre text={payload.tenantFacts} />
                  </div>
                )}
                {payload.pricingFormula && (
                  <div>
                    <div className="text-xs text-gray-500 font-medium mb-1.5">Pricing formula</div>
                    <MonoPre text={payload.pricingFormula} />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700/50 shrink-0">
          <span className="text-xs text-gray-600">Read-only — no document is generated or saved.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
