import React from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { ComplianceData } from '../types';

interface ComplianceDistributionProps {
  compliance: ComplianceData;
  onFixDriftClick: () => void;
}

export const ComplianceDistribution: React.FC<ComplianceDistributionProps> = ({
  compliance,
  onFixDriftClick,
}) => {
  return (
    <section className="mb-12 max-w-6xl mx-auto">
      <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/10 shadow-xl">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 pb-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Compliance Distribution</h2>
            <p className="text-xs text-slate-400 mt-1">
              Real-time device health vs organizational security baseline.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-[#479ef5] rounded-full" />
              <span className="text-slate-300">Compliant</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-400 rounded-full" />
              <span className="text-slate-300">Non-compliant</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* Donut Chart (4 cols) */}
          <div className="md:col-span-4 flex justify-center">
            <div className="w-48 h-48 relative flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                {/* Background Ring - Red for non-compliant */}
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="#93000a"
                  strokeWidth="4"
                />
                {/* Foreground Ring - Blue for compliant */}
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="#479ef5"
                  strokeWidth="4"
                  strokeDasharray={`${compliance.overallScore}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute text-center flex flex-col items-center">
                <div className="text-3xl font-extrabold text-white tracking-tight font-mono">
                  {compliance.overallScore}%
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">
                  Overall Score
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bars (8 cols) */}
          <div className="md:col-span-8 space-y-6">
            {compliance.baselines.map((baseline) => {
              const isDanger = baseline.status === 'danger';
              return (
                <div key={baseline.id} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-white flex items-center gap-2">
                      {isDanger ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-[#479ef5]" />
                      )}
                      {baseline.name}
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        isDanger ? 'text-red-400' : 'text-white'
                      }`}
                    >
                      {baseline.score}%
                    </span>
                  </div>

                  <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isDanger ? 'bg-red-400' : 'bg-[#479ef5]'
                      }`}
                      style={{ width: `${baseline.score}%` }}
                    />
                  </div>

                  {baseline.driftNote && (
                    <div className="flex items-center justify-between text-[11px] text-red-400 pt-0.5">
                      <span>{baseline.driftNote}</span>
                      <button
                        onClick={onFixDriftClick}
                        className="underline hover:text-red-300 font-semibold cursor-pointer"
                      >
                        Push Intune Sync →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>

      </div>
    </section>
  );
};
