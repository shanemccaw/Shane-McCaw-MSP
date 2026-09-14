/**
 * Azure Credential — MSP Console module page (#3968, Feature #3966). Mounts
 * into the shell's `ScreenSlot` at `/tenants/:id/azurecred` (Access &
 * identity group, `console/nav.ts`), wiring the real MSP-operator routes
 * landed by #3967 in `msp-azure-credentials.ts` — see `@/api/azure-credential-api`
 * for the full route list and the client-user resolution this page needs
 * that the server doesn't do for this surface.
 *
 * Lists the tenant's current Azure app-registration credential status, and
 * lets an operator create one, edit/rotate its secret, or delete it. The raw
 * secret value is never returned by any route this page calls — only ever
 * written, and only ever on this page as the operator types it in.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  AzureCredentialApiError,
  useAzureCredential,
  useDeleteAzureCredential,
  useResolvedClientUserId,
  useUpsertAzureCredential,
  type AzureCredential,
  type AzureCredentialType,
} from "@/api/azure-credential-api";

type Tone = { strong: string; text?: string; tint: string; border: string };

function StatePanel({ icon, tone, title, body, wire }: { icon: IconName; tone: Tone; title: string; body: string; wire?: string }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text ?? tone.strong} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      {wire && <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>}
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
      height: 20, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
      fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
    }}>
      {label}
    </span>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function expiryTone(expiresOn: string | null): Tone {
  if (!expiresOn) return signal.neutral;
  const days = (new Date(expiresOn).getTime() - Date.now()) / 86_400_000;
  if (days <= 0) return signal.critical;
  if (days <= 14) return signal.warning;
  return signal.ok;
}

function expiryLabel(expiresOn: string | null): string {
  if (!expiresOn) return "no expiry on record";
  const days = Math.ceil((new Date(expiresOn).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `expired ${formatWhen(expiresOn)}`;
  if (days === 0) return "expires today";
  return `expires ${formatWhen(expiresOn)} · ${days} day${days === 1 ? "" : "s"} left`;
}

interface FormState {
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: AzureCredentialType;
  clientSecretValue: string;
}

const EMPTY_FORM: FormState = { displayName: "", tenantId: "", clientId: "", credentialType: "secret", clientSecretValue: "" };

function formFrom(cred: AzureCredential | null): FormState {
  if (!cred) return EMPTY_FORM;
  return { displayName: cred.displayName, tenantId: cred.tenantId, clientId: cred.clientId, credentialType: cred.credentialType, clientSecretValue: "" };
}

export function AzureCredential({ mspId, customerId, customerName }: { mspId: number | null; customerId: number; customerName?: string }) {
  const resolved = useResolvedClientUserId(customerId);
  const credQuery = useAzureCredential(mspId, resolved.clientUserId);
  const upsertMutation = useUpsertAzureCredential(mspId, resolved.clientUserId);
  const deleteMutation = useDeleteAzureCredential(mspId, resolved.clientUserId);

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const cred = credQuery.data ?? null;

  useEffect(() => {
    if (editing) setForm(formFrom(cred));
  }, [editing, cred]);

  if (resolved.isLoading) {
    return <div style={{ fontSize: 11.5, color: text.muted }}>Loading this tenant's team roster…</div>;
  }

  if (resolved.isError) {
    return (
      <StatePanel
        icon="triangle-alert"
        tone={signal.warning}
        title="Could not resolve a client account for this tenant"
        body="The team roster this page needs to find the customer's Azure credential owner failed to load."
        wire={`GET /api/msp/customers/${customerId}/team`}
      />
    );
  }

  if (resolved.clientUserId == null) {
    return (
      <StatePanel
        icon="users"
        tone={signal.neutral}
        title="No client account yet"
        body={`${customerName ?? "This customer"} has no portal login yet. An Azure credential is stored against a client account, so invite someone to Team first.`}
      />
    );
  }

  if (mspId == null) {
    return (
      <StatePanel
        icon="triangle-alert"
        tone={signal.warning}
        title="No MSP context resolved"
        body="This tenant's directory row is missing an mspId, so the credential routes (which are path-scoped by mspId) cannot be called."
      />
    );
  }

  if (credQuery.isError) {
    const status = credQuery.error instanceof AzureCredentialApiError ? credQuery.error.status : null;
    return (
      <StatePanel
        icon={status === 404 ? "shield-alert" : "triangle-alert"}
        tone={status === 404 ? signal.critical : signal.warning}
        title={status === 404 ? "Client not found for this MSP" : "The Azure credential could not be loaded"}
        body={credQuery.error.message}
        wire={`GET /api/msp/${mspId}/clients/${resolved.clientUserId}/azure-credential · ${status ?? "error"}`}
      />
    );
  }

  const submit = () => {
    const displayName = form.displayName.trim();
    const tenantId = form.tenantId.trim();
    const clientId = form.clientId.trim();
    if (!displayName || !tenantId || !clientId) return;
    upsertMutation.mutate(
      {
        displayName,
        tenantId,
        clientId,
        credentialType: form.credentialType,
        ...(form.clientSecretValue.trim() ? { clientSecretValue: form.clientSecretValue.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(cred ? "Azure credential updated." : "Azure credential created.");
          setEditing(false);
        },
        onError: (err) => toast.error(err instanceof AzureCredentialApiError ? err.message : "Failed to save the Azure credential."),
      },
    );
  };

  const doDelete = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success("Azure credential deleted.");
        setConfirmingDelete(false);
      },
      onError: (err) => {
        toast.error(err instanceof AzureCredentialApiError ? err.message : "Failed to delete the Azure credential.");
        setConfirmingDelete(false);
      },
    });
  };

  const canSubmit = form.displayName.trim() !== "" && form.tenantId.trim() !== "" && form.clientId.trim() !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {credQuery.isLoading ? (
        <div style={{ fontSize: 11.5, color: text.muted }}>Loading the Azure credential…</div>
      ) : !cred ? (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.neutral.tint, border: `1px solid ${signal.neutral.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="key-round" size={20} color={signal.neutral.strong} />
          </span>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No Azure credential on record</span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
            {customerName ?? "This customer"} has no app-registration credential stored yet.
          </span>
          <button
            onClick={() => setEditing(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${signal.info.border}`, background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 6 }}
          >
            <Icon name="key" size={14} />
            Add a credential
          </button>
        </div>
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title, wordBreak: "break-all" }}>{cred.displayName}</span>
              <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                {cred.credentialType === "secret" ? "Client secret" : "Certificate"} · client id {cred.clientId} · saved for client user {resolved.clientUserId}
              </span>
            </span>
            <Pill label={expiryLabel(cred.expiresOn)} tone={expiryTone(cred.expiresOn)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 11 }}>
            {[
              { label: "M365 TENANT ID", value: cred.tenantId },
              { label: "APP (CLIENT) ID", value: cred.clientId },
              { label: "KEY VAULT SECRET NAME", value: cred.keyVaultSecretName },
              { label: "LAST UPDATED", value: formatWhen(cred.updatedAt) },
            ].map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
                <span style={{ fontSize: 12, color: text.secondary, wordBreak: "break-all", fontFamily: "Menlo, monospace" }}>{f.value}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button
              onClick={() => setEditing(true)}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              <Icon name="key" size={13} />
              Edit / rotate secret
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={deleteMutation.isPending}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 7, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 12, fontWeight: 600, cursor: deleteMutation.isPending ? "not-allowed" : "pointer" }}
            >
              <Icon name="trash-2" size={13} />
              Delete
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          The raw secret value is never returned by this page or any route it calls — only written. This page manages the
          credential against this tenant's canonical client account, chosen from its team roster.
        </span>
      </div>

      {editing && (
        <EditDrawer
          cred={cred}
          form={form}
          onChange={setForm}
          canSubmit={canSubmit}
          submitting={upsertMutation.isPending}
          onSubmit={submit}
          onClose={() => setEditing(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDeleteDrawer
          displayName={cred?.displayName ?? ""}
          submitting={deleteMutation.isPending}
          onConfirm={doDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

function EditDrawer({
  cred, form, onChange, canSubmit, submitting, onSubmit, onClose,
}: {
  cred: AzureCredential | null;
  form: FormState;
  onChange: (f: FormState) => void;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>{cred ? "EDIT / ROTATE" : "ADD CREDENTIAL"}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>
              {cred ? "Edit the Azure credential" : "Add an Azure credential"}
            </span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Display name</span>
          <input
            value={form.displayName}
            onChange={(e) => onChange({ ...form, displayName: e.target.value })}
            placeholder="e.g. Contoso — production app registration"
            style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>M365 tenant ID</span>
          <input
            value={form.tenantId}
            onChange={(e) => onChange({ ...form, tenantId: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, fontFamily: "Menlo, monospace", outline: "none" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>App (client) ID</span>
          <input
            value={form.clientId}
            onChange={(e) => onChange({ ...form, clientId: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, fontFamily: "Menlo, monospace", outline: "none" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Credential type</span>
          <div style={{ display: "flex", gap: 8 }}>
            {(["secret", "certificate"] as const).map((t) => (
              <button
                key={t}
                onClick={() => onChange({ ...form, credentialType: t })}
                style={{
                  flex: 1, height: 34, borderRadius: 7,
                  border: `1px solid ${form.credentialType === t ? signal.info.border : border.card}`,
                  background: form.credentialType === t ? signal.info.tint : "transparent",
                  color: form.credentialType === t ? signal.info.text : text.secondary,
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>
            {cred ? "New secret value (optional)" : "Secret value"}
          </span>
          <input
            type="password"
            value={form.clientSecretValue}
            onChange={(e) => onChange({ ...form, clientSecretValue: e.target.value })}
            placeholder={cred ? "Leave blank to keep the stored secret" : "Paste the app registration's secret value"}
            style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
          />
          <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
            Written straight to Key Vault. Never stored or returned in this table — only its Key Vault secret name is.
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              border: `1px solid ${canSubmit ? "#2563eb" : border.card}`,
              background: canSubmit ? "#2563eb" : "transparent",
              color: canSubmit ? "#fff" : text.muted,
              fontSize: 13, fontWeight: 600, cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {submitting ? "Saving…" : cred ? "Save changes" : "Add credential"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteDrawer({
  displayName, submitting, onConfirm, onClose,
}: {
  displayName: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px,92%)", background: "#0b1728", border: `1px solid ${signal.critical.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: signal.critical.tint, border: `1px solid ${signal.critical.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="trash-2" size={16} color={signal.critical.strong} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>Delete this Azure credential?</span>
        </div>
        <span style={{ fontSize: 12.5, color: text.muted, textWrap: "pretty" }}>
          {displayName ? `"${displayName}" will be removed from this customer's record.` : "This credential will be removed from this customer's record."} This does not revoke or remove the app registration in Microsoft Entra — only this MSP Console's record of it.
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onConfirm}
            disabled={submitting}
            style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.strong, fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Deleting…" : "Delete"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
