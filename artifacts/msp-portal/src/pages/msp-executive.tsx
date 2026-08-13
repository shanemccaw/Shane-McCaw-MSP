/**
 * msp-executive.tsx
 *
 * MSP Executive Mode — a stripped-down leadership view for the MSP owner. Three
 * things and nothing else: the top-5 at-risk customers, the top-5 opportunity
 * customers, and a "Generate QBR" action that produces an AI Partner Quarterly
 * Business Review over the whole book.
 *
 * A deliberate simplified COMPANION to the full customers list (customers.tsx),
 * not a replacement — it never renders the full table, filters, or per-customer
 * drill-downs. Every number is real, already-scoped data from GET
 * /api/msp/executive (health scores + Sales Offer Engine output); the QBR is a
 * real AI document from POST /api/msp/executive/qbr/generate.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  TrendingUp,
  ChevronRight,
  Activity,
  ShieldAlert,
  DollarSign,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ── Server payload shapes (msp-executive.ts) ─────────────────────────────────

interface RiskTenant {
  customerId: number;
  name: string;
  healthScore: number;
  goodnessPercent: number;
  capturedAt: string | null;
}

interface OpportunityTenant {
  customerId: number;
  name: string;
  openOfferCount: number;
  totalValueCents: number;
  topOfferTitle: string | null;
  topScore: number;
}

interface ExecutiveBook {
  mspId: number;
  customerCount: number;
  topRisks: RiskTenant[];
  topOpportunities: OpportunityTenant[];
  rollup: {
    avgGoodnessPercent: number | null;
    atRiskCount: number;
    totalOpenOpportunityCents: number;
    openOfferCount: number;
  };
}

interface PartnerQbr {
  status: "generating" | "ready" | "failed";
  quarterKey: string;
  title: string;
  htmlContent: string;
  model: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function healthBadgeClass(goodness: number): string {
  if (goodness < 60) return "bg-red-500/15 text-red-400";
  if (goodness < 85) return "bg-amber-500/15 text-amber-400";
  return "bg-emerald-500/15 text-emerald-400";
}

// ── Roll-up stat tile ────────────────────────────────────────────────────────
function StatTile({ icon: Icon, label, value, hint }: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold leading-tight">{value}</div>
          <div className="text-xs text-muted-foreground truncate">{label}{hint ? ` · ${hint}` : ""}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Partner QBR dialog ───────────────────────────────────────────────────────
function QbrDialog({ onClose }: { onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [qbr, setQbr] = useState<PartnerQbr | null>(null);
  const [quarterKey, setQuarterKey] = useState<string>("");

  // Load the current quarter's cached QBR (viewing never triggers generation).
  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/msp/executive/qbr")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { quarterKey: string; qbr: PartnerQbr | null };
        if (mounted) {
          setQbr(data.qbr);
          setQuarterKey(data.quarterKey);
        }
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(async (force: boolean) => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth("/api/msp/executive/qbr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json().catch(() => ({}))) as { qbr?: PartnerQbr; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not generate the QBR. Please try again.");
        if (data.qbr) setQbr(data.qbr);
        return;
      }
      if (data.qbr) setQbr(data.qbr);
      toast.success("Partner QBR generated.");
    } catch {
      toast.error("Could not generate the QBR. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [fetchWithAuth]);

  const isReady = qbr?.status === "ready" && qbr.htmlContent;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Partner QBR {quarterKey && `— ${quarterKey}`}
          </DialogTitle>
          <DialogDescription>
            An AI-generated quarterly business review across your whole book, grounded on your
            real customer health scores and open opportunity pipeline. Generated once per quarter —
            regenerate to refresh it with the latest data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {isReady ? (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={generating} onClick={() => generate(true)}>
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Regenerate
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={generating || loading} onClick={() => generate(false)}>
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              Generate QBR
            </Button>
          )}
          {qbr?.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Generated {new Date(qbr.generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-hidden rounded-md border bg-white">
          {loading || generating ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <span className="text-sm">{generating ? "Writing your QBR — this can take a moment…" : "Loading…"}</span>
            </div>
          ) : isReady ? (
            <iframe
              srcDoc={qbr!.htmlContent}
              title={qbr!.title}
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground text-center px-6">
              {qbr?.status === "failed"
                ? `Generation failed: ${qbr.errorMessage ?? "unknown error"}. Try again.`
                : "No QBR yet for this quarter. Click Generate QBR to create one."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MspExecutivePage() {
  const { fetchWithAuth, user } = useAuth();
  const [book, setBook] = useState<ExecutiveBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [qbrOpen, setQbrOpen] = useState(false);

  // QBR generation is a whole-book leadership action — MSPAdmin+ only (matches
  // the backend requireRole("MSPAdmin") gate). Legacy admins map to PlatformAdmin.
  const canGenerateQbr =
    user?.role === "admin" || user?.mspRole === "MSPAdmin" || user?.mspRole === "PlatformAdmin";

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/msp/executive")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as ExecutiveBook;
        if (mounted) setBook(data);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [fetchWithAuth]);

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold">Executive Mode</h1>
              <p className="text-sm text-muted-foreground">
                Your book at a glance — who needs attention, where the revenue is, and a quarterly review.
              </p>
            </div>
          </div>
          {canGenerateQbr && (
            <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setQbrOpen(true)}>
              <FileText className="size-3.5" /> Partner QBR
            </Button>
          )}
        </div>

        {/* Roll-up */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {loading || !book ? (
            <>
              <Skeleton className="h-[72px] w-full" />
              <Skeleton className="h-[72px] w-full" />
              <Skeleton className="h-[72px] w-full" />
            </>
          ) : (
            <>
              <StatTile
                icon={Activity}
                label="Average book health"
                value={book.rollup.avgGoodnessPercent != null ? `${book.rollup.avgGoodnessPercent}%` : "No data"}
                hint={`${book.customerCount} customer${book.customerCount === 1 ? "" : "s"}`}
              />
              <StatTile
                icon={ShieldAlert}
                label="Customers at risk"
                value={String(book.rollup.atRiskCount)}
                hint="below health threshold"
              />
              <StatTile
                icon={DollarSign}
                label="Open opportunity"
                value={usd(book.rollup.totalOpenOpportunityCents)}
                hint={`${book.rollup.openOfferCount} open offer${book.rollup.openOfferCount === 1 ? "" : "s"}`}
              />
            </>
          )}
        </div>

        {/* Two lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top risks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" /> Top At-Risk Customers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : !book || book.topRisks.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No health scores recorded yet — nothing to flag.
                </div>
              ) : (
                book.topRisks.map((r, i) => (
                  <div key={r.customerId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.capturedAt ? `As of ${new Date(r.capturedAt).toLocaleDateString()}` : "No timestamp"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={healthBadgeClass(r.goodnessPercent)}>{r.goodnessPercent}% health</Badge>
                      <Link href={`/customers/${r.customerId}`}>
                        <Button variant="ghost" size="sm"><ChevronRight className="h-4 w-4" /></Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Top opportunities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> Top Opportunities
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : !book || book.topOpportunities.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No open sales offers across your book yet.
                </div>
              ) : (
                book.topOpportunities.map((o, i) => (
                  <div key={o.customerId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{o.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {o.openOfferCount} open offer{o.openOfferCount === 1 ? "" : "s"}
                          {o.topOfferTitle ? ` · ${o.topOfferTitle}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-emerald-500/15 text-emerald-400">{usd(o.totalValueCents)}</Badge>
                      <Link href={`/customers/${o.customerId}`}>
                        <Button variant="ghost" size="sm"><ChevronRight className="h-4 w-4" /></Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {qbrOpen && <QbrDialog onClose={() => setQbrOpen(false)} />}
    </AppShell>
  );
}
