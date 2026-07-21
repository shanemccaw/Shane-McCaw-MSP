import { useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, ChevronDown, ArrowRight, ShieldCheck,
  Brain, Lock, Shield, Share2, Zap, Users, GitMerge, Activity,
  Package, Compass, LogIn,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Solutions / Topic pages — mirrors the 8 existing quiz categories (website-rebuild-reference-v2.md §5).
// Each is the personalization surface for its domain; generic domain marketing for a cold visitor.
const SOLUTIONS = [
  { href: "/solutions/copilot", label: "Copilot & AI", icon: Brain },
  { href: "/solutions/security-compliance", label: "Security & Compliance", icon: Lock },
  { href: "/solutions/governance", label: "Governance", icon: Shield },
  { href: "/solutions/sharepoint", label: "SharePoint", icon: Share2 },
  { href: "/solutions/power-platform", label: "Power Platform", icon: Zap },
  { href: "/solutions/teams", label: "Teams", icon: Users },
  { href: "/solutions/migration", label: "Migration", icon: GitMerge },
  { href: "/solutions/m365-health", label: "M365 Health", icon: Activity },
];

const PLATFORM_LINKS = [
  { href: "/products", label: "Quick-Start Packs", desc: "Fixed-price tenant configuration packs.", icon: Package },
  { href: "/retainer", label: "Fractional Consulting", desc: "Ongoing architect-level retainer support.", icon: Compass },
  { href: "/msp", label: "MSP / Partners", desc: "Partner onboarding, white-glove or self-serve.", icon: Users },
  { href: "/trust-security", label: "Trust & Security", desc: "Tenant isolation, audit trail, exception tracking.", icon: ShieldCheck },
];

type DropdownName = "solutions" | "platform" | "company" | null;

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
              Assessment
            </Link>

            {/* Solutions dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("solutions")} onMouseLeave={closeMenu}>
              <button
                className={cn(navLinkClass(SOLUTIONS.some((s) => isActive(s.href))), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "solutions"}
              >
                <span>Solutions</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "solutions" && "rotate-180")} />
              </button>
              {openDropdown === "solutions" && (
                <div className="absolute top-full left-0 w-[420px] mt-1 menu-panel rounded-2xl p-2 z-50">
                  <div className="grid grid-cols-2 gap-0.5">
                    {SOLUTIONS.map((s) => {
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
                </div>
              )}
            </div>

            <Link href="/monitoring" className={navLinkClass(isActive("/monitoring"))} data-track="nav">
              Monitoring
            </Link>

            {/* Platform dropdown */}
            <div className="relative" onMouseEnter={() => openMenu("platform")} onMouseLeave={closeMenu}>
              <button
                className={cn(navLinkClass(PLATFORM_LINKS.some((p) => isActive(p.href))), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "platform"}
              >
                <span>Platform</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "platform" && "rotate-180")} />
              </button>
              {openDropdown === "platform" && (
                <div className="absolute top-full left-0 w-80 mt-1 menu-panel rounded-2xl p-2 z-50">
                  {PLATFORM_LINKS.map((p) => {
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
                className={cn(navLinkClass(isActive("/about") || isActive("/contact")), "flex items-center gap-1.5")}
                aria-expanded={openDropdown === "company"}
              >
                <span>Company</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", openDropdown === "company" && "rotate-180")} />
              </button>
              {openDropdown === "company" && (
                <div className="absolute top-full right-0 w-52 mt-1 menu-panel rounded-2xl p-2 z-50">
                  <Link href="/about" onClick={() => setOpenDropdown(null)} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.06]" data-track="nav">About</Link>
                  <Link href="/contact" onClick={() => setOpenDropdown(null)} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.06]" data-track="nav">Contact</Link>
                </div>
              )}
            </div>
          </nav>

          {/* Right actions */}
          <div className="hidden lg:flex items-center gap-2">
            <Link
              href="/login"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
              data-track="nav"
            >
              <LogIn className="w-4 h-4" />
              <span>Client Login</span>
            </Link>
            {isAssessmentsPage ? (
              <Link
                href="/book"
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                data-track="cta"
              >
                <span>Or book a call</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <Link
                href="/book"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
              >
                <span>Book a Call</span>
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
          <Link href="/assessment" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Assessment</Link>
          <Link href="/monitoring" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Monitoring</Link>

          <button
            onClick={() => setMobileSection(mobileSection === "solutions" ? null : "solutions")}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase font-bold text-text-secondary tracking-widest"
          >
            <span>Solutions</span>
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", mobileSection === "solutions" && "rotate-180")} />
          </button>
          {mobileSection === "solutions" && SOLUTIONS.map((s) => (
            <Link key={s.href} href={s.href} onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/[0.06]" data-track="nav">
              {s.label}
            </Link>
          ))}

          <button
            onClick={() => setMobileSection(mobileSection === "platform" ? null : "platform")}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase font-bold text-text-secondary tracking-widest"
          >
            <span>Platform</span>
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", mobileSection === "platform" && "rotate-180")} />
          </button>
          {mobileSection === "platform" && PLATFORM_LINKS.map((p) => (
            <Link key={p.href} href={p.href} onClick={closeMobileMenu} className="block px-6 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/[0.06]" data-track="nav">
              {p.label}
            </Link>
          ))}

          <Link href="/resources" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Resources</Link>
          <Link href="/about" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">About</Link>
          <Link href="/contact" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Contact</Link>
          <Link href="/login" onClick={closeMobileMenu} className="block px-3 py-2 rounded-lg text-sm font-medium text-text-primary hover:bg-white/[0.06]" data-track="nav">Client Login</Link>

          <div className="pt-4">
            {isAssessmentsPage ? (
              <Link
                href="/book"
                onClick={closeMobileMenu}
                className="w-full text-center py-2 px-4 text-xs font-medium text-text-secondary block"
                data-track="cta"
              >
                Or book a call
              </Link>
            ) : (
              <Link
                href="/book"
                onClick={closeMobileMenu}
                className="w-full text-center py-3 px-4 rounded-xl text-sm font-semibold text-white block"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
              >
                Book a Call
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
