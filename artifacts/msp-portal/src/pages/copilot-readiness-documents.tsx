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
 * DATA: `useCopilotJourney()` → `view.generation.documents`, and the body's own
 * `GET /api/portal/assessment/documents/:id`. Nothing on this screen is a
 * template value. `?preview=design` renders the design's worked example instead,
 * badged, and is unreachable on a live journey.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { ArrowRight, Download, Loader2, Menu, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

import { AskShaneAffordance } from "@/components/copilot-journey/AskShaneAffordance";
import { DocumentBody } from "@/components/copilot-journey/DocumentBody";
import {
  DocumentSheet,
  DocumentSidebar,
  NAV_COLLAPSE_PX,
  NAV_WIDTH_DEFAULT,
} from "@/components/copilot-journey/DocumentSidebar";
import { PreviewBadge } from "@/components/copilot-journey/JourneyPrimitives";
import { ShaneBotDock } from "@/components/copilot-journey/ShaneBotDock";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import { tenantStrip, type JourneyView } from "@/components/copilot-journey/journeyModel.ts";
import { BRAND, INK, RADIUS } from "@/components/copilot-journey/journeyTokens.ts";
import { previewJourneyView } from "@/components/copilot-journey/journeyPreviewFixture.ts";
import { PREVIEW_DOCUMENT_BODIES } from "@/components/copilot-journey/previewDocumentBodies.ts";
import "@/components/copilot-journey/copilot-journey.css";

const DOCUMENTS_PATH = "/copilot-readiness/documents";
const PROPOSAL_PATH = "/copilot-readiness/proposal";
const REVEAL_PATH = "/copilot-readiness";

/**
 * The PDF is the platform's existing branded export, not a second renderer:
 * `GET /portal/insights-documents/:id/pdf` runs the same `buildHtmlDoc` +
 * `htmlToPdf` pipeline every other document download in the portal uses.
 */
const PDF_URL = "/api/portal/insights-documents";

/* ------------------------------------------------------------------ *
 * Small header controls. Inline styles cannot express `:hover`, so the two
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

export default function CopilotReadinessDocumentsPage() {
  const [, navigate] = useLocation();
  const { docId } = useParams<{ docId?: string }>();
  const search = useSearch();
  const { fetchWithAuth } = useAuth();

  const isPreview = new URLSearchParams(search).get("preview") === "design";

  // Read once. This screen has no motion worth subscribing to — the only
  // animations are the generation spinner, the switcher's pulse and the
  // ShaneBot expand, none of which need to respond to a mid-session change.
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
   * The design's own worked example. Exactly the three reports the design writes
   * out are marked ready — which is what makes its "3 of 8 ready" counter and
   * its still-generating state both visible in one pass.
   */
  const previewView = useMemo<JourneyView>(() => {
    const base = previewJourneyView();
    const documents = base.generation.documents.map((d, i) =>
      // Spread rather than rebuilt, so the fixture's `docType` — the key the
      // live path joins on — survives into the preview instead of being
      // silently dropped here.
      PREVIEW_DOCUMENT_BODIES[d.title]
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
  const documents = view.generation.documents;

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

  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < NAV_COLLAPSE_PX,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NAV_COLLAPSE_PX);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------------------------------------------------------------- *
   * ShaneBot + the Ask Shane affordance. Both are UI only in this scope;
   * the affordance's only job is to hand a quote to the panel.
   * ---------------------------------------------------------------- */

  const [botOpen, setBotOpen] = useState(false);
  const [botContext, setBotContext] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleAsk = useCallback((context: string) => {
    setBotContext(context);
    setBotOpen(true);
  }, []);

  /* ---------------------------------------------------------------- *
   * PDF
   * ---------------------------------------------------------------- */

  const [downloading, setDownloading] = useState(false);
  const canDownload = !isPreview && activeDoc?.status === "ready" && activeDoc.id !== null;

  const handleDownload = useCallback(async () => {
    if (!activeDoc || activeDoc.id === null) return;
    setDownloading(true);
    try {
      // `silent`: the failure is reported once, below, in words that say the
      // report is still readable here. The global toast would put the raw
      // server error ("Forbidden") beside it and make one failure look like two.
      const res = await fetchWithAuth(`${PDF_URL}/${activeDoc.id}/pdf`, undefined, {
        silent: true,
      });
      if (!res.ok) {
        toast.error("We could not build that PDF just now. The report is still open here.");
        return;
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${activeDoc.title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("We could not build that PDF just now. The report is still open here.");
    } finally {
      setDownloading(false);
    }
  }, [activeDoc, fetchWithAuth]);

  const cta = useHover();
  const closeBtn = useHover();
  const sheetBtn = useHover();

  const switcherProps = {
    documents,
    ready: view.generation.ready,
    total: view.generation.total,
    loaded,
    activeIndex,
    onSelect: handleSelect,
    reduceMotion,
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
          tenantLine={tenantStrip(view.tenant)}
          {...switcherProps}
        />
      )}

      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
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
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: INK.micro,
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
                {activeDoc?.title ?? "Your reports"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
            {/* Persistent, on every report — the SOW is the point of the set. */}
            <button
              type="button"
              onClick={() => navigate(withPreview(PROPOSAL_PATH))}
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
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: BRAND.white }}>
                Ready to fix this?
              </span>
              <ArrowRight size={14} strokeWidth={1.7} color={BRAND.white} aria-hidden="true" />
            </button>

            {/* Subordinate to reading in-app, deliberately: outline + sm. The
                inline colours pin it to this screen's own dark surface, since
                it does not follow the portal's theme. */}
            <Button
              variant="outline"
              size="sm"
              disabled={!canDownload || downloading}
              onClick={() => void handleDownload()}
              style={{
                height: 34,
                background: "rgba(2,6,23,.7)",
                borderColor: INK.hairlineDark,
                color: INK.headingDark,
              }}
            >
              {downloading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              Download as PDF
            </Button>

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
                background: closeBtn.hovered ? "rgba(255,255,255,.06)" : "transparent",
              }}
            >
              <X size={15} strokeWidth={1.8} color={INK.micro} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} style={{ flex: "1 1 auto", overflowY: "auto", padding: "34px 26px 90px" }}>
          <DocumentBody
            doc={activeDoc}
            generation={view.generation}
            tenant={view.tenant}
            loaded={loaded}
            isPreview={isPreview}
            reduceMotion={reduceMotion}
            error={isPreview ? null : live.error}
            onRetry={live.refresh}
          />
        </div>
      </div>

      <ShaneBotDock
        open={botOpen}
        context={botContext}
        onToggle={() => setBotOpen((v) => !v)}
        onClose={() => setBotOpen(false)}
        reduceMotion={reduceMotion}
      />

      <AskShaneAffordance containerRef={scrollRef} onAsk={handleAsk} />

      {narrow && sheetOpen ? (
        <DocumentSheet {...switcherProps} onDismiss={() => setSheetOpen(false)} />
      ) : null}
    </div>
  );
}
