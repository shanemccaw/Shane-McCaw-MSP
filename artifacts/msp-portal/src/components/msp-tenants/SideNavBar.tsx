import React from 'react';
import { EngineType } from '@/components/msp-tenants/types';

interface SideNavBarProps {
  activeEngine: EngineType;
  setActiveEngine: (engine: EngineType) => void;
  onOpenOpsManual: () => void;
}

export const SideNavBar: React.FC<SideNavBarProps> = ({
  activeEngine,
  setActiveEngine,
  onOpenOpsManual,
}) => {
  const navItems: { id: EngineType; label: string; icon: string; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
    { id: 'tenants', label: 'Tenants', icon: 'hub', badge: '42' },
    { id: 'drift', label: 'Drift Engine', icon: 'dna', badge: '3' },
    { id: 'security', label: 'Security Engine', icon: 'shield_lock' },
    { id: 'health', label: 'Health Engine', icon: 'vital_signs' },
    { id: 'sla', label: 'SLA Engine', icon: 'verified' },
    { id: 'revenue', label: 'Revenue Analytics', icon: 'monitoring' },
  ];

  return (
    <aside className="fixed left-0 top-0 h-full w-64 z-40 border-r border-white/5 bg-[#0c0e11]/90 backdrop-blur-2xl flex flex-col pt-20 pb-8 px-4">
      <div className="mb-8 px-2">
        <h2 className="font-mono text-[11px] text-[#99cbff] tracking-[0.2em] uppercase mb-4 opacity-70 px-2 font-bold">
          M365 Core Engines
        </h2>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeEngine === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveEngine(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg font-mono text-[11px] uppercase tracking-wider transition-all duration-200 ${
                  isActive
                    ? 'bg-[#99cbff]/10 text-[#99cbff] border-l-2 border-[#99cbff] font-bold shadow-[inset_0_0_12px_rgba(153,203,255,0.08)]'
                    : 'text-[#bfc7d3] hover:text-[#e2e2e6] hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[22px]">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                      isActive ? 'bg-[#99cbff]/20 text-[#99cbff]' : 'bg-white/5 text-[#bfc7d3]/60'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto pt-4 border-t border-white/5 px-2">
        <button
          onClick={onOpenOpsManual}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[#bfc7d3]/70 hover:text-[#e2e2e6] hover:bg-white/5 transition-colors font-mono text-xs uppercase"
        >
          <span className="material-symbols-outlined text-[18px]">menu_book</span>
          <span>Ops Manual</span>
        </button>
      </div>
    </aside>
  );
};
