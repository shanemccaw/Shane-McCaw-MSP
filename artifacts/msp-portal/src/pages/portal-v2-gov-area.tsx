/**
 * portal-v2-gov-area.tsx — the three "generic area" Governance drill-downs.
 *
 * A direct port of the prototype's `isGovListPage` (shell 5871-5900),
 * `isGovDriftPage` (5902-5925) and `isGovInventoryPage` (5927-5958). One page
 * component serves all three because the prototype renders them from the same
 * `active` key space and only one is ever on screen — the shape is chosen by
 * which `govXxxPageData` map holds the key, exactly as `govAreaFor` resolves it.
 *
 * ── Why it reads the slug from the location, not a route param ───────────────
 * These slugs collide with `/portal-v2/governance/:area` (the rich GOV_PAGES
 * drill-down, Part 2's), so each is registered as its OWN literal route ABOVE
 * that param route in App.tsx. A literal route carries no `:area` param, so the
 * slug is taken from the last path segment rather than `useParams`.
 *
 * ── Git #1427: honest no-data state, full fixture-strip ──────────────────────
 * #1413's audit found this page read its ENTIRE body — including the title
 * itself — from `govAreaData.ts`'s design fixture with zero `dataState` gating
 * anywhere: worse than a `??` fallback, there was never a live attempt for any
 * of this content. Confirmed no backend exists for any of it (no per-team,
 * per-device, or drift-event producer anywhere in the platform), so per Shane's
 * direction this is a full fixture-strip, not a partial live-wire: `govAreaFor`
 * is still used to resolve a valid slug (→ 404 for an unknown one), but none of
 * its `page`/`rows` are rendered any more. The only things on screen now are a
 * static, count-free category title (`govAreaTitleFor`) and an honest
 * `NoScanDataState` block — same pattern `NoScanDataState.tsx` and
 * `PortalV2LoadingState.tsx` already established platform-wide for "nothing
 * real to show" vs "still loading". `govAreaFor`'s shape resolution and the
 * fixture maps stay in place, unused by this page, as the documented reference
 * for whenever a real per-sub-area backend exists to wire in their place.
 */

import { Link, useLocation } from "wouter";

import NotFound from "@/pages/not-found";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { govAreaDetailFor, govAreaFor, govAreaTitleFor } from "@/components/portal-v2/govAreaModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { NoScanDataState } from "@/components/portal-v2/NoScanDataState";

const BACK_LINK: React.CSSProperties = {
  alignSelf: "flex-start",
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "11.5px",
  fontWeight: 600,
  color: "#64748b",
  fontFamily: "inherit",
};

const CONTAINER: React.CSSProperties = {
  position: "relative",
  maxWidth: 900,
  margin: "0 auto",
  padding: "28px 28px 56px",
  display: "flex",
  flexDirection: "column",
  gap: 18,
  boxSizing: "border-box",
};

export default function PortalV2GovAreaPage() {
  const [location] = useLocation();
  const slug = location.split("/").filter(Boolean).pop();
  const area = govAreaFor(slug);

  // Reads the governance pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-govarea-source` proves the page is on real data.
  // The per-sub-area object lists / drift events / stat rows this page used to
  // fabricate have no per-sub-area server producer at all (the payload scores the
  // pillar as a whole, not each governance area) — Git #1427 stopped rendering
  // them rather than leave a partial wire with nothing real to gate on.
  const live = useLivePillarHero("governance");

  if (!area) return <NotFound />;

  // Git #1427: a static, count-free category label — NOT the fixture's
  // `area.page.title`, which baked in a fabricated per-tenant fact (e.g. "5
  // Teams have no active members"). `govAreaFor` already proved `slug` resolves,
  // so `govAreaTitleFor`/`govAreaDetailFor` are guaranteed non-null here.
  const title = govAreaTitleFor(slug) ?? "Governance";
  const detail = govAreaDetailFor(slug);

  return (
    <PortalV2Shell eyebrow="Governance" title={title}>
      <div style={CONTAINER} data-testid="pv2-govarea-page">
        <Link href="/portal-v2/governance" data-testid="pv2-govarea-back" style={BACK_LINK}>
          ← Governance
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}
            data-testid="pv2-govarea-heading"
          >
            {title}
          </span>
        </div>

        {/* Git #1427: no shape-specific fixture rendering left — every field
            this page ever showed (list rows, drift events, stat tiles,
            inventory rows) was 100% fabricated with no live counterpart, so
            all three shapes now render the same honest empty state. */}
        <NoScanDataState testId="pv2-govarea-empty" detail={detail} />
      </div>
      <PillarLiveSource testId="pv2-govarea-source" live={live} />
    </PortalV2Shell>
  );
}
