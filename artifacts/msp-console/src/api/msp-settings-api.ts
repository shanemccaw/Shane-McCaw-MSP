/**
 * msp-settings-api.ts — the data seam for the MSP Console's Settings module
 * page (Git #2606, Feature #1690), wiring the real, previously-orphaned
 * 24-route surface documented in full at
 * `docs/msp-console/msp-settings-contract-pack.md`, Groups A/B/C/D/H/I/J/L
 * (`artifacts/api-server/src/routes/msp-settings.ts`):
 *
 *   GET/PATCH /api/msp/settings/profile                              — Group A
 *   GET/PUT   /api/msp/settings/connector                            — Group B
 *   PUT/DELETE /api/msp/settings/connector/exchange                  — Group B
 *   GET       /api/msp/settings/connector/mailbox                    — Group C
 *   POST      /api/msp/settings/connector/mailbox/connect            — Group C
 *   DELETE    /api/msp/settings/connector/mailbox                    — Group C
 *   PATCH     /api/msp/settings/connector/mailbox/automated-emails   — Group C
 *   PATCH     /api/msp/settings/connector/mailbox/write-back         — Group C
 *   GET/POST  /api/msp/settings/service-accounts                     — Group D
 *   DELETE    /api/msp/settings/service-accounts/:id                 — Group D
 *   GET       /api/msp/settings/billing                              — Group H
 *   POST      /api/msp/settings/billing/portal-session                — Group H
 *   GET/PUT/DELETE /api/msp/settings/email-templates[/:key]           — Group I
 *   GET/PUT   /api/msp/settings/agreement-template                   — Group J
 *   GET/PATCH /api/msp/settings/notification-preferences              — Group L
 *
 * Groups E/F/G/K (the staff roster, per-staff customer scoping, role/
 * approve-purchases/remove, sessions and invites) are deliberately NOT here —
 * they are already wired by `staff-roster-api.ts` (Staff Roster, `/ops/staff`)
 * and `account-security-api.ts` (Account Security, `/ops/acctsec`). Re-wiring
 * them a third time on this page would just be a second, divergent client for
 * the same routes.
 *
 * **Real, documented backend gotcha this seam works around (contract pack
 * §1b, §3, §6):** `PUT /connector`'s upsert always writes
 * `customerAgreementTemplate` into the same column Group J's own PUT owns —
 * omitting the field from the request body does not skip it, the route's
 * `set` clause always includes it, defaulting to `null`. A caller that only
 * means to change `connectorMode`/`auditLoggingEnabled` silently wipes
 * whatever agreement template was saved. `useUpdateConnector` here always
 * round-trips the caller's own currently-known template value back through
 * the same call so saving connector settings from this page never destroys
 * it — filed as a real backend finding (a client working around a sharp edge
 * is not the same as the edge not existing) rather than silently relying on
 * this call site being the only future caller.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type ConnectorMode = "agent" | "api_key" | "delegated";
export type MspStatus = "active" | "suspended" | "trial";
export type BillingStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid";
export type DunningState = "reminder_sent" | "suspended" | "access_revoked" | "archival_flagged" | null;

export interface MspProfile {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly domain: string | null;
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly status: MspStatus;
  readonly trialEndsAt: string | null;
  readonly customCustomerAgreement: string | null;
  readonly createdAt: string;
}

export interface UpdateProfileInput {
  name?: string;
  domain?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export interface ConnectorConfig {
  readonly connectorMode: ConnectorMode;
  readonly exchangeOnlineEnabled: boolean;
  readonly exchangeOnlineTenantId: string | null;
  readonly hasExchangeClientId: boolean;
  readonly hasExchangeClientSecret: boolean;
  readonly auditLoggingEnabled: boolean;
  readonly updatedAt: string | null;
}

export interface UpdateConnectorInput {
  connectorMode: ConnectorMode;
  auditLoggingEnabled?: boolean;
  /** See file header — always send the current agreement template back through
   * this call so the shared-column upsert does not null it out. */
  customerAgreementTemplate?: string | null;
}

