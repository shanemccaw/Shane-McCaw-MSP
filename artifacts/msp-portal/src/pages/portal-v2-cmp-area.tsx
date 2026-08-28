/**
 * portal-v2-cmp-area.tsx — the Compliance cluster-area drill-down.
 *
 * The destination for every `/portal-v2/compliance/<area>` link the Compliance
 * pillar's cluster cards emit (Git #1388). Before this page those links were
 * true 404s: Compliance had explicit routes only for open-gaps / decisions /
 * obligations — none of which is an area-card destination — and, unlike
 * Governance, no `:area` wildcard fallback at all. This restores the Governance
 * precedent: one `/portal-v2/compliance/:area` wildcard route feeding one
 * data-driven detail page, with a graceful NotFound for an unknown slug.
 *
 * ── What each card shows, honestly ───────────────────────────────────────────
 * The prototype's cards were never separate pages; a card `navGo` (shell 13969)
 * expanded a finding inline when the card carried one, and was inert otherwise.
 * There is therefore no bespoke per-area design content to port, and the
 * "copy is final, never fabricate" rule forbids inventing 11 new content blocks.
 * So:
 *   • A finding-backed card (6 of the 14) renders that finding's real detail —
 *     obligation, why-it-matters, the evidence grid, the wrench into the CR gate
 *     and the "record a policy decision instead" route — the same design-final
 *     copy the Open gaps drill-down renders, from `cmpDrilldownData`.
 *   • The other cards render an honest pointer into the compliance registers
 *     (Open gaps / Documented decisions / Obligations) rather than a fabricated
 *     drill-down.
 * The card's live/fixture/no-data STATUS is resolved through the same
 * `resolveCmpArea` seam the dashboard card uses, and `pv2-cmparea-source` states
 * which is on screen — the finding BODY stays design fixture (no per-sub-area
 * server producer exists), exactly as the Governance detail page documents.
 *
 * Git #1433: that fixture body is gated on `!nodata`, not just "has a
 * finding". Of the 6 finding-backed cards, 3 (compliance-disposition,
 * compliance-preservation-lock, compliance-holds) are classified `nodata` by
 * `cmpAreaWiring.ts` — no producing check exists for them at all — and used
 * to render the honest "Not measured" status pill directly above a fully
 * fabricated finding body with invented counts (#1415's finding). Those 3
 * now fall through to the same honest register-pointer block the inert
 * (non-finding) cards render. The other 3 finding-backed cards stay `live`
 * status + fixture body, the documented lower-priority case (matches
 * security/oauth in #1414).
 *
 * Git #1440 — that gate widened twice more, both real leaks a live re-audit
 * found on this exact page:
 *   • `resolveCmpArea` now also takes `everScanned` (real, `useScanStatus`).
 *     An empty finding map is ambiguous between "never scanned" and "scanned
 *     and genuinely healthy" — before this, a never-scanned tenant resolved
 *     `live`/green for every backed area, and this page's `!nodata` gate let
 *     the fixture finding body through underneath it: a fully fabricated,
 *     specific, alarming finding ("12 mailboxes are not covered…") for a
 *     tenant that had never been scanned at all.
 *   • The gate is now `dataState === "live" && liveStatus !== "green"`, not
 *     `!nodata`. A genuinely live, HEALTHY check (green, no open finding)
 *     was still rendering the fixture finding body — a direct on-page
 *     contradiction between an honest green "Documented and covered" pill
 *     and a fabricated paragraph describing an active problem underneath it,
 *     the same category of bug #1415 fixed for the nodata cards.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";

import NotFound from "@/pages/not-found";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { useScanStatus } from "@/lib/scan-status-context";
import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { cmpAreaFor } from "@/components/portal-v2/cmpAreaModel";
import { CMP_MONO, type CmpFinding } from "@/components/portal-v2/cmpDrilldownData";
import { cmpSevMeta } from "@/components/portal-v2/cmpDrilldownModel";
import {
  buildCmpFindingSeverityMap,
  resolveCmpArea,
} from "@/components/portal-v2/cmpAreaWiring";
import { CMP_STATUS_META } from "@/components/portal-v2/cmpDashboardData";

/** The muted slate an honest no-data card paints itself in (matches the dashboard). */
const NODATA_COLOR = "#64748b";

/**
 * Same telemetry channel the rest of the Compliance/Dashboard journey beacons
 * on (`engine.dashboard`, reserved for the Dashboard / Web Part System) — see
 * useCopilotJourney.ts's own note: there is no client-side `logger.child` in
 * this app, so `reportClientEvent` posting to `/api/client-events` (which the
 * server binds to a real `logger.child({ channel })`) is how a client
 * component reaches the log stream.
 */
