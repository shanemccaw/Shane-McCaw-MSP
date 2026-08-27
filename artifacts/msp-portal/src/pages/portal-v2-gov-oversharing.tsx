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

import {
  ChevronDown,
  Eye,
  GitCommitHorizontal,
  Key,
  Mail,
  Pencil,
  Users,
  Wrench,
} from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk, type AcceptRiskSpec } from "@/components/portal-v2/AcceptRiskPanel";
import { Pager } from "@/components/portal-v2/Pager";
import { RunbookSteps } from "@/components/portal-v2/RunbookSteps";
import {
  ADMIN_HEADER,
  ADMIN_WORD,
  ANON_LINKS_PAGE_SIZE,
  CONVERT_TO_PRIVATE_STEPS,
  GUEST_HEADER,
  GUEST_WORD,
  LINK_STATUS_FILTERS,
  MANAGE_GUESTS_STEPS,
  OVERSHARING_ANON_LINKS,
  OVERSHARING_DESC,
  OVERSHARING_HEADING,
  OVERSHARING_LIST_LABEL,
  OVERSHARING_SITES,
  OVERSHARING_STATS,
  OVERSHARING_STATUS_VISUAL,
  OVERSHARING_TOP_RISKS,
  REDUCE_ADMINS_STEPS,
  SITES_PAGE_SIZE,
  SITE_VIS_FILTERS,
  type OversharingStat,
  type SitePrincipal,
} from "@/components/portal-v2/govOversharingData";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { useOversharingSitesLive, type OversharingSiteWire } from "@/components/portal-v2/govOversharingSitesLive";
import { useOversharingRunbooksLive } from "@/components/portal-v2/govOversharingRunbooksLive";

/** Which lucide glyph each `iconSvg` name in the fixture maps to. 1:1 per README. */
const STAT_ICON = {
  mail: Mail,
  users: Users,
  key: Key,
  "git-commit": GitCommitHorizontal,
} as const;

/** The runbook a per-site action opens. `sopKind` in the prototype (11341-11346). */
type SopKind = "convert" | "reduceAdmins" | "manageGuests";

const RUNBOOKS: Record<SopKind, readonly string[]> = {
  convert: CONVERT_TO_PRIVATE_STEPS,
  reduceAdmins: REDUCE_ADMINS_STEPS,
  manageGuests: MANAGE_GUESTS_STEPS,
};

/* ── Expression-built styles, transcribed from the prototype's builders ───── */

/** `sc.cardCss` / `sc.glowCss` (11178-11179) — note the pad and value size vary by tone. */
function statCardStyle(stat: OversharingStat): React.CSSProperties {
  const v = OVERSHARING_STATUS_VISUAL[stat.status];
  return {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    background: v.wash,
    border: `1px solid ${v.c}38`,
    borderRadius: 10,
    padding: v.pad,
  };
}

function statGlowStyle(stat: OversharingStat): React.CSSProperties {
  const v = OVERSHARING_STATUS_VISUAL[stat.status];
  return {
    position: "absolute",
    inset: 0,
    background: `radial-gradient(ellipse 140% 100% at 0% 0%, ${v.c}18, transparent 60%)`,
    pointerEvents: "none",
  };
}

const STAT_LABEL: React.CSSProperties = {
  position: "relative",
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#64748b",
};

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

