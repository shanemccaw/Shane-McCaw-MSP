import React, { useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, ChevronDown, ShieldCheck, Zap, Activity,
  FileText, Shield, Layers, ArrowRight, Brain,
  GitMerge, Lock, Grid, Share2, Users
} from "lucide-react";

const QUIZZES = [
  {
    href: "/copilot-quiz",
    label: "Copilot Readiness",
    desc: "Assess AI adoption posture & governance gaps",
    icon: Brain,
    color: "violet",
  },
  {
    href: "/m365-health-quiz",
    label: "M365 Health Check",
    desc: "Score tenant configuration vs. baseline standards",
    icon: Activity,
    color: "blue",
  },
  {
    href: "/security-quiz",
    label: "Security Posture",
    desc: "Surface exposure risks, guest access & OAuth vulns",
    icon: Lock,
    color: "red",
  },
  {
    href: "/governance-quiz",
    label: "Governance Baseline",
    desc: "Evaluate DLP, retention, labeling & policy compliance",
    icon: Shield,
    color: "emerald",
  },
  {
    href: "/migration-quiz",
    label: "Migration Readiness",
    desc: "Diagnose Exchange, SharePoint or GWS migration risk",
    icon: GitMerge,
    color: "amber",
  },
  {
    href: "/power-platform-quiz",
    label: "Power Platform Risk",
    desc: "Identify ungoverned flows, connectors & maker sprawl",
    icon: Zap,
    color: "yellow",
  },
  {
    href: "/sharepoint-quiz",
    label: "SharePoint Architecture",
    desc: "Review site sprawl, permissions & IA health",
    icon: Share2,
    color: "teal",
  },
  {
    href: "/teams-quiz",
    label: "Teams Governance",
    desc: "Audit teams sprawl, guest access & lifecycle policies",
    icon: Users,
    color: "indigo",
  },
];

