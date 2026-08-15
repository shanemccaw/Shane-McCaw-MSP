/**
 * RemediationGuideBody.tsx — document 8 of 9, the Full Remediation Guide.
 *
 * The only document in the set the customer *does* something to rather than
 * reads. Each step has the console path, the command, the caution and the
 * verification; ticking one off is the whole interaction.
 *
 * On a LIVE tenant the step list is now DYNAMIC (#658): it holds only the steps
 * a real finding put on this tenant's list, plus the two always-on process
 * steps (s27, s30). A never-scanned tenant sees just those two, under an
 * explicit notice. The design PREVIEW still renders all twenty-eight steps of
 * the Halden worked example unchanged.
 *
 * WHERE THE TICKS LIVE (#730)
 * ---------------------------
 * On a LIVE tenant they are persisted, per customer, in
 * `remediation_tracker_steps` — `useRemediationTracker()` reads and writes them
 * through `/api/portal/remediation-tracker`, and this component takes the whole
 * of that state as an optional `progress` prop rather than owning it. A reload,
 * a re-login or a second admin on the account all see the same tracker.
 *
 * That reverses this file's original position, which was that a checkbox did
 * not justify a table. It does: the epic (#647) is explicit that ongoing,
 * persistent progress against this runbook is the thing the customer is paying
 * for once they sign, and ticks that die with the tab are not that.
 *
 * WHAT DID NOT CHANGE is the honesty rule underneath it. A tick is the
 * customer's own claim that they did a step; it is not evidence the change
 * landed in their tenant, and nothing in this platform's scoring, gate or
 * readiness maths reads it. The re-scan remains the only thing that can confirm
 * the work, and the live standfirst now says both halves of that out loud.
 *
 * PREVIEW IS UNCHANGED. `?preview=design` renders the design's Halden Materials
 * fixture against a tenant that does not exist, so it keeps the original
 * session-only `useState` ticks and the design's own "kept while this page is
 * open" copy — there is no account to save a fictional tenant's progress to.
 *
 * NOTHING HERE EXECUTES. Every command is offered to copy, never to run: the
 * platform holds no write consent for these operations against a customer
 * tenant, and a runbook that quietly ran privileged PowerShell from a report
 * viewer would be a very bad idea even if it did.
 *
 * PREVIEW VS LIVE (#472)
 * ----------------------
 * `RemediationGuideBody` is presentational: pass `isPreview` (the default,
 * matching its original behaviour byte-for-byte) to render the design's own
 * Halden Materials runbook, or pass `isPreview={false}` with `live` to render a
 * real tenant's. `LiveRemediationGuideBody` below is what `DocumentBody.tsx`
 * mounts on a real journey — it needs no fetch of its own, because every figure
 * this document can honestly state is already on the journey's view.
 *
 * See `remediationLiveGuide.ts` for the whole of what is real: #472's confirmed
 * step-to-check mapping, which fictional literals became named placeholders and
 * why the real ones cannot be substituted yet, which counts come from this
 * tenant's own scan, and the two steps (18 and 28) the platform measures nothing
 * for and says so.
 */

import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Copy, Info, Mail, TriangleAlert } from "lucide-react";

import {
  BRAND,
  INK,
  PILLARS,
  SEVERITY_ON_DARK,
  TABULAR,
  hexAlpha,
  reportAccent,
  type PillarKey,
} from "./journeyTokens.ts";
import {
  REMEDIATION_GUIDE,
  REMEDIATION_PRELUDE,
  REMEDIATION_SCRIPTED_COUNT,
  REMEDIATION_STEPS,
  type RemediationBlastRadius,
  type RemediationCode,
  type RemediationStep,
} from "./previewRemediationGuide.ts";
import {
  LIVE_PRELUDE,
  UNCONFIRMED_EVIDENCE_DETAIL,
  buildLiveRemediationSteps,
  resolveBlockers,
  resolveChecklistNote,
  resolveChecklistRows,
  resolveClosing,
  resolveDynamicSelectionNotice,
  resolveExpectedImprovement,
  resolveHandoffBlurb,
  resolveScopeHeadline,
  resolveStandfirst,
  resolveTotalFindings,
  type LiveRemediationStep,
  type StepEvidence,
} from "./remediationLiveGuide.ts";
import { buildProvenance, checkDomainLabel } from "./liveReportBlocks.ts";
import {
  useRemediationTracker,
  type RemediationTrackerState,
  type RemediationTrackerStepStatus,
  type RemediationTrackerVerificationState,
} from "./useRemediationTracker.ts";
import { useTenantCheckItems, type TenantCheckItemsState } from "./useTenantCheckItems.ts";
import { applyLiveScriptParams, applyLiveTenantDomain } from "./remediationScriptParams.ts";
import type { JourneyView } from "./journeyModel.ts";
import { PREVIEW_SIGNAL_COUNT, PREVIEW_TENANT } from "./journeyPreviewFixture.ts";

const H2: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.015em",
  color: INK.headingDark,
};

const BODY: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: INK.bodyDarkStrong,
  textWrap: "pretty",
};

const MONO = "Menlo, Consolas, monospace";

