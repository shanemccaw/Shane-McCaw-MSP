/**
 * Connector & Exchange Online settings sub-page.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Check, Globe, Loader2, Save, ShieldAlert, Trash2, Zap } from "lucide-react";
import { Link } from "wouter";

interface ConnectorConfig {
  connectorMode: "agent" | "api_key" | "delegated";
  exchangeOnlineEnabled: boolean;
  exchangeOnlineTenantId: string | null;
  hasExchangeClientId: boolean;
  hasExchangeClientSecret: boolean;
  auditLoggingEnabled: boolean;
  updatedAt: string | null;
}

const CONNECTOR_MODES = [
  {
    id: "delegated" as const,
    label: "Delegated (Recommended)",
    description: "Customers grant consent via Microsoft's standard OAuth flow. No credentials stored.",
  },
  {
    id: "agent" as const,
    label: "Agent Mode",
    description: "A local agent in the customer's tenant runs scans and pushes results via signed webhook.",
  },
  {
    id: "api_key" as const,
    label: "API Key",
    description: "Customer provides an API key for a service account. Key stored in Key Vault.",
  },
];

export default function SettingsConnectorPage() {
  const { fetchWithAuth } = useAuth();
  const [config, setConfig] = useState<ConnectorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingExchange, setSavingExchange] = useState(false);
  const [removingExchange, setRemovingExchange] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"agent" | "api_key" | "delegated">("delegated");
  const [exoForm, setExoForm] = useState({ tenantId: "", clientId: "", clientSecret: "" });
  const [exoFormVisible, setExoFormVisible] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/msp/settings/connector")
      .then((r) => r.json())
      .then((data: ConnectorConfig) => {
        setConfig(data);
        setSelectedMode(data.connectorMode);
      })
      .catch(() => toast.error("Failed to load connector config"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  async function handleSaveMode() {
    setSavingMode(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorMode: selectedMode }),
      });
      if (res.ok) {
        toast.success("Connector mode updated");
        setConfig((c) => c ? { ...c, connectorMode: selectedMode } : c);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Update failed");
      }
    } finally {
      setSavingMode(false);
    }
  }

  async function handleSaveExchange(e: React.FormEvent) {
    e.preventDefault();
    if (!exoForm.tenantId || !exoForm.clientId || !exoForm.clientSecret) {
      toast.error("All Exchange Online fields are required");
      return;
    }
    setSavingExchange(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector/exchange", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exoForm),
      });
      if (res.ok) {
        toast.success("Exchange Online credentials saved securely");
        setConfig((c) => c ? { ...c, exchangeOnlineEnabled: true, exchangeOnlineTenantId: exoForm.tenantId, hasExchangeClientId: true, hasExchangeClientSecret: true } : c);
        setExoFormVisible(false);
        setExoForm({ tenantId: "", clientId: "", clientSecret: "" });
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Save failed");
      }
    } finally {
      setSavingExchange(false);
    }
  }

  async function handleRemoveExchange() {
    if (!confirm("Remove Exchange Online credentials? This will disable EXO integration for this MSP.")) return;
    setRemovingExchange(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector/exchange", { method: "DELETE" });
      if (res.ok) {
        toast.success("Exchange Online credentials removed");
        setConfig((c) => c ? { ...c, exchangeOnlineEnabled: false, exchangeOnlineTenantId: null, hasExchangeClientId: false, hasExchangeClientSecret: false } : c);
      } else {
        toast.error("Remove failed");
      }
    } finally {
      setRemovingExchange(false);
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

  if (loading) {
    return (
      <AppShell title="Connector Settings" actions={actions}>
        <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Connector Settings" actions={actions}>
      <div className="p-6 max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <Zap className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Connector Settings</h2>
            <p className="text-sm text-muted-foreground">
              Choose how the MSP platform connects to customer tenants.
            </p>
          </div>
        </div>

        {/* Connector Mode */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Connector Mode</CardTitle>
            <CardDescription className="text-xs">
              Determines the integration method for all customer tenants in this MSP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {CONNECTOR_MODES.map((mode) => (
              <div
                key={mode.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  selectedMode === mode.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                }`}
                onClick={() => setSelectedMode(mode.id)}
              >
                <div className={`mt-0.5 size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selectedMode === mode.id ? "border-primary" : "border-muted-foreground"
                }`}>
                  {selectedMode === mode.id && <div className="size-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
                </div>
                {config?.connectorMode === mode.id && (
                  <Badge variant="outline" className="ml-auto text-[10px] shrink-0">Current</Badge>
                )}
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => void handleSaveMode()}
                disabled={savingMode || selectedMode === config?.connectorMode}
                className="gap-1.5"
              >
                {savingMode ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save Mode
              </Button>
            </div>
          </CardContent>
        </Card>

        <Separator />

        {/* Exchange Online */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              Exchange Online Integration
            </CardTitle>
            <CardDescription className="text-xs">
              Connect to Exchange Online for mailbox monitoring. Credentials are stored in Azure Key Vault — never in the database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {config?.exchangeOnlineEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="size-4" />
                  Exchange Online connected
                </div>
                {config.exchangeOnlineTenantId && (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                    Tenant ID: {config.exchangeOnlineTenantId}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="size-3.5" />
                  Credentials are stored in Key Vault and cannot be read back.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setExoFormVisible((v) => !v)}
                  >
                    Update Credentials
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    disabled={removingExchange}
                    onClick={() => void handleRemoveExchange()}
                  >
                    {removingExchange ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Exchange Online is not connected.</p>
                <Button size="sm" variant="outline" onClick={() => setExoFormVisible((v) => !v)}>
                  Configure
                </Button>
              </div>
            )}

            {exoFormVisible && (
              <form onSubmit={(e) => void handleSaveExchange(e)} className="space-y-3 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground font-medium">Enter Exchange Online App Registration credentials:</p>
                <div className="space-y-1.5">
                  <Label htmlFor="exo-tenant" className="text-xs">Tenant ID (UUID)</Label>
                  <Input
                    id="exo-tenant"
                    value={exoForm.tenantId}
                    onChange={(e) => setExoForm((f) => ({ ...f, tenantId: e.target.value }))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="h-8 text-sm font-mono"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exo-client-id" className="text-xs">Client ID</Label>
                  <Input
                    id="exo-client-id"
                    value={exoForm.clientId}
                    onChange={(e) => setExoForm((f) => ({ ...f, clientId: e.target.value }))}
                    placeholder="Application (client) ID from Azure AD"
                    className="h-8 text-sm"
                    required
                    minLength={10}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exo-secret" className="text-xs">Client Secret</Label>
                  <Input
                    id="exo-secret"
                    type="password"
                    value={exoForm.clientSecret}
                    onChange={(e) => setExoForm((f) => ({ ...f, clientSecret: e.target.value }))}
                    placeholder="App registration client secret value"
                    className="h-8 text-sm"
                    required
                    minLength={10}
                    autoComplete="new-password"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Stored immediately in Azure Key Vault. Not retained in this application.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={savingExchange} className="gap-1.5">
                    {savingExchange ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Save to Key Vault
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setExoFormVisible(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
