import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation, useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Clock,
  Mail,
  Users,
  XCircle,
} from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { Button } from "@/components/ui/button";
import { CaptchaGate } from "@/components/CaptchaGate";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useCatalog, type MonitoringTier, type RetainerTier, type ConfigPackTier, type AssessmentOffer } from "@/hooks/useCatalog";
import { trackCheckoutStarted, trackCheckoutCompleted } from "@/lib/analytics";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

type AnyTier = MonitoringTier | RetainerTier | ConfigPackTier | AssessmentOffer;

function tierToService(t: AnyTier) {
  const isFree = "isFree" in t ? t.isFree : false;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    price: "price" in t ? (t.price ?? ("basePrice" in t ? t.basePrice : null)) : null,
    billingType: "billingType" in t ? t.billingType : ("isFree" in t ? "one_time" as const : "one_time" as const),
    fulfillmentTypeKey: t.fulfillmentTypeKey,
    serviceType: "serviceType" in t ? t.serviceType : "assessment",
    typeAttributes: "typeAttributes" in t ? t.typeAttributes : null,
    isFree,
  };
}

type Step =
  | "loading"
  | "not-found"
  | "unavailable"
  | "catalog-error"
  | "guest-info"
  | "consent"
  | "payment"
  | "confirmed";

const WIZARD_STEPS: Step[] = ["guest-info", "consent", "payment", "confirmed"];
const STEP_LABELS: Record<string, string> = {
  "guest-info": "Your info",
  consent: "M365 access",
  payment: "Confirm",
  confirmed: "Confirmed",
};

function stepIndex(s: Step): number {
  return WIZARD_STEPS.indexOf(s);
}

// Plain value/label picklist for the guest-info industry dropdown — distinct from
// Governance.tsx's INDUSTRIES constant, which is page-specific marketing copy
// (icons + compliance-framework descriptions), not a form picklist.
const INDUSTRIES = [
  { value: "healthcare", label: "Healthcare" },
  { value: "financial-services", label: "Financial Services" },
  { value: "government", label: "Government / Public Sector" },
  { value: "legal", label: "Legal" },
  { value: "technology", label: "Technology" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "retail", label: "Retail" },
  { value: "education", label: "Education" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
] as const;

const guestInfoSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().min(1, "Required"),
  industry: z.string().min(1, "Required"),
  // Terms acceptance is gated HERE — before the consent step is reachable — so a
  // visitor cannot initiate the Microsoft 365 admin-consent redirect (real tenant
  // access) without first agreeing to the Terms of Service (which incorporates the
  // DPA by reference) and Privacy Policy that govern how that tenant data is processed.
  termsAccepted: z.boolean().refine((v) => v === true, {
    message: "You must agree to the Terms of Service and Privacy Policy to continue",
  }),
});
type GuestInfo = z.infer<typeof guestInfoSchema>;

// ── Server-side session helpers ───────────────────────────────────────────────
// Only the UUID sessionId is stored client-side; PII lives on the server.
// This ensures the session survives the Microsoft admin-consent cross-origin redirect.

const SESSION_STORAGE_KEY = "checkout_session_id";

function loadSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // sessionStorage may be unavailable
  }
}

function clearSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

async function createCheckoutSession(opts: {
  productSlug: string;
  fullName: string;
  email: string;
  company: string;
  industry: string;
  seats: number;
}): Promise<string> {
  const res = await fetch("/api/public/checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to create checkout session");
  }
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

interface CheckoutSessionInfo {
  productSlug: string;
  status: string;
  seats: number;
  // #143: true when the resolved buyer already has a portal password. The paid
  // Stripe-return path uses this so a returning buyer sees "log in" instead of a
  // code-entry screen (the webhook never emails a code to a password-holder).
  hasPassword?: boolean;
}

