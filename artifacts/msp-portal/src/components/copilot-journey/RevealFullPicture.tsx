/**
 * RevealFullPicture.tsx — Scene 9. The close.
 *
 * Six findings resolving into one number, then the document set and the two
 * actions that carry the customer onward. The tracer lines are the single moment
 * that visually proves the premise: as each satellite lands, a thin light draws
 * inward from it to the centre figure.
 *
 * Scores belong HERE, on the satellites — Scene 1's satellites carry findings.
 * The two scenes exist to say different things and collapsing them makes the
 * hook a duplicate of its own payoff.
 *
 * WHY THE ROW IS MEASURED
 * -----------------------
 * At >=1180px the row is `flex-wrap: nowrap` so the orb sits LEFT of the text
 * column; below that it stacks. Either way the whole composition has to fit
 * inside one 100vh sticky viewport, so the row's real height is measured and the
 * outer stage is scaled to `(innerHeight - 48) / rowHeight`. Anything added to
 * the right column therefore shrinks the entire composition — keep it short.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

import type { JourneyView } from "./journeyModel.ts";
import { gapSentence, isGenerationUnknown, scoredPillarCount } from "./journeyModel.ts";
import {
  BRAND,
  COPILOT_ORB_CONIC,
  DELTA_GRADIENT,
  INK,
  RADIUS,
  TABULAR,
  severityColor,
} from "./journeyTokens.ts";
import {
  clampWindow,
  easeOutCubic,
  fullPictureStageScale,
  generationView,
} from "./revealMath.ts";
import { JourneyUnavailable, PillarGlyph } from "./JourneyPrimitives";

/**
 * The catalogue key of the report this card leads with.
 *
 * `document_types` seeds `executive_summary` → "Executive Summary" (see
 * `lib/db/migrations/manual/2026-07-20-document-types.sql`), and the assessment
 * document workflow's default set names the same key customer-visible. Matching
 * on the KEY rather than trusting sort order is the whole point: `documents[0]`
 * is just whatever the expected set happens to list first, and the blurb and CTA
 * below describe one specific report.
 */
const EXECUTIVE_SUMMARY_DOC_TYPE = "executive_summary";

/**
 * Whether this tenant's document set is known at all — see `payloadState` on the
 * props. `generationView().known` says whether there is a set to count; this
 * says why there isn't one.
 */
export type GenerationPayloadState = "loading" | "error" | "ready";

/** The quiet neutral placeholder, matching the pillar scenes'. Asserts nothing. */
function GenerationPending({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "18px 0" }}>
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
      <span style={{ fontSize: 14, fontWeight: 500, color: INK.micro }}>{label}</span>
    </div>
  );
}

/** The wide composition's own box, and the anchor the ring hangs from. */
const STAGE_W = 600;
const STAGE_H = 640;
const CENTRE_X = 300;
const CENTRE_Y = 320;
/** Satellites sit closer in than Scene 1's — these labels are short. */
const SATELLITE_R = 240;
const LABEL_W = 172;
const LABEL_H = 50;
const TRACER_H = 172;
const ORB_PX = 300;

/** Below this the orb cannot sit beside the text column — the row wraps. */
export const FULL_PICTURE_WIDE_MIN_PX = 1180;

/** Headroom the fit-to-viewport scale leaves around the row. */
const ROW_FIT_MARGIN_PX = 48;

function OrbMark({ opacity, reduced }: { opacity: number; reduced: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: ORB_PX,
        height: ORB_PX,
        transform: "translate(-50%,-50%)",
        borderRadius: "50%",
        pointerEvents: "none",
        transition: "opacity 500ms",
        opacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: COPILOT_ORB_CONIC,
          WebkitMaskImage:
            "radial-gradient(circle, transparent 63%, #000 68%, #000 73%, transparent 78%)",
          maskImage:
            "radial-gradient(circle, transparent 63%, #000 68%, #000 73%, transparent 78%)",
          animation: reduced ? "none" : "cj-orb-spin 26s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,.15), rgba(139,92,246,.09) 46%, rgba(2,6,23,0) 72%)",
        }}
      />
    </div>
  );
}

