/**
 * RemediationTrackerBody.tsx — the Remediation Tracker as a post-purchase
 * project dashboard, per `Design/Remediation Tracker.dc.html`.
 *
 * WHAT THIS REPLACES AND WHY
 * ---------------------------
 * The only build that ever landed at `/copilot-readiness/remediation-tracker`
 * mounted `LiveRemediationGuideBody` — the flat "Full Remediation Guide"
 * runbook (document 8 of 9). That is a real, correct, separately-designed
 * document and stays exactly as it is; it was just never the design this
 * route was supposed to render. `Design/Remediation Tracker.dc.html` is a
 * different screen: a live project dashboard for AFTER the SOW is signed —
 * progress against the schedule, the live Copilot Gate score, a 6-pillar
 * strip, the tenant's real steps grouped into THEIR ACTUALLY SIGNED phases
 * (not a fixed template), an evidence pack, and a sticky "hire Shane for
 * what's left" footer.
 *
 * PHASES ARE REAL AND PER-TENANT, NOT THE DESIGN'S FIXED 3-PHASE TEMPLATE.
 * The first version of this file grouped every tenant into the same fixed 3
 * phases (Governance+Security / Compliance+Licensing / Adoption+Health) at
 * the design's own Halden Materials dollar figures — correct for that one
 * worked example, wrong for a real customer, who may have a different
 * number of phases, different titles, and different real prices depending
 * on what they actually signed. `useSignedRemediationScope()` reads the
 * SAME `/api/portal/assessment/sow` payload the SOW Proposal and Checkout
 * screens already read (`journeyScopeFromSow.ts`), filtered to
 * `serverSelectedTitles` — the active document's own stored selection, so
 * for an already-signed engagement this is the real, frozen scope. Each real
 * phase's task list is every rendered step whose pillar matches the phase's
 * own inferred pillar (`pillarShown`) — no separate phase-to-step mapping
 * invented here, since the step catalogue is already pillar-tagged.
 *
 * NOTHING ABOUT THE STEPS THEMSELVES IS REBUILT. This file reuses, unchanged:
 *   - `buildLiveRemediationSteps()` / `applyLiveScriptParams()` /
 *     `applyLiveTenantDomain()` (remediationLiveGuide.ts,
 *     remediationScriptParams.ts) for the real per-tenant step catalogue —
 *     same steps, same scripts, same blast-radius copy the Guide renders.
 *   - `Step` (RemediationGuideBody.tsx, exported for exactly this) for the
 *     actual row: checkbox, evidence, blast radius, code block, action
 *     picker. Grouped here by the tenant's real signed phase instead of by
 *     single pillar; nothing about the row itself is different.
 *   - `useRemediationTracker()` for real, persisted status/verification.
 *   - `useTenantCheckItems()` for the five fillable scripts' real per-item
 *     data, exactly as the Guide already threads it through.
 *
 * WHAT "PHASE FEE REMAINING" MEANS HERE, DELIBERATELY SIMPLER THAN THE
 * DESIGN'S GATE. Each phase's real signed `priceUsd` is reduced in
 * proportion to how many of its own steps are `verified` (never merely
 * ticked — the honesty rule the rest of this tracker already holds to).
 * The design's own formula (`remediation-tracker-pricing.ts`, still real and
 * unmodified) additionally gates an entire phase's price at flat until
 * EVERY step in it is resolved — a rule tied to that fixed 3-phase/2-pillar
 * shape. Reproducing that exact gate per real, variable-length signed phase
 * was not attempted here; this uses the simpler, still-honest continuous
 * proportion instead. Worth Shane's review if the stricter all-or-nothing
 * gate matters to him for the real phases too.
 *
 * WHAT THIS DOES NOT DO — DELIBERATE, NOT AN OVERSIGHT
 * ------------------------------------------------------
 * - NO SHANEBOT. `journeyTokens.ts` records that the docked ShaneBot pill was
 *   built to spec and removed platform-wide for this release, no other
 *   consumer left. This screen follows that same call rather than
 *   reintroducing it here.
 * - NO FAKE PER-PHASE "RE-SCAN" BUTTON. The design's own `rescan()` is a
 *   client-side `setTimeout` that invents a drift outcome. This platform's
 *   real re-verification comes from an actual scan
 *   (`reverifyRemediationTrackerSteps()`, fired from `diagnostics-runner.ts`)
 *   — there is no on-demand per-phase trigger to wire a button to, so the
 *   phase header states what is real (ready / not ready, live fee) rather
 *   than offering an action that would have to fake its own result.
 * - NO INVENTED SCHEDULE. The design's "Week 6 of 14", kickoff/certification
 *   dates and "N points behind plan" all come from a fixed fictional SOW
 *   date on the Halden Materials fixture. No signed-SOW kickoff date exists
 *   on `JourneyView` (checked `journeyModel.ts` — there is no such field), so
 *   phase progress here is stated purely in real, current terms: ready/fee/
 *   task counts, never a date or a schedule-adherence claim this platform
 *   cannot back.
 * - NO FABRICATED "SINCE YOUR LAST VISIT" TIMESTAMP. Nothing persists when a
 *   customer last opened this page, so the digest states real CURRENT totals
 *   (verified / drifted / handed to Shane / still open) rather than a
 *   session-to-session delta it cannot honestly compute.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";

import {
  BRAND,
  COPILOT_GATE_TARGET,
  gateLabel,
  hexAlpha,
  INK,
  PILLARS,
  RADIUS,
  SEVERITY_ON_DARK,
  severityColor,
  TABULAR,
  type PillarKey,
} from "./journeyTokens.ts";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildLiveRemediationSteps,
  type LiveRemediationStep,
} from "./remediationLiveGuide.ts";
import { Step } from "./RemediationGuideBody.tsx";
import { applyLiveScriptParams, applyLiveTenantDomain } from "./remediationScriptParams.ts";
import { useRemediationTracker, type RemediationTrackerState } from "./useRemediationTracker.ts";
import { useSignedRemediationScope, type SignedRemediationScope } from "./useSignedRemediationScope.ts";
import { useTenantCheckItems, type TenantCheckItemsState } from "./useTenantCheckItems.ts";
import type { JourneySowPhase } from "./journeyScopeFromSow.ts";

/** `"$" + Math.round(n).toLocaleString("en-US")` — same formatting the design/backend both use. */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const CARD_BORDER = "rgba(30,41,59,.9)";
const CARD_BG = "rgba(15,23,42,.4)";

