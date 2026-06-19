import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  BarChart2, Kanban, FileText, FileDown,
  CheckCircle2, CreditCard, MessageSquare, Loader2,
} from "lucide-react";

const FEATURES = [
  {
    icon: <BarChart2 className="w-4 h-4" />,
    label: "Project progress & workflow tracking",
    desc: "Real-time status on every active engagement.",
  },
  {
    icon: <Kanban className="w-4 h-4" />,
    label: "Kanban board for tasks",
    desc: "See what's in progress, what's next, and what's done.",
  },
  {
    icon: <FileText className="w-4 h-4" />,
    label: "Weekly & monthly reports",
    desc: "Structured updates delivered to your portal automatically.",
  },
  {
    icon: <FileDown className="w-4 h-4" />,
    label: "Secure document downloads",
    desc: "Assessments, deliverables, and SOWs — always available.",
  },
  {
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: "Service & micro-offer status",
    desc: "Track every package from purchase to delivery.",
  },
  {
    icon: <CreditCard className="w-4 h-4" />,
    label: "Invoice history & payments",
    desc: "View past invoices and pay online in seconds.",
  },
  {
    icon: <MessageSquare className="w-4 h-4" />,
    label: "Direct communication with your consultant",
    desc: "Structured messaging tied directly to your projects.",
  },
];

