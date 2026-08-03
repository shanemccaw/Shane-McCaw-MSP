/**
 * RevealPillarScene.tsx — Scenes 2 through 7.
 *
 * ONE component rendered six times. Structurally identical every time, because
 * sameness is the feature: by the third pillar the reader knows exactly where
 * the headline, the score and the fix will be, and can spend their attention on
 * the numbers instead of re-learning a layout.
 *
 * Five blocks reveal through the section's own 280vh span at the windows in
 * `PILLAR_BLOCK_WINDOWS`. The score's count-up carries the weighted landing —
 * `pillarCount()` gives a critical pillar a small overshoot and lets an
 * attention-required one glide, so the motion reflects the data rather than
 * repeating identically six times.
 */

import type { JourneyPillarView } from "./journeyModel.ts";
import {
  INK,
  PILLARS,
  SEVERITY_LABEL,
  TABULAR,
  severityColor,
  severityForScore,
  type PillarKey,
} from "./journeyTokens.ts";
import {
  PILLAR_BLOCK_WINDOWS,
  blockReveal,
  clampWindow,
  easeOutCubic,
  pillarCount,
} from "./revealMath.ts";
import {
  JourneyUnavailable,
  PillarEyebrow,
  PillarSparkline,
  ScoreDelta,
} from "./JourneyPrimitives";

/**
 * The per-pillar editorial copy. Final, in Shane's voice, and the same for every
 * tenant — these are claims about how Copilot behaves, not facts about a tenant,
 * so they belong in code the way `verdictSentence()` and `generationView()`'s
 * note already do.
 *
 * `tenantBound` is the exception and it is deliberate. Two of the design's lines
 * name specifics of the prototype's stand-in tenant — the proportion of dormant
 * users, and the two departments its enablement would start with. On a live
 * render those would be assertions about a tenant nobody checked, so they are
 * withheld outside the labelled design preview. Resolving this needs an
 * editorial pass (a tenant-independent phrasing) or a per-pillar narrative on
 * the wire; it is NOT something to quietly ship as written.
 *
 * A third line — Licensing's `fix` — used to read "Reclaim the dormant seats and
 * fund the E5 uplift out of the waste." It was neither: it named a Microsoft SKU
 * tier in a `.tsx` (the platform's no-hardcoding rule) and asserted this tenant
 * had dormant seats and needed that uplift. It was re-worded rather than made
 * `tenantBound`, because losing a third block would start to unpick the sameness
 * that makes six identical scenes readable. The rule for anything written here:
 * a sentence must be true of every tenant that could ever see this screen, or it
 * belongs in `tenantBound` and on the wire.
 */
interface PillarNarrative {
  /** "Why it matters to Copilot" — the risk sentence under the headline. */
  readonly why: string;
  /** "What fixing it does" — the remediation line beside the delta. */
  readonly fix: string;
  readonly tenantBound: readonly ("why" | "fix")[];
}

const PILLAR_NARRATIVE: Readonly<Record<PillarKey, PillarNarrative>> = {
  governance: {
    why: "Copilot inherits every permission you have ever granted. Oversharing stops being a filing problem the day it becomes an answer Copilot gives to the wrong person.",
    fix: "Revoke org-wide sharing links and put a lifecycle policy on every site.",
    tenantBound: [],
  },
  security: {
    why: "Every identity gap is a Copilot access gap. A compromised account no longer just reads mail — it queries the whole tenant in plain language.",
    fix: "Enforce Conditional Access on privileged roles and switch off legacy auth.",
    tenantBound: [],
  },
  compliance: {
    why: "Unlabelled data is data Copilot will summarise, quote and export without restriction. Labels are the only instruction it obeys.",
    fix: "Publish a baseline label set and extend DLP to Teams and OneDrive.",
    tenantBound: [],
  },
  licensing: {
    why: "Copilot sits on top of your base SKUs. Until those are right, the rollout stalls in procurement, not in technology.",
    // No SKU tier named, and nothing here claims this tenant has waste to
    // recover — "whatever a seat audit recovers" is honest at zero.
    fix: "Right-size the base licences these controls depend on, and fund it from whatever a seat audit recovers.",
    tenantBound: [],
  },
  adoption: {
    why: "Copilot returns value only where the work already happens. A third of your tenant is not there yet, and licences for them return nothing.",
    fix: "Run targeted enablement in Operations and Field Services first.",
    // "A third of your tenant" and the two named departments are the design
    // tenant's, not every tenant's.
    tenantBound: ["why", "fix"],
  },
  health: {
    why: "Unmanaged drift undoes remediation inside two quarters. The score you earn is only ever the score you keep.",
    fix: "Put hourly drift telemetry on the tenant so nothing changes unseen.",
    tenantBound: [],
  },
};

