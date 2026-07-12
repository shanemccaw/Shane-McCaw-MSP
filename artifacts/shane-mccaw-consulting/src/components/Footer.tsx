import React from "react";
import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-sidebar text-white py-10">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-lg">Shane McCaw Consulting</span>
            <span className="text-white/60 text-sm">Vero Beach, FL</span>
            <p className="text-white/40 text-xs mt-2 max-w-[220px]">
              Microsoft 365 · Copilot AI · SharePoint · Power Platform
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Retainer Plans</span>
            <Link href="/retainers/architect-essentials" className="text-sm text-white/65 hover:text-white transition-colors">
              Architect Essentials
            </Link>
            <Link href="/retainers/architect-growth" className="text-sm text-white/65 hover:text-white transition-colors">
              Architect Growth
            </Link>
            <Link href="/retainers/architect-enterprise" className="text-sm text-white/65 hover:text-white transition-colors">
              Architect Enterprise
            </Link>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Quick Links</span>
            <Link href="/monitoring" className="text-sm text-white/65 hover:text-white transition-colors">Monitoring</Link>
            <Link href="/how-it-works" className="text-sm text-white/65 hover:text-white transition-colors">How It Works</Link>
            <Link href="/resources" className="text-sm text-white/65 hover:text-white transition-colors">Resources</Link>
            <Link href="/msp" className="text-sm text-white/65 hover:text-white transition-colors">MSP Partners</Link>
            <Link href="/contact" className="text-sm text-white/65 hover:text-white transition-colors">Contact</Link>
          </div>

          <div className="flex flex-col gap-3 self-start md:self-center">
            <Link
              href="/assessment"
              className="inline-block bg-primary hover:bg-[#005A9E] transition-colors text-white text-sm font-medium px-5 py-2.5 rounded-md whitespace-nowrap text-center"
            >
              Free Assessment
            </Link>
            <Link
              href="/monitoring"
              className="inline-block border border-white/20 hover:border-white/40 hover:bg-white/5 transition-colors text-white/80 hover:text-white text-sm font-medium px-5 py-2.5 rounded-md whitespace-nowrap text-center"
            >
              Start Monitoring
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-center text-white/40 text-xs space-y-1">
          <p>© {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.</p>
          <p className="flex items-center justify-center gap-3">
            <Link href="/legal/privacy" className="hover:text-white/70 transition-colors underline underline-offset-2">
              Privacy Policy
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/legal/terms" className="hover:text-white/70 transition-colors underline underline-offset-2">
              Terms of Service
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
