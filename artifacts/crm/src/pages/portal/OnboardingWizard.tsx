import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { REQUIRED_PERMISSIONS } from "@/lib/requiredPermissions";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { DEFAULT_QUICK_WIN_STEPS } from "@/lib/quickWinCopy";
import { ManualScriptUploadCard, type ManualScriptRecord } from "@/components/ManualScriptUploadCard";
// ── Outer wizard steps ────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "app-reg",
    label: "Automation Setup",
    sublabel: "Azure App Registration",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    id: "quick-win",
    label: "Quick Win Diagnostic",
    sublabel: "Free M365 health check",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: "review-results",
    label: "Review Results",
    sublabel: "M365 health check results",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
] as const;
type StepId = (typeof STEPS)[number]["id"];

// ── Small UI helpers ──────────────────────────────────────────────────────────

const inputClassLight =
  "w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-[#0A2540] text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors";

function FieldLight({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="flex-shrink-0 text-xs font-semibold text-[#0078D4] hover:text-[#00B4D8] transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Step: App Registration ────────────────────────────────────────────────────

function StepAppRegistration({ onSaveAndContinue }: { onSaveAndContinue: (tenantId: string, clientId: string, secret: string) => Promise<void> }) {
  const [tenantId, setTenantId] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId.trim() || !azureClientId.trim() || !clientSecret.trim()) {
      setError("All three credential fields are required.");
      return;
    }
    setSaving(true);
    try {
      await onSaveAndContinue(tenantId.trim(), azureClientId.trim(), clientSecret.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credentials. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-5">
        <div className="mb-2">
          <h2 className="text-2xl font-bold text-[#0A2540]">Connect Your Azure Tenant</h2>
          <p className="text-sm text-gray-500 mt-1.5">
            Create a read-only Azure App Registration so Shane's automation scripts can work inside your M365 environment. You retain full control and can revoke access at any time.
          </p>
        </div>

        {/* What happens after this step */}
        <div className="rounded-xl border border-[#0078D4]/30 overflow-hidden">
          <div className="bg-[#0078D4]/8 px-4 py-2.5 border-b border-[#0078D4]/20">
            <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider">What happens after you connect</p>
          </div>
          <div className="bg-white px-4 py-3 grid grid-cols-3 gap-3">
            {[
              { n: "1", label: "Connect", desc: "You add your App Registration credentials here" },
              { n: "2", label: "Automation runs", desc: "Shane's scripts read your M365 environment" },
              { n: "3", label: "Insights appear", desc: "Your portal fills with findings & a project plan" },
            ].map(step => (
              <div key={step.n} className="text-center">
                <div className="w-7 h-7 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center mx-auto mb-1.5">{step.n}</div>
                <p className="text-xs font-semibold text-[#0A2540]">{step.label}</p>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Security callout */}
        <div className="bg-[#0A2540] rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-0.5">Your credentials are stored in Azure Key Vault</p>
            <p className="text-xs text-white/60 leading-relaxed">
              The Client Secret you enter is transmitted over HTTPS and stored immediately in Azure Key Vault — never written to this app's database. You can revoke access at any time by deleting the App Registration.
            </p>
          </div>
        </div>

        {/* Required permissions — collapsible */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setPermissionsExpanded(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#F7F9FC] transition-colors"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Required API Permissions</p>
              <p className="text-xs text-gray-400 mt-0.5">Grant all as Application permissions in your App Registration</p>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${permissionsExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {permissionsExpanded && (
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {REQUIRED_PERMISSIONS.map(group => (
                <div key={group.category}>
                  <div className="px-5 py-2 bg-[#0A2540]/[0.03]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#0A2540]/50">{group.category}</span>
                  </div>
                  {group.permissions.map(({ permission, reason }) => (
                    <div key={permission} className="px-5 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <code className="text-xs font-mono font-semibold text-[#0078D4] bg-[#0078D4]/8 px-2 py-0.5 rounded">{permission}</code>
                        <p className="text-xs text-gray-500 mt-1">{reason}</p>
                      </div>
                      <CopyButton text={permission} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="px-5 py-3 bg-amber-50">
                <p className="text-xs text-amber-700">
                  <strong>After granting permissions:</strong> click <strong>Grant admin consent</strong> in the Azure portal.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Step-by-step guide */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Step-by-Step Setup</p>
          </div>
          <ol className="divide-y divide-gray-50">
            {[
              { n: 1, title: "Open Microsoft Entra ID", body: "Go to portal.azure.com and sign in as a Global Administrator. Choose Microsoft Entra ID in the left sidebar." },
              { n: 2, title: "Create a new App Registration", body: 'Select App Registrations → New Registration. Name it "Shane McCaw Automation" and leave account type as "Accounts in this organizational directory only". Click Register.' },
              { n: 3, title: "Copy your Tenant ID and Client ID", body: "On the Overview page copy the Application (client) ID and Directory (tenant) ID — paste them into the form below." },
              { n: 4, title: "Grant the required API permissions", body: "Go to API Permissions → Add a permission → Microsoft Graph → Application permissions. Search for and add every permission in the list above. Then click Grant admin consent." },
              { n: 5, title: "Create a Client Secret", body: "Go to Certificates & Secrets → New client secret. Set expiry to 24 months. Click Add, then immediately copy the Value shown — it is only visible once." },
            ].map(step => (
              <li key={step.n} className="flex gap-4 px-5 py-4">
                <div className="w-6 h-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-[#0078D4]">{step.n}</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#0A2540] mb-0.5">{step.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Credential fields */}
        <div className="rounded-2xl border-2 border-[#0078D4] shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-[#0078D4] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">Your App Registration Credentials</p>
              <p className="text-xs text-white/70 mt-0.5">Paste the values from Azure — this is the action required to proceed</p>
            </div>
          </div>
          <div className="bg-white px-5 py-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {error}
              </div>
            )}

            <FieldLight label="Tenant ID (Directory ID)" hint="Found on the Entra ID overview page">
              <input
                type="text"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className={`${inputClassLight} font-mono`}
                autoComplete="off"
              />
            </FieldLight>

            <FieldLight label="Client ID (Application ID)" hint="Found under Application (client) ID on the Overview page">
              <input
                type="text"
                value={azureClientId}
                onChange={e => setAzureClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className={`${inputClassLight} font-mono`}
                autoComplete="off"
              />
            </FieldLight>

            <FieldLight label="Client Secret" hint="From Certificates & Secrets — only visible immediately after creation">
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Paste the secret value here"
                  className={`${inputClassLight} pr-10 font-mono`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showSecret ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </FieldLight>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white px-8 py-4 flex items-center justify-end gap-4">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Begin Assessment
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </form>
  );
}

// ── Wizard manual-script block (fetches onboarding scripts, shows centered) ───

type ManualScriptWithProject = ManualScriptRecord & { projectId: number };

function WizardManualScripts({ onAnyCompleted }: { onAnyCompleted?: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [scripts, setScripts] = useState<ManualScriptWithProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/onboarding/manual-scripts")
      .then(r => r.ok ? (r.json() as Promise<ManualScriptWithProject[]>) : ([] as ManualScriptWithProject[]))
      .then(data => setScripts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCompleted = (runResultId: number) => {
    setScripts(prev => prev.map(s =>
      s.runResultId === runResultId
        ? { ...s, status: "completed" as const, uploadedAt: new Date().toISOString() }
        : s
    ));
    onAnyCompleted?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (scripts.length === 0) return null;

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm font-bold text-[#0A2540]">
          Manual steps required — download and run the script below
        </p>
      </div>
      {scripts.map(s => (
        <ManualScriptUploadCard
          key={s.runResultId}
          script={s}
          projectId={s.projectId}
          onCompleted={() => handleCompleted(s.runResultId)}
        />
      ))}
    </div>
  );
}

// ── Step: Quick Win Diagnostic ────────────────────────────────────────────────

function StepQuickWin({
  onComplete,
  onSavePartial,
}: {
  onComplete: () => void;
  onSavePartial: () => void;
}) {
  const { state, dispatch } = useQuickWinMode();
  const hasLaunchedRef = useRef(false);
  // Prevent duplicate partial-save calls if the mode flickers
  const partialSavedRef = useRef(false);

  // Auto-launch the overlay immediately when this step mounts
  useEffect(() => {
    if (hasLaunchedRef.current) return;
    hasLaunchedRef.current = true;
    dispatch({
      type: "SELECT_QUICK_WIN",
      payload: {
        id: "qw-onboarding-security",
        title: "Security Baseline Diagnostic",
        description: "Automated scan of your M365 security posture with actionable findings.",
        category: "Security",
        steps: [],
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // As soon as an error occurs, save a partial result (score=0) so
  // wizardResultsReady is set. This prevents the RequireEngagement gate
  // from looping the client back to the wizard if they close the tab or
  // the network stays down after the diagnostic failure.
  useEffect(() => {
    if (hasLaunchedRef.current && state.mode === "Error" && !partialSavedRef.current) {
      partialSavedRef.current = true;
      onSavePartial();
    }
  }, [state.mode, onSavePartial]);

  // When the overlay closes (mode → Idle) after launch, auto-advance the wizard
  useEffect(() => {
    if (hasLaunchedRef.current && state.mode === "Idle") {
      onComplete();
    }
  }, [state.mode, onComplete]);

  // Show a recovery UI within the wizard when the diagnostic errors.
  // The FullScreenWrapper also shows Retry/Exit, but this provides a
  // visible fallback in case the overlay somehow closed without setting Idle.
  if (hasLaunchedRef.current && state.mode === "Error") {
    return (
      <div className="h-full overflow-y-auto px-8 py-10">
        <div className="max-w-xl mx-auto flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-5 flex-shrink-0">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#0A2540] mb-2">Diagnostic encountered an issue</h2>
          <p className="text-sm text-gray-500 mb-1 max-w-xs leading-relaxed">
            {state.errorMessage ?? "An unexpected error occurred during the automated step."}
          </p>
          <p className="text-xs text-gray-400 mb-6 max-w-xs leading-relaxed">
            Your progress has been saved. If a manual script was generated you can run it below, or retry the diagnostic.
          </p>
          <div className="flex flex-col gap-3 w-full max-w-xs mb-8">
            <button
              type="button"
              onClick={() => {
                partialSavedRef.current = false;
                dispatch({ type: "RETRY_STEP" });
              }}
              className="flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry diagnostic
            </button>
            <button
              type="button"
              onClick={onComplete}
              className="flex items-center justify-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              Continue without results
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Manual script card — full-width, centered, prominent */}
        <WizardManualScripts onAnyCompleted={onComplete} />
      </div>
    );
  }

  // During normal diagnostic flow the Quick Win overlay takes the full screen.
  // The wizard sidebar remains visible behind it (z-9999 < overlay z-10000).
  return null;
}

// ── Complete step (success) ───────────────────────────────────────────────────

function StepComplete({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-[#0A2540] mb-3">You're all set!</h2>
      <p className="text-sm text-gray-500 max-w-md mb-8 leading-relaxed">
        Shane has everything he needs to get started. Your credentials are secured in Azure Key Vault. Shane will verify your connection within one business day.
      </p>
      <button
        onClick={onGoToDashboard}
        className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-8 py-3 rounded-xl transition-colors"
      >
        Go to your dashboard
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

// ── Step: Review Results ──────────────────────────────────────────────────────

function StepReviewResults({ onFinish }: { onFinish: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [scorecard, setScorecard] = useState<{ hasData: boolean; latest?: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/m365-scorecard-history")
      .then(r => r.ok ? (r.json() as Promise<{ hasData: boolean; latest?: Record<string, number> }>) : { hasData: false })
      .then(data => setScorecard(data))
      .catch(() => setScorecard({ hasData: false }))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const LABELS: Record<string, string> = {
    security: "Security Posture",
    compliance: "Compliance Coverage",
    copilot: "Copilot Readiness",
    governance: "Governance Maturity",
    productivity: "Adoption Score",
  };

  const scores = scorecard?.latest ?? {};
  const cats = Object.keys(LABELS).filter(k => scores[k] !== undefined);
  const overall = cats.length > 0
    ? Math.round(cats.reduce((a, k) => a + (scores[k] ?? 0), 0) / cats.length)
    : 0;
  const hasData = !!(scorecard?.hasData) && cats.length > 0;

  function ringColor(s: number) {
    if (s >= 70) return "#22c55e";
    if (s >= 40) return "#f59e0b";
    return "#ef4444";
  }
  function barColor(s: number) {
    if (s >= 70) return "bg-green-500";
    if (s >= 40) return "bg-amber-400";
    return "bg-red-500";
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div>
          <p className="text-xs font-semibold text-[#0078D4] uppercase tracking-wider mb-1">Step 3 of 3</p>
          <h2 className="text-2xl font-bold text-[#0A2540] leading-tight">
            {hasData ? "Your M365 health check results" : "Diagnostic results"}
          </h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {hasData
              ? "Here's a summary of your Microsoft 365 environment health. Full details are available on the results page."
              : "The diagnostic encountered an issue — Shane has been notified and will follow up with your results manually."}
          </p>
        </div>

        {hasData ? (
          <>
            {/* Score ring */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 flex items-center gap-6">
              <div className="flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r="34"
                    fill="none"
                    stroke={ringColor(overall)}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - overall / 100)}`}
                    transform="rotate(-90 40 40)"
                  />
                  <text x="40" y="46" textAnchor="middle" fill="#0A2540" fontSize="20" fontWeight="700">{overall}</text>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-500">Overall M365 Score</p>
                <p className="text-3xl font-extrabold text-[#0A2540]">{overall}<span className="text-lg font-normal text-gray-400">/100</span></p>
                <p className="text-xs text-gray-400 mt-1">{overall >= 70 ? "Healthy" : overall >= 40 ? "Needs Work" : "Critical"}</p>
              </div>
            </div>

            {/* Category bars */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 space-y-4">
              <p className="text-sm font-semibold text-[#0A2540]">Category breakdown</p>
              {cats.map(k => (
                <div key={k}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600">{LABELS[k]}</span>
                    <span className="text-xs font-bold text-[#0A2540]">{scores[k]}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all duration-700 ${barColor(scores[k] ?? 0)}`}
                      style={{ width: `${scores[k] ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-1">Diagnostic didn't complete automatically</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  This can happen if Azure credentials aren't configured yet, or if there was a temporary network interruption. If a manual script was generated, complete it below to submit your results.
                </p>
              </div>
            </div>
            <WizardManualScripts />
          </>
        )}

        {/* Finish / View results button */}
        <button
          onClick={onFinish}
          className="w-full flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#005a9e] text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          {hasData ? "View full results" : "Finish setup"}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

const WIZARD_STEP_KEY = "onboarding-wizard-step";

export default function OnboardingWizard({ mode = "onboarding" }: { mode?: "onboarding" | "update" }) {
  const { fetchWithAuth, logout } = useAuth();
  const [, navigate] = useLocation();

  // Whether the client already has Azure credentials saved — used to auto-skip
  // the app-reg step and to show the "Update credentials" link.
  const [hasCredentials, setHasCredentials] = useState(false);

  // Restore last step from sessionStorage so a page refresh lands back on the
  // Quick Win progress screen without forcing the user to re-enter App Reg.
  // Only applies in onboarding mode — update mode always starts at app-reg.
  const [currentStep, setCurrentStep] = useState<StepId | "done">(() => {
    if (mode !== "onboarding") return "app-reg";
    const saved = sessionStorage.getItem(WIZARD_STEP_KEY);
    if (saved === "quick-win" || saved === "review-results") return saved as StepId;
    return "app-reg";
  });

  const [completing, setCompleting] = useState(false);
  const [stepsDrawerOpen, setStepsDrawerOpen] = useState(false);

  // On mount in onboarding mode, check if credentials already exist so we can
  // auto-skip the App Registration step and go straight to the diagnostic.
  const credentialCheckRef = useRef(false);
  useEffect(() => {
    if (mode !== "onboarding") return;
    if (credentialCheckRef.current) return;
    credentialCheckRef.current = true;

    fetchWithAuth("/api/portal/onboarding/wizard-status")
      .then(r => r.ok ? (r.json() as Promise<{ hasCredentials?: boolean }>) : { hasCredentials: false })
      .then(data => {
        const creds = !!data.hasCredentials;
        setHasCredentials(creds);
        // Only auto-skip if currently on app-reg step (not if already advanced)
        setCurrentStep(prev => {
          if (prev === "app-reg" && creds) return "quick-win";
          return prev;
        });
      })
      .catch(() => { /* non-fatal — keep showing app-reg */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep sessionStorage in sync with the current step.
  useEffect(() => {
    if (mode !== "onboarding") return;
    if (currentStep === "done") {
      sessionStorage.removeItem(WIZARD_STEP_KEY);
    } else {
      sessionStorage.setItem(WIZARD_STEP_KEY, currentStep);
    }
  }, [currentStep, mode]);

  // Save a partial/error result so wizardResultsReady is set in the database
  // immediately when the diagnostic fails. This is fire-and-forget — we don't
  // gate the UI on its success. Calling it multiple times is idempotent since
  // the endpoint only sets quickWinCompletedAt if not already set.
  const savePartialResult = useCallback(() => {
    void fetchWithAuth("/api/portal/onboarding/quick-win-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failed: true }),
    }).catch(() => {
      // Silently ignore — the user is already stuck; best effort only.
    });
  }, [fetchWithAuth]);

  const completeWizard = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    sessionStorage.removeItem(WIZARD_STEP_KEY);
    try {
      // Mark the quick-win diagnostic as complete — this sets wizardResultsReady
      // so the RequireEngagement gate knows to send the client to the results page.
      await fetchWithAuth("/api/portal/onboarding/quick-win-complete", { method: "POST" });
      // Also mark the overall wizard complete
      await fetchWithAuth("/api/portal/onboarding/complete", { method: "POST" });
    } catch {
      // non-fatal — advance to review step regardless
    }
    if (mode === "update") {
      setCurrentStep("done");
    } else {
      // In onboarding mode advance to the inline results review step
      setCurrentStep("review-results");
    }
    setCompleting(false);
  }, [fetchWithAuth, completing, mode]);

  function handleFinish() {
    navigate("/portal/onboarding/results");
  }

  async function handleAppRegSaveAndContinue(tenantId: string, clientId: string, secret: string) {
    const res = await fetchWithAuth("/api/portal/app-registration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, azureClientId: clientId, clientSecret: secret }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? "Could not save credentials.");
    }
    setHasCredentials(true);
    // In onboarding mode advance to step 2; in update mode finish immediately
    if (mode === "update") {
      await completeWizard();
    } else {
      setCurrentStep("quick-win");
    }
  }

  // Auto-dismiss the mobile steps drawer whenever the active step changes
  useEffect(() => {
    setStepsDrawerOpen(false);
  }, [currentStep]);

  function handleGoToDashboard() {
    navigate("/portal");
  }

  const stepIndex = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
  const progress = currentStep === "done" ? 100 : Math.round((Math.max(stepIndex, 0) / STEPS.length) * 100);

  return (
    <div className="fixed inset-0 flex bg-[#F7F9FC]" style={{ zIndex: 9999 }}>
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-col w-72 bg-[#0A2540] flex-shrink-0">
        {/* Logo area */}
        <div className="px-7 pt-8 pb-6 [@media(max-height:700px)]:pt-4 [@media(max-height:700px)]:pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold text-white leading-tight">Shane McCaw</p>
              <p className="text-[10px] text-white/40">Consulting Portal</p>
            </div>
          </div>
        </div>

        {/* Welcome */}
        <div className="px-7 pt-6 pb-5 [@media(max-height:700px)]:pt-3 [@media(max-height:700px)]:pb-2">
          {mode === "update" ? (
            <>
              <p className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider mb-1.5 [@media(max-height:700px)]:mb-1">Update credentials</p>
              <h2 className="text-lg font-bold text-white leading-tight [@media(max-height:700px)]:text-base">Re-run Automation Setup</h2>
              <p className="text-xs text-white/40 mt-2 leading-relaxed [@media(max-height:700px)]:mt-1 [@media(max-height:700px)]:text-[10px] [@media(max-height:700px)]:leading-snug">
                Update your Azure App Registration credentials. Changes save when you click "Begin Assessment".
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider mb-1.5 [@media(max-height:700px)]:mb-1">Welcome aboard</p>
              <h2 className="text-lg font-bold text-white leading-tight [@media(max-height:700px)]:text-base">Let's set up your workspace</h2>
              <p className="text-xs text-white/40 mt-2 leading-relaxed [@media(max-height:700px)]:mt-1 [@media(max-height:700px)]:text-[10px] [@media(max-height:700px)]:leading-snug">
                This takes about 5 minutes. Complete each step to get your results.
              </p>
              {/* Update credentials link — visible when credentials exist and we're not already on app-reg */}
              {hasCredentials && currentStep !== "app-reg" && (
                <button
                  type="button"
                  onClick={() => setCurrentStep("app-reg")}
                  className="mt-3 flex items-center gap-1.5 text-[11px] text-[#00B4D8]/70 hover:text-[#00B4D8] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Update credentials
                </button>
              )}
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-7 pb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Progress</span>
            <span className="text-[10px] font-semibold text-white/50">
              {stepIndex} of {STEPS.length} tasks completed
            </span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="px-4 flex-1 overflow-y-auto">
          {STEPS.map((step, idx) => {
            const isActive = currentStep === step.id;
            const stepPos = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
            const isDone = stepPos > idx;

            return (
              <div key={step.id} className="relative">
                {/* Connector line */}
                {idx < STEPS.length - 1 && (
                  <div className={`absolute left-[23px] top-[44px] [@media(max-height:700px)]:top-[36px] w-0.5 h-8 [@media(max-height:700px)]:h-5 ${isDone ? "bg-[#0078D4]" : "bg-white/10"}`} />
                )}

                <div className={`flex items-start gap-3.5 px-3 py-3 [@media(max-height:700px)]:py-1.5 rounded-xl transition-all ${isActive ? "bg-white/10" : ""}`}>
                  {/* Step indicator */}
                  <div className={`w-8 h-8 [@media(max-height:700px)]:w-6 [@media(max-height:700px)]:h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                    isDone
                      ? "bg-[#0078D4] border-[#0078D4]"
                      : isActive
                        ? "bg-[#0078D4]/20 border-[#0078D4]"
                        : "bg-transparent border-white/20"
                  }`}>
                    {isDone ? (
                      <svg className="w-4 h-4 [@media(max-height:700px)]:w-3 [@media(max-height:700px)]:h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className={`text-xs font-bold ${isActive ? "text-[#0078D4]" : "text-white/30"}`}>{idx + 1}</span>
                    )}
                  </div>

                  <div className="pt-1 [@media(max-height:700px)]:pt-0 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isActive ? "text-white" : isDone ? "text-white/70" : "text-white/30"}`}>
                      {step.label}
                    </p>
                    <p className={`text-xs mt-0.5 [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:text-[10px] truncate ${isActive ? "text-white/50" : "text-white/20"}`}>{step.sublabel}</p>
                  </div>

                  {isActive && (
                    <div className="flex-shrink-0 pt-1.5 [@media(max-height:700px)]:pt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Done step */}
          {currentStep === "done" && (
            <div className="flex items-start gap-3.5 px-3 py-3 [@media(max-height:700px)]:py-1.5 rounded-xl bg-white/10">
              <div className="w-8 h-8 [@media(max-height:700px)]:w-6 [@media(max-height:700px)]:h-6 rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 [@media(max-height:700px)]:w-3 [@media(max-height:700px)]:h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="pt-1 [@media(max-height:700px)]:pt-0">
                <p className="text-sm font-semibold text-white">Complete</p>
                <p className="text-xs text-white/50 mt-0.5 [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:text-[10px]">All set!</p>
              </div>
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="px-5 pb-3 border-t border-white/10 pt-3 [@media(max-height:700px)]:pb-2 [@media(max-height:700px)]:pt-2">
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-all text-xs font-medium"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>

        {/* Security note */}
        <div className="px-6 py-4 [@media(max-height:700px)]:py-2 border-t border-white/10">
          <div className="flex items-center gap-2 mb-1.5 [@media(max-height:700px)]:mb-1">
            <svg className="w-3.5 h-3.5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">End-to-end encrypted</span>
          </div>
          <p className="text-[11px] text-white/30 leading-relaxed [@media(max-height:700px)]:text-[10px] [@media(max-height:700px)]:leading-snug">
            Credentials are transmitted via TLS and stored in Azure Key Vault — never in this app's database.
          </p>
        </div>
      </div>

      {/* ── Right content panel ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top progress bar + mobile header */}
        <div className="flex-shrink-0">
          {/* Mobile header */}
          <div className="md:hidden flex items-center justify-between px-5 py-4 bg-[#0A2540]">
            <p className="text-sm font-bold text-white">Workspace Setup</p>
            {/* Tappable steps indicator — opens the slide-up drawer */}
            <button
              type="button"
              onClick={() => setStepsDrawerOpen(o => !o)}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:bg-white/25 transition-colors rounded-lg px-3 py-1.5"
              aria-label="Show all steps"
              aria-expanded={stepsDrawerOpen}
            >
              <span className="text-xs font-semibold text-white/80">
                Step {currentStep === "done" ? STEPS.length : stepIndex + 1} of {STEPS.length}
              </span>
              <svg
                className={`w-3.5 h-3.5 text-white/60 transition-transform duration-200 ${stepsDrawerOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Mobile steps drawer — slide down when open */}
          <div
            className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out bg-[#0A2540] border-b border-white/10 ${stepsDrawerOpen ? "max-h-96" : "max-h-0"}`}
            aria-hidden={!stepsDrawerOpen}
          >
            {/* Backdrop tap-to-close */}
            {stepsDrawerOpen && (
              <div
                className="fixed inset-0 z-40"
                style={{ top: 0 }}
                onClick={() => setStepsDrawerOpen(false)}
              />
            )}
            <div className="relative z-50 px-4 py-4 space-y-1">
              {STEPS.map((step, idx) => {
                const isActive = currentStep === step.id;
                const stepPos = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
                const isDone = stepPos > idx;
                return (
                  <div key={step.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${isActive ? "bg-white/10" : ""}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
                      isDone ? "bg-[#0078D4] border-[#0078D4]" : isActive ? "bg-[#0078D4]/20 border-[#0078D4]" : "bg-transparent border-white/20"
                    }`}>
                      {isDone ? (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className={`text-xs font-bold ${isActive ? "text-[#0078D4]" : "text-white/30"}`}>{idx + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isActive ? "text-white" : isDone ? "text-white/70" : "text-white/30"}`}>
                        {step.label}
                      </p>
                      <p className={`text-xs truncate ${isActive ? "text-white/50" : "text-white/20"}`}>{step.sublabel}</p>
                    </div>
                    {isActive && <div className="flex-shrink-0 ml-auto w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />}
                  </div>
                );
              })}
              {currentStep === "done" && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/10">
                  <div className="w-7 h-7 rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Complete</p>
                    <p className="text-xs text-white/50">All set!</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Desktop header */}
          {currentStep !== "done" && (
            <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-100">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="font-semibold text-[#0A2540]">
                  Step {stepIndex + 1}
                </span>
                <span>/</span>
                <span>{STEPS.length}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
                  />
                </div>
                <span className="font-semibold text-[#0078D4]">{progress}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Step content */}
        <div className="flex-1 min-h-0 bg-[#F7F9FC]">
          {currentStep === "app-reg" && (
            <StepAppRegistration
              onSaveAndContinue={handleAppRegSaveAndContinue}
            />
          )}
          {currentStep === "quick-win" && (
            <StepQuickWin
              onComplete={completeWizard}
              onSavePartial={savePartialResult}
            />
          )}
          {currentStep === "review-results" && (
            <StepReviewResults onFinish={handleFinish} />
          )}
          {currentStep === "done" && (
            <StepComplete onGoToDashboard={handleGoToDashboard} />
          )}
        </div>
      </div>
    </div>
  );
}
