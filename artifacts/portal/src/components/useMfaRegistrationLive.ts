/**
 * useMfaRegistrationLive.ts — the real per-user data seam for the MFA
 * drill-down's "gaps" and "partial" body content (Git #1234).
 *
 * `secMfaData.ts` previously documented the gap-user list and the partial-
 * enrollment roster as needing "a per-user Graph feed the /portal/pillars
 * payload does not carry" — true of that payload, but `identity:mfa-
 * registration` (real `userDisplayName`/`isAdmin`/`isMfaRegistered` per
 * user, off `/reports/authenticationMethods/userRegistrationDetails`) is
 * already collected on every real scan by the item-detail pass (#339) and
 * reachable read-only via `GET /api/portal/tenant-check-items` (#776) — the
 * same route `useCaBaselineLive` (#1232) reads for the CA baseline page.
 *
 * This hook is a second, independent caller of that route.
 */
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

const TENANT_CHECK_ITEMS_URL = "/api/portal/tenant-check-items";
const MFA_REGISTRATION_CHECK_KEY = "identity:mfa-registration";

/**
 * There is no client-side `logger.child` in this app; the browser posts to
 * `/api/client-events` and the server binds the channel (same convention as
 * `useCopilotJourney`/`useRemediationPillarScores`). `engine.dashboard` is
 * this app's existing channel for this pillar-dashboard family of hooks.
 */
const MFA_REGISTRATION_CHANNEL = "engine.dashboard";

export interface LiveMfaUser {
  readonly name: string;
  readonly isAdmin: boolean;
  readonly isMfaRegistered: boolean;
}

interface WireCheckItemDetail {
  readonly status: string;
  readonly items: readonly unknown[] | null;
  readonly itemsOmitted: boolean;
}

interface WireTenantCheckItemsPayload {
  readonly items?: Readonly<Record<string, WireCheckItemDetail>>;
}

function usableItems(detail: WireCheckItemDetail | undefined): readonly Record<string, unknown>[] | null {
  if (!detail || detail.status !== "ok" || detail.itemsOmitted || !Array.isArray(detail.items)) return null;
  return detail.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function toLiveMfaUser(row: Record<string, unknown>): LiveMfaUser | null {
  const name = typeof row["userDisplayName"] === "string" ? row["userDisplayName"] : null;
  const isAdmin = typeof row["isAdmin"] === "boolean" ? row["isAdmin"] : null;
  const isMfaRegistered = typeof row["isMfaRegistered"] === "boolean" ? row["isMfaRegistered"] : null;
  if (name === null || isAdmin === null || isMfaRegistered === null) return null;
  return { name, isAdmin, isMfaRegistered };
}

export interface MfaRegistrationLiveState {
  /** Null until the check has genuinely run for this tenant and returned usable rows. */
  readonly users: readonly LiveMfaUser[] | null;
  /** True once a first response (success or failure) has arrived. */
  readonly loaded: boolean;
}

export function useMfaRegistrationLive(): MfaRegistrationLiveState {
  const { fetchWithAuth, accessToken } = useAuth();
  const [users, setUsers] = useState<readonly LiveMfaUser[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchRef.current(
          `${TENANT_CHECK_ITEMS_URL}?checkKeys=${encodeURIComponent(MFA_REGISTRATION_CHECK_KEY)}`,
          undefined,
          { silent: true },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as WireTenantCheckItemsPayload;
        if (cancelled) return;

        const rawUsers = usableItems(body.items?.[MFA_REGISTRATION_CHECK_KEY]);
        if (rawUsers) {
          const mapped = rawUsers.map(toLiveMfaUser);
          const dropped = mapped.filter((u) => u === null).length;
          if (dropped > 0) {
            // The hero banner's accounts-without-MFA / admin counts (Git #1431)
            // come straight from this array's length — a malformed row dropped
            // here silently is a wrong number on screen, not just a missing row.
            reportClientEvent(
              tokenRef.current,
              "MfaRegistrationRowsMalformed",
              `${dropped} of ${rawUsers.length} identity:mfa-registration rows missing userDisplayName/isAdmin/isMfaRegistered`,
              MFA_REGISTRATION_CHANNEL,
              { dropped, total: rawUsers.length },
            );
          }
          setUsers(mapped.filter((u): u is LiveMfaUser => u !== null));
        }
      } catch {
        // best-effort — stays null; the page renders an honest empty state (Git #1439)
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { users, loaded };
}
