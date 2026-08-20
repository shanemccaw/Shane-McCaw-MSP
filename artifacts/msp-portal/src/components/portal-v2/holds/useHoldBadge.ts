/**
 * useHoldBadge.ts — the nav badge on Active Runbooks.
 *
 * The README is emphatic that this is not decoration: "Badges are rare on
 * purpose. Only Active Runbooks carries one (`1 due`), driven by the count of
 * hold windows at T-0. It is the single place in the nav that says 'a decision
 * is waiting'."
 *
 * The prototype's rule (proto 7236), reproduced exactly:
 *   badge  = holdDue ? `${holdDue} due` : holdEarly ? "early" : null
 *   urgent = holdDue > 0
 * So a tenant with windows that can close early gets a quiet "early" badge, and
 * only a window at T-0 gets the urgent treatment.
 *
 * ── One request, shared across mounts ──────────────────────────────────────
 * The Shell renders on every `/portal-v2` page, so a naive fetch here would be
 * one request per navigation. The in-flight promise and its result are cached at
 * module scope for BADGE_TTL_MS, which makes moving between portal pages free
 * and still lets a decision that becomes due show up within the minute.
 *
 * BUILD_PLAN §5.4 notes two shell-wide polling contexts already exist
 * (`ScanStatusProvider`, `ShellStatusProvider`) and that new polling should
 * reuse rather than duplicate them. This does not poll — it caches — but if a
 * third shell-wide concern appears, folding this count into `ShellStatusProvider`
 * is the right move rather than adding another cache.
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const RUNBOOKS_URL = "/api/portal/runbooks";

/** How long a fetched count is reused across Shell mounts. */
export const BADGE_TTL_MS = 60_000;

export interface HoldBadge {
  readonly label: string | null;
  readonly urgent: boolean;
}

const EMPTY: HoldBadge = { label: null, urgent: false };

let cached: { at: number; value: HoldBadge } | null = null;
let inFlight: Promise<HoldBadge> | null = null;

/** The prototype's own badge rule (proto 7236). */
export function badgeFor(due: number, early: number): HoldBadge {
  if (due > 0) return { label: `${due} due`, urgent: true };
  if (early > 0) return { label: "early", urgent: false };
  return EMPTY;
}

export function useHoldBadge(): HoldBadge {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [badge, setBadge] = useState<HoldBadge>(() => cached?.value ?? EMPTY);

  useEffect(() => {
    let active = true;

    const fresh = cached && Date.now() - cached.at < BADGE_TTL_MS;
    if (fresh && cached) {
      setBadge(cached.value);
      return;
    }

    if (!inFlight) {
      inFlight = (async (): Promise<HoldBadge> => {
        try {
          // Silent: a nav badge must never raise a toast. A failure here means
          // no badge, which is the same as no decisions waiting — and a missing
          // badge is a far better failure than a red toast on every page.
          const res = await fetchRef.current(RUNBOOKS_URL, {}, { silent: true });
          if (!res.ok) return EMPTY;
          const body = (await res.json()) as { summary?: { due?: number; early?: number } };
          return badgeFor(body.summary?.due ?? 0, body.summary?.early ?? 0);
        } catch {
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