/** The design-preview fallback's verification: always empty, see its use below. */
const EMPTY_VERIFICATION: ReadonlyMap<string, { readonly state: RemediationTrackerVerificationState; readonly verifiedAt: string | null }> =
  new Map();

/* ------------------------------------------------------------------ *
 * A copyable command block
 * ------------------------------------------------------------------ */

function CodeBlock({ code }: { readonly code: RemediationCode }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // `navigator.clipboard` is absent on an insecure origin and can be denied by
    // permission policy, so the button says what actually happened rather than
    // flashing "Copied" over a clipboard that never changed.
    void navigator.clipboard
      ?.writeText(code.script)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* the script is selectable in the block either way */
      });
  }, [code.script]);

  return (
    <div
      style={{
        border: "1px solid rgba(51,65,85,.85)",
        borderRadius: 8,
        background: "rgba(2,6,23,.72)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "6px 11px",
          borderBottom: "1px solid rgba(51,65,85,.7)",
          background: "rgba(15,23,42,.6)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: INK.bodyDark,
          }}
        >
          {code.language}
        </span>
        <button
          type="button"
          onClick={copy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: copied ? SEVERITY_ON_DARK.healthy : INK.micro,
          }}
        >
          {copied ? <Check size={11} strokeWidth={2.6} /> : <Copy size={11} strokeWidth={2.2} />}
          {copied ? "Copied" : "Copy and run"}
        </button>
      </div>
      {/* `white-space: pre` and no re-wrapping: this is pasted into a shell. */}
      <pre
        style={{
          margin: 0,
          padding: "11px 13px",
          overflowX: "auto",
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: 1.65,
          color: "#e2e8f0",
          whiteSpace: "pre",
        }}
      >
        {code.script}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The caution / verify notes
 * ------------------------------------------------------------------ */

/**
 * `caution` and `verify` are the design's two notes. `context` is #472's third:
 * why a step is on this tenant's list, what the reader must fill into a
 * placeholder, or — for Steps 18 and 28 — that the platform measures nothing
 * here at all.
 *
 * It is deliberately neutral rather than amber or green. A gap styled as a
 * caution reads as a failing grade, which is exactly the reading #472 ruled out
 * for the pillar reports' own declared absences.
 */