async function fetchCheckoutSession(
  sessionId: string,
): Promise<CheckoutSessionInfo | null> {
  try {
    const res = await fetch(`/api/public/checkout-session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return (await res.json()) as CheckoutSessionInfo;
  } catch {
    return null;
  }
}

// ── localStorage guestInfo cache ──────────────────────────────────────────────
// Name and email are cached in localStorage (keyed by sessionId) so they survive
// cross-origin redirects (e.g. Microsoft admin-consent). The server never exposes
// PII on the public checkout-session endpoint — only productSlug + status.

const GUEST_INFO_CACHE_PREFIX = "checkout_guest_";

function saveGuestInfoCache(sessionId: string, info: GuestInfo): void {
  try {
    localStorage.setItem(
      `${GUEST_INFO_CACHE_PREFIX}${sessionId}`,
      JSON.stringify(info),
    );
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

function loadGuestInfoCache(sessionId: string): GuestInfo | null {
  try {
    const raw = localStorage.getItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GuestInfo;
  } catch {
    return null;
  }
}

function clearGuestInfoCache(sessionId: string): void {
  try {
    localStorage.removeItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
  } catch {}
}

function fmtPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });
}

// ── Confirmed step, self-serve variant (#143) ─────────────────────────────────
// Netflix-style finish for non-signature services: verify the emailed 6-digit
// code and set the portal password inline, all on this screen. The code only
// GATES the existing flow — a correct code returns a normal account-setup token
// and the password submit goes through the unchanged /api/auth/setup-password.
// Signature-required services (project/retainer) never render this component.

const passwordSetupSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type PasswordSetupForm = z.infer<typeof passwordSetupSchema>;

type VerifyPhase = "code" | "password" | "done" | "locked" | "already-set";

function ConfirmedSelfServeStep({
  service,
  slug,
  sessionId,
  guestEmail,
  initialHasPassword,
  priceDisplay,
}: {
  service: ReturnType<typeof tierToService>;
  slug: string;
  sessionId: string;
  guestEmail: string | null;
  initialHasPassword: boolean;
  priceDisplay: string | null;
}) {
  const [phase, setPhase] = useState<VerifyPhase>(initialHasPassword ? "already-set" : "code");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The first code was just emailed (free endpoint / Stripe webhook), so the
  // resend button starts inside the 60s cooldown and counts down visibly.
  const [cooldownLeft, setCooldownLeft] = useState(60);
  const [resending, setResending] = useState(false);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState("/portal/");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setTimeout(() => setCooldownLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldownLeft]);

  // The paid Stripe-return path resolves hasPassword asynchronously (the
  // checkout-session GET lands after this component has already mounted in the
  // "code" phase). When it arrives true, flip a still-pristine code screen to the
  // log-in state so a returning buyer isn't shown a code entry for an email that
  // never comes. Never override a phase the buyer has already progressed past.
  useEffect(() => {
    if (initialHasPassword) setPhase((p) => (p === "code" ? "already-set" : p));
  }, [initialHasPassword]);

  const form = useForm<PasswordSetupForm>({
    resolver: zodResolver(passwordSetupSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function handleVerify(codeValue: string) {
    if (codeValue.length !== 6 || verifying) return;
    setVerifying(true);
    setCodeError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/checkout/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, code: codeValue }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        setupToken?: string;
        reason?: string;
        attemptsRemaining?: number;
      };
      if (json.ok && json.setupToken) {
        setSetupToken(json.setupToken);
        setPhase("password");
        return;
      }
      switch (json.reason) {
        case "incorrect":
          setCode("");
          setCodeError(
            json.attemptsRemaining === 1
              ? "That code isn't right — 1 attempt remaining."
              : `That code isn't right — ${json.attemptsRemaining ?? 0} attempts remaining.`,
          );
          break;
        case "expired":
          setCodeError("That code has expired. Use “Resend code” below to get a fresh one.");
          break;
        case "resent":
          // Paid flow, 3rd wrong attempt: the server already emailed a new code.
          setCode("");
          setCooldownLeft(60);
          setNotice("Too many incorrect attempts — we've emailed you a brand-new code. Use the code from the newest email.");
          break;
        case "locked":
          setPhase("locked");
          break;
        case "already_set":
          setPhase("already-set");
          break;
        default:
          setCodeError("Verification failed. Please try again.");
      }
    } catch {
      setCodeError("Network error. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (cooldownLeft > 0 || resending) return;
    setResending(true);
    setCodeError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/checkout/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        retryAfterSeconds?: number;
      };
      if (json.ok) {
        setCode("");
        setCooldownLeft(60);
        setNotice(
          guestEmail ? `A fresh code is on its way to ${guestEmail}.` : "A fresh code is on its way.",
        );
      } else if (json.reason === "not_ready") {
        // Paid buyer resending before the provisioning webhook has minted the
        // first code — it's on the way from the trusted path, just not yet.
        setNotice(
          guestEmail
            ? `Your code is on its way to ${guestEmail} — give it a moment and check your inbox.`
            : "Your code is on its way — give it a moment and check your inbox.",
        );
        setCooldownLeft(60);
      } else if (json.reason === "cooldown") {
        setCooldownLeft(Math.max(1, json.retryAfterSeconds ?? 60));
      } else if (json.reason === "locked") {
        setPhase("locked");
      } else if (json.reason === "already_set") {
        setPhase("already-set");
      } else {
        setCodeError("Couldn't resend the code. Please try again.");
      }
    } catch {
      setCodeError("Network error. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  async function handleSetPassword(data: PasswordSetupForm) {
    if (!setupToken) return;
    setPasswordError(null);
    try {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: setupToken, password: data.password }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        error?: string;
        user?: { mspSlug?: string | null; mspRole?: string | null };
      };
      if (!res.ok) {
        setPasswordError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      // Mirror account-setup.tsx's role-based landing, under the portal base path.
      const mspSlug = json.user?.mspSlug ?? null;
      const landing =
        json.user?.mspRole === "Assessment"
          ? "assessment"
          : json.user?.mspRole === "CustomerUser"
            ? "m365-health"
            : "dashboard";
      setPortalUrl(mspSlug ? `/portal/${mspSlug}/${landing}` : "/portal/");
      clearGuestInfoCache(sessionId);
      clearSessionId();
      setPhase("done");
    } catch {
      setPasswordError("A network error occurred. Please try again.");
    }
  }

  function handleStartOver() {
    clearGuestInfoCache(sessionId);
    clearSessionId();
    window.location.href = `/checkout/${encodeURIComponent(slug)}`;
  }

  if (phase === "locked") {
    // Free-flow 3-strike lockout: explain and restart — never a silent redirect.
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
          <AlertCircle className="size-8 text-amber-400" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-text-primary">Verification locked</h2>
        <p className="text-text-secondary max-w-sm">
          For security, we locked this verification after 3 incorrect codes. Your order went through
          and nothing was lost — but you'll need to start checkout again with the same email to get a
          fresh code.
        </p>
        <button
          onClick={handleStartOver}
          className="mt-2 inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
        >
          <ArrowLeft className="mr-2 size-4" /> Start checkout again
        </button>
      </div>
    );
  }

  if (phase === "already-set") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-2">
          <CheckCircle2 className="size-8 text-accent-blue" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-text-primary">
          Order <GradientText>confirmed</GradientText>!
        </h2>
        <p className="text-text-secondary max-w-sm">
          Your <strong className="text-text-primary">{service.name}</strong> is confirmed, and your
          account already has a password — just log in to see it in your portal.
        </p>
        <a
          href="/portal/"
          className="mt-2 inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          style={GRADIENT_BG}
        >
          Log in to my portal <ArrowRight className="ml-2 size-4" />
        </a>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-2">
          <CheckCircle2 className="size-8 text-accent-blue" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-text-primary">
          You're <GradientText>all set</GradientText>!
        </h2>
        <p className="text-text-secondary max-w-sm">
          Your password is saved and you're signed in. Your{" "}
          <strong className="text-text-primary">{service.name}</strong> workspace is waiting.
        </p>
        <a
          href={portalUrl}
          className="mt-2 inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          style={GRADIENT_BG}
        >
          Go to my portal <ArrowRight className="ml-2 size-4" />
        </a>
      </div>
    );
  }

  // phase === "code" | "password"
  return (
    <div className="flex flex-col items-center gap-5 py-8 text-center">
      <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-1">
        <CheckCircle2 className="size-8 text-accent-blue" />
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-3xl font-semibold text-text-primary">
          Thank you — <GradientText>order confirmed</GradientText>!
        </h2>
        <p className="text-text-secondary max-w-md">
          {service.isFree
            ? "Your free service is confirmed and your Microsoft 365 scan is already underway."
            : "Your payment went through and your workspace is being prepared right now."}
        </p>
      </div>

      <div className="w-full rounded-xl border border-white/[0.06] bg-charcoal-1 p-4 flex items-center justify-between gap-4">
        <div className="text-left">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-0.5">Your order</p>
          <p className="font-semibold text-text-primary">{service.name}</p>
        </div>
        {priceDisplay && (
          <p className="font-numeric text-text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
        )}
      </div>

      {phase === "code" ? (
        <div className="w-full space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4 text-left">
            <Mail className="size-5 text-accent-blue shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary leading-snug">
              We've emailed a 6-digit verification code
              {guestEmail ? (
                <>
                  {" "}to <strong className="text-text-primary">{guestEmail}</strong>
                </>
              ) : null}
              . Enter it below to verify your email and set your portal password — no waiting, no
              extra links.
            </p>
          </div>

          {notice && (
            <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-3 text-sm text-text-primary">
              {notice}
            </div>
          )}
          {codeError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2 text-left">
              <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300/90">{codeError}</p>
            </div>
          )}

          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              pattern={REGEXP_ONLY_DIGITS}
              onChange={setCode}
              onComplete={(v: string) => handleVerify(v)}
              disabled={verifying}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot
                    key={i}
                    index={i}
                    className="h-12 w-10 text-lg font-semibold bg-white/[0.04] border-white/[0.12] text-text-primary"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            onClick={() => handleVerify(code)}
            disabled={verifying || code.length !== 6}
            className="w-full text-white"
            style={GRADIENT_BG}
          >
            {verifying ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Verifying…
              </>
            ) : (
              <>
                Verify code <ArrowRight className="ml-2 size-4" />
              </>
            )}
          </Button>

          <button
            onClick={handleResend}
            disabled={cooldownLeft > 0 || resending}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resending
              ? "Sending…"
              : cooldownLeft > 0
                ? `Resend code (${cooldownLeft}s)`
                : "Resend code"}
          </button>
        </div>
      ) : (
        <div className="w-full space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4 text-left">
            <ShieldCheck className="size-5 text-accent-blue shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary leading-snug">
              <strong className="text-text-primary">Email verified.</strong> Last step: choose your
              portal password and you're in.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSetPassword)} className="space-y-4 text-left">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {passwordError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
                  <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300/90">{passwordError}</p>
                </div>
              )}
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="w-full text-white"
                style={GRADIENT_BG}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Creating your password…
                  </>
                ) : (
                  <>
                    Create password &amp; enter portal <ArrowRight className="ml-2 size-4" />
                  </>
                )}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const ci = stepIndex(current);
  if (ci < 0) return null;
  return (
    <div className="flex items-center gap-2 mb-8 flex-wrap">
      {WIZARD_STEPS.map((s, idx) => {
        const done = idx < ci;
        const active = idx === ci;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 text-sm font-medium ${
                active
                  ? "text-text-primary"
                  : done
                    ? "text-accent-blue"
                    : "text-text-secondary"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
                  active
                    ? "text-white"
                    : done
                      ? "bg-accent-blue text-white"
                      : "bg-white/[0.08] text-text-tertiary"
                }`}
                style={active ? GRADIENT_BG : undefined}
              >
                {done ? <CheckCircle2 className="size-3.5" /> : idx + 1}
              </span>
              <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
            </div>
            {idx < WIZARD_STEPS.length - 1 && (
              <span className="text-text-tertiary">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Checkout() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const checkoutStatus = params.get("checkout_status") as "success" | "canceled" | null;
  // `session` param is set by ConsentSuccessPage when redirecting back to checkout
  const sessionParam = params.get("session");
  const seats = Math.max(1, parseInt(params.get("seats") ?? "1", 10) || 1);

  // Catalog data (all purchasable service types)
  const { monitoringTiers, retainerTiers, configPackTiers, assessmentOffers, loading: catalogLoading, error: catalogError } = useCatalog();

  const [step, setStep] = useState<Step>("loading");
  const [service, setService] = useState<ReturnType<typeof tierToService> | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Seat count recovered from the server-side session when returning via the consent redirect.
  // The URL param is stripped by navigate() so we hold the authoritative value in state.
  const [recoveredSeats, setRecoveredSeats] = useState<number | null>(null);
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentCanceled, setPaymentCanceled] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  // The server refused to issue a consent URL because the checkout session is
  // expired/invalid (it will never hand out a state-less URL for this flow).
  const [consentSessionGone, setConsentSessionGone] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // The resolved buyer already has a portal password, so the confirmed step
  // shows a log-in prompt instead of the code-verification UX (#143). Set from
  // the free-checkout response (free path) or the checkout-session GET (paid
  // Stripe-return path) — the webhook never emails a code to a password-holder.
  const [confirmedHasPassword, setConfirmedHasPassword] = useState(false);
  const { toast } = useToast();
  const contractIdRef = useRef<number | null>(null);

  // Self-serve (non-signature) services finish with inline code verification on
  // the confirmed step (#143); project/retainer keep the manual-onboarding copy
  // and the drawn-signature contract path.
  const requiresSignature =
    service ? service.serviceType === "project" || service.serviceType === "retainer" : false;

  // Fire analytics on mount
  useEffect(() => { trackCheckoutStarted("service_catalog"); }, []);

  // Once catalog loads, resolve the service and handle Stripe/consent return params
  useEffect(() => {
    if (catalogLoading) return;

    if (catalogError) {
      setStep("catalog-error");
      return;
    }

    if (!slug) {
      setStep("not-found");
      return;
    }

    const allTiers: AnyTier[] = [...monitoringTiers, ...retainerTiers, ...configPackTiers, ...assessmentOffers];
    const found = allTiers.find((t) => t.slug === slug);

    if (!found) {
      setStep("not-found");
      return;
    }

    const svc = tierToService(found);
    setService(svc);

    if (!svc.fulfillmentTypeKey) {
      setStep("unavailable");
      return;
    }

    // Handle Stripe return (success/canceled) — reload guest info from the server session
    if (checkoutStatus === "success" || checkoutStatus === "canceled") {
      const storedSessionId = loadSessionId();
      if (storedSessionId) {
        setSessionId(storedSessionId);
        // Recover guestInfo from the localStorage cache (survives the Stripe
        // round-trip) so a canceled payment can be retried without re-entering
        // details, and — critically — recover the SEAT COUNT from the
        // server-side session: the Stripe cancel URL carries no ?seats= param,
        // so without this a "try again" payment silently reverted to 1 seat and
        // charged the floor-clamped price instead of the real per-tenant price.
        const cachedInfo = loadGuestInfoCache(storedSessionId);
        if (cachedInfo) {
          setGuestInfo(cachedInfo);
          setTermsAccepted(cachedInfo.termsAccepted === true);
        }
        fetchCheckoutSession(storedSessionId).then((info) => {
          if (!info) return;
          if (info.seats > 1) setRecoveredSeats(info.seats);
          // Returning buyer (already has a password): the confirmed step shows a
          // log-in prompt rather than waiting on a code email that never comes.
          if (info.hasPassword) setConfirmedHasPassword(true);
        }).catch(() => {});
      }
      if (checkoutStatus === "success") {
        trackCheckoutCompleted(svc.billingType ?? "service", { service_id: String(svc.id) });
        setStep("confirmed");
        navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      } else {
        setConsentGranted(true);
        setPaymentCanceled(true);
        setStep("payment");
        navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      }
      return;
    }

    // Handle return from consent success page — ?session=<uuid> means consent was granted.
    // sessionStorage may have been wiped during the cross-origin redirect, so we recover
    // the sessionId from the URL param and restore guestInfo from the localStorage cache
    // (written at guest-info submit time by saveGuestInfoCache). Seats are recovered from
    // the server-side session (stored at session creation) since the URL param is stripped
    // by navigate() below.
    if (sessionParam) {
      const storedSessionId = loadSessionId() ?? sessionParam;
      saveSessionId(storedSessionId);
      setSessionId(storedSessionId);
      setConsentGranted(true);

      // Restore guestInfo from the localStorage cache written when the session was created.
      // If the cache was also wiped (private browsing or aggressive browser policy),
      // handlePay will guard against a missing guestInfo and display an error.
      const cachedInfo = loadGuestInfoCache(storedSessionId);
      if (cachedInfo) {
        setGuestInfo(cachedInfo);
        // Terms were accepted at the guest-info step before consent. The cache (which
        // survives the cross-origin consent redirect) carries that acceptance forward so
        // the payment step reflects it without re-prompting. If the cache was wiped, this
        // stays false and the payment step falls back to an interactive terms checkbox.
        setTermsAccepted(cachedInfo.termsAccepted === true);
      }

      // Recover seat count from the server-side session. The URL ?seats= param is read
      // here but will be stripped by navigate() below, so we persist it in state.
      // Seed with the URL value first so the price shows immediately, then confirm with server.
      const urlSeats = Math.max(1, parseInt(params.get("seats") ?? "1", 10) || 1);
      if (urlSeats > 1) setRecoveredSeats(urlSeats);
      fetchCheckoutSession(storedSessionId).then((info) => {
        if (info && info.seats > 1) setRecoveredSeats(info.seats);
      }).catch(() => {});

      setStep("payment");
      navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      return;
    }

    // Normal fresh flow
    setStep("guest-info");
  // checkoutStatus and sessionParam deliberately excluded so we only evaluate once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, catalogError, slug, monitoringTiers, retainerTiers, configPackTiers, assessmentOffers]);

  // Fetch (or refetch) the admin-consent URL whenever the sessionId changes.
  // This ensures the URL carries the correct `state` parameter even when
  // sessionId is set after the initial catalog load (i.e. after guest-info submit).
  //
  // HARD RULE: never fetch (or render) a consent URL without a sessionId. A
  // consent link without `state` completes at Microsoft but reaches the callback
  // unlinked to the checkout session — no account provisioning fires, and the
  // buyer can still go on to PAY for a non-functional account (confirmed live:
  // "Seven Hundred"). Previously this effect prefetched a state-less URL at
  // mount (before guest-info created the session), leaving a live, clickable
  // state-less consent link on the consent step until the session-bound refetch
  // landed. The `cancelled` guard also prevents a stale in-flight response from
  // overwriting the current session's URL.
  useEffect(() => {
    if (catalogLoading || !service?.fulfillmentTypeKey) return;
    const sid = sessionId ?? loadSessionId();
    if (!sid) {
      setConsentUrl(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/public/consent-url?sessionId=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null; error?: string }>) : { url: null }))
      .then((d: { url: string | null; error?: string }) => {
        if (cancelled) return;
        setConsentUrl(d.url);
        // Server refused to issue a state-less URL: the session is expired or
        // invalid. Surface it so the consent step offers a restart instead of
        // showing "Loading consent link…" forever.
        setConsentSessionGone(!d.url && (d.error === "session_expired" || d.error === "session_invalid"));
      })
      .catch(() => {
        if (!cancelled) setConsentUrl(null);
      });
    return () => {
      cancelled = true;
    };
  // Re-run whenever sessionId changes so the URL includes the correct `state`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, service?.fulfillmentTypeKey, sessionId]);

  const form = useForm<GuestInfo>({
    resolver: zodResolver(guestInfoSchema),
    defaultValues: { name: "", email: "", company: "", industry: "", termsAccepted: false },
  });

  // Use the recovered seat count when returning from consent (URL stripped by navigate).
  // Falls back to URL param value on the fresh/direct path.
  const effectiveSeats = recoveredSeats ?? seats;

  async function handleGuestInfo(data: GuestInfo) {
    if (!slug) return;
    try {
      const newSessionId = await createCheckoutSession({
        productSlug: slug,
        fullName: data.name,
        email: data.email,
        company: data.company,
        industry: data.industry,
        seats: effectiveSeats,
      });
      saveSessionId(newSessionId);
      // Cache guestInfo (including the terms-accepted flag) in localStorage so it survives
      // the cross-origin consent redirect. The server-side session holds the canonical copy;
      // this is a client-side convenience cache.
      saveGuestInfoCache(newSessionId, data);
      setSessionId(newSessionId);
      setGuestInfo(data);
      // Zod validation already guaranteed data.termsAccepted === true to reach here.
      setTermsAccepted(true);
      setStep("consent");
    } catch {
      toast({
        title: "Something went wrong",
        description: "Could not save your information. Please check your connection and try again.",
        variant: "destructive",
      });
    }
  }

  async function handlePay() {
    if (!service || !guestInfo || !termsAccepted) return;

    setLaunching(true);
    setPaymentError(null);
    setSessionExpired(false);
    setPaymentCanceled(false);

    try {
      let contractId = contractIdRef.current;

      if (!contractId) {
        const contractRes = await fetch("/api/portal/onboarding/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            guestEmail: guestInfo.email,
            signerName: guestInfo.name,
            seats: effectiveSeats,
            captchaToken,
            ...(requiresSignature ? { signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" } : {}),
          }),
        });

        if (!contractRes.ok) {
          const err = (await contractRes.json().catch(() => ({}))) as { error?: string };
          setPaymentError(err.error ?? "Unable to start checkout. Please try again.");
          return;
        }

        const { contractIds } = (await contractRes.json()) as { contractIds: number[] };
        contractId = contractIds[0] ?? null;
        contractIdRef.current = contractId;
      }

      if (!contractId) {
        setPaymentError("Failed to create contract. Please try again.");
        return;
      }

      // Build Stripe return URLs
      const origin = window.location.origin;
      const base = `/checkout/${encodeURIComponent(service.slug ?? "")}`;
      const successUrl = `${origin}${base}?checkout_status=success`;
      const cancelUrl = `${origin}${base}?checkout_status=canceled`;

      const sessionRes = await fetch("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds: [contractId],
          guestEmail: guestInfo.email,
          successUrl,
          cancelUrl,
          seats: effectiveSeats,
          captchaToken,
          // This surface renders the inline code-verification UI on its
          // confirmed step, so the webhook may send the 6-digit code email
          // instead of the account-setup link for self-serve services (#143).
          supportsVerificationCode: true,
        }),
      });

      if (!sessionRes.ok) {
        const err = (await sessionRes.json().catch(() => ({}))) as { error?: string };
        const msg = err.error ?? "Unable to start payment. Please try again.";
        if (msg.toLowerCase().includes("expired")) {
          setSessionExpired(true);
          contractIdRef.current = null;
        } else {
          setPaymentError(msg);
        }
        return;
      }

      const { url } = (await sessionRes.json()) as { url: string };
      if (url) {
        window.location.href = url;
      }
    } catch {
      setPaymentError("Network error. Check your connection and try again.");
    } finally {
      setLaunching(false);
    }
  }

  async function handleFreeCheckout() {
    if (!service || !guestInfo || !termsAccepted) return;

    setLaunching(true);
    setPaymentError(null);

    try {
      let contractId = contractIdRef.current;

      if (!contractId) {
        const contractRes = await fetch("/api/portal/onboarding/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            guestEmail: guestInfo.email,
            signerName: guestInfo.name,
            seats: effectiveSeats,
            captchaToken,
          }),
        });

        if (!contractRes.ok) {
          const err = (await contractRes.json().catch(() => ({}))) as { error?: string };
          setPaymentError(err.error ?? "Unable to start checkout. Please try again.");
          return;
        }

        const { contractIds } = (await contractRes.json()) as { contractIds: number[] };
        contractId = contractIds[0] ?? null;
        contractIdRef.current = contractId;
      }

      if (!contractId) {
        setPaymentError("Failed to create contract. Please try again.");
        return;
      }

      const freeRes = await fetch("/api/portal/checkout/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds: [contractId],
          guestEmail: guestInfo.email,
          captchaToken,
          supportsVerificationCode: true,
        }),
      });

      if (!freeRes.ok) {
        const err = (await freeRes.json().catch(() => ({}))) as { error?: string };
        setPaymentError(err.error ?? "Unable to complete registration. Please try again.");
        return;
      }

      const freeJson = (await freeRes.json().catch(() => ({}))) as { hasPassword?: boolean };
      setConfirmedHasPassword(freeJson.hasPassword === true);

      trackCheckoutCompleted("free_service", { service_id: String(service.id) });
      setStep("confirmed");
    } catch {
      setPaymentError("Network error. Check your connection and try again.");
    } finally {
      setLaunching(false);
    }
  }

  const priceDisplay = (() => {
    if (!service) return null;
    if (service.isFree) return "Free";
    const ta = (service.typeAttributes ?? {}) as {
      pricePerUserMonth?: string | null;
      seatCountFloor?: string | number | null;
      flatMonthlySurcharge?: string | number | null;
    };
    if (service.billingType === "recurring_monthly" && ta.pricePerUserMonth) {
      // Mirror the server charge exactly (resolveTypeAttributesMonthlyPriceCents):
      // pricePerUserMonth × max(seats, seatCountFloor) + flatMonthlySurcharge.
      // A naive ppu × seats here understated the Confirm-step price for tiers
      // with a billable-seat floor or a flat surcharge — the customer must see
      // the same number Stripe will charge.
      const perSeat = Number(ta.pricePerUserMonth);
      const floor = Math.trunc(Number(ta.seatCountFloor ?? 0)) || 0;
      const surcharge = Number(ta.flatMonthlySurcharge ?? 0) || 0;
      const billableSeats = Math.max(1, effectiveSeats, floor);
      return `${fmtPrice(Math.round((perSeat * billableSeats + surcharge) * 100))}/mo`;
    }
    if (service.billingType === "recurring_monthly") {
      return `${fmtPrice(Number(service.price ?? 0) * 100)}/mo`;
    }
    return fmtPrice(Number(service.price ?? 0) * 100);
  })();

  const isWizardStep = WIZARD_STEPS.includes(step);

  return (
    <Layout>
      <SEOMeta
        title="Checkout | Shane McCaw Consulting"
        description="Securely purchase a Microsoft 365 consulting service from Shane McCaw."
      />

      <div className="min-h-screen pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex justify-center py-24">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}

          {/* Catalog error */}
          {step === "catalog-error" && (
            <GlassPanel className="p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-red-400" />
              <h2 className="font-display text-xl font-bold text-text-primary">Unable to load service catalogue</h2>
              <p className="text-text-secondary">
                There was a problem fetching service information. Please refresh and try again.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
              >
                Refresh
              </button>
            </GlassPanel>
          )}

          {/* Not found */}
          {step === "not-found" && (
            <GlassPanel className="p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-text-tertiary" />
              <h2 className="font-display text-xl font-bold text-text-primary">Service not found</h2>
              <p className="text-text-secondary">
                We couldn't find a service matching{" "}
                <strong className="text-text-primary">{slug ?? "the requested service"}</strong>. It may have been removed or
                the link may be incorrect.
              </p>
              <Link
                href="/assessments"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
              >
                View all services
              </Link>
            </GlassPanel>
          )}

          {/* Not yet available */}
          {step === "unavailable" && service && (
            <GlassPanel className="p-10 text-center space-y-4">
              <Clock className="mx-auto size-12 text-accent-blue" />
              <h2 className="font-display text-xl font-bold text-text-primary">{service.name}</h2>
              <p className="text-text-secondary">
                This service isn't yet available for online purchase. Please contact Shane directly
                to discuss your requirements and get started.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <ChatCTA
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  style={GRADIENT_BG}
                >
                  Contact Shane
                </ChatCTA>
                <ChatCTA
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
                >
                  Book a discovery call
                </ChatCTA>
              </div>
            </GlassPanel>
          )}

          {/* Wizard */}
          {isWizardStep && (
            <>
              <StepIndicator current={step} />

              <GlassPanel className="p-8">
                {/* Step 1: Guest info */}
                {step === "guest-info" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">Your information</h2>
                      <p className="text-text-secondary mt-1">Enter your details to get started.</p>
                    </div>

                    {service && (
                      <div className="rounded-xl bg-charcoal-1 border border-white/[0.06] p-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-0.5">
                            Selected service
                          </p>
                          <p className="font-semibold text-text-primary">{service.name}</p>
                        </div>
                        {priceDisplay && (
                          <p className="font-numeric text-text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
                        )}
                      </div>
                    )}

                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleGuestInfo)} className="space-y-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full name</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Jane Smith"
                                  autoComplete="name"
                                  className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Work email</FormLabel>
                              <FormControl>
                                <Input
                                  type="email"
                                  placeholder="you@yourcompany.com"
                                  autoComplete="email"
                                  className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="company"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Company</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Acme Inc."
                                  autoComplete="organization"
                                  className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="industry"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Industry</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-white/[0.04] border-white/[0.12] text-text-primary focus:ring-accent-blue/60 focus:border-accent-blue/60">
                                    <SelectValue placeholder="Select your industry" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {INDUSTRIES.map((i) => (
                                    <SelectItem key={i.value} value={i.value}>
                                      {i.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {/* Terms / clickwrap gate — required BEFORE the M365 admin-consent step.
                            Agreeing here is what unlocks the consent step; a visitor cannot grant
                            real tenant access without first accepting the Terms of Service (which
                            incorporates the DPA by reference) and Privacy Policy. */}
                        <FormField
                          control={form.control}
                          name="termsAccepted"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-start gap-3">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value}
                                    onCheckedChange={(v) => field.onChange(v === true)}
                                    className="mt-0.5 border-white/20 data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue"
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal text-text-secondary leading-snug cursor-pointer">
                                  I agree to the{" "}
                                  <Link href="/legal/terms" className="underline text-accent-blue">
                                    Terms of Service
                                  </Link>{" "}
                                  and{" "}
                                  <Link href="/legal/privacy" className="underline text-accent-blue">
                                    Privacy Policy
                                  </Link>
                                  . Agreement is required before granting Microsoft 365 admin access.
                                </FormLabel>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          className="w-full text-white"
                          style={GRADIENT_BG}
                          disabled={form.formState.isSubmitting}
                        >
                          {form.formState.isSubmitting ? (
                            <><Loader2 className="mr-2 size-4 animate-spin" /> Saving…</>
                          ) : (
                            <>Continue <ArrowRight className="ml-2 size-4" /></>
                          )}
                        </Button>
                      </form>
                    </Form>
                  </div>
                )}

                {/* Step 2: M365 admin consent */}
                {step === "consent" && (
                  <div className="space-y-6">
                    <button
                      onClick={() => setStep("guest-info")}
                      className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </button>

                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">
                        Microsoft 365 admin consent
                      </h2>
                      <p className="text-text-secondary mt-1">
                        Shane's monitoring and automation tools need read access to your Microsoft
                        365 tenant. This is granted once by your M365 administrator.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Users className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-text-primary text-sm">Who does this step</p>
                          <p className="text-sm text-text-secondary">
                            Your Microsoft 365 Global Administrator or a Privileged Role
                            Administrator.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-text-primary text-sm">
                            What access is granted
                          </p>
                          <p className="text-sm text-text-secondary">
                            Read-only access to tenant configuration, user data, and service health.
                            No changes are made without your explicit approval.
                          </p>
                        </div>
                      </div>
                    </div>

                    {consentUrl ? (
                      <a
                        href={consentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg border border-accent-blue text-accent-blue font-semibold text-sm hover:bg-accent-blue/10 transition-colors"
                      >
                        Grant admin consent in Microsoft{" "}
                        <ExternalLink className="size-4" />
                      </a>
                    ) : consentSessionGone ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <Clock className="size-5 text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-amber-300 text-sm">Session expired</p>
                            <p className="text-sm text-amber-200/80 mt-0.5">
                              Your checkout session timed out before consent was granted. Go back
                              and re-enter your details to start a fresh session.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            clearSessionId();
                            setConsentSessionGone(false);
                            setConsentUrl(null);
                            setStep("guest-info");
                          }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg border border-amber-500/40 text-amber-300 font-semibold text-sm hover:bg-amber-500/10 transition-colors"
                        >
                          <ArrowLeft className="size-4" /> Start over
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-charcoal-1 border border-white/[0.06] p-4 text-sm text-text-secondary">
                        Loading consent link…
                      </div>
                    )}

                    <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4 flex items-start gap-3">
                      <Clock className="size-5 text-accent-blue shrink-0 mt-0.5" />
                      <p className="text-sm text-text-primary">
                        Waiting for your Microsoft 365 administrator to complete consent — this
                        page will continue automatically.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step 3: Payment */}
                {step === "payment" && service && (
                  <div className="space-y-6">
                    {!paymentCanceled && (
                      <button
                        onClick={() => {
                          setPaymentError(null);
                          setSessionExpired(false);
                          setStep("consent");
                        }}
                        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <ArrowLeft className="size-3.5" /> Back
                      </button>
                    )}

                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">
                        {service.isFree ? "Review & confirm" : "Review & pay"}
                      </h2>
                      <p className="text-text-secondary mt-1">
                        {service.isFree ? "Confirm your free request details below." : "Confirm your order details below."}
                      </p>
                    </div>

                    {/* Order summary */}
                    <div className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-text-primary">{service.name}</p>
                          {service.description && (
                            <p className="text-sm text-text-secondary mt-0.5">
                              {service.description}
                            </p>
                          )}
                        </div>
                        {priceDisplay && (
                          <p className="font-numeric text-text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
                        )}
                      </div>
                      {guestInfo && (
                        <div className="border-t border-white/[0.06] pt-3 text-sm text-text-secondary">
                          <span className="font-medium text-text-primary">Purchasing as:</span>{" "}
                          {guestInfo.name} · {guestInfo.email}
                        </div>
                      )}
                    </div>

                    {/* Payment canceled notice */}
                    {paymentCanceled && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
                        <XCircle className="size-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-300 text-sm">
                            Payment was not completed
                          </p>
                          <p className="text-sm text-amber-200/80 mt-0.5">
                            You left the Stripe payment page before completing your purchase. Your
                            information has been saved — click "Proceed to payment" to try again.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Session expired */}
                    {sessionExpired && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
                        <Clock className="size-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-300 text-sm">Session expired</p>
                          <p className="text-sm text-amber-200/80 mt-0.5">
                            Your checkout session timed out. Click "Proceed to payment" to start a
                            fresh session — your information has been saved.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Payment error */}
                    {paymentError && !sessionExpired && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                        <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-red-400 text-sm">{service.isFree ? "Registration error" : "Payment error"}</p>
                          <p className="text-sm text-red-300/80 mt-0.5">{paymentError}</p>
                        </div>
                      </div>
                    )}

                    {/* Terms / clickwrap — accepted earlier at the info step (before M365 consent).
                        Normally we just confirm that prior acceptance. If the acceptance state
                        didn't survive (e.g. localStorage wiped during the cross-origin redirect),
                        fall back to an interactive checkbox so the user is never hard-blocked.
                        Either way the pay button stays gated on termsAccepted below. */}
                    {termsAccepted ? (
                      <div className="flex items-start gap-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4">
                        <CheckCircle2 className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <p className="text-sm text-text-secondary leading-snug">
                          You've agreed to the{" "}
                          <Link href="/legal/terms" className="underline text-accent-blue">
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link href="/legal/privacy" className="underline text-accent-blue">
                            Privacy Policy
                          </Link>
                          . {service.isFree
                            ? 'Clicking "Confirm and Get Started" will register your free account and start onboarding.'
                            : 'Clicking "Proceed to payment" will redirect you to Stripe to complete the purchase.'}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="terms-check"
                          checked={termsAccepted}
                          onCheckedChange={(v) => setTermsAccepted(!!v)}
                          className="border-white/20 data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue"
                        />
                        <label
                          htmlFor="terms-check"
                          className="text-sm text-text-secondary leading-snug cursor-pointer"
                        >
                          I agree to the{" "}
                          <Link href="/legal/terms" className="underline text-accent-blue">
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link href="/legal/privacy" className="underline text-accent-blue">
                            Privacy Policy
                          </Link>
                          . {service.isFree ? (
                            'I understand that clicking "Confirm and Get Started" will register my free account and start onboarding.'
                          ) : (
                            'I understand that clicking "Proceed to payment" will redirect me to Stripe to complete the purchase.'
                          )}
                        </label>
                      </div>
                    )}

                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <ShieldCheck className="size-4 text-accent-blue shrink-0 mt-0.5" />
                      <span>
                        {service.isFree ? (
                          "Your M365 configuration snapshot will begin immediately. No credit card required."
                        ) : (
                          "Payments are processed securely by Stripe. Your card details are never stored on our servers."
                        )}
                      </span>
                    </div>

                    <div className="my-6">
                      <CaptchaGate onVerify={setCaptchaToken} />
                    </div>

                    <Button
                      onClick={service.isFree ? handleFreeCheckout : handlePay}
                      disabled={launching || !termsAccepted || !captchaToken}
                      className="w-full text-white"
                      style={GRADIENT_BG}
                      size="lg"
                    >
                      {launching ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />{" "}
                          {service.isFree ? "Setting up snapshot…" : "Preparing secure checkout…"}
                        </>
                      ) : service.isFree ? (
                        <>
                          Confirm and Get Started <ArrowRight className="ml-2 size-4" />
                        </>
                      ) : (
                        <>
                          Proceed to payment <ExternalLink className="ml-2 size-4" />
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Step 4: Confirmed — self-serve services verify a 6-digit code and
                    set their password inline (#143); signature-required services keep
                    the manual-onboarding confirmation below, untouched. */}
                {step === "confirmed" && service && !requiresSignature && (sessionId ?? loadSessionId()) && (
                  <ConfirmedSelfServeStep
                    service={service}
                    slug={slug ?? service.slug ?? ""}
                    sessionId={(sessionId ?? loadSessionId())!}
                    guestEmail={guestInfo?.email ?? null}
                    initialHasPassword={confirmedHasPassword}
                    priceDisplay={priceDisplay}
                  />
                )}
                {step === "confirmed" && (!service || requiresSignature || !(sessionId ?? loadSessionId())) && (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-2">
                      <CheckCircle2 className="size-8 text-accent-blue" />
                    </div>
                    <h2 className="font-display text-2xl font-semibold text-text-primary">
                      Order <GradientText>confirmed</GradientText>!
                    </h2>
                    {guestInfo?.email ? (
                      <p className="text-text-secondary max-w-sm">
                        Thank you for your purchase. You'll receive an email at{" "}
                        <strong className="text-text-primary">{guestInfo.email}</strong> with account setup instructions within
                        one business day.
                      </p>
                    ) : (
                      <p className="text-text-secondary max-w-sm">
                        Thank you for your purchase. You'll receive setup instructions by email
                        within one business day.
                      </p>
                    )}
                    <p className="text-sm text-text-secondary max-w-sm">
                      Shane will personally reach out to schedule your onboarding call and begin
                      your engagement.
                    </p>
                    <Link
                      href="/"
                      className="mt-2 inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
                      onClick={() => {
                        const sid = sessionId ?? loadSessionId();
                        if (sid) clearGuestInfoCache(sid);
                        clearSessionId();
                      }}
                    >
                      Return home
                    </Link>
                  </div>
                )}
              </GlassPanel>

              <p className="text-center text-xs text-text-secondary mt-6">
                Payments are securely processed by Stripe. Your email and payment information are
                never stored on our servers.
              </p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
