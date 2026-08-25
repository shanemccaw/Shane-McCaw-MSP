/**
 * Identity interstitial — Git #1296.
 *
 * `/portal/` is customer-only. A staff role (PlatformAdmin, MSPAdmin,
 * MSPOperator, ServiceAccount) that ends up logging in through the
 * customer-facing /portal/ login instead of /admin-panel/ needs to know
 * that's what happened, mid-identity, rather than silently landing on a
 * customer page. This is the real choice login.tsx now sends every
 * non-CustomerUser role to instead of /dashboard: log out and go do a proper
 * admin login at /admin-panel/, or accept and proceed into /portal-v2 with
 * tenant impersonation available (TenantSwitcherFloaty is mounted on
 * PortalV2Shell for exactly this).
 *
 * CustomerUser never reaches this page — login.tsx still sends it straight
 * to /portal-v2.
 */

import { useLocation } from "wouter";
import { useAuth, type MspRole } from "@/lib/auth-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, LogOut, ArrowRight } from "lucide-react";

const ROLE_LABELS: Record<MspRole, string> = {
  PlatformAdmin: "Platform Admin",
  MSPAdmin: "MSP Admin",
  MSPOperator: "MSP Operator",
  CustomerUser: "Customer User",
  ServiceAccount: "Service Account",
  Free: "Free",
  Assessment: "Assessment",
};

export default function PortalIdentityInterstitialPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  const roleLabel = (user?.mspRole && ROLE_LABELS[user.mspRole]) || "a staff";

  async function handleLogOut() {
    await logout();
    window.location.href = `${window.location.origin}/admin-panel/`;
  }

  function handleAccept() {
    navigate("/portal-v2");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
          <ShieldCheck className="size-10 text-sidebar-primary" />
          <h1 className="text-xl font-semibold tracking-tight">MSP Platform</h1>
        </div>

        <Card
          className="border-sidebar-border bg-card/95 backdrop-blur"
          data-testid="identity-interstitial-card"
        >
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg" data-testid="identity-interstitial-role">
              You're logged in as {roleLabel}
            </CardTitle>
            <CardDescription>
              This is the customer portal login. Your account is a staff account —
              choose where you'd like to go.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => void handleLogOut()}
              data-testid="identity-interstitial-logout"
            >
              <LogOut className="size-4" />
              Log out and sign in at the Admin Panel
            </Button>
            <Button
              className="w-full justify-start gap-2"
              onClick={handleAccept}
              data-testid="identity-interstitial-accept"
            >
              <ArrowRight className="size-4" />
              Continue into the customer portal
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-sidebar-foreground/40">
          Access is provisioned by your administrator
        </p>
      </div>
    </div>
  );
}