function Note({
  kind,
  children,
}: {
  readonly kind: "caution" | "verify" | "context";
  readonly children: React.ReactNode;
}) {
  const caution = kind === "caution";
  const context = kind === "context";
  const colour = caution
    ? SEVERITY_ON_DARK.attention
    : context
      ? "#7d9ab5"
      : SEVERITY_ON_DARK.healthy;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "9px 11px",
        borderRadius: 7,
        border: `1px solid ${hexAlpha(colour, caution ? 0.3 : 0.28)}`,
        background: hexAlpha(colour, caution ? 0.07 : 0.06),
      }}
    >
      <span aria-hidden="true" style={{ flex: "none", marginTop: 2, color: colour, display: "flex" }}>
        {caution ? (
          <TriangleAlert size={13} strokeWidth={2} />
        ) : context ? (
          <Info size={13} strokeWidth={2.2} />
        ) : (
          <Check size={13} strokeWidth={2.2} />
        )}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.55,
          // Tinted ink rather than the body grey: these notes are the ones that
          // stop somebody breaking their own tenant.
          color: caution ? "#e8d9a8" : context ? "#c3d4e3" : "#bfe9d6",
        }}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * The evidence line under a live step.
 *
 * Four shapes, and the distinction between the last two is the one that must
 * never blur: `gap` is "we do not measure this at all", `unconfirmed` is "no
 * finding matched, so this says nothing either way" (NOT a display cap — see
 * `UNCONFIRMED_EVIDENCE_DETAIL`). Neither is a pass, and neither is styled as a
 * failure.
 *
 * On a live tenant the dynamic guide (#658) no longer renders `unconfirmed` or
 * `gap` steps at all, so in practice a live evidence line is `finding` or
 * `process`; the other two branches remain for the preview/type contract and in
 * case the inclusion rules widen.
 */
function Evidence({ evidence }: { readonly evidence: StepEvidence }) {
  if (evidence.kind === "process") return null;

  if (evidence.kind === "finding") {
    return (
      <Note kind="context">
        <span style={{ fontWeight: 700 }}>On your list because:</span>{" "}
        <span style={{ color: evidence.severity === "critical" ? SEVERITY_ON_DARK.critical : SEVERITY_ON_DARK.attention }}>
          {evidence.title}
        </span>{" "}
        <span style={{ color: INK.micro }}>
          {`— recorded by the ${checkDomainLabel(evidence.checkKey)} check on this tenant's last scan.`}
        </span>
      </Note>
    );
  }

  if (evidence.kind === "gap") {
    return (
      <Note kind="context">
        <span style={{ fontWeight: 700 }}>Not measured by this platform:</span> {evidence.detail}
      </Note>
    );
  }

  return (
    <Note kind="context">
      <span style={{ fontWeight: 700 }}>Not confirmed either way:</span> {UNCONFIRMED_EVIDENCE_DETAIL}
      {evidence.checkKeys.length > 0 ? (
        <span style={{ color: INK.micro }}>{` The checks behind it are ${evidence.checkKeys.join(", ")}.`}</span>
      ) : null}
    </Note>
  );
}

/* ------------------------------------------------------------------ *
 * The Blast Radius card (#731, Phase B)
 * ------------------------------------------------------------------ */

/**
 * The design's own three-row risk card, styled off its own accent (a violet
 * lifted from `PILLARS.security` rather than a new one-off literal) with the
 * same three severity colours the rest of this document already uses for
 * critical/attention/healthy.
 */
function BlastRadius({ blastRadius }: { readonly blastRadius: RemediationBlastRadius }) {
  const accent = PILLARS.security.primary;
  const rows: readonly [string, string, string][] = [
    ["If it goes right", blastRadius.goesRight, SEVERITY_ON_DARK.healthy],
    ["If it goes wrong", blastRadius.goesWrong, SEVERITY_ON_DARK.critical],
    ["Trade-off", blastRadius.tradeOff, SEVERITY_ON_DARK.attention],
  ];
  return (
    <div
      style={{
        border: `1px solid ${hexAlpha(accent, 0.34)}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 9,
        background: `linear-gradient(135deg,${hexAlpha(accent, 0.09)},rgba(2,6,23,.4))`,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: accent }}>
        Blast radius
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map(([label, text, colour]) => (
          <span key={label} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: colour,
                flex: "none",
                width: 78,
                paddingTop: 2,
              }}
            >
              {label}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: "#cbd5e1" }}>{text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The per-step action picker (#731, Phase B)
 * ------------------------------------------------------------------ */

/**
 * The design's real "Why are you skipping this?" reason chips, plus its real
 * "Have Shane do this one" button — flattened here into one action per status
 * value (see the schema's own comment on why this column stays one flat enum
 * rather than the design's separate status/reason/blocked/by fields).
 *
 * Real copy, all four labels, straight out of `Design/Remediation Tracker.dc.html`.
 */
const ACTION_LABELS: Readonly<Record<Exclude<RemediationTrackerStepStatus, "not_started" | "completed">, string>> = {
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase",
  shane_handles: "Have Shane do this one",
};

/** The confirmation line shown once a step carries one of the four actioned statuses. */
function actionedLabel(status: RemediationTrackerStepStatus): string {
  if (status === "shane_handles") {
    // Real copy from the design's own "handed" confirmation state.
    return "Handed to Shane — you will be contacted to confirm.";
  }
  return `Skipped — ${ACTION_LABELS[status as "already_handled" | "not_applicable" | "deferred"]}`;
}

/**
 * The design's own real per-row status pill labels (#732): `status: counted
 * ? "Verified" : complete ? "Awaiting re-scan" : …` in the design's own
 * `row()` builder. `unverified` here covers both the design's "Awaiting
 * re-scan" (a self-resolved claim) and its plain "Skipped" (any of the other
 * four) — one label for "a claim exists and nothing has checked it yet",
 * since this system flattens the design's own status/blocked split the same
 * way `ACTION_LABELS` already does.
 */
function verificationLabel(state: RemediationTrackerVerificationState): string {
  if (state === "verified") return "Verified";
  if (state === "drift") return "Drifted — verification withdrawn";
  return "Awaiting re-scan";
}

/** The pill's colours, reusing the same severity tokens the rest of this document already uses. */
function verificationColours(state: RemediationTrackerVerificationState): { fg: string; brd: string; bg: string } {
  if (state === "verified") return { fg: SEVERITY_ON_DARK.healthy, brd: "rgba(52,211,153,.4)", bg: "rgba(52,211,153,.1)" };
  if (state === "drift") return { fg: SEVERITY_ON_DARK.critical, brd: "rgba(248,113,113,.4)", bg: "rgba(248,113,113,.08)" };
  return { fg: "#5f7b95", brd: "rgba(100,116,139,.4)", bg: "transparent" };
}

function VerificationPill({ state }: { readonly state: RemediationTrackerVerificationState }) {
  const c = verificationColours(state);
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        flex: "none",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${c.brd}`,
        background: c.bg,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.fg, flex: "none" }} />
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: c.fg, whiteSpace: "nowrap" }}>
        {verificationLabel(state)}
      </span>
    </span>
  );
}

