/**
 * DocumentBody.tsx — the dark reading card at the centre of the Document
 * Viewer, in every state it can honestly be in.
 *
 * Four states, and no fifth:
 *   • loading   — the generation payload has not arrived, so nothing is claimed.
 *   • ready     — the platform's own generated HTML for this report.
 *   • generating— spinner, "N of N ready", and the note that they can close the
 *                 page. Never a blank or broken page.
 *   • error     — we say so, with a retry. Never a silent empty card.
 *
 * The counter is only drawn where `generationView().known` is true. A tenant
 * whose document set the platform has not described yet gets an unavailable
 * state, not "0 of 0 ready" under a progress bar — that would assert a
 * generation run nobody has started.
 *
 * Under `?preview=design` the three report bodies the design writes out in full
 * render instead, from `previewDocumentBodies.ts`. That path is unreachable on a
 * live journey — the flag also paints a persistent `<PreviewBadge />`.
 *
 * The screen deliberately carries none of the Reveal's motion language: no
 * parallax, no scroll-pinning, no count-ups. The only animation in this file is
 * the generation spinner, and reduced motion silences it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

import {
  BRAND,
  INK,
  PILLARS,
  RADIUS,
  SEVERITY_LABEL,
  SEVERITY_ON_DARK,
  TABULAR,
  severityColor,
  severityForScore,
} from "./journeyTokens.ts";
import type { JourneyDocumentView, JourneyGeneration, JourneyTenant } from "./journeyModel.ts";
import { verdictLabel } from "./journeyModel.ts";
import { generationView } from "./revealMath.ts";
import { JourneyUnavailable, PillarSwatch } from "./JourneyPrimitives";
import {
  PREVIEW_DOCUMENT_BODIES,
  PREVIEW_MATERIAL_FINDINGS,
  type PreviewExecutiveReport,
  type PreviewPillarReport,
  type ReportSection,
} from "./previewDocumentBodies.ts";
import {
  PREVIEW_PILLARS,
  PREVIEW_READINESS_SCORE,
  PREVIEW_REMEDIATED_SCORE,
  PREVIEW_SIGNAL_COUNT,
  PREVIEW_TENANT,
} from "./journeyPreviewFixture.ts";

const DOCUMENT_URL = "/api/portal/assessment/documents";
const JOURNEY_CHANNEL = "engine.dashboard";

/* ------------------------------------------------------------------ *
 * Shared dark-surface type
 * ------------------------------------------------------------------ */

const H2 = {
  margin: 0,
  fontSize: 19,
  fontWeight: 700,
  letterSpacing: "-0.015em",
  color: INK.headingDark,
} as const;

const BODY = {
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: INK.bodyDark,
  maxWidth: "66ch",
  textWrap: "pretty",
} as const;

const EYEBROW = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".22em",
  textTransform: "uppercase",
} as const;

/** Outline buttons on this dark card — the input-field dark this journey already uses (SOW Proposal's own fields). */
const DARK_OUTLINE_BUTTON = {
  background: "rgba(2,6,23,.7)",
  borderColor: "rgba(51,65,85,.9)",
  color: INK.headingDark,
} as const;

/** The reading card. Every state renders inside it, so the page never reflows. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        background: "rgba(15,23,42,.55)",
        border: `1px solid ${INK.hairlineDark}`,
        borderRadius: RADIUS.card,
        padding: "clamp(28px,4vw,58px)",
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Generating / loading
 * ------------------------------------------------------------------ */

function Spinner({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 46,
        height: 46,
        borderRadius: "50%",
        border: `2px solid ${INK.hairlineDark}`,
        borderTopColor: BRAND.blue,
        animation: reduceMotion ? "none" : "cj-spin 900ms linear infinite",
      }}
    />
  );
}

