import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ShieldCheck, ChevronDown, Menu, X, ArrowRight } from "lucide-react";

/**
 * Shared Chrome — Header (Design/fractional_architecture/README.md).
 * Eight solution deep dives, in the locked order, feeding both the desktop
 * dropdown and the mobile accordion.
 */
const SOLUTIONS_ITEMS = [
  { label: "Copilot & AI", href: "/solutions/copilot" },
  { label: "Security & Compliance", href: "/solutions/security" },
  { label: "Governance", href: "/solutions/governance" },
  { label: "SharePoint", href: "/solutions/sharepoint" },
  { label: "Power Platform", href: "/solutions/power-platform" },
  { label: "Teams", href: "/solutions/teams" },
  { label: "Migration", href: "/solutions/migration" },
  { label: "M365 Health", href: "/solutions/health" },
] as const;

function BrandMark() {
  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
      style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6)" }}
    >
      <ShieldCheck className="w-5 h-5" strokeWidth={2} />
    </div>
  );
}

export function Header() {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [solOpen, setSolOpen] = useState(false);
  const [mobileSolOpen, setMobileSolOpen] = useState(false);
  const solRef = useRef<HTMLDivElement>(null);

  // Both menus close on resize across the 1024px breakpoint (README: Interactions).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      setMenuOpen(false);
      setSolOpen(false);
      setMobileSolOpen(false);
    };
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);

  // The desktop dropdown closes on an outside click.
  useEffect(() => {
    if (!solOpen) return;
    const onClick = (e: MouseEvent) => {
      if (solRef.current && !solRef.current.contains(e.target as Node)) setSolOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [solOpen]);

  const solutionsActive = location.startsWith("/solutions");
  const navLinkClass = (active: boolean) =>
    `px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
      active ? "text-[#00B4D8] bg-white/[0.06]" : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
    }`;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-[72px] bg-[rgba(2,6,23,0.88)] backdrop-blur-xl border-b border-[rgba(30,41,59,0.8)]"
      data-track="nav"
    >
      <div className="max-w-[1280px] mx-auto h-full px-[clamp(16px,4vw,32px)] flex items-center justify-between gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0" data-track="nav" onClick={() => setMenuOpen(false)}>
          <BrandMark />
          <span className="font-display font-bold text-base tracking-[-0.02em] leading-none text-text-primary">
            Shane McCaw
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          <Link href="/assessment" className={navLinkClass(location === "/assessment")} data-track="nav">
            Assessment
          </Link>

          <div className="relative" ref={solRef}>
            <button
              type="button"
              className={`${navLinkClass(solutionsActive)} flex items-center gap-1`}
              aria-expanded={solOpen}
              aria-haspopup="true"
              onClick={() => setSolOpen((open) => !open)}
              data-track="nav"
            >
              Solutions
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${solOpen ? "rotate-180" : ""}`} />
            </button>

            {solOpen && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+8px)] w-[400px] rounded-2xl p-2 grid grid-cols-2 gap-1 bg-[rgba(5,12,29,0.97)] border border-[rgba(30,41,59,0.9)]"
                role="menu"
              >
                {SOLUTIONS_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-2.5 rounded-xl text-[13px] font-medium text-text-primary hover:bg-white/[0.06] hover:text-[#00B4D8] transition-colors"
                    role="menuitem"
                    data-track="nav"
                    onClick={() => setSolOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link href="/" className={navLinkClass(location === "/")} data-track="nav">
            Fractional Architecture
          </Link>
          <Link href="/about" className={navLinkClass(location === "/about")} data-track="nav">
            About Shane
          </Link>
          <Link href="/resources" className={navLinkClass(location === "/resources")} data-track="nav">
            Resources
          </Link>
          <Link href="/contact" className={navLinkClass(location === "/contact")} data-track="nav">
            Contact
          </Link>
        </nav>

        {/* Desktop CTA */}
        <Link
          href="/contact"
          className="hidden lg:inline-flex items-center gap-1.5 rounded-xl text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#005A9E] transition-colors shrink-0 px-4 py-[9px]"
          data-track="cta"
        >
          Talk to Shane
          <ArrowRight className="w-4 h-4" />
        </Link>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="lg:hidden p-[10px] rounded-lg text-text-primary"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
          data-track="nav"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div className="lg:hidden border-t border-[rgba(30,41,59,0.8)] bg-[rgba(2,6,23,0.97)]">
          <nav className="flex flex-col py-2" aria-label="Mobile">
            <Link
              href="/assessment"
              className="px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMenuOpen(false)}
              data-track="nav"
            >
              Assessment
            </Link>

            <button
              type="button"
              className="flex items-center justify-between w-full text-left px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMobileSolOpen((open) => !open)}
              aria-expanded={mobileSolOpen}
            >
              Solutions
              <ChevronDown className={`w-4 h-4 transition-transform ${mobileSolOpen ? "rotate-180" : ""}`} />
            </button>
            {mobileSolOpen && (
              <div className="flex flex-col">
                {SOLUTIONS_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-6 py-[11px] text-sm text-text-secondary"
                    onClick={() => {
                      setMenuOpen(false);
                      setMobileSolOpen(false);
                    }}
                    data-track="nav"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}

            <Link
              href="/"
              className="px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMenuOpen(false)}
              data-track="nav"
            >
              Fractional Architecture
            </Link>
            <Link
              href="/about"
              className="px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMenuOpen(false)}
              data-track="nav"
            >
              About Shane
            </Link>
            <Link
              href="/resources"
              className="px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMenuOpen(false)}
              data-track="nav"
            >
              Resources
            </Link>
            <Link
              href="/contact"
              className="px-3 py-3 text-sm font-medium text-text-primary"
              onClick={() => setMenuOpen(false)}
              data-track="nav"
            >
              Contact
            </Link>

            <div className="px-3 pt-2 pb-3">
              <Link
                href="/contact"
                className="flex items-center justify-center gap-1.5 w-full rounded-xl text-sm font-semibold text-white bg-[#0078D4] px-4 py-3"
                onClick={() => setMenuOpen(false)}
                data-track="cta"
              >
                Talk to Shane
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Header;
