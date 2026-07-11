import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug, getStoredSlug, storeSlug } from "@/lib/slug-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";

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

// ── MFA challenge step ────────────────────────────────────────────────────────

function MfaChallenge({
  mfaToken,
  methods,
  onSuccess,
  onCancel,
}: {
  mfaToken: string;
  methods: string[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { completeMfaLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const hasTotp = methods.includes("totp");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpForm>({ resolver: zodResolver(totpSchema) });

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
    return (
      <Card className="border-sidebar-border bg-card/95 backdrop-blur">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <CardTitle className="text-lg">Two-factor verification</CardTitle>
          </div>
          <CardDescription>
            Enter the 6-digit code from your authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmitTotp)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="code">Authenticator code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                className="text-center text-xl tracking-[0.4em] font-mono"
                {...register("code")}
              />
              {errors.code && (
                <p className="text-xs text-destructive">{errors.code.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isSubmitting ? "Verifying…" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground text-sm"
              onClick={onCancel}
            >
              Back to sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-sidebar-border bg-card/95 backdrop-blur">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Two-factor verification</CardTitle>
        <CardDescription>
          Your account requires MFA. Available methods: {methods.join(", ")}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          Please contact your administrator if you need assistance completing MFA.
        </p>
        <Button variant="outline" className="w-full" onClick={onCancel}>
          Back to sign in
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main login page ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login, user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<{ mfaToken: string; methods: string[] } | null>(null);

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
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  // If already authenticated, redirect to landing page.
  // In slug-scoped context navigate("/dashboard") auto-resolves to /portal/{slug}/dashboard.
  // In flat context it resolves to /portal/dashboard — acceptable fallback.
  const defaultLanding =
    !isLoading && user?.mspRole === "CustomerUser" ? "/customer-home" : "/dashboard";

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

      // Compute landing from the freshly-resolved user so CustomerUser
      // always goes to customer-home, not dashboard (pre-login user is null).
      const resolvedLanding =
        result.user?.mspRole === "CustomerUser" ? "/customer-home" : "/dashboard";

      if (ctxSlug) {
        // Inside slug-scoped router — navigate() auto-prefixes the slug.
        // e.g. "/customer-home" → /portal/{slug}/customer-home
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

  // Branded header — shows MSP logo/name when a tenant slug is present
  const brandedHeader = branding ? (
    <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
      {branding.logoUrl ? (
        <img
          src={branding.logoUrl}
          alt={`${branding.name} logo`}
          className="h-10 w-auto object-contain"
        />
      ) : (
        <ShieldCheck
          className="size-10"
          style={{ color: branding.primaryColor ?? "var(--sidebar-primary)" }}
        />
      )}
      <h1 className="text-xl font-semibold tracking-tight">{branding.name}</h1>
      <p className="text-sm text-sidebar-foreground/60">Powered by Shane McCaw Consulting</p>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
      <ShieldCheck className="size-10 text-sidebar-primary" />
      <h1 className="text-xl font-semibold tracking-tight">MSP Platform</h1>
      <p className="text-sm text-sidebar-foreground/60">Powered by Shane McCaw Consulting</p>
    </div>
  );

  if (mfaState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-sm space-y-6">
          {brandedHeader}
          <MfaChallenge
            mfaToken={mfaState.mfaToken}
            methods={mfaState.methods}
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
          <p className="text-center text-xs text-sidebar-foreground/40">
            Access is provisioned by your administrator
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm space-y-6">
        {brandedHeader}

        <Card className="border-sidebar-border bg-card/95 backdrop-blur">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Enter your credentials to access the portal</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {serverError && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-sidebar-foreground/40 space-x-3">
          <span>Access is provisioned by your administrator</span>
          <span>·</span>
          <a href="/portal/trust" className="hover:text-sidebar-foreground/70 underline">
            Trust &amp; Privacy
          </a>
        </div>
      </div>
    </div>
  );
}