const CMP_AREA_CHANNEL = "engine.dashboard";

function WrenchIcon({ color = "#60a5fa", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

// Generic role labels only — no invented tenant people, same reasoning as the
// Open gaps drill-down (Git #1342): the accept-decision form must never suggest
// a fictional name on a real customer's page.
const OWNER_OPTIONS = ["General Counsel", "Controller", "IT Director", "Data Protection Officer"].map((v) => ({ value: v, label: v }));
const REVIEW_OPTIONS = ["3 months", "6 months", "12 months"].map((v) => ({ value: v, label: v }));

export default function PortalV2ComplianceAreaPage() {
  const params = useParams<{ area?: string }>();
  const resolved = cmpAreaFor(params.area);

  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();
  const [findingOpen, setFindingOpen] = useState(true);

  // Same live seam the dashboard card uses, so the status pill on this page and
  // the card that linked here agree. The finding BODY has no per-sub-area server
  // producer, so it stays design fixture (documented gap) UNLESS the card is
  // itself classified `nodata` (Git #1433) — see `showFinding` below.
  const live = useLivePillarHero("compliance");
  const cmpFindingSeverity = buildCmpFindingSeverityMap(live.pillars);
  // Real signal (#1440) distinguishing "never scanned" from "scanned and
  // genuinely healthy" — an empty finding map means something different in
  // each case, and only this field tells them apart (cmpAreaWiring.ts).
  const scanStatus = useScanStatus();
  const everScanned = scanStatus.data?.everScanned === true;

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [{ id: "question", label: "Your question", kind: "textarea", wide: true, placeholder: "What would you like to know about this?" }],
      doneTitle: "Sent",
      doneNote: "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({ onConfirm: () => {}, onAskShaneBot: askShaneBot });

  const recordDecision = (f: CmpFinding) =>
    openForm({
      kicker: "Policy decision from " + f.id,
      title: "Record a policy decision",
      intro:
        "This gap stays visible, but as a position with a name against it rather than a finding. Prefilled from " +
        f.id +
        " — change anything that is not right.",
      submitLabel: "Record it, awaiting sign-off",
      fields: [
        { id: "gap", label: "The gap", value: f.title, wide: true },
        { id: "obligation", label: "Obligation it touches", value: f.obligation, wide: true },
        { id: "owner", label: "Accountable name", kind: "select", options: OWNER_OPTIONS, value: "General Counsel" },
        { id: "rationale", label: "Why this is the right position", kind: "textarea", wide: true, value: "" },
        { id: "control", label: "Compensating control", kind: "textarea", wide: true, value: "" },
        { id: "review", label: "Review in", kind: "select", options: REVIEW_OPTIONS, value: "12 months" },
      ],
      doneTitle: "Recorded",
      doneNote: f.id + " recorded as a policy decision, awaiting sign-off.",
    });

  // areaRes/nodata computed unconditionally (guarded for an unresolved slug)
  // so every hook below runs on every render, unknown-slug or not — the
  // `if (!resolved) return <NotFound />` below must stay AFTER every hook
  // call, never between them.
  const areaRes = resolved
    ? resolveCmpArea(resolved.link.key, cmpFindingSeverity, live.loaded, everScanned)
    : null;
  const notLive = areaRes?.dataState !== "live";
  const nodata = areaRes?.dataState === "nodata";
  // Git #1433: a finding-backed card whose real check is classified `nodata`
  // must never render the fabricated finding body underneath its own honest
  // "Not measured" pill — that was a direct on-page contradiction (#1415).
  // Those 3 cards (compliance-disposition, compliance-preservation-lock,
  // compliance-holds) fall through to the same honest register-pointer block
  // the inert (no-finding) cards already render.
  //
  // Git #1440 — two further widenings of that same guard:
  //   • `areaRes?.dataState === "live"` (not just "not nodata") gates it now:
  //     a real check with NO completed scan for this tenant is exactly as
  //     unable to state a real finding as a no-check card is — showing the
  //     fixture finding body for a never-scanned tenant asserted a specific,
  //     alarming, invented problem ("12 mailboxes are not covered…") that
  //     nobody had actually measured.
  //   • a genuinely live, HEALTHY check (`liveStatus === "green"`, no open
  //     finding) must not render the fixture body either — that body
  //     describes a specific active problem, directly contradicting an
  //     honest green "Documented and covered" pill sitting right above it.
  // The remaining finding-backed, live, NOT-green cards keep the fixture
  // body, the documented lower-priority case (matches security/oauth in
  // #1414): the STATUS is real, the finding narrative stays design copy.
  const showFinding =
    resolved?.finding != null && areaRes?.dataState === "live" && areaRes.liveStatus !== "green";

  const { accessToken } = useAuth();
  useEffect(() => {
    // Defensive: `finding` comes from `cmpAreaFor`'s static index into
    // CMP_AREA_LINKS/CMP_FINDINGS, independent of cmpAreaWiring.ts's
    // classification map. If a finding-backed card ever resolves nodata with
    // no real backing entry at all (the "No backing classification for this
    // card." fallback, not one of the documented nodata reasons), that is a
    // classification-completeness bug the unit test only catches at test
    // time — beacon it so it also shows up in the live log stream.
    if (
      resolved?.finding &&
      areaRes?.dataState === "nodata" &&
      areaRes.reason === "No backing classification for this card."
    ) {
      reportClientEvent(
        accessToken,
        "CmpAreaFindingUnclassified",
        `Finding-backed area "${resolved.link.key}" has no CMP_AREA_BACKING entry at all.`,
        CMP_AREA_CHANNEL,
        { key: resolved.link.key },
      );
    }
  }, [resolved, areaRes, accessToken]);

  // Unknown slug → NotFound, exactly as the Governance detail page does.
  if (!resolved || !areaRes) return <NotFound />;

  const { link, finding } = resolved;
  const statusMeta = CMP_STATUS_META[
    areaRes.dataState === "live" && areaRes.liveStatus ? areaRes.liveStatus : link.status
  ];
  // Honest for both "nodata" (no producing check) and "fixture" (a real check
  // but no completed scan for this tenant, #1440) — neither has a real status
  // to paint, so both get the muted "Not measured" pill rather than the
  // design's fixture red/yellow/green colour.
  const statusColor = notLive ? NODATA_COLOR : statusMeta.c;
  const statusLabel = notLive ? "Not measured" : statusMeta.label;

  return (
    <PortalV2Shell eyebrow="Compliance" title={link.label}>
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "26px 28px 60px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxSizing: "border-box",
        }}
        data-testid="pv2-cmparea-page"
      >
        <Link
          href="/portal-v2/compliance"
          data-testid="pv2-cmparea-back"
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
          ← Compliance
        </Link>

        {/* ── Header: label, sub, cluster, real status pill ─────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}
            data-testid="pv2-cmparea-heading"
          >
            {link.label}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              {link.cluster}
            </span>
            <span
              data-testid="pv2-cmparea-status"
              title={notLive ? areaRes.reason ?? undefined : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "3px 9px",
                borderRadius: 5,
                border: `1px solid ${statusColor}55`,
                background: `${statusColor}14`,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flex: "0 0 6px" }} />
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  color: statusColor,
                  whiteSpace: "nowrap",
                }}
              >
                {statusLabel}
              </span>
            </span>
            {/* Hidden live/fixture/nodata marker, same convention as pv2-cmp-source. */}
            <span data-testid="pv2-cmparea-source" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              {areaRes.dataState}
            </span>
          </div>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6 }}>
            {/* No fabricated magnitude for a no-data card. */}
            {areaRes.showValue ? `${link.score} ${link.sub}` : link.sub}
          </span>
        </div>

        {/* ── A live finding-backed card renders the finding's real detail ─── */}
        {showFinding && finding ? (
          <FindingBlock
            finding={finding}
            open={findingOpen}
            setOpen={setFindingOpen}
            onFix={openFixPanel}
            onRecordDecision={recordDecision}
          />
        ) : (
          /* ── An inert card points into the compliance registers, honestly ── */
          <div
            data-testid="pv2-cmparea-registers"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "16px 18px",
              border: "1px solid rgba(226,232,240,.14)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
            }}
          >
            <span style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty", maxWidth: "80ch" }}>
              {nodata
                ? "This area has no producing scan check yet, so there is no measured detail to drill into. It is tracked here so the register stays complete."
                : areaRes.dataState === "fixture"
                  ? // A real check backs this area, but this tenant has not
                    // completed a scan yet (#1440) — distinct from `nodata`:
                    // there IS a producer, it just hasn't run for you yet.
                    "This area has a real check behind it, but no completed scan has landed for your tenant yet, so there is no measured detail to drill into."
                  : "This area is tracked in your compliance register. The detail behind it lives with the open gaps, documented decisions and obligations below."}
            </span>
            {notLive && areaRes.reason && (
              <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.55, textWrap: "pretty", maxWidth: "80ch" }}>
                {areaRes.reason}
              </span>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <RegisterLink href="/portal-v2/compliance/open-gaps" testId="pv2-cmparea-link-gaps" label="Open gaps" />
              <RegisterLink href="/portal-v2/compliance/decisions" testId="pv2-cmparea-link-decisions" label="Documented decisions" />
              <RegisterLink href="/portal-v2/compliance/obligations" testId="pv2-cmparea-link-obligations" label="Obligations" />
            </div>
          </div>
        )}
      </div>

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) => askShaneBot(`Explain this finding to me before I approve the change: ${playbook.title}`)}
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
      <PillarLiveSource testId="pv2-cmparea-live-source" live={live} />
    </PortalV2Shell>
  );
}

