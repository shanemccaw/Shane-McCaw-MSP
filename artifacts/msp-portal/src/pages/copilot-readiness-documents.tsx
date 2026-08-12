/**
 * copilot-readiness-documents.tsx — Screen 2 of the Copilot Readiness journey:
 * the in-app reader for the tenant's generated reports.
 *
 * Route: `/copilot-readiness/documents/:docId?` — `:docId` is the platform's own
 * document id, so a report is linkable, survives a refresh and works with
 * Back/Forward. A bare `/copilot-readiness/documents` opens the first ready
 * report, which is the honest default: it is the one the customer can actually
 * read right now.
 *
 * This is where the engagement fee gets justified with real depth, so it is
 * calm, legible and premium — and it deliberately carries NONE of the Reveal's
 * motion language. No parallax, no scroll-pinning, no count-ups. Dark theme on
 * `#020617` against a navy sidebar, matching the other three journey screens,
 * fixed that way whichever direction the portal's own light/dark toggle is set
 * (see `journeyTokens.ts` for why these four screens are theme-fixed rather
 * than token-driven).
 *
 * Renders outside AppShell, full-bleed, the same as `war-room.tsx` — the shell
 * would be covered either way.
 *
 * THE CHROME IS ORIENTATION, NOT DECORATION
 * -----------------------------------------
 * Four things in the frame exist to keep a reader located inside a set of eight
 * long documents: the rail's Copilot Gate block (where the tenant stands), the
 * header's pillar strip (which subject this report belongs to and how the other
 * five score), the hairline read-progress bar (how far through this one they
 * are) and the ambient glow behind the pane (the open report's accent). Each is
 * derived — none of them is a second copy of a number stated elsewhere.
 *
 * DATA: `useCopilotJourney()` → `view.generation.documents`, and the body's own
 * `GET /api/portal/assessment/documents/:id`. Nothing on this screen is a
 * template value. `?preview=design` renders the design's worked example instead,
 * badged, and is unreachable on a live journey.
 *
 * NO SHANEBOT. The handoff specifies a docked ShaneBot pill and a hover "Ask
 * Shane" affordance, both explicitly UI-only — no chat logic, no grounding, no
 * backend. They were built to that spec and are removed for this release, not
 * hidden behind a flag: an entry point that opens a panel with a disabled input
 * marked SOON is a promise the platform cannot keep on the screen where the
 * customer is deciding whether the engagement fee was worth it. The components
 * are deleted rather than orphaned; the design and their implementation are both
 * in git history if the grounding architecture lands later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { ArrowRight, Menu, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { useVersionInfo } from "@/hooks/useVersionInfo";

import { DocumentBody } from "@/components/copilot-journey/DocumentBody";
import { DocumentExportMenu } from "@/components/copilot-journey/DocumentExportMenu";
import { DocumentPager } from "@/components/copilot-journey/DocumentPager";
import {
  DocumentSheet,
  DocumentSidebar,
  NAV_COLLAPSE_PX,
  NAV_WIDTH_DEFAULT,
} from "@/components/copilot-journey/DocumentSidebar";
import { PreviewBadge } from "@/components/copilot-journey/JourneyPrimitives";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import {
  documentPillar,
  withLiveDocuments,
  type JourneyView,
} from "@/components/copilot-journey/journeyModel.ts";
import {
  BRAND,
  COPILOT_GATE_TARGET,
  DELTA_GRADIENT,
  INK,
  JOURNEY_REMEDIATION_DOCUMENT,
  JOURNEY_SOW_DOCUMENT,
  PILLAR_ICON_PATHS,
  PILLAR_ORDER,
  RADIUS,
  gateLabel,
  hexAlpha,
  isLiveRenderedDocument,
  reportAccent,
  severityColor,
} from "@/components/copilot-journey/journeyTokens.ts";
import { previewJourneyView } from "@/components/copilot-journey/journeyPreviewFixture.ts";
import { PREVIEW_DOCUMENT_BODIES } from "@/components/copilot-journey/previewDocumentBodies.ts";
import "@/components/copilot-journey/copilot-journey.css";

const DOCUMENTS_PATH = "/copilot-readiness/documents";
const PROPOSAL_PATH = "/copilot-readiness/proposal";
const CHECKOUT_PATH = "/copilot-readiness/checkout";
const REVEAL_PATH = "/copilot-readiness";

/**
 * The PDF is the platform's existing branded export, not a second renderer:
 * `GET /portal/insights-documents/:id/pdf` runs the same `buildHtmlDoc` +
 * `htmlToPdf` pipeline every other document download in the portal uses.
 */
