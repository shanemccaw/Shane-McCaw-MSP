import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Auth — Forgot password (#2991, Feature #1648). Wired to
 * POST /api/auth/forgot-password (auth.ts:718-780), which is unconditionally
 * 200 before any lookup runs — the UI cannot and must not imply the address
 * matched an account (contract pack §4, enumeration resistance).
 */
export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await forgotPassword(email);
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthPageShell title="Get back into your account" subtitle="Shane McCaw Consulting · client portal">
      {!sent ? (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold tracking-tight text-foreground">Forgot password</span>
            <span className="text-xs text-muted-foreground">
              Give us the address on your account. We will send whichever link is right for it — a
              password reset, or a fresh setup link if you never finished setting one.
            </span>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                data-testid="forgot-password-email"
                type="email"
                placeholder="you@yourcompany.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" data-testid="forgot-password-submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Sending…" : "Send me a link"}
            </Button>
          </form>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Remembered it?{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </Card>
      ) : (
        <Card data-testid="forgot-password-sent" className="flex flex-col gap-3 border-status-blue/30 bg-status-blue/5 p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-status-blue">Request received</span>
          <span className="text-lg font-bold leading-tight tracking-tight text-foreground">
            If that address has an account, a link is on its way to it
          </span>
          <p className="text-sm text-muted-foreground">
            That wording is deliberate and it is the whole answer: this screen is told nothing about
            whether the address matched. The response comes back before any lookup runs, so we cannot
            tell you more than this without also telling anyone who types your address into the same
            box.
          </p>
          <p className="text-sm text-muted-foreground">
            A reset link is good for one hour. A setup link, if that is what your account needs, is
            good for seventy-two. Either way it works once.
          </p>
          <div className="flex flex-wrap gap-2 border-t border-status-blue/20 pt-3">
            <Button variant="outline" size="sm" onClick={() => setSent(false)}>
              Try another address
            </Button>
            <Link href="/sign-in-help" className="px-1 py-2 text-xs font-semibold text-primary hover:underline">
              Nothing arrived — get help
            </Link>
          </div>
        </Card>
      )}
    </AuthPageShell>
  );
}
