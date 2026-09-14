/**
 * Consent and Onboarding (Feature #1650, Git #3993) — wire contracts per
 * docs/portal/consent-and-onboarding-contract-pack.md (#2758). Kept out of
 * auth-api.ts/auth-context.tsx because none of these calls touch session
 * identity — they're the "portal"-origin redirect targets of
 * GET /api/consent/callback, plus the two finalize-order endpoints the
 * fallback same-tab branch calls.
 */

// ── GET /api/public/checkout-session/:id (public-services.ts:~277) ─────────────

export interface CheckoutSessionInfo {
  productSlug: string;
  status: "pending" | "consented" | "paid" | "expired";
  seats: number;
}

export async function fetchCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | null> {
  try {
    const res = await fetch(`/api/public/checkout-session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return (await res.json()) as CheckoutSessionInfo;
  } catch {
    return null;
  }
}

// ── GET /api/services (public-services.ts:43) ───────────────────────────────────
// Only the subset contract pack §5 documents these pages actually read.

export interface CatalogService {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price: string | null;
  basePrice: string | null;
  priceCents: number | null;
  isFreeOffering: boolean | null;
  typeAttributes: Record<string, unknown> | null;
}

export async function fetchCatalogServices(): Promise<CatalogService[] | null> {
  try {
    const res = await fetch("/api/services");
    if (!res.ok) return null;
    return (await res.json()) as CatalogService[];
  } catch {
    return null;
  }
}

/**
 * True when the catalog entry carries no positive price anywhere (free
 * offering). Mirrors the server's isServiceFree (catalog-pricing.ts) — every
 * pricing representation must be checked, not just the flat columns. A
 * monitoring tier's entire price can live in typeAttributes with the flat
 * columns all null (contract pack §5).
 */
export function serviceIsFree(svc: CatalogService): boolean {
  const ta = (svc.typeAttributes ?? {}) as {
    pricePerUserMonth?: string | number | null;
    flatMonthlySurcharge?: string | number | null;
    flatMonthlyPrice?: string | number | null;
  };
  const positive = (v: string | number | null | undefined): boolean => {
    if (v == null || v === "") return false;
    const n = parseFloat(String(v));
    return !isNaN(n) && n > 0;
  };
  const hasPositivePrice =
    (svc.priceCents ?? 0) > 0 ||
    positive(svc.price) ||
    positive(svc.basePrice) ||
    positive(ta.pricePerUserMonth) ||
    positive(ta.flatMonthlySurcharge) ||
    positive(ta.flatMonthlyPrice);
  return svc.isFreeOffering === true || !hasPositivePrice;
}

// ── guestInfo cache the public checkout writes (same origin) ────────────────────

export interface GuestInfoCache {
  name: string;
  email: string;
  termsAccepted: boolean;
}

const GUEST_INFO_CACHE_PREFIX = "checkout_guest_";
const SESSION_STORAGE_KEY = "checkout_session_id";

export function loadGuestInfoCache(sessionId: string): GuestInfoCache | null {
  try {
    const raw = localStorage.getItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GuestInfoCache;
  } catch {
    return null;
  }
}

export function clearCheckoutCaches(sessionId: string): void {
  try {
    localStorage.removeItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
  } catch {
    /* localStorage may be unavailable */
  }
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* sessionStorage may be unavailable */
  }
}

// ── POST /api/portal/onboarding/contract (portal-onboarding.ts:416) ────────────

export class ConsentOnboardingApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ConsentOnboardingApiError";
    this.status = status;
  }
}

export async function postOnboardingContract(body: {
  serviceIds: number[];
  guestEmail: string;
  signerName: string;
  seats: number;
}): Promise<{ contractIds: number[] }> {
  const res = await fetch("/api/portal/onboarding/contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { contractIds?: number[]; error?: string };
  if (!res.ok) throw new ConsentOnboardingApiError(data.error ?? "We couldn't finalize your order. Please try again.", res.status);
  return { contractIds: data.contractIds ?? [] };
}

// ── POST /api/portal/checkout/free (portal-checkout-free.ts:370) ───────────────

export async function postCheckoutFree(body: {
  contractIds: number[];
  serviceIds: number[];
  guestEmail: string;
  captchaToken: string;
}): Promise<{ ok: true; sentSetupEmail: boolean }> {
  const res = await fetch("/api/portal/checkout/free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sentSetupEmail?: boolean; error?: string };
  if (!res.ok) throw new ConsentOnboardingApiError(data.error ?? "We couldn't complete your free registration. Please try again in a moment.", res.status);
  return { ok: true, sentSetupEmail: data.sentSetupEmail === true };
}

// ── GET /api/public/consent-scopes (public-consent-scopes.ts, #433) ────────────
// Already real and live — a bare array, not `{ scopes: [...] }`.

export async function fetchConsentScopes(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/public/consent-scopes");
    if (!res.ok) return null;
    return (await res.json()) as string[];
  } catch {
    return null;
  }
}

/**
 * The 4 scopes the archived page always led with, kept as the declined page's
 * headline set (contract pack §9b: "the hardcoded list happens to be a
 * subset... of REQUIRED_MT_SCOPES today"). Every remaining live scope from the
 * real manifest is still listed underneath — see consent-declined.tsx — this
 * map only supplies richer copy for the ones worth calling out by name.
 */
export const SCOPE_WHY: Record<string, string> = {
  "Directory.Read.All": "users, groups and role assignments — who has access to what",
  "Reports.Read.All": "usage and activity reports the engines read",
  "AuditLog.Read.All": "the audit trail behind drift and security signals",
  "Sites.Read.All": "SharePoint site and file metadata for the storage/sharing signals",
  "SecurityEvents.Read.All": "Microsoft Defender security alerts and incidents",
  "Policy.Read.All": "Conditional Access and other directory policy configuration",
  "DeviceManagementConfiguration.Read.All": "Intune device compliance and configuration policy",
  "DeviceManagementManagedDevices.Read.All": "the managed-device inventory Intune tracks",
  "IdentityRiskyUser.Read.All": "Entra ID Protection's flagged-risky-user signal",
  "IdentityRiskEvent.Read.All": "Entra ID Protection's individual risk events",
  "ServiceHealth.Read.All": "Microsoft 365 service health used for uptime reporting",
  "SensitivityLabels.Read.All": "sensitivity-label configuration for DLP findings",
  "Organization.Read.All": "tenant organization profile and licensing state",
  "Domain.Read.All": "verified domains on the tenant",
  "Exchange.ManageAsApp": "Exchange Online mailbox and transport configuration reads",
  "Exchange.ManageAsAppV2": "the newer Exchange Online read surface, alongside the classic one",
};

export function scopeWhy(scope: string): string {
  return SCOPE_WHY[scope] ?? "A read-only Microsoft Graph permission this platform's signal engines use.";
}

// ── GET /api/public/onboarding/link/:token (msp-onboarding.ts) ─────────────────

export interface OnboardingLinkInfo {
  token: string;
  customerEmail: string;
  serviceId: number | null;
  note: string | null;
  redirectPortalUrl: string | null;
  expiresAt: string;
  msp: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

export type OnboardingLinkResult =
  | { state: "valid"; link: OnboardingLinkInfo }
  | { state: "missing" }
  | { state: "used" }
  | { state: "expired" }
  | { state: "suspended" }
  | { state: "error" };

export async function fetchOnboardingLink(token: string): Promise<OnboardingLinkResult> {
  try {
    const res = await fetch(`/api/public/onboarding/link/${encodeURIComponent(token)}`);
    if (res.ok) {
      return { state: "valid", link: (await res.json()) as OnboardingLinkInfo };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 404) return { state: "missing" };
    if (res.status === 410) {
      return { state: /expired/i.test(data.error ?? "") ? "expired" : "used" };
    }
    if (res.status === 403) return { state: "suspended" };
    return { state: "error" };
  } catch {
    return { state: "error" };
  }
}

// ── POST /api/public/onboarding/link/:token/start-consent (msp-onboarding.ts, #4010) ──
// Burns the link and returns the Microsoft admin-consent URL. The link-state
// failures reuse the GET's exact statuses, so they map onto the same states.

export type StartOnboardingConsentResult =
  | { state: "redirect"; consentUrl: string }
  | { state: Exclude<OnboardingLinkResult["state"], "valid"> }
  | { state: "unavailable"; message: string };

export async function startOnboardingConsent(token: string): Promise<StartOnboardingConsentResult> {
  try {
    const res = await fetch(`/api/public/onboarding/link/${encodeURIComponent(token)}/start-consent`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as { consentUrl?: string; error?: string };
    if (res.ok && data.consentUrl) return { state: "redirect", consentUrl: data.consentUrl };
    if (res.status === 404) return { state: "missing" };
    if (res.status === 410) {
      return { state: /expired/i.test(data.error ?? "") ? "expired" : "used" };
    }
    if (res.status === 403) return { state: "suspended" };
    return { state: "unavailable", message: data.error ?? "The connection could not be started." };
  } catch {
    return { state: "error" };
  }
}
