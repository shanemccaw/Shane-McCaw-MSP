import React from 'react';
import { Building2, Users, Shield, Network, AlertTriangle } from 'lucide-react';

interface TenantTopologyProps {
  onOpenAnomalies: () => void;
  tenantName?: string;
}

export const TenantTopology: React.FC<TenantTopologyProps> = ({
  onOpenAnomalies,
  tenantName = 'Tenant-01',
}) => {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-semibold text-[#e2e2e2]">
            Tenant Topology Map
          </h2>
          <Network className="h-4 w-4 text-[#8a919d]" />
        </div>

        {/* Node Topology Canvas */}
        <div className="relative my-2 flex flex-col items-center justify-center rounded-lg border border-[#282a2b] bg-[#121414]/80 p-6">
          {/* Background grid dots styling */}
          <div className="absolute inset-0 bg-[radial-gradient(#282a2b_1px,transparent_1px)] [background-size:12px_12px] opacity-60 rounded-lg pointer-events-none" />

          {/* Central Tenant Node */}
          <div className="relative z-10 rounded-md border border-[#479ef5]/60 bg-[#001c37] px-6 py-2 font-mono text-xs font-semibold text-[#a0c9ff] shadow-[0_0_15px_rgba(71,158,245,0.25)]">
            {tenantName}
          </div>

          {/* SVG Connector Lines */}
          <div className="relative h-12 w-full max-w-xs my-1">
            <svg className="h-full w-full stroke-[#404752]" strokeDasharray="3 3">
              {/* Center to Left */}
              <line x1="50%" y1="0" x2="20%" y2="100%" strokeWidth="1.5" />
              {/* Center to Center */}
              <line x1="50%" y1="0" x2="50%" y2="100%" strokeWidth="1.5" />
              {/* Center to Right */}
              <line x1="50%" y1="0" x2="80%" y2="100%" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Connected Children Row */}
          <div className="relative z-10 flex w-full max-w-sm justify-between gap-2 px-2">
            {/* Org Unit */}
            <div className="flex items-center gap-1.5 rounded border border-[#333535] bg-[#1a1c1c] px-3 py-1.5 font-mono text-[11px] text-[#c0c7d3] shadow-sm">
              <Building2 className="h-3.5 w-3.5 text-[#8a919d]" />
              <span>Org Unit</span>
            </div>

            {/* Groups */}
            <div className="flex items-center gap-1.5 rounded border border-[#333535] bg-[#1a1c1c] px-3 py-1.5 font-mono text-[11px] text-[#c0c7d3] shadow-sm">
              <Users className="h-3.5 w-3.5 text-[#8a919d]" />
              <span>Groups</span>
            </div>

            {/* IAM Roles */}
            <div className="flex items-center gap-1.5 rounded border border-[#5a3289] bg-[#311154] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#dab9ff] shadow-sm">
              <Shield className="h-3.5 w-3.5 text-[#dab9ff]" />
              <span>IAM Roles</span>
            </div>
          </div>
        </div>
      </div>

      {/* Structural Anomalies Banner */}
      <div
        onClick={onOpenAnomalies}
        className="mt-4 flex items-center justify-between rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3 transition-all hover:bg-[#f59e0b]/15 cursor-pointer group"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-[#f59e0b] shrink-0" />
          <div>
            <div className="font-mono text-xs font-semibold text-[#f59e0b] group-hover:underline">
              Structural Anomalies
            </div>
            <div className="text-[11px] text-[#c0c7d3]">
              Detected orphaned groups and circular dependencies.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center rounded bg-[#f59e0b]/20 px-2.5 py-1 font-mono text-xs font-bold text-[#f59e0b] border border-[#f59e0b]/30">
          12
        </div>
      </div>
    </div>
  );
};
