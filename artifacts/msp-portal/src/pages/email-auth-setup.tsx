/**
 * email-auth-setup.tsx — Git #1041, sub-issue of epic #647 (Remediation
 * Tracker).
 *
 * Customer self-service instructions for fixing SPF/DKIM/DMARC gaps,
 * gated per-record off the tenant's latest `exchange:dkim-spf-dmarc-status`
 * monitor profile (`GET /api/portal/email-auth-status`).
 *
 * Only the sections for records that are NOT configured render:
 *  - SPF / DMARC: the platform can show the real value to add — Microsoft's
 *    recommended SPF include and a standard DMARC policy — because both are
 *    static text a customer pastes into a DNS TXT record themselves.
 *  - DKIM: no value can be shown. Microsoft only mints the pair of CNAME
 *    values once the customer clicks "Enable" in the admin center
 *    themselves — this page gives the exact click-by-click navigation, not
 *    a value.
 *
 * OUT OF SCOPE, by design (see the issue's own explicit list): no DNS
 * registrar writes, no `New-DkimSigningConfig`/`Set-DkimSigningConfig`
 * execution, no ps-execution container calls of any kind. This page reads
 * and displays only.
 */
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Copy, Check, ShieldCheck, Mail } from "lucide-react";

interface EmailAuthStatus {
  readonly checked: boolean;
  readonly domain: string | null;
  readonly spfConfigured: boolean | null;
  readonly dmarcConfigured: boolean | null;
  readonly dkimConfiguredAtDefaultSelectors: boolean | null;
  readonly collectedAt: string | null;
}

function CopyableValue({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* the value is selectable in the block either way */
      });
  }, [value]);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <code className="text-xs break-all leading-relaxed">{value}</code>
      <button
        type="button"
        onClick={copy}
        className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function RecordField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <CopyableValue value={value} />
    </div>
  );
}

function SpfSection({ domain }: { readonly domain: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an SPF record</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          Add a TXT record at your domain apex ({domain}) with this value. If you already have an SPF TXT record,
          replace it — a domain can only have one.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordField label="Host / Name" value={domain} />
          <RecordField label="Type" value="TXT" />
        </div>
        <RecordField label="Value" value="v=spf1 include:spf.protection.outlook.com -all" />
      </CardContent>
    </Card>
  );
}

function DmarcSection({ domain }: { readonly domain: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a DMARC record</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>Add a TXT record at the following subdomain. Replace the example reporting address with your own.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordField label="Host / Name" value={`_dmarc.${domain}`} />
          <RecordField label="Type" value="TXT" />
        </div>
        <RecordField label="Value" value="v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@your-domain.example" />
      </CardContent>
    </Card>
  );
}

function DkimSection() {
  const steps: readonly string[] = [
    "Sign in to the Microsoft 365 Defender admin center (security.microsoft.com).",
    "Go to Email & collaboration > Policies & rules > Threat policies > DKIM.",
    "Select your domain from the list.",
    "Toggle \"Enable\" for this domain.",
    "Microsoft generates two CNAME records for the domain — copy both the host names and the values shown.",
    "Add both as CNAME records in your DNS provider's console, exactly as shown.",
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enable DKIM</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          DKIM's two CNAME values are minted by Microsoft only once you click "Enable" for your domain — there is no
          static value to show here ahead of that. Follow these steps in order:
        </p>
        <ol className="space-y-2 list-decimal list-inside">
          {steps.map((step, i) => (
            <li key={i} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function AllConfiguredNotice() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            SPF, DKIM, and DMARC are all configured for your domain. No action is needed — this page will show
            instructions again if a future scan finds a gap.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function NotScannedNotice() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">
          No email authentication scan has run for your tenant yet. Instructions will appear here once a scan
          collects your SPF, DKIM, and DMARC status.
        </p>
      </CardContent>
    </Card>
  );
}

export default function EmailAuthSetupPage() {
  const { fetchWithAuth } = useAuth();
  const [status, setStatus] = useState<EmailAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchWithAuth("/api/portal/email-auth-status");
        if (!res.ok) {
          if (!cancelled) setStatus(null);
          return;
        }
        const data = (await res.json()) as EmailAuthStatus;
        if (!cancelled) setStatus(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const allConfigured =
    status?.checked === true &&
    status.spfConfigured === true &&
    status.dmarcConfigured === true &&
    status.dkimConfiguredAtDefaultSelectors === true;

  return (
    <AppShell title="Email Authentication Setup">
      <div className="p-6 space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Email Authentication Setup</h1>
            <p className="text-sm text-muted-foreground">
              Step-by-step instructions to fix SPF, DKIM, and DMARC gaps on your own domain.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !status || !status.checked ? (
          <NotScannedNotice />
        ) : allConfigured ? (
          <AllConfiguredNotice />
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  Only the records below need attention on {status.domain ?? "your domain"}. Records already
                  configured are not shown.
                </p>
              </div>
            </div>
            {status.spfConfigured === false && status.domain ? <SpfSection domain={status.domain} /> : null}
            {status.dmarcConfigured === false && status.domain ? <DmarcSection domain={status.domain} /> : null}
            {status.dkimConfiguredAtDefaultSelectors === false ? <DkimSection /> : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
