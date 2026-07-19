/**
 * ComingSoonPage — shared placeholder for customer-facing features whose UI
 * lives here but whose backend is a later phase (Password & MFA, Download My
 * Data, Cancel Service). Per the project's "build the UI now, wire it later"
 * rule these are real, navigable menu destinations rather than dead items or
 * faked functionality. The `feature` route param selects the copy.
 */

import { Link, useParams } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Clock, KeyRound, Download, XCircle, type LucideIcon } from "lucide-react";

interface ComingSoonCopy {
  title: string;
  description: string;
  Icon: LucideIcon;
}

const FEATURES: Record<string, ComingSoonCopy> = {
  "password-mfa": {
    title: "Password & MFA",
    description:
      "Manage your password and multi-factor authentication from here. We're putting the finishing touches on this — it'll be available soon.",
    Icon: KeyRound,
  },
  "download-data": {
    title: "Download My Data",
    description:
      "Export a copy of your account data as a single archive. This self-service export is coming soon — in the meantime, your data-rights requests are handled from Privacy & Data.",
    Icon: Download,
  },
  "cancel-service": {
    title: "Cancel Service",
    description:
      "Start a cancellation request for your services. This flow is coming soon — until then, please reach out to your service provider to make changes to your plan.",
    Icon: XCircle,
  },
};

const FALLBACK: ComingSoonCopy = {
  title: "Coming Soon",
  description: "This feature isn't available yet — we're actively building it.",
  Icon: Clock,
};

export default function ComingSoonPage() {
  const { feature } = useParams<{ feature?: string }>();
  const copy = (feature && FEATURES[feature]) || FALLBACK;
  const { title, description, Icon } = copy;

  return (
    <AppShell title={title}>
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center text-center gap-4 py-14 px-6">
            <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
              <Icon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-violet/10 px-2.5 py-0.5 text-[11px] font-medium text-status-violet">
                <Clock className="size-3" />
                Coming soon
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              {description}
            </p>
            <Link href="/customer-home">
              <Button variant="outline" size="sm" className="gap-1.5 mt-1">
                <ArrowLeft className="size-3.5" />
                Back to portal
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
