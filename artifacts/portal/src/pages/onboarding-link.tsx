import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { ConsentOnboardingShell, ConsentCard } from "@/components/consent/ConsentOnboardingShell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchOnboardingLink,
  startOnboardingConsent,
  type OnboardingLinkResult,
} from "@/lib/consent-onboarding-api";

const GONE_COPY: Record<Exclude<OnboardingLinkResult["state"], "valid">, { title: string; body: string; code: string }> = {
  missing: {
    title: "This link does not exist",
    body: "The address may have been copied incompletely. Ask your provider to send it again.",
    code: "404",
  },
  used: {
    title: "This invitation has already been used",
    body: "The link was opened and consumed once, which is all it allows. If you completed the connection earlier, sign in to your portal instead.",
    code: "410 · used",
  },
  expired: {
    title: "This invitation has expired",
    body: "Links last as long as your provider set when issuing them — up to seven days. Nothing was created or changed.",
    code: "410 · expired",
  },
  suspended: {
    title: "This provider's account is not active",
    body: "The organisation that issued this link is not currently able to onboard customers. Nothing was created or changed.",
    code: "403 · MSP is not active",
  },
  error: {
    title: "This link could not be read right now",
    body: "The read failed in a way we did not anticipate. It is logged on our side — trying again shortly is worth it.",
    code: "network error",
  },
};

/**
 * Onboarding link — accept (Feature #1650, Git #3993). The design's
 * `onboarding-link` scene. Backed by the real, live, previously-unwired
 * GET /api/public/onboarding/link/:token (contract pack #2758 §6a: "not
 * called by any of the 5 archived pages — a real, live, currently-
 * unexercised list endpoint").
 *
 * The minted link (`POST /api/msp/onboarding/generate-link`) is
 * `${SITE_URL}/portal/onboarding/:token` (#4010) — this portal SPA is mounted
 * at a fixed `/portal/` base in every environment.
 *
 * "Connect Microsoft 365" calls `POST /api/public/onboarding/link/:token/
 * start-consent` (#4010), which burns the link and returns a Microsoft
 * admin-consent URL minted as a consent invite scoped to the issuing MSP; the
 * whole tab navigates there, and GET /api/consent/callback brings the admin
 * back to /portal/consent/success, /declined or /tenant-conflict.
 */
export default function OnboardingLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<OnboardingLinkResult | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect() {
    if (!token || connecting) return;
    setConnecting(true);
    setConnectError(null);
    const started = await startOnboardingConsent(token);
    if (started.state === "redirect") {
      // Leave `connecting` set — the tab is navigating away to Microsoft.
      window.location.assign(started.consentUrl);
      return;
    }
    setConnecting(false);
    if (started.state === "unavailable") {
      setConnectError(started.message);
      return;
    }
    // The link went used/expired/missing/suspended between reading and
    // clicking — show the same state the page would show on a fresh load.
    setResult({ state: started.state });
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetchOnboardingLink(token).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!result) {
    return (
      <ConsentOnboardingShell stateLine="Public · reading invitation">
        <ConsentCard>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading your invitation…
          </div>
        </ConsentCard>
      </ConsentOnboardingShell>
    );
  }

  if (result.state !== "valid") {
    const gone = GONE_COPY[result.state];
    return (
      <ConsentOnboardingShell stateLine={`Public · link ${result.state}`} isAlert>
        <ConsentCard>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold tracking-tight text-foreground">{gone.title}</span>
            <span className="text-[12.5px] leading-relaxed text-muted-foreground">{gone.body}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
            <span className="font-mono text-[11px] text-muted-foreground">{gone.code}</span>
            <Button variant="outline" className="ml-auto" onClick={() => window.history.back()}>
              Ask your provider for a new link
            </Button>
          </div>
        </ConsentCard>
      </ConsentOnboardingShell>
    );
  }

  const { link } = result;
  const expires = new Date(link.expiresAt);

  return (
    <ConsentOnboardingShell stateLine="Public · link valid">
      <ConsentCard>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-wider text-status-blue">
            INVITATION FROM {link.msp.name.toUpperCase()}
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">Set up monitoring</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            Your provider prepared this link for you. The next step is connecting your Microsoft
            365 tenant with a Global Administrator sign-in; everything requested is read-only.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">For</span>
            <span className="text-[12.5px] text-foreground">{link.customerEmail}</span>
            <span className="text-[10.5px] text-muted-foreground">pre-filled by your provider</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Link expires</span>
            <span className="text-[12.5px] text-foreground">{expires.toLocaleString()}</span>
            <span className="text-[10.5px] text-muted-foreground">single use</span>
          </div>
        </div>

        {link.note ? (
          <div className="flex flex-col gap-1 border-l-2 border-status-blue/40 py-0.5 pl-3">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Note from your provider
            </span>
            <span className="text-[12px] leading-relaxed text-foreground/90">&quot;{link.note}&quot;</span>
          </div>
        ) : null}

        {connectError ? (
          <Alert variant="destructive">
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
          <span className="max-w-[320px] text-[11px] text-muted-foreground">
            Opening the link a second time, after this, shows that it has been used.
          </span>
          <Button
            className="ml-auto"
            disabled={connecting}
            onClick={() => void connect()}
            data-testid="onboarding-link-connect"
          >
            {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
            Connect Microsoft 365
          </Button>
        </div>
      </ConsentCard>
    </ConsentOnboardingShell>
  );
}
