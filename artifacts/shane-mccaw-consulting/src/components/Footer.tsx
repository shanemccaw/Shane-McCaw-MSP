import React from "react";
import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-sidebar text-white py-10">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-lg">Shane McCaw Consulting</span>
            <span className="text-white/60 text-sm">Vero Beach, FL</span>
          </div>

          <p className="text-white/60 text-sm text-center">
            Microsoft 365 · Copilot AI · SharePoint · Power Platform
          </p>

          <Link
            href="/book"
            className="inline-block bg-primary hover:bg-[#005A9E] transition-colors text-white text-sm font-medium px-5 py-2.5 rounded-md whitespace-nowrap"
          >
            Schedule a Consultation
          </Link>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-center text-white/40 text-xs">
          <p>
            © {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
            {" · "}
            <Link href="/privacy" className="hover:text-white/70 transition-colors underline underline-offset-2">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