const EYEBROW: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
};

/* ------------------------------------------------------------------ *
 * Evidence pack — real verified rows, real CSV/PDF/evidence-pack downloads.
 * ------------------------------------------------------------------ */

interface EvidenceRow {
  readonly title: string;
  readonly pillarLabel: string;
  readonly verifiedAt: string | null;
  readonly by: "You" | "Shane McCaw Consulting";
}

function formatVerifiedAt(iso: string | null): string {
  if (!iso) return "recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

function EvidencePackMenu({
  rows,
  onDownload,
  downloading,
}: {
  readonly rows: readonly EvidenceRow[];
  readonly onDownload: (kind: "csv" | "pdf" | "evidence-pdf") => void;
  readonly downloading: "csv" | "pdf" | "evidence-pdf" | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        data-testid="remediation-tracker-evidence-pack-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          height: 34,
          border: `1px solid ${hexAlpha(SEVERITY_ON_DARK.healthy, 0.4)}`,
          borderRadius: RADIUS.control,
          background: hexAlpha(SEVERITY_ON_DARK.healthy, open ? 0.14 : 0.08),
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        <ShieldCheck size={14} strokeWidth={1.8} color={SEVERITY_ON_DARK.healthy} aria-hidden="true" />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: SEVERITY_ON_DARK.healthy }}>Evidence pack</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: SEVERITY_ON_DARK.healthy, ...TABULAR }}>
          {rows.length}
        </span>
        <ChevronDown
          size={10}
          strokeWidth={2.2}
          color={SEVERITY_ON_DARK.healthy}
          aria-hidden="true"
          style={{ transition: "transform 200ms ease", transform: `rotate(${open ? 180 : 0}deg)` }}
        />
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 42,
            zIndex: 70,
            width: "min(440px, 88vw)",
            maxHeight: "70vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 18,
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 12,
            background: "#0b1524",
            boxShadow: "0 20px 52px rgba(2,6,23,.62)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ ...EYEBROW, color: SEVERITY_ON_DARK.healthy }}>Remediation evidence pack</span>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: INK.headingDark }}>
              {rows.length} verified fix{rows.length === 1 ? "" : "es"}, timestamped
            </span>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}>
              What was changed, when the re-scan confirmed it, who did it, and which finding it closes.
            </p>
          </div>

          {rows.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 14,
                border: "1px dashed rgba(71,85,105,.8)",
                borderRadius: 9,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.bodyDarkStrong }}>Nothing verified yet</span>
              <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
                Entries appear once a task is re-scanned and confirmed. A tick on its own is not evidence.
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${CARD_BORDER}` }}>
              {rows.map((row, i) => (
                <div
                  key={`${row.title}-${i}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    padding: "10px 0",
                    borderBottom: `1px solid ${CARD_BORDER}`,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: INK.headingDark }}>
                    {row.title}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: INK.bodyDark }}>
                    {row.pillarLabel} · verified {formatVerifiedAt(row.verifiedAt)} · {row.by}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 2 }}>
            <button
              type="button"
              onClick={() => onDownload("pdf")}
              disabled={downloading !== null}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                border: 0,
                borderRadius: 7,
                background: BRAND.blue,
                cursor: downloading ? "default" : "pointer",
                opacity: downloading && downloading !== "pdf" ? 0.6 : 1,
                fontFamily: "inherit",
                boxShadow: "0 6px 16px rgba(0,120,212,.28)",
              }}
            >
              <Download size={13} strokeWidth={2} color={BRAND.white} aria-hidden="true" />
              <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap" }}>
                {downloading === "pdf" ? "Downloading…" : "Download tracker as PDF"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDownload("csv")}
              disabled={downloading !== null}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 7,
                background: "transparent",
                cursor: downloading ? "default" : "pointer",
                opacity: downloading && downloading !== "csv" ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              <FileSpreadsheet size={13} strokeWidth={1.9} color={INK.bodyDarkStrong} aria-hidden="true" />
              <span style={{ fontSize: 12, fontWeight: 600, color: INK.bodyDarkStrong }}>
                {downloading === "csv" ? "Downloading…" : "Export as CSV"}
              </span>
            </button>
            {rows.length > 0 ? (
              <button
                type="button"
                onClick={() => onDownload("evidence-pdf")}
                disabled={downloading !== null}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 14px",
                  border: `1px solid ${hexAlpha(SEVERITY_ON_DARK.healthy, 0.35)}`,
                  borderRadius: 7,
                  background: hexAlpha(SEVERITY_ON_DARK.healthy, 0.08),
                  cursor: downloading ? "default" : "pointer",
                  opacity: downloading && downloading !== "evidence-pdf" ? 0.6 : 1,
                  fontFamily: "inherit",
                }}
              >
                <FileText size={13} strokeWidth={1.9} color={SEVERITY_ON_DARK.healthy} aria-hidden="true" />
                <span style={{ fontSize: 12, fontWeight: 600, color: SEVERITY_ON_DARK.healthy }}>
                  {downloading === "evidence-pdf" ? "Downloading…" : "Evidence pack as PDF"}
                </span>
              </button>
            ) : null}
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.5, color: INK.micro }}>
            Countersigned by Shane McCaw Consulting.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The digest — real current totals, no fabricated "since" timestamp.
 * ------------------------------------------------------------------ */

