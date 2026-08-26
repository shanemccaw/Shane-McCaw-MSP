import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug, getStoredSlug, storeSlug } from "@/lib/slug-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Lock,
  KeyRound,
  Smartphone,
  Mail,
  User,
  ShieldCheck,
} from "lucide-react";

// ── Schemas ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

const totpSchema = z.object({
  code: z.string().min(6, "Enter the 6-digit code").max(6),
});
type TotpForm = z.infer<typeof totpSchema>;

const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

// ── Tenant branding ───────────────────────────────────────────────────────────

interface TenantBranding {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

function useTenantBranding(slug: string | null): TenantBranding | null {
  const [branding, setBranding] = useState<TenantBranding | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/portal/branding?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TenantBranding | null) => {
        if (data) {
          setBranding(data);
          if (data.primaryColor) {
            document.documentElement.style.setProperty("--msp-brand-login-color", data.primaryColor);
          }
        }
      })
      .catch(() => {});

    return () => {
      document.documentElement.style.removeProperty("--msp-brand-login-color");
    };
  }, [slug]);

  return branding;
}

// ── Copy map (verbatim from design handoff) ───────────────────────────────────
// Only steps with a real backing auth call get a COPY entry — the design's
// code-entry password-reset steps (resetCode/resetNew) have no backend
// counterpart on this page (see ForgotPasswordCard below), so they're not
// reproduced here.

const COPY = {
  signin: {
    eyebrow: "Customer portal",
    heading: "Sign in to your portal",
    subheading: "One place for your tenant’s findings, runbooks and change records.",
    quip: "Your tenant score doesn’t improve while you’re standing out here.",
  },
  mfa: {
    eyebrow: "Two-factor",
    heading: "Confirm it’s you",
    subheading: "Six digits from your authenticator app finishes the sign-in.",
    quip: "We flag tenants that skip MFA. Would be awkward to skip our own.",
  },
  resetEmail: {
    eyebrow: "Password reset",
    heading: "Reset your password",
    subheading: "Tell us your email address and we’ll send you a reset link.",
    quip: "Forgetting a password is not a governance finding. Reusing one is.",
  },
};

const ENGINES = [
  { name: "Drift Engine", watches: "config changes", color: "#60a5fa" },
  { name: "Security Engine", watches: "MFA, CA, OAuth apps", color: "#a78bfa" },
  { name: "Health Engine", watches: "service incidents", color: "#22c55e" },
  { name: "SLA Engine", watches: "response times", color: "#22d3ee" },
  { name: "Scope Creep Engine", watches: "work outside the SOW", color: "#fbbf24" },
  { name: "Sales Offer Engine", watches: "licence and renewal fit", color: "#2dd4bf" },
];

const FACTS = [
  { label: "Checks per scan", value: "158", note: "across six pillars", tone: "#f8fafc" },
  { label: "Scan cadence", value: "Hourly", note: "every day, no gaps", tone: "#f8fafc" },
  { label: "Access model", value: "Read-only", note: "writes need approval", tone: "#2dd4bf" },
  { label: "Change records", value: "Every write", note: "logged and reversible", tone: "#a78bfa" },
];

// ── Shared shell ──────────────────────────────────────────────────────────────

