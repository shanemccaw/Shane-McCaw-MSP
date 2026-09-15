/**
 * Feature #1649 (Signup, Agreement and Invite) — the five public endpoints
 * documented in docs/signup-agreement-and-invite-contract-pack.md.
 *
 * All five are unauthenticated (accept-invite's accept step optionally
 * carries a bearer token for the existing-user anti-hijack check, handled
 * by the caller, not here). Plain fetch, not fetchWithAuth — there is no
 * session yet.
 *
 * Note on the platform agreement: `/api/platform/agreement/*` (current,
 * acceptance-status, accept) and the admin CRUD that published a version
 * were deleted by Git #3412 ("no longer needed per Shane", 2026-09-10) —
 * a week after this pack certified them live. Git #4048 restored the
 * admin-publish path (`platform-agreements.ts`, the admin page, its nav
 * entry), so publishing a version is possible again — but no version has
 * actually been published yet (the one row that ever existed,
 * `platform_agreements.id=1` version "Test", was never published). This
 * module still has no function for that endpoint group; signup.tsx
 * renders the "no agreement published" state as the current, real fact
 * rather than polling for one.
 */

export class MspSignupApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = "MspSignupApiError";
    this.status = status;
    this.code = typeof data?.code === "string" ? data.code : undefined;
    this.data = data;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── GET /api/msp/signup/tiers (msp-signup.ts:38-103) ────────────────────────

export interface SignupTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string;
  priceCents: number;
  badge: string | null;
  highlighted: boolean;
  typeAttributes: Record<string, unknown>;
  tenantAllowance: unknown;
  aiCreditAllowance: unknown;
}

export async function fetchSignupTiers(): Promise<SignupTier[]> {
  const res = await fetch("/api/msp/signup/tiers");
  const data = await readJson(res);
  if (!res.ok) throw new MspSignupApiError((data.error as string) ?? "Failed to load subscription tiers", res.status, data);
  return (data.tiers as SignupTier[]) ?? [];
}

// ── POST /api/msp/signup/start (msp-signup.ts:114-353) ──────────────────────

export interface SignupStartRequest {
  companyName: string;
  domain?: string;
  contactName?: string;
  contactEmail: string;
  serviceId: number;
}

export interface SignupStartResponse {
  checkoutUrl: string;
  sessionId: string;
}

export async function startMspSignup(body: SignupStartRequest): Promise<SignupStartResponse> {
  const res = await fetch("/api/msp/signup/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new MspSignupApiError((data.error as string) ?? "Failed to start checkout", res.status, data);
  return data as unknown as SignupStartResponse;
}

// ── GET /api/msp/signup/success (msp-signup.ts:359-417) ─────────────────────

export interface SignupSuccessResponse {
  status: "pending" | "provisioning" | "provisioned";
  message: string;
  mspId?: number;
  mspName?: string;
}

export async function fetchSignupSuccess(sessionId: string): Promise<SignupSuccessResponse> {
  const res = await fetch(`/api/msp/signup/success?session_id=${encodeURIComponent(sessionId)}`);
  const data = await readJson(res);
  if (!res.ok) throw new MspSignupApiError((data.error as string) ?? "Status check failed", res.status, data);
  return data as unknown as SignupSuccessResponse;
}

// ── GET /api/public/msp-invite/:token (msp-onboarding.ts:417-473) ───────────

export interface MspInviteInfo {
  invitedEmail: string;
  mspRole: "MSPAdmin" | "MSPOperator";
  expiresAt: string;
  msp: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

export async function fetchMspInvite(token: string): Promise<MspInviteInfo> {
  const res = await fetch(`/api/public/msp-invite/${encodeURIComponent(token)}`);
  const data = await readJson(res);
  if (!res.ok) throw new MspSignupApiError((data.error as string) ?? "This invite link is invalid.", res.status, data);
  return data as unknown as MspInviteInfo;
}

// ── POST /api/public/msp-invite/:token/accept (msp-onboarding.ts:484-720) ───

export interface MspInviteAcceptResponse {
  ok: true;
  mspSlug: string;
  accessToken?: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
}

export async function acceptMspInvite(
  token: string,
  body: { name?: string; password?: string },
  bearerToken?: string,
): Promise<MspInviteAcceptResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
  const res = await fetch(`/api/public/msp-invite/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new MspSignupApiError((data.error as string) ?? "Failed to accept invite", res.status, data);
  return data as unknown as MspInviteAcceptResponse;
}

/** `price`/`priceCents` formatting — real cents, no decimals unless the price genuinely has them. */
export function formatTierPrice(priceCents: number): string {
  return priceCents % 100 === 0 ? `$${(priceCents / 100).toFixed(0)}` : `$${(priceCents / 100).toFixed(2)}`;
}