function CentredState({
  reduceMotion,
  title,
  detail,
  progress,
  footnote,
}: {
  reduceMotion: boolean;
  title: string;
  detail: string;
  /** `null` suppresses the bar entirely — used before any counter is honest. */
  progress: string | null;
  footnote?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: "48px 0 56px",
        textAlign: "center",
      }}
    >
      <Spinner reduceMotion={reduceMotion} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em", color: INK.headingDark }}>
          {title}
        </span>
        <p
          style={{
            margin: 0,
            fontSize: 14.5,
            fontWeight: 500,
            lineHeight: 1.6,
            color: INK.micro,
            maxWidth: "46ch",
            textWrap: "pretty",
          }}
        >
          {detail}
        </p>
      </div>
      {progress === null ? null : (
        <div
          style={{
            width: "min(340px,80%)",
            height: 3,
            background: INK.hairlineDark,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg,${BRAND.blue},${BRAND.teal})`,
              transition: "width 500ms ease",
              width: progress,
            }}
          />
        </div>
      )}
      {footnote ? (
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: INK.micro, maxWidth: "44ch" }}>
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Preview bodies — reachable only behind `?preview=design`
 * ------------------------------------------------------------------ */

/**
 * The colour language, in one place: the pillar's identity colour says *what a
 * finding is* (swatch, eyebrow); the severity colour says *how bad it is*
 * (score numbers, the verdict tag, a finding's tag AND its left border). A
 * Compliance score of 29 is red and a Compliance score of 90 is green —
 * Compliance's own `#F3F4F6` plays no part in that. The finding border used to
 * carry the pillar's identity colour instead; the design's own rewrite moved it
 * to severity (matching the tag directly above it), so a critical row reads red
 * top to bottom rather than pillar-tinted.
 */
function SeverityTag({ severity, style }: { severity: keyof typeof SEVERITY_ON_DARK; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: SEVERITY_ON_DARK[severity],
        ...style,
      }}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** One `heading` + body, in whichever shape the section's own `kind` calls for. */
function ReportSectionBlock({ section }: { section: ReportSection }) {
  const heading = (
    <h2 style={{ ...H2, fontSize: 18, letterSpacing: "normal" }}>{section.heading}</h2>
  );

  if (section.kind === "prose") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {heading}
        {section.paragraphs.map((p) => (
          <p key={p.slice(0, 32)} data-ask style={BODY}>
            {p}
          </p>
        ))}
      </div>
    );
  }

  if (section.kind === "findings") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {heading}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {section.rows.map((f) => (
            <div
              key={f.lead}
              data-ask
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                borderLeft: `2px solid ${SEVERITY_ON_DARK[f.severity]}`,
                padding: "2px 0 2px 14px",
              }}
            >
              <SeverityTag severity={f.severity} />
              <p style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6 }}>
                <span style={{ fontWeight: 700, color: INK.headingDark }}>{f.lead}</span> {f.rest}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.kind === "sequence") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {heading}
        {section.intro ? (
          <p data-ask style={BODY}>
            {section.intro}
          </p>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {section.steps.map((step) => (
            <div key={step.when} style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: BRAND.blue,
                  flex: "none",
                  width: 56,
                }}
              >
                {step.when}
              </span>
              <p data-ask style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6 }}>
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // "bullets"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {heading}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {section.items.map((item) => (
          <div key={item.slice(0, 32)} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: BRAND.blue,
                flex: "none",
                marginTop: 7,
              }}
            />
            <p data-ask style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6 }}>
              {item}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportSections({ sections }: { sections: readonly ReportSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <ReportSectionBlock key={s.heading} section={s} />
      ))}
    </>
  );
}

const EXEC_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px,1.1fr) 62px minmax(200px,2.2fr) 78px",
  gap: 16,
};

/** The big before/after numerals. Severity-coloured, with the verdict beneath. */
function ScorePair({ label, score }: { label: string; score: number }) {
  const colour = severityColor(score);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ ...EYEBROW, letterSpacing: ".2em", color: INK.micro }}>{label}</span>
      <span
        style={{
          fontSize: 58,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: colour,
          ...TABULAR,
        }}
      >
        {score}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: colour,
        }}
      >
        {verdictLabel(score)}
      </span>
    </div>
  );
}

