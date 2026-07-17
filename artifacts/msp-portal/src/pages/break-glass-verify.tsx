/**
 * Public Break-Glass Verify landing page — /portal/break-glass/verify/:token
 * No auth required — the recipient may not have Portal access at all.
 *
 * This page shows brief context + a single "Sign in with Microsoft" action.
 * Clicking it navigates (full page load, not fetch) to the backend's
 * OAuth-redirect endpoint (GET /api/public/break-glass/verify/:token), which
 * validates the token and 302s into Microsoft's tenant-scoped sign-in.
 *
 * Everything downstream of that — the OAuth callback's three outcomes
 * (success/reveal, PIM-eligible-not-active, failure/expired) and the
 * reveal-once acknowledgment screen — is server-rendered directly by the
 * backend (break-glass-verification.ts), because the OAuth redirect_uri points
 * at that backend endpoint, not back into this SPA. That flow already carries
 * MSP branding + the mandatory credibility footer and the storage-guidance
 * copy. This page's only job is the pre-redirect context screen.
 */

import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle } from "lucide-react";

export default function BreakGlassVerifyPage() {
  const { token } = useParams<{ token: string }>();

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto rounded-full bg-destructive/10 p-3 w-fit">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <CardTitle className="text-lg">Invalid link</CardTitle>
            <CardDescription>This verification link is missing its token.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2 mb-2">
          <div className="mx-auto rounded-full bg-white/10 p-3 w-fit">
            <ShieldCheck className="size-7 text-white/80" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Tenant Verification</h1>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Verify administrator access</CardTitle>
            <CardDescription>
              You've been asked to verify tenant administrator access to receive a break-glass
              emergency-access credential.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              You'll be asked to sign in with your Microsoft account. You must hold an active
              administrator role in this organization's tenant for verification to succeed.
              This link is single-use.
            </div>

            {/* Full page navigation (not fetch) — the backend validates the token
                and 302s into Microsoft's tenant-scoped OAuth sign-in from here. */}
            <Button asChild className="w-full">
              <a href={`/api/public/break-glass/verify/${encodeURIComponent(token)}`}>
                Sign in with Microsoft
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
