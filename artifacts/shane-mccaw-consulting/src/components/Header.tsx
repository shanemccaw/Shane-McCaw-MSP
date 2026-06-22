import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Rocket, ChevronDown,
  LayoutGrid, Building2, GraduationCap, Sparkles, FolderOpen, Zap,
  Shield, ShieldCheck, Cloud, Activity, ArrowLeftRight, Users,
  Star, TrendingUp, Award,
  Info, Tag, Mail, ScanSearch,
} from "lucide-react";
import { CTAButton } from "./CTAButton";
import { cn } from "@/lib/utils";

// ─── Nav icon helper ───────────────────────────────────────────────────────────
function getNavIcon(label: string): React.ReactNode {
  const l = label.toLowerCase();
  if (l.includes("copilot"))                                  return <Sparkles    className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("sharepoint"))                               return <FolderOpen  className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("power platform") || l.includes("quick-start") || l.includes("power automate")) return <Zap className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("security") || l.includes("compliance"))    return <ShieldCheck className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("governance"))                               return <Shield      className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("migration"))                                return <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("training") || l.includes("enablement"))    return <GraduationCap className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("cloud"))                                    return <Cloud       className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("health") || l.includes("audit"))           return <Activity    className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("tenant"))                                   return <ScanSearch  className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("teams"))                                    return <Users       className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("architecture") || l.includes("strategy") || l.includes("m365") || l.includes("microsoft 365")) return <Building2 className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("essentials"))                               return <Star        className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("growth"))                                   return <TrendingUp  className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("enterprise"))                               return <Award       className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("retainer") || l.includes("all ") || l.includes("overview") || l.includes("service")) return <LayoutGrid className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("about"))                                    return <Info        className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("pric"))                                     return <Tag         className="w-5 h-5" aria-hidden="true" />;
  if (l.includes("contact"))                                  return <Mail        className="w-5 h-5" aria-hidden="true" />;
  return                                                             <LayoutGrid  className="w-5 h-5" aria-hidden="true" />;
}

/** Auto-adds icons to a nav array by calling getNavIcon on each item's label. */
function withIcons(items: Array<Omit<NavItem, "icon">>): NavItem[] {
  return items.map((item) => ({ ...item, icon: getNavIcon(item.label) }));
}

// ─── Nav data ─────────────────────────────────────────────────────────────────
interface NavItem { label: string; href: string; icon?: React.ReactNode; }

const SERVICES_ITEMS: NavItem[] = withIcons([
  { label: "Service Overview",              href: "/services" },
  { label: "M365 Architecture & Strategy",  href: "/services/microsoft-365" },
  { label: "M365 Training",                 href: "/services/m365-training" },
  { label: "Copilot & AI",                  href: "/services/copilot-ai" },
  { label: "SharePoint",                    href: "/services/sharepoint" },
  { label: "Power Platform",                href: "/services/power-platform" },
  { label: "Governance",                    href: "/services/governance" },
  { label: "Cloud Migration",               href: "/services/cloud-migration" },
]);

const MICRO_OFFERS_ITEMS: NavItem[] = withIcons([
  { label: "Tenant Health Audit",                 href: "/micro-offers/tenant-health-audit" },
  { label: "Power Platform Quick-Start",          href: "/micro-offers/power-platform-quick-start" },
  { label: "Governance Foundations",              href: "/micro-offers/governance-foundations" },
  { label: "Migration Readiness Assessment",      href: "/micro-offers/migration-readiness-assessment" },
  { label: "Copilot Readiness Assessment",        href: "/micro-offers/copilot-readiness-assessment" },
  { label: "Microsoft 365 Training & Enablement", href: "/micro-offers/m365-training-enablement" },
]);

const RETAINER_ITEMS: NavItem[] = withIcons([
  { label: "All Retainer Plans",   href: "/retainers" },
  { label: "Architect Essentials", href: "/retainers/architect-essentials" },
  { label: "Architect Growth",     href: "/retainers/architect-growth" },
  { label: "Architect Enterprise", href: "/retainers/architect-enterprise" },
]);

const ASSESSMENTS_ITEMS: NavItem[] = withIcons([
  { label: "Copilot Readiness Assessment",     href: "/copilot-quiz" },
  { label: "M365 Health Assessment",           href: "/m365-health-quiz" },
  { label: "SharePoint Readiness Assessment",  href: "/sharepoint-readiness-quiz" },
  { label: "Power Platform Risk Assessment",   href: "/power-platform-quiz" },
  { label: "Security & Compliance Assessment", href: "/security-compliance-quiz" },
  { label: "Teams Maturity Assessment",        href: "/teams-maturity-quiz" },
  { label: "Migration Readiness Assessment",   href: "/migration-readiness-quiz" },
  { label: "Governance Maturity Assessment",   href: "/governance-maturity-quiz" },
]);