function ExecutiveBody({ report }: { report: PreviewExecutiveReport }) {
  const gain = PREVIEW_REMEDIATED_SCORE - PREVIEW_READINESS_SCORE;
  const scannedOn = PREVIEW_TENANT.scannedOn ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          borderBottom: `1px solid ${INK.hairlineDark}`,
          paddingBottom: 26,
        }}
      >
        <span style={{ ...EYEBROW, color: INK.link }}>{`Copilot Readiness, Safety & Enablement · ${scannedOn}`}</span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(26px,3vw,34px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.18,
            color: INK.headingDark,
            textWrap: "pretty",
          }}
        >
          {report.headline}
        </h1>
        <p style={{ ...BODY, fontSize: 16, lineHeight: 1.6, maxWidth: "62ch" }}>{report.standfirst}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <h2 style={H2}>Copilot Readiness Summary</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 44px", alignItems: "flex-end" }}>
          <ScorePair label="Readiness today" score={PREVIEW_READINESS_SCORE} />
          <ScorePair label="After remediation" score={PREVIEW_REMEDIATED_SCORE} />
          <p
            style={{
              margin: 0,
              flex: "1 1 260px",
              fontSize: 13.5,
              fontWeight: 500,
              lineHeight: 1.6,
              color: INK.micro,
              maxWidth: "38ch",
            }}
          >
            {report.gapNote(gain, scannedOn)}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
          <div style={{ ...EXEC_GRID, padding: "12px 0", borderBottom: `1px solid ${INK.hairlineDark}` }}>
            {["Pillar", "Score", "Material finding", "Fixed"].map((h, i) => (
              <span
                key={h}
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: INK.micro,
                  textAlign: i === 3 ? "right" : "left",
                }}
              >
                {h}
              </span>
            ))}
          </div>
          {PREVIEW_PILLARS.map((p) => (
            <div
              key={p.key}
              data-ask
              style={{
                ...EXEC_GRID,
                padding: "14px 0",
                borderBottom: `1px solid ${INK.hairlineDark}`,
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: INK.headingDark,
                }}
              >
                <PillarSwatch pillar={p.key} />
                {PILLARS[p.key].label}
              </span>
              <span style={{ fontSize: 19, fontWeight: 800, color: severityColor(p.score), ...TABULAR }}>
                {p.score}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
                {PREVIEW_MATERIAL_FINDINGS[p.key]}
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: severityColor(p.projected),
                  textAlign: "right",
                  ...TABULAR,
                }}
              >
                {p.projected}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ReportSections sections={report.sections} />

      <p
        style={{
          margin: 0,
          paddingTop: 22,
          borderTop: `1px solid ${INK.hairlineDark}`,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: INK.micro,
          maxWidth: "70ch",
        }}
      >
        {report.provenance(scannedOn, PREVIEW_SIGNAL_COUNT)}
      </p>
    </div>
  );
}

