import React from 'react';
import { IdentityMetrics } from '../types';

interface IdentityAccessProps {
  metrics: IdentityMetrics;
  onViewIdentityDetails: () => void;
}

export const IdentityAccess: React.FC<IdentityAccessProps> = ({
  metrics,
  onViewIdentityDetails,
}) => {
  return (
    <section className="mb-12 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">
          Identity & Access Management
        </h2>
        <button
          onClick={onViewIdentityDetails}
          className="text-xs text-[#479ef5] hover:underline font-mono"
        >
          View Role Audit →
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Card 1: Privileged Roles */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-white/20 transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-2">Privileged Roles</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                {metrics.privilegedRolesCount}
              </span>
              <span className="text-xs text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                {metrics.privilegedRolesChange}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div className="h-1.5 flex-1 bg-red-500 rounded-full" />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
          </div>
        </div>

        {/* Card 2: MFA Coverage */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-white/20 transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-2">MFA Coverage</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                {metrics.mfaCoveragePercent}%
              </span>
              <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {metrics.mfaGrowthText}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div
              className="h-1.5 bg-[#479ef5] rounded-full transition-all duration-500"
              style={{ width: `${metrics.mfaCoveragePercent}%` }}
            />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
          </div>
        </div>

        {/* Card 3: Conditional Access */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border-l-4 border-l-emerald-400 hover:border-white/20 transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-2">Conditional Access</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                {metrics.conditionalAccessPercent}%
              </span>
              <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {metrics.conditionalAccessStatus}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div className="h-1.5 w-full bg-emerald-400 rounded-full" />
          </div>
        </div>

      </div>
    </section>
  );
};
