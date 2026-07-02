import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { REQUIRED_PERMISSIONS } from "@/lib/requiredPermissions";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { DEFAULT_QUICK_WIN_STEPS } from "@/lib/quickWinCopy";

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

function StepAppRegistration({ onSaveAndContinue, onSkip }: { onSaveAndContinue: (tenantId: string, clientId: string, secret: string) => Promise<void>; onSkip: () => void }) {
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Your App Registration Credentials</p>
          </div>
          <div className="px-5 py-5 space-y-4">
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
      <div className="flex-shrink-0 border-t border-gray-100 bg-white px-8 py-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Submit &amp; Finish
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </form>
  );
}

// ── Step: Quick Win Diagnostic ────────────────────────────────────────────────

function StepQuickWin({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  const { state, dispatch } = useQuickWinMode();
  const hasLaunchedRef = useRef(false);

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
        steps: DEFAULT_QUICK_WIN_STEPS,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the overlay closes (mode → Idle) after launch, auto-advance the wizard
  useEffect(() => {
    if (hasLaunchedRef.current && state.mode === "Idle") {
      onComplete();
    }
  }, [state.mode, onComplete]);

  // This step renders nothing visible — the Quick Win overlay takes the full screen.
  // The wizard sidebar remains behind it (z-9999 < overlay z-10000).
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

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function OnboardingWizard({ mode = "onboarding" }: { mode?: "onboarding" | "update" }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState<StepId | "done">("app-reg");
  const [completing, setCompleting] = useState(false);

  const completeWizard = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await fetchWithAuth("/api/portal/onboarding/complete", { method: "POST" });
    } catch {
      // non-fatal, continue to dashboard
    }
    setCurrentStep("done");
    setCompleting(false);
  }, [fetchWithAuth, completing]);

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
    // In onboarding mode advance to step 2; in update mode finish immediately
    if (mode === "update") {
      await completeWizard();
    } else {
      setCurrentStep("quick-win");
    }
  }

  async function handleSkip() {
    if (mode === "update") {
      navigate("/portal/app-registration");
    } else {
      // Skip Azure credentials — go to the Quick Win step
      setCurrentStep("quick-win");
    }
  }

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
        <div className="px-7 pt-8 pb-6 border-b border-white/10">
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
        <div className="px-7 pt-6 pb-5">
          {mode === "update" ? (
            <>
              <p className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider mb-1.5">Update credentials</p>
              <h2 className="text-lg font-bold text-white leading-tight">Re-run Automation Setup</h2>
              <p className="text-xs text-white/40 mt-2 leading-relaxed">
                Update your Azure App Registration credentials. Changes save when you click "Submit &amp; Finish".
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider mb-1.5">Welcome aboard</p>
              <h2 className="text-lg font-bold text-white leading-tight">Let's set up your workspace</h2>
              <p className="text-xs text-white/40 mt-2 leading-relaxed">
                This takes about 5 minutes. You can skip any step and come back later.
              </p>
            </>
          )}
        </div>

        {/* Steps */}
        <div className="px-4 flex-1">
          {STEPS.map((step, idx) => {
            const isActive = currentStep === step.id;
            const stepPos = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
            const isDone = stepPos > idx;

            return (
              <div key={step.id} className="relative">
                {/* Connector line */}
                {idx < STEPS.length - 1 && (
                  <div className={`absolute left-[23px] top-[44px] w-0.5 h-8 ${isDone ? "bg-[#0078D4]" : "bg-white/10"}`} />
                )}

                <div className={`flex items-start gap-3.5 px-3 py-3 rounded-xl transition-all ${isActive ? "bg-white/10" : ""}`}>
                  {/* Step indicator */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                    isDone
                      ? "bg-[#0078D4] border-[#0078D4]"
                      : isActive
                        ? "bg-[#0078D4]/20 border-[#0078D4]"
                        : "bg-transparent border-white/20"
                  }`}>
                    {isDone ? (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className={`text-xs font-bold ${isActive ? "text-[#0078D4]" : "text-white/30"}`}>{idx + 1}</span>
                    )}
                  </div>

                  <div className="pt-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isActive ? "text-white" : isDone ? "text-white/70" : "text-white/30"}`}>
                      {step.label}
                    </p>
                    <p className={`text-xs mt-0.5 truncate ${isActive ? "text-white/50" : "text-white/20"}`}>{step.sublabel}</p>
                  </div>

                  {isActive && (
                    <div className="flex-shrink-0 pt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Done step */}
          {currentStep === "done" && (
            <div className="flex items-start gap-3.5 px-3 py-3 rounded-xl bg-white/10">
              <div className="w-8 h-8 rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="pt-1">
                <p className="text-sm font-semibold text-white">Complete</p>
                <p className="text-xs text-white/50 mt-0.5">All set!</p>
              </div>
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="px-6 py-5 border-t border-white/10">
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-3.5 h-3.5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">End-to-end encrypted</span>
          </div>
          <p className="text-[11px] text-white/30 leading-relaxed">
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
            <span className="text-xs text-white/50">Step {stepIndex + 1} of {STEPS.length}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-gray-200">
            <div
              className="h-1 transition-all duration-500"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
            />
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
              onSkip={handleSkip}
            />
          )}
          {currentStep === "quick-win" && (
            <StepQuickWin
              onComplete={completeWizard}
              onSkip={completeWizard}
            />
          )}
          {currentStep === "done" && (
            <StepComplete onGoToDashboard={handleGoToDashboard} />
          )}
        </div>
      </div>
    </div>
  );
}
