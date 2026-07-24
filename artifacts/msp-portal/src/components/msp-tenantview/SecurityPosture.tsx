import React from 'react';
import { Tenant } from '@/components/msp-tenantview/types';

interface SecurityPostureProps {
  tenant: Tenant;
  onOpenSecurityDetail?: () => void;
}

export const SecurityPosture: React.FC<SecurityPostureProps> = ({ tenant, onOpenSecurityDetail }) => {
  return (
    <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20 flex flex-col justify-between">
      <div>
        {/* Title */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#99cbff]">security</span>
            <h3 className="text-lg font-semibold text-[#e2e2e6]">Security Posture</h3>
          </div>
          {onOpenSecurityDetail && (
            <button 
              onClick={onOpenSecurityDetail}
              className="text-[#99cbff] hover:underline text-[11px] font-mono"
            >
              AUDIT
            </button>
          )}
        </div>

        <div className="space-y-3.5">
          {/* Conditional Access */}
          <div className="flex items-center justify-between p-3.5 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div>
              <span className="block text-[#e2e2e6] font-semibold text-xs">Conditional Access</span>
              <span className="text-[10px] font-mono text-[#bfc7d3]">14 POLICIES ACTIVE</span>
            </div>
            <div className="flex gap-1.5 items-center">
              <div className="w-1.5 h-4 bg-[#99cbff] rounded-full"></div>
              <div className="w-1.5 h-4 bg-[#99cbff] rounded-full"></div>
              <div className="w-1.5 h-4 bg-[#99cbff] rounded-full"></div>
              <div className="w-1.5 h-4 bg-[#99cbff]/30 rounded-full"></div>
            </div>
          </div>

          {/* MFA Adoption */}
          <div className="p-3.5 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[#e2e2e6] font-semibold text-xs">MFA Adoption</span>
              <span className="text-xs font-bold text-[#99cbff] font-mono">{tenant.mfaPercentage}%</span>
            </div>
            <div className="w-full bg-[#1e2023] rounded-full h-2 overflow-hidden mb-1.5">
              <div 
                className="bg-[#99cbff] h-full rounded-full transition-all duration-500" 
                style={{ width: `${tenant.mfaPercentage}%` }}
              ></div>
            </div>
            <span className="text-[10px] font-mono text-[#bfc7d3] block">
              {Math.round((tenant.mfaPercentage / 100) * tenant.usersCount)} / {tenant.usersCount} USERS ENROLLED
            </span>
          </div>

          {/* License Inventory */}
          <div className="flex items-center justify-between p-3.5 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div>
              <span className="block text-[#e2e2e6] font-semibold text-xs">License Inventory</span>
              <span className="text-[10px] font-mono text-[#bfc7d3]">
                M365 E5 • {tenant.licensesTotal} SEATS
              </span>
            </div>
            <div className="text-right">
              <span className="block text-xs font-bold text-[#e2e2e6] font-mono">
                {tenant.licensesAvailable} AVAILABLE
              </span>
              <span className="text-[9px] text-[#00daf8] font-bold font-mono">STABLE</span>
            </div>
          </div>

          {/* Status Stack */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
              <span className="block text-[9px] font-mono text-[#bfc7d3] mb-1">BREAK GLASS</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00daf8]"></span>
                <span className="text-xs font-bold text-[#e2e2e6]">CONFIGURED</span>
              </div>
            </div>
            <div className="p-3 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
              <span className="block text-[9px] font-mono text-[#bfc7d3] mb-1">DOMAIN DRIFT</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00daf8]"></span>
                <span className="text-xs font-bold text-[#e2e2e6]">NO CHANGES</span>
              </div>
            </div>
          </div>

          {/* PIM */}
          <div className="flex items-center justify-between p-3.5 bg-[#0c0e11] rounded-lg border border-[#3f4751]/20">
            <div>
              <span className="block text-[#e2e2e6] font-semibold text-xs">PIM (Privileged Identity)</span>
              <span className="text-[10px] font-mono text-[#bfc7d3]">ELIGIBLE ASSIGNMENTS ACTIVE</span>
            </div>
            <span className="material-symbols-outlined text-[#99cbff] text-base">lock_open</span>
          </div>
        </div>
      </div>
    </div>
  );
};
