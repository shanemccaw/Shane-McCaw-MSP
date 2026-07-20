/**
 * customer-dashboard.tsx
 *
 * Step 4c — customer-facing real page for the Dashboard / Web Part System.
 * Renders the caller's applicable dashboard(s) (constrained show/hide/
 * resize/reposition editing only) via the shared <DashboardTabs>. A customer
 * with only "customer_default" (no monitoring package assigned, the common
 * case) sees no tab strip — <DashboardTabs> falls back to plain
 * <DashboardView> rendering when there's nothing to switch between.
 *
 * Added as a new nav item/route alongside the existing customer landing
 * pages (customer-home.tsx, command-center.tsx) rather than replacing either
 * — full customer-facing navigation changes are out of scope for this task.
 *
 * "Export as PDF" / "Export as PPT" / "Share link" toolbar mirrors the
 * DownloadButton/ShareDialog patterns already used for insights documents in
 * customer-documents.tsx, pointed at the dashboard-specific endpoints
 * (/api/portal/dashboard/pdf, /api/portal/dashboard/ppt, /api/portal/dashboard/share).
 * All three render a frozen point-in-time snapshot of the resolved dashboard,
 * not a live view.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { DashboardTabs } from "@/components/dashboard-view/DashboardView";
import { ExecutiveSummaryCard } from "@/components/dashboard-view/ExecutiveSummaryCard";
import { MissionControl } from "@/components/mission-control/MissionControl";
import { CustomerDashboardExtras, M365UptimeCard, NeedHelpCard, WelcomeHeader } from "@/components/mission-control/CustomerDashboardExtras";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";

function ExportPdfButton() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/dashboard/pdf");
      if (!res.ok) {
        toast.error("Export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "dashboard-snapshot.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleDownload()} disabled={loading}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      Export as PDF
    </Button>
  );
}

function ExportPptButton() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/dashboard/ppt");
      if (!res.ok) {
        toast.error("Export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "dashboard-snapshot.pptx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleDownload()} disabled={loading}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      Export as PPT
    </Button>
  );
}

function ShareDashboardDialog({ onClose }: { onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/dashboard/share", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          toast.error("Could not generate a share link. Please try again.");
          return;
        }
        const data = (await res.json()) as { shareUrl: string; expiresAt: string };
        if (mounted) {
          setShareUrl(data.shareUrl);
          setExpiresAt(data.expiresAt);
        }
      })
      .catch(() => toast.error("Could not generate a share link. Please try again."))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Could not copy link. Please copy it manually."));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Dashboard</DialogTitle>
          <DialogDescription>
            Anyone with this link can view a snapshot of this dashboard without signing in. The
            snapshot reflects data at the time this link was created and won't update — the link
            expires in 30 days.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : shareUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} className="text-xs font-mono" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleCopy}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {expiresAt && (
              <p className="text-xs text-muted-foreground">
                Expires {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to generate a share link right now.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerDashboardPage() {
  const { user } = useAuth();
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <AppShell title="Dashboard">
      <div className="p-6 space-y-6">
        {/* Page-level Mission Control content (hero / engine strip / findings
            feed) — sits above the resolved dashboard(s); only customers with a
            customer identity get it (MSP staff visiting this route don't).
            CustomerDashboardExtras carries the real content relocated from the
            old customer-home.tsx landing page (promo banner, recent reports). */}
        {user?.customerId != null && (
          <>
            <WelcomeHeader />
            <MissionControl />
            <CustomerDashboardExtras />
            <M365UptimeCard />
            <ExecutiveSummaryCard />
          </>
        )}
        {user?.customerId != null && (
          <div className="flex justify-end gap-2">
            <ExportPdfButton />
            <ExportPptButton />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShareOpen(true)}>
              <Share2 className="size-3.5" />
              Share
            </Button>
          </div>
        )}
        <DashboardTabs scope={{ type: "customer", id: user?.customerId ?? 0 }} title="Dashboard" />
        {/* Need-help card sits at the very bottom of the page, below the
            resolved dashboard canvas. */}
        {user?.customerId != null && <NeedHelpCard />}
      </div>
      {shareOpen && <ShareDashboardDialog onClose={() => setShareOpen(false)} />}
    </AppShell>
  );
}
