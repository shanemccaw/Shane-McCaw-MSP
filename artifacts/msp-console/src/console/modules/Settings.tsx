/**
 * Settings — MSP Console module page (Git #2606, Feature #1690). Mounts into
 * the shell's `ScreenSlot` at `/ops/settings` (Operations, MSP-wide —
 * `console/nav.ts`), wiring the real, previously-orphaned surface documented
 * in full at `docs/msp-console/msp-settings-contract-pack.md`: organization
 * profile, connector mode + Exchange Online, outbound MSP mailbox, service
 * accounts (API keys), billing, email templates, the customer agreement
 * template, and this staff member's own notification preferences.
 *
 * **No Claude Design export exists for this screen** (#2605 never landed).
 * Shane authorized building this directly rather than waiting on a design
 * pass (2026-09-15) — see the banner below, which is a real, required part
 * of this build, not decoration.
 *
 * Groups E/F/G/K of the same backend (staff roster, per-staff customer
 * scoping, role/approve-purchases/remove, sessions, invites) are already
 * wired by Staff Roster (`/ops/staff`) and Account Security (`/ops/acctsec`)
 * — deliberately not duplicated here.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  EMAIL_TEMPLATE_KEYS,
  MspSettingsApiError,
  useAgreementTemplate,
  useBilling,
  useConnectMailbox,
  useConnector,
  useCreateBillingPortalSession,
  useCreateServiceAccount,
  useDisconnectMailbox,
  useMailboxStatus,
  useMspProfile,
  useNotificationPreferences,
  useRemoveExchangeCredentials,
  useResetEmailTemplate,
  useRevokeServiceAccount,
  useSetAutomatedEmails,
  useSetExchangeCredentials,
  useSetWriteBack,
  useServiceAccounts,
  useEmailTemplates,
  useUpdateAgreementTemplate,
  useUpdateConnector,
  useUpdateEmailTemplate,
  useUpdateMspProfile,
  useUpdateNotificationPreferences,
  type EmailTemplateKey,
  type NotificationPreference,
} from "@/api/msp-settings-api";

type Tone = { strong: string; text?: string; tint: string; border: string };
type Tab = "profile" | "connector" | "mailbox" | "accounts" | "billing" | "templates" | "agreement" | "notifications";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "profile", label: "Organization", icon: "building" },
  { id: "connector", label: "Connector", icon: "plug" },
  { id: "mailbox", label: "Outbound mailbox", icon: "mail" },
  { id: "accounts", label: "Service accounts", icon: "key-round" },
  { id: "billing", label: "Billing", icon: "receipt" },
  { id: "templates", label: "Email templates", icon: "file-text" },
  { id: "agreement", label: "Agreement template", icon: "signature" },
  { id: "notifications", label: "Notifications", icon: "bell" },
];

function fmt(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof MspSettingsApiError ? err.message : fallback;
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: text.title }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: text.secondary }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: text.faint, textWrap: "pretty" }}>{hint}</span>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${border.card}`,
  background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none", font: "inherit",
};

function Btn({
  label, onClick, pending, tone = "primary", disabled,
}: { label: string; onClick: () => void; pending?: boolean; tone?: "primary" | "danger" | "neutral"; disabled?: boolean }) {
  const styles = tone === "danger"
    ? { border: signal.critical.border, bg: signal.critical.tint, color: signal.critical.strong }
    : tone === "neutral"
      ? { border: border.card, bg: "transparent", color: text.secondary }
      : { border: "#2563eb", bg: "#2563eb", color: "#fff" };
  const off = disabled || pending;
  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
        height: 32, padding: "0 13px", borderRadius: 7, border: `1px solid ${styles.border}`,
        background: off && tone === "primary" ? "rgba(148,163,184,.1)" : styles.bg,
        color: off && tone === "primary" ? text.faint : styles.color,
        fontSize: 12, fontWeight: 600, cursor: off ? "not-allowed" : "pointer", font: "inherit",
      }}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function Toggle({ label, note, on, onChange, pending, dangerWhenOff }: {
  label: string; note?: string; on: boolean; onChange: (v: boolean) => void; pending?: boolean; dangerWhenOff?: boolean;
}) {
  const tone = on ? signal.ok : dangerWhenOff ? signal.critical : signal.neutral;
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 10,
        border: `1px solid ${tone.border}`, background: on ? tone.tint : "rgba(2,6,23,.4)",
        cursor: pending ? "wait" : "pointer", textAlign: "left", width: "100%", minWidth: 0, font: "inherit",
      }}
    >
      <span style={{
        width: 34, height: 19, borderRadius: 999, background: on ? "#2563eb" : "rgba(148,163,184,.25)",
        position: "relative", flex: "0 0 34px", transition: "background .15s",
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: "50%",
          background: "#fff", transition: "left .15s",
        }} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>{label}</span>
        {note && <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{note}</span>}
      </span>
    </button>
  );
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", height: 20, padding: "0 9px", borderRadius: 999,
      background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 10.5, fontWeight: 600,
      color: tone.text ?? tone.strong, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function ErrorPanel({ error }: { error: MspSettingsApiError }) {
  return (
    <div style={{ border: `1px solid ${error.status === 403 ? signal.critical.border : signal.warning.border}`, borderRadius: 10, background: error.status === 403 ? signal.critical.tint : signal.warning.tint, padding: 13, display: "flex", alignItems: "flex-start", gap: 9 }}>
      <Icon name={error.status === 403 ? "shield-alert" : "triangle-alert"} size={15} color={error.status === 403 ? signal.critical.strong : signal.warning.strong} />
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{error.message}</span>
    </div>
  );
}

/** The required, always-visible marker for a screen built without a design
 * pass (Shane's own authorization, 2026-09-15 — see file header). */
