import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Building2, Pause, Play, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WorkflowSteps } from "./WorkflowSteps";
import { IllustrativeBadge } from "./IllustrativeBadge";
import { PillarScoreRing } from "./PillarScoreRing";

/**
 * Flagship "How It Works" block — the topic's 5 real workflow steps on the left,
 * paired on the right with one animated visual PER step instead of a single
 * static panel: Connect (scoped read-only Graph connection), Scan (progress bar
 * + the real scan-surface labels as rotating status rows), Findings (the real
 * metric bars, moved here from the old static FlagshipFindingsPanel), Score
 * (the page's illustrative Governance pillar ring), Remediate (the same ring
 * after remediation — a conceptual before/after of the mechanism).
 *
 * Interaction model: auto-advances one stage at a time while scrolled into view
 * (the site's IntersectionObserver reveal convention), pauses while the visitor
 * hovers the panel or focuses its stage rail, and is directly driven by
 * hovering/clicking a step in the left column (the Assessments wizard's
 * respond-immediately-to-input convention). Any DELIBERATE choice — clicking a
 * rail dot or a left-column step — stops the auto-advance for good, and the
 * rail carries an explicit pause/play toggle (WCAG 2.2.2's persistent pause
 * mechanism). Under prefers-reduced-motion there is no auto-advance and no
 * animation — stages render complete and are switched manually via the rail.
 *
 * DATA HONESTY: every number shown (metric counts, the pre-remediation ring
 * value, the remediated 85) is
 * illustrative under the panel's "Illustrative Example" badge + the established
 * "Example data" caption; scan status rows are the four REAL scan surfaces
 * passed in from the topic's scanSurfaces data, never invented coverage. The
 * whole visual stack is aria-hidden decoration — the real step copy lives in
 * the left column, and the badge + rail stay readable to assistive tech.
 */

const STAGE_MS = 4200;
const SCAN_MS = 3400;
/** Crossfade duration between stages — must match the duration-500 on StageCell. */
const STAGE_FADE_MS = 500;

/** WorkflowSteps' number-circle gradient — the rail echoes the left column. */
const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

interface WorkflowStep {
  title: string;
  description: string;
  /** Short label for the panel's own bottom rail (stage buttons are narrow,
   *  5-across) — falls back to the full `title` when absent, so callers with
   *  already-short titles (e.g. "Connect", "Scan") don't need to set this. */
  railLabel?: string;
}

export interface ScanSurface {
  icon: LucideIcon;
  label: string;
  /** Real per-surface description (scanSurfaces data — already page copy). */
  sublabel?: string;
}

/**
 * Per-stage visual spec for the site-wide flagship rollout: every override
 * defaults to the Governance pilot's original hardcoded copy, so callers
 * without `stages` (Governance itself) render byte-identically to before.
 * Topics whose real steps or engine attribution differ (e.g. Migration's
 * Discover→Validate engagement sequence, or a topic re-checked by the Security
 * Engine rather than the Drift Engine) pass their own honest labels instead of
 * inheriting another topic's claims.
 */
export interface ConnectStageSpec {
  kind: "connect";
  fromLabel?: string;
  viaLabel?: string;
  toLabel?: string;
  /** One line per claim from the step's REAL page copy — never generic boilerplate. */
  checklist?: string[];
}
export interface ScanStageSpec {
  kind: "scan";
  /** Defaults to the showcase's scanSurfaces prop (the topic's real scan coverage). */
  surfaces?: ScanSurface[];
  /** Present-tense verb for the rotating status line ("Scanning", "Discovering"…). */
  verb?: string;
  completeText?: string;
}
export interface FindingsStageSpec {
  kind: "findings";
  /** Defaults to dashboard.panelLabel. */
  panelLabel?: string;
  /** Footer text after the amber count — the stage's real claim, per topic. */
  note?: string;
}
export interface ScoreStageSpec {
  kind: "score";
}
export interface RemediateStageSpec {
  kind: "remediate";
  headline?: string;
  /** The re-check attribution line — MUST name the topic's real engine/cadence. */
  note?: string;
  afterLabel?: string;
}
export type ShowcaseStageSpec =
  | ConnectStageSpec
  | ScanStageSpec
  | FindingsStageSpec
  | ScoreStageSpec
  | RemediateStageSpec;