export function RevealFullPicture({
  view,
  progress,
  vw,
  vh,
  reduced,
  discussHref,
  onOpenDocuments,
  payloadState,
  retryAction,
}: {
  view: JourneyView;
  progress: number;
  vw: number;
  vh: number;
  reduced: boolean;
  /** Where "Discuss my results with Shane McCaw" goes. Bare path — the tenant
   *  slug is applied by the router's base. */
  discussHref: string;
  /** Opens the Document Viewer. Named for what it does — the lead document is
   *  whatever this tenant's set actually leads with, not always the summary. */
  onOpenDocuments: () => void;
  /**
   * Whether the assessment status payload has landed. A counter, a progress bar
   * and a promise of a notification are claims about a generation run; none of
   * them may render until this is `"ready"` AND `generationView().known`.
   */
  payloadState: GenerationPayloadState;
  /** The retry control offered on `"error"`. Built once by the page. */
  retryAction: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowFit, setRowFit] = useState(1);

  // The row is measured rather than assumed: its height depends on the tenant's
  // own headline length and on how many document titles wrap.
  //
  // A ResizeObserver rather than a scroll listener — the row's height cannot
  // change with scroll position, and the page already owns the single
  // scroll/resize pair that drives every scene's progress. The window listener
  // is still needed because `innerHeight` can change without the row resizing.
  useEffect(() => {
    const fit = () => {
      const el = rowRef.current;
      if (!el) return;
      const h = el.offsetHeight;
      if (!h) return;
      const next = Math.min(1, (window.innerHeight - ROW_FIT_MARGIN_PX) / h);
      setRowFit((prev) => (Math.abs(next - prev) > 0.006 ? next : prev));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (rowRef.current) observer.observe(rowRef.current);
    window.addEventListener("resize", fit, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  const wide = vw >= FULL_PICTURE_WIDE_MIN_PX;
  const stageScale = Math.min(fullPictureStageScale(vw, vh), rowFit);

  const tracer = reduced ? 1 : easeOutCubic(clampWindow(progress, 0.06, 0.28));
  // Peaks then fades — the tracers are a moment, not a permanent diagram.
  const tracerOpacity = Math.min(
    clampWindow(progress, 0.05, 0.12),
    1 - clampWindow(progress, 0.3, 0.44),
  );
  const ringOpacity = easeOutCubic(clampWindow(progress, 0.04, 0.34));
  const orbOpacity = easeOutCubic(clampWindow(progress, 0.02, 0.26));
  const projectedOpacity = easeOutCubic(clampWindow(progress, 0.3, 0.46));
  const textOpacity = easeOutCubic(clampWindow(progress, 0.1, 0.3));
  const textY = reduced ? 0 : (1 - textOpacity) * 26;
  const docsOpacity = easeOutCubic(clampWindow(progress, 0.34, 0.54));
  const docsY = reduced ? 0 : (1 - docsOpacity) * 22;

  const gen = generationView(view.generation.ready, view.generation.total);
  const documents = view.generation.documents;
  // Lead on the Executive Summary by KEY. A tenant whose expected set does not
  // include it still gets a lead card — just a title-only one, with none of the
  // copy that describes that specific report.
  const leadIndex = documents.findIndex((d) => d.docType === EXECUTIVE_SUMMARY_DOC_TYPE);
  const resolvedLeadIndex = leadIndex >= 0 ? leadIndex : 0;
  const lead = documents[resolvedLeadIndex] ?? null;
  const leadIsExecutiveSummary = lead?.docType === EXECUTIVE_SUMMARY_DOC_TYPE;
  const rest = documents.filter((_, i) => i !== resolvedLeadIndex);

  const closing = gapSentence(
    view.tenant.name,
    view.readinessScore,
    view.remediatedScore,
    scoredPillarCount(view.pillars),
  );
  const scoreTone =
    view.readinessScore === null ? INK.deemphasised : severityColor(view.readinessScore);

  return (
    <section data-cj-scene="9" style={{ position: "relative", height: "340vh" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6vw 0 clamp(52px,8vw,120px)",
          boxSizing: "border-box",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            width: 1200,
            height: 1200,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,180,216,.12), rgba(2,6,23,0) 62%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 1300,
            transform: `scale(${stageScale})`,
          }}
        >
          <div
            ref={rowRef}
            style={{
              width: "100%",
              display: "flex",
              flexWrap: wide ? "nowrap" : "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "min(5vh,40px) min(6vw,80px)",
            }}
          >
            {wide ? (
              <div style={{ position: "relative", width: STAGE_W, height: STAGE_H, flex: "none" }}>
                <div
                  style={{ position: "absolute", left: CENTRE_X, top: CENTRE_Y, width: 1, height: 1 }}
                >
                  {/* Tracers. Zero-width lines pinned at the centre by
                      `transform-origin: top center`, grown outward with scaleY.
                      Rotated 180° so "down" points at the 12 o'clock satellite. */}
                  {view.pillars.map((pillar, i) => (
                    <div
                      key={`tracer-${pillar.key}`}
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 1,
                        height: TRACER_H,
                        transformOrigin: "top center",
                        transform: `rotate(${180 + 60 * i}deg) scaleY(${tracer})`,
                        background: `linear-gradient(to bottom,${pillar.primary}00,${pillar.primary}8c)`,
                        opacity: tracerOpacity,
                      }}
                    />
                  ))}

                  <div style={{ position: "absolute", width: 1, height: 1, opacity: ringOpacity }}>
                    {view.pillars.map((pillar, i) => {
                      const angle = i * 60;
                      return (
                        <div
                          key={pillar.key}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: 0,
                            height: 0,
                            transformOrigin: "0 0",
                            transform: `rotate(${angle}deg) translate(0,-${SATELLITE_R}px)`,
                          }}
                        >
                          <div
                            style={{
                              width: LABEL_W,
                              marginLeft: -LABEL_W / 2,
                              height: LABEL_H,
                              marginTop: -LABEL_H / 2,
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                              whiteSpace: "nowrap",
                              textAlign: "center",
                              // No ring rotation here, so the counter-rotation is
                              // the arm angle alone.
                              transform: `rotate(${-angle}deg)`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 9,
                                fontWeight: 600,
                                letterSpacing: ".2em",
                                textTransform: "uppercase",
                                color: pillar.primary,
                                marginBottom: 5,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                              }}
                            >
                              <PillarGlyph pillar={pillar.key} size={12} color="currentColor" />
                              <span>{pillar.label}</span>
                            </div>
                            <div
                              style={{
                                fontSize: 22,
                                fontWeight: 800,
                                color:
                                  pillar.score === null
                                    ? INK.deemphasised
                                    : severityColor(pillar.score),
                                ...TABULAR,
                              }}
                            >
                              {pillar.score ?? "—"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <OrbMark opacity={orbOpacity} reduced={reduced} />

                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      transform: "translate(-50%,-50%)",
                      width: 400,
                      zIndex: 2,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      textAlign: "center",
                    }}
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
                      Copilot readiness
                    </span>
                    <div
                      style={{
                        fontSize: 150,
                        fontWeight: 800,
                        letterSpacing: "-0.05em",
                        lineHeight: 0.95,
                        color: scoreTone,
                        ...TABULAR,
                      }}
                    >
                      {view.readinessScore ?? "—"}
                    </div>
                    {view.remediatedScore === null ? null : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 9,
                          opacity: projectedOpacity,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: ".14em",
                            textTransform: "uppercase",
                            color: INK.micro,
                          }}
                        >
                          Remediated
                        </span>
                        <span
                          style={{
                            fontSize: 30,
                            fontWeight: 800,
                            background: DELTA_GRADIENT,
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            color: "transparent",
                            ...TABULAR,
                          }}
                        >
                          {view.remediatedScore}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Below 1180px the ring has nowhere to sit beside the text, so the
                 same six scores become a two-column list. */
              <div
                style={{
                  flex: "1 1 300px",
                  minWidth: 0,
                  maxWidth: 520,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: ".2em",
                        textTransform: "uppercase",
                        color: INK.micro,
                      }}
                    >
                      Copilot readiness
                    </span>
                    <span
                      style={{
                        fontSize: "clamp(72px,20vw,110px)",
                        fontWeight: 800,
                        letterSpacing: "-0.05em",
                        lineHeight: 0.95,
                        color: scoreTone,
                        ...TABULAR,
                      }}
                    >
                      {view.readinessScore ?? "—"}
                    </span>
                  </div>
                  {view.remediatedScore === null ? null : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        paddingBottom: 12,
                        transition: "opacity 500ms",
                        opacity: projectedOpacity,
                      }}
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
                        Remediated
                      </span>
                      <span
                        style={{
                          fontSize: 32,
                          fontWeight: 800,
                          background: DELTA_GRADIENT,
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          color: "transparent",
                          ...TABULAR,
                        }}
                      >
                        {view.remediatedScore}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: "9px 18px",
                    transition: "opacity 500ms",
                    opacity: ringOpacity,
                  }}
                >
                  {view.pillars.map((pillar) => (
                    <div
                      key={pillar.key}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 10,
                        borderTop: `1px solid ${INK.hairlineDark}`,
                        paddingTop: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: ".18em",
                          textTransform: "uppercase",
                          color: pillar.primary,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <PillarGlyph pillar={pillar.key} size={12} color="currentColor" />
                        <span>{pillar.label}</span>
                      </span>
                      <span
                        style={{
                          fontSize: 19,
                          fontWeight: 800,
                          color:
                            pillar.score === null ? INK.deemphasised : severityColor(pillar.score),
                          ...TABULAR,
                        }}
                      >
                        {pillar.score ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                flex: "1 1 440px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "min(3.4vh,28px)",
                opacity: textOpacity,
                transform: `translateY(${textY}px)`,
              }}
            >
              {closing ? (
                <h2
                  style={{
                    margin: 0,
                    fontSize: "clamp(24px,min(3vw,4.6vh),40px)",
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                    color: INK.headingDark,
                    textWrap: "pretty",
                  }}
                >
                  {closing}
                </h2>
              ) : null}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  opacity: docsOpacity,
                  transform: `translateY(${docsY}px)`,
                }}
              >
                {/* Everything from the eyebrow to the progress bar is a claim
                    about a generation run: how many documents there are, how
                    many are done, and that an alert will follow. None of it may
                    render until the platform has told us this tenant's set —
                    `gen.known` is false on a failed status fetch and on any
                    tenant with no assessment service, and "0 of 0 ready" under a
                    progress bar asserts a run that is not happening.
                    Exception: the roll-up readiness report (#409, #416, #419).
                    It renders live from the tenant's own scan data, not the old
                    generation pipeline, so a resolved `lead` on that pattern is
                    real regardless of what `gen.known` says — see
                    `isGenerationUnknown`. */}
                {!isGenerationUnknown(lead, gen) && lead ? (
                  <>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: ".22em",
                        textTransform: "uppercase",
                        color: INK.micro,
                      }}
                    >
                      {gen.eyebrow}
                    </span>

                    {/* The lead document. Generation is shown IN PROGRESS — the
                        reveal fires on scan completion and the reports are still
                        being written behind it. The same view becomes document
                        access when the set finishes. */}
                    <div
                      style={{
                        border: "1px solid rgba(0,120,212,.4)",
                        borderRadius: RADIUS.panel,
                        background: "linear-gradient(135deg,rgba(0,120,212,.12),rgba(15,23,42,.6))",
                        padding: "20px 22px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 15,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "space-between",
                          gap: 20,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: 18,
                              fontWeight: 700,
                              letterSpacing: "-0.01em",
                              color: INK.headingDark,
                            }}
                          >
                            {lead.title}
                          </span>
                          {/* Described only where the description is true. The
                              sections named are the Executive Summary's own, from
                              the seeded `insights-report-executive_summary` prompt —
                              and no page count, because nothing measures one. */}
                          {leadIsExecutiveSummary ? (
                            <span style={{ fontSize: 13, fontWeight: 500, color: INK.bodyDark }}>
                              The scores, the findings behind them, and the recommended next steps.
                            </span>
                          ) : null}
                        </div>
                        {gen.done ? (
                          <Button
                            size="lg"
                            onClick={onOpenDocuments}
                            // Pinned to the brand palette: this screen is theme-fixed
                            // dark and must not follow the portal's light/dark toggle.
                            style={{
                              background: BRAND.blue,
                              borderColor: BRAND.blue,
                              color: BRAND.white,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {leadIsExecutiveSummary ? "Open Executive Summary" : "Open your documents"}
                          </Button>
                        ) : (
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              letterSpacing: ".04em",
                              color: BRAND.teal,
                              whiteSpace: "nowrap",
                              ...TABULAR,
                            }}
                          >
                            {gen.status}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          height: 3,
                          background: INK.hairlineDark,
                          borderRadius: RADIUS.pill,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: RADIUS.pill,
                            background: DELTA_GRADIENT,
                            transition: "width 500ms ease",
                            width: gen.pct,
                          }}
                        />
                      </div>
                    </div>

                    {/* Fixed two columns, never auto-fit: the set is fixed for the
                        length of this render, and a grid that reflows makes it look
                        as though the deliverable changed size. */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                        gap: "8px 22px",
                      }}
                    >
                      {rest.map((doc) => {
                        const ready = doc.status === "ready";
                        return (
                          <div
                            key={doc.docType}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              borderTop: `1px solid ${INK.hairlineDark}`,
                              paddingTop: 9,
                              transition: "opacity 400ms ease",
                              opacity: ready ? 1 : 0.4,
                            }}
                          >
                            <span
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                flex: "none",
                                transition: "background 400ms",
                                background: ready ? BRAND.teal : "rgba(51,65,85,.9)",
                              }}
                            />
                            <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
                              {doc.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : payloadState === "loading" ? (
                  <GenerationPending label="Loading your document set…" />
                ) : payloadState === "error" ? (
                  <JourneyUnavailable
                    eyebrow="Could not be loaded"
                    title="Your document set did not load"
                    detail="The request for this tenant's assessment status failed, so nothing is being counted here. Your findings above are unaffected."
                    action={retryAction}
                  />
                ) : (
                  <JourneyUnavailable
                    title="No document set is scoped for this tenant yet"
                    detail="Which reports get written is set by the assessment service on your account. Until that scope exists there is no set to count, and a number here would be one nobody had measured."
                  />
                )}

                {/* Outside the gate: neither line depends on the document set. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
                  <Link
                    href={discussHref}
                    style={{ fontSize: 13, fontWeight: 600, color: INK.link }}
                  >
                    Discuss my results with Shane McCaw →
                  </Link>
                  <span style={{ fontSize: 12, fontWeight: 500, color: INK.deemphasised }}>
                    30 minutes, direct with the architect.
                  </span>
                </div>

                {/* "We will notify you the moment the set is ready" is a promise
                    about a run that only exists once `known` is true. Same
                    readiness-report exception as the gate above — see
                    `isGenerationUnknown`. */}
                {!isGenerationUnknown(lead, gen) ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      fontWeight: 500,
                      lineHeight: 1.55,
                      color: INK.bodyDark,
                      maxWidth: 560,
                    }}
                  >
                    {gen.note}
                  </p>
                ) : null}
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.55,
                    color: INK.micro,
                    maxWidth: 560,
                  }}
                >
                  Assessed by Shane McCaw against the M365 governance framework he wrote at NASA and
                  distributed agency-wide. Thirty years in the Microsoft ecosystem.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
