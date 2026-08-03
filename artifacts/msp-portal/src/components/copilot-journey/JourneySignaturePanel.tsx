/**
 * JourneySignaturePanel.tsx — the platform's drawn-signature panel, lifted into
 * a real component and restyled for the dark SOW surface.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The handoff says to restyle the platform's EXISTING e-signature panel rather
 * than build a new one. There is no such shared component: the identical
 * drawn-canvas `SignatureCanvas` is copy-pasted four times and none of the four
 * is exported —
 *
 *   • `pages/customer-sow.tsx:77`
 *   • `pages/msp-customer-sow.tsx:69`
 *   • `pages/msp-sow-public.tsx:72`
 *   • `components/assessment/AssessmentPaymentPlan.tsx:165`
 *
 * The fourth is the controlled variant (`onChange(dataUrl | null, name)`), which
 * is the better shape, so its internals are what this file lifts: a raw
 * `<canvas>` with a `ResizeObserver` width sync, a fixed 130px height, mouse AND
 * touch handlers, and `toDataURL("image/png")` as the emitted signature — the
 * wire contract every signing endpoint in this platform takes
 * (`{ signatureData, signerName }`). The four existing copies are left untouched;
 * they are now candidates for consolidation onto this one.
 *
 * NEVER FAKE A SIGNATURE. `pages/Checkout.tsx:519` in the marketing app posts a
 * hardcoded 1×1 transparent PNG to satisfy the endpoint's required field. That
 * is a signed agreement with nothing in the signature box, and it is not copied
 * here: this panel emits only what the customer actually drew, and the submit
 * stays disabled until they have.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { BRAND, INK, RADIUS } from "./journeyTokens.ts";

/** What a completed signature carries. Field names match the signing endpoints. */
export interface JourneySignature {
  readonly signerName: string;
  readonly role: string;
  /** `data:image/png;base64,…` — the drawn strokes, never a placeholder image. */
  readonly signatureData: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The platform's existing pads use a 130px fixed height. Kept identical. */
const CANVAS_HEIGHT = 130;

/**
 * Two inks, and the difference is not cosmetic.
 *
 * The pad sits on the SOW's near-black surface, so the live stroke has to be
 * light to be visible while drawing. But the emitted PNG is transparent and gets
 * stamped onto white in the countersigned document — where a light stroke would
 * be invisible. So the export replays the same captured points in the signature
 * navy the rest of the platform's signature images already use.
 */
const INK_ON_SCREEN = "#e2e8f0";
const INK_ON_PAPER = BRAND.navy;

const LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: INK.bodyDark,
};

const FIELD: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: RADIUS.control,
  padding: "9px 11px",
  fontSize: 13.5,
  fontWeight: 500,
  color: "#f1f5f9",
  outline: "none",
};

