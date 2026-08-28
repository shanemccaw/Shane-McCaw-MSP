/**
 * portal-v2-gov-oversharing.tsx — the Overshared SharePoint drill-down.
 *
 * A direct port of the prototype's `isGovOversharingDetail` template
 * (`Customer Portal Shell.dc.html` lines 4671-5057) on its `isRichGovDetail`
 * branch, with every derived value taken from lines 11096-11400.
 *
 * ── This is NOT the same template as portal-v2-gov-detail.tsx ───────────────
 * The handoff README points at "the Overshared SharePoint page
 * (`governance-oversharing-full`)" as the drill-down reference implementation
 * and describes it as purpose → provenance → stat cards → evidence table →
 * policy → wrench fixes. Read against the prototype, that sentence merges three
 * separate sections:
 *
 *   • `isGovDetailV2` (4453-4625) is the section whose anatomy the README
 *     describes. It is GOV_PAGES-driven and is already built as
 *     `portal-v2-gov-detail.tsx`.
 *   • `governance-oversharing` renders THIS section, which has no provenance
 *     block and no tenant-policy block at all, and instead has a collapsed Top
 *     Risks band, two independently paginated + filtered evidence lists, per-row
 *     runbooks with a synthesised verification step, and an accept-risk flow.
 *   • `governance-oversharing-full` (4627-4669) is a third, much smaller page —
 *     the enterprise-scale bulk list. Built as
 *     `portal-v2-gov-oversharing-all.tsx`.
 *
 * The handoff's own rule is that the markup and the logic class are the
 * specification, so the prototype's structure is what is built here rather than
 * the README's summary of it.
 *
 * ── Style values are the prototype's, not house defaults ───────────────────
 * Same discipline as the sibling drill-down: no `Card`, no `Table`, no `Badge`.
 * Two values differ from that page and are NOT typos — the site/link list panels
 * are `rgba(15,23,42,.35)` where the evidence table is `.4`, and this page's
 * container is `max-width:1080px; padding:28px 28px 56px; gap:20px` where the
 * V2 template's is `1320px / 26px 26px 48px / gap:16px`.
 *
 * ── One prototype defect deliberately not reproduced ────────────────────────
 * The anonymous-link row builds its style as `link.rowCss` followed by a
 * space-separated ` flex-direction:column;align-items:stretch;gap:8px` (4952).
 * `rowCss` ends without a semicolon when the link is risk-accepted, so the
 * accepted case produces `background:rgba(52,211,153,.03) flex-direction:column`
 * — one invalid declaration that the browser drops, taking the green tint AND
 * the column layout with it, so an accepted link silently renders as a
 * different shape from every other link. That is a string-concatenation bug, not
 * a design decision; the intended styling is applied here.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";

import { ChevronDown } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import { NoScanDataState } from "@/components/portal-v2/NoScanDataState";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk, type AcceptRiskSpec } from "@/components/portal-v2/AcceptRiskPanel";
import { Pager } from "@/components/portal-v2/Pager";
import { RunbookSteps } from "@/components/portal-v2/RunbookSteps";
import {
  ADMIN_HEADER,
  ADMIN_WORD,
  CONVERT_TO_PRIVATE_STEPS,
  GUEST_HEADER,
  GUEST_WORD,
  MANAGE_GUESTS_STEPS,
  OVERSHARING_DESC,
  OVERSHARING_HEADING,
  OVERSHARING_LIST_LABEL,
  OVERSHARING_SITES,
  REDUCE_ADMINS_STEPS,
  SITES_PAGE_SIZE,
  SITE_VIS_FILTERS,
  type SitePrincipal,
} from "@/components/portal-v2/govOversharingData";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { useOversharingSitesLive, type OversharingSiteWire } from "@/components/portal-v2/govOversharingSitesLive";
import { useOversharingRunbooksLive } from "@/components/portal-v2/govOversharingRunbooksLive";

/** The runbook a per-site action opens. `sopKind` in the prototype (11341-11346). */
type SopKind = "convert" | "reduceAdmins" | "manageGuests";

const RUNBOOKS: Record<SopKind, readonly string[]> = {
  convert: CONVERT_TO_PRIVATE_STEPS,
  reduceAdmins: REDUCE_ADMINS_STEPS,
  manageGuests: MANAGE_GUESTS_STEPS,
};

/* ── Expression-built styles, transcribed from the prototype's builders ───── */

