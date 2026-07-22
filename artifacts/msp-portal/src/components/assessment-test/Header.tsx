import React from 'react';
import { Shield, Download } from 'lucide-react';

interface HeaderProps {
  onExport: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onExport }) => {
  return (
    <header className="bg-[#1c2025]/90 backdrop-blur-md border-b border-white/10 sticky top-0 z-40 px-4 md:px-8 py-3.5">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
        
        {/* Left Branding */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#479ef5]/15 border border-[#479ef5]/40 flex items-center justify-center text-[#479ef5] shadow-sm">
            <Shield className="w-5 h-5 text-[#479ef5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-[#e0e2ea] tracking-tight">
                M365 Tenant Sentinel
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#34d399] bg-[#34d399]/10 border border-[#34d399]/20 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-ping" />
                Live Telemetry
              </span>
            </div>
            <p className="text-xs text-[#c0c7d3]/70">
              Contoso Corp • Tenant ID: <span className="font-mono text-[#479ef5]">3a8f-91e2-m365</span>
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-[#479ef5] hover:bg-[#388ee0] text-[#001c37] font-semibold transition-all shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </button>
        </div>

      </div>
    </header>
  );
};

