import React from 'react';
import { Scale, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

export const ComplianceView: React.FC = () => {
  const benchmarks = [
    { name: 'CIS Microsoft 365 Foundations Benchmark v3.0', passed: 48, total: 54, score: '88%' },
    { name: 'NIST CSF 2.0 (Protect & Detect Framework)', passed: 32, total: 36, score: '89%' },
    { name: 'ISO/IEC 27001:2022 Cloud Security Controls', passed: 41, total: 45, score: '91%' },
    { name: 'SOC 2 Type II M365 Trust Criteria', passed: 28, total: 30, score: '93%' },
  ];

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-8 animate-in fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Regulatory & CIS Compliance Frameworks</h2>
        <p className="text-xs text-slate-400 mt-1">
          Automated evaluation against CIS Microsoft 365 benchmarks, NIST CSF, ISO 27001, and SOC 2 trust criteria.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {benchmarks.map((b) => (
          <div key={b.name} className="glass-panel p-6 rounded-2xl flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm leading-snug">{b.name}</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Passed {b.passed} of {b.total} automated controls
                  </p>
                </div>
              </div>
              <span className="text-2xl font-extrabold text-white font-mono">{b.score}</span>
            </div>

            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#479ef5] h-full rounded-full"
                style={{ width: `${(b.passed / b.total) * 100}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-white/5">
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Compliant Baseline
              </span>
              <button className="text-[#479ef5] hover:underline font-semibold">
                Download Audit Proof →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