function AgentBuiltBanner() {
  return (
    <div style={{
      border: `1px dashed ${signal.notice.border}`, borderRadius: 10, background: signal.notice.tint,
      padding: "9px 13px", display: "flex", alignItems: "center", gap: 9,
    }}>
      <Icon name="triangle-alert" size={14} color={signal.notice.strong} />
      <span style={{ fontSize: 11.5, color: signal.notice.strong, fontWeight: 600 }}>
        Agent-built UI — pending design review
      </span>
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
        No Claude Design export exists for this screen yet. Every control below is real and wired; the layout has not had a design pass.
      </span>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <AgentBuiltBanner />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
              border: `1px solid ${tab === t.id ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`,
              background: tab === t.id ? "rgba(37,99,235,.18)" : "transparent",
              color: tab === t.id ? text.strong : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit", whiteSpace: "nowrap",
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab />}
      {tab === "connector" && <ConnectorTab />}
      {tab === "mailbox" && <MailboxTab />}
      {tab === "accounts" && <ServiceAccountsTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "templates" && <EmailTemplatesTab />}
      {tab === "agreement" && <AgreementTab />}
      {tab === "notifications" && <NotificationsTab />}
    </div>
  );
}

// ── Group A — Organization profile ──────────────────────────────────────────

function ProfileTab() {
  const profileQuery = useMspProfile();
  const updateMutation = useUpdateMspProfile();
  const [name, setName] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);

  const p = profileQuery.data;
  const nameVal = name ?? p?.name ?? "";
  const domainVal = domain ?? p?.domain ?? "";
  const logoVal = logoUrl ?? p?.logoUrl ?? "";
  const colorVal = primaryColor ?? p?.primaryColor ?? "";

  const save = () => {
    updateMutation.mutate(
      {
        name: nameVal.trim() || undefined,
        domain: domainVal.trim() ? domainVal.trim() : null,
        logoUrl: logoVal.trim() ? logoVal.trim() : null,
        primaryColor: colorVal.trim() ? colorVal.trim() : null,
      },
      {
        onSuccess: () => { toast.success("Organization profile saved."); setName(null); setDomain(null); setLogoUrl(null); setPrimaryColor(null); },
        onError: (err) => toast.error(errMessage(err, "Failed to save the profile.")),
      },
    );
  };

  if (profileQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (profileQuery.isError) return <ErrorPanel error={profileQuery.error} />;
  if (!p) return null;

  const statusTone = p.status === "active" ? signal.ok : p.status === "trial" ? signal.info : signal.critical;

  return (
    <Card title="Organization profile" note="White-label branding shown across the console and customer-facing surfaces.">
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Pill label={p.status} tone={statusTone} />
        <span style={{ fontSize: 11, color: text.faint }}>slug: {p.slug}</span>
        {p.trialEndsAt && <span style={{ fontSize: 11, color: text.faint }}>trial ends {fmt(p.trialEndsAt)}</span>}
        <span style={{ fontSize: 11, color: text.faint }}>created {fmt(p.createdAt)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Field label="Organization name">
          <input style={inputStyle} value={nameVal} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Domain" hint="Optional — customer-facing branding only.">
          <input style={inputStyle} value={domainVal} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" />
        </Field>
        <Field label="Logo URL">
          <input style={inputStyle} value={logoVal} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Primary color" hint="Hex, e.g. #2563eb">
          <input style={inputStyle} value={colorVal} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#2563eb" />
        </Field>
      </div>

      <div>
        <Btn label="Save profile" onClick={save} pending={updateMutation.isPending} />
      </div>
    </Card>
  );
}

// ── Group B — Connector + Exchange Online ───────────────────────────────────

function ConnectorTab() {
  const connectorQuery = useConnector();
  const agreementQuery = useAgreementTemplate();
  const updateConnector = useUpdateConnector();
  const setExchange = useSetExchangeCredentials();
  const removeExchange = useRemoveExchangeCredentials();

  const [mode, setMode] = useState<"agent" | "api_key" | "delegated" | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const c = connectorQuery.data;
  const modeVal = mode ?? c?.connectorMode ?? "delegated";

  const saveMode = () => {
    // See msp-settings-api.ts's file header: PUT /connector always writes
    // customerAgreementTemplate, so the caller's current value is sent back
    // through this same call rather than letting the upsert null it out.
    updateConnector.mutate(
      {
        connectorMode: modeVal,
        auditLoggingEnabled: c?.auditLoggingEnabled ?? true,
        customerAgreementTemplate: agreementQuery.data?.template ?? null,
      },
      {
        onSuccess: () => { toast.success("Connector mode saved."); setMode(null); },
        onError: (err) => toast.error(errMessage(err, "Failed to save the connector mode.")),
      },
    );
  };

  const toggleAudit = (enabled: boolean) => {
    updateConnector.mutate(
      { connectorMode: modeVal, auditLoggingEnabled: enabled, customerAgreementTemplate: agreementQuery.data?.template ?? null },
      { onError: (err) => toast.error(errMessage(err, "Failed to update audit logging.")) },
    );
  };

  const saveExchange = () => {
    if (!tenantId.trim() || !clientId.trim() || !clientSecret.trim()) return;
    setExchange.mutate(
      { tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() },
      {
        onSuccess: (data) => {
          toast.success(data.kvStored ? "Exchange Online credentials saved to Key Vault." : "Saved — Key Vault is not configured, so the secret was not persisted.");
          setTenantId(""); setClientId(""); setClientSecret("");
        },
        onError: (err) => toast.error(errMessage(err, "Failed to save Exchange Online credentials.")),
      },
    );
  };

  if (connectorQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (connectorQuery.isError) return <ErrorPanel error={connectorQuery.error} />;
  if (!c) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card title="Connector mode" note="How this MSP's tenants are reached.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["delegated", "agent", "api_key"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                height: 30, padding: "0 12px", borderRadius: 7, border: `1px solid ${modeVal === m ? "rgba(96,165,250,.45)" : border.card}`,
                background: modeVal === m ? "rgba(37,99,235,.18)" : "transparent", color: modeVal === m ? text.strong : text.muted,
                fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit",
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <Toggle
          label="Audit logging"
          note="Records every write this MSP makes against a customer's tenant."
          on={c.auditLoggingEnabled}
          onChange={toggleAudit}
          pending={updateConnector.isPending}
        />
        <div>
          <Btn label="Save connector mode" onClick={saveMode} pending={updateConnector.isPending} disabled={mode == null} />
        </div>
      </Card>

      <Card title="Exchange Online" note="Delegated-mode credentials, stored in Azure Key Vault — never as raw values in this database.">
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Pill label={c.exchangeOnlineEnabled ? "Connected" : "Not connected"} tone={c.exchangeOnlineEnabled ? signal.ok : signal.neutral} />
          {c.exchangeOnlineTenantId && <span style={{ fontSize: 11, color: text.faint, fontFamily: "Menlo, monospace" }}>{c.exchangeOnlineTenantId}</span>}
          <Pill label={c.hasExchangeClientId ? "Client ID on file" : "No client ID"} tone={c.hasExchangeClientId ? signal.ok : signal.neutral} />
          <Pill label={c.hasExchangeClientSecret ? "Secret on file" : "No secret"} tone={c.hasExchangeClientSecret ? signal.ok : signal.neutral} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Tenant ID" hint="Azure AD tenant GUID">
            <input style={inputStyle} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label="Client ID">
            <input style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <Field label="Client secret">
            <input style={inputStyle} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 9 }}>
          <Btn label="Save Exchange credentials" onClick={saveExchange} pending={setExchange.isPending} disabled={!tenantId.trim() || !clientId.trim() || !clientSecret.trim()} />
          {c.exchangeOnlineEnabled && (
            <Btn
              label="Remove"
              tone="danger"
              pending={removeExchange.isPending}
              onClick={() => removeExchange.mutate(undefined, {
                onSuccess: () => toast.success("Exchange Online credentials removed."),
                onError: (err) => toast.error(errMessage(err, "Failed to remove Exchange Online credentials.")),
              })}
            />
          )}
        </div>
        <span style={{ fontSize: 10.5, color: text.faint, textWrap: "pretty" }}>
          Removing unlinks the credential from this MSP; the underlying Key Vault secret is not deleted.
        </span>
      </Card>
    </div>
  );
}

