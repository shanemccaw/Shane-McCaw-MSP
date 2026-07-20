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
import {
  ArrowLeft,
  Check,
  Globe,
  Loader2,
  Save,
  ShieldAlert,
  Trash2,
  Zap,
  Mail,
  ExternalLink,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Link, useLocation } from "wouter";

interface ConnectorConfig {
  connectorMode: "agent" | "api_key" | "delegated";
  exchangeOnlineEnabled: boolean;
  exchangeOnlineTenantId: string | null;
  hasExchangeClientId: boolean;
  hasExchangeClientSecret: boolean;
  auditLoggingEnabled: boolean;
  updatedAt: string | null;
}

interface MailboxConnector {
  connectorId: string;
  tenantId: string;
  mailboxUpn: string;
  fromDisplayName: string;
  isActive: boolean;
  consentedAt: string | null;
  revokedAt: string | null;
  updatedAt: string | null;
}

interface MailboxConnectorStatus {
  connected: boolean;
  mtAppConfigured: boolean;
  connector: MailboxConnector | null;
  automatedCustomerEmailsEnabled: boolean;
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
  const [location] = useLocation();
  const [config, setConfig] = useState<ConnectorConfig | null>(null);
  const [mailboxStatus, setMailboxStatus] = useState<MailboxConnectorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingExchange, setSavingExchange] = useState(false);
  const [removingExchange, setRemovingExchange] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"agent" | "api_key" | "delegated">("delegated");
  const [exoForm, setExoForm] = useState({ tenantId: "", clientId: "", clientSecret: "" });
  const [exoFormVisible, setExoFormVisible] = useState(false);
  const [mailboxForm, setMailboxForm] = useState({ mailboxUpn: "", fromDisplayName: "" });
  const [mailboxFormVisible, setMailboxFormVisible] = useState(false);
  const [connectingMailbox, setConnectingMailbox] = useState(false);
  const [disconnectingMailbox, setDisconnectingMailbox] = useState(false);
  const [savingAutomatedEmails, setSavingAutomatedEmails] = useState(false);

  // Show toast for OAuth callback result in URL params
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const consentResult = params.get("mailbox_consent");
    if (consentResult === "success") {
      toast.success("Exchange Online mailbox connected — outbound email will now route through your tenant.");
      setMailboxStatus((s) => s ? { ...s, connected: true } : s);
    } else if (consentResult === "declined") {
      toast.error("Admin consent was declined. You can try again when ready.");
    }
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWithAuth("/api/msp/settings/connector").then((r) => r.json()) as Promise<ConnectorConfig>,
      fetchWithAuth("/api/msp/settings/connector/mailbox").then((r) => r.json()) as Promise<MailboxConnectorStatus>,
    ])
      .then(([connectorData, mailboxData]) => {
        if (cancelled) return;
        setConfig(connectorData);
        setSelectedMode(connectorData.connectorMode);
        setMailboxStatus(mailboxData);
      })
      .catch(() => toast.error("Failed to load connector settings"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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

  async function handleConnectMailbox(e: React.FormEvent) {
    e.preventDefault();
    if (!mailboxForm.mailboxUpn || !mailboxForm.fromDisplayName) {
      toast.error("Both fields are required");
      return;
    }
    setConnectingMailbox(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector/mailbox/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxUpn: mailboxForm.mailboxUpn,
          fromDisplayName: mailboxForm.fromDisplayName,
          returnPath: "/settings/connector",
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to initiate OAuth flow");
        return;
      }
      const data = (await res.json()) as { consentUrl: string };
      // Open the Microsoft admin-consent page in a new tab
      window.open(data.consentUrl, "_blank", "noopener,noreferrer");
      toast.info("Opened Microsoft admin-consent in a new tab. After consenting, return to this page.");
      setMailboxFormVisible(false);
      setMailboxForm({ mailboxUpn: "", fromDisplayName: "" });
    } finally {
      setConnectingMailbox(false);
    }
  }

  async function handleDisconnectMailbox() {
    if (!confirm("Disconnect this Exchange Online mailbox? Emails will fall back to the platform mailbox with your business name as the sender display name.")) return;
    setDisconnectingMailbox(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector/mailbox", { method: "DELETE" });
      if (res.ok) {
        toast.success("Mailbox connector disconnected");
        setMailboxStatus((s) => s ? { ...s, connected: false, connector: s.connector ? { ...s.connector, isActive: false } : null } : s);
      } else {
        toast.error("Failed to disconnect mailbox");
      }
    } finally {
      setDisconnectingMailbox(false);
    }
  }

  async function handleToggleAutomatedEmails(enabled: boolean) {
    setSavingAutomatedEmails(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/connector/mailbox/automated-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const data = (await res.json()) as { automatedCustomerEmailsEnabled: boolean };
        toast.success(data.automatedCustomerEmailsEnabled ? "Automated customer emails enabled" : "Automated customer emails disabled");
        setMailboxStatus((s) => s ? { ...s, automatedCustomerEmailsEnabled: data.automatedCustomerEmailsEnabled } : s);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Update failed");
      }
    } finally {
      setSavingAutomatedEmails(false);
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

        {/* Outbound Email — MSP Mailbox Connector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" />
              Outbound Email — Exchange Online
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your own Exchange Online mailbox so emails to your customers come from your real domain
              with proper SPF / DKIM / DMARC alignment. Without a connected mailbox, emails are sent via the
              platform mailbox with your business name as the display name.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!mailboxStatus?.mtAppConfigured && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  The platform multi-tenant app credentials are not configured. Contact your platform admin to
                  enable Exchange Online mailbox connections.
                </span>
              </div>
            )}

            {mailboxStatus?.connected && mailboxStatus.connector ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                  <Check className="size-4" />
                  Exchange Online mailbox connected
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2.5 space-y-1.5 text-xs font-mono text-muted-foreground">
                  <div><span className="text-foreground font-semibold">Mailbox:</span> {mailboxStatus.connector.mailboxUpn}</div>
                  <div><span className="text-foreground font-semibold">Display name:</span> {mailboxStatus.connector.fromDisplayName}</div>
                  <div><span className="text-foreground font-semibold">Tenant:</span> {mailboxStatus.connector.tenantId}</div>
                  {mailboxStatus.connector.consentedAt && (
                    <div><span className="text-foreground font-semibold">Connected:</span> {new Date(mailboxStatus.connector.consentedAt).toLocaleDateString()}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="size-3.5" />
                  No credentials stored — uses Microsoft admin consent only.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setMailboxFormVisible((v) => !v)}
                    disabled={!mailboxStatus.mtAppConfigured}
                  >
                    Update Connection
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    disabled={disconnectingMailbox}
                    onClick={() => void handleDisconnectMailbox()}
                  >
                    {disconnectingMailbox ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground">No mailbox connected.</p>
                  <p className="text-xs text-muted-foreground">
                    Emails route via the platform mailbox with your business name as the sender.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMailboxFormVisible((v) => !v)}
                  disabled={!mailboxStatus?.mtAppConfigured}
                >
                  Connect
                </Button>
              </div>
            )}

            {mailboxFormVisible && (
              <form onSubmit={(e) => void handleConnectMailbox(e)} className="space-y-3 border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Enter the mailbox you want to send from. Your tenant admin will be asked to grant
                  <strong> Mail.Send</strong> permission to the platform app.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="mailbox-upn" className="text-xs">Sending mailbox (UPN)</Label>
                  <Input
                    id="mailbox-upn"
                    type="email"
                    value={mailboxForm.mailboxUpn}
                    onChange={(e) => setMailboxForm((f) => ({ ...f, mailboxUpn: e.target.value }))}
                    placeholder="noreply@yourcompany.com"
                    className="h-8 text-sm"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The email address must exist in your Exchange Online tenant.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="display-name" className="text-xs">From display name</Label>
                  <Input
                    id="display-name"
                    value={mailboxForm.fromDisplayName}
                    onChange={(e) => setMailboxForm((f) => ({ ...f, fromDisplayName: e.target.value }))}
                    placeholder="Contoso IT Services"
                    className="h-8 text-sm"
                    required
                    minLength={2}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Shown in the recipient's inbox as the sender name.
                  </p>
                </div>
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <strong>What happens next:</strong> Clicking "Open Consent" will open a Microsoft
                  admin-consent page in a new tab. Your tenant Global Admin must approve the{" "}
                  <strong>Mail.Send</strong> permission. After approval, the mailbox is automatically
                  activated — return to this page to confirm.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={connectingMailbox}
                    className="gap-1.5"
                  >
                    {connectingMailbox ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                    Open Consent
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setMailboxFormVisible(false); setMailboxForm({ mailboxUpn: "", fromDisplayName: "" }); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Automated Customer Emails */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automated customer emails & upsells</CardTitle>
            <CardDescription className="text-xs">
              Allow the platform to send automated notification and upsell emails to your customers
              (e.g. purchase confirmations, offer notifications) through your connected mailbox.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mailboxStatus?.connected ? (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {mailboxStatus.automatedCustomerEmailsEnabled ? "Enabled" : "Disabled"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sent from your connected mailbox ({mailboxStatus.connector?.mailboxUpn}).
                  </p>
                </div>
                <Switch
                  checked={mailboxStatus.automatedCustomerEmailsEnabled}
                  disabled={savingAutomatedEmails}
                  onCheckedChange={(checked) => void handleToggleAutomatedEmails(checked)}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground">
                    Connect an Exchange Online mailbox above to enable automated customer emails.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No customer-facing automated email can be sent until a mailbox is connected.
                  </p>
                </div>
                <Switch checked={false} disabled />
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Exchange Online (monitoring/management credentials) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              Exchange Online Monitoring
            </CardTitle>
            <CardDescription className="text-xs">
              App Registration credentials for mailbox monitoring and management. Credentials are stored in
              Azure Key Vault — never in the database.
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
                <p className="text-sm text-muted-foreground">Exchange Online monitoring is not connected.</p>
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
