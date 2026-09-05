import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";

/**
 * Shared Chrome — Footer (Design/fractional_architecture/README.md).
 * Five-column layout: Brand / Get Started / Solutions (8 links) / Company / Legal.
 * Link targets extracted from the design's own footer markup (Contact.dc.html),
 * mapped onto this app's real routes.
 */
const GET_STARTED_LINKS = [
  { label: "Assessment", href: "/assessment" },
  { label: "Fractional Architecture", href: "/#tiers" },
] as const;

const SOLUTIONS_LINKS = [
  { label: "Copilot & AI", href: "/solutions/copilot" },
  { label: "Security & Compliance", href: "/solutions/security" },
  { label: "Governance", href: "/solutions/governance" },
  { label: "SharePoint", href: "/solutions/sharepoint" },
  { label: "Power Platform", href: "/solutions/power-platform" },
  { label: "Teams", href: "/solutions/teams" },
  { label: "Migration", href: "/solutions/migration" },
  { label: "M365 Health", href: "/solutions/health" },
] as const;

const COMPANY_LINKS = [
  { label: "About Shane", href: "/about" },
  { label: "Resources", href: "/resources" },
  { label: "Contact", href: "/contact" },
  { label: "Ask a Question", href: "/contact#form" },
] as const;

const LEGAL_LINKS = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
] as const;

interface FooterColumnProps {
  heading: string;
  links: readonly { label: string; href: string }[];
}

function FooterColumn({ heading, links }: FooterColumnProps) {
  return (
    <div className="flex-[1_1_150px]">
      <h4 className="m-0 mb-3.5 text-sm font-semibold tracking-[0.02em] text-text-primary">{heading}</h4>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-text-secondary transition-colors hover:text-text-primary">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative border-t border-[rgba(30,41,59,0.8)] bg-[#020617]">
      <div className="mx-auto max-w-[1280px] px-[clamp(16px,4vw,32px)] pt-16 pb-10">
        <div className="mb-12 flex flex-wrap gap-10">
          {/* Brand */}
          <div className="flex-[1_1_260px]">
            <div className="mb-4 flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6)" }}
              >
                <ShieldCheck className="h-5 w-5" strokeWidth={2} />
              </div>
              <span className="font-display text-base font-semibold text-text-primary">Shane McCaw Consulting</span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
              Vero Beach, FL — M365 · Copilot AI · SharePoint · Power Platform
            </p>
          </div>

          <FooterColumn heading="Get Started" links={GET_STARTED_LINKS} />
          <FooterColumn heading="Solutions" links={SOLUTIONS_LINKS} />
          <FooterColumn heading="Company" links={COMPANY_LINKS} />
          <FooterColumn heading="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(30,41,59,0.8)] pt-7 text-xs text-text-secondary">
          <span>
            &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved. Shane&rsquo;s role at NASA
            is a personal credential; this practice is independent of NASA.
          </span>
          <Link href="/privacy" className="text-text-secondary transition-colors hover:text-text-primary">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
