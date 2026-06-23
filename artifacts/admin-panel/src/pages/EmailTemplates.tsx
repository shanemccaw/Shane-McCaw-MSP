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
}

interface TemplateDetail {
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  variables: Array<{ name: string; description: string }>;
  updatedAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const PREVIEW_WRAPPER = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    color: #1e293b;
    line-height: 1.6;
  }
  .outer {
    max-width: 600px;
    margin: 24px auto;
    background: #ffffff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,.12);
  }
  .header {
    background: #0A2540;
    padding: 24px 32px;
    text-align: center;
  }
  .header span {
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .header span em {
    color: #0078D4;
    font-style: normal;
  }
  .body {
    padding: 32px;
    color: #1e293b;
    font-size: 15px;
    line-height: 1.7;
  }
  .body a { color: #0078D4; }
  .footer {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    padding: 16px 32px;
    text-align: center;
    font-size: 12px;
    color: #94a3b8;
  }
</style>
</head>
<body>
<div class="outer">
  <div class="header"><span>Shane McCaw <em>Consulting</em></span></div>
  <div class="body">{{BODY}}</div>
  <div class="footer">Shane McCaw Consulting · NASA Lead Microsoft 365 Architect · info@shanemccaw.com</div>
</div>
</body>
</html>
`;

function PreviewPane({ bodyHtml, subject }: { bodyHtml: string; subject: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const html = PREVIEW_WRAPPER.replace("{{BODY}}", bodyHtml);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    frame.src = url;
    return () => URL.revokeObjectURL(url);
  }, [bodyHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 bg-gray-50 border-b text-xs text-gray-500 font-medium flex items-center gap-2">
        <span>Subject preview:</span>
        <span className="text-gray-800 truncate">{subject || "(no subject)"}</span>
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

export default function EmailTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("editor");

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

  useEffect(() => {
    if (detail) {
      setEditSubject(detail.subject);
      setEditBody(detail.bodyHtml);
      setDirty(false);
    }
  }, [detail]);

  const handleSelect = useCallback((slug: string) => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setSelected(slug);
    setDirty(false);
    setActiveTab("editor");
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

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Template list ───────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h1 className="text-sm font-semibold text-gray-900">Email Templates</h1>
          <p className="text-xs text-gray-500 mt-0.5">{templates.length} templates</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.slug}
                onClick={() => handleSelect(t.slug)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-blue-50 transition-colors ${
                  selected === t.slug ? "bg-blue-50 border-l-2 border-l-[#0078D4]" : ""
                }`}
              >
                <p className={`text-sm font-medium truncate ${selected === t.slug ? "text-[#0078D4]" : "text-gray-900"}`}>
                  {t.name}
                </p>
                <p className="text-xs text-gray-500 truncate mt-0.5">{t.subject}</p>
                <p className="text-xs text-gray-400 mt-1">{relativeTime(t.updatedAt)}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Editor + preview ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-gray-500">Select a template to edit</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : detail ? (
          <>
            {/* ── Top bar ──────────────────────────────────────────────────────── */}
            <div className="shrink-0 bg-white border-b px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 truncate">{detail.name}</h2>
                  {dirty && <Badge variant="secondary" className="text-xs shrink-0">Unsaved</Badge>}
                </div>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{detail.slug}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
            <div className="shrink-0 bg-white border-b px-4 flex gap-1">
              <button
                onClick={() => setActiveTab("editor")}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "editor"
                    ? "border-[#0078D4] text-[#0078D4]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setActiveTab("preview")}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "preview"
                    ? "border-[#0078D4] text-[#0078D4]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Preview
              </button>
            </div>

            {activeTab === "editor" ? (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {/* Subject line */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
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
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                    Body HTML
                  </label>
                  <textarea
                    value={editBody}
                    onChange={(e) => { setEditBody(e.target.value); setDirty(true); }}
                    className="flex-1 font-mono text-xs rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[320px]"
                    spellCheck={false}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Inner HTML only — the branded header/footer wrapper is added automatically at send time. Use <code className="bg-gray-100 px-1 rounded">{"{{variableName}}"}</code> syntax for placeholders.
                  </p>
                </div>

                {/* Variables reference */}
                {detail.variables.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                      Available Variables
                    </p>
                    <div className="bg-white rounded-md border divide-y">
                      {detail.variables.map((v) => (
                        <div key={v.name} className="flex items-start gap-3 px-3 py-2">
                          <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono shrink-0">
                            {`{{${v.name}}}`}
                          </code>
                          <span className="text-xs text-gray-600 pt-0.5">{v.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <PreviewPane bodyHtml={editBody} subject={editSubject} />
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
