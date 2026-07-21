import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { storeSlug } from "@/lib/slug-context";
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
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Sparkles,
  ArrowRight,
  Rocket,
  LayoutDashboard,
} from "lucide-react";

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type FormData = z.infer<typeof schema>;

interface SetupResponse {
  accessToken?: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  user?: {
    mspRole?: string;
    mspSlug?: string;
  };
  error?: string;
}

/** Real purchase context resolved from the setup token (GET /api/auth/setup-context). */
interface SetupContext {
  clientName: string | null;
  firstName: string | null;
  role: string | null;
  slug: string | null;
  products: { name: string; tagline: string | null; category: string | null }[];
}

/** Where setup-password sends the buyer next — kept in sync with onSubmit's landing logic. */
function destinationForRole(role: string | null): { label: string; icon: typeof Rocket } {
  if (role === "Assessment") return { label: "Run your first assessment", icon: Rocket };
  if (role === "CustomerUser") return { label: "Open your dashboard", icon: LayoutDashboard };
  return { label: "Enter your workspace", icon: LayoutDashboard };
}

/** The one-line expectation under the greeting, grounded in what was actually bought. */
function expectationForRole(role: string | null): string {
  if (role === "Assessment") return "You're one password away from your first real assessment.";
  if (role === "CustomerUser") return "You're one password away from your live dashboard.";
  return "You're one password away from your workspace.";
}

