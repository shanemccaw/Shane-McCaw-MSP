/**
 * emailAuthSetupLive.ts — the Email Authentication Setup page's real data
 * (Git #3995, part of #1654/#1485).
 *
 *   GET /api/portal/email-auth-status
 *
 * served by `artifacts/api-server/src/routes/portal-email-auth-status.ts`
 * (confirmed live and unchanged against
 * `Design/portal/design_handoff_full_site/docs/email-authentication-setup-contract-pack.md`
 * before this hook was written). Read-only, scoped to the calling
 * customer's own tenant off the JWT — no `?tenantId=` param.
 *
 * Three real, distinguishable states, matching the route's own contract
 * (pack §4) — no fixture branch anywhere here:
 *   - `"not-checked"` — `checked: false`; every other field is a genuine
 *     "never scanned for this tenant" null, not a fallback.
 *   - `"checked"` — `checked: true`; each of `spfConfigured` /
 *     `dmarcConfigured` / `dkimConfiguredAtDefaultSelectors` is independently
 *     `boolean | null` (a field can be null even while `checked` is true, if
 *     it failed its own type guard server-side — pack §1 step 4) and is
 *     rendered as "not checked yet" per-protocol rather than collapsed to a
 *     false/found state.
 *   - `"read-failed"` — the fetch itself failed (non-2xx or thrown) — a
 *     failed read, not a verdict that nothing is configured.
 */
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const ENDPOINT = "/api/portal/email-auth-status";

export interface WireEmailAuthStatus {
  readonly checked: boolean;
  readonly domain: string | null;
  readonly spfConfigured: boolean | null;
  readonly dmarcConfigured: boolean | null;
  readonly dkimConfiguredAtDefaultSelectors: boolean | null;
  readonly collectedAt: string | null;
}

export type EmailAuthSetupDataState = "loading" | "checked" | "not-checked" | "read-failed";

export interface EmailAuthSetupLiveState {
  readonly dataState: EmailAuthSetupDataState;
  readonly status: WireEmailAuthStatus | null;
  readonly refetch: () => void;
}

export function useEmailAuthSetupLive(): EmailAuthSetupLiveState {
  const { fetchWithAuth } = useAuth();
  const [status, setStatus] = useState<WireEmailAuthStatus | null>(null);
  const [dataState, setDataState] = useState<EmailAuthSetupDataState>("loading");
  const [attempt, setAttempt] = useState(0);

  const refetch = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    setDataState("loading");
    void (async () => {
      try {
        const res = await fetchWithAuth(ENDPOINT);
        if (!res.ok) {
          if (!cancelled) setDataState("read-failed");
          return;
        }
        const data = (await res.json()) as WireEmailAuthStatus;
        if (cancelled) return;
        setStatus(data);
        setDataState(data.checked ? "checked" : "not-checked");
      } catch {
        if (!cancelled) setDataState("read-failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, attempt]);

  return { dataState, status, refetch };
}
