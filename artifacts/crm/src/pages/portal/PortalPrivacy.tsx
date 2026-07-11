import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

type AlertState = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert, onDismiss }: { alert: AlertState; onDismiss?: () => void }) {
  if (!alert) return null;
  const isSuccess = alert.type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
      isSuccess
        ? "bg-green-50 border-green-200 text-green-800"
        : "bg-red-50 border-red-200 text-red-700"
    }`}>
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {isSuccess
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
        }
      </svg>
      <span className="flex-1">{alert.message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="flex-shrink-0 opacity-60 hover:opacity-100">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SectionCard({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#0A2540]">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
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
    <SectionCard
      icon={
        <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      }
      title="Download My Data"
      description="Export a copy of all your account, project, and billing data"
    >
      <AlertBox alert={alert} onDismiss={() => setAlert(null)} />
      <div className="flex items-start gap-3 mt-1">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Download a JSON archive of everything Shane McCaw Consulting holds about you: your profile, projects, documents, invoices, messages, and activity history.
          </p>
          <ul className="mt-2 space-y-1">
            {["Account profile & contact details", "All projects and their status", "Documents and generated reports", "Invoices and billing records", "Message threads", "Microsoft 365 profile data (if collected)", "Your portal activity history"].map(item => (
              <li key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Payment card details are held by Stripe and are not included — access those at{" "}
            <a href="https://stripe.com" target="_blank" rel="noopener noreferrer" className="text-[#0078D4] underline underline-offset-2">stripe.com</a>.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <button
          onClick={() => void handleExport()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-[#0078D4] px-4 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Preparing export…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download My Data
            </>
          )}
        </button>
      </div>
    </SectionCard>
  );
}

function DeletionRequestCard() {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
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
      setStep("idle");
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Request failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <SectionCard
        icon={
          <svg className="w-4.5 h-4.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        }
        title="Deletion Request Submitted"
        description="Your request has been received"
      >
        <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
          <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800">
            Your deletion request has been logged. We will process it within <strong>30 days</strong> and send a confirmation to your email address.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon={
        <svg className="w-4.5 h-4.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      }
      title="Request Account Deletion"
      description="Ask us to delete your personal data and close your account"
    >
      <AlertBox alert={alert} onDismiss={() => setAlert(null)} />

      {step === "idle" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You may request that we delete your personal data and project records. Before submitting, please read what is and isn&apos;t deleted.
          </p>
          <div className="rounded-xl border border-border overflow-hidden text-xs">
            <div className="grid grid-cols-2 bg-[#0A2540]/5 px-3 py-2 font-semibold text-[#0A2540]">
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
                    {del && <svg className="w-3 h-3 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                    {del}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {keep && <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                    {keep}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Contracts and invoices are retained because they are legal and financial records required by applicable law. They will not be used for marketing.
          </p>
          <button
            onClick={() => setStep("confirm")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700 border border-amber-300 bg-amber-50 px-4 py-2.5 rounded-xl hover:bg-amber-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Request Account Deletion
          </button>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-amber-800">
              <strong>Are you sure?</strong> This will permanently delete your account and all project data. Signed contracts and invoices are retained per legal requirements as described above.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep("idle")}
              disabled={loading}
              className="flex-1 text-sm font-medium text-muted-foreground border border-border px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="flex-1 text-sm font-semibold text-white bg-red-600 px-4 py-2.5 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Submitting…" : "Yes, Request Deletion"}
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export default function PortalPrivacy() {
  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-[#0A2540]">Privacy & Data</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Download a copy of your data or request account deletion — your rights under applicable privacy law.
          </p>
        </div>

        <div className="rounded-2xl border border-[#0078D4]/20 bg-[#0078D4]/5 px-5 py-4 mb-6 text-sm text-[#0A2540]">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold mb-0.5">Your data rights</p>
              <p className="text-[#0A2540]/70">
                Shane McCaw Consulting LLC stores your data in US-based infrastructure. You have the right to access a copy of your data and to request its deletion. Deletion requests are processed within 30 days.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <DataExportCard />
          <DeletionRequestCard />
        </div>

        <div className="mt-8 rounded-xl border border-border bg-[#F7F9FC] px-5 py-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-[#0A2540] text-sm mb-2">Platform compliance posture</p>
          <p>• <strong>Data residency:</strong> US-only. All servers, databases, and storage are hosted in US data centers.</p>
          <p>• <strong>SOC 2:</strong> Targeted for Phase 2 (12–18 months). Controls are documented and available for review under NDA.</p>
          <p>• <strong>Accessibility:</strong> WCAG 2.1 AA target. Formal audit planned for Phase 2.</p>
          <p>• Questions? Email <a href="mailto:info@shanemccaw.com" className="text-[#0078D4] underline underline-offset-2">info@shanemccaw.com</a>.</p>
        </div>
      </div>
    </PortalLayout>
  );
}
