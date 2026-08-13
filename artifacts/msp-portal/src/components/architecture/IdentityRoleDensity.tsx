import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { RoleDensity, RoleMatrix } from './types';

interface IdentityRoleDensityProps {
  roles: RoleDensity[];
  matrix: RoleMatrix;
}

export const IdentityRoleDensity: React.FC<IdentityRoleDensityProps> = ({
  roles,
  matrix,
}) => {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <div>
        <h2 className="font-display text-base font-semibold text-[#e2e2e2] mb-4">
          Identity & Role Density
        </h2>

        {/* Roles List */}
        <div className="space-y-3.5">
          {roles.map((role) => (
            <div key={role.id} className="space-y-1">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#e2e2e2]">
                  {role.roleName}
                  {role.isHighRisk && (
                    <AlertTriangle className="h-3.5 w-3.5 text-[#ffb4ab]" />
                  )}
                </span>
                <span className="text-[#8a919d]">
                  <strong className="text-[#e2e2e2] font-semibold">
                    {role.membersCount}
                  </strong>{' '}
                  Members
                </span>
              </div>

              {/* Bar */}
              <div className="h-2 w-full rounded-full bg-[#121414]">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${
                    role.isHighRisk ? 'bg-[#ffb4ab]' : 'bg-[#479ef5]'
                  }`}
                  style={{
                    width: `${Math.min(100, (role.membersCount / 30) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid Stats Matrix Diagram */}
      <div className="relative mt-5 rounded-lg border border-[#333535] bg-[#121414] p-4">
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 bg-[radial-gradient(#282a2b_1px,transparent_1px)] [background-size:10px_10px] opacity-40 rounded-lg pointer-events-none" />

        <div className="relative z-10 grid grid-cols-2 gap-4 divide-x divide-y divide-[#282a2b] text-center">
          {/* Privileged */}
          <div className="p-2">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#8a919d]">
              PRIVILEGED
            </div>
            <div className="mt-1 font-display text-xl font-bold text-[#e2e2e2]">
              {matrix.privileged}
            </div>
          </div>

          {/* Total Roles */}
          <div className="p-2 border-t-0">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#8a919d]">
              TOTAL ROLES
            </div>
            <div className="mt-1 font-display text-xl font-bold text-[#e2e2e2]">
              {matrix.totalRoles}
            </div>
          </div>

          {/* Unclear Purpose */}
          <div className="p-2 border-l-0">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#8a919d]">
              UNCLEAR PURPOSE
            </div>
            <div className="mt-1 font-display text-xl font-bold text-[#e2e2e2]">
              {matrix.unclearPurpose}
            </div>
          </div>

          {/* Redundant */}
          <div className="p-2">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#8a919d]">
              REDUNDANT
            </div>
            <div className="mt-1 font-display text-xl font-bold text-[#e2e2e2]">
              {matrix.redundant}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