export default function AccountSetupPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("setup_token") ?? "";
  const { completeMfaLogin } = useAuth();
  const [, navigate] = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [context, setContext] = useState<SetupContext | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // Fetch the real purchase behind this setup link so the page can name what the
  // customer actually bought instead of showing a generic form. Best-effort: any
  // failure (or a token with no owned services yet) simply falls back to a warm,
  // non-specific welcome — we never invent a product name.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/auth/setup-context?token=${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        if (!cancelled && res.ok) {
          const json = (await res.json()) as SetupContext;
          setContext(json);
        }
      } catch {
        /* keep the generic welcome */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: data.password }),
      });
      const json = (await res.json()) as SetupResponse;
      if (!res.ok) {
        setServerError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (json.accessToken) {
        completeMfaLogin(json.accessToken, json.refreshToken, json.refreshExpiresAt);
        setDone(true);
        const slug = json.user?.mspSlug ?? null;
        const landing =
          json.user?.mspRole === "Assessment"
            ? "assessment"
            : json.user?.mspRole === "CustomerUser"
              ? "customer-dashboard"
              : "dashboard";
        if (slug) {
          storeSlug(slug);
          setTimeout(() => navigate(`/${slug}/${landing}`, { replace: true }), 1500);
        } else {
          setTimeout(() => navigate("/", { replace: true }), 1500);
        }
      }
    } catch {
      setServerError("A network error occurred. Please try again.");
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
            <ShieldCheck className="size-10 text-sidebar-primary" />
            <h1 className="text-xl font-semibold tracking-tight">MSP Platform</h1>
            <p className="text-sm text-sidebar-foreground/60">Powered by Shane McCaw Consulting</p>
          </div>
          <Card className="border-sidebar-border bg-card/95 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Invalid link</CardTitle>
              <CardDescription>
                This setup link is missing or malformed. Please use the link from your invitation
                email, or contact support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (done) {
    const dest = destinationForRole(context?.role ?? null);
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-sm space-y-6 text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="flex flex-col items-center gap-3 text-sidebar-foreground">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping motion-reduce:hidden" />
              <CheckCircle2 className="relative size-12 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">You're all set!</h1>
            <p className="text-sm text-sidebar-foreground/60 flex items-center gap-1.5">
              <dest.icon className="size-4 text-sidebar-primary" />
              {dest.label}…
            </p>
          </div>
        </div>
      </div>
    );
  }

  const primary = context?.products?.[0] ?? null;
  const firstName = context?.firstName ?? null;
  const role = context?.role ?? null;
  const dest = destinationForRole(role);

  const steps: { label: string; state: "done" | "current" | "upcoming"; icon: typeof Rocket }[] = [
    { label: "Order confirmed", state: "done", icon: CheckCircle2 },
    { label: "Create your password", state: "current", icon: Lock },
    { label: dest.label, state: "upcoming", icon: dest.icon },
  ];

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground flex items-center justify-center p-4 sm:p-6">
      {/* Ambient brand glow behind the celebratory moment. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60rem 40rem at 20% -10%, hsl(var(--sidebar-primary) / 0.14), transparent 60%)",
        }}
      />

      <div className="relative w-full max-w-5xl grid gap-10 lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:gap-16 items-center">
        {/* ── Celebratory hero: what actually just happened ─────────────────── */}
        <div className="space-y-7">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/40 px-3 py-1 text-xs font-medium uppercase tracking-wider text-sidebar-primary animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
            style={{ animationFillMode: "both" }}
          >
            <Sparkles className="size-3.5" />
            Purchase complete
          </div>

          <div className="space-y-3">
            <h1
              className="text-3xl sm:text-4xl font-semibold tracking-tight animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none"
              style={{ animationDelay: "80ms", animationFillMode: "both" }}
            >
              {firstName ? `You're in, ${firstName}.` : "You're in."}
            </h1>

            <p
              className="text-base sm:text-lg text-sidebar-foreground/70 animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none"
              style={{ animationDelay: "160ms", animationFillMode: "both" }}
            >
              {primary ? (
                <>
                  Your purchase of{" "}
                  <span className="font-semibold text-sidebar-foreground">{primary.name}</span> is
                  confirmed. {expectationForRole(role)}
                </>
              ) : (
                <>Your order is confirmed. {expectationForRole(role)}</>
              )}
            </p>

            {primary?.tagline && (
              <p
                className="text-sm text-sidebar-foreground/50 animate-in fade-in duration-500 motion-reduce:animate-none"
                style={{ animationDelay: "240ms", animationFillMode: "both" }}
              >
                {primary.tagline}
              </p>
            )}
          </div>

          {/* Extra owned services, if the order bundled more than one. */}
          {context && context.products.length > 1 && (
            <div
              className="flex flex-wrap gap-2 animate-in fade-in duration-500 motion-reduce:animate-none"
              style={{ animationDelay: "300ms", animationFillMode: "both" }}
            >
              {context.products.slice(1).map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-sidebar-border bg-sidebar-accent/30 px-2.5 py-1 text-xs text-sidebar-foreground/70"
                >
                  <CheckCircle2 className="size-3 text-emerald-400" />
                  {p.name}
                </span>
              ))}
            </div>
          )}

          {/* Grounded "what happens next" rail — the real 3-step path from here. */}
          <ol
            className="space-y-4 pt-2 animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none"
            style={{ animationDelay: "340ms", animationFillMode: "both" }}
          >
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.label} className="flex items-center gap-3">
                  <div className="relative flex flex-col items-center">
                    <span
                      className={
                        step.state === "done"
                          ? "flex size-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400"
                          : step.state === "current"
                            ? "relative flex size-8 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground"
                            : "flex size-8 items-center justify-center rounded-full border border-sidebar-border text-sidebar-foreground/40"
                      }
                    >
                      {step.state === "current" && (
                        <span className="absolute inset-0 rounded-full bg-sidebar-primary/40 animate-ping motion-reduce:hidden" />
                      )}
                      <Icon className="relative size-4" />
                    </span>
                    {i < steps.length - 1 && (
                      <span className="absolute top-8 h-4 w-px bg-sidebar-border" />
                    )}
                  </div>
                  <span
                    className={
                      step.state === "upcoming"
                        ? "text-sm text-sidebar-foreground/45"
                        : step.state === "current"
                          ? "text-sm font-medium text-sidebar-foreground"
                          : "text-sm text-sidebar-foreground/70"
                    }
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* ── Password card: unchanged account-security logic ───────────────── */}
        <Card
          className="border-sidebar-border bg-card/95 backdrop-blur shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none"
          style={{ animationDelay: "120ms", animationFillMode: "both" }}
        >
          <CardHeader className="space-y-1.5 pb-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-sidebar-primary">
              <Lock className="size-3.5" />
              Last step
            </div>
            <CardTitle className="text-lg">Create your password</CardTitle>
            <CardDescription>
              Choose a secure password — at least 8 characters. This is how you'll sign in from now
              on. <ArrowRight className="inline size-3.5 align-[-1px]" /> {dest.label}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {serverError && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  {...register("confirm")}
                />
                {errors.confirm && (
                  <p className="text-xs text-destructive">{errors.confirm.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isSubmitting ? "Setting up…" : "Set password & sign in"}
              </Button>
            </form>

            <div className="mt-5 text-center text-xs text-sidebar-foreground/40 space-x-3">
              <span>Access is provisioned by your administrator</span>
              <span>·</span>
              <a href="/portal/trust" className="hover:text-sidebar-foreground/70 underline">
                Trust &amp; Privacy
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