function StatTile({ value, label, colour }: { readonly value: number; readonly label: string; readonly colour: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 12px",
        border: `1px solid ${hexAlpha(colour, 0.28)}`,
        borderRadius: 9,
        background: hexAlpha(colour, 0.06),
      }}
    >
      <span style={{ fontSize: 21, fontWeight: 800, color: colour, ...TABULAR, flex: "none" }}>{value}</span>
      <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.4, color: INK.bodyDark }}>{label}</span>
    </div>
  );
}

function DigestCard({
  verified,
  drifted,
  blocked,
  open,
}: {
  readonly verified: number;
  readonly drifted: number;
  readonly blocked: number;
  readonly open: number;
}) {
  const headline = drifted
    ? `${drifted} fix${drifted === 1 ? "" : "es"} drifted back — that needs attention first`
    : verified
      ? `${verified} task${verified === 1 ? "" : "s"} verified so far`
      : "Nothing verified yet — tick off a task once it's done";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "18px 20px",
        border: `1px solid ${drifted ? hexAlpha(SEVERITY_ON_DARK.critical, 0.34) : hexAlpha(BRAND.teal, 0.3)}`,
        borderRadius: 14,
        background: drifted ? hexAlpha(SEVERITY_ON_DARK.critical, 0.06) : hexAlpha(BRAND.teal, 0.05),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ ...EYEBROW, color: BRAND.teal }}>Your progress</span>
        <span
          data-testid="remediation-tracker-digest-headline"
          style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.012em", color: INK.headingDark }}
        >
          {headline}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        <StatTile value={verified} label="verified by re-scan" colour={SEVERITY_ON_DARK.healthy} />
        <StatTile value={drifted} label="drifted back since verified" colour={drifted ? SEVERITY_ON_DARK.critical : INK.deemphasised} />
        <StatTile value={blocked} label="handed to Shane" colour={SEVERITY_ON_DARK.attention} />
        <StatTile value={open} label="still waiting on you" colour={INK.headingDark} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Phase progress — real signed phase, real remaining fee, real task counts.
 * No invented dates.
 * ------------------------------------------------------------------ */

