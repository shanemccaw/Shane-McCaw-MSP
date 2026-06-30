import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, ArrowRight, Loader2, RefreshCw, CreditCard, Eye, EyeOff, Mail } from "lucide-react";

interface PurchasedItem {
  name: string;
  isRecurring: boolean;
}

export default function OnboardingSuccess() {
  const { user, fetchWithAuth, setupPassword, login } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sessionId = params.get("session_id") ?? "";
  // setup_token is present when the user arrives via an emailed setup link
  const urlSetupToken = params.get("setup_token") ?? "";

  const [status, setStatus] = useState<"loading" | "paid" | "pending" | "needs_subscription" | "error" | "setup_link">("loading");
  const [purchasedItems, setPurchasedItems] = useState<PurchasedItem[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [pendingSubUrl, setPendingSubUrl] = useState<string | null>(null);
  const [nextBillingDate, setNextBillingDate] = useState<number | null>(null);
  const [clientEmail, setClientEmail] = useState<string>("");

  // Password setup state (for standalone setup-link mode)
  const [setupToken, setSetupToken] = useState<string | null>(urlSetupToken || null);
  const [setupPassword1, setSetupPassword1] = useState("");
  const [setupPassword2, setSetupPassword2] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [setupDone, setSetupDone] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Whether this is a new account whose setup link was sent by email (not inline)
  const [setupEmailSent, setSetupEmailSent] = useState(false);

  // Session and provision endpoints are public (session_id is the secret).
  // Authenticated users use fetchWithAuth for the dashboard poll after login.
  const doFetch = useCallback((url: string, init?: RequestInit): Promise<Response> => {
    if (user) {
      return fetchWithAuth(url, init);
    }
    return fetch(url, { ...init, credentials: "include" });
  }, [user, fetchWithAuth]);

  useEffect(() => {
    // ── Standalone setup-link mode (arrived via emailed setup link) ──────────
    // The URL contains setup_token but no session_id. Skip the Stripe session
    // check entirely and go directly to the password setup form.
    if (urlSetupToken && !sessionId) {
      setStatus("setup_link");
      return;
    }

    if (!sessionId) { setStatus("error"); return; }

    // Pre-populate email from user or guest info
    if (user?.email) {
      setClientEmail(user.email);
    } else {
      try {
        const g = JSON.parse(sessionStorage.getItem("onboardingGuest") ?? "{}") as { email?: string };
        if (g.email) setClientEmail(g.email);
      } catch { /* ignore */ }
    }

    const check = async () => {
      try {
        const res = await doFetch(`/api/portal/onboarding/session/${sessionId}`);
        if (!res.ok) { setStatus("error"); return; }
        const data = await res.json() as {
          status: string;
          metadata: Record<string, string>;
          mode?: string;
          nextBillingDate?: number | null;
        };

        if (data.nextBillingDate) setNextBillingDate(data.nextBillingDate);

        let resolvedItems: PurchasedItem[] = [];
        const storedCart = sessionStorage.getItem("onboardingCartSummary");
        if (storedCart) {
          try {
            const parsed = JSON.parse(storedCart) as Array<{ name: string; billingType: string }>;
            resolvedItems = parsed.map(i => ({
              name: i.name,
              isRecurring: i.billingType === "recurring_monthly",
            }));
          } catch { /* fall through */ }
        }

        if (resolvedItems.length === 0) {
          const serviceNamesRaw = data.metadata?.serviceName ?? "";
          const serviceNames = serviceNamesRaw.split(",").map(s => s.trim()).filter(Boolean);
          const isSubscriptionSession = data.mode === "subscription";
          resolvedItems = serviceNames.map(name => ({
            name,
            isRecurring: isSubscriptionSession,
          }));
        }

        setPurchasedItems(resolvedItems.length > 0 ? resolvedItems : [{ name: "your service", isRecurring: false }]);

        if (data.status === "paid" || data.status === "complete") {
          const storedSubUrl = sessionStorage.getItem("pendingCheckoutUrl");
          if (storedSubUrl) {
            sessionStorage.removeItem("pendingCheckoutUrl");
            setPendingSubUrl(storedSubUrl);
            setStatus("needs_subscription");
            return;
          }

          // Provision project — for new accounts the server emails the setup link
          try {
            const provRes = await doFetch(`/api/portal/onboarding/provision/${sessionId}`, { method: "POST" });
            if (provRes.ok) {
              const provData = await provRes.json() as { ok?: boolean; hasPassword?: boolean; sentSetupEmail?: boolean };
              if (provData.sentSetupEmail) {
                // New account: setup token was sent to the customer's email address
                setSetupEmailSent(true);
              }
            }
          } catch { /* non-fatal */ }

          sessionStorage.removeItem("onboardingCartSummary");
          setStatus("paid");

          // Only poll for project if user is already authenticated
          if (user) {
            for (let i = 0; i < 8; i++) {
              await new Promise(r => setTimeout(r, 1500));
              const projRes = await doFetch("/api/portal/dashboard");
              if (projRes.ok) {
                const dash = await projRes.json() as { projects: Array<{ id: number; title: string }> };
                if (dash.projects?.length > 0) {
                  setProjectId(dash.projects[0].id);
                  break;
                }
              }
            }
          }
        } else {
          setStatus("pending");
        }
      } catch {
        setStatus("error");
      }
    };

    check().catch(() => setStatus("error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, urlSetupToken]);

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError("");
    if (setupPassword1.length < 8) { setSetupError("Password must be at least 8 characters."); return; }
    if (setupPassword1 !== setupPassword2) { setSetupError("Passwords do not match."); return; }
    if (!setupToken) return;
    setSetupLoading(true);
    try {
      await setupPassword(setupToken, setupPassword1);
      // Auto-login — email comes from guest info or already set clientEmail
      const emailToLogin = clientEmail || (() => {
        try { return (JSON.parse(sessionStorage.getItem("onboardingGuest") ?? "{}") as { email?: string }).email ?? ""; } catch { return ""; }
      })();
      if (emailToLogin) {
        try { await login(emailToLogin, setupPassword1); } catch { /* login will redirect via auth context */ }
      }
      // Clean up guest session storage
      sessionStorage.removeItem("onboardingGuest");
      sessionStorage.removeItem("onboardingGuestToken");
      setSetupDone(true);
      // Poll for project now that we have a real session
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const projRes = await fetchWithAuth("/api/portal/dashboard");
          if (projRes.ok) {
            const dash = await projRes.json() as { projects: Array<{ id: number; title: string }> };
            if (dash.projects?.length > 0) {
              setProjectId(dash.projects[0].id);
              break;
            }
          }
        } catch { break; }
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to set password. Please try again.");
    } finally {
      setSetupLoading(false);
    }
  };

  // ── Standalone setup-link mode (arrived via emailed link) ─────────────────
  if (status === "setup_link") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
        <div className="bg-[#0A2540]">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="max-w-lg w-full">
            <div className="bg-white border border-[#0078D4]/30 rounded-2xl p-8">
              {!setupDone ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-[#0078D4]" />
                    </div>
                    <p className="text-base font-bold text-[#0A2540]">Set your portal password</p>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    Your client account is ready. Choose a password to access your project dashboard.
                  </p>
                  <form onSubmit={handleSetupPassword} className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">New password</label>
                      <div className="relative">
                        <input
                          type={showPw ? "text" : "password"}
                          required
                          value={setupPassword1}
                          onChange={e => setSetupPassword1(e.target.value)}
                          placeholder="At least 8 characters"
                          className="w-full border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw(p => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#0A2540]"
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">Confirm password</label>
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        value={setupPassword2}
                        onChange={e => setSetupPassword2(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                      />
                    </div>
                    {setupError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                        {setupError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={setupLoading}
                      className="w-full flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>
                        Activate my portal account
                        <ArrowRight className="w-4 h-4" />
                      </>}
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h2 className="text-lg font-bold text-[#0A2540] mb-2">Password set — you're in!</h2>
                  <p className="text-sm text-muted-foreground mb-6">You're now signed in to your portal.</p>
                  {projectId && (
                    <button
                      onClick={() => setLocation(`/portal/projects/${projectId}`)}
                      className="flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors text-sm w-full mb-2"
                    >
                      View your project <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setLocation("/portal")}
                    className="flex items-center justify-center gap-2 border border-border bg-white text-[#0A2540] font-semibold px-5 py-3 rounded-xl hover:bg-[#F7F9FC] transition-colors text-sm w-full"
                  >
                    Go to dashboard
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-[#0078D4] mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Confirming your payment…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="max-w-md text-center bg-white border border-border rounded-2xl p-8">
          <p className="text-lg font-bold text-[#0A2540] mb-2">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-6">
            We couldn't confirm your payment status. If you completed payment, you'll receive a confirmation email shortly.
          </p>
          <button
            onClick={() => setLocation("/portal")}
            className="bg-[#0078D4] text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
          >
            Go to portal
          </button>
        </div>
      </div>
    );
  }

  if (status === "needs_subscription") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
        <div className="bg-[#0A2540]">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="max-w-lg w-full text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">
              One-time payment confirmed!
            </h1>
            <p className="text-muted-foreground mb-6">
              Your one-time package payment is complete. You also selected a monthly retainer — please complete that checkout now to activate it.
            </p>
            <div className="bg-white border border-emerald-200 rounded-2xl p-5 mb-6 text-left">
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-[#0A2540]">Monthly subscription still pending</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Click the button below to complete your recurring subscription checkout. This takes less than a minute.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <a
                href={pendingSubUrl ?? "#"}
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold px-5 py-3 rounded-xl hover:bg-emerald-700 transition-colors text-sm"
              >
                <CreditCard className="w-4 h-4" />
                Complete subscription checkout
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                onClick={() => setLocation("/portal")}
                className="flex items-center justify-center gap-2 border border-border bg-white text-[#0A2540] font-semibold px-5 py-3 rounded-xl hover:bg-[#F7F9FC] transition-colors text-sm"
              >
                Skip for now — go to dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasRecurring = purchasedItems.some(i => i.isRecurring);

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
      <div className="bg-[#0A2540]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span>1. Choose services</span>
            <span>→</span>
            <span>2. Sign agreement</span>
            <span>→</span>
            <span className="text-white font-semibold">3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">
            {status === "paid" ? "You're all set!" : "Payment received"}
          </h1>

          <p className="text-muted-foreground mb-2">
            {status === "paid"
              ? "Your project will begin once you log in to your command center and submit your App Registration."
              : "Your project will be set up shortly and you'll receive an email with next steps."}
          </p>

          {clientEmail && (
            <p className="text-sm text-muted-foreground mb-6">
              A confirmation email has been sent to <strong>{clientEmail}</strong>.
            </p>
          )}

          {/* Purchased items summary */}
          {purchasedItems.length > 0 && (
            <div className="bg-white border border-border rounded-2xl p-4 text-left mb-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">What you purchased</p>
              <div className="space-y-2">
                {purchasedItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-[#0A2540] font-medium">{item.name}</span>
                    {item.isRecurring ? (
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5" />
                        monthly
                      </span>
                    ) : (
                      <span className="text-[10px] bg-[#0078D4]/10 text-[#0078D4] rounded-full px-2 py-0.5 font-semibold">
                        one-time
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {hasRecurring && (
                <div className="mt-3 pt-3 border-t border-border space-y-1">
                  {nextBillingDate && (
                    <p className="text-xs font-medium text-[#0A2540]">
                      Next billing date:{" "}
                      <span className="font-semibold">
                        {new Date(nextBillingDate * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                      </span>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Monthly retainers renew automatically. You can cancel from your billing settings at any time.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* What happens next */}
          <div className="bg-[#0078D4]/6 border border-[#0078D4]/20 rounded-2xl p-5 text-left mb-6">
            <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider mb-3">What happens next</p>
            <div className="space-y-2.5">
              {[
                { n: "1", text: "Check your email and click the activation link to set your password and access your command center." },
                { n: "2", text: "Log in to your client portal — your project workspace is waiting for you." },
                { n: "3", text: "Submit your App Registration so Shane's automation can securely connect to your Microsoft 365 environment." },
                { n: "4", text: "Watch as the assessment runs — your environment is scanned and scores begin populating in real time." },
                { n: "5", text: "Your deliverables appear inside your portal: findings, scores, a prioritized task board, and recommended actions." },
                { n: "6", text: "Shane schedules a hand-off call to walk you through the results and answer any questions." },
              ].map(step => (
                <div key={step.n} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#0078D4] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.n}</div>
                  <p className="text-xs text-[#0A2540] leading-relaxed">{step.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Guest account: always show email setup guidance */}
          {!user && !setupDone && (
            <div className="bg-white border border-[#0078D4]/30 rounded-2xl p-5 text-left mb-6 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Mail className="w-4 h-4 text-[#0078D4]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0A2540] mb-0.5">Check your email to activate your account</p>
                <p className="text-xs text-muted-foreground">
                  We sent a password-setup link to{clientEmail ? <> <strong>{clientEmail}</strong></> : " your email address"}. Click that link to choose your password — then sign in to access your project dashboard.
                </p>
              </div>
            </div>
          )}

          {/* Inline password setup for standalone token mode (should not appear here — handled above) */}
          {setupToken && !setupDone && !setupEmailSent && (
            <div className="bg-white border border-[#0078D4]/30 rounded-2xl p-6 text-left mb-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#0078D4]" />
                </div>
                <p className="text-sm font-bold text-[#0A2540]">Set your portal password</p>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Your client account has been created. Set a password to access your project dashboard.
              </p>
              <form onSubmit={handleSetupPassword} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">New password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      required
                      value={setupPassword1}
                      onChange={e => setSetupPassword1(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#0A2540]"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#0A2540] mb-1.5 block">Confirm password</label>
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    value={setupPassword2}
                    onChange={e => setSetupPassword2(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                  />
                </div>
                {setupError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {setupError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={setupLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>
                    Activate my portal account
                    <ArrowRight className="w-4 h-4" />
                  </>}
                </button>
              </form>
            </div>
          )}

          {setupToken && setupDone && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-left mb-6 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p className="text-sm text-emerald-800 font-medium">Password set — you're now signed in to your portal.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {projectId && (
              <button
                onClick={() => setLocation(`/portal/projects/${projectId}`)}
                className="flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
              >
                View your project
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {(user || setupDone) && (
              <button
                onClick={() => setLocation("/portal")}
                className="flex items-center justify-center gap-2 border border-border bg-white text-[#0A2540] font-semibold px-5 py-3 rounded-xl hover:bg-[#F7F9FC] transition-colors text-sm"
              >
                Go to dashboard
              </button>
            )}
            {!user && !setupDone && (
              <button
                onClick={() => setLocation("/login?from=purchase")}
                className="flex items-center justify-center gap-2 border border-border bg-white text-[#0A2540] font-semibold px-5 py-3 rounded-xl hover:bg-[#F7F9FC] transition-colors text-sm"
              >
                Sign in after setup
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
