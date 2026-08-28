/**
 * usePiiExposedBadge.ts — the nav badge on PII Governance (Git #1438).
 *
 * The design's `piiNavBadge` (prototype shell 8807/8835) was a fixed "3
 * exposed" — `portalV2Nav.ts` shipped it as a literal string. That number was
 * never real: it came from `piiData.ts`'s fictional discovery-scan fixture via
 * `piiModel.ts`'s `piiExposedCount` (locations with `exposure === "Public" |
 * "External"`), and the live PII Governance page stopped reading that fixture
 * entirely once it was wired to real data (`piiGovernanceLive.ts`) — the real
 * backend has no Public/External "exposure" dimension at all, only four
 * aggregate Purview sensitivity-label/DLP severity signals
 * (`portal-pii-governance.ts`). Wiring the badge straight to `piiModel.ts`
 * would put that fixture back in front of a customer, which the repo's hard
 * rule on fixture fallback forbids.
 *
 * This hook fetches the same real endpoint the page itself renders from and
 * derives the badge with `piiExposedBadge` (piiGovernanceWire.ts) — the live
 * High-severity finding count, the same "personal-data exposure to act on"
 * number the page's own stat tile shows. Zero, or nothing collected yet,
 * means no badge at all (never "0 exposed"), matching `portalV2Nav.ts`'s
 * "badges are rare on purpose" convention.
 *
 * ── One request, shared across mounts ──────────────────────────────────────
 * Mirrors `useHoldBadge.ts`'s module-scope cache exactly, for the same reason:
 * the Shell renders on every `/portal-v2` page, so a naive fetch here would be
 * one request per navigation. The in-flight promise and its result are cached
 * at module scope for BADGE_TTL_MS.
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { piiExposedBadge, toPiiGovernanceView, type PiiNavBadge, type WirePiiGovernance } from "./piiGovernanceWire";

const PII_GOVERNANCE_URL = "/api/portal/pii-governance";

/**
 * The channel the route itself logs under server-side
 * (`portal-pii-governance.ts`'s `logger.child({ channel: "tenant.portal" })`),
 * reused here so a badge fetch failure lands in the same log stream rather
 * than starting a second, disconnected channel for the same subsystem.
 */
const PII_BADGE_CHANNEL = "tenant.portal";

/** How long a fetched badge is reused across Shell mounts. */
export const PII_BADGE_TTL_MS = 60_000;

const EMPTY: PiiNavBadge = { label: null };

let cached: { at: number; value: PiiNavBadge } | null = null;
let inFlight: Promise<PiiNavBadge> | null = null;

export function usePiiExposedBadge(): PiiNavBadge {
  const { accessToken, fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const [badge, setBadge] = useState<PiiNavBadge>(() => cached?.value ?? EMPTY);

  useEffect(() => {
    let active = true;

    const fresh = cached && Date.now() - cached.at < PII_BADGE_TTL_MS;
    if (fresh && cached) {
      setBadge(cached.value);
      return;
    }

    if (!inFlight) {
      inFlight = (async (): Promise<PiiNavBadge> => {
        try {
          // Silent: a nav badge must never raise a toast. A failure here means
          // no badge, which is the same as no exposure — a missing badge is a
          // far better failure than a red toast on every portal page.
          const res = await fetchRef.current(PII_GOVERNANCE_URL, {}, { silent: true });
          if (!res.ok) {
            reportClientEvent(
              tokenRef.current,
              "PiiExposedBadgeFetchFailed",
              `GET ${PII_GOVERNANCE_URL} returned ${res.status}`,
              PII_BADGE_CHANNEL,
              { status: res.status },
            );
            return EMPTY;
          }
          const body = (await res.json()) as WirePiiGovernance;
          return piiExposedBadge(toPiiGovernanceView(body));
        } catch (err: unknown) {
          reportClientEvent(
            tokenRef.current,
            "PiiExposedBadgeFetchFailed",
            err instanceof Error ? err.message : String(err),
            PII_BADGE_CHANNEL,
          );
          return EMPTY;
        } finally {
          inFlight = null;
        }
      })();
    }

    void inFlight.then((value) => {
      cached = { at: Date.now(), value };
      if (active) setBadge(value);
    });

    return () => {
      active = false;
    };
  }, []);

  return badge;
}
