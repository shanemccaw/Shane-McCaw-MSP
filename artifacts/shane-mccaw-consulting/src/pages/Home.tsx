import React from 'react';
import { Link, useLocation } from 'wouter';
import Header from '../components/Header';
import Footer from '../components/Footer';
import {
  ShieldCheck, Zap, ArrowRight, Activity, CheckCircle2,
  Lock, AlertTriangle, Layers, Clock, FileText, ChevronRight
} from 'lucide-react';

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header />

      <main className="flex-grow pt-24 pb-16">
        {/* HERO SECTION */}
        <section className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-8 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            NASA-Grade M365 Governance Standard
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-5xl mx-auto mb-6">
            Enterprise Microsoft 365 Governance & Automated Tenant Intelligence
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10">
            Architected by Shane McCaw—creator of NASA's federal M365 Copilot governance framework. Continuous automated monitoring across Drift, Security, Health, SLA, and Scope Creep.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto">
            <Link
              href="/assessments"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-base"
            >
              <span>Explore M365 Catalog</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/assessments?tab=free"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all flex items-center justify-center text-base"
            >
              Run Free Diagnostic
            </Link>
          </div>
        </section>

        {/* AUTHORITY & CREDIBILITY BANNER */}
        <section className="border-y border-slate-800/80 bg-slate-900/40 py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-7 h-7 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">NASA Copilot Deployment Standard</h3>
                <p className="text-xs text-slate-400">Framework distributed federal government-wide as the M365 governance benchmark.</p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-xs font-semibold text-slate-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>30-Year Microsoft Veteran</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Fixed-Price Deliverables</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Automated Engine Analysis</span>
              </div>
            </div>
          </div>
        </section>

        {/* 6 AUTOMATED ENGINES SECTION */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-20">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-extrabold text-white mb-4">
              Powered by 6 Signal Derivation Engines
            </h2>
            <p className="text-slate-400 text-sm sm:text-base">
              Eliminate manual tenant audits. Our platform continuously calculates risk, drift, and compliance metrics directly from Microsoft Graph telemetry.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <Activity className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Drift Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Detects unauthorized configuration changes, baseline deviations, and unapproved policy modifications automatically.
              </p>
            </div>

            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <Lock className="w-8 h-8 text-emerald-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Security Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Surfaces anonymous sharing links, stale guest permissions, over-permissioned apps, and missing MFA enforcement.
              </p>
            </div>

            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <AlertTriangle className="w-8 h-8 text-amber-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Health Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Calculates real-time tenant operational risk scores and provides automated remediation runbooks.
              </p>
            </div>

            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <Clock className="w-8 h-8 text-indigo-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">SLA Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tracks service-level agreements, response timelines, and milestone execution against fixed commitments.
              </p>
            </div>

            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <Layers className="w-8 h-8 text-purple-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Scope Creep Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Monitors active engineering workstreams against agreed Statements of Work (SOW) to prevent unbilled work.
              </p>
            </div>

            <div className="p-6 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
              <FileText className="w-8 h-8 text-pink-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Sales Offer Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Generates dynamic, signal-triggered upgrade recommendations and fixed-price service offers based on tenant telemetry.
              </p>
            </div>
          </div>
        </section>

        {/* CORE OFFERINGS CTA SECTION */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-12">
          <div className="bg-gradient-to-br from-blue-950/50 via-slate-900 to-indigo-950/40 border border-blue-500/30 rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white mb-4">
              Ready to Secure & Govern Your M365 Tenant?
            </h2>
            <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto mb-8">
              Explore our full catalog of fixed-price deliverable assessments, continuous 24/7 monitoring, and architect advisory retainers.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                href="/assessments"
                className="px-6 py-3.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center justify-center gap-2 text-sm"
              >
                <span>Browse Paid M365 Assessments</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                href="/monitoring"
                className="px-6 py-3.5 rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-all flex items-center justify-center text-sm"
              >
                Tenant Monitoring Packages
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}