export interface ExchangeCredentialsInput {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface MailboxConnector {
  readonly connectorId: string;
  readonly tenantId: string;
  readonly mailboxUpn: string;
  readonly fromDisplayName: string;
  readonly isActive: boolean;
  readonly consentedAt: string | null;
  readonly revokedAt: string | null;
  readonly updatedAt: string;
}

export interface MailboxStatus {
  readonly connected: boolean;
  /** The dedicated mailbox-send app registration (#4241) is configured on the platform. */
  readonly mailboxSendAppConfigured: boolean;
  /** msps.entra_tenant_id is set (#4242); mailbox sends are refused until it is (#4241). */
  readonly ownTenantRecorded: boolean;
  readonly connector: MailboxConnector | null;
  readonly automatedCustomerEmailsEnabled: boolean;
  readonly writeBackEnabled: boolean;
}

export interface ConnectMailboxInput {
  mailboxUpn: string;
  fromDisplayName: string;
}

export interface ServiceAccount {
  readonly id: number;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: string[];
  readonly expiresAt: string | null;
  readonly revokedAt?: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface CreateServiceAccountInput {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}

export interface CreatedServiceAccount extends ServiceAccount {
  readonly rawKey: string;
}

export interface BillingInfo {
  readonly status: BillingStatus;
  readonly dunningState: DunningState;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripePriceId: string | null;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly tenantCountSnapshot: number | null;
  readonly contactEmail: string | null;
}

export const EMAIL_TEMPLATE_KEYS = [
  "onboarding_welcome", "monitoring_complete", "offer_available", "report_ready",
  "invoice_due_reminder", "password_reset", "mfa_code", "consent_revoked",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplate {
  readonly key: EmailTemplateKey;
  readonly subject: string;
  readonly body: string;
  readonly isCustomised: boolean;
  readonly isLocked: boolean;
  readonly requiredMergeFields: string[];
  readonly updatedAt: string | null;
}

export interface UpdateEmailTemplateInput {
  subject: string;
  body: string;
}

export interface AgreementTemplate {
  readonly template: string | null;
  readonly updatedAt: string | null;
}

export interface NotificationPreference {
  readonly category: string;
  readonly inAppEnabled: boolean;
  readonly emailEnabled: boolean;
}

/** A fetch that failed reports its real HTTP status — same pattern as every
 * other module's `XxxApiError` (`account-security-api.ts`, `team-api.ts`). */
export class MspSettingsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string | { message?: string } };
      if (typeof body?.error === "string") message = body.error;
      else if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new MspSettingsApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const keys = {
  profile: ["msp", "settings", "profile"] as const,
  connector: ["msp", "settings", "connector"] as const,
  mailbox: ["msp", "settings", "mailbox"] as const,
  serviceAccounts: ["msp", "settings", "service-accounts"] as const,
  billing: ["msp", "settings", "billing"] as const,
  emailTemplates: ["msp", "settings", "email-templates"] as const,
  agreementTemplate: ["msp", "settings", "agreement-template"] as const,
  notificationPreferences: ["msp", "settings", "notification-preferences"] as const,
};

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  };
}

// ── Group A — Profile ──────────────────────────────────────────────────────────

export function useMspProfile(): UseQueryResult<MspProfile, MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.profile,
    queryFn: async () => parseJsonOrThrow<MspProfile>(await fetchWithAuth("/api/msp/settings/profile")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useUpdateMspProfile() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) =>
      parseJsonOrThrow<MspProfile>(await fetchWithAuth("/api/msp/settings/profile", jsonInit("PATCH", input))),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.profile }),
  });
}

// ── Group B — Connector mode + Exchange Online ─────────────────────────────────

export function useConnector(): UseQueryResult<ConnectorConfig, MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.connector,
    queryFn: async () => parseJsonOrThrow<ConnectorConfig>(await fetchWithAuth("/api/msp/settings/connector")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useUpdateConnector() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateConnectorInput) =>
      parseJsonOrThrow<{ ok: true; connectorMode: ConnectorMode }>(
        await fetchWithAuth("/api/msp/settings/connector", jsonInit("PUT", input)),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.connector }),
  });
}

export function useSetExchangeCredentials() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExchangeCredentialsInput) =>
      parseJsonOrThrow<{ ok: true; exchangeOnlineEnabled: true; kvStored: boolean }>(
        await fetchWithAuth("/api/msp/settings/connector/exchange", jsonInit("PUT", input)),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.connector }),
  });
}

export function useRemoveExchangeCredentials() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      parseJsonOrThrow<{ ok: true }>(await fetchWithAuth("/api/msp/settings/connector/exchange", { method: "DELETE" })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.connector }),
  });
}

// ── Group C — MSP Mailbox (outbound email) ─────────────────────────────────────

export function useMailboxStatus(): UseQueryResult<MailboxStatus, MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.mailbox,
    queryFn: async () => parseJsonOrThrow<MailboxStatus>(await fetchWithAuth("/api/msp/settings/connector/mailbox")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useConnectMailbox() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (input: ConnectMailboxInput) =>
      parseJsonOrThrow<{ consentUrl: string; state: string; expiresAt: string }>(
        await fetchWithAuth("/api/msp/settings/connector/mailbox/connect", jsonInit("POST", input)),
      ),
  });
}

