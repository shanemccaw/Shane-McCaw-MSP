import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface TemplateListItem {
  slug: string;
  name: string;
  subject: string;
  updatedAt: string;
  recipientType: "client" | "admin";
}

interface TemplateDetail {
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  variables: Array<{ name: string; description: string }>;
  updatedAt: string;
  recipientType: "client" | "admin";
}

type FilterType = "all" | "client" | "admin";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Fallback wrapper — only used if the real `branded-layout` DB template can't
// be fetched (e.g. offline, 404). Mirrors the hardcoded fallback in
// artifacts/api-server/src/lib/mailer.ts so preview never crashes.
const FALLBACK_WRAPPER = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Shane McCaw Consulting</title>
</head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0A2540;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Shane McCaw Consulting</p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Lead Microsoft 365 Architect</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#1e293b;font-size:15px;line-height:1.6;">
            {{body}}
          </td>
        </tr>
        <tr>
          <td style="background:#f1f5f9;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
              Shane McCaw Consulting LLC &nbsp;|&nbsp; <a href="https://shanemccaw.com" style="color:#2F6FED;text-decoration:none;">shanemccaw.com</a><br/>
              You're receiving this because you have an account or made a purchase with us.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// Placeholder body used when previewing the `branded-layout` template itself,
// so editing the wrapper shows a representative body instead of the raw
// wrapper HTML (which would otherwise be nested inside its own {{body}} slot).
const SAMPLE_BODY_FOR_LAYOUT_PREVIEW = `
  <p>Hi Sarah,</p>
  <p>This is sample email content used to preview the branded layout — header, footer, colors, and spacing.</p>
  <p style="margin:24px 0 0;"><a href="#" style="display:inline-block;background:#2F6FED;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Sample Button →</a></p>
  <p style="margin-top:24px;">— Shane McCaw</p>
`;

const SAMPLE_DATA: Record<string, string> = {
  clientName: "Sarah Johnson",
  firstName: "Sarah",
  name: "James Whitfield",
  email: "james.whitfield@contoso.com",
  clientEmail: "sarah.johnson@contoso.com",
  company: "Contoso Ltd",
  companySize: "501–1,000 employees",
  serviceName: "Microsoft 365 Copilot Readiness",
  serviceArea: "Microsoft 365 & Copilot AI Strategy",
  amountDollars: "2,497",
  portalLink: "https://portal.shanemccaw.com/dashboard",
  projectUrl: "https://portal.shanemccaw.com/projects/m365-copilot-readiness",
  adminPanelUrl: "https://admin.shanemccaw.com/projects/42",
  bookingLink: "https://shanemccaw.com/book",
  resetLink: "https://portal.shanemccaw.com/reset-password?token=abc123xyz456",
  resultsUrl: "https://shanemccaw.com/quiz/results/abc123def456",
  projectTitle: "SharePoint Intranet Redesign",
  reportTitle: "Week 4 Progress Update",
  reportName: "Microsoft Copilot Readiness Assessment",
  howFound: "LinkedIn",
  message:
    "We've been on M365 for three years and are exploring Copilot, but we aren't sure our environment is ready. I'd love to understand what gaps we need to close before rolling it out to 600 users.",
  adminReply:
    "The document library migration has been moved to next Thursday. I've spoken with IT about the permission restructure and we're aligned on the approach — nothing you need to do right now. I'll update the task board by end of day.",
  replyContent:
    "Thanks Shane — that makes sense. Should we loop in the IT lead before Thursday, or are you handling that directly?",
  messageBody:
    "Hi Sarah, the SharePoint site structure we discussed is now live in your test environment. Please take a look when you get a chance and let me know if anything needs adjusting before we move to production next week.",
  purchaseType: "Service purchase",
  nextBillingDate: "July 15, 2026",
  totalScore: "34",
  tier: "Intermediate",
  recommendedService: "Microsoft 365 Copilot Accelerator",
  whatThisMeans:
    "Your organisation has a solid M365 foundation with strong Teams adoption, but identity governance and data classification practices need attention before a wide Copilot rollout. Unmanaged external sharing in SharePoint is the biggest risk area to address first.",
  whyThisFits:
    "The Copilot Accelerator is designed specifically for organisations at your maturity level — it closes governance gaps, configures sensitivity labels, and delivers a phased rollout plan that gets your most productive teams on Copilot within 90 days while keeping compliance risk low.",
  roiProjection:
    "Enabling Copilot for 200 knowledge workers typically yields 1–2 hours of saved time per person per week. At $75/hr fully-loaded, that represents $780k–$1.56M in annual value against a one-time engagement of $14,997.",
  categoryScoresRows: [
    '<tr><td colspan="2" style="padding:8px 0 4px;border-top:1px solid #e2e8f0;">',
    '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Category Breakdown</span>',
    "</td></tr>",
    '<tr><td style="padding:2px 0;color:#64748b;font-size:13px;">Identity &amp; Access</td><td style="padding:2px 0;font-weight:600;">7 / 10</td></tr>',
    '<tr><td style="padding:2px 0;color:#64748b;font-size:13px;">Data Governance</td><td style="padding:2px 0;font-weight:600;">5 / 10</td></tr>',
    '<tr><td style="padding:2px 0;color:#64748b;font-size:13px;">Collaboration &amp; Teams</td><td style="padding:2px 0;font-weight:600;">8 / 10</td></tr>',
    '<tr><td style="padding:2px 0;color:#64748b;font-size:13px;">Security &amp; Compliance</td><td style="padding:2px 0;font-weight:600;">6 / 10</td></tr>',
    '<tr><td style="padding:2px 0;color:#64748b;font-size:13px;">AI Readiness</td><td style="padding:2px 0;font-weight:600;">8 / 10</td></tr>',
  ].join(""),
};

