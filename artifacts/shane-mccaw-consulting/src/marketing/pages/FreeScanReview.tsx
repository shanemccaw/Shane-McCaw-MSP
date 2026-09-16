import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FreeScanFlowStrip } from "../components/FreeScanFlowStrip";
import { FREE_SCAN_SESSION_STORAGE_KEY } from "./FreeScan";
import { StripePaymentElement } from "../../components/StripePaymentElement";
import { logger } from "../../lib/logger";

/**
 * /scan/review — step 4 of the Free Scan flow (Git #1374, Phase of Feature #1352).
 *
 * The Statement of Work generated from this Prospect's own scan: a contract
 * artifact they set scope on, sign, and pay for, without ever holding a portal
 * session. Recreated from the confirmed design
 * `Design/marketing/marketing_handoff/Marketing Checkout.dc.html` (the `{{ open }}`
 * block at the top of that file's state chain).
 *
 * ── Every number on this page comes off the wire ──────────────────────────────
 * There is no fixture module behind this file and no price written into it. The
 * whole document is one payload from `POST /api/public/free-scan/sow/read`
 * (routes/public-free-scan-sow.ts → lib/free-scan-sow.ts), which computes it
 * from the tenant's real `buildPillarSummary` output and the real Products
 * Catalog rows for the six remediation phases. Toggling a phase re-reads the
 * whole document from the server rather than recalculating anything here — the
 * totals on screen are always the totals the server would charge.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────
 * A Free Scan Prospect has no password and no JWT (#656). This page resolves the
 * same two doors #1358 and #1359 already serve: the live flow's checkout
 * sessionId (parked in sessionStorage by FreeScan.tsx so it survives the
 * navigation — never put on the URL) or the emailed return-link token. Both are
 * sent in a request BODY, never a query string.
 *
 * ── Deliberately NOT built here ───────────────────────────────────────────────
 * The post-payment account creation (`acctScreen`) and write-consent
 * (`writeStage`) blocks of the same design file are #1375 and the existing
 * Buy.tsx checkout account flow respectively. This page ends at a confirmed
 * payment.
 */

const log = logger.child({ channel: "billing" });

// ── The wire shape `POST /api/public/free-scan/sow/read` returns ──────────────
// Mirrors lib/free-scan-sow.ts's `FreeScanSow`. Kept as an explicit local
// interface rather than a shared package because the marketing site and the
// api-server are independent apps with no shared type surface between them.

interface SowPhase {
  slug: string;
  order: number;
  name: string;
  description: string | null;
  pillar: string;
  pillarLabel: string;
  accentColor: string;
  required: boolean;
  selected: boolean;
  feeCents: number;
  durationWeeks: number;
  deliverables: string[];
  requiresChangeWindow: boolean;
  findingCount: number;
  criticalCount: number;
  addresses: string[];
  pillarScoreNow: number | null;
  pillarScoreProjected: number | null;
  startWeek: number | null;
}

interface SowAddonTier {
  serviceSlug: string;
  label: string;
  oneOffCents: number;
  monthlyCents: number;
  detail: string | null;
}

interface SowAddon {
  key: string;
  name: string;
  blurb: string;
  tierLabel: string;
  tiers: SowAddonTier[];
  selected: boolean;
  selectedServiceSlug: string | null;
}

interface SowPillarLine {
  pillar: string;
  label: string;
  accentColor: string;
  findingCount: number;
  scoreNow: number | null;
  findingTitles: string[];
  inScope: boolean;
}

interface SowFindingLine {
  pillar: string;
  pillarLabel: string;
  severity: "critical" | "warning";
  title: string;
}

interface Sow {
  reference: string;
  customerName: string;
  scanGeneratedAt: string;
  daysSinceScan: number;
  scannedCheckCount: number;
  quoteValidUntil: string;
  readiness: {
    now: number | null;
    projected: number | null;
    threshold: number;
    evaluationStatus: string;
    evaluationReason: string;
  };
  totals: {
    totalFindings: number;
    criticalFindings: number;
    findingsInScope: number;
    annualWasteDollars: number | null;
    phasesSelected: number;
    phaseCount: number;
    weeksToCertification: number;
    weeksToCopilotEnablement: number;
    deliverableCount: number;
    changeWindowCount: number;
    servicesGrossCents: number;
    servicesFullPlanCents: number;
    depositCents: number;
    chargedNowCents: number;
    recurringMonthlyCents: number;
    addonOneOffCents: number;
    discountApplies: boolean;
    discountPct: number;
    depositPct: number;
  };
  phases: SowPhase[];
  addons: SowAddon[];
  pillars: SowPillarLine[];
  gateBlockers: SowFindingLine[];
  selection: {
    phaseSlugs: string[];
    addons: Array<{ key: string; serviceSlug: string }>;
    paymentPlan: "full" | "phased";
  };
  signature: {
    signed: boolean;
    signedAt: string | null;
    signerName: string | null;
    signerRole: string | null;
  };
  status: "draft" | "signed" | "paid";
}

type SowResponse = { status: "ready"; sow: Sow } | { status: "scanning"; activeRunId: string | null };

interface PaymentIntentResponse {
  clientSecret: string;
  publishableKey: string;
  paymentIntentId: string;
  amountCents: number;
  paymentPlan: "full" | "phased";
  recurringMonthlyCents: number;
  alreadyPaid: boolean;
}

// ── Credential ────────────────────────────────────────────────────────────────

type Credential = { sessionId: string } | { returnToken: string };

const RETURN_TOKEN_STORAGE_KEY = "freeScanReturnToken";

function readCredential(): Credential | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get("sessionId");
  if (fromQuery) return { sessionId: fromQuery };
  try {
    const stored = sessionStorage.getItem(FREE_SCAN_SESSION_STORAGE_KEY);
    if (stored) return { sessionId: stored };
    const token = sessionStorage.getItem(RETURN_TOKEN_STORAGE_KEY);
    if (token) return { returnToken: token };
  } catch {
    // Storage blocked — handled by the caller's "we lost track of your scan" state.
  }
  return null;
}

// ── Formatting ────────────────────────────────────────────────────────────────

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const moneyDollars = (dollars: number) => `$${Math.round(dollars).toLocaleString("en-US")}`;
const weeks = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// ── Small inline icons, matching FreeScan.tsx's own style ─────────────────────

const icon = (children: React.ReactNode, size: number, stroke = "currentColor") => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const iconDoc = (size: number) =>
  icon(<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14h6M9 17.5h4" />, size, "#00B4D8");
const iconLock = (size: number) =>
  icon(
    <>
      <rect x={4} y={11} width={16} height={10} rx={2} />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>,
    size,
  );
const iconClock = (size: number) =>
  icon(
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5l3 2" />
    </>,
    size,
  );
const iconTick = (size: number) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4L19 7" />
  </svg>
);
const iconArrowRight = (
  <svg width={16} height={8} viewBox="0 0 18 9" fill="none" stroke="#475569" strokeWidth={1.6} style={{ flex: "none" }}>
    <path d="M0 4.5h16M12 1l4 3.5-4 3.5" />
  </svg>
);

// ── Shared style fragments from the design ────────────────────────────────────

