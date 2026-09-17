/**
 * freeScanRecoveryStore.ts — state for the AdminV2 Free Scan account recovery
 * screen (Git #4483).
 *
 * Plain external store (subscribe / getSnapshot), same shape as
 * riskDecisionsStore. Every row is served by
 * `GET /api/admin/free-scan/account-recovery` (routes/admin-free-scan-account-recovery.ts);
 * the store never invents one.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";

const log = logger.child({ channel: "auth" });

// ── Wire types (mirror lib/free-scan-account-recovery.ts MfaResetQueueRow) ───

export type MfaResetState = "none" | "pending" | "approved" | "approval_expired" | "denied";

export interface RecoveryRequest {
  accountId: number;
  email: string;
  mfaMethod: "totp" | "sms" | null;
  phoneLast4: string | null;
  state: MfaResetState;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: number | null;
  decisionNote: string | null;
  approvalExpiresAt: string | null;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  accountCreatedAt: string;
  engagement: { id: number; sowReference: string; signerName: string | null; signerRole: string | null; paidAt: string | null };
  tenant: { id: number; name: string | null; domain: string | null };
}

interface RecoveryState {
  requests: RecoveryRequest[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** accountId of a decision in flight. */
  deciding: number | null;
  decisionError: string | null;
  /** Set when a decision stood but its email to the Prospect failed. */
  decisionNotice: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

let state: RecoveryState = {
  requests: [],
  loading: false,
  loaded: false,
  error: null,
  deciding: null,
  decisionError: null,
  decisionNotice: null,
};

export const WATCH_PENDING_KEY = "free-scan-recovery:watch-pending";

function syncLiveRibbon(): void {
  const pending = pendingCount();
  setLiveRibbonValue(
    WATCH_PENDING_KEY,
    pending > 0 ? { label: `${pending} factor reset${pending === 1 ? "" : "s"} to check`, color: ACCENT.amber } : { label: "Factor resets" },
  );
}

function setState(patch: Partial<RecoveryState>): void {
  state = { ...state, ...patch };
  syncLiveRibbon();
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): RecoveryState {
  return state;
}

export function pendingCount(): number {
  return state.requests.filter((r) => r.state === "pending").length;
}

export function configureFreeScanRecoveryFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let warmed = false;
export function warmFreeScanRecovery(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadRequests();
}

async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`;
}

export async function loadRequests(): Promise<void> {
  if (!adminFetchRef || state.loading) return;
  setState({ loading: true, error: null });
  try {
    const res = await adminFetchRef("/api/admin/free-scan/account-recovery");
    if (!res.ok) {
      setState({ loading: false, error: await failureOf(res) });
      return;
    }
    const body = (await res.json()) as { requests: RecoveryRequest[] };
    setState({ loading: false, loaded: true, requests: body.requests });
  } catch (err) {
    log.error({ err }, "free-scan recovery: queue load failed");
    setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function decide(accountId: number, decision: "approve" | "deny", note: string): Promise<boolean> {
  if (!adminFetchRef) return false;
  setState({ deciding: accountId, decisionError: null, decisionNotice: null });
  try {
    const res = await adminFetchRef(`/api/admin/free-scan/account-recovery/${accountId}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) {
      setState({ deciding: null, decisionError: await failureOf(res) });
      return false;
    }
    const body = (await res.json()) as { emailSent: boolean };
    setState({
      deciding: null,
      decisionNotice: body.emailSent ? null : "The decision was saved, but the email to the Prospect failed. Tell them directly.",
    });
    await loadRequests();
    return true;
  } catch (err) {
    log.error({ err, accountId, decision }, "free-scan recovery: decision failed");
    setState({ deciding: null, decisionError: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