const MENU_ITEM: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  border: "none",
  background: "none",
  color: "#e2e8f0",
  fontSize: "12px",
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
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();

  // `manuallyAcceptedSiteIds` / `manuallyAcceptedLinkIds` (6415-6416). A
  // fixture site's id is numeric; a real site's is a Graph GUID string —
  // `string[]` covers both via `String(id)`.
  const [acceptedSiteIds, setAcceptedSiteIds] = useState<string[]>([]);
  const [acceptedLinkIds, setAcceptedLinkIds] = useState<number[]>([]);

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
      if (spec.kind === "link" && spec.id != null) {
        setAcceptedLinkIds((ids) => [...ids, Number(spec.id)]);
      }
    },
    onAskShaneBot: askShaneBot,
  });

  // Reads the governance pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-ovr-source` proves the page is on real data. The
  // per-anonymous-link inventory and the top-risks list still need a per-object
  // feed the war-room-pillars payload does not carry, so those rows stay
  // fixture — a documented backend gap, not fabricated data. The per-site
  // admins/guests list below has its OWN real feed (#1286) — see `sitesLive`.
  const live = useLivePillarHero("governance");
  const sitesLive = useOversharingSitesLive();

  return (
    <PortalV2Shell eyebrow="Governance" title={OVERSHARING_HEADING}>
      <OversharingBody
        sites={sitesLive.sites}
        sitesDataState={sitesLive.dataState}
        sitesLoading={sitesLive.loading}
        acceptedSiteIds={acceptedSiteIds}
        acceptedLinkIds={acceptedLinkIds}
        onFix={openFixPanel}
        onAcceptRisk={openAcceptRisk}
      />

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) =>
            askShaneBot(
              `Explain this finding to me before I approve the change: ${playbook.title}`,
            )
          }
          onAcceptRisk={(playbook) => {
            closeFixPanel();
            openAcceptRisk({
              title: playbook.title,
              description: playbook.description,
              details:
                "Accepting instead of fixing suppresses this finding’s points in the pillar score and mutes its alerts, and puts it on the risk register with your name, a rationale and a review date. It stays visible as an accepted risk. No change request is raised because nothing changes in the tenant.",
              kicker: "Accept instead of fixing",
            });
          }}
        />
      )}
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
  acceptedLinkIds,
  onFix,
  onAcceptRisk,
}: {
  sites: readonly OversharingSiteWire[];
  sitesDataState: "live" | "fixture";
  sitesLoading: boolean;
  acceptedSiteIds: string[];
  acceptedLinkIds: number[];
  onFix: (key: string) => void;
  onAcceptRisk: (spec: AcceptRiskSpec) => void;
}) {
  const [topRisksOpen, setTopRisksOpen] = useState(false);
  const [siteVisFilter, setSiteVisFilter] = useState("all");
  const [linkStatusFilter, setLinkStatusFilter] = useState("all");
  const [sitesPage, setSitesPage] = useState(1);
  const [linksPage, setLinksPage] = useState(1);
  const [siteExpanded, setSiteExpanded] = useState<string | null>(null);
  const [linkMenuOpen, setLinkMenuOpen] = useState<number | null>(null);

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

  /* ── Links: filter → page → slice (11220-11224) ─────────────────────────── */

  const linksFiltered = useMemo(
    () =>
      OVERSHARING_ANON_LINKS.filter(
        (l) => linkStatusFilter === "all" || l.status === linkStatusFilter,
      ),
    [linkStatusFilter],
  );
  const linksTotalPages = Math.max(1, Math.ceil(linksFiltered.length / ANON_LINKS_PAGE_SIZE));
  const linksPageClamped = Math.min(linksPage, linksTotalPages);
  const linkRows = linksFiltered.slice(
    (linksPageClamped - 1) * ANON_LINKS_PAGE_SIZE,
    linksPageClamped * ANON_LINKS_PAGE_SIZE,
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

      {/* ── Stat cards (4696-4713) ──────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 10,
        }}
        data-testid="pv2-ovr-stats"
      >
        {OVERSHARING_STATS.map((s) => {
          const v = OVERSHARING_STATUS_VISUAL[s.status];
          const Glyph = STAT_ICON[s.icon];
          return (
            <div key={s.label} style={statCardStyle(s)} data-testid="pv2-ovr-stat">
              <div style={statGlowStyle(s)} />
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ display: "flex" }}>
                  <Glyph size={13} color={v.c} strokeWidth={2} aria-hidden="true" />
                </span>
                {s.showFix && s.fixKey && (
                  <button
                    onClick={() => onFix(s.fixKey!)}
                    title="Fix via Graph"
                    data-testid={`pv2-ovr-stat-fix-${s.fixKey}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      border: "1px solid rgba(248,113,113,.4)",
                      background: "rgba(248,113,113,.08)",
                      cursor: "pointer",
                    }}
                  >
                    <Wrench size={12} color={v.c} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
              <span style={STAT_LABEL}>{s.label}</span>
              <span
                style={{
                  position: "relative",
                  fontSize: `${v.valSize}px`,
                  fontWeight: 800,
                  color: "#f8fafc",
                  letterSpacing: "-.01em",
                  overflowWrap: "anywhere",
                  lineHeight: 1.25,
                }}
              >
                {s.value}
              </span>
              <span
                style={{ position: "relative", fontSize: "10px", color: "#64748b", lineHeight: 1.3 }}
              >
                {s.sub}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── "View Top Risks (n)" rule-and-label toggle (4715-4741) ───────── */}
      <button
        onClick={() => setTopRisksOpen((o) => !o)}
        data-testid="pv2-ovr-top-risks-toggle"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "none",
          border: "none",
          padding: "2px 0",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
        <span
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#f87171",
              whiteSpace: "nowrap",
            }}
          >
            View Top Risks ({OVERSHARING_TOP_RISKS.length})
          </span>
          <Chevron deg={topRisksOpen ? 180 : 0} color="#f87171" size={11} />
        </span>
        <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
      </button>

      {topRisksOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            border: "1px solid rgba(248,113,113,.25)",
            borderRadius: 12,
            background: "rgba(248,113,113,.04)",
            overflow: "hidden",
          }}
          data-testid="pv2-ovr-top-risks"
        >
          {OVERSHARING_TOP_RISKS.map((risk, i) => (
            <div
              key={risk}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 18px",
                borderTop: i === 0 ? "none" : "1px solid rgba(248,113,113,.15)",
                fontSize: "12.5px",
                color: "#e2e8f0",
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: "#f87171", flex: "0 0 auto" }}>·</span>
              {risk}
            </div>
          ))}
        </div>
      )}

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

        {/* ── Anonymous Links (4936-5005) ──────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
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
              <span style={SECTION_LABEL}>Anonymous Links</span>
              <div style={{ display: "flex", gap: 5 }}>
                {LINK_STATUS_FILTERS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => {
                      setLinkStatusFilter(o.key);
                      setLinksPage(1);
                    }}
                    data-testid={`pv2-ovr-link-filter-${o.key}`}
                    style={filterPillStyle(linkStatusFilter === o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={LIST_PANEL} data-testid="pv2-ovr-links">
              {linkRows.map((l) => {
                const riskAccepted = acceptedLinkIds.includes(l.id);
                const isEdit = l.type === "Edit";
                const typeColor = isEdit ? "#f87171" : "#94a3b8";
                const TypeGlyph = isEdit ? Pencil : Eye;
                return (
                  <div
                    key={l.id}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 8,
                      padding: "11px 18px",
                      borderTop: "1px solid rgba(30,41,59,.7)",
                      ...(riskAccepted
                        ? { opacity: 0.75, background: "rgba(52,211,153,.03)" }
                        : null),
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>
                        {l.file}
                      </span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{l.site}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: "11px", color: "#475569" }}>Permissions:</span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: "11.5px",
                            fontWeight: 500,
                            color: typeColor,
                          }}
                        >
                          <TypeGlyph size={10} color={typeColor} strokeWidth={2} aria-hidden="true" />
                          {l.type}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: "10.5px",
                          color: l.status === "expired" ? "#64748b" : "#34d399",
                          fontWeight: 600,
                        }}
                      >
                        {l.status === "expired" ? "Expired" : "Active"}
                      </span>
                      {riskAccepted && <span style={ACCEPTED_PILL}>Risk accepted</span>}
                      <div style={{ position: "relative", marginLeft: "auto" }}>
                        <button
                          onClick={() => setLinkMenuOpen(linkMenuOpen === l.id ? null : l.id)}
                          data-testid={`pv2-ovr-link-options-${l.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(30,41,59,.9)",
                            background: "rgba(255,255,255,.02)",
                            color: "#cbd5e1",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          Options
                          <ChevronDown size={11} color="#94a3b8" strokeWidth={2} aria-hidden="true" />
                        </button>
                        {linkMenuOpen === l.id && (
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 36,
                              zIndex: 20,
                              width: 130,
                              border: "1px solid rgba(30,41,59,.9)",
                              borderRadius: 8,
                              background: "#0b1524",
                              boxShadow: "0 12px 30px rgba(2,6,23,.5)",
                              overflow: "hidden",
                            }}
                          >
                            <button style={MENU_ITEM}>View</button>
                            <button
                              style={{ ...MENU_ITEM, borderTop: "1px solid rgba(30,41,59,.7)" }}
                            >
                              Expire
                            </button>
                            <button
                              onClick={() => {
                                setLinkMenuOpen(null);
                                onAcceptRisk({
                                  kind: "link",
                                  id: l.id,
                                  title: `Accept risk — ${l.file}`,
                                  description: `This anonymous link grants ${isEdit ? "edit" : "view"} access to anyone with the URL, no sign-in required. Accepting this risk records that your organization has reviewed this exposure and chosen not to remove the link right now.`,
                                  details: l.site,
                                });
                              }}
                              data-testid={`pv2-ovr-link-accept-${l.id}`}
                              style={{
                                ...MENU_ITEM,
                                color: "#94a3b8",
                                borderTop: "1px solid rgba(30,41,59,.7)",
                              }}
                            >
                              Accept risk
                            </button>
                            <button
                              style={{
                                ...MENU_ITEM,
                                color: "#f87171",
                                borderTop: "1px solid rgba(30,41,59,.7)",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Pager
              page={linksPageClamped}
              totalPages={linksTotalPages}
              onPage={setLinksPage}
              testIdPrefix="pv2-ovr-links"
            />
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