/** `opt.css` on both filter groups (11254 / 11261). */
function filterPillStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 5,
    fontSize: "10.5px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    border: `1px solid ${isActive ? "rgba(59,130,246,.4)" : "rgba(30,41,59,.9)"}`,
    background: isActive ? "rgba(59,130,246,.1)" : "transparent",
    color: isActive ? "#60a5fa" : "#94a3b8",
  };
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const LIST_PANEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
  border: "1px solid rgba(30,41,59,.9)",
  borderRadius: 12,
  background: "rgba(15,23,42,.35)",
  overflow: "hidden",
};

/** The pill used for both an accepted site and an accepted link (4753 / 4967). */
const ACCEPTED_PILL: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "#34d399",
  padding: "2px 8px",
  border: "1px solid rgba(52,211,153,.4)",
  borderRadius: 20,
  background: "rgba(52,211,153,.08)",
  whiteSpace: "nowrap",
};

const GHOST_BTN: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 5,
  fontSize: "11px",
  fontWeight: 600,
  border: "1px solid rgba(30,41,59,.9)",
  background: "transparent",
  color: "#60a5fa",
  cursor: "pointer",
  fontFamily: "inherit",
};

const ACCEPT_BTN: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 5,
  fontSize: "11px",
  fontWeight: 600,
  border: "1px solid rgba(148,163,184,.25)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  fontFamily: "inherit",
};

const RUNBOOK_BTN: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 5,
  fontSize: "11px",
  fontWeight: 600,
  border: "1px solid rgba(0,180,216,.4)",
  background: "rgba(0,180,216,.08)",
  color: "#22d3ee",
  cursor: "pointer",
  fontFamily: "inherit",
};

function Chevron({ deg, color, size }: { deg: number; color: string; size: number }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        display: "flex",
        transform: `rotate(${deg}deg)`,
        transition: "transform 180ms",
      }}
    >
      <ChevronDown size={size} color={color} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PortalV2GovOversharingPage() {
  const { openForm, formElement } = useFormDrawer();

  // `manuallyAcceptedSiteIds` (6415). A fixture site's id is numeric; a real
  // site's is a Graph GUID string — `string[]` covers both via `String(id)`.
  // The prototype's parallel `manuallyAcceptedLinkIds` state is gone with the
  // Anonymous Links panel itself (Git #1426) — there is no live link row left
  // to accept a risk against.
  const [acceptedSiteIds, setAcceptedSiteIds] = useState<string[]>([]);

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [
        {
          id: "question",
          label: "Your question",
          kind: "textarea",
          wide: true,
          placeholder: "What would you like to know about this?",
        },
      ],
      doneTitle: "Sent",
      doneNote:
        "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({
    onConfirm: (spec: AcceptRiskSpec) => {
      if (spec.kind === "site" && spec.id != null) {
        setAcceptedSiteIds((ids) => [...ids, String(spec.id)]);
      }
    },
    onAskShaneBot: askShaneBot,
  });

  // Reads the governance pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-ovr-source` proves the page is on real data.
  // The stat cards band, the Top Risks band, and the Anonymous Links panel all
  // need a per-object feed the war-room-pillars payload does not carry, and no
  // such feed exists anywhere yet — confirmed backend gaps (Git #1413's audit,
  // Git #1426), so all three render the platform's honest no-data state below
  // rather than the fixture content they used to render unconditionally. The
  // per-site admins/guests list below has its OWN real feed (#1286) — see
  // `sitesLive`.
  const live = useLivePillarHero("governance");
  const sitesLive = useOversharingSitesLive();

  return (
    <PortalV2Shell eyebrow="Governance" title={OVERSHARING_HEADING}>
      <OversharingBody
        sites={sitesLive.sites}
        sitesDataState={sitesLive.dataState}
        sitesLoading={sitesLive.loading}
        acceptedSiteIds={acceptedSiteIds}
        onAcceptRisk={openAcceptRisk}
      />

      {acceptRiskElement}
      {formElement}
      <PillarLiveSource testId="pv2-ovr-source" live={live} />
      <PillarLiveSource testId="pv2-ovr-sites-source" live={sitesLive} />
    </PortalV2Shell>
  );
}

/** The page's own display shape — real (`OversharingSiteWire`) and fixture (`OversharingSite`) rows normalize into this. */
interface DisplaySite {
  id: string;
  name: string;
  context: string;
  visibility: string | null;
  admins: SitePrincipal[];
  guests: SitePrincipal[];
  status: "open" | "accepted";
  acceptedOn?: string;
  acceptedTerm?: string;
}

