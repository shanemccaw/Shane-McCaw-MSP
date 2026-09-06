import { useEffect, useState, type FormEvent } from "react";
import { useLocation, Link } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth, AuthApiError, type SetupContext } from "@/lib/auth-context";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeadState {
  kicker: string;
  tone: "warning" | "destructive";
  title: string;
  body: string;
  next: string;
  ctaLabel: string;
  ctaHref: string;
  wire: string;
}

const DEAD: Record<"badtoken" | "nouser" | "notent", DeadState> = {
  badtoken: {
    kicker: "LINK NOT USABLE",
    tone: "destructive",
    title: "This setup link is invalid or has expired",
    body: "Setup links last seventy-two hours and work once. Expired, already used, and never real all produce this same message — the backend does not distinguish them to the caller.",
    next: "Requesting a fresh one is safe: use the forgot-password route with the address the invite went to.",
    ctaLabel: "Send me a new link",
    ctaHref: "/forgot-password",
    wire: '404 { error: "This setup link is invalid or has expired." } · auth.ts:662',
  },
  nouser: {
    kicker: "ACCOUNT MISSING",
    tone: "destructive",
    title: "The account this link belongs to no longer exists",
    body: "The link itself is still within its window, but the user it was minted for cannot be found. This is a distinct case from an expired link, and it is not something you can fix from here.",
    next: "Someone needs to look at the account itself. Sign-in help raises that with a human.",
    ctaLabel: "Get sign-in help",
    ctaHref: "/sign-in-help",
    wire: '404 { error: "Account not found." } · auth.ts:673',
  },
  notent: {
    kicker: "CANNOT COMPLETE SETUP",
    tone: "warning",
    title: "There is no active service on this account yet",
    body: "Your link is genuine, but setup is refused because the account has nothing purchased behind it. This is checked again at the moment a password is set, precisely so a link issued too early cannot be used later.",
    next: "If you have signed an order or paid an invoice and still see this, the service has not been attached to your account yet — that is the thing to chase.",
    ctaLabel: "Back to sign in",
    ctaHref: "/login",
    wire: '409 { error: "account_not_entitled" } · auth.ts:584-591',
  },
};

const FACTS = [
  "The greeting, your role, your tenant slug and the list below all come from one read of the link before the form is shown. None of it is typed in here.",
  "At most four purchases are listed, most recent first. The list is real client-service rows, not a catalogue.",
  "Entitlement is checked twice: once when the link was minted, and again at the moment you press the button. A link that was valid at issue can still be refused here.",
  "This is the one setup-flow route that signs you in on success — password saved and a full session issued in the same response.",
  "A brand-new account has no MFA enrolled by construction, so the session comes back flagged as MFA-setup-pending when enforcement is on. Enrolment happens inside the portal, not on this screen.",
];

/**
 * Auth — Account setup (#2991, Feature #1648). Wired to
 * GET /api/auth/setup-context (auth.ts:649-715) then
 * POST /api/auth/setup-password (auth.ts:547-639), per contract pack §1.
 */
export default function AccountSetupPage() {
  const { getSetupContext, setupPassword } = useAuth();
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<SetupContext | null>(null);
  const [dead, setDead] = useState<DeadState | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setDead(DEAD.badtoken);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await getSetupContext(token);
        if (!cancelled) setContext(ctx);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthApiError && err.message === "Account not found.") {
          setDead(DEAD.nouser);
        } else {
          setDead(DEAD.badtoken);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, getSetupContext]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await setupPassword(token, password);
      navigate("/");
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 409) {
        setDead(DEAD.notent);
      } else if (err instanceof AuthApiError) {
        setDead({ ...DEAD.badtoken, title: err.message });
      }
    } finally {
      setBusy(false);
    }
  }

  const isAssessment = context?.role === "Assessment";

  return (
    <AuthPageShell
      title="Set up your portal account"
      subtitle="Shane McCaw Consulting"
      maxWidthClassName="max-w-[520px]"
    >
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your link…
        </Card>
      ) : dead ? (
        <Card className={`flex flex-col gap-3 p-5 ${dead.tone === "warning" ? "border-status-amber/30 bg-status-amber/5" : "border-destructive/30 bg-destructive/5"}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${dead.tone === "warning" ? "text-status-amber" : "text-destructive"}`}>
            {dead.kicker}
          </span>
          <span className="text-lg font-bold leading-tight tracking-tight text-foreground">{dead.title}</span>
          <p className="text-sm text-muted-foreground">{dead.body}</p>
          <p className="text-sm text-muted-foreground">{dead.next}</p>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button asChild size="sm">
              <Link href={dead.ctaHref}>{dead.ctaLabel}</Link>
            </Button>
            <a href="mailto:shane@shanemccawconsulting.com" className="px-1 py-2 text-xs font-semibold text-primary hover:underline">
              Contact Shane McCaw
            </a>
          </div>
          <p className="font-mono text-[10.5px] text-muted-foreground">{dead.wire}</p>
        </Card>
      ) : context ? (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-xl font-bold leading-tight tracking-tight text-foreground">
              {context.firstName ? `Welcome, ${context.firstName}` : "Welcome — set your password"}
            </span>
            <p className="text-sm text-muted-foreground">
              {context.firstName
                ? isAssessment
                  ? "Your account is set up for an assessment. Once you have a password you will land on your assessment findings — the governance report, its evidence, and what it recommends."
                  : "Once you have a password you will land on your tenant dashboard: monitoring signals, your governance record, SOWs and billing."
                : "We hold no name against this account, so there is nobody to greet by it. Everything else on this screen is real: the link is valid and the account is entitled."}
            </p>
          </div>

          {context.products.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-[11px] border border-border bg-background/60 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                What you have bought
              </span>
              {context.products.map((p, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-[5px] flex-none rounded-full bg-status-blue" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{p.name}</span>
                    {p.tagline ? <span className="text-xs text-muted-foreground">{p.tagline}</span> : null}
                  </div>
                  {p.category ? (
                    <span className="ml-auto flex-none whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {p.category}
                    </span>
                  ) : null}
                </div>
              ))}
              <span className="pt-0.5 text-[10.5px] text-muted-foreground">
                {context.products.length} purchase{context.products.length === 1 ? "" : "s"} on the
                account. Up to four are shown, newest first.
              </span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Choose a password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <span className="text-[10.5px] text-muted-foreground">
                Eight characters minimum, and that is the only rule the backend enforces.
              </span>
            </div>
            <Button type="submit" disabled={busy || password.length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Setting up…" : "Set password and sign in"}
            </Button>
          </form>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            {isAssessment
              ? "Next: your assessment findings. Setting a password here signs you straight in — no second sign-in step."
              : "Next: your tenant dashboard. Setting a password here signs you straight in — no second sign-in step."}
          </p>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          What this screen is told, and when
        </span>
        {FACTS.map((f, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="mt-1.5 size-[5px] flex-none rounded-full bg-muted-foreground" />
            <span className="min-w-0 text-xs text-muted-foreground">{f}</span>
          </div>
        ))}
      </div>
    </AuthPageShell>
  );
}