const SECTION: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const H2: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.015em", color: "#f8fafc" };
const STANDFIRST: React.CSSProperties = {
  margin: "-6px 0",
  padding: "6px 0",
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: "#cbd5e1",
  textWrap: "pretty" as React.CSSProperties["textWrap"],
};
const TABLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid rgba(30,41,59,.9)" };

function Row({ label, value, tone = "#cbd5e1", dimmed = false }: { label: string; value: React.ReactNode; tone?: string; dimmed?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px,1.1fr) minmax(0,1.9fr)",
        gap: 14,
        padding: "11px 10px",
        borderBottom: "1px solid rgba(30,41,59,.9)",
        alignItems: "baseline",
        transition: "opacity 260ms, filter 260ms",
        opacity: dimmed ? 0.4 : 1,
        filter: dimmed ? "blur(3px) grayscale(.6)" : "none",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: tone }}>{value}</span>
    </div>
  );
}

const PAY_INPUT: React.CSSProperties = {
  width: "100%",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: 7,
  padding: "9px 11px",
  fontSize: 13,
  color: "#f1f5f9",
  outline: "none",
  fontFamily: "inherit",
};

// ── The signature pad ─────────────────────────────────────────────────────────
// Real capture: a drawn signature is a PNG data URL off a canvas; a typed name
// is that same canvas with the name rendered into it. Either way what is stored
// server-side is a real image tied to the exact scope the customer saw.

function SignaturePad({
  typedName,
  onChange,
}: {
  typedName: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const drawnRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const paintTypedName = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawnRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const name = typedName.trim();
    if (!name) {
      setHasInk(false);
      onChange(null);
      return;
    }
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "italic 30px Georgia, 'Times New Roman', serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 14, canvas.height / 2);
    setHasInk(true);
    onChange(canvas.toDataURL("image/png"));
  }, [typedName, onChange]);

  useEffect(() => {
    paintTypedName();
  }, [paintTypedName]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!drawnRef.current) {
      // First real stroke replaces the typed rendering.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawnRef.current = true;
    }
    drawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pointFrom(e);
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pointFrom(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHasInk(true);
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawnRef.current = false;
    setHasInk(false);
    onChange(null);
    paintTypedName();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div
        style={{
          height: 60,
          border: "1px dashed rgba(51,65,85,.9)",
          borderRadius: 8,
          background: "rgba(2,6,23,.7)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          width={600}
          height={120}
          data-testid="freescan-review-signature-pad"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        />
        {!hasInk && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11.5,
              color: "#475569",
              pointerEvents: "none",
            }}
          >
            Draw or type to sign
          </span>
        )}
      </div>
      {hasInk && (
        <button
          type="button"
          onClick={clear}
          style={{
            alignSelf: "flex-end",
            padding: 0,
            border: 0,
            background: "none",
            fontFamily: "inherit",
            fontSize: 10.5,
            fontWeight: 600,
            color: "#60a5fa",
            cursor: "pointer",
          }}
        >
          Clear signature
        </button>
      )}
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────