function ActionPicker({
  status,
  verification,
  onPick,
  onUndo,
}: {
  readonly status: RemediationTrackerStepStatus;
  /** `unverified` (the default) when the caller has no entry for this step. */
  readonly verification: RemediationTrackerVerificationState;
  readonly onPick: (status: RemediationTrackerStepStatus) => void;
  readonly onUndo: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (status !== "not_started") {
    const handed = status === "shane_handles";
    const drifted = verification === "drift";
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 11px",
          borderRadius: 8,
          // A drifted claim gets the same red treatment the design gives its
          // own "Drifted — verification withdrawn" block — it is not just
          // another flavour of the neutral "skipped" chip.
          border: `1px solid ${drifted ? "rgba(248,113,113,.4)" : handed ? "rgba(52,211,153,.3)" : "rgba(51,65,85,.9)"}`,
          background: drifted ? "rgba(248,113,113,.08)" : handed ? "rgba(52,211,153,.06)" : "rgba(2,6,23,.4)",
        }}
      >
        {handed && !drifted ? (
          <Check size={12} strokeWidth={2.6} color={SEVERITY_ON_DARK.healthy} aria-hidden="true" style={{ flex: "none" }} />
        ) : null}
        <span style={{ fontSize: 11.5, fontWeight: 500, color: drifted ? SEVERITY_ON_DARK.critical : handed ? SEVERITY_ON_DARK.healthy : INK.micro }}>
          {actionedLabel(status)}
        </span>
        <VerificationPill state={verification} />
        <button
          type="button"
          onClick={onUndo}
          style={{
            marginLeft: "auto",
            flex: "none",
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 600,
          color: INK.micro,
          textDecoration: "underline",
          textDecorationColor: "rgba(100,116,139,.5)",
        }}
      >
        Can&rsquo;t self-resolve this one?
      </button>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "11px 12px",
        borderRadius: 9,
        border: "1px solid rgba(251,191,36,.3)",
        background: "rgba(251,191,36,.06)",
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#e8d9a8" }}>Why are you skipping this?</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {(Object.keys(ACTION_LABELS) as (keyof typeof ACTION_LABELS)[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setAsking(false);
              onPick(key);
            }}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "#cbd5e1",
              padding: "6px 11px",
              borderRadius: 999,
              border: "1px solid rgba(100,116,139,.7)",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {ACTION_LABELS[key]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setAsking(false)}
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        Cancel
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One step
 * ------------------------------------------------------------------ */

/**
 * Exported so `RemediationTrackerBody.tsx` (the dashboard-layout screen from
 * `Design/Remediation Tracker.dc.html`) can render the exact same step row —
 * checkbox, blast radius, code block, evidence, action picker — grouped by
 * phase instead of by single pillar, without duplicating any of this file's
 * per-step rendering or state logic.
 */
export function Step({
  step,
  status,
  verification,
  onToggleComplete,
  onSetAction,
}: {
  readonly step: RemediationStep | LiveRemediationStep;
  readonly status: RemediationTrackerStepStatus;
  readonly verification: RemediationTrackerVerificationState;
  readonly onToggleComplete: (id: string) => void;
  readonly onSetAction: (id: string, status: RemediationTrackerStepStatus) => void;
}) {
  const fillIn = "fillIn" in step ? step.fillIn : undefined;
  const evidence = "evidence" in step ? step.evidence : undefined;
  const colour = PILLARS[step.pillar].primary;
  const complete = status === "completed";
  // Dimmed the moment a decision has been made about the step, whichever of
  // the five it was — not only literal completion. An "already handled
  // another way" row sitting at full opacity would read as still outstanding.
  const resolved = status !== "not_started";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "22px minmax(0,1fr)",
        gap: 12,
        padding: "12px 12px 14px",
        border: `1px solid ${INK.hairlineDark}`,
        borderRadius: 10,
        background: "rgba(2,6,23,.34)",
        transition: "opacity 220ms ease",
        opacity: resolved ? 0.62 : 1,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={complete}
        aria-label={`Mark ${step.label} complete: ${step.title}`}
        onClick={() => onToggleComplete(step.id)}
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `1px solid ${complete ? SEVERITY_ON_DARK.healthy : "rgba(100,116,139,.9)"}`,
          background: complete ? SEVERITY_ON_DARK.healthy : "transparent",
          flex: "none",
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background 180ms, border-color 180ms",
        }}
      >
        <Check
          size={11}
          strokeWidth={3.4}
          color="#0b1220"
          aria-hidden="true"
          style={{ opacity: complete ? 1 : 0, transition: "opacity 180ms" }}
        />
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: colour,
              }}
            >
              {step.label}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#5f7b95" }}>{step.meta}</span>
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              lineHeight: 1.35,
              color: resolved ? INK.micro : INK.headingDark,
              // One shorthand rather than `textDecoration` + `textDecorationColor`:
              // React warns when a shorthand and its longhand are both set and
              // one of them changes between renders, which is exactly this case.
              textDecoration: resolved ? "line-through rgba(100,116,139,.6)" : "none",
              transition: "color 180ms",
            }}
          >
            {step.title}
          </span>
        </div>

        {step.where ? (
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "#5f7b95",
                flex: "none",
              }}
            >
              Where
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 1.5, color: INK.bodyDarkStrong }}>
              {step.where}
            </span>
          </span>
        ) : null}

        {/* Evidence leads: why this step is here comes before what to run. */}
        {evidence ? <Evidence evidence={evidence} /> : null}
        <BlastRadius blastRadius={step.blastRadius} />
        {step.code ? <CodeBlock code={step.code} /> : null}
        {fillIn ? (
          <Note kind="context">
            <span style={{ fontWeight: 700 }}>Fill in:</span> {fillIn}
          </Note>
        ) : null}
        {step.caution ? <Note kind="caution">{step.caution}</Note> : null}
        {step.verify ? (
          <Note kind="verify">
            <span style={{ fontWeight: 700 }}>Verify:</span> {step.verify}
          </Note>
        ) : null}
        <ActionPicker
          status={status}
          verification={verification}
          onPick={(next) => onSetAction(step.id, next)}
          onUndo={() => onSetAction(step.id, "not_started")}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The guide
 * ------------------------------------------------------------------ */