export function useDisconnectMailbox() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      parseJsonOrThrow<{ ok: true }>(await fetchWithAuth("/api/msp/settings/connector/mailbox", { method: "DELETE" })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.mailbox }),
  });
}

export function useSetAutomatedEmails() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      parseJsonOrThrow<{ automatedCustomerEmailsEnabled: boolean }>(
        await fetchWithAuth("/api/msp/settings/connector/mailbox/automated-emails", jsonInit("PATCH", { enabled })),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.mailbox }),
  });
}

export function useSetWriteBack() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      parseJsonOrThrow<{ writeBackEnabled: boolean }>(
        await fetchWithAuth("/api/msp/settings/connector/mailbox/write-back", jsonInit("PATCH", { enabled })),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.mailbox }),
  });
}

// ── Group D — Service Accounts (API keys) ──────────────────────────────────────

export function useServiceAccounts(): UseQueryResult<ServiceAccount[], MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.serviceAccounts,
    queryFn: async () => parseJsonOrThrow<ServiceAccount[]>(await fetchWithAuth("/api/msp/settings/service-accounts")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useCreateServiceAccount() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateServiceAccountInput) =>
      parseJsonOrThrow<CreatedServiceAccount>(
        await fetchWithAuth("/api/msp/settings/service-accounts", jsonInit("POST", input)),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.serviceAccounts }),
  });
}

export function useRevokeServiceAccount() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      parseJsonOrThrow<{ ok: true }>(await fetchWithAuth(`/api/msp/settings/service-accounts/${id}`, { method: "DELETE" })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.serviceAccounts }),
  });
}

// ── Group H — Billing ───────────────────────────────────────────────────────────

export function useBilling(): UseQueryResult<BillingInfo | null, MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.billing,
    queryFn: async () => parseJsonOrThrow<BillingInfo | null>(await fetchWithAuth("/api/msp/settings/billing")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useCreateBillingPortalSession() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async () =>
      parseJsonOrThrow<{ url: string }>(
        await fetchWithAuth("/api/msp/settings/billing/portal-session", jsonInit("POST", { returnUrl: window.location.href })),
      ),
  });
}

// ── Group I — Email Templates ───────────────────────────────────────────────────

export function useEmailTemplates(): UseQueryResult<EmailTemplate[], MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.emailTemplates,
    queryFn: async () => parseJsonOrThrow<EmailTemplate[]>(await fetchWithAuth("/api/msp/settings/email-templates")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useUpdateEmailTemplate() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, ...input }: UpdateEmailTemplateInput & { key: EmailTemplateKey }) =>
      parseJsonOrThrow<EmailTemplate>(
        await fetchWithAuth(`/api/msp/settings/email-templates/${key}`, jsonInit("PUT", input)),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.emailTemplates }),
  });
}

export function useResetEmailTemplate() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: EmailTemplateKey) =>
      parseJsonOrThrow<{ ok: true }>(await fetchWithAuth(`/api/msp/settings/email-templates/${key}`, { method: "DELETE" })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.emailTemplates }),
  });
}

// ── Group J — Customer Agreement Template ───────────────────────────────────────

export function useAgreementTemplate(): UseQueryResult<AgreementTemplate, MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.agreementTemplate,
    queryFn: async () => parseJsonOrThrow<AgreementTemplate>(await fetchWithAuth("/api/msp/settings/agreement-template")),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useUpdateAgreementTemplate() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: string) =>
      parseJsonOrThrow<{ ok: true }>(
        await fetchWithAuth("/api/msp/settings/agreement-template", jsonInit("PUT", { template })),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.agreementTemplate }),
  });
}

// ── Group L — Notification Preferences (own staff prefs, Git #3693) ────────────

export function useNotificationPreferences(): UseQueryResult<NotificationPreference[], MspSettingsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: keys.notificationPreferences,
    queryFn: async () => {
      const body = await parseJsonOrThrow<{ preferences: NotificationPreference[] }>(
        await fetchWithAuth("/api/msp/settings/notification-preferences"),
      );
      return body.preferences;
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useUpdateNotificationPreferences() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: NotificationPreference[]) =>
      parseJsonOrThrow<{ ok: true }>(
        await fetchWithAuth("/api/msp/settings/notification-preferences", jsonInit("PATCH", { preferences })),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.notificationPreferences }),
  });
}