export default function FreeScanReview() {
  const credentialRef = useRef<Credential | null>(null);
  if (credentialRef.current === null) credentialRef.current = readCredential();
  const credential = credentialRef.current;

  const [sow, setSow] = useState<Sow | null>(null);
  const [phase, setPhase] = useState<"loading" | "scanning" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const post = useCallback(
    async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
      if (!credential) throw new Error("no_credential");
      const res = await fetch(path, {
        method: path.endsWith("/scope") ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credential, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `request_failed_${res.status}`);
      return data;
    },
    [credential],
  );

  const applyResponse = useCallback((data: SowResponse) => {
    if (data.status === "ready") {
      setSow(data.sow);
      setPhase("ready");
      if (data.sow.signature.signerName) setSignerName(data.sow.signature.signerName);
      if (data.sow.signature.signerRole) setSignerRole(data.sow.signature.signerRole);
    } else {
      setPhase("scanning");
    }
  }, []);

  // Initial read.
  useEffect(() => {
    if (!credential) {
      setPhase("error");
      setErrorMessage(
        "We lost track of your scan. Open the results link we emailed you, or run a new free scan to pick this back up.",
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await post<SowResponse>("/api/public/free-scan/sow/read");
        if (!cancelled) applyResponse(data);
      } catch (err) {
        if (cancelled) return;
        log.error({ err }, "free-scan review: SOW read failed");
        setPhase("error");
        setErrorMessage(
          "We couldn't open your statement of work. Open the results link we emailed you, or run a new free scan.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credential, post, applyResponse]);

  // ── Scope writes ────────────────────────────────────────────────────────────
  // Every change is persisted server-side and the WHOLE document comes back
  // recomputed. Nothing is recalculated in the browser, so the figures on screen
  // are always the figures the server would charge.

  const writeScope = useCallback(
    async (next: { phaseSlugs: string[]; addons: Array<{ key: string; serviceSlug: string }>; paymentPlan: "full" | "phased" }) => {
      setSaving(true);
      setErrorMessage(null);
      try {
        const data = await post<SowResponse>("/api/public/free-scan/sow/scope", next);
        applyResponse(data);
      } catch (err) {
        log.error({ err }, "free-scan review: scope write failed");
        setErrorMessage("That scope change didn't save. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [post, applyResponse],
  );

  const currentSelection = useMemo(
    () =>
      sow
        ? { phaseSlugs: [...sow.selection.phaseSlugs], addons: [...sow.selection.addons], paymentPlan: sow.selection.paymentPlan }
        : null,
    [sow],
  );

  const togglePhase = (slug: string) => {
    if (!sow || !currentSelection || sow.signature.signed) return;
    const phaseRow = sow.phases.find((p) => p.slug === slug);
    if (!phaseRow || phaseRow.required) return;
    const phaseSlugs = phaseRow.selected
      ? currentSelection.phaseSlugs.filter((s) => s !== slug)
      : [...currentSelection.phaseSlugs, slug];
    void writeScope({ ...currentSelection, phaseSlugs });
  };

  const toggleAddon = (addon: SowAddon) => {
    if (!sow || !currentSelection || sow.signature.signed) return;
    const addons = addon.selected
      ? currentSelection.addons.filter((a) => a.key !== addon.key)
      : [...currentSelection.addons, { key: addon.key, serviceSlug: addon.selectedServiceSlug ?? addon.tiers[0]!.serviceSlug }];
    void writeScope({ ...currentSelection, addons });
  };

  const pickTier = (addon: SowAddon, serviceSlug: string) => {
    if (!sow || !currentSelection || sow.signature.signed) return;
    const addons = [...currentSelection.addons.filter((a) => a.key !== addon.key), { key: addon.key, serviceSlug }];
    void writeScope({ ...currentSelection, addons });
  };

  const pickPlan = (paymentPlan: "full" | "phased") => {
    if (!sow || !currentSelection || sow.signature.signed) return;
    if (currentSelection.paymentPlan === paymentPlan) return;
    void writeScope({ ...currentSelection, paymentPlan });
  };

  // ── Signature ───────────────────────────────────────────────────────────────

  const canSign = signerName.trim().length >= 2 && signerRole.trim().length >= 2 && !!signatureData && agreed;

  const sign = async () => {
    if (!canSign || saving) return;
    setSaving(true);
    setSignError(null);
    try {
      const data = await post<SowResponse>("/api/public/free-scan/sow/sign", {
        signerName: signerName.trim(),
        signerRole: signerRole.trim(),
        signatureData,
        agreed: true,
      });
      applyResponse(data);
    } catch (err) {
      log.error({ err }, "free-scan review: signature failed");
      setSignError("We couldn't record that signature. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Payment ─────────────────────────────────────────────────────────────────

  const confirmPayment = useCallback(
    async (paymentIntentId: string) => {
      const data = await post<SowResponse>("/api/public/free-scan/sow/payment-confirmed", { paymentIntentId });
      applyResponse(data);
    },
    [post, applyResponse],
  );

  // Mint the intent as soon as the document is signed and not yet paid.
  useEffect(() => {
    if (!sow || !sow.signature.signed || sow.status === "paid" || intent) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await post<PaymentIntentResponse>("/api/public/free-scan/sow/payment-intent");
        if (cancelled) return;
        if (data.alreadyPaid) {
          // Paid, then reloaded before the confirm callback landed — go straight to confirming.
          await confirmPayment(data.paymentIntentId);
          return;
        }
        setIntent(data);
      } catch (err) {
        if (cancelled) return;
        log.error({ err }, "free-scan review: payment intent failed");
        setPayError(
          err instanceof Error && err.message === "payment_unavailable"
            ? "Card payment isn't available right now. Shane will follow up to take payment directly."
            : "We couldn't start the payment. Please refresh and try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sow, intent, post, confirmPayment]);

  // ── Non-document states ─────────────────────────────────────────────────────

  if (phase !== "ready" || !sow) {
    return (
      <div style={{ background: "#020617", color: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh" }}>
        <FreeScanFlowStrip at={3} />
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "#f8fafc" }}>
            {phase === "scanning" ? "Your scan is still running" : phase === "error" ? "We couldn't open your statement of work" : "Building your statement of work"}
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "#94a3b8" }}>
            {phase === "scanning"
              ? "The statement of work is generated from your findings, so it waits for the scan to finish. Come back to this page in a few minutes."
              : errorMessage ?? "One moment."}
          </p>
          <a href="/scan" style={{ fontSize: 13.5, fontWeight: 600, color: "#60a5fa" }}>
            Back to your scan
          </a>
        </div>
      </div>
    );
  }

  const t = sow.totals;
  const signed = sow.signature.signed;
  const paid = sow.status === "paid";
  const projected = sow.readiness.projected;
  const gatePasses = projected !== null && projected >= sow.readiness.threshold;
  const projColor = projected === null ? "#94a3b8" : gatePasses ? "#34d399" : projected >= 60 ? "#fbbf24" : "#f87171";
  const chartWeeks = Math.max(t.weeksToCertification, 1);

  const planTotalCents = sow.selection.paymentPlan === "full" ? t.servicesFullPlanCents : t.servicesGrossCents;

  return (
    <div
      style={{ background: "#020617", color: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh" }}
      data-testid="freescan-review"
    >
      <FreeScanFlowStrip at={3} />

      <div
        style={{
          maxWidth: 1420,
          margin: "0 auto",
          padding: "0 32px",
          display: "flex",
          gap: "0 34px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* ── The document ───────────────────────────────────────────────────── */}
        <div style={{ flex: "4 1 480px", minWidth: 0, padding: "26px 6px 60px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, borderBottom: "1px solid rgba(30,41,59,.9)", paddingBottom: 24 }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".22em",
                  textTransform: "uppercase",
                  color: "#60a5fa",
                }}
                data-testid="freescan-review-reference"
              >
                {iconDoc(14)}
                Statement of work · {sow.reference}
              </span>
              <h1 style={{ margin: 0, fontSize: "clamp(24px,2.8vw,31px)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.2, color: "#f8fafc" }}>
                Copilot Gate clearance for {sow.customerName}
              </h1>
              <p style={STANDFIRST}>
                A contract artifact, generated from your free scan of {longDate(sow.scanGeneratedAt)}. Every finding,
                figure and phase below is carried from that scan — nothing here is authored for presentation. Set your
                scope in the panel alongside and this document follows it.
              </p>
            </div>

            {/* 1 · Scope & Objective */}
            <div style={SECTION}>
              <h2 style={H2}>1 · Scope &amp; Objective</h2>
              <p style={STANDFIRST}>
                The objective of this engagement is to clear the Copilot Gate for {sow.customerName} — moving readiness{" "}
                {sow.readiness.now === null ? "to" : `from ${sow.readiness.now} to`} at or above the{" "}
                {sow.readiness.threshold} threshold — by remediating the {t.totalFindings} findings surfaced in the free
                scan of {longDate(sow.scanGeneratedAt)}.
              </p>
              <div style={TABLE}>
                <Row
                  label="The objective"
                  tone="#34d399"
                  value={
                    sow.readiness.now === null
                      ? `Copilot Gate clearance · ${sow.readiness.threshold} minimum`
                      : `Copilot Gate clearance · readiness ${sow.readiness.now} → ${sow.readiness.threshold} minimum`
                  }
                />
                <Row
                  label="Findings carried into scope"
                  tone="#f87171"
                  value={`${t.totalFindings} findings across ${sow.pillars.filter((p) => p.findingCount > 0).length} pillars · ${t.criticalFindings} of them gate blockers`}
                />
                <Row
                  label="Why this matters"
                  value="Copilot inherits every permission, label and licence state on day one. Enabling it against the current configuration extends a known identity and exposure gap into a conversational interface across your whole estate."
                />
                <Row
                  label="Basis of scope"
                  tone="#94a3b8"
                  value={`Read-only Microsoft Graph scan · ${sow.scannedCheckCount} signal derivation checks · no configuration altered`}
                />
              </div>
            </div>

            {/* 2 · Approach & Sequence */}
            <div style={SECTION}>
              <h2 style={H2}>2 · Approach &amp; Sequence</h2>
              <p style={STANDFIRST}>
                Work follows the dependency order established in the Full Remediation Guide. Identity lands before
                anything is exposed to Copilot; drift telemetry lands last so it baselines the remediated state rather
                than the starting point.
              </p>
              <div style={TABLE}>
                <Row
                  label="Critical path"
                  tone="#fbbf24"
                  value={`${weeks(t.weeksToCertification)} to certification · ${weeks(t.weeksToCopilotEnablement)} to Copilot enablement`}
                />
                <Row
                  label="Phases in parallel"
                  value="Phases 1–3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites"
                />
                <Row
                  label="Strictly sequential"
                  value="Phases 4–6 · enablement cannot precede validation, certification cannot precede either"
                />
                <Row
                  label="Change windows"
                  tone="#fbbf24"
                  value={
                    t.changeWindowCount
                      ? `${t.changeWindowCount} change window${t.changeWindowCount === 1 ? "" : "s"} required · not yet scheduled — ${sow.phases
                          .filter((p) => p.selected && p.requiresChangeWindow)
                          .map((p) => p.name)
                          .join(" and ")}`
                      : "No change windows required on this scope"
                  }
                />
                <Row
                  label="Change control"
                  tone="#34d399"
                  value="Conditional Access and DLP changes enter report-only or review mode first. No enforcement without an observation period."
                />
              </div>
            </div>

            {/* 3 · SOW Telemetry */}
            <div style={SECTION}>
              <h2 style={H2}>3 · Statement of Work Telemetry</h2>
              <div style={TABLE}>
                <Row label="Findings in scope" value={`${t.findingsInScope} of ${t.totalFindings} findings addressed by the selected phases`} />
                <Row
                  label="Objective target"
                  tone="#fbbf24"
                  value={
                    projected === null
                      ? `Copilot Gate at ${sow.readiness.threshold} · ${sow.readiness.evaluationReason}`
                      : `Copilot Gate at ${sow.readiness.threshold} · projected ${projected} on this scope`
                  }
                />
                <Row label="Elapsed time since the scan" tone="#94a3b8" value={`${sow.daysSinceScan} ${sow.daysSinceScan === 1 ? "day" : "days"}`} />
                <Row label="Critical path duration" value={`${weeks(t.weeksToCertification)} from kickoff to certification`} />
                <Row
                  label="Change window status"
                  tone="#fbbf24"
                  value={
                    t.changeWindowCount
                      ? `${t.changeWindowCount} change window${t.changeWindowCount === 1 ? "" : "s"} required · not yet scheduled`
                      : "No change windows required on this scope"
                  }
                />
                <Row
                  label="Telemetry source"
                  tone="#94a3b8"
                  value={`Microsoft Graph API · read-only delegated permissions · ${longDate(sow.scanGeneratedAt)}`}
                />
              </div>
            </div>

            {/* 4 · Commercial Terms */}
            <div style={SECTION}>
              <h2 style={H2}>4 · Commercial Terms</h2>
              <div style={TABLE}>
                <Row label="Professional services" tone="#f8fafc" value={`${money(planTotalCents)} fixed fee, phase by phase`} />
                {t.annualWasteDollars !== null && (
                  <Row
                    label="Licence waste recovered"
                    tone="#34d399"
                    value={`${moneyDollars(t.annualWasteDollars)} a year, available from month one`}
                  />
                )}
                {t.annualWasteDollars !== null && (
                  <Row
                    label="Net year one impact"
                    value={`${moneyDollars(t.annualWasteDollars - Math.round(planTotalCents / 100))} net, after ${moneyDollars(
                      t.annualWasteDollars,
                    )} of recovered licence waste`}
                  />
                )}
                <Row
                  label="Payment terms"
                  value={`${t.depositPct}% deposit at signature · balance invoiced per phase on your sign-off · 14 days net · or ${t.discountPct}% off when the full scope is paid up front`}
                />
                <Row
                  label="Validity"
                  tone="#94a3b8"
                  value={`Quoted pricing holds until ${longDate(sow.quoteValidUntil)}, after which a fresh scan is required`}
                />
              </div>
            </div>

            {/* 5 · Governance Gate Status */}
            <div style={SECTION}>
              <h2 style={H2}>5 · Governance Gate Status</h2>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "16px 30px",
                  alignItems: "center",
                  padding: "16px 18px",
                  border: `1px solid ${gatePasses ? "rgba(52,211,153,.35)" : "rgba(248,113,113,.35)"}`,
                  borderRadius: 12,
                  background: gatePasses ? "rgba(52,211,153,.07)" : "rgba(248,113,113,.07)",
                  transition: "border-color 400ms, background 400ms",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: "#94a3b8" }}>
                    Copilot Gate
                  </span>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: gatePasses ? "#34d399" : "#f87171",
                    }}
                    data-testid="freescan-review-gate-label"
                  >
                    {gatePasses ? "Passing on this scope" : "Not safe yet"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: "#94a3b8" }}>
                    Gate percentage
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: gatePasses ? "#34d399" : "#f87171", fontVariantNumeric: "tabular-nums" }}>
                    {sow.readiness.now === null ? sow.readiness.evaluationReason : `${sow.readiness.now} of 100 today`}
                    {projected === null ? "" : ` · ${projected} on this scope`} · {sow.readiness.threshold} is safe to
                    deploy
                  </span>
                </div>
              </div>
              {sow.gateBlockers.length > 0 ? (
                <div style={TABLE}>
                  {sow.gateBlockers.map((b, i) => (
                    <Row
                      key={`${b.pillar}-${i}`}
                      label={`Unsafe · ${b.pillarLabel}`}
                      tone="#f87171"
                      value={b.title}
                      dimmed={!sow.pillars.find((p) => p.pillar === b.pillar)?.inScope}
                    />
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8" }}>
                  Your scan raised no gate blockers. The findings below are still real and still in scope — none of them
                  is holding the gate shut on its own.
                </p>
              )}
            </div>

            {/* 6 · Section-by-Section Deliverable Summary */}
            <div style={SECTION}>
              <h2 style={H2}>6 · Section-by-Section Deliverable Summary</h2>
              <div style={TABLE}>
                <Row label="1 · Scope & Objective" value={`${t.totalFindings} findings carried into scope · deliverable: agreed objective and gate target`} />
                <Row
                  label="2 · Approach & Sequence"
                  value={`Dependency order and ${t.changeWindowCount} change window${t.changeWindowCount === 1 ? "" : "s"} · deliverable: signed sequence plan`}
                />
                <Row label="3 · SOW Telemetry" value={`${sow.scannedCheckCount} signal checks · deliverable: re-scan evidence per phase sign-off`} />
                <Row label="4 · Commercial Terms" value={`${money(planTotalCents)} · deliverable: fixed-fee delivery against agreed phases`} />
                <Row
                  label="5 · Governance Gate Status"
                  value={`${t.criticalFindings} findings holding it below the threshold · deliverable: gate validation and readiness certification`}
                />
                <Row
                  label="7 · Findings by Pillar"
                  value={`${t.totalFindings} findings across ${sow.pillars.filter((p) => p.findingCount > 0).length} pillars · deliverable: full traceability from every finding to the phase that clears it`}
                />
                <Row
                  label="8 · Phase Breakdown & Scope"
                  value={`${t.phasesSelected} of ${t.phaseCount} phases in scope · deliverable: ${t.findingsInScope} findings remediated, verified and signed off`}
                />
              </div>
            </div>

            {/* 7 · Findings by Pillar */}
            <div style={SECTION}>
              <h2 style={H2}>7 · Findings by Pillar (Carried Into Scope)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sow.pillars.map((p) => (
                  <div
                    key={p.pillar}
                    data-testid={`freescan-review-pillar-${p.pillar}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(120px,auto) minmax(0,1fr)",
                      gap: 14,
                      padding: "11px 12px",
                      border: "1px solid rgba(30,41,59,.9)",
                      borderLeft: `2px solid ${p.accentColor}`,
                      borderRadius: 9,
                      background: "rgba(15,23,42,.4)",
                      alignItems: "baseline",
                      transition: "opacity 260ms, filter 260ms",
                      opacity: p.inScope ? 1 : 0.4,
                      filter: p.inScope ? "none" : "blur(3px) grayscale(.6)",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: p.accentColor, flex: "none" }} />
                      {p.label}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: "#cbd5e1" }}>
                      {p.findingCount} {p.findingCount === 1 ? "finding" : "findings"}
                      {p.findingTitles.length > 0 ? ` · ${p.findingTitles.slice(0, 5).join(", ")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8" }}>
                Every finding above traces to a named check in the scan. Nothing in this scope was authored — it is the
                scan output, carried forward.
              </p>
            </div>

            {/* Delivery timeline */}
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <h2 style={H2}>Delivery Timeline &amp; Deliverables</h2>
              <p style={STANDFIRST}>
                Phases 1 to 3 overlap by design — Compliance labelling begins while Governance sharing work continues,
                since both touch the same sites. Phases 4 to 6 are strictly sequential. The schedule below recalculates
                as you set scope.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 26px", alignItems: "baseline" }}>
                {[
                  { label: "Critical path", value: weeks(t.weeksToCertification), color: "#f8fafc" },
                  { label: "Copilot enablement", value: weeks(t.weeksToCopilotEnablement), color: "#00B4D8" },
                  { label: "Deliverables", value: `${t.deliverableCount} artifacts`, color: "#f8fafc" },
                  {
                    label: "Change windows",
                    value: `${t.changeWindowCount} ${t.changeWindowCount === 1 ? "window" : "windows"}`,
                    color: "#fbbf24",
                  },
                ].map((m) => (
                  <span key={m.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase", color: "#94a3b8" }}>
                      {m.label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</span>
                  </span>
                ))}
              </div>
              <div style={TABLE}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.05fr) minmax(0,2fr)", gap: 14, padding: "8px 0 6px" }}>
                  <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
                    Phase &amp; deliverables
                  </span>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".12em", color: "#64748b" }}>
                        W{Math.round((i * chartWeeks) / 4)}
                      </span>
                    ))}
                  </div>
                </div>
                {sow.phases.map((p) => {
                  const live = p.selected && p.startWeek !== null;
                  return (
                    <div
                      key={p.slug}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(150px,1.05fr) minmax(0,2fr)",
                        gap: 14,
                        alignItems: "center",
                        padding: "9px 0",
                        borderBottom: "1px solid rgba(30,41,59,.9)",
                        transition: "opacity 260ms",
                        opacity: live ? 1 : 0.34,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: p.accentColor, flex: "none" }} />
                          {p.name}
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.45, color: "#94a3b8" }}>
                          {p.deliverables.join(", ")}
                        </span>
                      </div>
                      <div
                        style={{
                          position: "relative",
                          height: 26,
                          borderRadius: 5,
                          background: "rgba(2,6,23,.55)",
                          border: "1px solid rgba(30,41,59,.9)",
                          overflow: "hidden",
                        }}
                      >
                        {live && (
                          <div
                            style={{
                              position: "absolute",
                              top: 4,
                              bottom: 4,
                              left: `${((p.startWeek ?? 0) / chartWeeks) * 100}%`,
                              width: `${(p.durationWeeks / chartWeeks) * 100}%`,
                              borderRadius: 4,
                              background: p.accentColor,
                              opacity: 0.9,
                              transition: "left 320ms ease, width 320ms ease, opacity 260ms",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              padding: "0 7px 0 0",
                              boxSizing: "border-box",
                            }}
                          >
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(2,6,23,.85)", whiteSpace: "nowrap" }}>
                              {p.durationWeeks} {p.durationWeeks === 1 ? "wk" : "wks"}
                            </span>
                          </div>
                        )}
                        {!live && (
                          <span
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "flex",
                              alignItems: "center",
                              paddingLeft: 9,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: ".12em",
                              textTransform: "uppercase",
                              color: "#64748b",
                            }}
                          >
                            Out of scope
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p
                style={{
                  margin: "4px 0 0",
                  padding: "12px 14px",
                  border: "1px solid rgba(251,191,36,.28)",
                  borderLeft: "2px solid #fbbf24",
                  borderRadius: 8,
                  background: "rgba(251,191,36,.06)",
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: 1.6,
                  color: "#94a3b8",
                  maxWidth: "70ch",
                }}
              >
                Indicative schedule. Durations assume your team is available for scheduled sessions, that change windows
                are approved and booked when requested, and that access and licence decisions are returned within five
                working days. Internal approval cycles, procurement, freeze periods and third-party application owners
                are the usual causes of slippage and sit outside our control. Dates are confirmed at kickoff and
                re-baselined in writing if any of the above shifts.
              </p>
            </div>

            {/* 8 · Phase Breakdown & Scope */}
            <div style={SECTION}>
              <h2 style={H2}>8 · Phase Breakdown &amp; Scope</h2>
              <p style={STANDFIRST}>
                Phase 1 is required and cannot be removed — it is the identity work that must land before Copilot is
                enabled for anyone. The remaining five are your scope decision, set in the panel alongside, and the
                totals below move with them.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sow.phases.map((p) => (
                  <div
                    key={p.slug}
                    data-testid={`freescan-review-phase-card-${p.slug}`}
                    style={{
                      border: `1px solid ${p.selected ? "rgba(30,41,59,.95)" : "rgba(30,41,59,.7)"}`,
                      borderLeft: `3px solid ${p.accentColor}`,
                      borderRadius: 11,
                      background: p.selected ? "rgba(15,23,42,.45)" : "rgba(15,23,42,.22)",
                      padding: "16px 18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 13,
                      transition: "border-color 200ms, background 200ms",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 240px", minWidth: 0, opacity: p.selected ? 1 : 0.42, transition: "opacity 200ms" }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 9.5,
                            fontWeight: 600,
                            letterSpacing: ".2em",
                            textTransform: "uppercase",
                            color: p.accentColor,
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: p.accentColor, flex: "none" }} />
                          Phase {p.order} · {p.pillarLabel}
                        </span>
                        <span style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-0.012em", color: "#f8fafc" }}>{p.name}</span>
                        {p.description && (
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8", maxWidth: "54ch" }}>
                            {p.description}
                          </p>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flex: "none" }}>
                        <span
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            letterSpacing: "-0.02em",
                            color: "#f8fafc",
                            fontVariantNumeric: "tabular-nums",
                            opacity: p.selected ? 1 : 0.42,
                            transition: "opacity 200ms",
                          }}
                          data-testid={`freescan-review-phase-fee-${p.slug}`}
                        >
                          {money(p.feeCents)}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "5px 10px",
                            border: `1px solid ${p.selected ? (p.required ? "rgba(0,180,216,.35)" : "rgba(52,211,153,.32)") : "rgba(71,85,105,.35)"}`,
                            borderRadius: 999,
                            background: p.selected ? (p.required ? "rgba(0,180,216,.1)" : "rgba(52,211,153,.08)") : "rgba(71,85,105,.14)",
                          }}
                        >
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 999,
                              background: p.selected ? (p.required ? "#22d3ee" : "#34d399") : "#94a3b8",
                              flex: "none",
                            }}
                          />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: ".14em",
                              textTransform: "uppercase",
                              color: p.selected ? (p.required ? "#22d3ee" : "#34d399") : "#94a3b8",
                            }}
                          >
                            {p.required ? "Required" : p.selected ? "In scope" : "Deferred"}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        paddingTop: 12,
                        borderTop: "1px solid rgba(30,41,59,.9)",
                        flexWrap: "wrap",
                        opacity: p.selected ? 1 : 0.42,
                        transition: "opacity 200ms",
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: "#94a3b8", maxWidth: "56ch" }}>
                        {p.addresses.length > 0
                          ? `Addresses: ${p.addresses.join(", ")}.`
                          : `No ${p.pillarLabel.toLowerCase()} findings were raised for this tenant — this phase establishes the baseline rather than closing a gap.`}
                      </span>
                      {p.pillarScoreNow !== null && p.pillarScoreProjected !== null && (
                        <span style={{ display: "flex", alignItems: "baseline", gap: 8, fontVariantNumeric: "tabular-nums", flex: "none" }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: p.pillarScoreNow >= 60 ? "#fbbf24" : "#f87171" }}>
                            {p.pillarScoreNow}
                          </span>
                          {iconArrowRight}
                          <span style={{ fontSize: 15, fontWeight: 800, color: p.pillarScoreProjected >= 70 ? "#34d399" : "#fbbf24" }}>
                            {p.pillarScoreProjected}
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#34d399" }}>
                            +{p.pillarScoreProjected - p.pillarScoreNow} {p.pillarLabel}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Optional add-ons */}
              {sow.addons.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20, borderTop: "1px dashed rgba(30,41,59,.9)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".22em", textTransform: "uppercase", color: "#94a3b8" }}>
                      Optional add-ons · not remediation
                    </span>
                    <p style={{ margin: "-6px 0", padding: "6px 0", maxWidth: "60ch", fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8" }}>
                      Nothing below remediates a finding, so none of it moves the gate score. These either keep the
                      readiness the phases above earn, or address how your people actually use Copilot once the gate is
                      clear.
                    </p>
                  </div>
                  {sow.addons.map((addon) => (
                    <div
                      key={addon.key}
                      style={{
                        border: `1px solid ${addon.selected ? "rgba(0,180,216,.28)" : "rgba(30,41,59,.7)"}`,
                        borderRadius: 11,
                        background: addon.selected ? "rgba(0,180,216,.05)" : "rgba(15,23,42,.22)",
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                        transition: "border-color 200ms, background 200ms",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 290px", minWidth: 0 }}>
                          <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em", color: "#f8fafc" }}>{addon.name}</span>
                          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8", maxWidth: "54ch" }}>
                            {addon.blurb}
                          </p>
                        </div>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "5px 10px",
                            border: `1px solid ${addon.selected ? "rgba(0,180,216,.35)" : "rgba(71,85,105,.35)"}`,
                            borderRadius: 999,
                            background: addon.selected ? "rgba(0,180,216,.1)" : "rgba(71,85,105,.14)",
                            flex: "none",
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: addon.selected ? "#22d3ee" : "#94a3b8" }}>
                            {addon.selected ? "In scope" : "Not taken"}
                          </span>
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: addon.selected ? 1 : 0.45, transition: "opacity 200ms" }}>
                        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase", color: "#94a3b8" }}>
                          {addon.tierLabel}
                        </span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9 }}>
                          {addon.tiers.map((tier) => {
                            const chosen = addon.selected && addon.selectedServiceSlug === tier.serviceSlug;
                            return (
                              <div
                                key={tier.serviceSlug}
                                onClick={() => pickTier(addon, tier.serviceSlug)}
                                data-testid={`freescan-review-addon-tier-${tier.serviceSlug}`}
                                style={{
                                  border: `1px solid ${chosen ? "rgba(0,180,216,.55)" : "rgba(30,41,59,.9)"}`,
                                  borderRadius: 10,
                                  background: chosen ? "rgba(0,180,216,.1)" : "rgba(2,6,23,.45)",
                                  padding: "12px 13px",
                                  cursor: signed ? "default" : "pointer",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 3,
                                  transition: "border-color 180ms, background 180ms",
                                }}
                              >
                                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: chosen ? "#22d3ee" : "#94a3b8" }}>
                                  {tier.label}
                                </span>
                                <span style={{ fontSize: 15.5, fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>
                                  {tier.monthlyCents > 0 ? `${money(tier.monthlyCents)}/mo` : money(tier.oneOffCents)}
                                </span>
                                {tier.detail && (
                                  <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.45, color: "#94a3b8" }}>{tier.detail}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals band */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "18px 34px",
                  alignItems: "flex-end",
                  padding: "16px 18px",
                  border: "1px solid rgba(0,120,212,.4)",
                  borderRadius: 12,
                  background: "linear-gradient(150deg,rgba(0,120,212,.12),rgba(15,23,42,.6))",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: "#94a3b8" }}>
                    Professional services total
                  </span>
                  <span
                    style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}
                    data-testid="freescan-review-services-total"
                  >
                    {money(planTotalCents)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>
                    {t.phasesSelected} of {t.phaseCount} phases in scope · approx. {weeks(t.weeksToCertification)}
                  </span>
                  {t.discountApplies && sow.selection.paymentPlan === "full" && (
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "#94a3b8", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>
                        {money(t.servicesGrossCents)}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>
                        −{t.discountPct}% paid in full, full scope
                      </span>
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: "#94a3b8" }}>Then, monthly</span>
                  <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.028em", lineHeight: 1.1, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>
                    {t.recurringMonthlyCents > 0 ? `${money(t.recurringMonthlyCents)}/mo` : "None selected"}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>
                    {sow.addons.filter((a) => a.selected).length > 0
                      ? `${sow.addons.filter((a) => a.selected).map((a) => a.name).join(" + ")}, cancel with 30 days`
                      : "No optional services in scope"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: "#94a3b8" }}>
                    Readiness delivered
                  </span>
                  {sow.readiness.now === null || projected === null ? (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", maxWidth: "34ch", lineHeight: 1.5 }}>
                      {sow.readiness.evaluationReason}
                    </span>
                  ) : (
                    <>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: "#f87171", fontVariantNumeric: "tabular-nums" }}>
                          {sow.readiness.now}
                        </span>
                        {iconArrowRight}
                        <span
                          style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", color: projColor, fontVariantNumeric: "tabular-nums" }}
                          data-testid="freescan-review-projected-readiness"
                        >
                          {projected}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: projColor }}>
                        {gatePasses ? `Clears the ${sow.readiness.threshold} gate` : `${sow.readiness.threshold - projected} points short of the gate`}
                      </span>
                    </>
                  )}
                </div>
                <p style={{ margin: 0, flex: "1 1 240px", fontSize: 12.5, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8" }}>
                  {t.phasesSelected === t.phaseCount
                    ? "Full scope: every finding the scan raised is remediated here."
                    : `${t.phaseCount - t.phasesSelected} phase${t.phaseCount - t.phasesSelected === 1 ? "" : "s"} deferred at your request.`}{" "}
                  Removing a phase is a scope decision, not a discount. The findings it addresses remain in your reports,
                  unremediated.
                </p>
              </div>
            </div>

            <p style={{ margin: 0, paddingTop: 20, borderTop: "1px solid rgba(30,41,59,.9)", fontSize: 12.5, fontWeight: 500, lineHeight: 1.6, color: "#94a3b8" }}>
              Assessed and scoped by Shane McCaw against the M365 governance framework he wrote as NASA&apos;s current
              Lead M365 Architect and distributed agency-wide. Read on {longDate(sow.scanGeneratedAt)} through the
              Microsoft Graph API with read-only delegated permissions.
            </p>
          </div>
        </div>

        {/* ── The rail ───────────────────────────────────────────────────────── */}
        <div style={{ flex: "1 1 330px", minWidth: 0, padding: "26px 2px 60px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Your scope */}
          <div
            style={{
              border: "1px solid rgba(30,41,59,.95)",
              borderRadius: 14,
              background: "#0b1524",
              padding: "16px 17px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
            data-testid="freescan-review-rail"
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}>Your scope</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }} data-testid="freescan-review-phase-count">
                {t.phasesSelected} of {t.phaseCount} phases
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sow.phases.map((p) => {
                const locked = p.required || signed;
                return (
                  <div
                    key={p.slug}
                    onClick={() => togglePhase(p.slug)}
                    data-testid={`freescan-review-rail-phase-${p.slug}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 10px",
                      borderRadius: 9,
                      background: p.selected ? "rgba(2,6,23,.5)" : "rgba(2,6,23,.3)",
                      transition: "opacity 180ms",
                      cursor: locked ? "default" : "pointer",
                      opacity: p.selected ? 1 : 0.55,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        flex: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background 180ms, border-color 180ms",
                        background: p.selected ? "#3b82f6" : "transparent",
                        border: p.selected ? "1px solid #3b82f6" : "1px solid rgba(71,85,105,.9)",
                        color: "#fff",
                      }}
                    >
                      {p.selected ? iconTick(10) : null}
                    </span>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: p.selected ? p.accentColor : "rgba(71,85,105,.8)", flex: "none" }} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: p.selected ? "#f8fafc" : "#94a3b8",
                      }}
                    >
                      {p.name}
                    </span>
                    {(p.required || !p.selected) && (
                      <span
                        style={{
                          display: "inline-flex",
                          fontSize: 8.5,
                          fontWeight: 700,
                          letterSpacing: ".1em",
                          textTransform: "uppercase",
                          padding: "1px 5px",
                          borderRadius: 999,
                          flex: "none",
                          ...(p.required
                            ? { color: "#22d3ee", background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.28)" }
                            : { color: "#64748b", background: "rgba(71,85,105,.15)", border: "1px solid rgba(71,85,105,.3)" }),
                        }}
                      >
                        {p.required ? "Req" : "Off"}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        flex: "none",
                        color: p.selected ? "#cbd5e1" : "#64748b",
                        textDecoration: p.selected ? "none" : "line-through",
                      }}
                    >
                      {money(p.feeCents)}
                    </span>
                  </div>
                );
              })}
            </div>

            {sow.addons.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 11, borderTop: "1px dashed rgba(30,41,59,.9)" }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
                  Optional services
                </span>
                {sow.addons.map((addon) => {
                  const tier = addon.tiers.find((x) => x.serviceSlug === addon.selectedServiceSlug) ?? addon.tiers[0]!;
                  return (
                    <div
                      key={addon.key}
                      onClick={() => toggleAddon(addon)}
                      data-testid={`freescan-review-rail-addon-${addon.key}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "8px 10px",
                        borderRadius: 9,
                        background: addon.selected ? "rgba(2,6,23,.5)" : "rgba(2,6,23,.3)",
                        transition: "opacity 180ms",
                        cursor: signed ? "default" : "pointer",
                        opacity: addon.selected ? 1 : 0.55,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          flex: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "background 180ms, border-color 180ms",
                          background: addon.selected ? "#22d3ee" : "transparent",
                          border: addon.selected ? "1px solid #22d3ee" : "1px solid rgba(71,85,105,.9)",
                          color: "#02121b",
                        }}
                      >
                        {addon.selected ? iconTick(10) : null}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 12,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            color: addon.selected ? "#f8fafc" : "#94a3b8",
                          }}
                        >
                          {addon.name}
                        </span>
                        <span style={{ display: "block", fontSize: 10, color: "#64748b", marginTop: 1 }}>
                          {tier.label} · {tier.monthlyCents > 0 ? `${money(tier.monthlyCents)}/mo` : money(tier.oneOffCents)}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          flex: "none",
                          color: addon.selected ? "#cbd5e1" : "#64748b",
                          textDecoration: addon.selected ? "none" : "line-through",
                        }}
                      >
                        {tier.monthlyCents > 0 ? `${money(tier.monthlyCents)}/mo` : money(tier.oneOffCents)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: "#64748b" }}>
              {signed
                ? "Scope is locked as signed. Any change now needs a written variation."
                : `Phase 1 is required. Deferred phases keep this price until ${longDate(sow.quoteValidUntil)} — the ${t.discountPct}% discount needs all ${t.phaseCount}.`}
            </p>
            {errorMessage && <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#f87171" }}>{errorMessage}</p>}
          </div>

          {/* Payment panel */}
          <div
            style={{
              border: "1px solid rgba(59,130,246,.35)",
              borderRadius: 16,
              background: "linear-gradient(160deg,rgba(59,130,246,.12),rgba(11,21,36,.92))",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 15,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}>
                {paid ? "Paid" : sow.selection.paymentPlan === "full" ? "Charged on signature" : "Deposit on signature"}
              </span>
              <span
                style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.035em", lineHeight: 1, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}
                data-testid="freescan-review-charged-now"
              >
                {money(t.chargedNowCents)}
              </span>
              <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                {sow.selection.paymentPlan === "full"
                  ? t.discountApplies
                    ? `${money(t.servicesGrossCents - t.servicesFullPlanCents)} off for taking the full scope up front${
                        t.recurringMonthlyCents > 0 ? `, then ${money(t.recurringMonthlyCents)} a month recurring` : ""
                      }`
                    : t.recurringMonthlyCents > 0
                    ? `Then ${money(t.recurringMonthlyCents)} a month recurring`
                    : "No recurring services in scope"
                  : `${money(t.servicesGrossCents - t.depositCents)} invoiced across phase sign-offs`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 14, borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Professional services</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>{money(planTotalCents)}</span>
              </span>
              {t.discountApplies && sow.selection.paymentPlan === "full" && (
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>Pay-in-full discount</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>−{t.discountPct}%</span>
                </span>
              )}
              <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Recurring, from month one</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#22d3ee", fontVariantNumeric: "tabular-nums" }}>
                  {t.recurringMonthlyCents > 0 ? `${money(t.recurringMonthlyCents)}/mo` : "None selected"}
                </span>
              </span>
              {sow.readiness.now !== null && projected !== null && (
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>Readiness delivered</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: projColor, fontVariantNumeric: "tabular-nums" }}>
                    {sow.readiness.now} → {projected}
                  </span>
                </span>
              )}
            </div>

            {/* Payment plan */}
            <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#64748b" }}>Payment plan</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(["full", "phased"] as const).map((plan) => {
                  const on = sow.selection.paymentPlan === plan;
                  return (
                    <div
                      key={plan}
                      onClick={() => pickPlan(plan)}
                      data-testid={`freescan-review-plan-${plan}`}
                      style={{
                        border: `1px solid ${on ? "rgba(59,130,246,.55)" : "rgba(30,41,59,.95)"}`,
                        borderRadius: 11,
                        background: on ? "rgba(59,130,246,.08)" : "rgba(2,6,23,.45)",
                        padding: "12px 13px",
                        cursor: signed ? "default" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                        transition: "border-color 200ms, background 200ms",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{plan === "full" ? "Pay in full" : "Phased"}</span>
                          {plan === "full" && t.discountApplies && (
                            <span
                              style={{
                                display: "inline-flex",
                                fontSize: 8.5,
                                fontWeight: 700,
                                letterSpacing: ".14em",
                                textTransform: "uppercase",
                                padding: "2px 6px",
                                borderRadius: 999,
                                color: "#34d399",
                                background: "rgba(52,211,153,.1)",
                                border: "1px solid rgba(52,211,153,.3)",
                              }}
                            >
                              Save {t.discountPct}%
                            </span>
                          )}
                        </span>
                        <span
                          style={{
                            width: 17,
                            height: 17,
                            borderRadius: "50%",
                            flex: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: `1px solid ${on ? "#3b82f6" : "rgba(71,85,105,.9)"}`,
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#3b82f6" : "transparent" }} />
                        </span>
                      </span>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>
                          {plan === "full" ? money(t.servicesFullPlanCents) : money(t.depositCents)}
                        </span>
                        {plan === "full" && t.discountApplies && (
                          <span style={{ fontSize: 11.5, color: "#64748b", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>
                            {money(t.servicesGrossCents)}
                          </span>
                        )}
                        {plan === "phased" && <span style={{ fontSize: 11.5, fontWeight: 600, color: "#64748b" }}>today</span>}
                      </span>
                      <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                        {plan === "full"
                          ? t.discountApplies
                            ? `${money(t.servicesGrossCents - t.servicesFullPlanCents)} saved against phased billing.`
                            : `Enable all ${t.phaseCount} phases to take ${t.discountPct}% off.`
                          : `${t.depositPct}% deposit, balance invoiced as you sign off each phase.`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Signature / payment */}
            <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingTop: 14, borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: signed ? "#34d399" : "#22d3ee" }}>
                  {signed ? "Executed agreement" : "Sign to authorise this scope"}
                </span>
                {signed && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 9px",
                      borderRadius: 999,
                      border: "1px solid rgba(52,211,153,.4)",
                      background: "rgba(52,211,153,.1)",
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "#34d399",
                    }}
                    data-testid="freescan-review-signed-stamp"
                  >
                    {iconTick(10)} Signed
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: "#94a3b8" }}>
                {signed
                  ? "Signed and countersigned. Payment releases Phase 1 scheduling."
                  : "Signature comes first: sign the scope above, then pay. Scope locks at signature."}
              </p>

              {!signed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Full legal name"
                    data-testid="freescan-review-signer-name"
                    style={PAY_INPUT}
                  />
                  <input
                    type="text"
                    value={signerRole}
                    onChange={(e) => setSignerRole(e.target.value)}
                    placeholder="Role"
                    data-testid="freescan-review-signer-role"
                    style={PAY_INPUT}
                  />
                  <SignaturePad typedName={signerName} onChange={setSignatureData} />
                  <div
                    onClick={() => setAgreed((v) => !v)}
                    data-testid="freescan-review-agree"
                    style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        flex: "none",
                        marginTop: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background 180ms, border-color 180ms",
                        background: agreed ? "#3b82f6" : "transparent",
                        border: agreed ? "1px solid #3b82f6" : "1px solid rgba(71,85,105,.9)",
                        color: "#fff",
                      }}
                    >
                      {agreed ? iconTick(10) : null}
                    </span>
                    <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "#cbd5e1" }}>
                      I am authorised to approve this scope, and I understand the phase selection is fixed once signed.
                    </span>
                  </div>
                  {signError && <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#f87171" }}>{signError}</p>}
                  <button
                    type="button"
                    onClick={() => void sign()}
                    disabled={!canSign || saving}
                    data-testid="freescan-review-sign"
                    style={{
                      width: "100%",
                      padding: 11,
                      border: 0,
                      borderRadius: 10,
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#fff",
                      background: canSign && !saving ? "linear-gradient(90deg,#3b82f6,#8b5cf6)" : "rgba(71,85,105,.4)",
                      cursor: canSign && !saving ? "pointer" : "not-allowed",
                      transition: "background 200ms",
                    }}
                  >
                    {saving ? "Recording your signature…" : "Sign the statement of work"}
                  </button>
                </div>
              )}

              {signed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
                      Agreed scope
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>
                      {money(planTotalCents)} · {t.phasesSelected} of {t.phaseCount} phases
                    </span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {sow.signature.signerName}
                      {sow.signature.signerRole ? `, ${sow.signature.signerRole}` : ""}
                      {sow.signature.signedAt ? ` · ${longDate(sow.signature.signedAt)}` : ""}
                    </span>
                  </span>

                  {paid ? (
                    <div
                      style={{
                        padding: "14px 15px",
                        borderRadius: 12,
                        border: "1px solid rgba(52,211,153,.4)",
                        background: "rgba(52,211,153,.08)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                      data-testid="freescan-review-paid"
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#34d399" }}>
                        {iconTick(14)} Payment received
                      </span>
                      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "#94a3b8" }}>
                        {sow.selection.paymentPlan === "full"
                          ? `${money(t.chargedNowCents)} is paid in full across ${t.phasesSelected} phases.`
                          : `Your ${money(t.chargedNowCents)} deposit is paid. The remaining ${money(
                              t.servicesGrossCents - t.chargedNowCents,
                            )} invoices only as you sign off each phase.`}
                      </span>
                      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "#94a3b8" }}>
                        Shane reviews the signed scope and confirms the Phase 1 window directly — an email within one
                        business day, not a queue ticket.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 11, borderTop: "1px solid rgba(30,41,59,.9)" }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
                          Payment details
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 600, color: "#64748b" }}>
                          {iconLock(13)} Stripe
                        </span>
                      </div>
                      {payError ? (
                        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#f87171" }}>{payError}</p>
                      ) : intent ? (
                        <StripePaymentElement
                          clientSecret={intent.clientSecret}
                          publishableKey={intent.publishableKey}
                          onSuccess={(paymentIntentId) => confirmPayment(paymentIntentId)}
                        />
                      ) : (
                        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#64748b" }}>Preparing secure payment…</p>
                      )}
                      <span style={{ fontSize: 10.5, lineHeight: 1.5, color: "#64748b", textAlign: "center" }}>
                        {sow.selection.paymentPlan === "full"
                          ? "One charge now. Recurring services start billing at kickoff."
                          : "Every later invoice follows a phase you have signed off."}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              border: "1px solid rgba(30,41,59,.95)",
              borderRadius: 14,
              background: "rgba(11,21,36,.6)",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ color: "#22d3ee", flex: "none", marginTop: 2, display: "flex" }}>{iconLock(13)}</span>
              <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "#94a3b8" }}>
                Card details go straight to Stripe. Shane McCaw Consulting never sees or stores them.
              </span>
            </span>
            <span style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ color: "#22d3ee", flex: "none", marginTop: 2, display: "flex" }}>{iconClock(13)}</span>
              <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "#94a3b8" }}>
                Scan-derived pricing holds until {longDate(sow.quoteValidUntil)}, then re-quotes against a fresh scan.
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