export function JourneySignaturePanel({
  tenantName,
  submitting = false,
  onSign,
  onChange,
}: {
  /** Named in the authorisation sentence, so the customer signs for a real org. */
  readonly tenantName: string;
  readonly submitting?: boolean;
  readonly onSign: (signature: JourneySignature) => void;
  /**
   * Preserved from the controlled copy this component was lifted from: fires with
   * the complete signature, or `null` the moment any part of it is missing.
   */
  readonly onChange?: (signature: JourneySignature | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Captured strokes in canvas pixel space — the source for the paper-ink export. */
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  /**
   * Re-render the captured strokes on an offscreen canvas in paper ink and hand
   * back the PNG. Same `toDataURL("image/png")` contract as the four existing
   * copies — only the ink differs, for the reason above.
   */
  const exportSignature = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || strokesRef.current.length === 0) return null;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.strokeStyle = INK_ON_PAPER;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokesRef.current.forEach((stroke) => {
      if (stroke.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      stroke.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      // A single tap is a dot, not a line — stroke it as a degenerate segment so
      // it still lands in the export.
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y);
      ctx.stroke();
    });
    return out.toDataURL("image/png");
  }, []);

  const emit = useCallback(() => {
    setSignatureData(exportSignature());
  }, [exportSignature]);

  // Width sync. The canvas's backing store must match its CSS width or the
  // strokes land offset from the pointer; a ResizeObserver is what keeps that
  // true when the rail reflows. Resizing clears — the captured points are in the
  // old pixel space, and rescaling a signature is editing it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;
    const resize = () => {
      const { width } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width)) {
        canvas.width = Math.round(width);
        canvas.height = CANVAS_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokesRef.current = [];
        setIsEmpty(true);
        setSignatureData(null);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const complete: JourneySignature | null =
    signatureData && name.trim() && role.trim()
      ? { signerName: name.trim(), role: role.trim(), signatureData }
      : null;

  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    changeRef.current?.(complete);
    // `complete` is rebuilt every render; the three values it derives from are
    // the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureData, name, role]);

  function getPos(e: React.MouseEvent | React.TouchEvent): Point | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return null;
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = INK_ON_SCREEN;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    strokesRef.current = [...strokesRef.current, [pos]];
    drawingRef.current = true;
    setIsEmpty(false);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const last = stroke?.[stroke.length - 1];
    if (!ctx || !stroke || !last) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    stroke.push(pos);
  }

  function stopDrawing() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emit();
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    drawingRef.current = false;
    setIsEmpty(true);
    setSignatureData(null);
  }

  const ready = complete !== null && agreed && !submitting;

  return (
    <div
      style={{
        border: `1px solid ${INK.hairlineDark}`,
        borderRadius: RADIUS.panel,
        background: "rgba(15,23,42,.6)",
        padding: "20px 20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          Authorise this scope
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: INK.headingDark,
          }}
        >
          Electronic signature
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>Full name</span>
          <input
            className="cj-input"
            type="text"
            value={name}
            disabled={submitting}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full legal name"
            style={FIELD}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>Role</span>
          <input
            className="cj-input"
            type="text"
            value={role}
            disabled={submitting}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. IT Director"
            style={FIELD}
          />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <span style={LABEL}>Signature</span>
            <button
              type="button"
              onClick={clearCanvas}
              disabled={isEmpty || submitting}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 11,
                fontWeight: 600,
                color: isEmpty ? INK.deemphasised : INK.link,
                cursor: isEmpty ? "default" : "pointer",
              }}
            >
              Clear
            </button>
          </span>
          <div
            ref={containerRef}
            style={{
              position: "relative",
              border: "1px dashed rgba(51,65,85,.9)",
              borderRadius: 8,
              background: "rgba(2,6,23,.7)",
              // Without this a touch drag scrolls the page instead of drawing.
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                width: "100%",
                height: `${CANVAS_HEIGHT}px`,
                borderRadius: 8,
                cursor: "crosshair",
              }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            {isEmpty ? (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 500,
                  color: INK.deemphasised,
                  pointerEvents: "none",
                }}
              >
                Draw your signature here
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={agreed}
        onClick={() => setAgreed((v) => !v)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          background: "none",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `1px solid ${agreed ? BRAND.teal : "rgba(71,85,105,.9)"}`,
            background: agreed ? BRAND.teal : "transparent",
            flex: "none",
            marginTop: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 180ms,border-color 180ms",
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={BRAND.canvas}
            strokeWidth="3.4"
            strokeLinecap="round"
            style={{ opacity: agreed ? 1 : 0 }}
            aria-hidden="true"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDark }}>
          I am authorised to approve this scope for {tenantName} and accept the attached terms.
        </span>
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {/* The checkbox gates the button exactly as the design specifies: dimmed
            and inert until it is ticked. The `disabled` beneath it is the second
            gate, and it is the one that cannot be defeated — a ticked box with an
            empty pad must not produce a signed agreement. */}
        <div style={{ opacity: agreed ? 1 : 0.45, pointerEvents: agreed ? "auto" : "none" }}>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              if (complete) onSign(complete);
            }}
            style={{
              width: "100%",
              height: 44,
              borderRadius: RADIUS.control,
              border: "none",
              background: BRAND.blue,
              color: BRAND.white,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              cursor: ready ? "pointer" : "not-allowed",
              opacity: !agreed || ready ? 1 : 0.55,
              transition: "opacity 180ms,background 180ms",
            }}
          >
            {submitting
              ? "Preparing your scope…"
              : agreed
                ? "Sign and return this scope"
                : "Confirm authorisation to sign"}
          </button>
        </div>
        {agreed && complete === null ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.5,
              color: INK.micro,
              textAlign: "center",
            }}
          >
            Add your name, your role and a drawn signature to continue.
          </span>
        ) : null}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.5,
            color: INK.micro,
            textAlign: "center",
          }}
        >
          Countersigned by Shane McCaw. Payment is arranged after signature, not before.
        </span>
      </div>
    </div>
  );
}
