import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Rocket, ChevronDown } from "lucide-react";
import { CTAButton } from "./CTAButton";
import { cn } from "@/lib/utils";

const SERVICES_ITEMS = [
  { label: "All Services",      href: "/services" },
  { label: "Microsoft 365",     href: "/services/microsoft-365" },
  { label: "M365 Training",     href: "/services/m365-training" },
  { label: "Copilot & AI",      href: "/services/copilot-ai" },
  { label: "SharePoint",        href: "/services/sharepoint" },
  { label: "Power Platform",    href: "/services/power-platform" },
  { label: "Governance",        href: "/services/governance" },
  { label: "Cloud Migration",   href: "/services/cloud-migration" },
  { label: "Micro-Offers",      href: "/micro-offers" },
];

const RETAINER_ITEMS = [
  { label: "All Retainer Plans",   href: "/retainers" },
  { label: "Architect Essentials", href: "/retainers/architect-essentials" },
  { label: "Architect Growth",     href: "/retainers/architect-growth" },
  { label: "Architect Enterprise", href: "/retainers/architect-enterprise" },
];

const QUIZ_ITEMS = [
  { label: "Copilot AI Quiz",          href: "/copilot-quiz" },
  { label: "M365 Health Check",        href: "/m365-health-quiz" },
  { label: "SharePoint Readiness",     href: "/sharepoint-readiness-quiz" },
  { label: "Power Platform Readiness", href: "/power-platform-quiz" },
  { label: "Security & Compliance",    href: "/security-compliance-quiz" },
  { label: "Teams Maturity",           href: "/teams-maturity-quiz" },
  { label: "Migration Readiness",      href: "/migration-readiness-quiz" },
  { label: "Governance Maturity",      href: "/governance-maturity-quiz" },
];

const NAV_LINKS = [
  { label: "About",     href: "/about" },
  { label: "Pricing",   href: "/pricing" },
  { label: "Resources", href: "/resources" },
  { label: "Contact",   href: "/contact" },
];

export function Header() {
  const [location] = useLocation();
  const isHome = location === "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [retainersOpen, setRetainersOpen] = useState(false);
  const [quizzesOpen, setQuizzesOpen] = useState(false);
  const servicesRef = useRef<HTMLLIElement>(null);
  const retainersRef = useRef<HTMLLIElement>(null);
  const quizzesRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (servicesRef.current && !servicesRef.current.contains(e.target as Node)) {
        setServicesOpen(false);
      }
      if (retainersRef.current && !retainersRef.current.contains(e.target as Node)) {
        setRetainersOpen(false);
      }
      if (quizzesRef.current && !quizzesRef.current.contains(e.target as Node)) {
        setQuizzesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isServicesActive = location.startsWith("/services") || location === "/micro-offers";
  const isRetainersActive = location.startsWith("/retainers");
  const isQuizzesActive = QUIZ_ITEMS.some((item) => location === item.href);

  const headerClasses = cn(
    "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
    isHome && !scrolled
      ? "bg-transparent py-5"
      : "bg-[#0A2540]/95 backdrop-blur-md py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.08)]"
  );

  return (
    <header className={headerClasses}>
      <div className="max-w-[1200px] mx-auto px-6 flex items-center gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white hover:opacity-90 transition-opacity shrink-0">
          <Rocket className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base tracking-tight">Shane McCaw Consulting</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex flex-1 items-center justify-between">
          <ul className="flex items-center gap-1">
            {/* Services dropdown */}
            <li ref={servicesRef} className="relative">
              <button
                onClick={() => setServicesOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isServicesActive
                    ? "text-primary"
                    : "text-white/80 hover:text-white hover:bg-white/5"
                )}
              >
                Services
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", servicesOpen && "rotate-180")} />
              </button>

              {servicesOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-52 bg-[#0A2540] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5">
                  {SERVICES_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setServicesOpen(false)}
                      data-track="nav"
                      className={cn(
                        "block px-4 py-2 text-sm transition-colors",
                        location === item.href
                          ? "text-primary font-medium"
                          : "text-white/75 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </li>

            {/* Retainers dropdown */}
            <li ref={retainersRef} className="relative">
              <button
                onClick={() => setRetainersOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isRetainersActive
                    ? "text-primary"
                    : "text-white/80 hover:text-white hover:bg-white/5"
                )}
              >
                Retainers
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", retainersOpen && "rotate-180")} />
              </button>

              {retainersOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-52 bg-[#0A2540] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5">
                  {RETAINER_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setRetainersOpen(false)}
                      data-track="nav"
                      className={cn(
                        "block px-4 py-2 text-sm transition-colors",
                        location === item.href
                          ? "text-primary font-medium"
                          : "text-white/75 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </li>

            {/* Quizzes dropdown */}
            <li ref={quizzesRef} className="relative">
              <button
                onClick={() => setQuizzesOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isQuizzesActive
                    ? "text-primary"
                    : "text-white/80 hover:text-white hover:bg-white/5"
                )}
              >
                Quizzes
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", quizzesOpen && "rotate-180")} />
              </button>

              {quizzesOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-56 bg-[#0A2540] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5">
                  {QUIZ_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setQuizzesOpen(false)}
                      data-track="nav"
                      className={cn(
                        "block px-4 py-2 text-sm transition-colors",
                        location === item.href
                          ? "text-primary font-medium"
                          : "text-white/75 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </li>

            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  data-track="nav"
                  className={cn(
                    "block px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    location === link.href
                      ? "text-primary"
                      : "text-white/80 hover:text-white hover:bg-white/5"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/crm/"
              className="text-sm font-semibold px-4 py-2 rounded-lg border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
            >
              Client Login
            </a>
            <CTAButton href="/book" className="text-sm px-5 py-2">Book a Call</CTAButton>
          </div>
        </nav>

        {/* Mobile toggle */}
        <button
          className="lg:hidden ml-auto text-white/80 hover:text-white transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-[#0A2540] border-t border-white/10 shadow-xl">
          <div className="px-5 py-4 space-y-1">
            {/* Services section */}
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">Services</p>
            {SERVICES_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-sm text-white/75 hover:text-white hover:bg-white/5 transition-colors"
              >
                {item.label}
              </Link>
            ))}

            <div className="my-2 border-t border-white/10" />

            {/* Retainers section */}
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">Retainers</p>
            {RETAINER_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-3 py-2 rounded-lg text-sm transition-colors",
                  location === item.href ? "text-primary font-medium" : "text-white/75 hover:text-white hover:bg-white/5"
                )}
              >
                {item.label}
              </Link>
            ))}

            <div className="my-2 border-t border-white/10" />

            {/* Quizzes section */}
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">Quizzes</p>
            {QUIZ_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-3 py-2 rounded-lg text-sm transition-colors",
                  location === item.href ? "text-primary font-medium" : "text-white/75 hover:text-white hover:bg-white/5"
                )}
              >
                {item.label}
              </Link>
            ))}

            <div className="my-2 border-t border-white/10" />

            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  location === link.href ? "text-primary" : "text-white/80 hover:text-white hover:bg-white/5"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="px-5 py-4 border-t border-white/10 flex flex-col gap-2.5">
            <a
              href="/crm/"
              className="w-full text-center font-semibold py-2.5 px-6 rounded-lg border border-white/20 text-white/80 hover:text-white hover:bg-white/5 transition-colors text-sm"
              onClick={() => setMobileMenuOpen(false)}
            >
              Client Login
            </a>
            <CTAButton href="/book" className="w-full justify-center">Book a Call</CTAButton>
          </div>
        </div>
      )}
    </header>
  );
}