/** Below this the two columns cannot both hold their measures — stack them. */
export const PILLAR_WIDE_MIN_PX = 940;

const HEADLINE_SIZE = "clamp(30px,min(4.4vw,6.6vh),60px)";
const BODY_SIZE = "clamp(15px,min(1.5vw,2.5vh),19px)";
const SCORE_SIZE = "clamp(62px,min(9vw,14vh),124px)";

/**
 * How much of this pillar's payload is actually known.
 *
 * Three states, not two, and the distinction is the whole point: "the scan
 * returned nothing quotable here" is a claim about a scan result, and it is only
 * honest once that result has arrived. Before then the screen knows nothing, and
 * a failed fetch is a third thing again — something to say plainly and offer a
 * retry for, never to dress up as a clean pillar.
 */
export type PillarPayloadState = "loading" | "error" | "ready";

/**
 * The quiet neutral placeholder. Deliberately asserts nothing — no severity, no
 * em dash that could read as "nothing found", no count. It says only that the
 * screen is still waiting, which is the one thing that is true.
 */
function PillarPending({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "26px 0" }}>
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: INK.deemphasised,
          flex: "none",
          animation: "cj-pulse-dot 1100ms ease-in-out infinite",
        }}
      />
      <span style={{ fontSize: 15, fontWeight: 500, color: INK.micro }}>{label}</span>
    </div>
  );
}

