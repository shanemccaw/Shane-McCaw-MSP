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
  JOURNEY_REMEDIATION_DOCUMENT,
  RADIUS,
  reportAccent,
  type PillarKey,
} from "./journeyTokens.ts";
import { RemediationGuideBody } from "./RemediationGuideBody";
import type { JourneyDocumentView, JourneyGeneration, JourneyTenant } from "./journeyModel.ts";
import { documentPillar } from "./journeyModel.ts";
import { generationView } from "./revealMath.ts";
import { JourneyUnavailable } from "./JourneyPrimitives";
import { PREVIEW_DOCUMENT_BODIES } from "./previewDocumentBodies.ts";
import { PreviewReportBody } from "./PreviewReportBody";

const DOCUMENT_URL = "/api/portal/assessment/documents";
const JOURNEY_CHANNEL = "engine.dashboard";

/* ------------------------------------------------------------------ *
 * Shared dark-surface type
 * ------------------------------------------------------------------ */

/** Outline buttons on this dark card — the input-field dark this journey already uses (SOW Proposal's own fields). */
const DARK_OUTLINE_BUTTON = {
  background: "rgba(2,6,23,.7)",
  borderColor: "rgba(51,65,85,.9)",
  color: INK.headingDark,
} as const;

/**
 * The reading card. Every state renders inside it, so the page never reflows.
 *
 * The 3px band across the top is the report's accent — the pillar's identity
 * colour, or the journey's own blue→teal for the roll-up report that belongs to
 * no single pillar. It is the only place the card carries colour, and it is what
 * ties the open report to the pillar strip in the header and the accent bar on
 * its switcher row.
 */
function Card({ pillar, children }: { pillar: PillarKey | null; children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 748,
        margin: "0 auto",
        background: "rgba(11,18,32,.94)",
        border: "1px solid rgba(30,41,59,.95)",
        borderRadius: RADIUS.card,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(2,6,23,.55)",
      }}
    >
      <div aria-hidden="true" style={{ height: 3, background: reportAccent(pillar).band }} />
      <div style={{ padding: "clamp(18px,4vw,58px)" }}>{children}</div>
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
  onAsk,
  onOpenSow,
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
  /** Hands a quote to ShaneBot — wired to the preview reports' inline ask icons. */
  readonly onAsk?: (context: string) => void;
  /** Opens the statement of work — the remediation guide's closing handoff. */
  readonly onOpenSow?: () => void;
}) {
  const gen = generationView(generation.ready, generation.total);
  // Colour only: it tints the card's band and nothing else, so a document whose
  // pillar cannot be read from its name simply gets the journey's own accent.
  const pillar = documentPillar(doc);

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
      <Card pillar={pillar}>
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
      <Card pillar={pillar}>
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
      <Card pillar={pillar}>
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
    // The two non-report documents render their own bodies — the guide is a
    // runbook with tickable steps, the SOW a contract with switchable scope.
    if (doc.title === JOURNEY_REMEDIATION_DOCUMENT) {
      return (
        <Card pillar={pillar}>
          <RemediationGuideBody onOpenSow={onOpenSow} />
        </Card>
      );
    }
    const preview = PREVIEW_DOCUMENT_BODIES[doc.title];
    if (preview) {
      return (
        <Card pillar={pillar}>
          <PreviewReportBody report={preview} onAsk={onAsk} />
        </Card>
      );
    }
  }

  if (!isPreview && doc.status === "ready" && doc.id !== null) {
    return (
      <Card pillar={pillar}>
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
    <Card pillar={pillar}>
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
