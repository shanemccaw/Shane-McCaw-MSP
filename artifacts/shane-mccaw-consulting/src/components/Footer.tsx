import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { ChatCTA } from "./ChatCTA";
import { useVersionInfo, formatRunningSince } from "@/hooks/useVersionInfo";

// Quiz is demoted to a recovery/SEO-feeder role (website-rebuild-reference-v2.md §1/§5) —
// listed here in the footer, not the primary header nav.
const QUIZ_HUB_HREF = "/quiz";

export function Footer() {
  const versionInfo = useVersionInfo();
  return (
    <footer className="bg-charcoal-0 border-t border-white/[0.08] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
          {/* Brand */}
          <div className="lg:col-span-2">
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

          {/* Assessment + Services */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Get Started</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/assessment" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Assessments</Link></li>
              <li><Link href={QUIZ_HUB_HREF} className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Free Quiz</Link></li>
              <li><Link href="/pricing" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Pricing</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Services</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li><Link href="/services/microsoft-365" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Microsoft 365 Architecture</Link></li>
              <li><Link href="/services/copilot-ai" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Copilot & AI</Link></li>
              <li><Link href="/services/security-hardening" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Security Hardening</Link></li>
              <li><Link href="/services/governance" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Governance & Compliance</Link></li>
              <li><Link href="/services/sharepoint" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">SharePoint</Link></li>
              <li><Link href="/services/power-platform" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Power Platform</Link></li>
              <li><Link href="/services/cloud-migration" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Cloud Migration</Link></li>
              <li><Link href="/services/m365-training" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Training & Enablement</Link></li>
              <li><Link href="/projects" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Projects by Topic</Link></li>
            </ul>
          </div>

          {/* Retainers */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Retainers</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/platform/retainer" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Compare Tiers</Link></li>
              <li><Link href="/retainers/architect-essentials" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Architect Essentials</Link></li>
              <li><Link href="/retainers/architect-growth" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Architect Growth</Link></li>
              <li><Link href="/retainers/architect-enterprise" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Architect Enterprise</Link></li>
              <li><Link href="/resources" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Resources</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Company</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/about" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">About</Link></li>
              <li><Link href="/trust-security" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Trust & Security</Link></li>
              <li><Link href="/status" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">System Status</Link></li>
              <li><Link href="/contact" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Contact</Link></li>
              <li><ChatCTA className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Ask a Question</ChatCTA></li>
            </ul>
          </div>

          {/* Legal + Login */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Legal</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/terms" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Privacy Policy</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Account</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><a href="/portal/login" className="block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">Client Login</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-text-secondary text-xs">
            &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
            <span className="block sm:inline sm:ml-2">
              v{versionInfo.display}
              {formatRunningSince(versionInfo.startedAt) ? ` — ${formatRunningSince(versionInfo.startedAt)}` : ""}
            </span>
          </p>
          <Link href="/privacy" className="text-text-secondary text-xs block py-1.5 -my-1.5 sm:py-0 sm:my-0 hover:text-text-primary transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
