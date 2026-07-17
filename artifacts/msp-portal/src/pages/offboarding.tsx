import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation, Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Shield,
  XCircle,
  Loader2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

type OffboardingState =
  | "cancellation_requested"
  | "export_ready"
  | "archival_flagged"
  | null;

interface OffboardingInfo {
  offboardingState: OffboardingState;
  offboardingRequestedAt?: string;
  exportReadyAt?: string;
  requestedAt?: string;
  export?: {
    exportedAt: string;
    msp: { id: number; name: string; slug: string };
    customers: Array<{ id: number; name: string; status: string; eventCount: number }>;
    summary: { totalCustomers: number; activeCustomers: number; totalEvents: number };
    notice: string;
  };
}

const STATE_LABELS: Record<NonNullable<OffboardingState>, string> = {
  cancellation_requested: "Cancellation Requested",
  export_ready: "Export Ready",
  archival_flagged: "Archived",
};

const STATE_COLORS: Record<NonNullable<OffboardingState>, string> = {
  cancellation_requested: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  export_ready: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  archival_flagged: "bg-muted text-muted-foreground border-border",
};

function OffboardingStep({
  number,
  title,
  description,
  done,
  active,
}: {
  number: number;
  title: string;
  description: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div className={`flex gap-4 py-4 ${active ? "" : "opacity-50"}`}>
      <div
        className={`shrink-0 size-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
          done
            ? "bg-primary border-primary text-primary-foreground"
            : active
              ? "border-primary text-primary"
              : "border-muted-foreground/30 text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="size-4" /> : number}
      </div>
      <div>
        <p className={`text-sm font-semibold ${done ? "line-through text-muted-foreground" : ""}`}>
          {title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function OffboardingPage() {
  const { fetchWithAuth, user } = useAuth();
  const [, navigate] = useLocation();
  const [info, setInfo] = useState<OffboardingInfo | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(user?.mspRole === "CustomerUser");
  const [customerStatus, setCustomerStatus] = useState<string>("active");

  useEffect(() => {
    if (user?.mspRole === "MSPAdmin") {
      fetchWithAuth("/api/msp/dashboard")
        .then((r) => r.json())
        .then((d) => {
          if (d?.msp) {
            setInfo({
              offboardingState: d.msp.offboardingState,
              offboardingRequestedAt: d.msp.offboardingRequestedAt,
              exportReadyAt: d.msp.exportReadyAt,
            });
          }
        })
        .catch(() => null);
    } else if (user?.mspRole === "CustomerUser" && user?.mspId === 1) {
      setLoading(true);
      fetchWithAuth("/api/portal/dashboard")
        .then((r) => r.json())
        .then((d) => {
          setCustomerStatus(d?.customerStatus ?? "active");
        })
        .catch(() => null)
        .finally(() => setLoading(false));
    }
  }, [fetchWithAuth, user?.mspRole, user?.mspId]);

  const currentState: OffboardingState = info?.offboardingState ?? null;

  async function handleRequestCancellation() {
    setRequesting(true);
    try {
      const res = await fetchWithAuth("/api/msp/offboarding/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Request failed");
      }
      const data = (await res.json()) as OffboardingInfo;
      setInfo(data);
      toast.success("Cancellation request submitted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request cancellation");
    } finally {
      setRequesting(false);
    }
  }

  async function handleGenerateExport() {
    setExporting(true);
    try {
      const res = await fetchWithAuth("/api/msp/offboarding/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Export failed");
      }
      const data = (await res.json()) as OffboardingInfo;
      setInfo(data);
      toast.success("Export package generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate export");
    } finally {
      setExporting(false);
    }
  }

  function downloadExport() {
    if (!info?.export) return;
    const blob = new Blob([JSON.stringify(info.export, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `msp-export-${info.export.msp.slug}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (user?.mspRole === "CustomerUser") {
    if (user.mspId !== 1) {
      return (
        <AppShell title="Offboarding">
          <div className="max-w-md mx-auto p-6 mt-10">
            <Card className="border-red-500/30 bg-red-500/10 backdrop-blur-sm shadow-lg overflow-hidden relative">
              <div className="absolute top-0 right-0 size-32 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />
              <CardHeader className="pb-3 text-center">
                <div className="size-12 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="size-6" />
                </div>
                <CardTitle className="text-lg font-bold text-red-300">
                  Contact Your Service Provider
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
                  Your account is managed by an external Managed Service Provider (MSP). To cancel or modify your subscriptions and monitoring services, please contact your MSP coordinator directly.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center pb-6 pt-2">
                <Button onClick={() => navigate("/customer-home")} variant="outline" className="border-red-500/30 text-red-300 hover:bg-red-500/10">
                  Back to Portal
                </Button>
              </CardContent>
            </Card>
          </div>
        </AppShell>
      );
    }

    if (loading) {
      return (
        <AppShell title="Offboarding">
          <div className="min-h-[50vh] flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </AppShell>
      );
    }

    const downloadCustomerData = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/customer/export");
        if (!res.ok) throw new Error("Failed to export data");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `customer-data-export-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Data export downloaded successfully");
      } catch (err) {
        toast.error("Failed to download data export");
      }
    };

    const handleCustomerOffboard = async () => {
      setRequesting(true);
      try {
        const res = await fetchWithAuth("/api/portal/customer/offboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        if (!res.ok) throw new Error("Offboarding failed");
        setCustomerStatus("inactive");
        toast.success("Successfully offboarded. Your services and monitoring have been deactivated.");
      } catch (err) {
        toast.error("Failed to complete offboarding");
      } finally {
        setRequesting(false);
      }
    };

    const isCustomerInactive = customerStatus === "inactive" || customerStatus === "archived";

    return (
      <AppShell title="Offboarding">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {isCustomerInactive ? (
            <>
              <Card className="border-emerald-500/30 bg-emerald-500/10 backdrop-blur-sm shadow-md overflow-hidden relative">
                <div className="absolute top-0 right-0 size-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
                <CardHeader className="pb-4">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 border border-emerald-500/30">
                      <CheckCircle2 className="size-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-bold text-emerald-300">
                          Services & Monitoring Deactivated
                        </CardTitle>
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">Deactivated</Badge>
                      </div>
                      <CardDescription className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        All active modernisation retainers have been paused and security/compliance monitoring has been disabled. You still have access to download your historical data package below.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Download Your Workspace Data</CardTitle>
                  <CardDescription>Get a full package of your modernization logs, documents, and reports.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => void downloadCustomerData()} className="gap-2" variant="outline">
                    <Download className="size-4" />
                    Download JSON Data Package
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-primary/45 bg-gradient-to-r from-primary/10 via-primary/5 to-background overflow-hidden relative shadow-lg">
                <div className="absolute top-0 right-0 size-32 bg-primary/5 rounded-full blur-2xl" />
                <CardContent className="p-6 sm:p-8 flex flex-col items-start gap-6">
                  <div className="space-y-2">
                    <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">Welcome Back Offer</Badge>
                    <h3 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                      Ready to modernise your cloud workplace again?
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Your cloud modernisation journey is backed by a 30-year Microsoft veteran and M365 Architect for NASA. Don&apos;t leave your organisation&apos;s security, licensing, and compliance to chance. Re-activate your modern workplace retainer today and get <strong>15% off your first month</strong>.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mt-2">
                    <Link href="/customer-diagnostics">
                      <Button className="w-full sm:w-auto gap-2 shadow-md">
                        <Zap className="size-4" />
                        Explore Re-activation Plans
                      </Button>
                    </Link>
                    <Link href="/support">
                      <Button variant="outline" className="w-full sm:w-auto">
                        Talk to Shane
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-amber-500/30 bg-amber-500/10 backdrop-blur-sm shadow-md overflow-hidden relative">
              <div className="absolute top-0 right-0 size-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3.5">
                  <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 border border-amber-500/30">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-amber-300">
                      Deactivate Services & Monitoring
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      Proceeding will cancel your active modernisation subscriptions and disable all modern workplace monitoring checks immediately.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2 flex flex-col gap-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your subscriptions will end and monitoring will be disabled. You will still retain access to the portal to download your historical data package.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => void handleCustomerOffboard()}
                  disabled={requesting}
                  className="gap-2 w-fit shadow-sm bg-destructive/90 hover:bg-destructive"
                >
                  <XCircle className="size-4" />
                  {requesting ? "Deactivating…" : "Deactivate services & monitoring"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Offboarding">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Warning banner */}
        <Card className="border-amber-500/30 bg-amber-500/10 backdrop-blur-sm shadow-md overflow-hidden relative">
          <div className="absolute top-0 right-0 size-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 border border-amber-500/30">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold text-amber-300">
                  Offboarding is irreversible once archived
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Your customer data will never be silently deleted. Export your data package before
                  archival — customers re-onboard under a new MSP independently.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Current state badge */}
        {currentState && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Current state:</span>
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${STATE_COLORS[currentState]}`}
            >
              {STATE_LABELS[currentState]}
            </span>
          </div>
        )}

        {/* Steps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Offboarding process</CardTitle>
            <CardDescription>Three steps — data is retained at each stage</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <OffboardingStep
              number={1}
              title="Request cancellation"
              description="Submit your cancellation intent. No services are terminated yet."
              done={
                currentState === "export_ready" || currentState === "archival_flagged"
              }
              active={!currentState}
            />
            <Separator />
            <OffboardingStep
              number={2}
              title="Generate customer data export"
              description="Download a full JSON package of your customers and their event history."
              done={currentState === "archival_flagged"}
              active={currentState === "cancellation_requested"}
            />
            <Separator />
            <OffboardingStep
              number={3}
              title="Platform admin confirms archival"
              description="A platform admin sets the final archival_flagged state. MSP record is retained."
              done={currentState === "archival_flagged"}
              active={currentState === "export_ready"}
            />
          </CardContent>
        </Card>

        {/* Action area */}
        {!currentState && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Step 1 — Request cancellation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Submitting this request notifies the platform and begins the offboarding
                sequence. Your MSP remains fully operational until archival is confirmed.
              </p>
              <Button
                variant="destructive"
                onClick={() => void handleRequestCancellation()}
                disabled={requesting}
                className="gap-2"
              >
                <XCircle className="size-4" />
                {requesting ? "Requesting…" : "Request cancellation"}
              </Button>
            </CardContent>
          </Card>
        )}

        {currentState === "cancellation_requested" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Step 2 — Export your data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Generate a full JSON export of all customer records and event history. You own this
                data — save it before the platform archives your MSP.
              </p>
              <Button
                onClick={() => void handleGenerateExport()}
                disabled={exporting}
                className="gap-2"
              >
                <Download className="size-4" />
                {exporting ? "Generating…" : "Generate export"}
              </Button>
            </CardContent>
          </Card>
        )}

        {currentState === "export_ready" && info?.export && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" />
                Export ready
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Total customers</dt>
                  <dd className="font-bold text-lg">{info.export.summary.totalCustomers}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Active customers</dt>
                  <dd className="font-bold text-lg">{info.export.summary.activeCustomers}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total events</dt>
                  <dd className="font-bold text-lg">{info.export.summary.totalEvents}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
                {info.export.notice}
              </p>
              <Button onClick={downloadExport} variant="outline" className="gap-2">
                <Download className="size-4" />
                Download JSON package
              </Button>
              <p className="text-xs text-muted-foreground">
                Waiting for platform admin to confirm archival (step 3).
              </p>
            </CardContent>
          </Card>
        )}

        {currentState === "archival_flagged" && (
          <Card className="border-muted">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="size-5 text-muted-foreground" />
                <CardTitle className="text-base text-muted-foreground">MSP archived</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This MSP has been archived. The record is retained per retention policy.
                Customers may re-onboard under a new MSP independently.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
