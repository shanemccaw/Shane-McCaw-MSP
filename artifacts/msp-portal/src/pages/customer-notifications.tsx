import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Webhook,
  Info,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
} from "lucide-react";

type AlertState = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert, onDismiss }: { alert: AlertState; onDismiss?: () => void }) {
  if (!alert) return null;
  const isSuccess = alert.type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
      isSuccess
        ? "bg-green-50 border-green-200 text-green-800"
        : "bg-red-50 border-red-200 text-red-700"
    }`}>
      {isSuccess
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
        : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      }
      <span className="flex-1">{alert.message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="flex-shrink-0 opacity-60 hover:opacity-100">
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Human-readable labels/descriptions for the bell's category taxonomy
// (canonical list fetched from GET /api/notifications/category-styles).
const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
  fulfillment: { label: "Fulfillment", description: "Work items and deliverables completed for you" },
  payment:     { label: "Payment", description: "Invoices, charges, and payment confirmations" },
  security:    { label: "Security", description: "Security findings and alerts from your monitoring" },
  ai:          { label: "AI Insights", description: "AI-generated analysis and recommendations" },
  sow:         { label: "Statements of Work", description: "SOW updates, approvals, and signatures" },
  signal:      { label: "Signals", description: "Monitoring signals detected on your environment" },
  message:     { label: "Messages", description: "New messages from your account team" },
  system:      { label: "System", description: "General platform and account notices" },
  lead:        { label: "Leads", description: "New lead activity related to your account" },
  dunning:     { label: "Billing Reminders", description: "Past-due or upcoming payment reminders" },
  consent:     { label: "Consent", description: "Changes to Microsoft 365 tenant consent status" },
  automation:  { label: "Automation", description: "Automated workflow runs on your behalf" },
  project:     { label: "Projects", description: "Project status and milestone updates" },
  onboarding:  { label: "Onboarding", description: "Setup and onboarding progress updates" },
  offer:       { label: "Offers", description: "Remediation and service offers for you" },
};

interface Preference {
  category: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

interface WebhookRow {
  webhookId: string;
  label: string;
  url: string;
  isActive: boolean;
}

function CategoryPreferencesCard() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/notification-preferences");
        const data = await res.json() as { preferences?: Preference[] };
        setPreferences(data.preferences ?? []);
      } catch {
        setAlert({ type: "error", message: "Failed to load notification preferences." });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLocal = (category: string, patch: Partial<Preference>) => {
    setPreferences((prev) => prev.map((p) => (p.category === category ? { ...p, ...patch } : p)));
    setDirty((prev) => new Set(prev).add(category));
  };

  const handleSave = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    setAlert(null);
    try {
      const toSave = preferences.filter((p) => dirty.has(p.category));
      const res = await fetchWithAuth("/api/portal/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: toSave }),
      });
      if (!res.ok) throw new Error("Save failed");
      setDirty(new Set());
      setAlert({ type: "success", message: "Notification preferences saved." });
    } catch {
      setAlert({ type: "error", message: "Failed to save preferences. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Notification Categories</p>
            <p className="text-xs text-muted-foreground">Choose what reaches you, and whether it also goes to email</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} onDismiss={() => setAlert(null)} />
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {preferences.map((pref) => {
              const info = CATEGORY_INFO[pref.category] ?? { label: pref.category, description: "" };
              return (
                <div key={pref.category} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{info.label}</p>
                    {info.description && <p className="text-xs text-muted-foreground">{info.description}</p>}
                  </div>
                  <div className="flex items-center gap-5 flex-shrink-0">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Notify</span>
                      <Switch
                        checked={pref.inAppEnabled}
                        onCheckedChange={(checked) => updateLocal(pref.category, {
                          inAppEnabled: checked,
                          emailEnabled: checked ? pref.emailEnabled : false,
                        })}
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Email</span>
                      <Switch
                        checked={pref.emailEnabled}
                        disabled={!pref.inAppEnabled}
                        onCheckedChange={(checked) => updateLocal(pref.category, { emailEnabled: checked })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving || dirty.size === 0} size="sm">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookCard() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const [webhook, setWebhook] = useState<WebhookRow | null>(null);
  const [url, setUrl] = useState("");

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/portal/webhooks");
      const data = await res.json() as { webhooks?: WebhookRow[] };
      const existing = (data.webhooks ?? [])[0] ?? null;
      setWebhook(existing);
      setUrl(existing?.url ?? "");
    } catch {
      setAlert({ type: "error", message: "Failed to load webhook settings." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      if (!url.trim()) {
        setAlert({ type: "error", message: "Enter a webhook URL first." });
        return;
      }
      if (webhook) {
        const res = await fetchWithAuth(`/api/portal/webhooks/${webhook.webhookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), isActive: true }),
        });
        if (!res.ok) throw new Error("Update failed");
      } else {
        const res = await fetchWithAuth("/api/portal/webhooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "Notification Preferences Webhook", url: url.trim(), eventTypes: [] }),
        });
        if (!res.ok) throw new Error("Create failed");
      }
      await load();
      setAlert({ type: "success", message: "Webhook saved. It will receive all notification events you have enabled above." });
    } catch {
      setAlert({ type: "error", message: "Failed to save webhook. Check the URL and try again." });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!webhook) return;
    setSaving(true);
    setAlert(null);
    try {
      await fetchWithAuth(`/api/portal/webhooks/${webhook.webhookId}`, { method: "DELETE" });
      setWebhook(null);
      setUrl("");
      setAlert({ type: "success", message: "Webhook removed." });
    } catch {
      setAlert({ type: "error", message: "Failed to remove webhook." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Webhook className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Webhook (Teams / Slack)</p>
            <p className="text-xs text-muted-foreground">Send notifications to a Teams or Slack channel via an incoming webhook URL</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} onDismiss={() => setAlert(null)} />
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              Paste a Teams or Slack incoming-webhook URL (or any other webhook consumer). Every notification you have
              enabled above will also be POSTed there, signed so you can verify it came from us.
            </p>
            <div className="space-y-2 mb-4">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => void handleSave()} disabled={saving} size="sm">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {webhook ? "Update Webhook" : "Save Webhook"}
              </Button>
              {webhook && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => void handleRemove()}
                  disabled={saving}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove
                </Button>
              )}
              {webhook && (
                <Badge variant="outline" className="ml-auto">
                  {webhook.isActive ? "Active" : "Inactive"}
                </Badge>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerNotificationsPage() {
  return (
    <AppShell title="Notification Preferences">
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Notification Preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control what you hear from us, and where.
          </p>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">These settings control delivery, not detection</p>
              <p className="text-muted-foreground">
                Turning a category off stops it from reaching you — it does not change the thresholds or escalation
                rules your provider has configured for your monitoring.
              </p>
            </div>
          </div>
        </div>

        <CategoryPreferencesCard />
        <WebhookCard />
      </div>
    </AppShell>
  );
}
