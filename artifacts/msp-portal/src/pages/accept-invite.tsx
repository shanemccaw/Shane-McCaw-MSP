/**
 * Public Accept Invite page — /portal/invite/:token
 * No auth required. Validates the token, then:
 *   - new users: name + password form
 *   - signed-in users whose email matches: "Accept & Join" button
 */

import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "sonner";

interface InviteInfo {
  invitedEmail: string;
  mspRole: string;
  expiresAt: string;
  msp: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { user, accessToken, completeMfaLogin } = useAuth();

  const [status, setStatus] = useState<"loading" | "ready" | "error" | "success">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  useEffect(() => {
    if (!token) { setStatus("error"); setErrorMsg("Invalid invite link."); return; }
    fetch(`/api/public/msp-invite/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setErrorMsg(body.error ?? "This invite link is invalid.");
          setStatus("error");
        } else {
          const data = (await res.json()) as InviteInfo;
          setInvite(data);
          setStatus("ready");
        }
      })
      .catch(() => {
        setErrorMsg("Failed to validate invite link. Please try again.");
        setStatus("error");
      });
  }, [token]);

  const emailMatches = user && invite && user.email?.toLowerCase() === invite.invitedEmail.toLowerCase();
  const isNewUser = !user;
  const isExistingUserEmailMatch = !!emailMatches;

  async function handleAccept() {
    if (!token) return;
    setSubmitting(true);

    if (isNewUser) {
      if (!name.trim()) { toast.error("Name is required"); setSubmitting(false); return; }
      if (password.length < 8) { toast.error("Password must be at least 8 characters"); setSubmitting(false); return; }
      if (password !== passwordConfirm) { toast.error("Passwords do not match"); setSubmitting(false); return; }
    }

    try {
      const body = isNewUser ? { name: name.trim(), password } : {};
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
      const res = await fetch(`/api/public/msp-invite/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Failed to accept invite");
        setSubmitting(false);
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        mspSlug?: string;
        accessToken?: string;
        refreshToken?: string;
        refreshExpiresAt?: string;
      };

      // Auto sign-in if the server issued tokens (always true for new users;
      // existing authenticated users already have a session)
      if (data.accessToken) {
        completeMfaLogin(data.accessToken, data.refreshToken, data.refreshExpiresAt);
      }

      setStatus("success");
      toast.success("Invite accepted! Redirecting to your portal…");

      setTimeout(() => {
        const slug = data.mspSlug ?? invite?.msp.slug;
        if (slug) {
          navigate(`/${slug}/dashboard`, { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      }, 2000);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar">
        <Loader2 className="size-6 animate-spin text-white/70" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto rounded-full bg-destructive/10 p-3 w-fit">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <CardTitle className="text-lg">Invite Link Invalid</CardTitle>
            <CardDescription>{errorMsg}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto rounded-full bg-green-500/10 p-3 w-fit">
              <CheckCircle2 className="size-6 text-green-600" />
            </div>
            <CardTitle className="text-lg">Invitation Accepted!</CardTitle>
            <CardDescription>Redirecting you to your portal…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const expiresAt = invite ? new Date(invite.expiresAt) : null;
  const hoursLeft = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))) : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md space-y-4">
        {/* MSP branding header */}
        <div className="text-center space-y-2 mb-2">
          <div className="mx-auto rounded-full bg-white/10 p-3 w-fit">
            <Building2 className="size-7 text-white/80" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            {invite?.msp.name ?? "MSP Portal"}
          </h1>
          <p className="text-sm text-white/60">Team Invitation</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">You've been invited</CardTitle>
            <CardDescription>
              You've been invited to join <strong>{invite?.msp.name}</strong> as{" "}
              <Badge variant="outline" className="text-xs align-middle">
                {invite?.mspRole === "MSPAdmin" ? "MSP Admin" : "MSP Operator"}
              </Badge>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Invited email: </span>
              <span className="font-medium">{invite?.invitedEmail}</span>
            </div>

            {hoursLeft > 0 && (
              <p className="text-xs text-muted-foreground">
                Expires in {hoursLeft} hour{hoursLeft !== 1 ? "s" : ""}
              </p>
            )}

            {/* Already signed in with matching email */}
            {isExistingUserEmailMatch && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You're signed in as <strong>{user!.email}</strong>. Click below to join {invite?.msp.name}.
                </p>
                <Button
                  className="w-full"
                  onClick={() => void handleAccept()}
                  disabled={submitting}
                >
                  {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Accept &amp; Join {invite?.msp.name}
                </Button>
              </div>
            )}

            {/* Signed in but email doesn't match */}
            {user && !isExistingUserEmailMatch && (
              <div className="space-y-3">
                <p className="text-sm text-destructive">
                  You're signed in as <strong>{user.email}</strong>, but this invite is for{" "}
                  <strong>{invite?.invitedEmail}</strong>. Please sign out and use the correct account.
                </p>
              </div>
            )}

            {/* Not signed in — new or returning user */}
            {!user && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your Name</Label>
                  <Input
                    id="name"
                    placeholder="Jane Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Create a Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="passwordConfirm">Confirm Password</Label>
                  <Input
                    id="passwordConfirm"
                    type="password"
                    placeholder="Repeat your password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    disabled={submitting}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAccept(); }}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <a
                    href={invite?.msp.slug ? `/portal/${invite.msp.slug}/login` : "/portal/login"}
                    className="underline hover:text-foreground"
                  >
                    Sign in first
                  </a>
                  , then return to this link.
                </p>

                <Button
                  className="w-full"
                  onClick={() => void handleAccept()}
                  disabled={submitting}
                >
                  {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Create Account &amp; Accept Invite
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
