import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useVersionInfo, formatRunningSince } from "@/hooks/useVersionInfo";

const FOOTER_LINKS = [
  { href: "/resources", label: "Resources" },
  { href: "/terms", label: "Terms & Service" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  const versionInfo = useVersionInfo();
  return (
    <footer className="bg-charcoal-0 border-t border-white/[0.08] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-10 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}
              >
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-text-primary font-display font-semibold text-base">Shane McCaw Consulting</span>
            </div>
            <p className="text-text-secondary text-sm leading-relaxed max-w-xs">
              Vero Beach, FL — M365 · Copilot AI · SharePoint · Power Platform
            </p>
          </div>

          {/* Links */}
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-8 gap-y-2.5 text-sm text-text-secondary">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="pt-8 border-t border-white/[0.08]">
          <p className="text-text-secondary text-xs">
            &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
            <span className="block sm:inline sm:ml-2">
              v{versionInfo.display}
              {formatRunningSince(versionInfo.startedAt) ? ` — ${formatRunningSince(versionInfo.startedAt)}` : ""}
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
