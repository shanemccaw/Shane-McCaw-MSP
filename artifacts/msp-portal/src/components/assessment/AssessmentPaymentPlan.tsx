/**
 * AssessmentPaymentPlan.tsx
 *
 * The final Assessment wizard step (task 5): after the customer settles a scope
 * in the interactive selector, they choose a payment plan, sign, and pay.
 *
 * Reads GET /api/portal/assessment/sow/payment-options — the effective total for
 * the active scope, the live pay-in-full discount (real PAY-TODAY coupon inside
 * the 72h window), and the per-phase breakdown. It never re-derives pricing.
 *
 * Two plans:
 *   • Pay in full — REAL, end-to-end. Discounted price shown inside the discount
 *     window; on confirm, POST .../sow/checkout returns a hosted Stripe Checkout
 *     URL (discount applied as a real Stripe coupon) and we redirect.
 *   • Phased — presented with a real per-phase milestone breakdown, but flagged
 *     as provider-arranged: the platform's automatic per-phase invoicing is bound
 *     to the CRM presentation/project entity space and can't drive an Assessment
 *     SOW (see the backend Task-5 blocker note). Signing a phased plan records a
 *     signed agreement handed to the provider — never a Stripe deposit that can't
 *     invoice the remainder.
 *
 * Signature reuses the drawn-canvas pattern from customer-sow.tsx and is tied to
 * the exact scope + price via the submitted selectedWorkstreamTitles.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileSignature,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

type FetchWithAuth = (
  path: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

// ── Server payload (mirrors GET /api/portal/assessment/sow/payment-options) ────

interface PricingWindow {
  anchorAt: string;
  discountWindowEndsAt: string;
  validUntil: string;
  windowState: "discount" | "standard" | "expired";
}
interface PhaseLine {
  title: string;
  amount: number;
  deliveryDate: string | null;
}
interface ExistingAgreement {
  status: "pending_payment" | "paid" | "awaiting_provider_setup" | "free_activated";
  paymentPlan: "full" | "phased";
  signerName: string;
  signedAt: string;
}
interface PaymentOptions {
  ready: true;
  docId: number;
  currency: string;
  total: number;
  adjustmentsTotal: number;
  selectedWorkstreamTitles: string[];
  pricing: PricingWindow;
  payInFull: {
    active: boolean;
    discountedTotal: number | null;
    savings: number | null;
    variant: "adjustments_waived" | "percentage_off" | null;
    discountPct: number | null;
    couponCode: string | null;
  };
  phased: { selfServe: boolean; phases: PhaseLine[]; total: number };
  existingAgreement: ExistingAgreement | null;
}
interface PaymentOptionsNotReady {
  ready: false;
  regenerating?: boolean;
}
type PaymentOptionsState = PaymentOptions | PaymentOptionsNotReady;

type Plan = "full" | "phased";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m ${secs}s`;
}

// ── CAPTCHA gate (Cloudflare Turnstile; dev-bypass when unconfigured) ───────────
// Mirrors the consulting app's CaptchaGate so this checkout sends a real token
// when VITE_TURNSTILE_SITE_KEY is set and the server verifies it, and a bypass
// token in dev where the server's verifyCaptchaToken also bypasses.
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}
function CaptchaGate({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) {
      onVerify("DEV_BYPASS_TOKEN");
      return;
    }
    if (!window.turnstile) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    let widgetId: string | undefined;
    const renderWidget = () => {
      if (window.turnstile && containerRef.current) {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
        });
      } else {
        setTimeout(renderWidget, 100);
      }
    };
    renderWidget();
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

// ── Drawn-signature canvas (same pattern as customer-sow.tsx) ───────────────────

function SignatureCanvas({
  onChange,
  disabled,
}: {
  onChange: (dataUrl: string | null, name: string) => void;
  disabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [name, setName] = useState("");
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const { width } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width)) {
        canvas.width = Math.round(width);
        canvas.height = 130;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        setIsEmpty(true);
        emit(true, name);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(
    (empty: boolean, signerName: string) => {
      const canvas = canvasRef.current;
      if (!canvas || empty || !signerName.trim()) {
        onChange(null, signerName.trim());
        return;
      }
      onChange(canvas.toDataURL("image/png"), signerName.trim());
    },
    [onChange],
  );

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
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
    if (disabled) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0A2540";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPoint.current = pos;
    setIsDrawing(true);
    setIsEmpty(false);
  }
  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (disabled) return;
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPoint.current = pos;
  }
  function stopDrawing() {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    emit(false, name);
  }
  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    emit(true, name);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Full legal name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          disabled={disabled}
          onChange={(e) => {
            setName(e.target.value);
            emit(isEmpty, e.target.value);
          }}
          placeholder="Your full legal name"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Signature <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-primary"
            onClick={clearCanvas}
            disabled={disabled}
          >
            Clear
          </button>
        </div>
        <div
          ref={containerRef}
          className="touch-none select-none rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 transition-colors hover:border-primary/40"
        >
          <canvas
            ref={canvasRef}
            className="block cursor-crosshair rounded-lg"
            style={{ height: "130px", width: "100%" }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
        {isEmpty && <p className="mt-1 text-xs text-muted-foreground">Draw your signature in the box above.</p>}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        By signing you agree to the scope and pricing shown above. This electronic signature carries the same legal
        weight as a handwritten one.
      </p>
    </div>
  );
}

// ── Pricing-window banner ──────────────────────────────────────────────────────

function WindowBanner({ pricing }: { pricing: PricingWindow }) {
  const [, setNow] = useState(() => 0);
  useEffect(() => {
    if (pricing.windowState !== "discount") return;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pricing.windowState]);

  if (pricing.windowState === "discount") {
    const remaining = new Date(pricing.discountWindowEndsAt).getTime() - Date.now();
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <AlarmClock className="mt-0.5 size-5 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Pay-in-full discount —{" "}
            <span className="tabular-nums text-amber-600 dark:text-amber-400">{formatRemaining(remaining)}</span> left
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Settle in full within this window for the best price. After it closes the standard price applies until{" "}
            {formatDate(pricing.validUntil)}.
          </p>
        </div>
      </div>
    );
  }
  if (pricing.windowState === "standard") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Quote valid until {formatDate(pricing.validUntil)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The 72-hour pay-in-full discount window has closed. Standard pricing applies.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4">
      <CalendarClock className="mt-0.5 size-5 shrink-0 text-red-500" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">This statement of work has expired</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          It was valid for 30 days from generation ({formatDate(pricing.validUntil)}). A fresh scan is needed for
          current pricing.
        </p>
      </div>
    </div>
  );
}

// ── Terminal (already-settled) state ───────────────────────────────────────────

function SettledPanel({ agreement }: { agreement: ExistingAgreement }) {
  const title =
    agreement.status === "paid"
      ? "Payment confirmed"
      : agreement.status === "free_activated"
        ? "Statement of work activated"
        : "Signed — milestone billing next";
  const body =
    agreement.status === "awaiting_provider_setup"
      ? "Your statement of work is signed. Your provider will reach out to set up milestone billing for each phase."
      : "Your statement of work is settled. Your provider will be in touch to kick off the engagement.";
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] px-6 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15">
        <CheckCircle2 className="size-8 text-emerald-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Signed by {agreement.signerName} on {formatDate(agreement.signedAt)}.
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AssessmentPaymentPlan({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [state, setState] = useState<PaymentOptionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [applyDiscount, setApplyDiscount] = useState(true);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetchWithAuth("/api/portal/assessment/sow/payment-options", undefined, { silent: true });
      if (!res.ok) {
        setErrored(true);
        return;
      }
      setState((await res.json()) as PaymentOptionsState);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSignatureChange = useCallback((dataUrl: string | null, name: string) => {
    setSignatureData(dataUrl);
    setSignerName(name);
  }, []);

  const ready = state?.ready ? state : null;
  const existing = ready?.existingAgreement ?? null;
  const settled = existing && existing.status !== "pending_payment" ? existing : null;

  const offerActive = ready?.payInFull.active === true;
  const discountedTotal = offerActive ? ready!.payInFull.discountedTotal : null;
  const willApplyDiscount = plan === "full" && offerActive && applyDiscount;
  const fullChargeLabel =
    willApplyDiscount && discountedTotal !== null ? usd.format(discountedTotal) : ready ? usd.format(ready.total) : "";

  const canSubmit =
    ready != null &&
    plan != null &&
    ready.pricing.windowState !== "expired" &&
    !!signatureData &&
    !!signerName.trim() &&
    !!captchaToken &&
    !submitting;

  const submit = useCallback(async () => {
    if (!ready || !plan || !signatureData || !captchaToken) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetchWithAuth("/api/portal/assessment/sow/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaToken,
          paymentPlan: plan,
          applyPayInFull: plan === "full" && offerActive && applyDiscount,
          signatureData,
          signerName: signerName.trim(),
          selectedWorkstreamTitles: ready.selectedWorkstreamTitles,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        outcome?: string;
        url?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (data.code === "scope_changed") {
          setActionError("Your scope changed since you reviewed it. Reloading the latest…");
          await load();
        } else {
          setActionError(data.error ?? "We couldn't process that just now. Please try again.");
        }
        return;
      }
      if (data.outcome === "checkout" && data.url) {
        window.location.href = data.url; // hand off to Stripe hosted checkout
        return;
      }
      // free_activated or provider_setup — show confirmation and refresh terminal state.
      setConfirmation(data.message ?? "You're all set.");
      await load();
    } catch {
      setActionError("We couldn't process that just now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [ready, plan, signatureData, captchaToken, offerActive, applyDiscount, signerName, fetchWithAuth, load]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (errored) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <CreditCard className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm text-muted-foreground">We couldn't load your payment options just now.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">
          Finish choosing your scope first — your payment options appear here once your statement of work is ready.
        </p>
      </div>
    );
  }
  if (settled) {
    return <SettledPanel agreement={settled} />;
  }

  return (
    <div className="space-y-5">
      <WindowBanner pricing={ready.pricing} />

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Pay in full */}
        <button
          type="button"
          onClick={() => setPlan("full")}
          aria-pressed={plan === "full"}
          className={cn(
            "relative flex flex-col items-start rounded-2xl border-2 p-5 text-left transition-all",
            plan === "full" ? "border-primary bg-primary/[0.05] shadow-sm" : "border-border bg-card hover:border-primary/50",
          )}
        >
          {offerActive && (
            <span className="absolute right-3 top-3 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
              Best price
            </span>
          )}
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <h3 className="mb-1 text-sm font-bold text-foreground">Pay in full</h3>
          {willApplyDiscount && discountedTotal !== null ? (
            <div className="mb-1">
              <p className="text-2xl font-extrabold tabular-nums text-amber-600">{usd.format(discountedTotal)}</p>
              <p className="text-sm tabular-nums text-muted-foreground line-through">{usd.format(ready.total)}</p>
              <p className="mt-0.5 text-xs font-semibold text-amber-600">
                Save {usd.format(ready.total - discountedTotal)} today
              </p>
            </div>
          ) : (
            <p className="mb-1 text-2xl font-extrabold tabular-nums text-primary">{usd.format(ready.total)}</p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            One payment today. Simplest option — work begins as soon as payment is confirmed.
          </p>
        </button>

        {/* Phased */}
        <button
          type="button"
          onClick={() => setPlan("phased")}
          aria-pressed={plan === "phased"}
          className={cn(
            "relative flex flex-col items-start rounded-2xl border-2 p-5 text-left transition-all",
            plan === "phased" ? "border-primary bg-primary/[0.05] shadow-sm" : "border-border bg-card hover:border-primary/50",
          )}
        >
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Layers className="size-5 text-primary" />
          </div>
          <h3 className="mb-1 text-sm font-bold text-foreground">Phase by phase</h3>
          <p className="mb-1 text-2xl font-extrabold tabular-nums text-foreground">{usd.format(ready.phased.total)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Spread across your project's phases. Milestone billing is arranged directly with your provider.
          </p>
          {ready.phased.phases.length > 0 && (
            <div className="mt-3 w-full border-t border-border/60 pt-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Lock className="size-3" /> Per phase
              </p>
              <div className={cn("flex flex-col gap-1", ready.phased.phases.length >= 5 && "max-h-[132px] overflow-y-auto pr-1")}>
                {ready.phased.phases.map((p, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-foreground">{p.title}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{usd.format(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Discount opt-in (full plan, live offer only) */}
      {plan === "full" && offerActive && (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-3.5 py-2.5">
          <input
            type="checkbox"
            checked={applyDiscount}
            onChange={(e) => setApplyDiscount(e.target.checked)}
            className="size-4 accent-amber-500"
          />
          <span className="text-xs text-foreground">
            Apply the pay-in-full discount ({ready.payInFull.savings !== null ? usd.format(ready.payInFull.savings) : ""}{" "}
            off) — this quote is inside the discount window.
          </span>
        </label>
      )}

      {plan === "phased" && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Sign below to lock in this scope and price. Because milestone billing is set up with your provider directly,
            you won't be charged here — your provider takes it from here once you've signed.
          </p>
        </div>
      )}

      {/* Signature + confirm */}
      {plan && ready.pricing.windowState !== "expired" && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileSignature className="size-4 text-primary" />
            Sign to {plan === "full" ? "pay" : "confirm"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            You're agreeing to{" "}
            <span className="font-medium text-foreground">
              {plan === "full" ? fullChargeLabel : `${usd.format(ready.phased.total)} across ${ready.phased.phases.length} phase${ready.phased.phases.length === 1 ? "" : "s"}`}
            </span>
            {plan === "full" && willApplyDiscount ? " (discount applied at checkout)" : ""}.
          </p>

          <div className="mt-4">
            <SignatureCanvas onChange={onSignatureChange} disabled={submitting} />
          </div>

          <div className="mt-4">
            <CaptchaGate onVerify={setCaptchaToken} />
          </div>

          {confirmation ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-3 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              {confirmation}
            </div>
          ) : (
            <Button className="mt-4 w-full gap-2" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {plan === "full" ? "Redirecting to secure checkout…" : "Submitting…"}
                </>
              ) : plan === "full" ? (
                <>
                  <CreditCard className="size-4" />
                  Pay {fullChargeLabel}
                </>
              ) : (
                <>
                  <FileSignature className="size-4" />
                  Sign &amp; confirm
                </>
              )}
            </Button>
          )}

          {plan === "full" && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">Secure checkout powered by Stripe · SSL encrypted</p>
          )}
          {actionError && <p className="mt-2 text-center text-xs text-red-500">{actionError}</p>}
        </div>
      )}

      {!plan && (
        <p className="text-center text-xs text-muted-foreground">Choose a payment plan above to continue.</p>
      )}
    </div>
  );
}