function RegisterLink({ href, testId, label }: { href: string; testId: string; label: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid rgba(226,232,240,.22)",
        background: "rgba(226,232,240,.05)",
        fontSize: "11.5px",
        fontWeight: 700,
        color: "#e2e8f0",
        textDecoration: "none",
        fontFamily: "inherit",
      }}
    >
      {label} →
    </Link>
  );
}

/**
 * One finding's detail — the same anatomy the Open gaps drill-down row expands
 * into (obligation, why-it-matters, evidence grid, the CR-gate wrench and the
 * record-a-decision route), rendered here for the single finding this area card
 * drills into. Copy is `cmpDrilldownData`'s, verbatim from the prototype.
 */
function FindingBlock({
  finding: f,
  open,
  setOpen,
  onFix,
  onRecordDecision,
}: {
  finding: CmpFinding;
  open: boolean;
  setOpen: (b: boolean) => void;
  onFix: (key: string) => void;
  onRecordDecision: (f: CmpFinding) => void;
}) {
  const sev = cmpSevMeta(f.sev);
  return (
    <div
      data-testid="pv2-cmparea-finding"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid rgba(226,232,240,.13)",
        borderRadius: 12,
        background: "rgba(15,23,42,.4)",
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `${sev.c}66` }} />
      <button
        onClick={() => setOpen(!open)}
        data-testid="pv2-cmparea-finding-toggle"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 18px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ flex: "0 0 auto", fontSize: "10.5px", fontWeight: 700, color: "#64748b", letterSpacing: ".06em", fontFamily: CMP_MONO }}>
              {f.id}
            </span>
            <span
              style={{
                flex: "0 0 auto",
                padding: "2px 8px",
                borderRadius: 4,
                border: `1px solid ${sev.c}55`,
                background: `${sev.c}14`,
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: sev.c,
                whiteSpace: "nowrap",
              }}
            >
              {sev.label}
            </span>
          </div>
          <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4, textWrap: "pretty" }}>
            {f.title}
          </span>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", letterSpacing: ".01em", fontFamily: CMP_MONO }}>
            {f.obligation}
          </span>
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 18px 18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "12px 14px",
              border: "1px solid rgba(226,232,240,.14)",
              borderRadius: 8,
              background: "rgba(226,232,240,.04)",
            }}
          >
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
              The obligation
            </span>
            <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
              {f.obligationText}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }}>
              Why it matters here
            </span>
            <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}>{f.why}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid rgba(30,41,59,.9)" }}>
            {f.evidence.map((e) => (
              <div
                key={e.k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(130px,.85fr) minmax(0,2.15fr)",
                  gap: 14,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(30,41,59,.75)",
                  alignItems: "baseline",
                }}
              >
                <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.4 }}>
                  {e.k}
                </span>
                <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{e.v}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            <button
              onClick={() => onFix(f.fixKey)}
              data-testid={`pv2-cmparea-fix-${f.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                textAlign: "left",
                padding: "11px 13px",
                borderRadius: 9,
                border: "1px solid rgba(0,120,212,.4)",
                background: "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  flex: "0 0 28px",
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  border: "1px solid rgba(0,120,212,.4)",
                  background: "rgba(0,120,212,.14)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <WrenchIcon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#60a5fa", lineHeight: 1.4 }}>{f.fixLabel}</span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45 }}>{f.fixSub}</span>
              </span>
            </button>
            <button
              onClick={() => onRecordDecision(f)}
              data-testid={`pv2-cmparea-decide-${f.id}`}
              style={{
                alignSelf: "flex-start",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(226,232,240,.22)",
                background: "rgba(226,232,240,.05)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>Record a policy decision instead</span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Owner, rationale, review date</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