type IconColors = { bg: string; border: string; text: string; hover: string };
const colorMap: Record<string, IconColors> = {
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", hover: "group-hover:text-violet-400" },
  blue:   { bg: "bg-blue-500/10",   border: "border-blue-500/20",   text: "text-blue-400",   hover: "group-hover:text-blue-400" },
  red:    { bg: "bg-red-500/10",    border: "border-red-500/20",    text: "text-red-400",    hover: "group-hover:text-red-400" },
  emerald:{ bg: "bg-emerald-500/10",border: "border-emerald-500/20",text: "text-emerald-400",hover: "group-hover:text-emerald-400" },
  amber:  { bg: "bg-amber-500/10",  border: "border-amber-500/20",  text: "text-amber-400",  hover: "group-hover:text-amber-400" },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-400", hover: "group-hover:text-yellow-400" },
  teal:   { bg: "bg-teal-500/10",   border: "border-teal-500/20",   text: "text-teal-400",   hover: "group-hover:text-teal-400" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/20", text: "text-indigo-400", hover: "group-hover:text-indigo-400" },
};

type DropdownName = "assessments" | "services" | "quizzes" | null;

export function Header() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<DropdownName>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const openMenu = (name: DropdownName) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpenDropdown(name);
  };

  const closeMenu = () => {
    timeoutRef.current = setTimeout(() => setOpenDropdown(null), 150);
  };

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  const isActive = (prefix: string) =>
    location === prefix || location.startsWith(prefix + "/") || location.startsWith(prefix + "?");

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg text-white tracking-tight leading-none group-hover:text-blue-400 transition-colors">
                Shane McCaw
              </span>
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                M365 Governance SaaS
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              Home
            </Link>

            {/* Assessments Dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("assessments")} onMouseLeave={closeMenu}>
              <Link
                href="/assessments"
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive("/assessments") ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>Assessments</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === "assessments" ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
              </Link>
              {openDropdown === "assessments" && (
                <div className="absolute top-full left-0 w-80 mt-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                  <Link href="/assessments/premium" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0"><Zap className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">Paid M365 Assessments</div>
                      <p className="text-xs text-slate-400 mt-0.5">Fixed-price diagnostic deliverables & expert analysis.</p>
                    </div>
                  </Link>
                  <Link href="/assessments/start" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0"><Activity className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">Free Telemetry Snapshots</div>
                      <p className="text-xs text-slate-400 mt-0.5">Instant tenant risk scoring — no commitment required.</p>
                    </div>
                  </Link>
                  <div className="border-t border-slate-800/80 my-1 pt-1">
                    <Link href="/assessments/all" onClick={() => setOpenDropdown(null)} className="flex items-center justify-between p-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors">
                      <span>View Full Catalog</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Free Diagnostics / Quizzes Dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("quizzes")} onMouseLeave={closeMenu}>
              <button
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  QUIZZES.some(q => location === q.href) ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>Free Diagnostics</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === "quizzes" ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
              </button>
              {openDropdown === "quizzes" && (
                <div className="absolute top-full left-0 w-[420px] mt-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest px-2.5 pt-1 pb-2">
                    Signal Intelligence Diagnostics — Free
                  </p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {QUIZZES.map((quiz) => {
                      const Icon = quiz.icon;
                      const c = colorMap[quiz.color];
                      return (
                        <Link key={quiz.href} href={quiz.href} onClick={() => setOpenDropdown(null)} className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                          <div className={`p-1.5 rounded-lg border shrink-0 mt-0.5 ${c.bg} ${c.border} ${c.text}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className={`text-xs font-semibold text-white transition-colors ${c.hover}`}>{quiz.label}</div>
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{quiz.desc}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Services Dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("services")} onMouseLeave={closeMenu}>
              <button
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive("/services") || location === "/monitoring" || location === "/projects" || isActive("/resources")
                    ? "text-blue-400 bg-blue-500/10"
                    : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>Services & Platform</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === "services" ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
              </button>
              {openDropdown === "services" && (
                <div className="absolute top-full left-0 w-80 mt-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                  <Link href="/monitoring" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0"><Shield className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">Tenant Monitoring Engine</div>
                      <p className="text-xs text-slate-400 mt-0.5">24/7 automated drift, SLA & security tracking.</p>
                    </div>
                  </Link>
                  <Link href="/projects" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0"><Layers className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">Fixed-Price Projects</div>
                      <p className="text-xs text-slate-400 mt-0.5">Structured migrations, Copilot rollouts & hardening.</p>
                    </div>
                  </Link>
                  <Link href="/services" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0"><FileText className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-amber-400 transition-colors">Architect Retainers</div>
                      <p className="text-xs text-slate-400 mt-0.5">Dedicated M365 governance advisory & support.</p>
                    </div>
                  </Link>
                  <Link href="/resources" onClick={() => setOpenDropdown(null)} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group">
                    <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 shrink-0"><Grid className="w-5 h-5" /></div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-teal-400 transition-colors">Resources & Articles</div>
                      <p className="text-xs text-slate-400 mt-0.5">M365 governance playbooks, guides & field notes.</p>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/msp"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/msp" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              MSP Resellers
            </Link>

            <Link
              href="/about"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/about" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              About Shane
            </Link>
          </nav>

          {/* Right CTAs */}
          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/assessments/start"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            >
              Free Diagnostic
            </Link>
            <Link
              href="/assessments"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
            >
              <span>M365 Catalog</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Mobile Toggle */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950 border-b border-slate-800 px-4 pt-2 pb-6 space-y-1 max-h-[80vh] overflow-y-auto">
          <Link href="/" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">Home</Link>

          <div className="pt-2">
            <p className="px-3 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-widest">Assessments</p>
            <Link href="/assessments/premium" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-blue-400 hover:bg-slate-900">Paid M365 Assessments</Link>
            <Link href="/assessments/start" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-emerald-400 hover:bg-slate-900">Free Telemetry Snapshots</Link>
          </div>

          <div className="pt-2">
            <p className="px-3 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-widest">Free Diagnostics</p>
            {QUIZZES.map(q => (
              <Link key={q.href} href={q.href} onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-900">
                {q.label} Quiz
              </Link>
            ))}
          </div>

          <div className="pt-2">
            <p className="px-3 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-widest">Services & Platform</p>
            <Link href="/monitoring" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">Tenant Monitoring Engine</Link>
            <Link href="/projects" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">Fixed-Price Projects</Link>
            <Link href="/services" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">Architect Retainers</Link>
            <Link href="/resources" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">Resources & Articles</Link>
          </div>

          <Link href="/msp" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">MSP Resellers</Link>
          <Link href="/about" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-slate-900">About Shane</Link>

          <div className="pt-4 flex flex-col gap-2">
            <Link href="/assessments/start" onClick={closeMobileMenu} className="w-full text-center py-3 px-4 rounded-xl text-sm font-semibold bg-slate-800 text-slate-200 border border-slate-700 block">Run Free Diagnostic</Link>
            <Link href="/assessments" onClick={closeMobileMenu} className="w-full text-center py-3 px-4 rounded-xl text-sm font-semibold bg-blue-600 text-white block">Explore M365 Catalog</Link>
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