// ── Group C — MSP Mailbox (outbound email) ──────────────────────────────────

function MailboxTab() {
  const statusQuery = useMailboxStatus();
  const connectMutation = useConnectMailbox();
  const disconnectMutation = useDisconnectMailbox();
  const automatedMutation = useSetAutomatedEmails();
  const writeBackMutation = useSetWriteBack();

  const [mailboxUpn, setMailboxUpn] = useState("");
  const [fromDisplayName, setFromDisplayName] = useState("");

  const s = statusQuery.data;

  const connect = () => {
    if (!mailboxUpn.trim() || !fromDisplayName.trim()) return;
    connectMutation.mutate(
      { mailboxUpn: mailboxUpn.trim(), fromDisplayName: fromDisplayName.trim() },
      {
        onSuccess: (data) => {
          window.open(data.consentUrl, "_blank", "noopener,noreferrer");
          toast.success("Opened Microsoft admin consent in a new tab. Come back here once you've approved it.");
        },
        onError: (err) => toast.error(errMessage(err, "Failed to start the mailbox connection.")),
      },
    );
  };

  if (statusQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (statusQuery.isError) return <ErrorPanel error={statusQuery.error} />;
  if (!s) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card title="Outbound mailbox" note="The Microsoft 365 mailbox the platform sends customer email from.">
        {!s.mtAppConfigured && (
          <ErrorPanel error={new MspSettingsApiError(503, "The platform's multi-tenant app credentials are not configured — connecting a mailbox is not available until a platform admin sets that up.")} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Pill label={s.connected ? "Connected" : "Not connected"} tone={s.connected ? signal.ok : signal.neutral} />
          {s.connector && <span style={{ fontSize: 12, color: text.secondary }}>{s.connector.mailboxUpn} · "{s.connector.fromDisplayName}"</span>}
        </div>
        {s.connector && (
          <span style={{ fontSize: 11, color: text.faint }}>
            Consented {fmt(s.connector.consentedAt)}{s.connector.revokedAt ? ` · revoked ${fmt(s.connector.revokedAt)}` : ""}
          </span>
        )}

        {!s.connected && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Mailbox address">
                <input style={inputStyle} value={mailboxUpn} onChange={(e) => setMailboxUpn(e.target.value)} placeholder="notifications@yourmsp.com" />
              </Field>
              <Field label="From display name">
                <input style={inputStyle} value={fromDisplayName} onChange={(e) => setFromDisplayName(e.target.value)} placeholder="Your MSP" />
              </Field>
            </div>
            <div>
              <Btn label="Connect mailbox" onClick={connect} pending={connectMutation.isPending} disabled={!s.mtAppConfigured || !mailboxUpn.trim() || !fromDisplayName.trim()} />
            </div>
            <span style={{ fontSize: 10.5, color: text.faint, textWrap: "pretty" }}>
              Opens Microsoft's admin-consent screen in a new tab. No client secret is ever stored — the platform's app uses client-credentials after consent.
            </span>
          </>
        )}
        {s.connected && (
          <div>
            <Btn
              label="Disconnect"
              tone="danger"
              pending={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate(undefined, {
                onSuccess: () => toast.success("Mailbox disconnected."),
                onError: (err) => toast.error(errMessage(err, "Failed to disconnect the mailbox.")),
              })}
            />
          </div>
        )}
      </Card>

      <Card title="Delivery controls">
        <Toggle
          label="Automated customer emails"
          note="Marketing/notification email to customers. Inert without an active mailbox connector above."
          on={s.automatedCustomerEmailsEnabled}
          pending={automatedMutation.isPending}
          onChange={(enabled) => automatedMutation.mutate(enabled, {
            onSuccess: () => toast.success(enabled ? "Automated customer emails enabled." : "Automated customer emails disabled."),
            onError: (err) => toast.error(errMessage(err, "Failed to update the setting.")),
          })}
        />
        <Toggle
          label="Write-back to Microsoft 365"
          note="Not cosmetic — this is the real, fail-closed gate on every Microsoft Graph WRITE for every one of this MSP's tenants. Off means every tenant-scoped Graph write is refused, platform-wide."
          on={s.writeBackEnabled}
          dangerWhenOff
          pending={writeBackMutation.isPending}
          onChange={(enabled) => writeBackMutation.mutate(enabled, {
            onSuccess: () => toast.success(enabled ? "Write-back enabled — Graph writes are now permitted for this MSP's tenants." : "Write-back disabled — every Graph write for this MSP's tenants will now be refused."),
            onError: (err) => toast.error(errMessage(err, "Failed to update write-back.")),
          })}
        />
      </Card>
    </div>
  );
}

// ── Group D — Service accounts (API keys) ───────────────────────────────────

function ServiceAccountsTab() {
  const accountsQuery = useServiceAccounts();
  const createMutation = useCreateServiceAccount();
  const revokeMutation = useRevokeServiceAccount();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [rawKey, setRawKey] = useState<{ name: string; value: string } | null>(null);

  const create = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      {
        name: name.trim(),
        scopes: scopes.trim() ? scopes.split(",").map((s) => s.trim()).filter(Boolean) : [],
        expiresInDays: expiresInDays.trim() ? Number(expiresInDays) : undefined,
      },
      {
        onSuccess: (data) => {
          setRawKey({ name: data.name, value: data.rawKey });
          setName(""); setScopes(""); setExpiresInDays("");
        },
        onError: (err) => toast.error(errMessage(err, "Failed to create the service account.")),
      },
    );
  };

  const rows = accountsQuery.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card title="Create a service account" note="Mints an API key. The raw value is returned exactly once — this response, right here, is the only copy.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Name">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly export job" />
          </Field>
          <Field label="Scopes" hint="Comma-separated, optional">
            <input style={inputStyle} value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="reports.read, audit.read" />
          </Field>
          <Field label="Expires in (days)" hint="Optional — leave blank for no expiry">
            <input style={inputStyle} type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
          </Field>
        </div>
        <div>
          <Btn label="Create" onClick={create} pending={createMutation.isPending} disabled={!name.trim()} />
        </div>
        {rawKey && (
          <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 13, display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: signal.warning.strong }}>{rawKey.name} — shown once</span>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 13, color: text.title, wordBreak: "break-all" }}>{rawKey.value}</span>
            <span style={{ fontSize: 11, color: text.secondary }}>Copy it now. There is no way to retrieve this value again.</span>
            <div>
              <button
                onClick={() => { navigator.clipboard.writeText(rawKey.value); toast.success("Copied to clipboard."); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 6, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11.5, cursor: "pointer" }}
              >
                <Icon name="copy" size={12} /> Copy
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Active service accounts">
        {accountsQuery.isLoading ? (
          <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
        ) : accountsQuery.isError ? (
          <ErrorPanel error={accountsQuery.error} />
        ) : rows.length === 0 ? (
          <span style={{ fontSize: 11.5, color: text.label }}>No active service accounts.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {rows.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${border.faint}`, paddingBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, flex: 1, minWidth: 140 }}>{a.name}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{a.keyPrefix}…</span>
                <span style={{ fontSize: 11, color: text.muted }}>{a.scopes.length > 0 ? a.scopes.join(", ") : "no scopes"}</span>
                <span style={{ fontSize: 11, color: text.faint }}>{a.expiresAt ? `expires ${fmt(a.expiresAt)}` : "no expiry"}</span>
                <span style={{ fontSize: 11, color: text.faint }}>last used {fmt(a.lastUsedAt)}</span>
                <Btn
                  label="Revoke" tone="danger" pending={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(a.id, {
                    onSuccess: () => toast.success(`Revoked ${a.name}.`),
                    onError: (err) => toast.error(errMessage(err, "Failed to revoke the service account.")),
                  })}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Group H — Billing ─────────────────────────────────────────────────────────

function BillingTab() {
  const billingQuery = useBilling();
  const portalMutation = useCreateBillingPortalSession();

  const openPortal = () => {
    portalMutation.mutate(undefined, {
      onSuccess: (data) => window.open(data.url, "_blank", "noopener,noreferrer"),
      onError: (err) => toast.error(errMessage(err, "Failed to open the billing portal.")),
    });
  };

  if (billingQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (billingQuery.isError) return <ErrorPanel error={billingQuery.error} />;

  const b = billingQuery.data;

  return (
    <Card title="Billing" note="Stripe subscription status — no raw card data ever appears here.">
      {!b ? (
        <span style={{ fontSize: 11.5, color: text.label }}>No Stripe subscription on file for this MSP.</span>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <Pill label={b.status} tone={b.status === "active" ? signal.ok : b.status === "trialing" ? signal.info : signal.critical} />
            {b.dunningState && <Pill label={b.dunningState.replace(/_/g, " ")} tone={signal.warning} />}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            {[
              ["Contact email", b.contactEmail ?? "—"],
              ["Tenant count (last snapshot)", b.tenantCountSnapshot != null ? String(b.tenantCountSnapshot) : "—"],
              ["Current period start", fmt(b.currentPeriodStart)],
              ["Current period end", fmt(b.currentPeriodEnd)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.faint }}>{String(label).toUpperCase()}</span>
                <span style={{ fontSize: 12.5, color: text.secondary }}>{value}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div>
        <Btn label="Open Stripe billing portal" onClick={openPortal} pending={portalMutation.isPending} disabled={!b?.stripeCustomerId} />
      </div>
      {!b?.stripeCustomerId && <span style={{ fontSize: 10.5, color: text.faint }}>No Stripe customer on file yet.</span>}
    </Card>
  );
}

// ── Group I — Email templates ─────────────────────────────────────────────────

function EmailTemplatesTab() {
  const templatesQuery = useEmailTemplates();
  const updateMutation = useUpdateEmailTemplate();
  const resetMutation = useResetEmailTemplate();
  const [editing, setEditing] = useState<EmailTemplateKey | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  if (templatesQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (templatesQuery.isError) return <ErrorPanel error={templatesQuery.error} />;

  const templates = templatesQuery.data ?? [];

  const startEdit = (key: EmailTemplateKey) => {
    const t = templates.find((x) => x.key === key);
    setEditing(key);
    setSubject(t?.subject ?? "");
    setBody(t?.body ?? "");
  };

  const save = () => {
    if (!editing) return;
    updateMutation.mutate(
      { key: editing, subject, body },
      {
        onSuccess: () => { toast.success("Template saved."); setEditing(null); },
        onError: (err) => toast.error(errMessage(err, "Failed to save the template. Check the required merge fields below.")),
      },
    );
  };

  return (
    <Card title="Email templates" note={`${EMAIL_TEMPLATE_KEYS.length} platform templates. Merge-field validated on save; three keys are platform-locked and cannot be customised.`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {templates.map((t) => (
          <div key={t.key} style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, fontWeight: 700, color: text.strong, flex: 1 }}>{t.key}</span>
              {t.isLocked && <Pill label="Platform-locked" tone={signal.neutral} />}
              {t.isCustomised && <Pill label="Customised" tone={signal.info} />}
              {!t.isLocked && editing !== t.key && (
                <Btn label="Edit" tone="neutral" onClick={() => startEdit(t.key)} />
              )}
              {!t.isLocked && t.isCustomised && (
                <Btn
                  label="Reset to default" tone="neutral" pending={resetMutation.isPending}
                  onClick={() => resetMutation.mutate(t.key, {
                    onSuccess: () => toast.success("Reverted to the platform default."),
                    onError: (err) => toast.error(errMessage(err, "Failed to reset the template.")),
                  })}
                />
              )}
            </div>

            {editing === t.key ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Field label="Subject">
                  <input style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
                </Field>
                <Field label="Body" hint={t.requiredMergeFields.length > 0 ? `Required merge fields: ${t.requiredMergeFields.join(", ")}` : undefined}>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={6}
                    style={{ ...inputStyle, height: "auto", padding: 10, resize: "vertical", fontFamily: "Menlo, monospace" }}
                  />
                </Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn label="Save" onClick={save} pending={updateMutation.isPending} disabled={subject.trim().length < 5 || body.trim().length < 20} />
                  <Btn label="Cancel" tone="neutral" onClick={() => setEditing(null)} />
                </div>
              </div>
            ) : (
              <>
                <span style={{ fontSize: 12, color: text.secondary }}>{t.subject || <em style={{ color: text.faint }}>no subject</em>}</span>
                <span style={{ fontSize: 11, color: text.faint }}>Updated {fmt(t.updatedAt)}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Group J — Customer agreement template ────────────────────────────────────

function AgreementTab() {
  const agreementQuery = useAgreementTemplate();
  const updateMutation = useUpdateAgreementTemplate();
  const [template, setTemplate] = useState<string | null>(null);

  if (agreementQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (agreementQuery.isError) return <ErrorPanel error={agreementQuery.error} />;

  const value = template ?? agreementQuery.data?.template ?? "";

  const save = () => {
    if (value.trim().length < 50) { toast.error("The agreement template needs at least 50 characters."); return; }
    updateMutation.mutate(value, {
      onSuccess: () => { toast.success("Agreement template saved."); setTemplate(null); },
      onError: (err) => toast.error(errMessage(err, "Failed to save the agreement template.")),
    });
  };

  return (
    <Card title="Customer agreement template" note={`Updated ${fmt(agreementQuery.data?.updatedAt ?? null)}.`}>
      <textarea
        value={value}
        onChange={(e) => setTemplate(e.target.value)}
        rows={14}
        placeholder="The agreement text shown to a customer before they accept onboarding…"
        style={{ ...inputStyle, height: "auto", padding: 12, resize: "vertical", fontFamily: "Menlo, monospace", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn label="Save" onClick={save} pending={updateMutation.isPending} disabled={value.trim().length < 50} />
        <span style={{ fontSize: 10.5, color: text.faint }}>{value.length.toLocaleString()} / 100,000 characters (minimum 50)</span>
      </div>
    </Card>
  );
}

// ── Group L — Notification preferences (own staff prefs) ───────────────────

function NotificationsTab() {
  const prefsQuery = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();
  const [edited, setEdited] = useState<Map<string, NotificationPreference> | null>(null);

  if (prefsQuery.isLoading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (prefsQuery.isError) return <ErrorPanel error={prefsQuery.error} />;

  const base = prefsQuery.data ?? [];
  const rows = base.map((p) => edited?.get(p.category) ?? p);

  const patch = (category: string, next: Partial<NotificationPreference>) => {
    const current = rows.find((r) => r.category === category);
    if (!current) return;
    const map = new Map(edited ?? base.map((p) => [p.category, p]));
    map.set(category, { ...current, ...next });
    setEdited(map);
  };

  const save = () => {
    updateMutation.mutate(rows, {
      onSuccess: () => { toast.success("Notification preferences saved."); setEdited(null); },
      onError: (err) => toast.error(errMessage(err, "Failed to save notification preferences.")),
    });
  };

  return (
    <Card title="Your notification preferences" note="Your own delivery preferences, not an MSP-wide setting — MSPOperator can edit these too.">
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10, padding: "0 2px", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.faint }}>
        <span>CATEGORY</span><span>IN-APP</span><span>EMAIL</span>
      </div>
      {rows.map((r) => (
        <div key={r.category} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10, alignItems: "center", padding: "8px 2px", borderBottom: `1px solid ${border.faint}` }}>
          <span style={{ fontSize: 12.5, color: text.strong, textTransform: "capitalize" }}>{r.category}</span>
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
            <input type="checkbox" checked={r.inAppEnabled} onChange={(e) => patch(r.category, { inAppEnabled: e.target.checked })} />
            <span style={{ fontSize: 11.5, color: text.muted }}>{r.inAppEnabled ? "On" : "Off"}</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
            <input type="checkbox" checked={r.emailEnabled} onChange={(e) => patch(r.category, { emailEnabled: e.target.checked })} />
            <span style={{ fontSize: 11.5, color: text.muted }}>{r.emailEnabled ? "On" : "Off"}</span>
          </label>
        </div>
      ))}
      <div>
        <Btn label="Save preferences" onClick={save} pending={updateMutation.isPending} disabled={edited == null} />
      </div>
    </Card>
  );
}