/**
 * A live tenant's value for one Remediation Overview row, matched on the row's
 * own label.
 *
 * Matched on label rather than an added id because the rows are the design's
 * `as const` tuple and each label is unique within it. A label that gains no
 * case here falls back to the design's own value — which is correct only for
 * "Critical path duration", the one row that states the programme's shape
 * rather than a measurement of this tenant, and `remediationLiveGuide.test.ts`
 * pins that so a new fixture row cannot quietly inherit the fallback.
 */
function resolveOverviewValue(label: string, fallback: string, view: JourneyView): string {
  switch (label) {
    case "Total findings requiring remediation":
      return resolveTotalFindings(false, view.pillars);
    case "Not safe yets":
      return resolveBlockers(false, view.pillars);
    case "Expected improvement":
      return resolveExpectedImprovement(false, view.readinessScore);
    default:
      return fallback;
  }
}

export function RemediationGuideBody({
  onOpenSow,
  isPreview = true,
  live,
  progress,
  checkItems,
}: {
  readonly onOpenSow?: () => void;
  /** Default `true` so every existing (preview) call site is unchanged. */
  readonly isPreview?: boolean;
  /** Required when `isPreview` is `false`. */
  readonly live?: { readonly view: JourneyView };
  /**
   * The persisted tracker (#730), supplied by `LiveRemediationGuideBody`.
   * Absent on the design preview, which falls back to the session-only ticks
   * below — there is no account to save a fictional tenant's progress to.
   */
  readonly progress?: RemediationTrackerState;
  /**
   * The five fillable scripts' real per-item data (#776/#782), supplied by
   * `LiveRemediationGuideBody`. Absent on the design preview, which keeps the
   * Halden Materials fixture's own placeholders unchanged.
   */
  readonly checkItems?: TenantCheckItemsState;
}) {
  // The session-only fallback. Still the real state on `?preview=design`, and
  // still declared unconditionally because hooks cannot be called behind a
  // branch; `progress` simply wins when it is there. A `Map` rather than a
  // `Set` since #731 widened the vocabulary past a plain done/not-done boolean
  // — the design preview gets the same real action picker the live tracker
  // does, it just never leaves this tab.
  const [sessionStatuses, setSessionStatuses] = useState<ReadonlyMap<string, RemediationTrackerStepStatus>>(
    () => new Map(),
  );
  const sessionToggleComplete = useCallback((id: string) => {
    setSessionStatuses((prev) => {
      const next = new Map(prev);
      if (next.get(id) === "completed") next.delete(id);
      else next.set(id, "completed");
      return next;
    });
  }, []);
  const sessionSetAction = useCallback((id: string, status: RemediationTrackerStepStatus) => {
    setSessionStatuses((prev) => {
      const next = new Map(prev);
      if (status === "not_started") next.delete(id);
      else next.set(id, status);
      return next;
    });
  }, []);

  const statuses = progress ? progress.statuses : sessionStatuses;
  const toggleComplete = progress ? progress.toggleComplete : sessionToggleComplete;
  const setAction = progress ? progress.setAction : sessionSetAction;
  const statusOf = useCallback((id: string): RemediationTrackerStepStatus => statuses.get(id) ?? "not_started", [statuses]);

  // The design preview has no real rescan pipeline behind it (#732 hooks into
  // a real scan, `diagnostics-runner.ts`, for an account that exists) —
  // `?preview=design` stays "nothing verified yet" on every step rather than
  // simulating a rescan outcome nobody ran.
  const verification = progress ? progress.verification : EMPTY_VERIFICATION;
  const verificationOf = useCallback(
    (id: string): RemediationTrackerVerificationState => verification.get(id)?.state ?? "unverified",
    [verification],
  );

  const view = !isPreview && live ? live.view : null;
  const tenant = view ? view.tenant : PREVIEW_TENANT;

  // The live steps are `REMEDIATION_STEPS` resolved against this tenant and then
  // FILTERED to the ones that belong on their list (#658) — so `total`,
  // `scripted`, `resolvedCount`, the progress bar, the pillar groups and every
  // count-bearing resolver below are all derived off this array and reflect the
  // REAL rendered step count for this tenant, never a hardcoded 28. The preview
  // path renders the full `REMEDIATION_STEPS` catalogue unchanged.
  const liveSteps = useMemo<readonly (RemediationStep | LiveRemediationStep)[]>(
    () => (view ? buildLiveRemediationSteps(view) : REMEDIATION_STEPS),
    [view],
  );

  // #782: the five fillable steps' scripts, with real per-tenant values
  // substituted in place of `<placeholder>` where #776's data has them. Layered
  // on AFTER `buildLiveRemediationSteps` rather than inside it, so
  // remediationLiveGuide.ts stays synchronous and free of the async fetch this
  // needs — `applyLiveScriptParams` itself is a pure function and returns
  // `null` (render unchanged) for every step outside the fillable five, and for
  // a fillable one when nothing usable was collected. Never runs on preview:
  // `checkItems` is only ever supplied by `LiveRemediationGuideBody`.
  const steps = useMemo<readonly (RemediationStep | LiveRemediationStep)[]>(() => {
    if (!checkItems || !view) return liveSteps;
    return liveSteps.map((step) => {
      if (!step.code) return step;
      const parametrized = applyLiveScriptParams(step.id, step.code, checkItems.items);
      const code = parametrized ?? step.code;
      // Git #1042: `<your-tenant>` still needs filling even when
      // `applyLiveScriptParams` found nothing usable to substitute (s1's
      // sharepoint:orgwide-links collection can be empty while the tenant's
      // SharePoint prefix is still known) — a second, independent pass.
      const script = applyLiveTenantDomain(code.script, checkItems.sharePointTenantPrefix);
      if (parametrized === null && script === code.script) return step;
      return { ...step, code: { ...code, script } };
    });
  }, [liveSteps, checkItems, view]);

  // The explicit never-scanned / no-mapped-finding state (#658): only when the
  // live guide collapsed to the two always-on process steps. Null on preview and
  // on any tenant with at least one finding-driven step.
  const selectionNotice = useMemo(
    () => (view ? resolveDynamicSelectionNotice(steps as readonly LiveRemediationStep[], view.pillars) : null),
    [view, steps],
  );

  const total = steps.length;
  const scripted = useMemo(
    () => (view ? steps.filter((s) => s.code !== undefined).length : REMEDIATION_SCRIPTED_COUNT),
    [view, steps],
  );
  // Counted over the steps actually on screen rather than off `statuses.size`:
  // the stored state is keyed by step id and the rendered guide is the only
  // authority on which ids exist, so an id the guide no longer holds must not
  // inflate "N of 30 resolved".
  //
  // Counts every actioned status, not only `completed` (#731): "already
  // handled another way" or "handed to Shane" is still a decision made about
  // the step, and a bar that only advanced on literal self-resolve would make
  // the other four actions look like they hadn't registered.
  const resolvedCount = useMemo(
    () => steps.reduce((n, s) => (statusOf(s.id) !== "not_started" ? n + 1 : n), 0),
    [steps, statusOf],
  );
  const accent = reportAccent(null);
  const scannedOn = tenant.scannedOn ?? "";
  // Git #1042: `LIVE_PRELUDE`'s connect block is rendered here directly, never
  // through `applyLiveScriptParams`/`liveSteps` above — it isn't one of
  // `LIVE_STEP_SCRIPTS`' five fillable steps, it's a standalone block this
  // component reads straight off remediationLiveGuide.ts. Its own
  // `<your-tenant>` fill needs the same independent `applyLiveTenantDomain`
  // pass, not a ride on the step-substitution path.
  const prelude = useMemo(() => {
    if (!view) return REMEDIATION_PRELUDE;
    const script = applyLiveTenantDomain(LIVE_PRELUDE.code.script, checkItems?.sharePointTenantPrefix ?? null);
    return script === LIVE_PRELUDE.code.script ? LIVE_PRELUDE : { ...LIVE_PRELUDE, code: { ...LIVE_PRELUDE.code, script } };
  }, [view, checkItems]);

  const byPillar = useMemo(() => {
    const map = new Map<PillarKey, (RemediationStep | LiveRemediationStep)[]>();
    for (const step of steps) {
      const list = map.get(step.pillar);
      if (list) list.push(step);
      else map.set(step.pillar, [step]);
    }
    return map;
  }, [steps]);

  const checklistRows = useMemo(
    () => (view ? resolveChecklistRows(false, view) : REMEDIATION_GUIDE.checklist.rows),
    [view],
  );
  const closing = useMemo(
    () => resolveClosing(view === null, total, scripted),
    [view, total, scripted],
  );
  // Git #1041: the Email Authentication Setup page is a standalone page
  // linked in from here, not a numbered remediation step (#658's
  // STEP_CHECK_KEYS has no exchange:dkim-spf-dmarc-status entry, and the
  // issue's own resolution is explicit that a standalone linked page is the
  // intended shape). Shown only when this tenant's own findings actually
  // carry the check's gap — never on the design preview, which has no real
  // finding to be true or false about.
  const hasEmailAuthGap = useMemo(
    () =>
      view
        ? view.pillars.some((p) => p.findings.some((f) => f.checkKey === "exchange:dkim-spf-dmarc-status"))
        : false,
    [view],
  );
  const provenance = view
    ? buildProvenance(tenant.scannedOn, 0)
    : `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions. ${PREVIEW_SIGNAL_COUNT} signal derivation checks across six pillars. No configuration was altered during assessment.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 13,
          borderBottom: `1px solid ${INK.hairlineDark}`,
          paddingBottom: 24,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: BRAND.teal,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={BRAND.teal} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
            <path d={accent.icon} />
          </svg>
          {REMEDIATION_GUIDE.kicker}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px,2.8vw,31px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
            color: INK.headingDark,
            textWrap: "pretty",
          }}
        >
          {REMEDIATION_GUIDE.headline}
        </h1>
        <p style={{ ...BODY, fontSize: 15.5, lineHeight: 1.62 }}>
          {resolveStandfirst(view === null, total, scripted)}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              height: 6,
              flex: "1 1 220px",
              minWidth: 160,
              borderRadius: 999,
              background: "rgba(255,255,255,.1)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                borderRadius: 999,
                background: accent.band,
                transition: "width 260ms ease",
                width: `${Math.round((resolvedCount / total) * 100)}%`,
              }}
            />
          </span>
          <span
            data-testid="remediation-progress"
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: resolvedCount === total ? SEVERITY_ON_DARK.healthy : BRAND.teal,
              ...TABULAR,
            }}
          >
            {`${resolvedCount} of ${total} steps resolved`}
          </span>
        </div>
        {/*
          The save state, and only when there is something to say. A failed
          write has already been rolled back by the hook, so the boxes on screen
          match what is stored — this line exists so a customer is told the
          write did not land rather than left to assume it did.
        */}
        {progress && (progress.error !== null || progress.saving) ? (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: progress.error !== null ? SEVERITY_ON_DARK.critical : INK.micro,
            }}
          >
            {progress.error !== null
              ? "Your last change could not be saved, so it has been undone here. Check your connection and try again."
              : "Saving…"}
          </span>
        ) : null}
      </div>

      <div
        style={{
          position: "relative",
          overflow: "hidden",
          border: `1px solid ${hexAlpha(BRAND.teal, 0.33)}`,
          borderRadius: 12,
          background: `linear-gradient(135deg,${hexAlpha(BRAND.teal, 0.1)},rgba(2,6,23,.45))`,
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: BRAND.teal }}>
          {REMEDIATION_GUIDE.scope.eyebrow}
        </span>
        <span
          style={{
            fontSize: "clamp(22px,2.8vw,32px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.12,
            color: INK.headingDark,
            textWrap: "pretty",
          }}
        >
          {view ? resolveScopeHeadline(false, total, view.pillars) : REMEDIATION_GUIDE.scope.headline}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
          {REMEDIATION_GUIDE.scope.sub}
        </span>
      </div>

      {/* Overview */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{REMEDIATION_GUIDE.overview.heading}</h2>
        <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
          {REMEDIATION_GUIDE.overview.blurb}
        </p>
        <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
          {REMEDIATION_GUIDE.overview.rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(150px,1.15fr) minmax(0,1.85fr)",
                gap: 14,
                padding: "11px 10px",
                borderBottom: `1px solid ${INK.hairlineDark}`,
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: INK.headingDark }}>{row.label}</span>
              <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: SEVERITY_ON_DARK[row.tone] }}>
                {/* The step-count row stays derived in both paths — see its own
                    note in `previewRemediationGuide.ts` for why restating the
                    design's contradicted figure would be worse than correcting
                    it. The other four state this tenant's own numbers on a live
                    journey, or the design's worked example in preview. */}
                {"derived" in row
                  ? `${total}, of which ${scripted} are scripted`
                  : view
                    ? resolveOverviewValue(row.label, row.value, view)
                    : row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Connect once */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{prelude.heading}</h2>
        <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
          {prelude.blurb}
        </p>
        <CodeBlock code={prelude.code} />
        <p style={{ ...BODY, fontSize: 12.5, lineHeight: 1.6, color: INK.bodyDark }}>
          {prelude.footnote}
        </p>
      </div>

      {/*
        The explicit no-findings-drove-selection state (#658). Shown only when
        the live guide collapsed to the two always-on process steps — a
        never-scanned tenant, or one whose findings map to no step here. This is
        the state that must look visibly different from a real personalised
        runbook rather than silently reading as a two-step plan.
      */}
      {selectionNotice ? (
        <div
          data-testid="remediation-selection-notice"
          style={{
            display: "flex",
            gap: 11,
            alignItems: "flex-start",
            padding: "14px 16px",
            borderRadius: 10,
            border: `1px solid ${hexAlpha(BRAND.teal, 0.33)}`,
            background: hexAlpha(BRAND.teal, 0.07),
          }}
        >
          <span aria-hidden="true" style={{ flex: "none", marginTop: 1, color: BRAND.teal, display: "flex" }}>
            <Info size={16} strokeWidth={2.2} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.6, color: INK.bodyDarkStrong }}>
            {selectionNotice}
          </span>
        </div>
      ) : null}

      {/* The steps, grouped by pillar */}
      {REMEDIATION_GUIDE.groups.map((group) => {
        const steps = byPillar.get(group.pillar) ?? [];
        if (steps.length === 0) return null;
        return (
          <div key={group.heading} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <h2 style={H2}>{group.heading}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {steps.map((step) => (
                <Step
                  key={step.id}
                  step={step}
                  status={statusOf(step.id)}
                  verification={verificationOf(step.id)}
                  onToggleComplete={toggleComplete}
                  onSetAction={setAction}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Critical path */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{REMEDIATION_GUIDE.sequence.heading}</h2>
        <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
          {REMEDIATION_GUIDE.sequence.phases.map((phase) => (
            <div
              key={phase.label}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 108px minmax(0,1fr) minmax(0,1.1fr)",
                gap: 12,
                padding: "11px 10px",
                borderBottom: `1px solid ${INK.hairlineDark}`,
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: INK.link }}>
                {phase.label}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.headingDark, ...TABULAR }}>{phase.when}</span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>{phase.steps}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.bodyDarkStrong }}>{phase.title}</span>
            </div>
          ))}
        </div>
        <p style={{ ...BODY, fontSize: 13, lineHeight: 1.6, color: INK.bodyDark }}>
          {REMEDIATION_GUIDE.sequence.note}
        </p>
      </div>

      {/* Gate validation */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>{REMEDIATION_GUIDE.checklist.heading}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {checklistRows.map((row) => (
            <div
              key={row}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px" }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1px solid rgba(100,116,139,.9)`,
                  flex: "none",
                  marginTop: 1,
                }}
              />
              <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
                {row}
              </span>
            </div>
          ))}
        </div>
        <p style={{ ...BODY, fontSize: 13, lineHeight: 1.6, color: INK.bodyDark }}>
          {view ? resolveChecklistNote(false, view) : REMEDIATION_GUIDE.checklist.note}
        </p>
      </div>

      {/* Executive summary */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={H2}>Executive Summary</h2>
        {closing.map((p) => (
          <p key={p.slice(0, 40)} style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
            {p}
          </p>
        ))}
      </div>

      {/* Email Authentication Setup — Git #1041, standalone page, not a
          numbered step (see hasEmailAuthGap above). */}
      {hasEmailAuthGap ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 11,
            padding: "20px 22px",
            border: `1px solid ${hexAlpha(BRAND.blue, 0.28)}`,
            borderRadius: 12,
            background: hexAlpha(BRAND.blue, 0.06),
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: INK.headingDark }}>
            <Mail size={16} strokeWidth={2.2} />
            Email Authentication (SPF/DKIM/DMARC)
          </span>
          <p style={{ ...BODY, fontSize: 14, lineHeight: 1.6 }}>
            Your scan found a gap in SPF, DKIM, or DMARC — the checks mailbox providers use to verify email sent from
            your domain is genuinely from you. Step-by-step fix instructions, with your real domain filled in, are on
            a dedicated page.
          </p>
          <Link
            href="/email-auth-setup"
            style={{
              alignSelf: "flex-start",
              fontSize: 12.5,
              fontWeight: 600,
              color: BRAND.blue,
            }}
          >
            Fix email authentication →
          </Link>
        </div>
      ) : null}

      {/* Handoff to the SOW */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 11,
          padding: "20px 22px",
          border: `1px solid ${hexAlpha(BRAND.teal, 0.28)}`,
          borderRadius: 12,
          background: hexAlpha(BRAND.teal, 0.06),
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: INK.headingDark }}>
          {REMEDIATION_GUIDE.handoff.heading}
        </span>
        <p style={{ ...BODY, fontSize: 14, lineHeight: 1.6 }}>
          {resolveHandoffBlurb(view === null, total)}
        </p>
        {onOpenSow ? (
          <button
            type="button"
            onClick={onOpenSow}
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 15px",
              height: 34,
              border: 0,
              borderRadius: 6,
              background: BRAND.blue,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              color: BRAND.white,
            }}
          >
            {REMEDIATION_GUIDE.handoff.cta}
          </button>
        ) : null}
      </div>

      <p
        style={{
          margin: 0,
          paddingTop: 20,
          borderTop: `1px solid ${INK.hairlineDark}`,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: INK.bodyDark,
        }}
      >
        {provenance}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LiveRemediationGuideBody — what `DocumentBody.tsx` mounts on a real journey.
 * ------------------------------------------------------------------ */

