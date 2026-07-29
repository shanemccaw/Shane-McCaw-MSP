import { useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, ChevronDown, ArrowRight, ShieldCheck,
  Brain, Lock, Shield, Share2, Zap, Users, GitMerge, Activity, Bot,
  Compass, LogIn, Info, MessageCircle, GraduationCap, Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatCTA } from "./ChatCTA";

// Service verticals — restored + built in the v1.1 base rebuild. Each is a static marketing
// page for its domain; the topic-matched Projects index (/projects/*) is folded in below the
// grid as a secondary link rather than a separate top-level nav item (nav spec locks the 5
// top-level categories — Assessments | Services | Retainers | Resources | Company — but leaves
// dropdown contents/ordering open for a follow-up pass).
const SERVICES = [
  { href: "/services/microsoft-365", label: "Microsoft 365 Architecture", icon: Shield },
  { href: "/services/copilot-ai", label: "Copilot & AI", icon: Bot },
  { href: "/services/security-hardening", label: "Security Hardening", icon: Lock },
  { href: "/services/governance", label: "Governance & Compliance", icon: ShieldCheck },
  { href: "/services/sharepoint", label: "SharePoint", icon: Share2 },
  { href: "/services/power-platform", label: "Power Platform", icon: Zap },
  { href: "/services/cloud-migration", label: "Cloud Migration", icon: Server },
  { href: "/services/m365-training", label: "Training & Enablement", icon: GraduationCap },
];

const RETAINER_LINKS = [
  { href: "/platform/retainer", label: "Compare Retainer Tiers", desc: "Ongoing architect-level retainer support, month to month.", icon: Compass },
  { href: "/retainers/architect-essentials", label: "Architect Essentials", desc: "10 hours/month of senior M365 access.", icon: GitMerge },
  { href: "/retainers/architect-growth", label: "Architect Growth", desc: "25 hours/month with priority response.", icon: Activity },
  { href: "/retainers/architect-enterprise", label: "Architect Enterprise", desc: "Dedicated ongoing architecture partnership.", icon: Users },
];

type DropdownName = "services" | "retainers" | "company" | null;

