import React from "react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import {
  ShieldCheck,
  Activity,
  Lock,
  AlertTriangle,
  ArrowRight,
  Zap,
  CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";

export default function Monitoring() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header />

      <main className="flex-grow pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* HERO */}
        <div className="text-center max-w-4xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            Continuous Tenant Intelligence
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-6">
            24/7 Automated M365 Governance Monitoring
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            Stop reacting to incidents. Our automated engines monitor your
            environment against NASA-grade governance standards, surfacing
            drift, security vulnerabilities, and SLA violations before they
            impact your operations.
          </p>
        </div>

        {/* CORE SIGNAL ENGINES */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mb-6">
              <Activity className="w-6 h-6 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">
              Drift & Health Monitoring
            </h2>
            <p className="text-slate-400 mb-6">
              Automated daily snapshots detect configuration drift from your
              established baseline. We identify unmanaged Teams, sprawl, and
              license waste, providing a clear "Health Score" for your entire
              tenant.
            </p>
            <ul className="space-y-3">
              {[
                "Unauthorized baseline changes",
                "License utilization optimization",
                "Tenant health score tracking",
                "Automated remediation runbooks",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <CheckCircle2 className="w-4 h-4 text-indigo-400" /> {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center mb-6">
              <Lock className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">
              Security & SLA Oversight
            </h2>
            <p className="text-slate-400 mb-6">
              Continuous security monitoring detects anonymous sharing, external
              guest access, and misconfigured permissions. Combined with SLA
              tracking, you maintain absolute visibility over your environment.
            </p>
            <ul className="space-y-3">
              {[
                "Anonymous sharing link detection",
                "External guest account auditing",
                "SLA compliance dashboards",
                "Permission hardening alerts",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-br from-blue-900/40 to-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Ready to secure your tenant?
          </h2>
          <p className="text-slate-400 mb-8 max-w-xl mx-auto">
            Choose a monitoring package tailored to your organization's scale
            and complexity.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/checkout?service=tenant-monitoring-standard"
              className="px-6 py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"
            >
              Start Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