interface PhaseProgress {
  readonly phase: JourneySowPhase;
  readonly steps: readonly LiveRemediationStep[];
  readonly done: number;
  readonly verified: number;
  /** `phase.priceUsd`, reduced in proportion to `verified / steps.length`. */
  readonly feeRemaining: number;
}

function PhaseProgressMiniCard({ p }: { readonly p: PhaseProgress }) {
  const cleared = p.steps.length > 0 && p.feeRemaining < 1;
  const started = p.done > 0;
  const fg = cleared ? SEVERITY_ON_DARK.healthy : started ? BRAND.teal : INK.micro;
  const state = cleared ? "Certified" : started ? "In progress" : "Not started";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "11px 13px",
        border: `1px solid ${cleared ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.3) : started ? hexAlpha(BRAND.teal, 0.28) : CARD_BORDER}`,
        borderLeft: `2px solid ${fg}`,
        borderRadius: 9,
        background: cleared ? hexAlpha(SEVERITY_ON_DARK.healthy, 0.06) : started ? hexAlpha(BRAND.teal, 0.05) : "rgba(2,6,23,.4)",
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 700, color: INK.headingDark }}>{p.phase.title}</span>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: INK.bodyDark }}>{money(p.feeRemaining)}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: fg, whiteSpace: "nowrap" }}>
          {state}
        </span>
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 500, color: INK.micro }}>
        {p.done} of {p.steps.length} tasks
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The Copilot Gate hero + 6-pillar strip.
 * ------------------------------------------------------------------ */

