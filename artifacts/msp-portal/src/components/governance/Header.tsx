import React from 'react';
import { RefreshCw, Shield, Activity } from 'lucide-react';

interface HeaderProps {
  latency: number;
  status: string;
  isScanning: boolean;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  latency,
  status,
  isScanning,
  onRefresh
}) => {
  return (
    <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
      <div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#479ef5]/10 border border-[#479ef5]/30 rounded-lg text-[#479ef5]">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight text-[#e2e2e2]">
            Governance Intelligence <span className="text-[#479ef5]">Overview</span>
          </h1>
        </div>
        <p className="font-mono text-xs text-[#c0c7d3] uppercase tracking-widest mt-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#479ef5] animate-pulse"></span>
          System Level 4 • Real-time Policy Audit
        </p>
      </div>

      <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto">
        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            disabled={isScanning}
            className={`px-3 py-1.5 text-xs font-mono rounded border flex items-center gap-2 transition-all ${
              isScanning
                ? 'bg-[#479ef5]/20 border-[#479ef5]/50 text-[#479ef5] cursor-not-allowed'
                : 'bg-[#1e2020] border-white/10 hover:border-[#479ef5]/50 text-[#c0c7d3] hover:text-white'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'AUDITING TENANT...' : 'RUN AUDIT'}
          </button>
          
          <div className="text-right">
            <p className="font-mono text-[10px] text-[#8a919d]">LATENCY: {latency}ms</p>
            <p className="font-mono text-[10px] text-[#22c55e] flex items-center justify-end gap-1 font-semibold">
              <Activity className="w-3 h-3 animate-pulse" />
              STATUS: {status}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
