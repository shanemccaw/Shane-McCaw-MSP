import React from 'react';
import { RefreshCw, ChevronDown, Activity, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  currentEnvironment: string;
  onSelectEnvironment: (env: string) => void;
  lastAnalysisTime: string;
  isScanning: boolean;
  onRunScan: () => void;
  isRemediated: boolean;
  onReset: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentEnvironment,
  onSelectEnvironment,
  lastAnalysisTime,
  isScanning,
  onRunScan,
  isRemediated,
  onReset,
}) => {
  const [showEnvDropdown, setShowEnvDropdown] = React.useState(false);

  const environments = [
    { id: 'TENANT-01 PRODUCTION', label: 'TENANT-01 PRODUCTION' },
    { id: 'TENANT-02 STAGING', label: 'TENANT-02 STAGING' },
    { id: 'DEV-US-WEST', label: 'DEV-US-WEST' },
  ];

  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#e2e2e2] sm:text-3xl">
          Architecture Intelligence Overview
        </h1>
        <div className="relative mt-1 inline-flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8a919d]">
            ENVIRONMENT:
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEnvDropdown(!showEnvDropdown)}
              className="inline-flex items-center gap-1.5 rounded border border-[#333535] bg-[#1e2020] px-2.5 py-0.5 font-mono text-xs font-semibold uppercase text-[#a0c9ff] transition-colors hover:border-[#a0c9ff]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {currentEnvironment}
              <ChevronDown className="h-3 w-3 text-[#8a919d]" />
            </button>

            {showEnvDropdown && (
              <div className="absolute left-0 z-50 mt-1 w-56 rounded-md border border-[#333535] bg-[#1a1c1c] p-1 shadow-xl backdrop-blur-md">
                {environments.map((env) => (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => {
                      onSelectEnvironment(env.id);
                      setShowEnvDropdown(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-3 py-1.5 font-mono text-xs text-left ${
                      currentEnvironment === env.id
                        ? 'bg-[#282a2b] font-medium text-[#a0c9ff]'
                        : 'text-[#c0c7d3] hover:bg-[#282a2b]/60'
                    }`}
                  >
                    <span>{env.label}</span>
                    {currentEnvironment === env.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#a0c9ff]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {isRemediated && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded border border-[#333535] bg-[#1a1c1c] px-3 py-1.5 font-mono text-xs text-[#c0c7d3] hover:border-[#8a919d] hover:text-white"
            title="Reset score to original state"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Reset State
          </button>
        )}

        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8a919d]">
            Last Analysis
          </div>
          <div className="font-mono text-xs font-semibold text-[#e2e2e2]">
            {lastAnalysisTime}
          </div>
        </div>

        <button
          type="button"
          onClick={onRunScan}
          disabled={isScanning}
          className={`inline-flex items-center gap-2 rounded-md bg-[#479ef5] px-4 py-2 font-mono text-xs font-semibold text-[#001c37] transition-all hover:bg-[#a0c9ff] active:scale-[0.98] ${
            isScanning ? 'opacity-80 cursor-wait' : ''
          }`}
        >
          <RefreshCw
            className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`}
          />
          {isScanning ? 'Scanning Tenant...' : 'Run Full Scan'}
        </button>
      </div>
    </header>
  );
};