function PillarBody({ report }: { report: PreviewPillarReport }) {
  const identity = PILLARS[report.pillar];
  const fixture = PREVIEW_PILLARS.find((p) => p.key === report.pillar);
  const score = fixture?.score ?? null;
  const projected = fixture?.projected ?? null;
  const scannedOn = PREVIEW_TENANT.scannedOn ?? "";

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
        <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Identity colour names the pillar; the tag beside it is severity. */}
          <span style={{ ...EYEBROW, color: identity.primary, display: "flex", alignItems: "center", gap: 8 }}>
            <PillarSwatch pillar={report.pillar} />
            {score === null ? report.kicker : `${report.kicker} · pillar score ${score}`}
          </span>
          {score === null ? null : <SeverityTag severity={severityForScore(score)} />}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px,2.8vw,31px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
            color: INK.headingDark,
          }}
        >
          {report.headline}
        </h1>
      </div>

      <ReportSections sections={report.sections} />

      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <h2 style={{ ...H2, fontSize: 18, letterSpacing: "normal" }}>Executive Summary</h2>
        <p data-ask style={BODY}>
          {report.closingNote}
        </p>
        {score === null || projected === null ? null : (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.6,
              color: severityColor(projected),
              ...TABULAR,
            }}
          >
            {`Projected pillar score after remediation: ${projected} (+${projected - score}).`}
          </p>
        )}
      </div>

      <p
        style={{
          margin: 0,
          paddingTop: 22,
          borderTop: `1px solid ${INK.hairlineDark}`,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: INK.micro,
          maxWidth: "70ch",
        }}
      >
        {report.provenance(scannedOn, PREVIEW_SIGNAL_COUNT)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Live body — the platform's own generated HTML
 * ------------------------------------------------------------------ */

interface DocumentPayload {
  readonly id: number;
  readonly title: string;
  readonly htmlContent: string | null;
}

function LiveBody({ documentId, title }: { documentId: number; title: string }) {
  const { fetchWithAuth, accessToken } = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const proseRef = useRef<HTMLDivElement | null>(null);
  const viewLogged = useRef<number | null>(null);
  const emptyLogged = useRef<number | null>(null);

  // `fetchWithAuth` is rebuilt on every silent access-token refresh, and the
  // portal refreshes every 13 minutes — short enough that any real read of a
  // report crosses one. Held in refs so `load` depends on `[documentId]` alone;
  // depending on the function itself would blank the body and snap the customer
  // back to a spinner mid-sentence, twice an hour. Same discipline as
  // `useCopilotJourney`.
  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  // Stale-response guard. The card is reconciled in place when the customer
  // switches reports, so a slow fetch for the previous document must never
  // resolve into the new one's card. Both the abort and the sequence check are
  // kept: the abort stops the work, the sequence number is what makes the bail
  // happen BEFORE either setState, including on the retry path where two loads
  // for the same id can overlap.
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setHtml(null);
    setState("loading");
    try {
      // `silent`: this component renders its own "We could not open …" state
      // with a retry, and fetchWithAuth's global toast would make one failure
      // shout in two places at once.
      const res = await fetchRef.current(
        `${DOCUMENT_URL}/${documentId}`,
        { signal: controller.signal },
        { silent: true },
      );
      if (!res.ok) throw new Error(`document ${documentId} → ${res.status}`);
      const body = (await res.json()) as DocumentPayload;
      if (seq !== requestSeq.current) return;
      setHtml(body.htmlContent ?? "");
      setState("ready");
    } catch (e) {
      if (seq !== requestSeq.current || controller.signal.aborted) return;
      setState("error");
      // Beacon rather than swallow: a customer looking at an empty report is
      // exactly the case where the log stream needs to say why.
      reportClientEvent(
        tokenRef.current,
        "CopilotJourneyDocumentFetchFailed",
        e instanceof Error ? e.message : String(e),
        JOURNEY_CHANNEL,
        { documentId },
      );
    }
  }, [documentId]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  // Record the open once per document, on the platform's own view-tracking
  // endpoint — the same one the assessment pipeline viewer fires. Fire and
  // forget, and `silent` with it: `.catch()` only swallows a network rejection,
  // so without this a 404 or a 500 on a tracking call the customer never asked
  // for would pop a red toast over the report they just opened.
  useEffect(() => {
    if (state !== "ready" || viewLogged.current === documentId) return undefined;
    viewLogged.current = documentId;
    void fetchRef
      .current(`${DOCUMENT_URL}/${documentId}/view`, { method: "POST" }, { silent: true })
      .catch(() => {
        /* tracking only */
      });
    return undefined;
  }, [state, documentId]);

  // A document the platform marked ready but stored with no body is a real
  // defect, not a customer-visible-only oddity — so it is beaconed on the same
  // channel as a failed fetch, once per document, and the card below says only
  // what this code has actually done.
  const empty = state === "ready" && !html?.trim();
  useEffect(() => {
    if (!empty || emptyLogged.current === documentId) return undefined;
    emptyLogged.current = documentId;
    reportClientEvent(
      tokenRef.current,
      "CopilotJourneyDocumentEmpty",
      `document ${documentId} is marked ready with no html_content`,
      JOURNEY_CHANNEL,
      { documentId },
    );
    return undefined;
  }, [empty, documentId]);

  // The generated documents are plain semantic markup with no hover targets of
  // their own, so the "Ask Shane" affordance is attached here: every paragraph,
  // list item and table row in the rendered report becomes askable. Done against
  // the live DOM rather than by rewriting the HTML string, so nothing about the
  // platform's output is altered on its way to the page.
  useEffect(() => {
    const el = proseRef.current;
    if (!el || state !== "ready") return undefined;
    el.querySelectorAll("p, li, tr, blockquote, h2, h3").forEach((node) => {
      node.setAttribute("data-ask", "");
    });
    return undefined;
  }, [state, html]);

  if (state === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "40px 0", color: INK.micro }}>
        <Loader2 className="size-4 animate-spin" />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Opening {title}…</span>
      </div>
    );
  }

  if (state === "error") {
    // The detail line deliberately does NOT say "the same set is attached to
    // your delivery notification": nothing attaches the document set to any
    // customer notification. The only send path in the platform is the
    // admin-triggered per-document POST, so an automatic delivery email is not
    // something this screen can point a customer at.
    return (
      <JourneyUnavailable
        eyebrow="Not available right now"
        title={`We could not open ${title}`}
        detail="The report exists — this was a problem reaching it, not a problem with your assessment. Try again; if it keeps failing, the other reports in the set are unaffected and Shane can send this one directly."
        action={
          <div>
            <Button variant="outline" size="sm" onClick={() => void load()} style={DARK_OUTLINE_BUTTON}>
              Try again
            </Button>
          </div>
        }
      />
    );
  }

  // Written out rather than reusing `empty` so the compiler can narrow `html`
  // for the render below; the two conditions are the same one, since `state`
  // is necessarily "ready" by this line.
  if (!html || !html.trim()) {
    return (
      <JourneyUnavailable
        eyebrow="Nothing to show"
        title={`${title} has no content yet`}
        // Only what this code can vouch for: the fault has been reported from
        // this browser to the platform's log stream. Whether that reaches Shane
        // is not something the client can see, so it is not claimed.
        detail="The report was marked ready without a body. The fault has been reported automatically — nothing about your scan is affected, and the other reports in the set are unaffected."
      />
    );
  }

  return (
    // The HTML here is platform-generated: it is written by the assessment
    // document pipeline into `insights_generated_documents.html_content` and
    // served by `GET /portal/assessment/documents/:id`, scoped server-side to the
    // caller's own customer. It is never customer- or user-authored input.
    // `.cj-doc-body` carries the reading measure and rhythm; the document
    // supplies structure only.
    <div ref={proseRef} className="cj-doc-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/* ------------------------------------------------------------------ *
 * The body
 * ------------------------------------------------------------------ */

export function DocumentBody({
  doc,
  generation,
  tenant,
  loaded,
  isPreview,
  reduceMotion,
  error,
  onRetry,
}: {
  readonly doc: JourneyDocumentView | null;
  readonly generation: JourneyGeneration;
  readonly tenant: JourneyTenant;
  /** False until the generation payload has landed. */
  readonly loaded: boolean;
  readonly isPreview: boolean;
  readonly reduceMotion: boolean;
  /** Set when the status fetch failed outright. */
  readonly error?: string | null;
  readonly onRetry?: () => void;
}) {
  const gen = generationView(generation.ready, generation.total);

  const retryAction = onRetry ? (
    <div>
      <Button variant="outline" size="sm" onClick={onRetry} style={DARK_OUTLINE_BUTTON}>
        Try again
      </Button>
    </div>
  ) : undefined;

  // A status fetch that failed leaves an empty document set, and every entry in
  // a partially-read one can still be an expected title with no row behind it.
  // Either way, rendering those as reports "still generating" is a claim nothing
  // has verified. If the fetch failed AND not one row is real, say so instead.
  const unreadable = Boolean(error) && generation.documents.every((d) => d.id === null);
  if (unreadable) {
    return (
      <Card>
        <JourneyUnavailable
          eyebrow="Not available right now"
          title="We could not read the state of your reports"
          detail="This is a problem reaching the platform, not a problem with your assessment — your scan and anything already generated are untouched. Try again in a moment."
          action={retryAction}
        />
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card>
        <CentredState
          reduceMotion={reduceMotion}
          title="Opening your reports"
          detail="Reading the state of your document set."
          progress={null}
        />
      </Card>
    );
  }

  // No document to show. With the payload landed and no error, that means the
  // platform listed neither an expected set nor a generated row — `gen.known`
  // is false and there is nothing to count. A spinner and a "we will notify
  // you" note here would promise a generation run that is not under way, so the
  // screen says only what it knows.
  if (!doc || !gen.known) {
    return (
      <Card>
        <JourneyUnavailable
          eyebrow="Not available yet"
          title="No reports are listed for your assessment yet"
          detail="Your document set is defined when your assessment is set up, and generation starts the moment a scan completes. Nothing is missing from your scan — there is simply nothing here to list yet."
          action={retryAction}
        />
      </Card>
    );
  }

  if (isPreview) {
    const preview = PREVIEW_DOCUMENT_BODIES[doc.title];
    if (preview) {
      return <Card>{preview.kind === "executive" ? <ExecutiveBody report={preview} /> : <PillarBody report={preview} />}</Card>;
    }
  }

  if (!isPreview && doc.status === "ready" && doc.id !== null) {
    return (
      <Card>
        {/* Keyed on the document id: switching reports remounts the reader with
            empty state rather than reconciling one report's body into another's
            card. Belt and braces with `LiveBody`'s own stale-response guard —
            the key alone would not help a retry that overlaps itself. */}
        <LiveBody key={doc.id} documentId={doc.id} title={doc.title} />
      </Card>
    );
  }

  // Still generating — including the design's own case, where most of the set
  // has no body yet. The seat clause is omitted rather than invented when the
  // platform has no seat count for this tenant.
  const sizeClause =
    tenant.seatCount === null
      ? "a tenant this size"
      : `a ${tenant.seatCount.toLocaleString("en-US")}-seat tenant`;

  return (
    <Card>
      <CentredState
        reduceMotion={reduceMotion}
        title={
          doc.status === "failed"
            ? `${doc.title} did not generate`
            : `${doc.title} is still generating`
        }
        detail={
          // The platform set this row to `failed` itself, so the failure is
          // already on its record — but whether that reaches Shane, and whether
          // anything retries it, is not something this page can see. So it says
          // what is true from here and gives the customer the next move.
          doc.status === "failed"
            ? "The rest of the set is unaffected. The failure is recorded against your assessment — ask Shane to regenerate this one."
            : `${gen.status}. Generation runs in order and takes a few minutes on ${sizeClause}.`
        }
        progress={gen.pct}
        footnote={gen.note}
      />
    </Card>
  );
}