function DashboardMockup() {
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0d2e4e] shadow-2xl text-[10px] select-none">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0A2540] border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4]" />
          <span className="text-white/60 font-medium tracking-wide text-[8px] uppercase">Command Center</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-[#0078D4]/40 border border-[#0078D4]/60 flex items-center justify-center">
            <span className="text-white text-[6px] font-bold">S</span>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "M365 Migration", pct: 68, color: "#0078D4" },
            { label: "Governance Audit", pct: 40, color: "#00B4D8" },
          ].map(({ label, pct, color }) => (
            <div key={label} className="bg-[#0A2540] rounded-lg px-2.5 py-2 border border-white/10">
              <p className="text-white/50 mb-1 text-[8px]">{label}</p>
              <p className="text-white font-bold text-sm">{pct}%</p>
              <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Kanban */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { col: "In Progress", items: ["Tenant config", "IAM review", "User pilot"], color: "#0078D4" },
            { col: "Done", items: ["Requirements", "Discovery", "Scoping"], color: "#00B4D8" },
          ].map(({ col, items, color }) => (
            <div key={col}>
              <div className="flex items-center gap-1 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-white/40 text-[8px] font-semibold uppercase tracking-wide">{col}</span>
              </div>
              <div className="space-y-1">
                {items.map(item => (
                  <div key={item} className="bg-[#0A2540] border border-white/10 rounded px-2 py-1">
                    <span className="text-white/70">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Doc list */}
        <div className="bg-[#0A2540] rounded-lg border border-white/10 divide-y divide-white/5">
          {["M365 Assessment.pdf", "SOW-2024-001.pdf", "Governance Report.docx"].map(name => (
            <div key={name} className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-[#0078D4]/30 flex-shrink-0" />
              <span className="text-white/60 truncate">{name}</span>
              <div className="ml-auto w-2.5 h-2.5 rounded text-white/20">↓</div>
            </div>
          ))}
        </div>

        {/* Bar chart stub */}
        <div className="bg-[#0A2540] rounded-lg border border-white/10 px-2.5 py-2">
          <p className="text-white/40 text-[8px] mb-2 uppercase tracking-wide font-semibold">Monthly Reports</p>
          <div className="flex items-end gap-1 h-8">
            {[30, 55, 40, 70, 50, 85, 60].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  backgroundColor: i === 5 ? "#0078D4" : "#0078D4" + "40",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"].map(m => (
              <span key={m} className="text-white/20 text-[6px]">{m}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 21 21" className="w-4 h-4 flex-shrink-0" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function redirectAfterAuth(role: string, setLocation: (path: string) => void) {
  if (role === "client") {
    const returnTo = sessionStorage.getItem("onboardingReturnTo");
    if (returnTo) {
      sessionStorage.removeItem("onboardingReturnTo");
      setLocation(returnTo);
    } else {
      setLocation("/portal");
    }
  } else {
    setLocation("/dashboard");
  }
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const user = await login(email, password);
        redirectAfterAuth(user.role, setLocation);
      } else {
        const user = await register(email, password, name.trim() || undefined);
        redirectAfterAuth(user.role, setLocation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "login" ? "Login failed" : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* ── Left hero panel ──────────────────────────────────────── */}
      <div className="md:w-[55%] bg-[#0A2540] flex flex-col px-8 py-10 md:px-12 md:py-14">
        {/* Logo — links back to main site */}
        <a href="/" className="flex items-center gap-2.5 mb-10 group w-fit">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <span className="text-white font-bold text-base group-hover:text-white/80 transition-colors">Shane McCaw Consulting</span>
        </a>

        {/* Headline */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-3">
            Welcome to Your<br />
            <span className="text-[#0078D4]">Customer Command Center</span>
          </h1>
          <p className="text-white/60 text-sm leading-relaxed max-w-md">
            A 360° view of your projects, services, documents, reports, and billing — all in one secure place.
          </p>
        </div>

        {/* Feature list */}
        <ul className="space-y-3 mb-10">
          {FEATURES.map(({ icon, label, desc }) => (
            <li key={label} className="flex items-start gap-3">
              <div className="mt-0.5 w-6 h-6 rounded-md bg-[#0078D4]/20 border border-[#0078D4]/30 flex items-center justify-center flex-shrink-0 text-[#00B4D8]">
                {icon}
              </div>
              <div>
                <span className="text-white text-sm font-semibold">{label}</span>
                <span className="text-white/40 text-xs ml-1.5">{desc}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Dashboard mockup */}
        <div className="mt-auto">
          <DashboardMockup />
        </div>
      </div>

      {/* ── Right login/register panel ────────────────────────────── */}
      <div className="md:w-[45%] bg-[#F7F9FC] flex flex-col items-center justify-center px-6 py-12 md:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-extrabold text-[#0A2540] mb-1">
              {isLogin ? "Sign in to your portal" : "Create your account"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isLogin
                ? "Enter your credentials below to continue."
                : "Set up your client portal in seconds."}
            </p>
          </div>

          {/* OAuth placeholder buttons */}
          <div className="space-y-2.5 mb-6">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2.5 border border-border bg-white rounded-lg py-2.5 text-sm font-semibold text-[#0A2540] hover:bg-[#F7F9FC] transition-colors shadow-sm"
            >
              <MicrosoftIcon />
              {isLogin ? "Sign in" : "Sign up"} with Microsoft
            </button>
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2.5 border border-border bg-white rounded-lg py-2.5 text-sm font-semibold text-[#0A2540] hover:bg-[#F7F9FC] transition-colors shadow-sm"
            >
              <GoogleIcon />
              {isLogin ? "Sign in" : "Sign up"} with Google
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#F7F9FC] px-3 text-muted-foreground">
                {isLogin ? "or sign in with email" : "or sign up with email"}
              </span>
            </div>
          </div>

          {/* Email / Password form */}
          <div className="bg-white border border-border rounded-2xl shadow-sm p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">
                    Full Name <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith"
                    autoComplete="name"
                    className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                    data-testid="input-name"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                  data-testid="input-email"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-[#0A2540]">Password</label>
                  {isLogin && (
                    <a href="#" className="text-xs text-[#0078D4] hover:underline font-medium">Forgot password?</a>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                  data-testid="input-password"
                />
                {!isLogin && (
                  <p className="text-xs text-muted-foreground mt-1">Minimum 8 characters</p>
                )}
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                    data-testid="input-confirm-password"
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm" data-testid="login-error">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-3 text-sm hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                data-testid="button-login"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isLogin ? "Signing in…" : "Creating account…"}
                  </>
                ) : (
                  isLogin ? "Sign In to Your Portal" : "Create Account"
                )}
              </button>
            </form>
          </div>

          {/* Mode toggle */}
          <p className="text-center text-sm text-muted-foreground mt-5">
            {isLogin ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-[#0078D4] hover:underline font-semibold"
                  data-testid="link-create-account"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-[#0078D4] hover:underline font-semibold"
                  data-testid="link-sign-in"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {/* Trust bar */}
          <div className="mt-4 bg-white border border-border rounded-xl px-4 py-3 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#0078D4]" />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-[#0A2540]">Shane McCaw Consulting</span> — Microsoft 365 Architect with 30 years of experience helping organizations modernize, secure, and optimize their Microsoft ecosystem.
            </p>
          </div>

          {/* Support footer */}
          <p className="text-center text-xs text-muted-foreground mt-5">
            Need help accessing your account?{" "}
            <a href="mailto:support@shanemccaw.com" className="text-[#0078D4] hover:underline font-medium">
              Contact support@shanemccaw.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