export function RevealPillarScene({
  sceneIndex,
  pillar,
  projected,
  marginNote,
  progress,
  wide,
  reduced,
  showTenantBoundCopy,
  payloadState,
  retryAction,
}: {
  /** The `data-cj-scene` value — 2 through 7. */
  sceneIndex: number;
  pillar: JourneyPillarView;
  /** Post-remediation score from the SOW, or null when no scope quotes one. */
  projected: number | null;
  /**
   * The single hand-written annotation in the whole experience. The page passes
   * it for Security alone; a second instance anywhere tips it into gimmick.
   */
  marginNote: string | null;
  progress: number;
  wide: boolean;
  reduced: boolean;
  /** True only on the labelled design preview — see `PILLAR_NARRATIVE`. */
  showTenantBoundCopy: boolean;
  /**
   * Whether the pillar payload has landed at all. Nothing in the two
   * data-dependent slots may assert a scan result until this is `"ready"`.
   */
  payloadState: PillarPayloadState;
  /** The retry control offered on `"error"`. Built once by the page. */
  retryAction: React.ReactNode;
}) {
  const identity = PILLARS[pillar.key];
  const narrative = PILLAR_NARRATIVE[pillar.key];

  const badge = blockReveal(progress, ...PILLAR_BLOCK_WINDOWS.badge, reduced);
  const headline = blockReveal(progress, ...PILLAR_BLOCK_WINDOWS.headline, reduced);
  const why = blockReveal(progress, ...PILLAR_BLOCK_WINDOWS.why, reduced);
  const scoreBlock = blockReveal(progress, ...PILLAR_BLOCK_WINDOWS.score, reduced);
  const fix = blockReveal(progress, ...PILLAR_BLOCK_WINDOWS.fix, reduced);

  const showWhy = narrative.tenantBound.includes("why") ? showTenantBoundCopy : true;
  const showFix = narrative.tenantBound.includes("fix") ? showTenantBoundCopy : true;

  const tone = pillar.score === null ? INK.deemphasised : severityColor(pillar.score);
  const counted = pillar.score === null ? null : pillarCount(pillar.score, progress, reduced);

  return (
    <section data-cj-scene={sceneIndex} style={{ position: "relative", height: "280vh" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          alignItems: "center",
          // The left inset clears the progress rail at every width.
          padding: "0 7vw 0 clamp(58px,11vw,150px)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1280,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: wide ? "minmax(0,1.35fr) minmax(280px,.65fr)" : "minmax(0,1fr)",
            gap: "min(5vh,40px) min(9vw,120px)",
            alignItems: "center",
          }}
        >
          {/* Left column — the argument. */}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "min(4vh,34px)",
            }}
          >
            <PillarEyebrow
              pillar={pillar.key}
              style={{ opacity: badge.o, transform: `translateY(${badge.y}px)` }}
            />

            {pillar.headline ? (
              <h2
                style={{
                  margin: 0,
                  fontSize: HEADLINE_SIZE,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.06,
                  color: INK.headingDark,
                  textWrap: "pretty",
                  opacity: headline.o,
                  transform: `translateY(${headline.y}px)`,
                }}
              >
                {pillar.headline}
              </h2>
            ) : (
              <div style={{ opacity: headline.o, transform: `translateY(${headline.y}px)` }}>
                {payloadState === "loading" ? (
                  /* Nothing is known yet, so nothing is claimed yet. */
                  <PillarPending label={`Reading your ${identity.label.toLowerCase()} findings…`} />
                ) : payloadState === "error" ? (
                  <JourneyUnavailable
                    eyebrow="Could not be loaded"
                    title="Your scan results did not load"
                    detail="The request for this tenant's findings failed, so this scene is showing nothing rather than describing a scan it never received."
                    action={retryAction}
                  />
                ) : (
                  /* Only honest once the payload has actually arrived. */
                  <JourneyUnavailable
                    title={`No ${identity.label.toLowerCase()} finding was recorded`}
                    detail="The last scan returned nothing quotable in this area. That is not the same as a clean result — a check that could not run leaves no finding either."
                  />
                )}
              </div>
            )}

            {showWhy ? (
              <p
                style={{
                  margin: 0,
                  maxWidth: 640,
                  fontSize: BODY_SIZE,
                  fontWeight: 500,
                  lineHeight: 1.55,
                  color: INK.bodyDark,
                  textWrap: "pretty",
                  opacity: why.o,
                  transform: `translateY(${why.y}px)`,
                }}
              >
                {narrative.why}
              </p>
            ) : null}

            {/* The one margin note. Georgia italic, off-axis, beside the finding
                it judges — a person's handwriting in the margin of a report. */}
            {marginNote ? (
              <p
                style={{
                  margin: 0,
                  maxWidth: 520,
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 17,
                  lineHeight: 1.45,
                  color: INK.link,
                  transform: "rotate(-1.1deg)",
                  opacity: fix.o,
                }}
              >
                {marginNote}
              </p>
            ) : null}
          </div>

          {/* Right column — the number. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 26,
              position: "relative",
              opacity: scoreBlock.o,
              transform: `translateY(${scoreBlock.y}px)`,
            }}
          >
            {/* Identity-coloured glow behind the score alone — not a per-pillar
                background wash, which would fight the severity colour on the
                number it sits under. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "22%",
                top: "34%",
                width: 440,
                height: 440,
                transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                background: `radial-gradient(circle, ${identity.primary}1f, rgba(2,6,23,0) 66%)`,
                pointerEvents: "none",
              }}
            />

            <div
              style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 4 }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: INK.micro,
                }}
              >
                Pillar score
              </span>

              {counted === null || pillar.score === null ? (
                /* Never a red 0: an unscored pillar is unknown, not failing —
                   and before the payload lands it is not even that. The retry
                   lives in the left column alone; one per scene, not two. */
                payloadState === "loading" ? (
                  <PillarPending label="Reading this pillar's score…" />
                ) : payloadState === "error" ? (
                  <JourneyUnavailable
                    eyebrow="Could not be loaded"
                    title="No score to show"
                    detail="This tenant's pillar scores did not load, so none is being shown. It is not a zero and it is not a pass."
                  />
                ) : (
                  <JourneyUnavailable
                    title="Not scored on this run"
                    detail="No evaluable rule fed this pillar, so there is nothing to score. It appears here the moment a check in this area returns a result."
                  />
                )
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span
                      style={{
                        fontSize: SCORE_SIZE,
                        fontWeight: 800,
                        letterSpacing: "-0.05em",
                        lineHeight: 1,
                        color: tone,
                        ...TABULAR,
                      }}
                    >
                      {counted}
                    </span>
                    <span style={{ fontSize: 20, fontWeight: 600, color: INK.deemphasised }}>
                      /100
                    </span>
                  </div>

                  {/* Renders nothing where no real series exists, which is every
                      pillar today. Do not feed it a synthesised shape. */}
                  <PillarSparkline
                    pillar={pillar.key}
                    series={pillar.trend?.series}
                    window={pillar.trend?.window ?? ""}
                    opacity={easeOutCubic(clampWindow(progress, 0.44, 0.62))}
                  />

                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: tone,
                    }}
                  >
                    {SEVERITY_LABEL[severityForScore(pillar.score)]}
                  </span>
                </>
              )}
            </div>

            <div
              style={{
                borderTop: `1px solid ${INK.hairlineDark}`,
                paddingTop: 22,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                opacity: fix.o,
                transform: `translateY(${fix.y}px)`,
              }}
            >
              {/* Non-interactive in v1 — scrubbing back to toggle a remediation
                  is deliberately excluded so it does not fight the linear hook. */}
              {pillar.score !== null && projected !== null ? (
                <ScoreDelta from={pillar.score} to={projected} />
              ) : null}
              {showFix ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    lineHeight: 1.5,
                    color: INK.bodyDark,
                  }}
                >
                  {narrative.fix}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
