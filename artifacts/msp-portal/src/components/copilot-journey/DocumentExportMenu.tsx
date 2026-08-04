/**
 * DocumentExportMenu.tsx — the Document Viewer header's "Share & export" menu.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Two of the design's four items are wired to endpoints that exist:
 *
 *   • "This report as PDF" → `GET /portal/insights-documents/:id/pdf`, the
 *     platform's existing branded export — the same `buildHtmlDoc` + `htmlToPdf`
 *     pipeline every other document download in the portal uses.
 *   • "Every ready report" → the same endpoint, once per ready report.
 *
 * The design's other two items hand a stranger a login-free link to the whole
 * set — one without commercial terms, one with the SOW attached. The platform
 * has a share-link mechanism (`quick_win_result_shares`, used by the dashboard
 * export) but nothing that bundles an assessment's reports behind one token, and
 * no notion of a pricing-free variant. So those two are drawn and labelled
 * "Soon" rather than wired to a URL this screen would have to invent — the same
 * honesty the ShaneBot dock's disabled input already uses on this journey.
 *
 * The design's own sublabel for the bulk download is "A single PDF set, in
 * reading order". There is no bundling endpoint, so the label here says what the
 * button actually does: it downloads each ready report in turn.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Eye, FileText, Files, Loader2, ShoppingCart } from "lucide-react";

import { BRAND, INK, RADIUS, SEVERITY_ON_DARK, hexAlpha } from "./journeyTokens.ts";

const PANEL_BG = "#0b1524";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: INK.micro,
};

function IconTile({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hexAlpha(colour, 0.1),
        border: `1px solid ${hexAlpha(colour, 0.2)}`,
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

function MenuItem({
  colour,
  icon,
  title,
  detail,
  disabled,
  badge,
  onClick,
}: {
  colour: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        border: 0,
        borderRadius: 7,
        cursor: disabled ? "default" : "pointer",
        background: hovered && !disabled ? "rgba(255,255,255,.05)" : "transparent",
        transition: "background 150ms",
        fontFamily: "inherit",
        opacity: disabled ? 0.62 : 1,
      }}
    >
      <IconTile colour={colour}>{icon}</IconTile>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.headingDark }}>{title}</span>
          {badge ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: BRAND.teal,
                flex: "none",
              }}
            >
              {badge}
            </span>
          ) : null}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.45, color: INK.bodyDark }}>{detail}</span>
      </span>
    </button>
  );
}

export function DocumentExportMenu({
  currentTitle,
  readyCount,
  canDownloadCurrent,
  disabledReason,
  downloading,
  onDownloadCurrent,
  onDownloadAll,
}: {
  /** The open report's title — the design prints it under "This report as PDF". */
  readonly currentTitle: string;
  /** How many reports actually have a body to export right now. */
  readonly readyCount: number;
  readonly canDownloadCurrent: boolean;
  /**
   * Why downloading is off, when it is — the design preview has no real document
   * ids behind its reports, so its menu says so rather than offering a button
   * that could only fail.
   */
  readonly disabledReason?: string | null;
  readonly downloading: boolean;
  readonly onDownloadCurrent: () => void;
  readonly onDownloadAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on an outside click or Escape. Without both, a menu anchored inside
  // a scrolling header is a trap on touch and unreachable from the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 34,
          padding: "0 11px",
          border: `1px solid ${open ? hexAlpha(BRAND.teal, 0.4) : INK.hairlineDark}`,
          borderRadius: RADIUS.control,
          background: open || hovered ? "rgba(255,255,255,.05)" : "rgba(2,6,23,.7)",
          cursor: "pointer",
          transition: "border-color 160ms, background 160ms",
          fontFamily: "inherit",
        }}
      >
        {downloading ? (
          <Loader2 className="size-3 animate-spin" color={INK.micro} aria-hidden="true" />
        ) : (
          <Download size={13} strokeWidth={1.9} color={INK.micro} aria-hidden="true" />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: INK.headingDark, whiteSpace: "nowrap" }}>
          Share &amp; export
        </span>
        <ChevronDown
          size={10}
          strokeWidth={2.2}
          color={INK.micro}
          aria-hidden="true"
          style={{ transition: "transform 200ms ease", transform: `rotate(${open ? 180 : 0}deg)` }}
        />
      </button>

      <div
        role="menu"
        aria-hidden={!open}
        style={{
          position: "absolute",
          right: 0,
          top: 42,
          zIndex: 80,
          width: 340,
          border: `1px solid ${INK.hairlineDark}`,
          borderRadius: 12,
          background: PANEL_BG,
          boxShadow: "0 18px 44px rgba(2,6,23,.6)",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          transformOrigin: "100% 0",
          transition: "opacity 180ms ease, transform 200ms cubic-bezier(.2,.8,.2,1)",
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0) scale(1)" : "translateY(-6px) scale(.96)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <span style={{ ...SECTION_LABEL, padding: "8px 12px 4px" }}>Download</span>
        <MenuItem
          colour={INK.link}
          icon={<FileText size={13} strokeWidth={1.9} />}
          title="This report as PDF"
          detail={disabledReason ?? currentTitle}
          disabled={!canDownloadCurrent || downloading}
          onClick={() => {
            setOpen(false);
            onDownloadCurrent();
          }}
        />
        <MenuItem
          colour={INK.link}
          icon={<Files size={13} strokeWidth={1.9} />}
          title={readyCount === 1 ? "The one ready report" : `All ${readyCount} ready reports`}
          detail={
            disabledReason ??
            (readyCount === 0
              ? "Nothing has finished generating yet"
              : "Downloads each one in turn, in reading order")
          }
          disabled={Boolean(disabledReason) || readyCount === 0 || downloading}
          onClick={() => {
            setOpen(false);
            onDownloadAll();
          }}
        />

        <span aria-hidden="true" style={{ height: 1, background: INK.hairlineDark, margin: "6px 4px" }} />
        <span style={{ ...SECTION_LABEL, padding: "4px 12px" }}>Share a link · no login required</span>
        <MenuItem
          colour={BRAND.teal}
          icon={<Eye size={13} strokeWidth={1.9} />}
          title="Send for review"
          badge="Soon"
          detail="Findings, scores and every report. No pricing, no commercial terms."
          disabled
        />
        <MenuItem
          colour={SEVERITY_ON_DARK.attention}
          icon={<ShoppingCart size={13} strokeWidth={1.9} />}
          title="Send to purchasing"
          badge="Soon"
          detail="Adds the statement of work, the agreed scope and the totals."
          disabled
        />
        <p
          style={{
            margin: "2px 4px 4px",
            padding: "0 8px",
            fontSize: 10.5,
            fontWeight: 500,
            lineHeight: 1.5,
            color: INK.micro,
          }}
        >
          Sharing a whole set outside your tenant is not switched on yet. Until it is, the PDFs above are
          yours to forward.
        </p>
      </div>
    </div>
  );
}
