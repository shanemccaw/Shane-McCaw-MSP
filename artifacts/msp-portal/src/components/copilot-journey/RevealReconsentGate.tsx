/**
 * RevealReconsentGate.tsx — #370. What the Reveal shows in place of the scroll
 * experience when the tenant's own real Microsoft consent state is broken.
 *
 * The consent DETECTION is not this file's concern and must never be
 * reimplemented here: `useReconsentKind()` (reconsent-pill.tsx) is the single
 * source of truth, reading the same `useScanStatus()` payload the rest of this
 * page already consumes. That hook already ranks graph-broken /
 * graph-scope-upgrade / sharepoint correctly and already drives the existing
 * `<ReconsentPill />` used everywhere else in the portal (e.g. `/dashboard`).
 *
 * What this file adds is PLACEMENT. `ReconsentPill` is built for a persistent
 * left-nav sidebar — "a small amber pill... it nudges, it doesn't interrupt"
 * per its own doc comment — and the Reveal is deliberately full-bleed with no
 * nav for the pill to live in. A customer whose Graph access is broken has
 * nothing real for the scroll experience to reveal, so rather than a quiet nav
 * nudge sitting under a page silently rendering stale/empty data, this is a
 * full-screen state that replaces the Reveal outright and reuses the pill's own
 * click-through action (`useStartReconsent`) rather than a second consent path.
 */

import { BRAND, INK, RADIUS } from "./journeyTokens.ts";
import { type ReconsentKind, useStartReconsent } from "@/components/reconsent-pill.tsx";

const COPY: Readonly<Record<Exclude<ReconsentKind, null>, { eyebrow: string; title: string; detail: string; cta: string }>> = {
  "graph-broken": {
    eyebrow: "Access disconnected",
    title: "Your Microsoft 365 connection is no longer active",
    detail:
      "We can't read your tenant's real signals right now, so there's nothing genuine to show here. Re-approve access to pick up where your readiness scan left off.",
    cta: "Reconnect Microsoft 365",
  },
  "graph-scope-upgrade": {
    eyebrow: "Permission update needed",
    title: "Additional Microsoft 365 permissions are available",
    detail:
      "Your access is still working, but this report now needs a few permissions your tenant hasn't approved yet. Approve them to see your full readiness picture.",
    cta: "Approve new permissions",
  },
  sharepoint: {
    eyebrow: "SharePoint access needed",
    title: "SharePoint access hasn't been approved for your tenant yet",
    detail:
      "SharePoint is a separate Microsoft resource from the rest of your Microsoft 365 access, and it needs its own one-time approval before your full readiness picture can include it.",
    cta: "Approve SharePoint access",
  },
};

export function RevealReconsentGate({ kind }: { kind: Exclude<ReconsentKind, null> }) {
  const { start, starting, error } = useStartReconsent();
  const copy = COPY[kind];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: BRAND.canvas,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "5vh 5vw",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, textAlign: "center", alignItems: "center" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: "#fbbf24",
          }}
        >
          {copy.eyebrow}
        </span>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", color: INK.headingDark }}>
          {copy.title}
        </span>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.6, color: INK.bodyDark }}>
          {copy.detail}
        </p>
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          style={{
            marginTop: 10,
            padding: "10px 22px",
            borderRadius: RADIUS.control,
            border: `1px solid ${BRAND.blue}`,
            background: BRAND.blue,
            color: BRAND.white,
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: starting ? "default" : "pointer",
            opacity: starting ? 0.7 : 1,
          }}
        >
          {starting ? "Opening Microsoft…" : error ? "Retry" : copy.cta}
        </button>
        {error ? (
          <span style={{ fontSize: 12.5, fontWeight: 500, color: "#f87171" }}>{error}</span>
        ) : null}
      </div>
    </div>
  );
}