function OversharingBody({
  sites,
  sitesDataState,
  sitesLoading,
  acceptedSiteIds,
  onAcceptRisk,
}: {
  sites: readonly OversharingSiteWire[];
  sitesDataState: "live" | "fixture";
  sitesLoading: boolean;
  acceptedSiteIds: string[];
  onAcceptRisk: (spec: AcceptRiskSpec) => void;
}) {
  const [siteVisFilter, setSiteVisFilter] = useState("all");
  const [sitesPage, setSitesPage] = useState(1);
  const [siteExpanded, setSiteExpanded] = useState<string | null>(null);

  // The runbook open/checked state is per-KIND and global in the prototype
  // (6402-6409), not per-site — the same design this hook's own header
  // documents. Real state via #1286's `useOversharingRunbooksLive`, riding the
  // existing `portal_runbooks` / `portal_runbook_steps` tables rather than a
  // new one.
  const { open: runbookOpen, checkedByKind: runbookChecked, toggleOpen: toggleRunbook, toggleStep: toggleRunbookStep } =
    useOversharingRunbooksLive();

  /* ── Sites: real feed, fallback to fixture (11319-11337 for the shape) ──── */

  const siteRowsAll: readonly DisplaySite[] = useMemo(() => {
    if (sitesDataState === "live") {
      return sites.map((s) => ({
        id: s.id,
        name: s.name ?? "Unnamed site",
        context: s.context,
        visibility: s.visibility,
        admins: s.admins as SitePrincipal[],
        guests: s.guests as SitePrincipal[],
        status: s.status,
      }));
    }
    return OVERSHARING_SITES.map((s) => ({
      id: String(s.id),
      name: s.name,
      context: s.context,
      visibility: s.visibility,
      admins: s.admins,
      guests: s.guests,
      status: s.status,
      acceptedOn: s.acceptedOn,
      acceptedTerm: s.acceptedTerm,
    }));
  }, [sites, sitesDataState]);

  const sitesFiltered = useMemo(
    () =>
      siteRowsAll.filter((s) => {
        const isAccepted = s.status === "accepted" || acceptedSiteIds.includes(s.id);
        if (siteVisFilter === "all") return true;
        if (siteVisFilter === "accepted") return isAccepted;
        if (siteVisFilter === "orphaned") return s.admins.length === 0;
        return (s.visibility ?? "").toLowerCase() === siteVisFilter;
      }),
    [siteRowsAll, siteVisFilter, acceptedSiteIds],
  );
  const sitesTotalPages = Math.max(1, Math.ceil(sitesFiltered.length / SITES_PAGE_SIZE));
  const sitesPageClamped = Math.min(sitesPage, sitesTotalPages);
  const siteRows = sitesFiltered.slice(
    (sitesPageClamped - 1) * SITES_PAGE_SIZE,
    sitesPageClamped * SITES_PAGE_SIZE,
  );

  return (
    <div
      style={{
        position: "relative",
        maxWidth: 1080,
        margin: "0 auto",
        padding: "28px 28px 56px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        boxSizing: "border-box",
      }}
    >
      <Link
        href="/portal-v2/governance"
        data-testid="pv2-ovr-back"
        style={{
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
        }}
      >
        ← Governance
      </Link>

      {/* ── Heading + purpose (4677-4681) ───────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}
          data-testid="pv2-ovr-heading"
        >
          {OVERSHARING_HEADING}
        </span>
        <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
          {OVERSHARING_DESC}
        </span>
      </div>

      {/*
        ── Stat cards (4696-4713) ────────────────────────────────────────
        No endpoint exposes Sharing Capability / External Users / Anonymous
        Links summary / Sharing Drift as a computed set — confirmed via
        #1413's audit and a fresh check of war-room-pillar-stats.ts /
        sharepoint-admin.ts: the tenant sharing-capability read that does
        exist (`getTenantSharingCapability`) lives in monitor-executor.ts's
        scan-time drift machinery, not behind any portal-facing endpoint.
        Per Git #1426, this band renders the platform's honest no-data
        state instead of the fixture `OVERSHARING_STATS` cards it used to
        render unconditionally.
      */}
      <div style={LIST_PANEL} data-testid="pv2-ovr-stats">
        <NoScanDataState
          testId="pv2-ovr-stats-no-data"
          label="No live sharing-posture data available"
          detail="Sharing capability, external users, anonymous links, and sharing-drift stats aren't wired to a live scan yet. No example data is shown."
        />
      </div>

      {/*
        ── Top Risks (4715-4741) ────────────────────────────────────────
        No per-object risk feed exists anywhere for this band — confirmed
        via #1413's audit. Per Git #1426, it renders the platform's honest
        no-data state instead of the fixture `OVERSHARING_TOP_RISKS` list
        (and the "(n)" count it used to advertise, which was itself fixture
        content) it used to render unconditionally.
      */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={SECTION_LABEL}>Top Risks</span>
        <div style={LIST_PANEL} data-testid="pv2-ovr-top-risks">
          <NoScanDataState
            testId="pv2-ovr-top-risks-no-data"
            label="No live top-risks data available"
            detail="There's no per-object risk feed behind this band yet. No example risks are shown."
          />
        </div>
      </div>

      {/* ── Affected Sites (left) + Anonymous Links (right) ──────────────── */}
      <div className="pv2-gov-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={SECTION_LABEL}>{OVERSHARING_LIST_LABEL}</span>
            <div style={{ display: "flex", gap: 5 }}>
              {SITE_VIS_FILTERS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => {
                    setSiteVisFilter(o.key);
                    setSitesPage(1);
                  }}
                  data-testid={`pv2-ovr-site-filter-${o.key}`}
                  style={filterPillStyle(siteVisFilter === o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div style={LIST_PANEL} data-testid="pv2-ovr-sites">
            {sitesLoading ? (
              // Real per-site read in flight: honest skeleton, never the design's
              // fixture sites swapping in after the fact (Git #1365).
              <PortalV2LoadingState rows={4} label="Loading your affected sites…" testId="pv2-ovr-sites-loading" />
            ) : (
            siteRows.map((s) => {
              const manuallyAccepted = acceptedSiteIds.includes(s.id);
              const accepted = s.status === "accepted" || manuallyAccepted;
              const isExpanded = siteExpanded === s.id;
              const acceptedMeta = manuallyAccepted
                ? "Accepted just now"
                : s.acceptedTerm && s.acceptedOn
                  ? `${s.acceptedTerm} · ${s.acceptedOn}`
                  : "Accepted";

              // `siteActions` (11341-11346) — order is fixed by the prototype.
              const siteActions: { label: string; sopKind: SopKind }[] = [];
              if (s.visibility === "Public")
                siteActions.push({ label: "Convert to Private", sopKind: "convert" });
              if (s.admins.length > 2)
                siteActions.push({
                  label: `Reduce ${ADMIN_WORD} to 2 (currently ${s.admins.length})`,
                  sopKind: "reduceAdmins",
                });
              if (s.guests.length > 0)
                siteActions.push({
                  label: `Manage ${GUEST_WORD} access`,
                  sopKind: "manageGuests",
                });

              const acceptRiskGo = () =>
                onAcceptRisk({
                  kind: "site",
                  id: s.id,
                  title: `Accept risk — ${s.name}`,
                  description: `${s.name}${s.visibility ? ` is ${s.visibility.toLowerCase()} and` : ""} exposes ${s.guests.length} ${GUEST_WORD} and ${s.admins.length} ${ADMIN_WORD}. Accepting this risk records that your organization has reviewed this exposure and chosen not to remediate it right now.`,
                  details: s.context,
                });

              return (
                <div
                  key={s.id}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    borderTop: "1px solid rgba(30,41,59,.8)",
                    ...(accepted
                      ? { opacity: 0.75, background: "rgba(52,211,153,.03)" }
                      : null),
                  }}
                >
                  <button
                    onClick={() => setSiteExpanded(isExpanded ? null : s.id)}
                    data-testid={`pv2-ovr-site-${s.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 18px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <Chevron deg={isExpanded ? 180 : -90} color="#60a5fa" size={13} />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>
                        {s.name}
                      </span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{s.context}</span>
                    </div>
                    {accepted && <span style={ACCEPTED_PILL}>Risk accepted</span>}
                    {s.visibility && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: s.visibility === "Public" ? "#f87171" : "#34d399",
                        }}
                      >
                        {s.visibility}
                      </span>
                    )}
                    <span style={{ fontSize: "11px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {s.admins.length} {ADMIN_WORD}
                    </span>
                    <span style={{ fontSize: "11px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {s.guests.length} {GUEST_WORD}
                    </span>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: "4px 18px 16px 44px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {accepted && (
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 700,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            color: "#34d399",
                            padding: "3px 8px",
                            border: "1px solid rgba(52,211,153,.35)",
                            borderRadius: 5,
                            width: "fit-content",
                          }}
                        >
                          Risk accepted · {acceptedMeta}
                        </span>
                      )}

                      <div
                        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
                      >
                        <PrincipalColumn
                          header={ADMIN_HEADER}
                          people={s.admins}
                          testId={`pv2-ovr-site-${s.id}-admins`}
                        />
                        <PrincipalColumn
                          header={GUEST_HEADER}
                          people={s.guests}
                          withRole
                          testId={`pv2-ovr-site-${s.id}-guests`}
                        />
                      </div>

                      {siteActions.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            paddingTop: 8,
                            borderTop: "1px solid rgba(30,41,59,.7)",
                          }}
                        >
                          {siteActions.map((act) => (
                            <div
                              key={act.sopKind}
                              style={{ display: "flex", flexDirection: "column", gap: 0 }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 12,
                                }}
                              >
                                <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                                  {act.label}
                                </span>
                                <button
                                  onClick={() => toggleRunbook(act.sopKind)}
                                  data-testid={`pv2-ovr-runbook-${act.sopKind}`}
                                  style={RUNBOOK_BTN}
                                >
                                  View runbook
                                </button>
                              </div>
                              {runbookOpen[act.sopKind] && (
                                <RunbookSteps
                                  steps={RUNBOOKS[act.sopKind]}
                                  checked={runbookChecked[act.sopKind]}
                                  onToggle={(i) => toggleRunbookStep(act.sopKind, i)}
                                  testIdPrefix={`pv2-ovr-${act.sopKind}`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {!accepted && (
                        <div
                          style={{
                            display: "flex",
                            paddingTop: 8,
                            borderTop: "1px solid rgba(30,41,59,.7)",
                          }}
                        >
                          <button
                            onClick={acceptRiskGo}
                            data-testid={`pv2-ovr-site-accept-${s.id}`}
                            style={ACCEPT_BTN}
                          >
                            Accept risk
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
            )}
          </div>

          <Pager
            page={sitesPageClamped}
            totalPages={sitesTotalPages}
            onPage={setSitesPage}
            testIdPrefix="pv2-ovr-sites"
          />
        </div>

        {/*
          ── Anonymous Links (4936-5005) ────────────────────────────────
          A live endpoint DOES exist for this data (`useOversharingItemsLive`,
          Git #1275, already powers -all.tsx's real paginated read) but its
          wire row (`portal-oversharing-items.ts`) has no expiry/`active`-vs-
          `expired` field at all, and "Edit vs View" would have to be
          inferred from `grant.roles` rather than a direct field. That's a
          real schema/product decision, not a mechanical rewire, so per
          Git #1426 this panel renders the platform's honest no-data state
          rather than guess at the mapping or keep the fixture
          `OVERSHARING_ANON_LINKS` rows it used to render unconditionally.
        */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={SECTION_LABEL}>Anonymous Links</span>

            <div style={LIST_PANEL} data-testid="pv2-ovr-links">
              <NoScanDataState
                testId="pv2-ovr-links-no-data"
                label="No live anonymous-links data available"
                detail="This panel needs an expiry/active-status mapping decision before it can wire to the real oversharing-items feed. No example links are shown."
              />
            </div>
          </div>
        </div>
      </div>

      {/*
        The all-resolved state (proto 4683-4692) is deliberately not rendered: it
        is gated on `tenantStage === 'good'`, a prototype-only prop with no
        counterpart in this build, and its panel is the one place in the whole
        design that uses an emoji — which the handoff forbids outright. Its copy
        and the `ACCEPTED_SITES_COUNT` / `ITEM_WORD` values it interpolates stay
        with the fixture so wiring a real resolved state later is a render
        change, not a re-derivation.
      */}
    </div>
  );
}

/** The Site Admins / Guest Members columns (4764-4790). */
function PrincipalColumn({
  header,
  people,
  withRole,
  testId,
}: {
  header: string;
  people: { name: string; upn: string; role?: string }[];
  withRole?: boolean;
  testId: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "#64748b",
        }}
      >
        {header} ({people.length})
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          maxHeight: 180,
          overflowY: "auto",
          paddingRight: 6,
        }}
        data-testid={testId}
      >
        {people.map((p) => (
          <div key={p.upn + p.name} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <span style={{ fontSize: "12.5px", color: "#e2e8f0" }}>
              {withRole ? `${p.name} · ${p.role}` : p.name}
            </span>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{p.upn}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
