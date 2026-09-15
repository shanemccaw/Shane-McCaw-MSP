/**
 * Platform Agreement — accept-agreement.tsx (#4009, Feature #1649). Client for
 * the three real endpoints restored by #4048
 * (`artifacts/api-server/src/routes/platform-agreements.ts`), per the contract
 * pack `Design/portal/design_handoff_full_site/docs/accept-agreement-contract-pack.md`:
 *
 *   - GET  /api/platform/agreement/current            — public, no auth
 *   - GET  /api/platform/agreement/acceptance-status  — auth, `ladder.free`
 *   - POST /api/platform/agreement/accept             — auth, `ladder.free`
 *
 * A separate module from `msp-signup-api.ts` (that one's own header
 * documents it as the client for the 5 *unauthenticated* signup/invite
 * endpoints only) — these three are authenticated, use `fetchWithAuth`, and
 * belong to a different consumer (accept-agreement.tsx, not signup.tsx,
 * which still queries its own inline gate server-side per
 * `msp-signup.ts:150-196`).
 */

export type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PlatformAgreement {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: string | null;
  publishedByUserId: number | null;
  isCurrentVersion: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptanceStatus {
  required: boolean;
  accepted: boolean;
  acceptedAt: string | null;
  /** Present only when `required` (platform-agreements.ts:82-87). */
  version?: string;
}

export class PlatformAgreementApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PlatformAgreementApiError";
    this.status = status;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** GET /api/platform/agreement/current (platform-agreements.ts:34-51) — public. */
export async function fetchCurrentAgreement(): Promise<PlatformAgreement | null> {
  const res = await fetch("/api/platform/agreement/current");
  const data = await readJson(res);
  if (!res.ok) {
    throw new PlatformAgreementApiError((data.error as string) ?? "Failed to load the current agreement", res.status);
  }
  return (data.agreement as PlatformAgreement | null) ?? null;
}

/** GET /api/platform/agreement/acceptance-status (platform-agreements.ts:55-92). */
export async function fetchAcceptanceStatus(fetchWithAuth: FetchWithAuth): Promise<AcceptanceStatus> {
  const res = await fetchWithAuth("/api/platform/agreement/acceptance-status");
  const data = await readJson(res);
  if (!res.ok) {
    throw new PlatformAgreementApiError((data.error as string) ?? "Failed to check acceptance status", res.status);
  }
  return data as unknown as AcceptanceStatus;
}

/**
 * POST /api/platform/agreement/accept (platform-agreements.ts:96-161).
 * `checkboxConfirmed: true` is the only body shape the route accepts — the
 * caller (the page) only ever calls this once the checkbox is actually
 * checked, same discipline as `msp-signup.ts`'s own gate.
 */
export async function acceptCurrentAgreement(fetchWithAuth: FetchWithAuth): Promise<void> {
  const res = await fetchWithAuth("/api/platform/agreement/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkboxConfirmed: true }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new PlatformAgreementApiError((data.error as string) ?? "Failed to record acceptance", res.status);
  }
}