const PDF_URL = "/api/portal/insights-documents";

/** Below this the header's pillar strip is dropped before the title truncates. */
const STRIP_COLLAPSE_PX = 1320;
/**
 * The gate chip stands in for the rail once the rail is gone, so it appears
 * exactly where the rail does not — and disappears again on a phone, where the
 * report title is the only thing the header has room to say.
 */
const GATE_MIN_PX = 620;

/* ------------------------------------------------------------------ *
 * Small header controls. Inline styles cannot express `:hover`, so the
 * bespoke controls carry their own hover state rather than losing the
 * affordance entirely.
 * ------------------------------------------------------------------ */

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

/** Viewport width, sampled once and on resize. One listener for three breakpoints. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/* ------------------------------------------------------------------ *
 * The header's pillar strip
 * ------------------------------------------------------------------ */

/**
 * Six mini badges — icon and score — with the open report's own pillar lifted
 * out of the row.
 *
 * A pillar the scan could not evaluate shows an em dash rather than a 0: the
 * strip is a summary of what was measured, and printing 0 for "nothing fed this"
 * is the one reading that turns an absence into a verdict.
 */
function PillarStrip({ view, active }: { view: JourneyView; active: string | null }) {
  const byKey = new Map(view.pillars.map((p) => [p.key, p]));
  // On the three documents that span every pillar — the roll-up report, the
  // remediation guide, the SOW — none of the six is "the" subject, so all six
  // stay equally lit rather than every one of them reading as dimmed-out.
  const multiPillar = active === null;
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 1,
        minWidth: 0,
        overflow: "hidden",
        alignItems: "center",
        gap: 3,
        padding: "4px 6px",
        border: `1px solid ${INK.hairlineDark}`,
        borderRadius: 8,
        marginRight: 4,
      }}
    >
      {PILLAR_ORDER.map((p) => {
        const score = byKey.get(p.key)?.score ?? null;
        const on = multiPillar || active === p.key;
        return (
          <span
            key={p.key}
            title={`${p.label}${score === null ? "" : ` · ${score}`}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "3px 7px",
              borderRadius: 6,
              transition: "opacity 260ms ease, background 260ms ease, transform 260ms ease",
              opacity: on ? 1 : 0.5,
              // The lift is the "this one" signal, so it is withheld when all
              // six are lit — six raised badges says nothing.
              background: on && !multiPillar ? hexAlpha(p.primary, 0.12) : "transparent",
              transform: `scale(${on && !multiPillar ? 1.06 : 1})`,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke={p.primary}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "none" }}
              aria-hidden="true"
            >
              <path d={PILLAR_ICON_PATHS[p.key]} />
            </svg>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                lineHeight: 1,
                color: score === null ? INK.micro : severityColor(score),
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score ?? "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** The header's compact restatement of the rail's gate block. */
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

export default function CopilotReadinessDocumentsPage() {
  const [, navigate] = useLocation();
  const { docId } = useParams<{ docId?: string }>();
  const search = useSearch();
  const { fetchWithAuth, logout } = useAuth();
  const versionInfo = useVersionInfo();

  const isPreview = new URLSearchParams(search).get("preview") === "design";

  // Read once. This screen has no motion worth subscribing to — the only
  // animations are the generation spinner and the switcher's pulse, neither of
  // which needs to respond to a mid-session change.
  const [reduceMotion] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /* ---------------------------------------------------------------- *
   * Tenant identity
   * ---------------------------------------------------------------- */

  // The customer's real company name, from the same `/portal/dashboard` field
  // the War Room reads (#327). Non-fatal: `useCopilotJourney` falls back to a
  // generic label rather than inventing an organisation — and `silent` so that
  // "non-fatal" is true in practice, since fetchWithAuth toasts every non-OK
  // response globally and a name we can live without is not worth an alarm.
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    if (isPreview) return undefined;
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
  }, [fetchWithAuth, isPreview]);

  const live = useCopilotJourney({ tenantName: customerName });

  /**
   * The design's own worked example. Exactly the reports the design writes out
   * are marked ready — which is what makes its "N of 8 ready" counter and its
   * still-generating state both visible in one pass.
   */
  const previewView = useMemo<JourneyView>(() => {
    const base = previewJourneyView();
    // A document is readable in the preview if something can draw it: one of the
    // seven report bodies, or one of the two that render themselves.
    const drawable = (title: string) =>
      Boolean(PREVIEW_DOCUMENT_BODIES[title]) ||
      title === JOURNEY_REMEDIATION_DOCUMENT ||
      title === JOURNEY_SOW_DOCUMENT;
    const documents = base.generation.documents.map((d, i) =>
      // Spread rather than rebuilt, so the fixture's `docType` — the key the
      // live path joins on — survives into the preview instead of being
      // silently dropped here.
      drawable(d.title)
        ? { ...d, id: i + 1, status: "ready" as const }
        : { ...d, id: null, status: "generating" as const },
    );
    const ready = documents.filter((d) => d.status === "ready").length;
    return {
      ...base,
      generation: { ready, total: documents.length, allReady: false, documents },
    };
  }, []);

  const view = isPreview ? previewView : live.view;
  const loaded = isPreview ? true : live.statusLoaded;

  /**
   * The set this screen switches between, with every live-rendered document
   * guaranteed to be in it (#424, generalised in #343).
   *
   * They are constructed rather than looked up because they are the documents
   * that do not come from the generation pipeline: they render live from this
   * tenant's own scan data, so they exist whether or not `documents.expected`
   * names them and whether or not a row has ever been written. Everything else
   * in the list is exactly what the platform reported, untouched — see
   * `withLiveDocuments`, which no-ops entirely on a row the pipeline has
   * actually generated (which is the design preview's case too, so
   * `?preview=design` is byte-for-byte unchanged).
   */
  const generation = useMemo(() => withLiveDocuments(view.generation), [view.generation]);
  const documents = generation.documents;

  /* ---------------------------------------------------------------- *
   * Which document is open
   * ---------------------------------------------------------------- */

  // A report that has not been generated yet has no id, so it has no URL to
  // link to. It still has to open — never a dead row — so a click on one is
  // held here and the address bar drops back to the bare route.
  const [manualIndex, setManualIndex] = useState<number | null>(null);

  const activeIndex = useMemo(() => {
    if (docId) {
      const byId = documents.findIndex((d) => d.id !== null && String(d.id) === docId);
      if (byId >= 0) return byId;
    }
    if (manualIndex !== null && manualIndex < documents.length) return manualIndex;
    const firstReady = documents.findIndex((d) => d.status === "ready");
    return firstReady >= 0 ? firstReady : 0;
  }, [docId, manualIndex, documents]);

  const activeDoc = documents[activeIndex] ?? null;
  const activePillar = documentPillar(activeDoc);
  const accent = reportAccent(activePillar);

  const withPreview = useCallback(
    (path: string) => (isPreview ? `${path}?preview=design` : path),
    [isPreview],
  );

  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSelect = useCallback(
    (index: number) => {
      setSheetOpen(false);
      const doc = documents[index];
      if (doc && doc.id !== null) {
        setManualIndex(null);
        navigate(withPreview(`${DOCUMENTS_PATH}/${doc.id}`));
        return;
      }
      setManualIndex(index);
      if (docId) navigate(withPreview(DOCUMENTS_PATH));
    },
    [documents, docId, navigate, withPreview],
  );

  /* ---------------------------------------------------------------- *
   * Layout — the rail collapses entirely below 940px and the switcher
   * moves into a bottom sheet behind the header's "Documents" button.
   * ---------------------------------------------------------------- */

  const viewport = useViewportWidth();
  const narrow = viewport < NAV_COLLAPSE_PX;
  const showStrip = viewport >= STRIP_COLLAPSE_PX;
  const showGate = narrow && viewport >= GATE_MIN_PX;

  /* ---------------------------------------------------------------- *
   * Reading position
   *
   * Kept in memory for the session only — nothing about how far somebody read
   * their own assessment is worth persisting to a server, and a value restored
   * from `localStorage` would survive a report being regenerated underneath it.
   * The value only ever climbs: skimming back up a report does not un-read it.
   * ---------------------------------------------------------------- */

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [readProgress, setReadProgress] = useState<Readonly<Record<string, number>>>({});
  const activeProgress = activeDoc ? (readProgress[activeDoc.title] ?? 0) : 0;

  // The identity that actually means "a different report is open" — a plain
  // string, unlike `activeDoc` itself. `documents` (and therefore `activeDoc`)
  // is rebuilt with brand-new object references on every generation-status
  // poll (#409's async prose pipeline polls every 4s while anything in the set
  // is still generating) even when the open report hasn't changed at all, so
  // anything keyed on `activeDoc` churns identity on a timer, not just on a
  // real switch (#441).
  const activeTitle = activeDoc?.title ?? null;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !activeTitle) return;
    const travel = el.scrollHeight - el.clientHeight;
    // A report shorter than the pane is read the moment it is opened; treating
    // it as 0% for ever would leave a permanently unfinished row in the rail.
    const pct = travel <= 4 ? 1 : Math.min(1, Math.max(0, el.scrollTop / travel));
    setReadProgress((prev) => (pct <= (prev[activeTitle] ?? 0) ? prev : { ...prev, [activeTitle]: pct }));
  }, [activeTitle]);

  // Switching reports starts the new one at the top rather than halfway down
  // wherever the last one happened to be, and re-samples progress for a report
  // that turns out to be shorter than the pane. Depends only on the stable
  // `activeTitle` (and the now-equally-stable `handleScroll`), so a poll that
  // rebuilds `documents` without changing which report is open cannot re-fire
  // this and yank the reader back to the top mid-read (#441).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.scrollTop = 0;
    const id = window.requestAnimationFrame(handleScroll);
    return () => window.cancelAnimationFrame(id);
  }, [activeTitle, handleScroll]);

  /**
   * Open the statement of work — the remediation guide's closing handoff, and
   * where "Ready to fix this?" will land once the SOW document ships. Falls back
   * to the standalone proposal screen while that document is still generating,
   * so the button is never a dead end.
   */
  const handleOpenSow = useCallback(() => {
    const index = documents.findIndex((d) => d.title === JOURNEY_SOW_DOCUMENT);
    if (index >= 0) {
      handleSelect(index);
      return;
    }
    navigate(withPreview(PROPOSAL_PATH));
  }, [documents, handleSelect, navigate, withPreview]);

  /**
   * Signing hands the agreed scope to the checkout screen, which is where the
   * platform's real Stripe path lives. The viewer takes no payment and writes no
   * agreement — the same handoff the standalone proposal screen makes, so the
   * signed block at checkout is this contract rather than a re-quote.
   */
  const handleSigned = useCallback(
    (query: string) => {
      const base = isPreview ? `${CHECKOUT_PATH}?preview=design&${query}` : `${CHECKOUT_PATH}?${query}`;
      navigate(base);
    },
    [isPreview, navigate],
  );

  /* ---------------------------------------------------------------- *
   * PDF
   * ---------------------------------------------------------------- */

  const [downloading, setDownloading] = useState(false);
  // A live-rendered document's row (if it has one at all) is never PDF-eligible:
  // it would be stale content the browser doesn't show (#415) rather than a
  // real export. The server refuses these too — this just avoids offering a
  // download that a click would immediately fail.
  const canDownload =
    !isPreview && activeDoc?.status === "ready" && activeDoc.id !== null && !isLiveRenderedDocument(activeDoc);
  const downloadable = useMemo(
    () =>
      isPreview
        ? []
        : documents.filter((d) => d.status === "ready" && d.id !== null && !isLiveRenderedDocument(d)),
    [documents, isPreview],
  );

  const downloadOne = useCallback(
    async (id: number, title: string) => {
      // `silent`: the failure is reported once, by the caller, in words that say
      // the report is still readable here. The global toast would put the raw
      // server error ("Forbidden") beside it and make one failure look like two.
      const res = await fetchWithAuth(`${PDF_URL}/${id}/pdf`, undefined, { silent: true });
      if (!res.ok) throw new Error(`pdf ${id} → ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    },
    [fetchWithAuth],
  );

  const handleDownload = useCallback(async () => {
    if (!activeDoc || activeDoc.id === null) return;
    setDownloading(true);
    try {
      await downloadOne(activeDoc.id, activeDoc.title);
    } catch {
      toast.error("We could not build that PDF just now. The report is still open here.");
    } finally {
      setDownloading(false);
    }
  }, [activeDoc, downloadOne]);

  /**
   * Every ready report, one after another. Sequential rather than parallel: each
   * PDF is a Chromium render server-side, and firing eight at once is the one
   * request pattern that turns a download into a timeout.
   *
   * A failure part-way through is reported with the count that did land, because
   * "some of your reports downloaded" is the truth and a bare error is not.
   */
  const handleDownloadAll = useCallback(async () => {
    if (downloadable.length === 0) return;
    setDownloading(true);
    let done = 0;
    try {
      for (const doc of downloadable) {
        if (doc.id === null) continue;
        await downloadOne(doc.id, doc.title);
        done += 1;
      }
      toast.success(`${done} ${done === 1 ? "report" : "reports"} downloaded.`);
    } catch {
      toast.error(
        done === 0
          ? "We could not build those PDFs just now. Every report is still readable here."
          : `${done} of ${downloadable.length} downloaded before that failed. The rest are still readable here.`,
      );
    } finally {
      setDownloading(false);
    }
  }, [downloadable, downloadOne]);

  const cta = useHover();
  const closeBtn = useHover();
  const sheetBtn = useHover();
  const logoutBtn = useHover();

  const switcherProps = {
    documents,
    // Counted off the list the rail actually draws, not the payload's own
    // figures — with the readiness report in the set those two differ, and a
    // counter that disagrees with the rows beneath it is the worse of the two.
    ready: generation.ready,
    total: generation.total,
    loaded,
    activeIndex,
    onSelect: handleSelect,
    reduceMotion,
    readProgress,
  };

  return (
    <div
      className="cj-dark"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        overflow: "hidden",
        background: BRAND.canvas,
      }}
    >
      {isPreview ? <PreviewBadge /> : null}

      {/* The rail is unmounted rather than held at width 0 below the breakpoint:
          a zero-width sidebar still leaves a row per report in the tab order
          with nothing on screen to explain them. The sheet carries them instead. */}
      {narrow ? null : (
        <DocumentSidebar
          width={NAV_WIDTH_DEFAULT}
          tenant={view.tenant}
          score={view.readinessScore}
          {...switcherProps}
        />
      )}

      <div style={{ position: "relative", flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Ambient light behind the reading pane, tinted by the open report.
            Pointer-events off and below everything — it is the only thing on
            this screen that moves at all, and only when the report changes. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "-6%",
              width: "min(1240px,150%)",
              height: "74%",
              transform: "translateX(-50%)",
              filter: "blur(70px)",
              opacity: 0.85,
              transition: "background 400ms ease",
              background: accent.glow,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: "-14%",
              width: "min(980px,130%)",
              height: "46%",
              transform: "translateX(-50%)",
              filter: "blur(80px)",
              opacity: 0.55,
              transition: "background 400ms ease",
              background: accent.glow,
            }}
          />
        </div>

        <header
          style={{
            position: "relative",
            zIndex: 60,
            flex: "none",
            background: "rgba(9,14,28,.92)",
            borderBottom: `1px solid ${INK.hairlineDark}`,
            padding: "14px 26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            overflow: "visible",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 auto", minWidth: 200 }}>
            {narrow ? (
              <button
                type="button"
                onClick={() => setSheetOpen((v) => !v)}
                aria-expanded={sheetOpen}
                {...sheetBtn.handlers}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  border: `1px solid ${INK.hairlineDark}`,
                  borderRadius: RADIUS.control,
                  cursor: "pointer",
                  flex: "none",
                  background: sheetBtn.hovered ? "rgba(255,255,255,.06)" : "transparent",
                  fontFamily: "inherit",
                }}
              >
                <Menu size={15} strokeWidth={1.8} color={INK.headingDark} aria-hidden="true" />
                <span style={{ fontSize: 12, fontWeight: 600, color: INK.headingDark, whiteSpace: "nowrap" }}>
                  Documents
                </span>
              </button>
            ) : null}

            {/* The rail already carries the gate block, so the chip is the first
                thing dropped when the header runs out of room — not the title. */}
            {showGate && view.readinessScore !== null ? (
              <GateChip score={view.readinessScore} tenantName={view.tenant.name} />
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 auto", minWidth: 0, overflow: "hidden" }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: INK.bodyDark,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={accent.colour}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flex: "none" }}
                  aria-hidden="true"
                >
                  <path d={accent.icon} />
                </svg>
                Copilot readiness assessment
              </span>
              <span
                data-testid="active-document-title"
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
                {activeDoc?.title ?? "Your reports"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 1 auto", minWidth: 0, overflow: "visible" }}>
            {showStrip ? <PillarStrip view={view} active={activePillar} /> : null}

            {/* Persistent, on every report — the SOW is the point of the set.
                It opens document 9 where that exists, and only falls back to the
                standalone proposal screen while the document is still
                generating; the design has the in-viewer contract superseding
                that screen. */}
            <button
              type="button"
              onClick={handleOpenSow}
              {...cta.handlers}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 15px",
                height: 34,
                border: 0,
                borderRadius: RADIUS.control,
                background: cta.hovered ? BRAND.blueStrong : BRAND.blue,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background 160ms",
                fontFamily: "inherit",
                flex: "none",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: BRAND.white }}>
                Ready to fix this?
              </span>
              <ArrowRight size={14} strokeWidth={1.7} color={BRAND.white} aria-hidden="true" />
            </button>

            <DocumentExportMenu
              currentTitle={activeDoc?.title ?? "Your reports"}
              readyCount={isPreview ? view.generation.ready : downloadable.length}
              canDownloadCurrent={Boolean(canDownload)}
              disabledReason={
                isPreview
                  ? "Not available in the design preview"
                  : activeDoc && isLiveRenderedDocument(activeDoc)
                    ? "This report renders live — PDF export isn't available for it yet"
                    : null
              }
              downloading={downloading}
              onDownloadCurrent={() => void handleDownload()}
              onDownloadAll={() => void handleDownloadAll()}
            />

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
                flex: "none",
              }}
            >
              Sign out
            </button>

            <button
              type="button"
              onClick={() => navigate(withPreview(REVEAL_PATH))}
              aria-label="Close the reader and return to your results"
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
              <X size={15} strokeWidth={1.8} color={INK.micro} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* How far through this report they are. A hairline, under the header,
            reading left to right — the one piece of chrome that is allowed to
            move while somebody is reading. */}
        <div
          aria-hidden="true"
          style={{ position: "relative", zIndex: 3, flex: "none", height: 2, background: INK.hairlineDark }}
        >
          <div
            style={{
              height: "100%",
              background: DELTA_GRADIENT,
              transition: "width 90ms linear",
              width: `${Math.round(activeProgress * 100)}%`,
            }}
          />
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="cj-doc-scroll"
          data-testid="document-reading-pane"
          style={{
            position: "relative",
            zIndex: 2,
            flex: "1 1 auto",
            overflowY: "auto",
            padding: narrow ? "22px 16px 80px" : "34px 26px 90px",
          }}
        >
          <DocumentBody
            doc={activeDoc}
            generation={generation}
            tenant={view.tenant}
            // #409 — the roll-up readiness report renders from the tenant's own
            // pillar scores and stats rather than from generated HTML, so it
            // needs the whole view. Passed on both paths; `DocumentBody` reads
            // it only when `isPreview` is false, so `?preview=design` still
            // renders the design's fixed example from `PREVIEW_DOCUMENT_BODIES`
            // exactly as before.
            view={view}
            loaded={loaded}
            isPreview={isPreview}
            reduceMotion={reduceMotion}
            error={isPreview ? null : live.error}
            onRetry={live.refresh}
            onOpenSow={handleOpenSow}
            onSigned={handleSigned}
          />

          <DocumentPager
            prevTitle={activeIndex > 0 ? (documents[activeIndex - 1]?.title ?? null) : null}
            nextTitle={documents[activeIndex + 1]?.title ?? null}
            onPrev={() => handleSelect(activeIndex - 1)}
            onNext={() => handleSelect(activeIndex + 1)}
            onOpenSow={handleOpenSow}
            // "At end" means the reader has run out of documents, which is the
            // moment the offer belongs — but not on the contract itself, where
            // the offer is the page they are already looking at.
            atEnd={activeIndex === documents.length - 1 && activeDoc?.title !== JOURNEY_SOW_DOCUMENT}
          />

          <div style={{ textAlign: "center", padding: "18px 0 4px" }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: INK.micro }}>
              v{versionInfo.display}
            </span>
          </div>
        </div>
      </div>

      {narrow && sheetOpen ? (
        <DocumentSheet {...switcherProps} onDismiss={() => setSheetOpen(false)} />
      ) : null}
    </div>
  );
}
