import { useEffect, useState, type FormEvent } from "react";
import { useLocation, Link } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth, AuthApiError } from "@/lib/auth-context";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

/**
 * Auth — Reset password (#2991, Feature #1648). Wired to
 * POST /api/auth/reset-password (auth.ts:783-819). Issues no session on
 * success (contract pack §1) — the next step is /login, same as the
 * archived page's own 1.5s-delayed redirect.
 */
export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"form" | "done" | "dead">(token ? "form" : "dead");
  const [error, setError] = useState<{ title: string; body: string; wire: string } | null>(
    token ? null : {
      title: "This reset link will not work",
      body: "One message covers all three reasons a link fails: it expired, it has already been used, or it was never a real link. The backend does not say which, and neither will we — that distinction is exactly what someone probing links would want to know.",
      wire: "400 { error } · auth.ts:803",
    },
  );

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => navigate("/login"), 1500);
    return () => clearTimeout(t);
  }, [phase, navigate]);

  const tooShort = password.length > 0 && password.length < 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError({
        title: "Those passwords do not match",
        body: "Type the same password in both fields.",
        wire: "",
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setPhase("done");
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 400 && /at least 8/i.test(err.message)) {
        setError({
          title: "That password is too short",
          body: "Eight characters is the floor the backend enforces, so a shorter one is rejected there as well as here.",
          wire: "400 { error } · auth.ts:791",
        });
      } else {
        setPhase("dead");
        setError({
          title: "This reset link will not work",
          body: "One message covers all three reasons a link fails: it expired, it has already been used, or it was never a real link. The backend does not say which, and neither will we — that distinction is exactly what someone probing links would want to know.",
          wire: "400 { error } · auth.ts:803",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPageShell title="Choose a new password" subtitle="Shane McCaw Consulting · client portal">
      {phase === "form" ? (
        <Card className="flex flex-col gap-4 p-5">
          <p className="text-xs text-muted-foreground">
            This link is single-use and expires an hour after it was sent. Setting a password here
            does not sign you in — you will come back to the sign-in screen and use it.
          </p>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.title}</AlertTitle>
              <AlertDescription>
                <p>{error.body}</p>
                {error.wire ? <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{error.wire}</p> : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <span className={`text-[10.5px] ${tooShort ? "text-destructive" : password.length >= 8 ? "text-status-green" : "text-muted-foreground"}`}>
                {password.length === 0
                  ? "Eight characters minimum. That is the only rule."
                  : tooShort
                    ? "Too short — eight characters minimum."
                    : "Long enough."}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={busy || password.length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </form>
        </Card>
      ) : phase === "done" ? (
        <Card className="flex flex-col gap-3 border-status-green/30 bg-status-green/5 p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-status-green">Password changed</span>
          <span className="text-lg font-bold leading-tight tracking-tight text-foreground">
            Your new password is saved
          </span>
          <p className="text-sm text-muted-foreground">
            You are not signed in. This route issues no session by design, so the next step is the
            sign-in screen — with MFA after it, if your account has a method enrolled. Taking you there
            now.
          </p>
          <p className="text-sm text-muted-foreground">
            The link you used is spent. Opening it again will say it is invalid, which is the same
            message an expired or already-used link gets.
          </p>
          <Link href="/login" className="border-t border-status-green/20 pt-3 text-xs font-semibold text-primary hover:underline">
            Go to sign in now
          </Link>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 border-destructive/30 bg-destructive/5 p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Link not usable</span>
          <span className="text-lg font-bold leading-tight tracking-tight text-foreground">
            {error?.title ?? "This reset link will not work"}
          </span>
          <p className="text-sm text-muted-foreground">{error?.body}</p>
          <p className="text-sm text-muted-foreground">Requesting a new one is safe and takes a moment.</p>
          <div className="flex flex-wrap gap-2 border-t border-destructive/20 pt-3">
            <Button asChild size="sm">
              <Link href="/forgot-password">Send a new link</Link>
            </Button>
            <Link href="/sign-in-help" className="px-1 py-2 text-xs font-semibold text-primary hover:underline">
              Get sign-in help
            </Link>
          </div>
        </Card>
      )}

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Server-side rule: eight characters minimum, hashed at rest, and the token row is stamped used
        in the same write. Nothing else about the password is checked — no composition rules, no
        history, no reuse test.
      </p>
    </AuthPageShell>
  );
}
