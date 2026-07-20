import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";

// Quiz is demoted to a recovery/SEO-feeder role (website-rebuild-reference-v2.md §1/§5) —
// listed here in the footer, not the primary header nav.
const QUIZ_HUB_HREF = "/quiz";

export function Footer() {
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

          {/* Assessment + Solutions */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Get Started</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/assessment" className="hover:text-text-primary transition-colors">Assessment</Link></li>
              <li><Link href="/monitoring" className="hover:text-text-primary transition-colors">Monitoring</Link></li>
              <li><Link href={QUIZ_HUB_HREF} className="hover:text-text-primary transition-colors">Free Quiz</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Solutions</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li><Link href="/solutions/copilot" className="hover:text-text-primary transition-colors">Copilot & AI</Link></li>
              <li><Link href="/solutions/security-compliance" className="hover:text-text-primary transition-colors">Security & Compliance</Link></li>
              <li><Link href="/solutions/governance" className="hover:text-text-primary transition-colors">Governance</Link></li>
              <li><Link href="/solutions/sharepoint" className="hover:text-text-primary transition-colors">SharePoint</Link></li>
              <li><Link href="/solutions/power-platform" className="hover:text-text-primary transition-colors">Power Platform</Link></li>
              <li><Link href="/solutions/teams" className="hover:text-text-primary transition-colors">Teams</Link></li>
              <li><Link href="/solutions/migration" className="hover:text-text-primary transition-colors">Migration</Link></li>
              <li><Link href="/solutions/m365-health" className="hover:text-text-primary transition-colors">M365 Health</Link></li>
            </ul>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Platform</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/products" className="hover:text-text-primary transition-colors">Quick-Start Packs</Link></li>
              <li><Link href="/retainer" className="hover:text-text-primary transition-colors">Fractional Consulting</Link></li>
              <li><Link href="/msp" className="hover:text-text-primary transition-colors">MSP / Partners</Link></li>
              <li><Link href="/trust-security" className="hover:text-text-primary transition-colors">Trust & Security</Link></li>
              <li><Link href="/resources" className="hover:text-text-primary transition-colors">Resources</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Company</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/about" className="hover:text-text-primary transition-colors">About</Link></li>
              <li><Link href="/contact" className="hover:text-text-primary transition-colors">Contact</Link></li>
              <li><Link href="/book" className="hover:text-text-primary transition-colors">Book a Call</Link></li>
            </ul>
          </div>

          {/* Legal + Login */}
          <div>
            <h4 className="text-text-primary font-semibold mb-4 text-sm tracking-wide">Legal</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/terms" className="hover:text-text-primary transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-text-primary transition-colors">Privacy Policy</Link></li>
            </ul>

            <h4 className="text-text-primary font-semibold mt-6 mb-4 text-sm tracking-wide">Account</h4>
            <ul className="space-y-2.5 text-sm text-text-secondary">
              <li><Link href="/login" className="hover:text-text-primary transition-colors">Client Login</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-text-tertiary text-xs">
            &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
          </p>
          <Link href="/privacy" className="text-text-tertiary text-xs hover:text-text-secondary transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