const COMPANY_ITEMS: NavItem[] = withIcons([
  { label: "About",   href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
]);

// ─── Menu key type ─────────────────────────────────────────────────────────────
type MenuKey = "services" | "microOffers" | "retainers" | "assessments" | "company";

// ─── Dropdown trigger ──────────────────────────────────────────────────────────
function DropdownTrigger({
  menuKey, label, isActive, isOpen, onToggle, triggerRef,
}: {
  menuKey: MenuKey;
  label: string;
  isActive: boolean;
  isOpen: boolean;
  onToggle: (key: MenuKey) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={triggerRef}
      onClick={() => onToggle(menuKey)}
      aria-haspopup="true"
      aria-expanded={isOpen}
      className={cn(
        "flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
        isActive || isOpen
          ? "text-primary"
          : "text-white/80 hover:text-white hover:bg-white/5"
      )}
    >
      {label}
      <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isOpen && "rotate-180")} />
    </button>
  );
}

// ─── Dropdown panel ────────────────────────────────────────────────────────────
function DropdownPanel({
  items, location, twoCol, width, onClose, triggerRef,
}: {
  items: NavItem[];
  location: string;
  twoCol?: boolean;
  width?: string;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Arrow key navigation within the open dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]')
    );
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = focusable[(idx + 1) % focusable.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = focusable[(idx - 1 + focusable.length) % focusable.length];
      prev?.focus();
    } else if (e.key === "Escape") {
      onClose();
      triggerRef?.current?.focus();
    } else if (e.key === "Tab") {
      onClose();
    }
  }, [onClose, triggerRef]);

  return (
    <div
      ref={panelRef}
      role="menu"
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute top-full left-0 mt-1.5 bg-[#0A2540] border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5",
        width ?? (twoCol ? "w-[28rem]" : "w-60")
      )}
    >
      <div className={cn(twoCol && "grid grid-cols-2")}>
        {items.map((item) => (
          <Link
            key={`${item.href}::${item.label}`}
            href={item.href}
            role="menuitem"
            tabIndex={0}
            onClick={onClose}
            data-track="nav"
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm transition-colors focus:outline-none focus:bg-white/10",
              location === item.href
                ? "text-primary font-medium"
                : "text-white/75 hover:text-white hover:bg-white/5"
            )}
          >
            {item.icon && <span className="shrink-0 w-5 h-5 opacity-60">{item.icon}</span>}
            {!item.icon && <span className="shrink-0 w-5 h-5" aria-hidden="true" />}
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
export function Header() {
  const [location] = useLocation();
  const isHome = location === "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<Record<string, boolean>>({});
  const navRef = useRef<HTMLUListElement>(null);

  // Per-trigger refs so Escape can return focus to the button that opened the menu
  const triggerRefs: Record<MenuKey, React.RefObject<HTMLButtonElement | null>> = {
    services:    useRef<HTMLButtonElement>(null),
    microOffers: useRef<HTMLButtonElement>(null),
    retainers:   useRef<HTMLButtonElement>(null),
    assessments: useRef<HTMLButtonElement>(null),
    company:     useRef<HTMLButtonElement>(null),
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu((prev) => {
          if (prev) triggerRefs[prev].current?.focus();
          return null;
        });
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenMenu(null);
  }, [location]);

  function toggle(key: MenuKey) {
    setOpenMenu((prev) => (prev === key ? null : key));
  }

  function closeAll() { setOpenMenu(null); }

  function toggleMobileSection(key: string) {
    setMobileExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const isServicesActive    = location.startsWith("/services");
  const isMicroActive       = location.startsWith("/micro-offers");
  const isRetainersActive   = location.startsWith("/retainers");
  const isAssessmentsActive = ASSESSMENTS_ITEMS.some((i) => location === i.href);
  const isResourcesActive   = location.startsWith("/resources");
  const isCompanyActive     = ["/about", "/pricing", "/contact"].includes(location);

  const headerClasses = cn(
    "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
    isHome && !scrolled
      ? "bg-transparent py-5"
      : "bg-[#0A2540]/95 backdrop-blur-md py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.08)]"
  );

  const MOBILE_SECTIONS = [
    { key: "services",    label: "Services",    items: SERVICES_ITEMS },
    { key: "microOffers", label: "Quick Wins",  items: MICRO_OFFERS_ITEMS },
    { key: "retainers",   label: "Retainers",   items: RETAINER_ITEMS },
    { key: "assessments", label: "Assessments", items: ASSESSMENTS_ITEMS },
    { key: "company",     label: "Company",     items: COMPANY_ITEMS },
  ];

  return (
    <header className={headerClasses}>
      <div className="max-w-[1200px] mx-auto px-6 flex items-center gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white hover:opacity-90 transition-opacity shrink-0">
          <Rocket className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base tracking-tight">Shane McCaw Consulting</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex flex-1 items-center justify-between" aria-label="Main navigation" role="navigation">
          <ul ref={navRef} className="flex items-center gap-0.5">

            {/* Services */}
            <li className="relative">
              <DropdownTrigger menuKey="services" label="Services" isActive={isServicesActive} isOpen={openMenu === "services"} onToggle={toggle} triggerRef={triggerRefs.services} />
              {openMenu === "services" && (
                <DropdownPanel items={SERVICES_ITEMS} location={location} twoCol onClose={closeAll} triggerRef={triggerRefs.services} />
              )}
            </li>

            {/* Quick Wins */}
            <li className="relative">
              <DropdownTrigger menuKey="microOffers" label="Quick Wins" isActive={isMicroActive} isOpen={openMenu === "microOffers"} onToggle={toggle} triggerRef={triggerRefs.microOffers} />
              {openMenu === "microOffers" && (
                <DropdownPanel items={MICRO_OFFERS_ITEMS} location={location} twoCol onClose={closeAll} triggerRef={triggerRefs.microOffers} />
              )}
            </li>

            {/* Retainers */}
            <li className="relative">
              <DropdownTrigger menuKey="retainers" label="Retainers" isActive={isRetainersActive} isOpen={openMenu === "retainers"} onToggle={toggle} triggerRef={triggerRefs.retainers} />
              {openMenu === "retainers" && (
                <DropdownPanel items={RETAINER_ITEMS} location={location} width="w-56" onClose={closeAll} triggerRef={triggerRefs.retainers} />
              )}
            </li>

            {/* Assessments */}
            <li className="relative">
              <DropdownTrigger menuKey="assessments" label="Assessments" isActive={isAssessmentsActive} isOpen={openMenu === "assessments"} onToggle={toggle} triggerRef={triggerRefs.assessments} />
              {openMenu === "assessments" && (
                <DropdownPanel items={ASSESSMENTS_ITEMS} location={location} twoCol onClose={closeAll} triggerRef={triggerRefs.assessments} />
              )}
            </li>

            {/* Resources — plain top-level link */}
            <li>
              <Link
                href="/resources"
                data-track="nav"
                className={cn(
                  "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                  isResourcesActive
                    ? "text-primary"
                    : "text-white/80 hover:text-white hover:bg-white/5"
                )}
              >
                Resources
              </Link>
            </li>

            {/* Company dropdown (About / Pricing / Contact) */}
            <li className="relative">
              <DropdownTrigger menuKey="company" label="Company" isActive={isCompanyActive} isOpen={openMenu === "company"} onToggle={toggle} triggerRef={triggerRefs.company} />
              {openMenu === "company" && (
                <DropdownPanel items={COMPANY_ITEMS} location={location} width="w-44" onClose={closeAll} triggerRef={triggerRefs.company} />
              )}
            </li>

          </ul>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            <a
              href="/crm/"
              className="text-sm font-semibold px-4 py-2 rounded-lg border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors whitespace-nowrap"
            >
              Client Login
            </a>
            <CTAButton href="/book" className="text-sm px-5 py-2 whitespace-nowrap">Book a Call</CTAButton>
          </div>
        </nav>

        {/* Mobile toggle */}
        <button
          className="lg:hidden ml-auto text-white/80 hover:text-white transition-colors"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden absolute top-full left-0 right-0 bg-[#0A2540] border-t border-white/10 shadow-xl overflow-y-auto max-h-[calc(100vh-4rem)]"
          role="navigation"
          aria-label="Mobile navigation"
        >
          <div className="px-5 py-3 space-y-0.5">

            {MOBILE_SECTIONS.map(({ key, label, items }) => (
              <div key={key}>
                <button
                  onClick={() => toggleMobileSection(key)}
                  aria-expanded={mobileExpanded[key] ?? false}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white/40 hover:text-white/60 transition-colors"
                >
                  {label}
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", mobileExpanded[key] && "rotate-180")} />
                </button>

                {mobileExpanded[key] && (
                  <div className="pb-2">
                    {items.map((item) => (
                      <Link
                        key={`${item.href}::${item.label}`}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                          location === item.href ? "text-primary font-medium" : "text-white/75 hover:text-white hover:bg-white/5"
                        )}
                      >
                        {item.icon && <span className="shrink-0 opacity-60">{item.icon}</span>}
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="border-t border-white/10 mx-3" />
              </div>
            ))}

            {/* Resources — standalone direct link */}
            <div>
              <Link
                href="/resources"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-colors",
                  isResourcesActive ? "text-primary" : "text-white/40 hover:text-white/60"
                )}
              >
                Resources
              </Link>
              <div className="border-t border-white/10 mx-3" />
            </div>

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
