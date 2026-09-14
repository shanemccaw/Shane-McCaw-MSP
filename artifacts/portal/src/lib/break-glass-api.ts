/**
 * Break-glass Access (#3994, Feature #1651) — the portal's client for the real
 * endpoints in `artifacts/api-server/src/routes/break-glass-verification.ts`
 * (contract pack: Design/portal/design_handoff_full_site/docs/break-glass-access-contract-pack.md §2).
 *
 *   - GET  /api/portal/break-glass                               pending handoffs for the caller's customer
 *   - GET  /api/portal/break-glass/by-run/:runId                 one run's handoff status
 *   - POST /api/portal/break-glass/:pendingSecretId/invite       send 1–5 verification invites
 *   - POST /api/portal/break-glass/:pendingSecretId/admin-override  force a reset (MSP operator or above)
 *
 * None of these ever carries the credential, a link token, or the vault
 * reference. Every non-2xx answer is kept distinct rather than collapsed into a
 * generic error: 404 is "not found" (the routes deliberately answer the same
 * for "not yours"), a write-back gate refusal is its own `blocked` shape, and
 * everything else keeps its real status code and server message.
 */

export type LinkStatus = "pending" | "consumed" | "expired" | "superseded";

export type VerificationOutcome =
  | "success"
  | "role_not_active_pim_eligible"
  | "role_absent"
  | "expired"
  | "superseded"
  | null;

export interface BreakGlassRun {
  readonly id: number;
  readonly definitionName: string | null;
  readonly packKey: string | null;
  readonly packLabel: string | null;
}

export interface BreakGlassAttempt {
  readonly id: number;
  readonly invitedEmail: string;
  readonly linkStatus: LinkStatus;
  readonly verificationOutcome: VerificationOutcome;
  readonly attemptedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type BreakGlassRunStatus =
  | { readonly pending: false; readonly run: BreakGlassRun }
  | {
      readonly pending: true;
      readonly run: BreakGlassRun;
      readonly pendingSecretId: number;
      readonly status: "pending_delivery";
      readonly createdAt: string;
      /** #4139 — the break-glass account (Entra object id or UPN); null on rows predating #4015. */
      readonly breakGlassAccountId: string | null;
      /** #4041 — set while invites and reveals refuse pending a re-run admin-override. */
      readonly credentialUncertainAt: string | null;
      readonly attempts: readonly BreakGlassAttempt[];
    };

export interface BreakGlassHandoff {
  readonly run: BreakGlassRun;
  readonly pendingSecretId: number;
  readonly createdAt: string;
  readonly credentialUncertainAt: string | null;
  readonly liveInviteCount: number;
  readonly totalInviteCount: number;
}

export type ReadResult<T> =
  | { readonly kind: "live"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "forbidden"; readonly error: string }
  | { readonly kind: "failed"; readonly status: number | null; readonly error: string };

export type InviteResult =
  | { readonly kind: "ok"; readonly invited: number; readonly sent: number }
  | { readonly kind: "refused"; readonly status: number | null; readonly error: string };

export type OverrideResult =
  | { readonly kind: "ok"; readonly newPendingSecretId: number; readonly reissued: number; readonly sent: number }
  | { readonly kind: "blocked"; readonly blockedBy: string }
  | { readonly kind: "refused"; readonly status: number | null; readonly error: string; readonly detail?: string };

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorBody {
  error?: string;
  detail?: string;
  blockedBy?: string;
}

async function errorBody(res: Response): Promise<ErrorBody> {
  return ((await res.json().catch(() => ({}))) ?? {}) as ErrorBody;
}

async function read<T>(fetchWithAuth: FetchWithAuth, url: string, fallback: string): Promise<ReadResult<T>> {
  let res: Response;
  try {
    res = await fetchWithAuth(url);
  } catch {
    return { kind: "failed", status: null, error: "The request did not reach the server" };
  }
  if (res.ok) return { kind: "live", data: (await res.json()) as T };
  const body = await errorBody(res);
  if (res.status === 404) return { kind: "not-found" };
  if (res.status === 403) return { kind: "forbidden", error: body.error ?? fallback };
  return { kind: "failed", status: res.status, error: body.error ?? fallback };
}

export async function fetchBreakGlassHandoffs(
  fetchWithAuth: FetchWithAuth,
): Promise<ReadResult<readonly BreakGlassHandoff[]>> {
  const result = await read<{ handoffs: BreakGlassHandoff[] }>(
    fetchWithAuth,
    "/api/portal/break-glass",
    "Failed to load handoffs",
  );
  return result.kind === "live" ? { kind: "live", data: result.data.handoffs } : result;
}

export function fetchBreakGlassRunStatus(
  fetchWithAuth: FetchWithAuth,
  runId: number,
): Promise<ReadResult<BreakGlassRunStatus>> {
  return read<BreakGlassRunStatus>(fetchWithAuth, `/api/portal/break-glass/by-run/${runId}`, "Failed to load status");
}

function postJson(fetchWithAuth: FetchWithAuth, url: string, body: unknown): Promise<Response> {
  return fetchWithAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function sendBreakGlassInvites(
  fetchWithAuth: FetchWithAuth,
  pendingSecretId: number,
  emails: readonly string[],
): Promise<InviteResult> {
  let res: Response;
  try {
    res = await postJson(fetchWithAuth, `/api/portal/break-glass/${pendingSecretId}/invite`, { emails });
  } catch {
    return { kind: "refused", status: null, error: "The request did not reach the server" };
  }
  if (res.ok) {
    const data = (await res.json()) as { invited: number; sent: number };
    return { kind: "ok", invited: data.invited, sent: data.sent };
  }
  const body = await errorBody(res);
  return { kind: "refused", status: res.status, error: body.error ?? "Failed to send invites" };
}

export async function runBreakGlassAdminOverride(
  fetchWithAuth: FetchWithAuth,
  pendingSecretId: number,
  reason: string,
  emails: readonly string[],
): Promise<OverrideResult> {
  let res: Response;
  try {
    res = await postJson(fetchWithAuth, `/api/portal/break-glass/${pendingSecretId}/admin-override`, {
      reason,
      // Omitted, not empty: the route re-invites the previous recipients only
      // when `emails` is absent (an empty array fails its min(1) validation).
      ...(emails.length > 0 ? { emails } : {}),
    });
  } catch {
    return { kind: "refused", status: null, error: "The request did not reach the server" };
  }
  if (res.ok) {
    const data = (await res.json()) as { newPendingSecretId: number; reissued: number; sent: number };
    return { kind: "ok", newPendingSecretId: data.newPendingSecretId, reissued: data.reissued, sent: data.sent };
  }
  const body = await errorBody(res);
  if (res.status === 409 && body.blockedBy) return { kind: "blocked", blockedBy: body.blockedBy };
  return {
    kind: "refused",
    status: res.status,
    error: body.error ?? "Failed to process override",
    ...(body.detail ? { detail: body.detail } : {}),
  };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits a free-text recipient field on commas, semicolons and whitespace. */
export function parseRecipients(text: string): { emails: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const emails = Array.from(new Set(parts.filter((p) => EMAIL_SHAPE.test(p))));
  const invalid = parts.filter((p) => !EMAIL_SHAPE.test(p));
  return { emails, invalid };
}