/**
 * Everything this document READS is already on the journey's view.
 *
 * The SOW needs a scope and a price, which live behind two endpoints of their
 * own. This guide needs findings, stat counts, a readiness score and a scan
 * date — all of which the caller is already holding by the time any document
 * renders, so none of that is fetched again here.
 *
 * The one fetch this component does make is for what the customer WRITES: the
 * tracker state (#730), which is theirs rather than the scan's and so cannot be
 * on a payload computed from their last run.
 *
 * #782 adds a second, read-only fetch: the raw per-item detail behind the five
 * fillable scripts' placeholders (#776). That genuinely is not on the
 * journey's view — `war-room-pillars` and friends carry stats and findings,
 * never raw item lists (see remediationScriptParams.ts's own header) — so it
 * is fetched here rather than threaded through the view's own payload.
 */
export function LiveRemediationGuideBody({
  view,
  onOpenSow,
}: {
  readonly view: JourneyView;
  readonly onOpenSow?: () => void;
}) {
  // The one exception to "no fetch of its own" (#730): the tick state is the
  // customer's, not the scan's, so it is the only thing on this document the
  // journey's view cannot already be holding.
  const progress = useRemediationTracker();
  // #782: the five fillable scripts' real per-item data. A slow or failed load
  // simply leaves every script at its honest placeholder — see
  // applyLiveScriptParams's own null-on-nothing-usable contract — so there is
  // no loading/error branch to gate the guide's render on here.
  const checkItems = useTenantCheckItems();
  return (
    <RemediationGuideBody isPreview={false} live={{ view }} onOpenSow={onOpenSow} progress={progress} checkItems={checkItems} />
  );
}