export function Header() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<DropdownName>(null);
  const [openDropdown, setOpenDropdown] = useState<DropdownName>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = (name: DropdownName) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpenDropdown(name);
  };
  const closeMenu = () => {
    timeoutRef.current = setTimeout(() => setOpenDropdown(null), 150);
  };
  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileSection(null);
  }, []);

  const isActive = (prefix: string) =>
    location === prefix || location.startsWith(prefix + "/");

  // De-emphasized on the Assessments listing page (not the per-assessment detail
  // pages) so "Book a Call" doesn't read as a top-level equal alternative to the
  // self-serve assessment/wizard flow there.
  const isAssessmentsPage = ["/assessment", "/assessments", "/assessments/all", "/assessments/start", "/assessments/premium"].includes(
    location,
  );

  const navLinkClass = (active: boolean) =>
    cn(
      "px-3.5 py-2 rounded-lg text-sm font-medium transition-colors",
      active ? "text-accent-blue bg-white/[0.06]" : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]",
    );

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-charcoal-0/85 backdrop-blur-xl border-b border-white/[0.08]"
      data-track="nav"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group" data-track="nav">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <span className="font-display font-bold text-base text-text-primary tracking-tight leading-none">
              Shane McCaw
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            <Link href="/assessment" className={navLinkClass(isActive("/assessment"))} data-track="nav">
              Assessments
            </Link>

            {/* Services dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("services")} onMouseLeave={closeMenu}>
              <button
                className={cn(navLinkClass(isActive("/services") || SERVICES.some((s) => isActive(s.href))), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "services"}
              >
                <span>Services</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "services" && "rotate-180")} />
              </button>
              {openDropdown === "services" && (
                <div className="absolute top-full left-0 w-[420px] mt-1 menu-panel rounded-2xl p-2 z-50">
                  <div className="grid grid-cols-2 gap-0.5">
                    {SERVICES.map((s) => {
                      const Icon = s.icon;
                      return (
                        <Link
                          key={s.href}
                          href={s.href}
                          onClick={() => setOpenDropdown(null)}
                          className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.06] transition-colors group"
                          data-track="nav"
                        >
                          <div className="p-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue shrink-0">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs font-medium text-text-primary group-hover:text-accent-blue transition-colors">
                            {s.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  <div className="border-t border-white/[0.06] mt-1 pt-1">
                    <Link
                      href="/services"
                      onClick={() => setOpenDropdown(null)}
                      className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-white/[0.06] transition-colors text-xs font-medium text-accent-blue"
                      data-track="nav"
                    >
                      <span>Browse all services</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href="/projects"
                      onClick={() => setOpenDropdown(null)}
                      className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-white/[0.06] transition-colors text-xs font-medium text-text-secondary hover:text-text-primary"
                      data-track="nav"
                    >
                      <span>Browse projects by topic</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Retainers dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("retainers")} onMouseLeave={closeMenu}>
              <button
                className={cn(navLinkClass(RETAINER_LINKS.some((p) => isActive(p.href))), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "retainers"}
              >
                <span>Retainers</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "retainers" && "rotate-180")} />
              </button>
              {openDropdown === "retainers" && (
                <div className="absolute top-full left-0 w-80 mt-1 menu-panel rounded-2xl p-2 z-50">
                  {RETAINER_LINKS.map((p) => {
                    const Icon = p.icon;
                    return (
                      <Link
                        key={p.href}
                        href={p.href}
                        onClick={() => setOpenDropdown(null)}
                        className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] transition-colors group"
                        data-track="nav"
                      >
                        <div className="p-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-text-primary group-hover:text-accent-blue transition-colors">{p.label}</div>
                          <p className="text-xs text-text-secondary mt-0.5">{p.desc}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <Link href="/resources" className={navLinkClass(isActive("/resources"))} data-track="nav">
              Resources
            </Link>

            {/* Company dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("company")} onMouseLeave={closeMenu}>
              <button
                className={cn(navLinkClass(isActive("/about") || isActive("/trust-security") || isActive("/contact")), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "company"}
              >
                <span>Company</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "company" && "rotate-180")} />
              </button>
              {openDropdown === "company" && (
                <div className="absolute top-full right-0 w-52 mt-1 menu-panel rounded-2xl p-2 z-50">
                  <Link href="/about" onClick={() => setOpenDropdown(null)} className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.06] transition-colors group" data-track="nav">
                    <div className="p-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue shrink-0">
                      <Info className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">About</span>
                  </Link>
                  <Link href="/trust-security" onClick={() => setOpenDropdown(null)} className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.06] transition-colors group" data-track="nav">
                    <div className="p-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue shrink-0">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">Trust &amp; Security</span>
                  </Link>
                  <Link href="/contact" onClick={() => setOpenDropdown(null)} className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.06] transition-colors group" data-track="nav">
                    <div className="p-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue shrink-0">
                      <MessageCircle className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">Contact</span>
                  </Link>
                </div>
              )}
            </div>
          </nav>

          {/* Right actions */}
          <div className="hidden lg:flex items-center gap-2">
            <a
              href="/portal/login"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
              data-track="nav"
            >
              <LogIn className="w-4 h-4" />
              <span>Client Login</span>
            </a>
            {isAssessmentsPage ? (
              <ChatCTA
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                data-track="cta"
              >
                <span>Or ask a question</span>
                <ArrowRight className="w-3 h-3" />
              </ChatCTA>
            ) : (
              <Link
                href="/assessment"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
              >
                <span>Start Assessment</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          <div className="flex lg:hidden items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-charcoal-0 border-b border-white/[0.08] px-4 pt-2 pb-6 space-y-1 max-h-[80vh] overflow-y-auto">
          <Link href="/assessment" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Assessments</Link>

          <button
            onClick={() => setMobileSection(mobileSection === "services" ? null : "services")}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase font-bold text-text-secondary tracking-widest"
          >
            <span>Services</span>
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", mobileSection === "services" && "rotate-180")} />
          </button>
          {mobileSection === "services" && (
            <>
              {SERVICES.map((s) => (
                <Link key={s.href} href={s.href} onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/[0.06]" data-track="nav">
                  {s.label}
                </Link>
              ))}
              <Link href="/services" onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-accent-blue hover:bg-white/[0.06]" data-track="nav">
                Browse all services
              </Link>
              <Link href="/projects" onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/[0.06]" data-track="nav">
                Browse projects by topic
              </Link>
            </>
          )}

          <button
            onClick={() => setMobileSection(mobileSection === "retainers" ? null : "retainers")}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase font-bold text-text-secondary tracking-widest"
          >
            <span>Retainers</span>
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", mobileSection === "retainers" && "rotate-180")} />
          </button>
          {mobileSection === "retainers" && RETAINER_LINKS.map((p) => (
            <Link key={p.href} href={p.href} onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/[0.06]" data-track="nav">
              {p.label}
            </Link>
          ))}

          <Link href="/resources" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Resources</Link>
          <Link href="/about" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">About</Link>
          <Link href="/trust-security" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Trust &amp; Security</Link>
          <Link href="/contact" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Contact</Link>
          <a href="/portal/login" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Client Login</a>

          <div className="pt-4">
            {isAssessmentsPage ? (
              <ChatCTA
                onClick={closeMobileMenu}
                className="w-full text-center py-2 px-4 text-xs font-medium text-text-secondary block"
                data-track="cta"
              >
                Or ask a question
              </ChatCTA>
            ) : (
              <Link
                href="/assessment"
                onClick={closeMobileMenu}
                className="w-full text-center py-3 px-4 rounded-xl text-sm font-semibold text-white block"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
              >
                Start Assessment
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
