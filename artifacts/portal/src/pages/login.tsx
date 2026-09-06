import { useState, type FormEvent } from "react";
import { useLocation, Link } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth, AuthApiError } from "@/lib/auth-context";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Banner {
  tone: "destructive" | "warning" | "info";
  title: string;
  body: string;
  wire?: string;
}

/**
 * Auth — Sign in (#2991, Feature #1648). Wired to POST /api/auth/login
 * (auth.ts:321-418) per docs/auth-core-contract-pack.md §1. The MFA challenge
 * ("Auth MFA Challenge.dc.html") is rendered here as a second phase of this
 * same page rather than a separate route — it depends on the short-lived
 * mfaToken login() just returned, and the issue body itself treats the two
 * screens as one cohesive flow.
 */
export default function LoginPage() {
  const { login, mfaTotpChallenge, mfaBypass } = useAuth();
  const [, navigate] = useLocation();

  const [phase, setPhase] = useState<"credentials" | "mfa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [mfaToken, setMfaToken] = useState("");
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaTab, setMfaTab] = useState<"totp" | "bypass">("totp");
  const [code, setCode] = useState("");
  const [mfaBanner, setMfaBanner] = useState<Banner | null>(null);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
        setMfaMethods(result.methods ?? []);
        setMfaTab(result.methods?.includes("totp") ? "totp" : "bypass");
        setPhase("mfa");
      } else {
        navigate("/");
      }
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 423) {
        const lockedUntil = typeof err.data?.lockedUntil === "string" ? err.data.lockedUntil : null;
        const until = lockedUntil
          ? new Date(lockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : null;
        setBanner({
          tone: "warning",
          title: until
            ? `Locked until ${until} after too many failed attempts`
            : "Locked after too many failed attempts",
          body: "The lock is a real timestamp on your account, not a rate limiter. It lifts on its own at that time; sign-in help can lift it sooner after an identity check.",
          wire: "423 { accountLocked: true, lockedUntil } · auth.ts:354-361",
        });
      } else if (err instanceof AuthApiError && err.status === 429) {
        setBanner({
          tone: "warning",
          title: "Too many attempts from here",
          body: "Ten attempts per fifteen minutes per IP in production. Wait a few minutes and try again, or use sign-in help.",
          wire: "429 · loginLimiter",
        });
      } else {
        setBanner({
          tone: "destructive",
          title: "That email and password do not match",
          body: "One message covers a wrong password and an email with no account behind it. The backend does not distinguish the two to the caller, so neither does this screen.",
          wire: "401 { error } · auth.ts:338/343",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMfaBanner(null);
    try {
      if (mfaTab === "totp") {
        await mfaTotpChallenge(mfaToken, code);
      } else {
        await mfaBypass(mfaToken, code);
      }
      navigate("/");
    } catch (err) {
      if (err instanceof AuthApiError && mfaTab === "totp" && err.status === 400) {
        setMfaBanner({
          tone: "destructive",
          title: "No authenticator is enrolled on this account",
          body: "The password check said MFA was required, but there is no enabled totp enrollment behind it. Use a bypass code or sign-in help.",
          wire: "400 \"TOTP not enrolled\" · mfa.ts:444",
        });
      } else if (err instanceof AuthApiError && err.status === 401 && mfaTab === "totp") {
        setMfaBanner({
          tone: "destructive",
          title: "That code is not right",
          body: "Codes are checked against a 30-second window either side of now, so a code that has just rolled over still passes. This one did not.",
          wire: "401 · mfa.ts:452",
        });
      } else if (err instanceof AuthApiError && err.status === 401 && mfaTab === "bypass") {
        setMfaBanner({
          tone: "destructive",
          title: "That bypass code is not valid",
          body: "It has already been used, has expired, or was never issued for this account.",
          wire: "401 { error } · mfa.ts:1084/1090/1107",
        });
      } else if (err instanceof AuthApiError && err.status === 401) {
        setMfaBanner({
          tone: "destructive",
          title: "This challenge has expired",
          body: "The token issued when your password was accepted lasts ten minutes. Sign in again to start a fresh one; nothing about your account has changed.",
          wire: "401 invalid/expired mfaToken · mfa.ts:435",
        });
      } else {
        setMfaBanner({
          tone: "destructive",
          title: "Verification failed",
          body: err instanceof Error ? err.message : "Please try again.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === "mfa") {
    return (
      <AuthPageShell title="Verify it is you" subtitle="Password accepted · this challenge expires in 10 minutes">
        <Card className="flex flex-col gap-4 p-5">
          <Tabs value={mfaTab} onValueChange={(v) => setMfaTab(v as "totp" | "bypass")}>
            <TabsList className="w-full">
              <TabsTrigger value="totp" className="flex-1" disabled={!mfaMethods.includes("totp") && mfaTab !== "totp"}>
                Authenticator code
              </TabsTrigger>
              <TabsTrigger value="bypass" className="flex-1">
                Bypass code
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-1">
            <span className="text-base font-bold tracking-tight text-foreground">
              {mfaTab === "totp" ? "Enter your six-digit code" : "Enter your bypass code"}
            </span>
            <span className="text-xs text-muted-foreground">
              {mfaTab === "totp"
                ? "From the authenticator app you enrolled. Codes roll every thirty seconds."
                : "The one-time code an MSP administrator issued you. It works once, then it is spent."}
            </span>
          </div>

          {mfaBanner ? (
            <Alert variant={mfaBanner.tone}>
              <AlertTitle>{mfaBanner.title}</AlertTitle>
              <AlertDescription>
                <p>{mfaBanner.body}</p>
                {mfaBanner.wire ? (
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{mfaBanner.wire}</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleMfaSubmit} className="flex flex-col gap-4">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={mfaTab === "totp" ? "000000" : "XXXX-XXXX"}
              className="text-center font-mono text-lg tracking-[0.28em]"
              autoFocus
            />
            <Button type="submit" disabled={busy || !code}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Verifying…" : mfaTab === "totp" ? "Verify and sign in" : "Use bypass code"}
            </Button>
          </form>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            {mfaTab === "totp"
              ? "No code, or lost the device? Switch to a bypass code above, or get sign-in help."
              : "Using a bypass code is recorded against your account and visible to your administrator."}
          </p>
        </Card>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Shane McCaw Consulting" subtitle="Client portal">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold tracking-tight text-foreground">Sign in</span>
          <span className="text-xs text-muted-foreground">
            Your tenant's governance record, SOWs and monitoring signals.
          </span>
        </div>

        {banner ? (
          <Alert variant={banner.tone}>
            <AlertTitle>{banner.title}</AlertTitle>
            <AlertDescription>
              <p>{banner.body}</p>
              {banner.wire ? <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{banner.wire}</p> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              data-testid="login-email"
              type="email"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" data-testid="login-forgot-password" className="ml-auto text-xs font-semibold text-primary hover:underline">
                Forgot password
              </Link>
            </div>
            <Input
              id="password"
              data-testid="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" data-testid="login-submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Locked out, lost your authenticator, or no code arriving?{" "}
          <Link href="/sign-in-help" data-testid="login-sign-in-help" className="font-semibold text-primary hover:underline">
            Get sign-in help
          </Link>{" "}
          — that route works without a session, because by then you do not have one.
        </p>
      </Card>
    </AuthPageShell>
  );
}
