import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
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
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Shield,
  XCircle,
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
  cancellation_requested: "bg-amber-500/10 text-amber-700 border-amber-200",
  export_ready: "bg-blue-500/10 text-blue-700 border-blue-200",
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
  const { fetchWithAuth } = useAuth();
  const [info, setInfo] = useState<OffboardingInfo | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  return (
    <AppShell title="Offboarding">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Warning banner */}
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <CardTitle className="text-base text-amber-900">
                  Offboarding is irreversible once archived
                </CardTitle>
                <CardDescription className="text-amber-700 mt-1">
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
