import { useEffect, useState, type FormEvent } from "react";
import { useParams, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { SignupFlowShell } from "@/components/auth/SignupFlowShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchMspInvite,
  acceptMspInvite,
  MspSignupApiError,
  type MspInviteInfo,
} from "@/lib/msp-signup-api";

interface GoneState {
  title: string;
  body: string;
  code: string;
}

/** One message + code per real distinct server rejection (msp-onboarding.ts:441-459). */
const GONE: Record<"notfound" | "used" | "expired" | "suspended", GoneState> = {
  notfound: {
    title: "This link does not exist",
    body: "The address may have been copied incompletely.",
    code: "404",
  },
  used: {
    title: "This invitation has been used",
    body: "An invitation works once. If you accepted it earlier, sign in instead; otherwise ask the person who invited you for a new one.",
    code: "410",
  },
  expired: {
    title: "This invitation has expired",
    body: "Invitations last 72 hours. Ask the person who invited you to send another.",
    code: "410",
  },
  suspended: {
    title: "This provider's account is not active",
    body: "The organisation that invited you cannot add staff right now. Nothing was created.",
    code: "403 · MSP is not active",
  },
};

function goneFor(err: MspSignupApiError): GoneState {
  if (err.status === 404) return GONE.notfound;
  if (err.status === 403) return GONE.suspended;
  if (err.status === 410) {
    return err.message.toLowerCase().includes("expired") ? GONE.expired : GONE.used;
  }
  return { title: "This invitation link is invalid", body: err.message, code: String(err.status) };
}

/**
 * Accept Invite — public, unauthenticated (#3992, Feature #1649). Wired to
 * GET /api/public/msp-invite/:token and POST .../accept per the contract
 * pack. Design: `Signup Agreement and Invite.dc.html`, scene "invite".
 *
 * Route is `/invite/:token`, matching the archived page's own header
 * comment ("Public Accept Invite page — /portal/invite/:token") — this SPA
 * mounts under /portal/ already (App.tsx's ROUTER_BASE), so the full path a
 * real invite email link points at is /portal/invite/:token.
 */
export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { user, accessToken, completeMfaLogin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<MspInviteInfo | null>(null);
  const [gone, setGone] = useState<GoneState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!token) {
      setGone(GONE.notfound);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchMspInvite(token);
        if (!cancelled) setInvite(data);
      } catch (err) {
        if (!cancelled) setGone(err instanceof MspSignupApiError ? goneFor(err) : GONE.notfound);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const emailMatches = !!(user && invite && user.email?.toLowerCase() === invite.invitedEmail.toLowerCase());
  // We only learn "an account already exists for this email" from the 401
  // requiresSignIn response on accept — the GET invite lookup doesn't expose
  // that. existingAccountRequiresSignIn tracks it once accept has told us.
  const [existingAccountRequiresSignIn, setExistingAccountRequiresSignIn] = useState(false);

  async function handleAccept(e?: FormEvent) {
    e?.preventDefault();
    if (!token) return;
    setFormError(null);

    if (!user) {
      if (!name.trim()) {
        setFormError("Your name is required.");
        return;
      }
      if (password.length < 8) {
        setFormError("Password must be at least 8 characters.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const body = user ? {} : { name: name.trim(), password };
      const data = await acceptMspInvite(token, body, accessToken ?? undefined);
      if (data.accessToken) {
        completeMfaLogin(data.accessToken, data.refreshToken, data.refreshExpiresAt);
      }
      navigate("/");
    } catch (err) {
      if (err instanceof MspSignupApiError && err.status === 401 && err.data?.requiresSignIn) {
        setExistingAccountRequiresSignIn(true);
      } else if (err instanceof MspSignupApiError && (err.status === 404 || err.status === 410 || err.status === 403)) {
        setGone(goneFor(err));
      } else {
        setFormError(err instanceof Error ? err.message : "Failed to accept invite");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SignupFlowShell
      brand={invite ? `${invite.msp.name} · via the platform` : "Shane McCaw Consulting"}
      statusLine={`Public · invitation ${gone ? "gone" : loading ? "loading" : "valid"}`}
    >
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your invitation…
        </Card>
      ) : gone ? (
        <Card className="flex flex-col gap-1.5 p-6">
          <span className="text-[19px] font-bold tracking-tight text-foreground">{gone.title}</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{gone.body}</span>
          <span className="border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">{gone.code}</span>
        </Card>
      ) : invite ? (
        <Card className="flex flex-col gap-3.5 p-6">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-primary">
              JOIN {invite.msp.name.toUpperCase()}
            </span>
            <span className="text-[19px] font-bold tracking-tight text-foreground">
              You've been invited as {invite.mspRole === "MSPAdmin" ? "an MSP Admin" : "an MSP Operator"}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              For <span className="text-foreground">{invite.invitedEmail}</span> · expires{" "}
              {new Date(invite.expiresAt).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · single use
            </span>
          </div>

          {existingAccountRequiresSignIn ? (
            <div className="flex flex-col gap-2 rounded-xl border border-status-blue/30 bg-status-blue/[0.06] p-3.5">
              <span className="text-[12.5px] font-semibold text-foreground">
                An account already exists for {invite.invitedEmail}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Sign in as that account to accept — the link alone cannot move an existing account
                into another provider's team. Signed in as someone else, the accept is refused.
              </span>
              <span className="font-mono text-[10.5px] text-primary">401 · requiresSignIn: true</span>
              <Button size="sm" className="mt-1 self-start" onClick={() => navigate("/login")}>
                Sign in to accept
              </Button>
            </div>
          ) : user && !emailMatches ? (
            <Alert variant="destructive">
              <AlertDescription>
                You're signed in as <strong>{user.email}</strong>, but this invite is for{" "}
                <strong>{invite.invitedEmail}</strong>. Sign out and use the correct account.
              </AlertDescription>
            </Alert>
          ) : user && emailMatches ? (
            <div className="flex flex-col gap-2.5 border-t border-border pt-3">
              <span className="text-[12.5px] text-muted-foreground">
                You're signed in as <strong className="text-foreground">{user.email}</strong>. Accept
                to join {invite.msp.name}.
              </span>
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <Button onClick={() => void handleAccept()} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                Accept &amp; join {invite.msp.name}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleAccept} className="flex flex-col gap-2.5 border-t border-border pt-3">
              <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground">
                CREATE YOUR STAFF ACCOUNT
              </span>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="invite-name">Your name</Label>
                  <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="invite-password">Password</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="max-w-[400px] text-[11px] leading-relaxed text-muted-foreground">
                  You land signed in. If this provider enforces MFA, setting up an authenticator is
                  the first thing you will be asked to do.
                </span>
                <Button type="submit" className="ml-auto flex-none" disabled={submitting}>
                  {submitting ? <Loader2 className="animate-spin" /> : null}
                  Accept and create account
                </Button>
              </div>
            </form>
          )}
        </Card>
      ) : null}
    </SignupFlowShell>
  );
}
