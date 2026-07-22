import React from 'react';
import { IdentityMetrics } from './types';

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
        <h2 className="text-xl font-bold text-foreground tracking-tight">
          Identity & Access Management
        </h2>
        <button
          onClick={onViewIdentityDetails}
          className="text-xs text-primary hover:underline font-mono"
        >
          View Role Audit →
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Card 1: Privileged Roles */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-border transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Privileged Roles</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-foreground tracking-tight font-mono">
                {metrics.privilegedRolesCount}
              </span>
              <span className="text-xs text-destructive font-bold bg-destructive/10 px-2 py-0.5 rounded border border-destructive/20">
                {metrics.privilegedRolesChange}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div className="h-1.5 flex-1 bg-destructive rounded-full" />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
          </div>
        </div>

        {/* Card 2: MFA Coverage */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-border transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">MFA Coverage</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-foreground tracking-tight font-mono">
                {metrics.mfaCoveragePercent}%
              </span>
              <span className="text-xs text-[hsl(149,36%,49%)] font-bold bg-[hsl(149,36%,49%)]/10 px-2 py-0.5 rounded border border-[hsl(149,36%,49%)]/20">
                {metrics.mfaGrowthText}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div
              className="h-1.5 bg-primary rounded-full transition-all duration-500"
              style={{ width: `${metrics.mfaCoveragePercent}%` }}
            />
            <div className="h-1.5 flex-1 bg-white/10 rounded-full" />
          </div>
        </div>

        {/* Card 3: Conditional Access */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border-l-4 border-l-[hsl(149,36%,49%)] hover:border-border transition-all cursor-pointer" onClick={onViewIdentityDetails}>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Conditional Access</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-extrabold text-foreground tracking-tight font-mono">
                {metrics.conditionalAccessPercent}%
              </span>
              <span className="text-xs text-[hsl(149,36%,49%)] font-bold bg-[hsl(149,36%,49%)]/10 px-2 py-0.5 rounded border border-[hsl(149,36%,49%)]/20">
                {metrics.conditionalAccessStatus}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-1.5">
            <div className="h-1.5 w-full bg-[hsl(149,36%,49%)] rounded-full" />
          </div>
        </div>

      </div>
    </section>
  );
};