function toFallbackLabel(varName: string): string {
  return `[${varName.replace(/([A-Z])/g, "_$1").toUpperCase()}]`;
}

function fillSampleData(
  html: string,
  subject: string,
  variables: Array<{ name: string; description: string }>,
): { filledHtml: string; filledSubject: string } {
  let filledHtml = html;
  let filledSubject = subject;
  for (const v of variables) {
    const placeholder = new RegExp(`\\{\\{${v.name}\\}\\}`, "g");
    const value = SAMPLE_DATA[v.name] ?? toFallbackLabel(v.name);
    filledHtml = filledHtml.replace(placeholder, value);
    filledSubject = filledSubject.replace(placeholder, value);
  }
  return { filledHtml, filledSubject };
}

function PreviewPane({
  bodyHtml,
  subject,
  isSample,
  wrapperHtml,
}: {
  bodyHtml: string;
  subject: string;
  isSample?: boolean;
  wrapperHtml: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const html = wrapperHtml.includes("{{body}}")
      ? wrapperHtml.replace("{{body}}", () => bodyHtml)
      : `${wrapperHtml}${bodyHtml}`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    frame.src = url;
    return () => URL.revokeObjectURL(url);
  }, [bodyHtml, wrapperHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 bg-card border-b text-xs text-muted-foreground font-medium flex items-center gap-2">
        <span className="shrink-0">Subject preview:</span>
        <span className="text-foreground truncate flex-1">{subject || "(no subject)"}</span>
        {isSample && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Sample data
          </span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className="flex-1 w-full border-0"
        title="Email preview"
      />
    </div>
  );
}

function RecipientBadge({ type }: { type: "client" | "admin" }) {
  if (type === "admin") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-blue-400 border border-primary/20 shrink-0">
      Client
    </span>
  );
}

type AiMode = "generate" | "edit";