function GateHero({
  score,
  resolvedCount,
  total,
}: {
  readonly score: number | null;
  readonly resolvedCount: number;
  readonly total: number;
}) {
  const colour = score === null ? INK.micro : severityColor(score);
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        border: `1px solid ${hexAlpha(BRAND.blue, 0.4)}`,
        borderRadius: 16,
        background: `linear-gradient(150deg,${hexAlpha(BRAND.blue, 0.12)},rgba(15,23,42,.6))`,
        padding: "26px 26px 24px",
        display: "flex",
        flexWrap: "wrap",
        gap: "26px 40px",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "none" }}>
        <span style={{ ...EYEBROW, color: INK.micro }}>Copilot Gate · live</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            data-testid="remediation-tracker-gate-score"
            style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1, color: colour, ...TABULAR }}
          >
            {score ?? "—"}
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: INK.deemphasised }}>/ 100</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: colour, whiteSpace: "nowrap" }}>
              {COPILOT_GATE_TARGET} is safe to deploy
            </span>
          </span>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 7,
            marginTop: 4,
            padding: "4px 11px",
            borderRadius: 999,
            border: `1px solid ${hexAlpha(colour, 0.35)}`,
            background: hexAlpha(colour, 0.1),
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: colour, flex: "none" }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: colour }}>
            {score === null ? "Not yet scored" : gateLabel(score)}
          </span>
        </span>
      </div>
      <div style={{ flex: "1 1 300px", minWidth: 260, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: INK.bodyDarkStrong }}>
            {resolvedCount} of {total} tasks resolved
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: INK.micro }}>{total - resolvedCount} remaining</span>
        </div>
        <span style={{ height: 7, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden", display: "block" }}>
          <span
            style={{
              display: "block",
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg,${BRAND.blue},${BRAND.teal})`,
              transition: "width 420ms ease",
              width: total > 0 ? `${Math.round((resolvedCount / total) * 100)}%` : "0%",
            }}
          />
        </span>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
          Each task re-runs the specific check that produced its finding when you mark it done — the score above
          only moves once a real re-scan confirms it.
        </p>
      </div>
    </div>
  );
}

function PillarMiniCard({
  pillarKey,
  score,
  done,
  total,
}: {
  readonly pillarKey: PillarKey;
  readonly score: number | null;
  readonly done: number;
  readonly total: number;
}) {
  const identity = PILLARS[pillarKey];
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "13px 14px",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 10,
        background: CARD_BG,
      }}
    >
      <span style={{ ...EYEBROW, fontSize: 9.5, letterSpacing: ".16em", color: identity.primary }}>{identity.label}</span>
      <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: INK.headingDark, ...TABULAR }}>
        {score ?? "—"}
      </span>
      <span style={{ height: 3, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden", display: "block" }}>
        <span
          style={{
            display: "block",
            height: "100%",
            borderRadius: 999,
            background: identity.primary,
            opacity: 0.85,
            transition: "width 380ms ease",
            width: `${pct}%`,
          }}
        />
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 500, color: INK.micro }}>
        {done} of {total} tasks resolved
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The tracker body
 * ------------------------------------------------------------------ */

export function RemediationTrackerBody({
  view,
  progress,
  checkItems,
  scope,
  onOpenSow,
  onOpenDocuments,
}: {
  readonly view: JourneyView;
  readonly progress: RemediationTrackerState;
  readonly checkItems: TenantCheckItemsState;
  /** The tenant's real signed phases (see this file's own header) — never the fixed design template. */
  readonly scope: SignedRemediationScope;
  readonly onOpenSow?: () => void;
  readonly onOpenDocuments?: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState<"csv" | "pdf" | "evidence-pdf" | null>(null);

  const statuses = progress.statuses;
  const verification = progress.verification;
  const statusOf = useCallback((id: string) => statuses.get(id) ?? "not_started", [statuses]);
  const verificationOf = useCallback((id: string) => verification.get(id)?.state ?? "unverified", [verification]);

  const liveSteps = useMemo<readonly LiveRemediationStep[]>(() => buildLiveRemediationSteps(view), [view]);

  // Same live script-param substitution the Guide applies (#782/#1042) — this
  // screen renders the identical steps, so it must not skip the pass that
  // fills real values into the five fillable scripts' placeholders.
  const steps = useMemo<readonly LiveRemediationStep[]>(() => {
    return liveSteps.map((step) => {
      if (!step.code) return step;
      const parametrized = applyLiveScriptParams(step.id, step.code, checkItems.items);
      const code = parametrized ?? step.code;
      const script = applyLiveTenantDomain(code.script, checkItems.sharePointTenantPrefix);
      if (parametrized === null && script === code.script) return step;
      return { ...step, code: { ...code, script } };
    });
  }, [liveSteps, checkItems]);

  const total = steps.length;
  const resolvedCount = useMemo(() => steps.reduce((n, s) => (statusOf(s.id) !== "not_started" ? n + 1 : n), 0), [steps, statusOf]);

  const byPillar = useMemo(() => {
    const map = new Map<PillarKey, LiveRemediationStep[]>();
    for (const step of steps) {
      const list = map.get(step.pillar);
      if (list) list.push(step);
      else map.set(step.pillar, [step]);
    }
    return map;
  }, [steps]);

  const pillarScoreOf = useMemo(() => {
    const map = new Map<PillarKey, number | null>();
    for (const p of view.pillars) map.set(p.key, p.score);
    return map;
  }, [view.pillars]);

  // Digest — real current totals across every rendered step.
  const digest = useMemo(() => {
    let verified = 0;
    let drifted = 0;
    let blocked = 0;
    let open = 0;
    for (const step of steps) {
      const status = statusOf(step.id);
      const v = verificationOf(step.id);
      if (v === "verified") verified += 1;
      if (v === "drift") drifted += 1;
      if (status === "shane_handles") blocked += 1;
      if (status === "not_started") open += 1;
    }
    return { verified, drifted, blocked, open };
  }, [steps, statusOf, verificationOf]);

  // One entry per REAL signed phase — its own steps (matched by pillar), its
  // own real done/verified counts, its own remaining fee off its own real
  // priceUsd. Phases the platform can't attribute to a pillar (no title
  // pattern matched — see journeyScopeFromSow.ts's inferPillar) still show,
  // with an empty task list rather than being silently dropped.
  const phaseProgress = useMemo<readonly PhaseProgress[]>(() => {
    return scope.phases.map((phase) => {
      const phaseSteps = phase.pillarShown ? (byPillar.get(phase.pillarShown) ?? []) : [];
      const done = phaseSteps.reduce((n, s) => (statusOf(s.id) !== "not_started" ? n + 1 : n), 0);
      const verifiedN = phaseSteps.reduce((n, s) => (verificationOf(s.id) === "verified" ? n + 1 : n), 0);
      const outstandingFraction = phaseSteps.length > 0 ? 1 - verifiedN / phaseSteps.length : 1;
      return { phase, steps: phaseSteps, done, verified: verifiedN, feeRemaining: phase.priceUsd * outstandingFraction };
    });
  }, [scope.phases, byPillar, statusOf, verificationOf]);

  const hire = useMemo(() => {
    if (phaseProgress.length === 0) {
      return {
        price: "—",
        was: "—",
        wasShow: false,
        saved: "—",
        savedShow: false,
        cta: "Hire Shane McCaw",
        note: "Pricing appears once your signed scope loads.",
      };
    }
    const fullUsd = phaseProgress.reduce((sum, p) => sum + p.phase.priceUsd, 0);
    const remainingUsd = phaseProgress.reduce((sum, p) => sum + p.feeRemaining, 0);
    const savedUsd = fullUsd - remainingUsd;
    const cleared = remainingUsd < 1;
    const saved = savedUsd > 1;
    return {
      price: money(remainingUsd),
      was: money(fullUsd),
      wasShow: saved,
      saved: money(savedUsd),
      savedShow: saved,
      cta: cleared ? "Book your gate validation" : saved ? "Hire Shane for the rest" : "Hire Shane McCaw",
      note: cleared
        ? "Everything in your signed scope is verified. All that remains is the gate validation."
        : saved
          ? "Your quote drops as each task is verified by a real re-scan. Skipped tasks stay in scope — unresolved, not done."
          : "Fixed-fee, per your signed scope. Tick tasks off yourself and this number comes down.",
    };
  }, [phaseProgress]);

  const evidenceRows = useMemo<readonly EvidenceRow[]>(() => {
    const rows: EvidenceRow[] = [];
    for (const step of steps) {
      if (verificationOf(step.id) !== "verified") continue;
      rows.push({
        title: step.title,
        pillarLabel: PILLARS[step.pillar].label,
        verifiedAt: verification.get(step.id)?.verifiedAt ?? null,
        by: statusOf(step.id) === "shane_handles" ? "Shane McCaw Consulting" : "You",
      });
    }
    return rows;
  }, [steps, statusOf, verificationOf, verification]);

  const download = useCallback(
    async (kind: "csv" | "pdf" | "evidence-pdf") => {
      setDownloading(kind);
      try {
        const path =
          kind === "csv"
            ? "/api/portal/remediation-tracker/export.csv"
            : kind === "pdf"
              ? "/api/portal/remediation-tracker/export.pdf"
              : "/api/portal/remediation-tracker/evidence-pack.pdf";
        const res = await fetchWithAuth(path, undefined, { silent: true });
        if (!res.ok) throw new Error(`remediation tracker export ${res.status}`);
        const blobUrl = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = kind === "csv" ? "remediation-tracker.csv" : kind === "pdf" ? "remediation-tracker.pdf" : "remediation-evidence-pack.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch {
        // The export buttons have no inline error slot of their own; a failed
        // download simply does not produce a file, which is self-evident to
        // the customer without a duplicate toast on top of the browser's own.
      } finally {
        setDownloading(null);
      }
    },
    [fetchWithAuth],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, paddingBottom: 96 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <EvidencePackMenu rows={evidenceRows} onDownload={(kind) => void download(kind)} downloading={downloading} />
      </div>

      <DigestCard verified={digest.verified} drifted={digest.drifted} blocked={digest.blocked} open={digest.open} />

      {scope.loaded && phaseProgress.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "18px 20px",
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 14,
            background: "rgba(15,23,42,.5)",
          }}
        >
          <span style={{ ...EYEBROW, color: INK.bodyDark }}>Phase progress</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            {phaseProgress.map((p) => (
              <PhaseProgressMiniCard key={p.phase.id} p={p} />
            ))}
          </div>
        </div>
      ) : scope.loaded ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "18px 20px",
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 14,
            background: "rgba(15,23,42,.4)",
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: INK.bodyDarkStrong }}>No signed scope found yet</span>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
            Every task below is still real and tracked — phase-by-phase pricing appears once a signed statement of
            work is on file.
          </p>
        </div>
      ) : null}

      <GateHero score={view.readinessScore} resolvedCount={resolvedCount} total={total} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {view.pillars.map((p) => {
          const pillarSteps = byPillar.get(p.key) ?? [];
          const done = pillarSteps.reduce((n, s) => (statusOf(s.id) !== "not_started" ? n + 1 : n), 0);
          return (
            <PillarMiniCard
              key={p.key}
              pillarKey={p.key}
              score={pillarScoreOf.get(p.key) ?? null}
              done={done}
              total={pillarSteps.length}
            />
          );
        })}
      </div>

      {phaseProgress.length > 0
        ? // The normal case: one section per real signed phase.
          phaseProgress.map((p) => {
            if (p.steps.length === 0) return null;
            const cleared = p.feeRemaining < 1;
            return (
              <div key={p.phase.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.015em", color: INK.headingDark }}>
                      {p.phase.title}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.teal, ...TABULAR }}>
                      {p.done} / {p.steps.length}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cleared ? SEVERITY_ON_DARK.healthy : INK.bodyDark, ...TABULAR }}>
                      {money(p.feeRemaining)}
                    </span>
                    {cleared ? (
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: SEVERITY_ON_DARK.healthy }}>
                        Cleared
                      </span>
                    ) : null}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {p.steps.map((step) => (
                    <Step
                      key={step.id}
                      step={step}
                      status={statusOf(step.id)}
                      verification={verificationOf(step.id)}
                      onToggleComplete={progress.toggleComplete}
                      onSetAction={progress.setAction}
                    />
                  ))}
                </div>
              </div>
            );
          })
        : // No signed phase to group by yet (scope still loading, or genuinely
          // none on file) — steps still render, grouped by pillar so the page
          // is never blank while the real scope loads.
          view.pillars.map((pillar) => {
            const pillarSteps = byPillar.get(pillar.key) ?? [];
            if (pillarSteps.length === 0) return null;
            return (
              <div key={pillar.key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.015em", color: INK.headingDark }}>
                  {pillar.label}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {pillarSteps.map((step) => (
                    <Step
                      key={step.id}
                      step={step}
                      status={statusOf(step.id)}
                      verification={verificationOf(step.id)}
                      onToggleComplete={progress.toggleComplete}
                      onSetAction={progress.setAction}
                    />
                  ))}
                </div>
              </div>
            );
          })}

      {(progress.error !== null || progress.saving) ? (
        <span style={{ fontSize: 11.5, fontWeight: 600, color: progress.error !== null ? SEVERITY_ON_DARK.critical : INK.micro }}>
          {progress.error !== null
            ? "Your last change could not be saved, so it has been undone here. Check your connection and try again."
            : "Saving…"}
        </span>
      ) : null}

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          background: "rgba(2,6,23,.95)",
          borderTop: `1px solid ${hexAlpha(BRAND.teal, 0.28)}`,
          padding: "12px 24px",
        }}
      >
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 300px", minWidth: 260 }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ ...EYEBROW, color: BRAND.teal }}>Hand the rest to Shane</span>
              {hire.savedShow ? (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: SEVERITY_ON_DARK.healthy }}>
                  {hire.saved} removed by your own work
                </span>
              ) : null}
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span
                data-testid="remediation-tracker-hire-price"
                style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: INK.headingDark, ...TABULAR }}
              >
                {hire.price}
              </span>
              {hire.wasShow ? (
                <span style={{ fontSize: 13, fontWeight: 600, color: INK.deemphasised, textDecoration: "line-through", ...TABULAR }}>
                  {hire.was}
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>{hire.note}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none", flexWrap: "wrap" }}>
            {onOpenSow ? (
              <button
                type="button"
                onClick={onOpenSow}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "0 18px",
                  height: 42,
                  border: 0,
                  borderRadius: 8,
                  background: BRAND.blue,
                  cursor: "pointer",
                  boxShadow: "0 8px 22px rgba(0,120,212,.3)",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, color: BRAND.white }}>{hire.cta}</span>
              </button>
            ) : null}
            {onOpenDocuments ? (
              <button
                type="button"
                onClick={onOpenDocuments}
                style={{
                  padding: "0 15px",
                  height: 42,
                  border: `1px solid ${CARD_BORDER}`,
                  borderRadius: RADIUS.control,
                  background: "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: INK.headingDark,
                  whiteSpace: "nowrap",
                }}
              >
                Your documents
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LiveRemediationTrackerBody — what the route mounts.
 * ------------------------------------------------------------------ */

export function LiveRemediationTrackerBody({
  view,
  onOpenSow,
  onOpenDocuments,
}: {
  readonly view: JourneyView;
  readonly onOpenSow?: () => void;
  readonly onOpenDocuments?: () => void;
}) {
  const progress = useRemediationTracker();
  const checkItems = useTenantCheckItems();
  const scope = useSignedRemediationScope();
  return (
    <RemediationTrackerBody
      view={view}
      progress={progress}
      checkItems={checkItems}
      scope={scope}
      onOpenSow={onOpenSow}
      onOpenDocuments={onOpenDocuments}
    />
  );
}
