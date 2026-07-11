/**
 * Email Template Customisation settings sub-page.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Check, Lock, Mail, RefreshCw, Save, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface EmailTemplate {
  key: string;
  subject: string;
  body: string;
  isCustomised: boolean;
  isLocked: boolean;
  requiredMergeFields: string[];
  updatedAt: string | null;
}

const KEY_LABELS: Record<string, string> = {
  onboarding_welcome: "Onboarding Welcome",
  monitoring_complete: "Monitoring Complete",
  offer_available: "Offer Available",
  report_ready: "Report Ready",
  invoice_due_reminder: "Invoice Due Reminder",
  password_reset: "Password Reset (Locked)",
  mfa_code: "MFA Code (Locked)",
  consent_revoked: "Consent Revoked (Locked)",
};

export default function SettingsEmailTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/email-templates");
      if (res.ok) {
        const data = (await res.json()) as EmailTemplate[];
        setTemplates(data);
        if (!selectedKey && data.length > 0) {
          const first = data.find((t) => !t.isLocked);
          if (first) setSelectedKey(first.key);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, selectedKey]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const selected = templates.find((t) => t.key === selectedKey);

  useEffect(() => {
    if (selected) {
      setForm({ subject: selected.subject, body: selected.body });
    }
  }, [selectedKey, selected?.subject, selected?.body]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedKey) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/email-templates/${selectedKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: form.subject, body: form.body }),
      });
      if (res.ok) {
        toast.success("Template saved");
        await loadTemplates();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedKey || !selected?.isCustomised) return;
    if (!confirm("Reset to platform default? Your customisation will be removed.")) return;
    setResetting(true);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/email-templates/${selectedKey}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Reset to default");
        await loadTemplates();
      } else {
        toast.error("Reset failed");
      }
    } finally {
      setResetting(false);
    }
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  return (
    <AppShell title="Email Templates" actions={actions}>
      <div className="p-6 max-w-5xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-md bg-muted/60 p-2">
            <Mail className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Email Templates</h2>
            <p className="text-sm text-muted-foreground">
              Customise the emails sent to your customers. Platform security emails are locked.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-[200px_1fr] gap-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-[220px_1fr] gap-4">
            {/* Template list */}
            <div className="space-y-1">
              {templates.map((t) => (
                <button
                  key={t.key}
                  className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                    selectedKey === t.key
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted/40 text-muted-foreground"
                  }`}
                  onClick={() => setSelectedKey(t.key)}
                >
                  <span className="truncate">{KEY_LABELS[t.key] ?? t.key}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {t.isLocked && <Lock className="size-3 text-muted-foreground" />}
                    {t.isCustomised && !t.isLocked && <Check className="size-3 text-green-500" />}
                  </div>
                </button>
              ))}
            </div>

            {/* Editor */}
            {selected ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {KEY_LABELS[selected.key] ?? selected.key}
                    {selected.isLocked && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Lock className="size-3" /> Platform Locked
                      </Badge>
                    )}
                    {selected.isCustomised && !selected.isLocked && (
                      <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">Customised</Badge>
                    )}
                  </CardTitle>
                  {selected.requiredMergeFields.length > 0 && (
                    <CardDescription className="text-xs">
                      Required merge fields:{" "}
                      {selected.requiredMergeFields.map((f) => (
                        <code key={f} className="text-[10px] bg-muted px-1 py-0.5 rounded mr-1">{f}</code>
                      ))}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {selected.isLocked ? (
                    <div className="space-y-3">
                      <div className="rounded-md bg-muted/40 px-3 py-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
                        <p className="text-sm">{selected.subject}</p>
                      </div>
                      <div className="rounded-md bg-muted/40 px-3 py-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
                        <pre className="text-xs whitespace-pre-wrap">{selected.body}</pre>
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Lock className="size-3" />
                        This template is managed by the platform and cannot be customised.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="tpl-subject" className="text-xs">Subject *</Label>
                        <Input
                          id="tpl-subject"
                          value={form.subject}
                          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                          placeholder="Email subject line"
                          required
                          minLength={5}
                          maxLength={300}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tpl-body" className="text-xs">Body *</Label>
                        <Textarea
                          id="tpl-body"
                          value={form.body}
                          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                          placeholder={`Hi {{customerName}},\n\nYour report is ready…`}
                          required
                          minLength={20}
                          rows={10}
                          className="text-sm font-mono resize-y"
                        />
                      </div>
                      {selected.updatedAt && (
                        <p className="text-[11px] text-muted-foreground">
                          Last updated: {new Date(selected.updatedAt).toLocaleString()}
                        </p>
                      )}
                      <div className="flex items-center gap-2 justify-end">
                        {selected.isCustomised && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-muted-foreground"
                            disabled={resetting}
                            onClick={() => void handleReset()}
                          >
                            {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            Reset to Default
                          </Button>
                        )}
                        <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                          Save Template
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
                  Select a template to edit
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
