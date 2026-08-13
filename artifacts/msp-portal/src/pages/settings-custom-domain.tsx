/**
 * Custom Domain settings sub-page.
 *
 * Lets an MSP admin register a custom domain (e.g. portal.acmeit.com),
 * follow step-by-step DNS instructions, trigger verification, and remove it.
 *
 * Every MSP also gets a permanent /portal/?t={slug} URL at no setup cost.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DnsInstructions {
  type: string;
  host: string;
  value: string;
  ttl: number;
}

interface CustomDomainConfig {
  domain: string;
  verificationStatus: "pending" | "verified" | "failed";
  verificationToken: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface CustomDomainResponse {
  slug: string;
  slugUrl: string;
  customDomain: CustomDomainConfig | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "pending" | "verified" | "failed" }) {
  if (status === "verified") {
    return (
      <Badge className="gap-1 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20">
        <CheckCircle2 className="size-3" />
        Verified
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="gap-1 bg-destructive/10 text-destructive border-destructive/20">
        <XCircle className="size-3" />
        Verification failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="size-3" />
      Pending verification
    </Badge>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <CheckCircle2 className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettingsCustomDomainPage() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CustomDomainResponse | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dnsInstructions, setDnsInstructions] = useState<DnsInstructions | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchWithAuth("/api/msp/settings/custom-domain")
      .then((r) => r.json())
      .then((d: CustomDomainResponse) => setData(d))
      .catch(() => toast.error("Failed to load custom domain settings"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/custom-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim().toLowerCase() }),
      });
      if (res.ok) {
        const result = (await res.json()) as {
          domain: string;
          verificationToken: string;
          dnsInstructions: DnsInstructions;
        };
        setDnsInstructions(result.dnsInstructions);
        toast.success(`Domain registered — add the TXT record to continue`);
        setDomainInput("");
        load();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to register domain");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/custom-domain/verify", {
        method: "POST",
      });
      const result = (await res.json()) as {
        verified: boolean;
        verificationStatus: string;
        message: string;
      };
      if (result.verified) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      load();
    } catch {
      toast.error("Verification request failed");
    } finally {
      setVerifying(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove this custom domain? Your MSP will fall back to the default slug URL.")) return;
    setRemoving(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/custom-domain", { method: "DELETE" });
      if (res.ok || res.status === 204) {
        toast.success("Custom domain removed");
        setDnsInstructions(null);
        load();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to remove domain");
      }
    } finally {
      setRemoving(false);
    }
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  if (loading) {
    return (
      <AppShell title="Custom Domain" actions={actions}>
        <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </AppShell>
    );
  }

  const cd = data?.customDomain;

  return (
    <AppShell title="Custom Domain" actions={actions}>
      <div className="p-6 max-w-2xl space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <Globe className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Custom Domain</h2>
            <p className="text-sm text-muted-foreground">
              Point your own domain at this portal for a fully branded experience.
            </p>
          </div>
        </div>

        {/* Default slug URL */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-500" />
              Default portal URL
            </CardTitle>
            <CardDescription className="text-xs">
              Your portal is always available at this URL — no setup required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-muted/60 rounded-md px-3 py-2 text-sm font-mono">
              <span className="flex-1 break-all">{data?.slugUrl}</span>
              {data?.slugUrl && (
                <CopyButton value={data.slugUrl} label="slug URL" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Share this URL with your customers. It always works, even without a custom domain.
            </p>
          </CardContent>
        </Card>

        <Separator />

        {/* Custom domain section */}
        {!cd ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add a custom domain</CardTitle>
              <CardDescription className="text-xs">
                After adding your domain, you'll receive a DNS TXT record to verify ownership.
                Once verified, customers can reach your portal at{" "}
                <span className="font-medium">portal.yourmsp.com</span> (or whichever hostname you choose).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleRegister(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="domain" className="text-xs">Portal hostname</Label>
                  <Input
                    id="domain"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="portal.yourmsp.com"
                    className="h-8 text-sm font-mono"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Use a subdomain like <span className="font-mono">portal.acmeit.com</span> — apex domains require additional configuration at your DNS provider.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
                    Add domain
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Domain status card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-mono">{cd.domain}</CardTitle>
                    <div className="mt-1.5">
                      <StatusBadge status={cd.verificationStatus} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:bg-destructive/10"
                    title="Remove custom domain"
                    disabled={removing}
                    onClick={() => void handleRemove()}
                  >
                    {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </Button>
                </div>
              </CardHeader>

              {cd.verificationStatus === "verified" && (
                <CardContent>
                  <div className="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-sm text-green-700 dark:text-green-400">
                    Your portal is live at{" "}
                    <a
                      href={`https://${cd.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline underline-offset-2"
                    >
                      https://{cd.domain}
                    </a>
                    . Share this URL with your customers.
                  </div>
                  {cd.verifiedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Verified {new Date(cd.verifiedAt).toLocaleDateString()}
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* DNS instructions (shown when pending or failed) */}
            {(cd.verificationStatus === "pending" || cd.verificationStatus === "failed" || dnsInstructions) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Step 1 — Add TXT record</CardTitle>
                  <CardDescription className="text-xs">
                    Add the following TXT record in your DNS provider to prove ownership of the domain.
                    DNS changes can take up to 24 hours to propagate.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/60 border-b border-border">
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">Type</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">Host / Name</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">Value</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">TTL</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="px-3 py-2.5 text-blue-600 dark:text-blue-400 font-semibold">TXT</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <span className="break-all">_msp-platform-verify.{cd.domain}</span>
                              <CopyButton value={`_msp-platform-verify.${cd.domain}`} label="host name" />
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <span className="break-all text-amber-700 dark:text-amber-400">
                                {cd.verificationToken}
                              </span>
                              <CopyButton value={cd.verificationToken} label="TXT value" />
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">300</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
                    <div className="bg-muted/60 border-b border-border px-3 py-2 text-muted-foreground font-sans font-medium text-xs">
                      Step 2 — Also add a CNAME record
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium font-sans">Type</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium font-sans">Host / Name</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium font-sans">Value (CNAME target)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="px-3 py-2.5 text-purple-600 dark:text-purple-400 font-semibold">CNAME</td>
                          <td className="px-3 py-2.5 break-all">{cd.domain}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <span className="text-green-700 dark:text-green-400">portal.shanemccawconsulting.com</span>
                              <CopyButton value="portal.shanemccawconsulting.com" label="CNAME target" />
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Both records must be in place before verifying. After clicking Verify, you can retry as many times as needed.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Verify button + last check */}
            {cd.verificationStatus !== "verified" && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  {cd.lastCheckedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last checked: {new Date(cd.lastCheckedAt).toLocaleString()}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not yet verified</p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleVerify()}
                  disabled={verifying}
                  className="gap-1.5"
                >
                  {verifying ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {verifying ? "Checking DNS…" : "Verify domain"}
                </Button>
              </div>
            )}

            {cd.verificationStatus === "failed" && (
              <Alert variant="destructive" className="text-sm">
                <XCircle className="size-4" />
                <AlertTitle className="text-sm">Verification failed</AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  The TXT record was not found or didn't match. Double-check your DNS settings and try
                  again. DNS changes can take up to 24 hours to propagate.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Info callout */}
        <Alert className="text-sm">
          <Circle className="size-4 text-muted-foreground" />
          <AlertTitle className="text-sm">How it works</AlertTitle>
          <AlertDescription className="text-xs mt-1 space-y-1">
            <p>
              After verification, branding (logo, name, colours) resolves automatically from your verified domain
              — the same way it does from your MSP slug. There is no separate branding configuration.
            </p>
            <p>
              Your default slug URL always remains active as a fallback, even with a custom domain set up.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </AppShell>
  );
}