function LoginShell({
  brandMark,
  children,
}: {
  brandMark: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen grid min-[1020px]:grid-cols-[1.02fr_0.98fr] bg-[#020617] text-[#f8fafc]">
      <div className="relative flex flex-col overflow-hidden px-6 py-8 sm:px-11 sm:py-9">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle 760px at 18% 42%, rgba(139,92,246,.16), rgba(2,6,23,0) 62%), radial-gradient(circle 620px at 6% -12%, rgba(0,120,212,.10), rgba(2,6,23,0) 60%)",
          }}
        />
        <Lock
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-[300px] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
          style={{ filter: "drop-shadow(0 0 40px rgba(139,92,246,.55))" }}
          strokeWidth={0.7}
          color="#a78bfa"
        />

        <div className="relative flex items-center gap-2.5">{brandMark}</div>

        <div className="relative flex flex-1 items-center">
          <div
            className="mx-auto my-6 flex w-full max-w-[436px] flex-col overflow-hidden rounded-2xl border p-6 pb-6 backdrop-blur-sm"
            style={{
              background:
                "linear-gradient(160deg, rgba(139,92,246,.10), rgba(11,21,36,.62) 55%, rgba(11,21,36,.44))",
              borderColor: "rgba(139,92,246,.22)",
              boxShadow: "0 0 70px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.07)",
            }}
          >
            {children}
          </div>
        </div>
      </div>

      <aside
        className="relative hidden min-[1020px]:flex flex-col justify-center gap-4 overflow-hidden border-l px-10 py-9"
        style={{
          background: "linear-gradient(160deg, #04121f, #071324 52%, #020617)",
          borderColor: "rgba(148,163,184,.08)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle 620px at 82% 8%, rgba(0,180,216,.16), rgba(2,6,23,0) 62%), radial-gradient(circle 520px at 20% 96%, rgba(45,212,191,.09), rgba(2,6,23,0) 60%)",
          }}
        />

        <div className="relative mx-auto flex w-full max-w-[420px] flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.2em] text-[#64748b]">
              Behind this login
            </span>
            <p className="m-0 text-base font-bold leading-snug tracking-tight text-[#f8fafc]">
              Six engines have been watching your tenant while you were out.
            </p>
            <p className="m-0 text-[12.5px] leading-relaxed text-[#94a3b8]">
              We won&#8217;t pretend to know your numbers from out here. Sign in and they&#8217;re
              the first thing you see.
            </p>
          </div>

          <div
            className="flex flex-col gap-px rounded-2xl border p-4"
            style={{ background: "rgba(11,21,36,.66)", borderColor: "rgba(30,41,59,.9)" }}
          >
            <div className="mb-2 flex items-center gap-2.5">
              <span
                className="size-[7px] rounded-full bg-[#2dd4bf] motion-safe:animate-pulse motion-reduce:animate-none"
                style={{ boxShadow: "0 0 0 3px rgba(45,212,191,.16)" }}
              />
              <span className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-[#2dd4bf]">
                All engines operational
              </span>
              <span className="ml-auto font-mono text-[10px] font-bold text-[#475569]">
                HOURLY
              </span>
            </div>
            {ENGINES.map((e) => (
              <div
                key={e.name}
                className="flex items-center gap-2.5 border-t py-1.5"
                style={{ borderColor: "rgba(30,41,59,.6)" }}
              >
                <span
                  className="flex size-[26px] shrink-0 items-center justify-center rounded-lg border"
                  style={{ background: `${e.color}1A`, borderColor: `${e.color}33` }}
                >
                  <ShieldCheck className="size-3.5" style={{ color: e.color }} />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold text-[#cbd5e1]">
                  {e.name}
                </span>
                <span className="shrink-0 text-[10.5px] text-[#64748b]">{e.watches}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {FACTS.map((f) => (
              <div
                key={f.label}
                className="flex flex-col gap-0.5 rounded-2xl border p-3.5"
                style={{ background: "rgba(11,21,36,.6)", borderColor: "rgba(30,41,59,.9)" }}
              >
                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
                  {f.label}
                </span>
                <span
                  className="text-xl font-extrabold tracking-tight"
                  style={{ color: f.tone }}
                >
                  {f.value}
                </span>
                <span className="text-[10.5px] text-[#64748b]">{f.note}</span>
              </div>
            ))}
          </div>

          <p className="m-0 text-[11px] leading-relaxed text-[#475569]">
            Platform figures, not yours. Your score, findings and runbooks load after sign-in.
          </p>
        </div>
      </aside>
    </div>
  );
}

function StepHeader({
  eyebrow,
  heading,
  subheading,
  quip,
}: {
  eyebrow: string;
  heading: string;
  subheading: string;
  quip: string;
}) {
  return (
    <>
      <span className="mb-3.5 inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-[#a78bfa]">
        <span
          className="size-1.5 rounded-full bg-[#a78bfa] motion-safe:animate-pulse motion-reduce:animate-none"
          style={{ boxShadow: "0 0 0 3px rgba(139,92,246,.18)" }}
        />
        {eyebrow}
      </span>
      <h1 className="m-0 mb-2 text-[27px] font-extrabold leading-tight tracking-tight text-[#f8fafc]">
        {heading}
      </h1>
      <p className="m-0 mb-3.5 text-[13.5px] leading-relaxed text-[#94a3b8]">{subheading}</p>
      <p
        className="m-0 mb-5 border-l-2 pl-2.5 text-xs leading-relaxed text-[#64748b]"
        style={{ borderColor: "rgba(139,92,246,.4)" }}
      >
        {quip}
      </p>
    </>
  );
}

const inputClass =
  "h-auto rounded-md border bg-[#071324] px-3.5 py-2.5 text-[13.5px] font-medium text-[#f8fafc] shadow-none placeholder:text-[#475569] focus-visible:ring-0";
const inputStyle = { borderColor: "rgba(148,163,184,.18)" } as const;

const primaryButtonClass =
  "w-full rounded-md border-0 bg-[#0078D4] py-3 text-[13.5px] font-bold text-white hover:bg-[#005A9E] motion-reduce:transition-none";

// ── MFA challenge step ────────────────────────────────────────────────────────

function MfaChallenge({
  mfaToken,
  methods,
  userLabel,
  onSuccess,
  onCancel,
}: {
  mfaToken: string;
  methods: string[];
  userLabel: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { completeMfaLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Emergency-bypass path — for a user locked out of their MFA device who was
  // issued a single-use code by their team admin (customer-team.tsx). Reachable
  // from either MFA-challenge branch; consumes the code at /api/auth/mfa/bypass.
  const [showBypass, setShowBypass] = useState(false);
  const [bypassCode, setBypassCode] = useState("");
  const [bypassError, setBypassError] = useState<string | null>(null);
  const [bypassSubmitting, setBypassSubmitting] = useState(false);

  async function onSubmitBypass(e: FormEvent) {
    e.preventDefault();
    setBypassError(null);
    setBypassSubmitting(true);
    try {
      const res = await fetch("/api/auth/mfa/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfaToken, code: bypassCode.trim() }),
      });
      const json = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
        refreshExpiresAt?: string;
        error?: string;
      };
      if (!res.ok) {
        setBypassError(json.error ?? "Invalid or expired bypass code.");
        return;
      }
      if (json.accessToken) {
        completeMfaLogin(json.accessToken, json.refreshToken, json.refreshExpiresAt);
      }
      onSuccess();
    } catch {
      setBypassError("A network error occurred. Please try again.");
    } finally {
      setBypassSubmitting(false);
    }
  }

  const hasTotp = methods.includes("totp");

  const initials = ((userLabel.trim()[0] || "S") + (userLabel.split("@")[1]?.[0] || "m")).toUpperCase();

  const userBadge = (
    <div
      className="flex items-center gap-2.5 rounded-md border p-2.5"
      style={{ background: "#0b1524", borderColor: "rgba(30,41,59,.9)" }}
    >
      <div
        className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold text-white"
        style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
      >
        {initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px] font-bold text-[#f8fafc]">{userLabel}</span>
        <span className="text-[10.5px] text-[#64748b]">Password accepted</span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10.5px] font-bold text-[#94a3b8] transition-colors hover:border-[rgba(148,163,184,.4)] hover:text-[#f8fafc] motion-reduce:transition-none"
        style={{ borderColor: "rgba(148,163,184,.16)" }}
      >
        Change
      </button>
    </div>
  );

  if (showBypass) {
    return (
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-[#a78bfa]" />
          <span className="text-lg font-semibold">Emergency bypass code</span>
        </div>
        <p className="text-sm text-[#94a3b8]">
          Enter the single-use emergency bypass code your administrator gave you. It allows one
          sign-in without MFA and cannot be reused.
        </p>
        <form onSubmit={onSubmitBypass} className="flex flex-col gap-4">
          {bypassError && (
            <Alert variant="destructive">
              <AlertDescription>{bypassError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="bypass-code" className="text-[11px] font-bold tracking-wide text-[#94a3b8]">
              Bypass code
            </Label>
            <Input
              id="bypass-code"
              type="text"
              autoComplete="off"
              placeholder="EMERGENCY-XXXX-XXXX-XXXX-XXXX"
              className={cn(inputClass, "text-center font-mono tracking-wide")}
              style={inputStyle}
              value={bypassCode}
              onChange={(e) => setBypassCode(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className={primaryButtonClass}
            disabled={bypassSubmitting || !bypassCode.trim()}
          >
            {bypassSubmitting && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
            {bypassSubmitting ? "Verifying…" : "Use bypass code"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-[#94a3b8] hover:text-[#f8fafc]"
            onClick={() => {
              setShowBypass(false);
              setBypassError(null);
            }}
          >
            Back to two-factor verification
          </button>
        </form>
      </div>
    );
  }

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<TotpForm>({ resolver: zodResolver(totpSchema) });
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const { ref: codeFieldRef, ...codeField } = register("code");
  const code = (watch("code") ?? "").replace(/\D/g, "").slice(0, 6);

  async function onSubmitTotp(data: TotpForm) {
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/totp/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfaToken, code: data.code.replace(/\s/g, "") }),
      });
      const json = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
        refreshExpiresAt?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Invalid code. Please try again.");
        return;
      }
      if (json.accessToken) {
        completeMfaLogin(json.accessToken, json.refreshToken, json.refreshExpiresAt);
      }
      onSuccess();
    } catch {
      setError("A network error occurred. Please try again.");
    }
  }

  if (hasTotp) {
    const boxChars = code.padEnd(6, " ").slice(0, 6).split("");
    return (
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
        <div className="flex items-center gap-2 text-[#22d3ee]">
          <Smartphone className="size-4" />
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-[#64748b]">
            Authenticator app
          </span>
        </div>
        {userBadge}
        <form onSubmit={handleSubmit(onSubmitTotp)} className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div
            className="relative cursor-text"
            onClick={() => codeInputRef.current?.focus()}
          >
            <div className="flex gap-2.5">
              {boxChars.map((ch, i) => (
                <span
                  key={i}
                  className="flex h-12 flex-1 items-center justify-center rounded-md border font-mono text-lg font-bold"
                  style={{
                    background: "#071324",
                    borderColor: ch.trim() ? "#0078D4" : "rgba(148,163,184,.16)",
                    color: ch.trim() ? "#f8fafc" : "#334155",
                  }}
                >
                  {ch.trim() || "–"}
                </span>
              ))}
            </div>
            <input
              {...codeField}
              ref={(el) => {
                codeFieldRef(el);
                codeInputRef.current = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label="Six-digit verification code"
              className="absolute inset-0 h-full w-full cursor-text border-none bg-transparent opacity-0"
            />
          </div>

          <Button type="submit" className={primaryButtonClass} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
            {isSubmitting ? "Verifying…" : "Verify and Sign In"}
          </Button>
          <p className="m-0 text-[11.5px] leading-relaxed text-[#64748b]">
            Six digits from your authenticator app. No access to it?{" "}
            <button
              type="button"
              className="font-semibold text-[#60a5fa] hover:text-[#93c5fd]"
              onClick={() => setShowBypass(true)}
            >
              Use an emergency bypass code
            </button>
            .
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      {userBadge}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-[#94a3b8]">
        Your account requires MFA. Available methods: {methods.join(", ")}.
      </p>
      <Button
        variant="outline"
        className="w-full border-[rgba(148,163,184,.16)] bg-transparent text-[#94a3b8] hover:text-[#f8fafc]"
        onClick={onCancel}
      >
        Back to sign in
      </Button>
      <button
        type="button"
        className="w-full text-center text-xs text-[#94a3b8] underline hover:text-[#f8fafc]"
        onClick={() => setShowBypass(true)}
      >
        Lost your device? Use an emergency bypass code
      </button>
    </div>
  );
}

// ── Forgot password step ──────────────────────────────────────────────────────

function ForgotPasswordCard({ onCancel }: { onCancel: () => void }) {
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(data: ForgotPasswordForm) {
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: data.email }),
      });
    } catch {
      // Ignore network errors here — the endpoint never reveals whether the
      // email exists, so there is nothing user-actionable to surface either way.
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
        <div
          className="flex items-center gap-2.5 rounded-md border p-2.5"
          style={{ background: "rgba(0,180,216,.07)", borderColor: "rgba(0,180,216,.26)" }}
        >
          <Mail className="size-3.5 shrink-0 text-[#22d3ee]" />
          <span className="text-[12.5px] font-bold text-[#f8fafc]">Check your email</span>
        </div>
        <p className="text-sm text-[#94a3b8]">
          If an account exists for that email, we've sent a link to reset your password.
        </p>
        <Button
          variant="outline"
          className="w-full border-[rgba(148,163,184,.16)] bg-transparent text-[#94a3b8] hover:text-[#f8fafc]"
          onClick={onCancel}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="forgot-email" className="text-[11px] font-bold tracking-wide text-[#94a3b8]">
          Email address
        </Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#475569]" />
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className={cn(inputClass, "pl-9")}
            style={inputStyle}
            {...register("email")}
          />
        </div>
        {errors.email && <p className="text-xs text-[#fb7185]">{errors.email.message}</p>}
      </div>
      <Button type="submit" className={primaryButtonClass} disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
        {isSubmitting ? "Sending…" : "Email Me a Reset Link"}
      </Button>
      <button
        type="button"
        className="w-full rounded-md border py-2.5 text-xs font-semibold text-[#94a3b8] transition-colors hover:border-[rgba(148,163,184,.4)] hover:text-[#f8fafc] motion-reduce:transition-none"
        style={{ borderColor: "rgba(148,163,184,.16)" }}
        onClick={onCancel}
      >
        Back to sign in
      </button>
    </form>
  );
}

// ── Main login page ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login, user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<{ mfaToken: string; methods: string[] } | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // Slug from context (slug-scoped router) takes priority over ?t= query param
  // (which is kept for backwards compatibility with any direct links).
  const ctxSlug = useMspSlug();
  const querySlug = new URLSearchParams(search).get("t") ?? null;
  const tenantSlug = ctxSlug ?? querySlug;

  const branding = useTenantBranding(tenantSlug);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const emailValue = watch("email");

  // If already authenticated, redirect to landing page.
  // In slug-scoped context navigate("/identity") auto-resolves to
  // /portal/{slug}/identity. In flat context it resolves to /portal/identity
  // — acceptable fallback.
  // /portal/ is customer-only (Git #1296): every non-CustomerUser role lands
  // on the identity interstitial instead of /dashboard, so a staff account
  // that ends up here gets a real choice rather than silently landing on a
  // customer-facing page. CustomerUser is unaffected — still /portal-v2.
  const defaultLanding = isLoading
    ? "/dashboard"
    : user?.mspRole === "Assessment"
      ? "/copilot-readiness"
      : user?.mspRole === "CustomerUser"
        ? "/portal-v2"
        : "/identity";

  useEffect(() => {
    if (!isLoading && user) {
      navigate(defaultLanding, { replace: true });
    }
  }, [isLoading, user, navigate, defaultLanding]);

  async function onSubmit(data: LoginForm) {
    setServerError(null);
    try {
      const result = await login(data.email, data.password);
      if (result.mfaRequired && result.mfaToken) {
        setMfaState({ mfaToken: result.mfaToken, methods: result.methods ?? [] });
        return;
      }

      // An account under MFA enforcement with nothing enrolled yet (Git #439)
      // still lands here with a real result.user — just carrying
      // mfaSetupPending: true. The route-level gate (useMfaGate in App.tsx)
      // catches that on the very next render and redirects to /setup-mfa;
      // there is no separate dead-end branch for it here anymore.

      // Compute landing from the freshly-resolved user so CustomerUser
      // always goes to the /portal-v2 Overview, not dashboard (pre-login user
      // is null).
      const resolvedLanding =
        result.user?.mspRole === "Assessment"
          ? "/copilot-readiness"
          : result.user?.mspRole === "CustomerUser"
            ? "/portal-v2"
            : "/identity";

      if (ctxSlug) {
        // Inside slug-scoped router — navigate() auto-prefixes the slug.
        // e.g. "/m365-health" → /portal/{slug}/m365-health
        navigate(resolvedLanding);
      } else {
        // Flat /login context — no inner router to add the slug prefix.
        // Build the slug-prefixed path manually.
        // Prefer URL/query/storage slug; fall back to the slug embedded in
        // the user's JWT (mspSlug) so flat logins never dead-end.
        const slug = tenantSlug ?? getStoredSlug() ?? result.user?.mspSlug ?? null;
        if (slug) {
          storeSlug(slug);
          navigate(`/${slug}${resolvedLanding}`);
        } else {
          // No slug in URL, query, storage, or JWT — go to root and let
          // RootRedirect try again once auth state propagates.
          navigate("/");
        }
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Login failed");
    }
  }

  // Brand mark — shows MSP logo/name when a tenant slug is present, otherwise
  // the generic platform mark. Sits in the same top-left slot the design
  // reserves for a static "Shane McCaw" wordmark.
  const brandMark = branding ? (
    <>
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt={`${branding.name} logo`} className="h-8 w-auto object-contain" />
      ) : (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-extrabold tracking-tight text-white"
          style={{ background: `linear-gradient(135deg, ${branding.primaryColor ?? "#0078D4"}, #00B4D8)` }}
        >
          {branding.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex flex-col leading-tight">
        <span className="text-[13.5px] font-bold tracking-tight text-[#f8fafc]">{branding.name}</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
          Powered by Shane McCaw Consulting
        </span>
      </div>
    </>
  ) : (
    <>
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-extrabold tracking-tight text-white"
        style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
      >
        SM
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[13.5px] font-bold tracking-tight text-[#f8fafc]">Shane McCaw</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">
          Tenant Monitoring
        </span>
      </div>
    </>
  );

  const footer = (
    <div className="mt-5 flex flex-col gap-2.5 border-t pt-4" style={{ borderColor: "rgba(30,41,59,.8)" }}>
      <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#64748b]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#2dd4bf]" />
        <span className="min-w-0 flex-1">
          Read-only by default. Every write we make is logged in your change record.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3.5 pl-[21px] text-[11.5px]">
        <span className="font-semibold text-[#94a3b8]">Access is provisioned by your administrator</span>
        <span className="h-[11px] w-px" style={{ background: "rgba(148,163,184,.22)" }} />
        <a href="/portal/trust" className="font-semibold text-[#94a3b8] underline hover:text-[#f8fafc]">
          Trust &amp; Privacy
        </a>
      </div>
    </div>
  );

  if (showForgotPassword) {
    return (
      <LoginShell brandMark={brandMark}>
        <StepHeader {...COPY.resetEmail} />
        <ForgotPasswordCard onCancel={() => setShowForgotPassword(false)} />
        {footer}
      </LoginShell>
    );
  }

  if (mfaState) {
    return (
      <LoginShell brandMark={brandMark}>
        <StepHeader {...COPY.mfa} />
        <MfaChallenge
          mfaToken={mfaState.mfaToken}
          methods={mfaState.methods}
          userLabel={emailValue || ""}
          onSuccess={() => {
            if (ctxSlug) {
              navigate(defaultLanding);
            } else {
              const slug = tenantSlug ?? getStoredSlug();
              navigate(slug ? `/${slug}${defaultLanding}` : "/");
            }
          }}
          onCancel={() => setMfaState(null)}
        />
        {footer}
      </LoginShell>
    );
  }

  return (
    <LoginShell brandMark={brandMark}>
      <StepHeader {...COPY.signin} />

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3.5">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-[11px] font-bold tracking-wide text-[#94a3b8]">
            Email
          </Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#475569]" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className={cn(inputClass, "pl-9")}
              style={inputStyle}
              data-testid="login-email"
              {...register("email")}
            />
          </div>
          {errors.email && <p className="text-xs text-[#fb7185]">{errors.email.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-[11px] font-bold tracking-wide text-[#94a3b8]">
            Password
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#475569]" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className={cn(inputClass, "pl-9")}
              style={inputStyle}
              data-testid="login-password"
              {...register("password")}
            />
          </div>
          {errors.password && <p className="text-xs text-[#fb7185]">{errors.password.message}</p>}
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            data-testid="login-forgot-password"
            className="text-xs font-semibold text-[#60a5fa] hover:text-[#93c5fd]"
            onClick={() => setShowForgotPassword(true)}
          >
            Forgot password
          </button>
        </div>

        <Button
          type="submit"
          className={primaryButtonClass}
          disabled={isSubmitting}
          data-testid="login-submit"
        >
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
          {isSubmitting ? "Signing in…" : "Sign In"}
        </Button>
        <p className="m-0 -mt-0.5 text-[11px] leading-relaxed text-[#475569]">
          Nothing is being scanned yet. That part starts on the other side of this button.
        </p>
      </form>

      {footer}
    </LoginShell>
  );
}
