import React from 'react';
import { Link } from 'wouter';
import { ShieldCheck } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-slate-950 border-t border-slate-800 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">

          {/* Brand Column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <span className="text-white font-bold text-base">Shane McCaw Consulting</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-4">
              M365 Governance SaaS platform powered by 6 automated signal engines. NASA-grade security frameworks for enterprise Microsoft 365.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              NASA Copilot Deployment Standard
            </div>
          </div>

          {/* Assessments */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm tracking-wide">Assessments</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li><Link href="/assessments/premium" className="hover:text-white transition-colors">Paid M365 Assessments</Link></li>
              <li><Link href="/assessments/start" className="hover:text-emerald-400 transition-colors">Free Telemetry Snapshots</Link></li>
              <li><Link href="/assessments/all" className="hover:text-white transition-colors">Full Catalog</Link></li>
            </ul>

            <h4 className="text-white font-semibold mt-6 mb-4 text-sm tracking-wide">Free Diagnostics</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link href="/copilot-quiz" className="hover:text-violet-400 transition-colors">Copilot Readiness Quiz</Link></li>
              <li><Link href="/m365-health-quiz" className="hover:text-blue-400 transition-colors">M365 Health Check</Link></li>
              <li><Link href="/security-quiz" className="hover:text-red-400 transition-colors">Security Posture Quiz</Link></li>
              <li><Link href="/governance-quiz" className="hover:text-emerald-400 transition-colors">Governance Baseline Quiz</Link></li>
              <li><Link href="/migration-quiz" className="hover:text-amber-400 transition-colors">Migration Readiness Quiz</Link></li>
              <li><Link href="/power-platform-quiz" className="hover:text-yellow-400 transition-colors">Power Platform Risk Quiz</Link></li>
              <li><Link href="/sharepoint-quiz" className="hover:text-teal-400 transition-colors">SharePoint Architecture Quiz</Link></li>
              <li><Link href="/teams-quiz" className="hover:text-indigo-400 transition-colors">Teams Governance Quiz</Link></li>
            </ul>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm tracking-wide">Platform</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li><Link href="/monitoring" className="hover:text-white transition-colors">Tenant Monitoring Engine</Link></li>
              <li><Link href="/projects" className="hover:text-white transition-colors">Fixed-Price Projects</Link></li>
              <li><Link href="/services" className="hover:text-white transition-colors">Architect Retainers</Link></li>
              <li><Link href="/resources" className="hover:text-white transition-colors">Resources & Articles</Link></li>
              <li><Link href="/msp" className="hover:text-white transition-colors">MSP Resellers</Link></li>
            </ul>

            <h4 className="text-white font-semibold mt-6 mb-4 text-sm tracking-wide">Company</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li><Link href="/about" className="hover:text-white transition-colors">About Shane</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Contact</Link></li>
              <li><Link href="/book" className="hover:text-white transition-colors">Book a Call</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm tracking-wide">Legal</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
            </ul>

            <h4 className="text-white font-semibold mt-6 mb-4 text-sm tracking-wide">Signal Engines</h4>
            <ul className="space-y-1.5 text-xs text-slate-500">
              <li>Drift Engine</li>
              <li>Security Engine</li>
              <li>Health Engine</li>
              <li>SLA Engine</li>
              <li>Scope Creep Engine</li>
              <li>Sales Offer Engine</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-xs">
            &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
          </p>
          <p className="text-slate-600 text-xs">
            NASA Copilot Deployment Standard · Microsoft 365 Governance SaaS
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