function AiModal({
  onClose,
  onGenerate,
  hasExistingContent,
}: {
  onClose: () => void;
  onGenerate: (instructions: string, mode: AiMode) => Promise<void>;
  hasExistingContent: boolean;
}) {
  const [mode, setMode] = useState<AiMode>(hasExistingContent ? "edit" : "generate");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      await onGenerate(instructions, mode);
    } finally {
      setLoading(false);
    }
  }

  const isEdit = mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">✨ AI Assistant</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEdit ? "AI will refine the existing body based on your instructions" : "AI will write a fresh on-brand email body"}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode toggle — only shown when there's existing content to edit */}
        {hasExistingContent && (
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            <button
              onClick={() => setMode("edit")}
              disabled={loading}
              className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors ${
                isEdit ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              ✏️ Edit existing
            </button>
            <button
              onClick={() => setMode("generate")}
              disabled={loading}
              className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-l border-border ${
                !isEdit ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              ✨ Generate fresh
            </button>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-foreground/90 mb-1.5 uppercase tracking-wide">
            {isEdit ? "What to change" : "Instructions"} — {isEdit ? "required" : "optional"}
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={
              isEdit
                ? "e.g. make the tone warmer, add a PS about the retainer discount, shorten the opening paragraph…"
                : "e.g. make it concise, add urgency, include a note about onboarding timeline…"
            }
            rows={4}
            disabled={loading}
            autoFocus
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
          {isEdit && !instructions.trim() && (
            <p className="text-[11px] text-amber-600 mt-1">Tell the AI what to change — otherwise it will rewrite the whole email.</p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={() => { void handleGenerate(); }}
            disabled={loading}
            className="flex-1 bg-primary hover:bg-primary/90 text-white"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                {isEdit ? "Editing…" : "Generating…"}
              </span>
            ) : (
              isEdit ? "✏️ Apply edits" : "✨ Generate"
            )}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EmailTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("preview");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [showAiModal, setShowAiModal] = useState(false);
  const [preAiBody, setPreAiBody] = useState<string | null>(null);

  const { data: templates = [], isLoading: listLoading } = useQuery<TemplateListItem[]>({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/admin/email-templates`);
      if (!r.ok) throw new Error("Failed to load templates");
      return r.json() as Promise<TemplateListItem[]>;
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<TemplateDetail>({
    queryKey: ["email-template", selected],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/admin/email-templates/${selected}`);
      if (!r.ok) throw new Error("Failed to load template");
      return r.json() as Promise<TemplateDetail>;
    },
    enabled: !!selected,
  });

  // Real branded-layout wrapper — used in preview so it matches the actual
  // email that gets sent. Falls back to a hardcoded wrapper if unavailable.
  const { data: brandedLayout } = useQuery<TemplateDetail>({
    queryKey: ["email-template", "branded-layout"],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/admin/email-templates/branded-layout`);
      if (!r.ok) throw new Error("Failed to load branded layout");
      return r.json() as Promise<TemplateDetail>;
    },
    staleTime: 30_000,
  });
  // When editing the branded-layout template itself, preview it directly as
  // the wrapper (with a sample body dropped into its {{body}} slot) instead
  // of wrapping it inside itself.
  const wrapperHtml = selected === "branded-layout"
    ? editBody
    : (brandedLayout?.bodyHtml ?? FALLBACK_WRAPPER);

  useEffect(() => {
    if (detail) {
      setEditSubject(detail.subject);
      setEditBody(detail.bodyHtml);
      setDirty(false);
      setPreAiBody(null);
    }
  }, [detail]);

  const handleSelect = useCallback((slug: string) => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setSelected(slug);
    setDirty(false);
    setActiveTab("preview");
    setPreAiBody(null);
  }, [dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetchWithAuth(`/api/admin/email-templates/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: editSubject, bodyHtml: editBody }),
      });
      if (!r.ok) throw new Error((await r.json() as { error?: string }).error ?? "Save failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Template saved", description: "Changes will take effect on the next email send." });
      setDirty(false);
      setPreAiBody(null);
      void qc.invalidateQueries({ queryKey: ["email-templates"] });
      void qc.invalidateQueries({ queryKey: ["email-template", selected] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const r = await fetchWithAuth(`/api/admin/email-templates/${selected}/test`, {
        method: "POST",
      });
      if (!r.ok) throw new Error((await r.json() as { error?: string }).error ?? "Send failed");
      return r.json() as Promise<{ sentTo: string }>;
    },
    onSuccess: (d) => {
      toast({ title: "Test email sent", description: `Sent to ${d.sentTo}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send test", description: err.message, variant: "destructive" });
    },
  });

  async function handleAiGenerate(instructions: string, mode: AiMode) {
    if (!selected) return;
    const payload: Record<string, string> = { instructions };
    if (mode === "edit" && editBody.trim()) payload.currentBodyHtml = editBody;
    const r = await fetchWithAuth(`/api/admin/email-templates/${selected}/ai-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = (await r.json() as { error?: string }).error ?? "AI generation failed";
      toast({ title: "AI generation failed", description: err, variant: "destructive" });
      return;
    }
    const { bodyHtml } = await r.json() as { bodyHtml: string };
    setPreAiBody(editBody);
    setEditBody(bodyHtml);
    setDirty(true);
    setShowAiModal(false);
    toast({ title: "AI draft inserted", description: "Review it, then press Save when you're happy." });
  }

  function handleDiscardAiDraft() {
    if (preAiBody !== null) {
      setEditBody(preAiBody);
      setPreAiBody(null);
      setDirty(true);
    }
  }

  const filteredTemplates = templates.filter((t) =>
    filterType === "all" ? true : t.recipientType === filterType,
  );

  return (
    <>
      {showAiModal && (
        <AiModal
          onClose={() => setShowAiModal(false)}
          onGenerate={handleAiGenerate}
          hasExistingContent={!!editBody.trim()}
        />
      )}

      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-64px)] overflow-hidden">
        {/* ── Template list ───────────────────────────────────────────────────── */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 border-r-0 lg:border-r bg-card flex flex-col overflow-hidden max-h-64 lg:max-h-none">
          <div className="px-4 py-3 border-b">
            <h1 className="text-sm font-semibold text-foreground">Email Templates</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{filteredTemplates.length} of {templates.length} templates</p>
          </div>

          {/* ── Filter control ──────────────────────────────────────────────── */}
          <div className="px-3 py-2 border-b bg-card">
            <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
              {(["all", "client", "admin"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={`flex-1 py-1 capitalize transition-colors ${
                    filterType === f
                      ? "bg-primary text-white"
                      : "bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {f === "all" ? "All" : f === "client" ? "Client" : "Admin"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="flex items-center justify-center h-24">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredTemplates.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-4">No templates match this filter</p>
            ) : (
              filteredTemplates.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => handleSelect(t.slug)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-primary/10 transition-colors ${
                    selected === t.slug ? "bg-primary/10 border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <p className={`text-sm font-medium flex-1 min-w-0 truncate ${selected === t.slug ? "text-primary" : "text-foreground"}`}>
                      {t.name}
                    </p>
                    <RecipientBadge type={t.recipientType} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.subject}</p>
                  <p className="text-xs text-muted-foreground mt-1">{relativeTime(t.updatedAt)}</p>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── Editor + preview ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-muted-foreground">Select a template to edit</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : detail ? (
            <>
              {/* ── Top bar ──────────────────────────────────────────────────────── */}
              <div className="shrink-0 bg-card border-b px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground truncate">{detail.name}</h2>
                    <RecipientBadge type={detail.recipientType} />
                    {dirty && <Badge variant="secondary" className="text-xs shrink-0">Unsaved</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{detail.slug}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAiModal(true)}
                    className="gap-1.5"
                  >
                    ✨ Generate with AI
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending || dirty}
                    title={dirty ? "Save first before sending a test" : "Send test to admin email"}
                  >
                    {testMutation.isPending ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        Sending…
                      </span>
                    ) : "Send Test"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !dirty}
                  >
                    {saveMutation.isPending ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        Saving…
                      </span>
                    ) : "Save"}
                  </Button>
                </div>
              </div>

              {/* ── Tab switcher ─────────────────────────────────────────────────── */}
              <div className="shrink-0 bg-card border-b px-4 flex gap-1">
                <button
                  onClick={() => setActiveTab("preview")}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "preview"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground/90"
                  }`}
                >
                  Preview
                </button>
                <button
                  onClick={() => setActiveTab("editor")}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "editor"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground/90"
                  }`}
                >
                  Editor
                </button>
              </div>

              {activeTab === "editor" ? (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {/* Subject line */}
                  <div>
                    <label className="block text-xs font-semibold text-foreground/90 mb-1.5 uppercase tracking-wide">
                      Subject Line
                    </label>
                    <Input
                      value={editSubject}
                      onChange={(e) => { setEditSubject(e.target.value); setDirty(true); }}
                      placeholder="Email subject…"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* Body HTML */}
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-foreground/90 uppercase tracking-wide">
                        Body HTML
                      </label>
                      {preAiBody !== null && (
                        <button
                          onClick={handleDiscardAiDraft}
                          className="text-xs text-red-500 hover:text-red-400 underline underline-offset-2 transition-colors"
                        >
                          Discard AI draft
                        </button>
                      )}
                    </div>
                    <textarea
                      value={editBody}
                      onChange={(e) => { setEditBody(e.target.value); setDirty(true); }}
                      className="flex-1 font-mono text-xs rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[320px]"
                      spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Inner HTML only — the branded header/footer wrapper is added automatically at send time. Use <code className="bg-accent px-1 rounded">{"{{variableName}}"}</code> syntax for placeholders.
                    </p>
                  </div>

                  {/* Variables reference */}
                  {detail.variables.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wide">
                        Available Variables
                      </p>
                      <div className="bg-card rounded-md border divide-y">
                        {detail.variables.map((v) => (
                          <div key={v.name} className="flex items-start gap-3 px-3 py-2">
                            <code className="text-xs bg-primary/10 text-blue-400 px-1.5 py-0.5 rounded font-mono shrink-0">
                              {`{{${v.name}}}`}
                            </code>
                            <span className="text-xs text-muted-foreground pt-0.5">{v.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (() => {
                const isBrandedLayout = selected === "branded-layout";
                const { filledHtml, filledSubject } = fillSampleData(
                  isBrandedLayout ? SAMPLE_BODY_FOR_LAYOUT_PREVIEW : editBody,
                  editSubject,
                  detail.variables,
                );
                return (
                  <div className="flex-1 overflow-hidden">
                    <PreviewPane bodyHtml={filledHtml} subject={filledSubject} wrapperHtml={wrapperHtml} isSample />
                  </div>
                );
              })()}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
