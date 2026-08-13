import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Download,
  Trash2,
  Info,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

type AlertState = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert, onDismiss }: { alert: AlertState; onDismiss?: () => void }) {
  if (!alert) return null;
  const isSuccess = alert.type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
      isSuccess
        ? "bg-green-50 border-green-200 text-green-800"
        : "bg-red-50 border-red-200 text-red-700"
    }`}>
      {isSuccess
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
        : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      }
      <span className="flex-1">{alert.message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="flex-shrink-0 opacity-60 hover:opacity-100">
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function DataExportCard() {
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const { fetchWithAuth } = useAuth();

  const handleExport = async () => {
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/portal/data-export");
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : "data-export.json";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setAlert({ type: "success", message: "Your data export has been downloaded." });
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Export failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Download className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Download My Data</p>
            <p className="text-xs text-muted-foreground">Export a copy of all your account, project, and billing data</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} onDismiss={() => setAlert(null)} />
        <p className="text-sm text-muted-foreground mb-2">
          Download a JSON archive of everything Shane McCaw Consulting holds about you: your profile, projects, documents, invoices, messages, and activity history.
        </p>
        <ul className="mb-3 space-y-1">
          {[
            "Account profile & contact details",
            "All projects and their status",
            "Documents and generated reports",
            "Invoices and billing records",
            "Message threads",
            "Microsoft 365 profile data (if collected)",
            "Your portal activity history",
          ].map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mb-4">
          Payment card details are held by Stripe and are not included — access those at{" "}
          <a href="https://stripe.com" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">stripe.com</a>.
        </p>
        <Button onClick={() => void handleExport()} disabled={loading} size="sm">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Preparing export…
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download My Data
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function DeletionRequestCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const { fetchWithAuth } = useAuth();

  const handleSubmit = async () => {
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/portal/deletion-request", { method: "POST" });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Request failed");
      setSubmitted(true);
      setDialogOpen(false);
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Request failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold">Deletion Request Submitted</p>
              <p className="text-xs text-muted-foreground">Your request has been received</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-800">
              Your deletion request has been logged. We will process it within <strong>30 days</strong> and send a confirmation to your email address.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold">Request Account Deletion</p>
              <p className="text-xs text-muted-foreground">Ask us to delete your personal data and close your account</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AlertBox alert={alert} onDismiss={() => setAlert(null)} />
          <p className="text-sm text-muted-foreground mb-3">
            You may request that we delete your personal data and project records. Before submitting, please read what is and isn&apos;t deleted.
          </p>
          <div className="rounded-xl border border-border overflow-hidden text-xs mb-3">
            <div className="grid grid-cols-2 bg-muted/50 px-3 py-2 font-semibold text-foreground">
              <span>What gets deleted</span>
              <span>What is retained by law</span>
            </div>
            <div className="divide-y divide-border">
              {[
                ["Your profile & login credentials", "Signed contracts & SOWs (7 years)"],
                ["Project records & documents", "Invoices & payment records (7 years)"],
                ["Messages & activity history", "Audit logs (3 years, then anonymized)"],
                ["M365 profile data", ""],
              ].map(([del, keep], i) => (
                <div key={i} className="grid grid-cols-2 px-3 py-2 text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {del && <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                    {del}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {keep && <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    {keep}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Contracts and invoices are retained because they are legal and financial records required by applicable law. They will not be used for marketing.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
            onClick={() => setDialogOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Request Account Deletion
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account and all project data. Signed contracts and invoices are retained per legal requirements as described above.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleSubmit(); }}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Yes, Request Deletion"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// The full real Privacy & Data experience (Download My Data + deletion
// request), sans AppShell, so the consolidated /customer-settings hub can
// embed it as a tab. Same endpoints (/api/portal/data-export,
// /api/portal/deletion-request), same actions.
export function PrivacySettingsContent() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Privacy & Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download a copy of your data or request account deletion — your rights under applicable privacy law.
        </p>
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-0.5">Your data rights</p>
            <p className="text-muted-foreground">
              Shane McCaw Consulting LLC stores your data in US-based infrastructure. You have the right to access a copy of your data and to request its deletion. Deletion requests are processed within 30 days.
            </p>
          </div>
        </div>
      </div>

      <DataExportCard />
      <DeletionRequestCard />

      <div className="rounded-xl border border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground text-sm mb-2">Platform compliance posture</p>
        <p>• <strong>Data residency:</strong> US-only. All servers, databases, and storage are hosted in US data centers.</p>
        <p>• <strong>SOC 2:</strong> Targeted for Phase 2 (12–18 months). Controls are documented and available for review under NDA.</p>
        <p>• <strong>Accessibility:</strong> WCAG 2.1 AA target. Formal audit planned for Phase 2.</p>
        <p>• Questions? Email <a href="mailto:info@shanemccaw.com" className="text-primary underline underline-offset-2">info@shanemccaw.com</a>.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">GDPR</Badge>
        <Badge variant="outline">CCPA</Badge>
        <Badge variant="outline">Data Portability</Badge>
        <Badge variant="outline">Right to Erasure</Badge>
      </div>
    </div>
  );
}

export default function CustomerPrivacyPage() {
  return (
    <AppShell title="Privacy & Data">
      <div className="p-6 max-w-2xl mx-auto">
        <PrivacySettingsContent />
      </div>
    </AppShell>
  );
}
