/**
 * copilot-readiness-remediation-tracker.tsx — the Remediation Tracker as its
 * own destination, not a pane inside the document reader.
 *
 * The tracker was designed in `Design/Remediation Tracker.dc.html` as a full
 * post-purchase project dashboard. The first build to land this route reused
 * `LiveRemediationGuideBody` — document 8 of 9, the flat "Full Remediation
 * Guide" runbook — which is a real, correct, separately-designed document
 * that stays exactly as it is (see `copilot-readiness-documents.tsx`, which
 * still mounts it for `doc.title === JOURNEY_REMEDIATION_DOCUMENT`), but was
 * never the design this route was meant to render. This route now mounts
 * `LiveRemediationTrackerBody` (`RemediationTrackerBody.tsx`) instead — the
 * actual dashboard: digest, phase progress, the live Copilot Gate score, a
 * 6-pillar strip, the same real steps grouped into 3 priced phases, an
 * evidence pack, and a sticky "hire Shane for what's left" footer. See that
 * file's own header for exactly what is reused unchanged (the step catalogue,
 * script substitution, and the Guide's own `Step` row) versus deliberately
 * left out (ShaneBot, a fake per-phase rescan button, an invented schedule).
 *
 * This page still owns only the outer chrome (back button, gate chip,
 * tenant-name lookup, "All reports", sign out) and the two live fetches the
 * body needs (`view`, and — inside `LiveRemediationTrackerBody` — the tracker
 * state and the five fillable scripts' live parameters). Nothing here
 * duplicates any of that.
 *
 * Renders outside AppShell, full-bleed, the same as the documents reader —
 * the shell would be covered either way. Dark theme, fixed regardless of the
 * portal's own light/dark toggle, for the same reason `journeyTokens.ts`
 * gives for the other three journey screens.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

import { useAuth } from "@/lib/auth-context";

import { LiveRemediationTrackerBody } from "@/components/copilot-journey/RemediationTrackerBody";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import { useRemediationPillarScores } from "@/components/portal-v2/useRemediationPillarScores";
import {
  BRAND,
  COPILOT_GATE_TARGET,
  INK,
  RADIUS,
  gateLabel,
  hexAlpha,
  severityColor,
} from "@/components/copilot-journey/journeyTokens.ts";
import "@/components/copilot-journey/copilot-journey.css";

const DOCUMENTS_PATH = "/copilot-readiness/documents";
const REVEAL_PATH = "/copilot-readiness";

function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    handlers: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  };
}

/** The compact restatement of the tenant's Copilot Gate score. */
function GateChip({ score, tenantName }: { score: number; tenantName: string }) {
  const colour = severityColor(score);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "5px 10px 5px 8px",
        border: `1px solid ${hexAlpha(colour, 0.32)}`,
        borderRadius: 8,
        background: hexAlpha(colour, 0.08),
        flex: "none",
      }}
    >
      <span
        style={{
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: colour,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: colour,
            whiteSpace: "nowrap",
          }}
        >
          {gateLabel(score)}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, color: INK.micro, whiteSpace: "nowrap" }}>
          {`of ${COPILOT_GATE_TARGET} · ${tenantName}`}
        </span>
      </span>
    </div>
  );
}

export default function CopilotReadinessRemediationTrackerPage() {
  const [, navigate] = useLocation();
  const { fetchWithAuth, logout } = useAuth();

  // Same non-fatal, silent tenant-name lookup the documents reader uses
  // (#327) — a generic label is fine, an alarm toast for it is not.
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/portal/dashboard", undefined, { silent: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        /* generic label */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const { view } = useCopilotJourney({ tenantName: customerName });

  // #1460: the header chip restates the SAME Copilot Gate number the body
  // now renders (Git #1381's real day-one-baseline score) — this page is the
  // POST-purchase remediation dashboard, not the pre-purchase assessment
  // reveal, so it reads the remediation-tracker score here too rather than
  // `view.readinessScore` (the assessment scan's own number, still correct
  // for the other three journey screens). See RemediationTrackerBody.tsx's
  // header for the full rationale.
  const gateScore = useRemediationPillarScores();

  // This page has no document switcher of its own, so "Ready to fix this?"
  // hands off to the document reader, which is still the one place the real
  // 9-document set — including the SOW — lives and can be opened by id.
  const handleOpenSow = () => {
    navigate(DOCUMENTS_PATH);
  };

  const closeBtn = useHover();
  const logoutBtn = useHover();

  return (
    <div
      className="cj-dark"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: BRAND.canvas,
      }}
    >
      <header
        style={{
          position: "relative",
          zIndex: 5,
          flex: "none",
          background: "rgba(9,14,28,.92)",
          borderBottom: `1px solid ${INK.hairlineDark}`,
          padding: "14px 26px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 auto", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => navigate(REVEAL_PATH)}
            aria-label="Back to your results"
            {...closeBtn.handlers}
            style={{
              width: 34,
              height: 34,
              border: `1px solid ${INK.hairlineDark}`,
              borderRadius: RADIUS.control,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flex: "none",
              background: closeBtn.hovered ? "rgba(255,255,255,.06)" : "transparent",
            }}
          >
            <ArrowLeft size={15} strokeWidth={1.8} color={INK.micro} aria-hidden="true" />
          </button>

          {gateScore.copilotGate?.score !== null && gateScore.copilotGate?.score !== undefined ? (
            <GateChip score={gateScore.copilotGate.score} tenantName={view.tenant.name} />
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, overflow: "hidden" }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: INK.bodyDark,
                whiteSpace: "nowrap",
              }}
            >
              Copilot readiness assessment
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: INK.headingDark,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Remediation Tracker
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <button
            type="button"
            onClick={() => navigate(DOCUMENTS_PATH)}
            style={{
              padding: "0 12px",
              height: 34,
              border: `1px solid ${INK.hairlineDark}`,
              borderRadius: RADIUS.control,
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              color: INK.headingDark,
              whiteSpace: "nowrap",
            }}
          >
            All reports
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            {...logoutBtn.handlers}
            style={{
              padding: "0 10px",
              height: 34,
              border: `1px solid ${INK.hairlineDark}`,
              borderRadius: RADIUS.control,
              background: logoutBtn.hovered ? "rgba(255,255,255,.06)" : "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              color: INK.micro,
              whiteSpace: "nowrap",
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div
        className="cj-doc-scroll"
        data-testid="remediation-tracker-page-scroll"
        style={{
          position: "relative",
          flex: "1 1 auto",
          overflowY: "auto",
          padding: "24px 24px 34px",
        }}
      >
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <LiveRemediationTrackerBody
            view={view}
            onOpenSow={handleOpenSow}
            onOpenDocuments={() => navigate(DOCUMENTS_PATH)}
          />
        </div>
      </div>
    </div>
  );
}
