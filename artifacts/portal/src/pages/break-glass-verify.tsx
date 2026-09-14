import { useParams } from "wouter";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Card } from "@/components/ui/card";

/**
 * Public Break-glass Verify landing — /portal/break-glass/verify/:token (#3994,
 * Feature #1651). No auth: the invited recipient may not have portal access at
 * all. This is the page every invite email links to
 * (`sendBreakGlassInvites`, break-glass-verification.ts), so it must render
 * outside RequireAuth/PortalShell — see App.tsx.
 *
 * Carried forward from the archived msp-portal page
 * (portal-archive-2026-08-29:artifacts/msp-portal/src/pages/break-glass-verify.tsx):
 * its only job is the pre-redirect context screen. "Sign in with Microsoft" is a
 * full page navigation (not fetch) to GET /api/public/break-glass/verify/:token,
 * which validates the link and 302s into the tenant-scoped Microsoft sign-in.
 * Everything after that — the callback's outcomes and the reveal-once page — is
 * server-rendered and white-labelled by the backend, and the Break-glass Access
 * design leaves it there ("The public sign-in and reveal pages are left as they
 * are"). This page never sees, fetches or validates the credential.
 *
 * The role named here is "Global Administrator", not "an administrator role" —
 * it is the only entry in ELIGIBLE_ROLE_TEMPLATE_IDS (contract pack §5).
 */
export default function BreakGlassVerifyPage() {
  const { token } = useParams<{ token: string }>();

  if (!token) {
    return (
      <AuthPageShell title="Tenant verification" subtitle="Shane McCaw Consulting · client portal">
        <Card className="flex flex-col items-center gap-2 p-6 text-center" data-testid="break-glass-verify-invalid">
          <span className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="size-6 text-destructive" />
          </span>
          <span className="text-lg font-semibold text-foreground">Invalid link</span>
          <span className="text-sm text-muted-foreground">This verification link is missing its token.</span>
        </Card>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Tenant verification" subtitle="Shane McCaw Consulting · client portal">
      <Card className="flex flex-col gap-4 p-5" data-testid="break-glass-verify-page">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-primary/10 p-2.5">
            <ShieldCheck className="size-5 text-primary" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">Verify administrator access</span>
            <span className="text-sm text-muted-foreground">
              You've been asked to verify tenant administrator access to receive a break-glass emergency-access
              credential.
            </span>
          </div>
        </div>

        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          You'll be asked to sign in with your Microsoft account. You must hold an active Global Administrator role
          in this organization's tenant for verification to succeed. This link is single-use.
        </div>

        {/* Full page navigation (not fetch) — the backend validates the token
            and 302s into Microsoft's tenant-scoped OAuth sign-in from here. */}
        <a
          href={`/api/public/break-glass/verify/${encodeURIComponent(token)}`}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="break-glass-verify-sign-in"
        >
          Sign in with Microsoft
        </a>
      </Card>
    </AuthPageShell>
  );
}