/** The Governance pilot's original stage order — the default for every caller. */
const DEFAULT_STAGES: ShowcaseStageSpec[] = [
  { kind: "connect" },
  { kind: "scan" },
  { kind: "findings" },
  { kind: "score" },
  { kind: "remediate" },
];

/** Structural subset of SolutionTopicFlagship["dashboard"] (solutionsTopics.ts). */
interface ShowcaseDashboard {
  panelLabel: string;
  ringLabel: string;
  ringValue: number;
  remediatedRingValue?: number;
  metrics: { label: string; count: number }[];
  caption: string;
}

interface HowItWorksShowcaseProps {
  steps: WorkflowStep[];
  dashboard: ShowcaseDashboard;
  scanSurfaces: ScanSurface[];
  /** Per-stage visual specs (flagship rollout) — omitted by Governance, which
   *  keeps the original hardcoded five-stage sequence via DEFAULT_STAGES. */
  stages?: ShowcaseStageSpec[];
}

/** Static read, matching useRevealOnScroll's lazy-init convention (SolutionTopicPage.tsx). */
function usePrefersReducedMotion() {
  const [reduced] = useState(
    () => typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  return reduced;
}

/**
 * True while a stage should DISPLAY as revealed: flips true immediately on
 * activation, but only flips false after the crossfade has fully hidden the
 * stage — so an outgoing stage never visibly resets or reverse-animates
 * mid-fade (its sweeps/bars tear down at opacity 0 instead).
 */
function useRevealedWhileFading(isActive: boolean) {
  const [revealed, setRevealed] = useState(isActive);
  useEffect(() => {
    if (isActive) {
      setRevealed(true);
      return;
    }
    const t = setTimeout(() => setRevealed(false), STAGE_FADE_MS + 100);
    return () => clearTimeout(t);
  }, [isActive]);
  return revealed;
}

/** One stacked crossfading stage cell; hands its delayed reveal flag to the stage. */
function StageCell({
  isActive,
  reduced,
  children,
}: {
  isActive: boolean;
  reduced: boolean;
  children: (revealed: boolean) => ReactNode;
}) {
  const revealed = useRevealedWhileFading(isActive) || reduced;
  return (
    <div
      className={`col-start-1 row-start-1 flex flex-col justify-center transition-[opacity,transform] duration-500 motion-reduce:transition-none ${
        isActive ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1.5 pointer-events-none"
      }`}
    >
      {children(revealed)}
    </div>
  );
}

/** Stage 1 — the scoped, read-only Graph API connection being established.
 *  Labels/checklist default to the Governance pilot's copy; other topics pass
 *  their own real claims (a Migration "Design" gate reuses the same A→B visual
 *  grammar with source-inventory → locked-architecture endpoints). */
function ConnectStage({
  animate,
  fromLabel = "Your tenant",
  viaLabel = "Microsoft Graph API",
  toLabel = "Read-only scan",
  checklist = ["Scoped connection", "Read-only", "No agent installed", "No standing credential left behind"],
}: {
  animate: boolean;
  fromLabel?: string;
  viaLabel?: string;
  toLabel?: string;
  checklist?: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-2.5 shrink-0 w-24">
          <div className="w-14 h-14 rounded-xl glass-panel flex items-center justify-center">
            <Building2 className="w-6 h-6 text-text-secondary" />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-text-secondary text-center leading-tight">
            {fromLabel}
          </span>
        </div>
        <div className="relative flex-1 h-14">
          <div
            className="absolute left-0 right-0 top-5 h-px"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--accent-blue) 0 6px, transparent 6px 12px)",
              opacity: 0.65,
              animation: animate ? "hiwDashMarch 0.9s linear infinite" : undefined,
            }}
          />
          {animate && (
            <div
              className="absolute top-5 -mt-[2.5px] w-1.5 h-1.5 rounded-full bg-accent-blue"
              style={{ animation: "hiwTravelDot 1.8s ease-in-out infinite" }}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 text-center text-[10px] uppercase tracking-wider text-text-secondary truncate">
            {viaLabel}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2.5 shrink-0 w-24">
          <div className="w-14 h-14 rounded-xl glass-panel flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-accent-blue" />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-text-secondary text-center leading-tight">
            {toLabel}
          </span>
        </div>
      </div>
      {/* Each line is a claim from this step's real page copy (default: scoped,
          read-only, no agent installed, no standing credential). */}
      <div className="mt-10 mx-auto w-fit space-y-3.5">
        {checklist.map((line) => (
          <div key={line} className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm text-text-secondary">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stage 2 — progress bar ticking upward + the four real scan surfaces as
 *  sequentially-advancing status rows (queued → scanning → done). */
function ScanStage({
  active,
  revealed,
  reduced,
  surfaces,
  verb = "Scanning",
  completeText = "Scan complete — findings logged",
}: {
  active: boolean;
  /** Delayed reveal (useRevealedWhileFading) — stays true through the fade-out
   *  so the finished scan doesn't visibly snap back to zero mid-crossfade. */
  revealed: boolean;
  reduced: boolean;
  surfaces: ScanSurface[];
  verb?: string;
  completeText?: string;
}) {
  const total = surfaces.length;
  // Number of surfaces finished so far; the row at this index is "scanning".
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (reduced || total === 0) return;
    if (active) {
      setDone(0);
      const id = setInterval(() => {
        setDone((d) => {
          if (d + 1 >= total) clearInterval(id);
          return Math.min(d + 1, total);
        });
      }, SCAN_MS / total);
      return () => clearInterval(id);
    }
    // Tear down only once the crossfade has fully hidden this stage.
    if (!revealed) setDone(0);
    return undefined;
  }, [active, revealed, reduced, total]);

  const shownDone = reduced ? total : done;
  const complete = shownDone >= total && total > 0;

  return (
    <div>
      <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            ...GRADIENT_BG,
            width: active || revealed || reduced ? "100%" : "0%",
            transition: active && !reduced ? `width ${SCAN_MS}ms linear` : "none",
          }}
        />
      </div>
      {/* The literal rotating status line, driven by the real surface labels. */}
      <div className="mt-3 text-xs text-text-secondary min-h-[1.25rem]">
        {complete ? completeText : `${verb} ${surfaces[shownDone]?.label ?? ""}…`}
      </div>
      <div className="mt-6 space-y-4">
        {surfaces.map((s, i) => {
          const state = i < shownDone ? "done" : i === shownDone && active && !reduced ? "scanning" : "queued";
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-start gap-3">
              <Icon
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  state === "scanning" ? "text-accent-blue animate-pulse" : "text-text-secondary"
                } ${state === "queued" ? "opacity-40" : ""}`}
              />
              <div className={`flex-1 min-w-0 ${state === "queued" ? "opacity-50" : ""}`}>
                <div className="text-xs text-text-secondary">{s.label}</div>
                {s.sublabel && (
                  <div className="text-[11px] text-text-secondary opacity-60 leading-snug mt-0.5">
                    {s.sublabel}
                  </div>
                )}
              </div>
              {state === "done" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-text-secondary opacity-60 shrink-0 mt-0.5">
                  {state === "scanning" ? `${verb}…` : "Queued"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Stage 3 — the real metric bars, moved verbatim from the old static
 *  FlagshipFindingsPanel (target-0 semantics: 0 = healthy empty track,
 *  count > 0 = flat amber bar scaled to the largest count). */
function FindingsStage({
  revealed,
  dashboard,
  panelLabel,
  note = "findings logged this scheduled evaluation — each one inspectable",
}: {
  revealed: boolean;
  dashboard: ShowcaseDashboard;
  panelLabel?: string;
  note?: string;
}) {
  const maxCount = Math.max(...dashboard.metrics.map((m) => m.count), 1);
  const totalCount = dashboard.metrics.reduce((sum, m) => sum + m.count, 0);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-5">
        {panelLabel ?? dashboard.panelLabel}
      </div>
      <div className="space-y-4">
        {dashboard.metrics.map((m, i) => (
          <div key={m.label} className="flex items-center gap-3">
            <span className="text-xs text-text-secondary w-40 shrink-0">{m.label}</span>
            <div className="flex-1 h-2 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: revealed ? `${(m.count / maxCount) * 100}%` : "0%",
                  background: "#f59e0b",
                  transitionDelay: `${i * 120}ms`,
                }}
              />
            </div>
            <span
              className={`font-numeric text-xs w-7 text-right ${m.count > 0 ? "text-amber-400" : "text-text-secondary"}`}
            >
              {m.count}
            </span>
          </div>
        ))}
      </div>
      {/* Sum of the counts shown above (FlagshipDriftPanel's footer language) —
          the note text is each topic's real Findings-step claim. */}
      <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        <span className="text-xs text-text-secondary">
          <span className="font-numeric text-amber-400">{totalCount}</span> {note}
        </span>
      </div>
    </div>
  );
}

/** Stage 4 — the findings rolled up into the page's illustrative pillar score. */
function ScoreStage({ revealed, dashboard }: { revealed: boolean; dashboard: ShowcaseDashboard }) {
  return (
    <div className="flex flex-col items-center text-center">
      <PillarScoreRing value={dashboard.ringValue} size={136} strokeWidth={10} revealed={revealed} />
      <div className="mt-5 text-sm font-semibold text-text-primary">{dashboard.ringLabel}</div>
      <div className="mt-1.5 text-xs text-text-secondary">
        Architecture Health Engine · {dashboard.caption}
      </div>
    </div>
  );
}

/** Stage 5 — the same ring after remediation: a conceptual before/after of the
 *  mechanism (ranked fixes, re-checked next scheduled evaluation), NOT a real
 *  customer's scores. Falls back to the plain score if no remediated value is
 *  authored, rather than inventing one here. */
function RemediateStage({
  revealed,
  dashboard,
  headline = "Ranked fixes — biggest exposure closed first",
  note = "Drift Engine re-checks the same baseline on your next scheduled evaluation",
  afterLabel = "After remediation",
}: {
  revealed: boolean;
  dashboard: ShowcaseDashboard;
  headline?: string;
  note?: string;
  afterLabel?: string;
}) {
  const after = dashboard.remediatedRingValue;
  if (after === undefined) {
    return <ScoreStage revealed={revealed} dashboard={dashboard} />;
  }
  return (
    <div>
      <div className="flex items-center justify-center gap-5 sm:gap-6">
        <div className="flex flex-col items-center gap-2 shrink-0">
          <PillarScoreRing value={dashboard.ringValue} size={56} strokeWidth={5} revealed={revealed} />
          <span className="text-[10px] uppercase tracking-wider text-text-secondary">Before</span>
        </div>
        <ArrowRight className="w-5 h-5 text-text-secondary shrink-0" />
        <div className="flex flex-col items-center gap-2 shrink-0">
          <PillarScoreRing value={after} size={136} strokeWidth={10} revealed={revealed} />
          <span className="text-[10px] uppercase tracking-wider text-text-secondary">{afterLabel}</span>
        </div>
      </div>
      {/* Both lines are this step's real copy, compressed — the note MUST name
          the topic's real engine/cadence (default: the Governance pilot's
          Drift Engine claim). */}
      <div className="mt-7 text-center">
        <div className="text-sm font-semibold text-text-primary">{headline}</div>
        <div className="text-xs text-text-secondary mt-1.5">{note}</div>
        <div className="text-xs text-text-secondary opacity-70 mt-1">{dashboard.caption}</div>
      </div>
    </div>
  );
}

export function HowItWorksShowcase({ steps, dashboard, scanSurfaces, stages }: HowItWorksShowcaseProps) {
  const reduced = usePrefersReducedMotion();
  const stageSpecs = stages ?? DEFAULT_STAGES;
  const stageCount = Math.min(steps.length, stageSpecs.length);
  const [active, setActive] = useState(0);
  const [pausedByPanel, setPausedByPanel] = useState(false);
  const [pausedByFocus, setPausedByFocus] = useState(false);
  // Persistent, user-controlled stop (WCAG 2.2.2): set by the rail's pause
  // toggle and by any DELIBERATE stage choice (click/tap — not hover), so a
  // chosen stage is never auto-advanced away and the motion can be stopped
  // for good while reading the parallel step copy.
  const [stopped, setStopped] = useState(false);
  const [inView, setInView] = useState(false);
  // Bumped on every manual selection (hover or click) to restart the
  // auto-advance countdown from a full stage duration. Kept OUT of the
  // interval effect's active-tracking so a plain auto-advance tick never
  // tears down and recreates the interval itself (see the effect below).
  const [restartToken, setRestartToken] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Track visibility continuously (not disconnect-on-first-reveal like
  // useRevealOnScroll): the loop should stop again when scrolled away.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || reduced) return;
    const obs = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), {
      threshold: 0.3,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  // Mirrors the pause condition into a ref, updated synchronously on every
  // render (not via its own effect) — closes a real race where a click's
  // setStopped(true) and the auto-advance effect's clearInterval cleanup
  // are NOT synchronous with each other (cleanup is a passive effect,
  // deferred until after paint), so an already-scheduled interval tick can
  // still fire in that gap and silently advance `active` one stage past
  // whatever the user just clicked — reading as a click "jumping" to the
  // wrong step. The interval tick below checks this ref before advancing,
  // which IS synchronous with the click (refs update mid-render, well
  // before the browser can run any queued timer callback).
  const skipAdvanceRef = useRef(false);
  skipAdvanceRef.current = reduced || stopped || pausedByPanel || pausedByFocus || !inView;

  // Auto-advance. Deliberately does NOT depend on `active` — the interval's
  // own tick advances `active` via the functional setActive updater below,
  // so re-running this effect on every tick would tear down and recreate the
  // interval on every single stage change, racing against pausedByPanel/
  // pausedByFocus/inView toggling mid-cycle and occasionally landing the
  // cycle back on the wrong stage instead of a clean 1→2→3→4→5→1 loop.
  // `restartToken` (bumped only by a manual hover/click selection, never by
  // the auto-advance tick itself) is what restarts the countdown from a full
  // stage duration after a manual retarget.
  useEffect(() => {
    if (reduced || stopped || pausedByPanel || pausedByFocus || !inView || stageCount < 2) return;
    const id = setInterval(() => {
      if (skipAdvanceRef.current) return;
      setActive((a) => (a + 1) % stageCount);
    }, STAGE_MS);
    return () => clearInterval(id);
  }, [reduced, stopped, pausedByPanel, pausedByFocus, inView, stageCount, restartToken]);

  if (stageCount === 0) return null;
  const activeStep = steps[Math.min(active, stageCount - 1)];
  const anyPause = stopped || pausedByPanel || pausedByFocus;

  const handleSelect = (index: number, deliberate = false) => {
    setActive(index);
    setRestartToken((t) => t + 1);
    if (deliberate) setStopped(true);
  };

  // Connect-stage dash/dot loops are the only INFINITE animations, so they
  // respect every pause flag AND `inView` — not just reduced motion
  // (WCAG 2.2.2) — so the loop never starts before it's scrolled into view
  // and stops the moment it scrolls back out; the other stages' sweeps are
  // single sub-5s runs. Cells are built from the per-topic stage specs (each
  // closing over its own index, so a spec kind may appear at any position or
  // more than once — e.g. Migration's Design and Execute gates both reuse the
  // connect grammar).
  const stageCells: ((revealed: boolean) => ReactNode)[] = stageSpecs
    .slice(0, stageCount)
    .map((spec, i) => {
      switch (spec.kind) {
        case "connect":
          return () => (
            <ConnectStage
              animate={active === i && !reduced && !anyPause && inView}
              fromLabel={spec.fromLabel}
              viaLabel={spec.viaLabel}
              toLabel={spec.toLabel}
              checklist={spec.checklist}
            />
          );
        case "scan":
          return (revealed: boolean) => (
            <ScanStage
              active={active === i}
              revealed={revealed}
              reduced={reduced}
              surfaces={spec.surfaces ?? scanSurfaces}
              verb={spec.verb}
              completeText={spec.completeText}
            />
          );
        case "findings":
          return (revealed: boolean) => (
            <FindingsStage
              revealed={revealed}
              dashboard={dashboard}
              panelLabel={spec.panelLabel}
              note={spec.note}
            />
          );
        case "score":
          return (revealed: boolean) => <ScoreStage revealed={revealed} dashboard={dashboard} />;
        case "remediate":
          return (revealed: boolean) => (
            <RemediateStage
              revealed={revealed}
              dashboard={dashboard}
              headline={spec.headline}
              note={spec.note}
              afterLabel={spec.afterLabel}
            />
          );
      }
    });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-stretch">
      <div>
        <WorkflowSteps steps={steps} activeIndex={active} onStepSelect={handleSelect} />
      </div>

      <div
        ref={panelRef}
        onMouseEnter={() => setPausedByPanel(true)}
        onMouseLeave={() => setPausedByPanel(false)}
        className="relative rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8 h-full flex flex-col"
      >
        <IllustrativeBadge />
        {/* The badge occupies ~11rem top-right; the step title is dropped on
            mobile (it's in the rail below) so the header never runs under it.
            sm:pr-36 (not pr-28) — at the panel's narrowest real width (the
            lg 2-column breakpoint, ~1024-1180px viewport), pr-28 left the
            longest step titles running under the badge. */}
        <h3 className="text-xs uppercase tracking-widest text-text-secondary mb-6 pr-32 sm:pr-36">
          Step {active + 1} of {stageCount}
          <span className="hidden sm:inline"> — {activeStep?.title}</span>
        </h3>

        {/* Decorative stage stack: every stage occupies the same grid cell, so
            the panel's height is simply the tallest stage (no layout jumps),
            and the active one crossfades in. The stack is aria-hidden as one
            unit — the real 5-step copy is the left column; the badge above and
            the rail below stay in the accessibility tree. */}
        <div aria-hidden="true" className="grid flex-grow">
          {stageCells.map((render, i) => (
            <StageCell key={i} isActive={i === active} reduced={reduced}>
              {render}
            </StageCell>
          ))}
        </div>

        {/* Stage rail — the panel's own (keyboard-accessible) navigation,
            echoing the left column's numbered-circle language. */}
        <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-start justify-between gap-1">
          {steps.slice(0, stageCount).map((step, i) => (
            <button
              key={step.title}
              type="button"
              onClick={() => handleSelect(i, true)}
              onFocus={() => setPausedByFocus(true)}
              onBlur={() => setPausedByFocus(false)}
              aria-pressed={i === active}
              aria-label={`Show step ${i + 1}: ${step.title}`}
              className="group flex flex-col items-center gap-1.5 flex-1 min-w-0"
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold font-numeric transition-colors duration-300 ${
                  i === active ? "text-white" : "bg-white/[0.08] text-text-secondary group-hover:bg-white/[0.16]"
                }`}
                style={i === active ? GRADIENT_BG : undefined}
              >
                {i + 1}
              </span>
              <span
                className={`text-[9px] sm:text-[10px] uppercase tracking-normal sm:tracking-wider max-w-full truncate transition-colors duration-300 ${
                  i === active ? "text-text-primary" : "text-text-secondary"
                }`}
              >
                {step.railLabel ?? step.title}
              </span>
            </button>
          ))}
          {/* Persistent pause/stop control (WCAG 2.2.2) — hidden under reduced
              motion, where there is no auto-advance to stop. */}
          {/* No onFocus pause here (unlike the step buttons): after clicking
              Resume the toggle keeps focus, and a focus-pause would silently
              override the user's explicit resume. The toggle's own state IS
              the pause mechanism. */}
          {!reduced && (
            <button
              type="button"
              onClick={() => setStopped((s) => !s)}
              aria-pressed={stopped}
              aria-label={stopped ? "Resume the step animation" : "Pause the step animation"}
              className="shrink-0 w-6 h-6 rounded-full bg-white/[0.08] hover:bg-white/[0.16] flex items-center justify-center text-text-secondary transition-colors duration-300"
            >
              {stopped ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
