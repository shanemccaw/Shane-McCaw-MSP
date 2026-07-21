import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowRight, ArrowLeft, Loader2, ShieldCheck, LogIn } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

interface GateResult {
  action: "proceed" | "redirect";
  portalUrl?: string;
  mspName?: string;
}

/**
 * Login — handoff to Portal (website-rebuild-reference-v2.md §5). This is a multi-tenant
 * platform: each MSP-hosted customer's real login lives on that MSP's own portal domain, not
 * a single shared /login form here. Reuses the same real, already-verified email → portal-URL
 * lookup the checkout gate uses (POST /api/public/checkout/gate — see CheckoutGate.tsx) rather
 * than building a second, parallel mechanism.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<GateResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setChecking(true);
    try {
      const res = await fetch("/api/public/checkout/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(err.error ?? "Something went wrong. Please try again.");
        return;
      }
      const data = (await res.json()) as GateResult;
      // Only the redirect state carries a usable portal URL; treat anything else
      // (redirect with an empty/missing portalUrl, or an unexpected shape) as
      // "proceed" so the user always gets feedback. Without this, an empty
      // portalUrl set `result` — hiding the form — while matching none of the
      // render branches, leaving a blank, feedback-less screen on submit.
      if (data.action === "redirect" && data.portalUrl) {
        setResult(data);
      } else {
        setResult({ action: "proceed" });
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Layout>
      <SEOMeta
        title="Client Login | Shane McCaw Consulting"
        description="Sign in to your Shane McCaw Consulting client portal."
      />

      <section className="pt-40 pb-24 px-6">
        <div className="max-w-md mx-auto">
          <GlassPanel className="p-8 sm:p-10">
            <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-6">
              <LogIn className="w-5 h-5" />
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary mb-2">
              <GradientText>Client Login</GradientText>
            </h1>

            {!result && (
              <>
                <p className="text-text-secondary text-sm leading-relaxed mb-6">
                  Enter your email and we'll take you to your portal.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="sr-only">
                      Work email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@yourcompany.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.12] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60 transition-colors"
                    />
                  </div>
                  {errorMsg && <p className="text-sm text-accent-violet">{errorMsg}</p>}
                  <button
                    type="submit"
                    disabled={checking}
                    className="w-full px-5 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                    data-track="cta"
                  >
                    {checking ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Checking…
                      </>
                    ) : (
                      <>
                        Continue <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}

            {result?.action === "redirect" && result.portalUrl && (
              <div className="text-center space-y-4">
                <ShieldCheck className="mx-auto w-10 h-10 text-accent-blue" />
                <p className="text-text-secondary text-sm leading-relaxed">
                  Your account is managed by <strong className="text-text-primary">{result.mspName ?? "your provider"}</strong>.
                  Sign in on their portal to continue.
                </p>
                <a
                  href={result.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                  data-track="cta"
                >
                  Go to my portal <ArrowRight className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setResult(null)}
                  className="text-xs text-text-secondary hover:text-text-primary underline"
                >
                  Use a different email
                </button>
              </div>
            )}

            {result?.action === "proceed" && (
              <div className="text-center space-y-4">
                <p className="text-text-secondary text-sm leading-relaxed">
                  We couldn't find an active portal account for that email. If you're a direct
                  client, use the link from your original welcome email — or start an assessment
                  to create a new account.
                </p>
                <Link
                  href="/assessment"
                  className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                  data-track="cta"
                >
                  Start an Assessment <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => setResult(null)}
                  className="text-xs text-text-secondary hover:text-text-primary underline"
                >
                  Use a different email
                </button>
              </div>
            )}

            <div className="pt-6 mt-6 border-t border-white/[0.08] text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back home
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
