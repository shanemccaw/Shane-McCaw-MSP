import React, { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, ChevronDown, ShieldCheck, Zap, Activity,
  FileText, Shield, Layers, HelpCircle, ArrowRight
} from "lucide-react";

export default function Header() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assessmentsDropdownOpen, setAssessmentsDropdownOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);

  const assessmentsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const servicesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnterAssessments = () => {
    if (assessmentsTimeoutRef.current) clearTimeout(assessmentsTimeoutRef.current);
    setAssessmentsDropdownOpen(true);
  };

  const handleMouseLeaveAssessments = () => {
    assessmentsTimeoutRef.current = setTimeout(() => {
      setAssessmentsDropdownOpen(false);
    }, 150);
  };

  const handleMouseEnterServices = () => {
    if (servicesTimeoutRef.current) clearTimeout(servicesTimeoutRef.current);
    setServicesDropdownOpen(true);
  };

  const handleMouseLeaveServices = () => {
    servicesTimeoutRef.current = setTimeout(() => {
      setServicesDropdownOpen(false);
    }, 150);
  };

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          
          {/* Brand Logo / Authority */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg text-white tracking-tight leading-none group-hover:text-blue-400 transition-colors">
                Shane McCaw
              </span>
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                M365 Governance SaaS
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              Home
            </Link>

            {/* Assessments Dropdown */}
            <div
              className="relative"
              onMouseEnter={handleMouseEnterAssessments}
              onMouseLeave={handleMouseLeaveAssessments}
            >
              <Link
                href="/assessments"
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.startsWith("/assessments")
                    ? "text-blue-400 bg-blue-500/10"
                    : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>Assessments</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${assessmentsDropdownOpen ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
              </Link>

              {assessmentsDropdownOpen && (
                <div className="absolute top-full left-0 w-80 mt-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                  <Link
                    href="/assessments"
                    onClick={() => setAssessmentsDropdownOpen(false)}
                    className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors flex items-center gap-1">
                        Paid M365 Assessments
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Fixed-price diagnostic deliverables & instant execution.
                      </p>
                    </div>
                  </Link>

                  <Link
                    href="/assessments?tab=free"
                    onClick={() => setAssessmentsDropdownOpen(false)}
                    className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
                        Free Telemetry Snapshots
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Instant tenant risk scoring and lead telemetry.
                      </p>
                    </div>
                  </Link>

                  <div className="border-t border-slate-800/80 my-1 pt-1">
                    <Link
                      href="/copilot-quiz"
                      onClick={() => setAssessmentsDropdownOpen(false)}
                      className="flex items-center justify-between p-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                    >
                      <span>Copilot Readiness Quiz</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href="/m365-health-quiz"
                      onClick={() => setAssessmentsDropdownOpen(false)}
                      className="flex items-center justify-between p-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                    >
                      <span>M365 Health Quiz</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Services Dropdown */}
            <div
              className="relative"
              onMouseEnter={handleMouseEnterServices}
              onMouseLeave={handleMouseLeaveServices}
            >
              <button
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.startsWith("/services") || location === "/monitoring" || location === "/projects"
                    ? "text-blue-400 bg-blue-500/10"
                    : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>Services & Platform</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${servicesDropdownOpen ? "rotate-180 text-blue-400" : "text-slate-400"}`} />
              </button>

              {servicesDropdownOpen && (
                <div className="absolute top-full left-0 w-80 mt-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                  <Link
                    href="/monitoring"
                    onClick={() => setServicesDropdownOpen(false)}
                    className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">
                        Tenant Monitoring Engine
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        24/7 automated drift, SLA & security tracking.
                      </p>
                    </div>
                  </Link>

                  <Link
                    href="/projects"
                    onClick={() => setServicesDropdownOpen(false)}
                    className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">
                        Fixed-Price Projects
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Structured migrations, Copilot rollouts & hardening.
                      </p>
                    </div>
                  </Link>

                  <Link
                    href="/services"
                    onClick={() => setServicesDropdownOpen(false)}
                    className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-800/80 transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-amber-400 transition-colors">
                        Architect Retainers
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Dedicated M365 governance advisory & support.
                      </p>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/msp"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/msp" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              MSP Resellers
            </Link>

            <Link
              href="/about"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                location === "/about" ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:text-white hover:bg-slate-900"
              }`}
            >
              About Shane
            </Link>
          </nav>

          {/* Right Action CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/assessments"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
            >
              <span>Explore M365 Catalog</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Mobile Menu Toggle Button */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Menu Content */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950 border-b border-slate-800 px-4 pt-2 pb-6 space-y-3">
          <Link
            href="/"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            Home
          </Link>
          <Link
            href="/assessments"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-blue-400 hover:bg-slate-900"
          >
            M365 Assessments & Snapshots
          </Link>
          <Link
            href="/monitoring"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            Tenant Monitoring
          </Link>
          <Link
            href="/projects"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            Fixed-Price Projects
          </Link>
          <Link
            href="/services"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            Architect Retainers
          </Link>
          <Link
            href="/msp"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            MSP Resellers
          </Link>
          <Link
            href="/about"
            onClick={closeMobileMenu}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-900"
          >
            About Shane
          </Link>

          <div className="pt-2">
            <Link
              href="/assessments"
              onClick={closeMobileMenu}
              className="w-full text-center py-3 px-4 rounded-xl text-sm font-semibold bg-blue-600 text-white block"
            >
              Explore Catalog
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}