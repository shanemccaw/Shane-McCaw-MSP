import React from 'react';
import { NavSection } from '../types';

interface SidebarProps {
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeSection, setActiveSection }) => {
  const navItems: { id: NavSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'OVERVIEW', icon: 'dashboard' },
    { id: 'security', label: 'SECURITY', icon: 'security' },
    { id: 'compliance', label: 'COMPLIANCE', icon: 'description' },
    { id: 'users', label: 'USERS', icon: 'group' },
    { id: 'billing', label: 'BILLING', icon: 'receipt_long' },
  ];

  return (
    <aside className="h-[calc(100vh-64px)] sticky top-16 left-0 w-64 bg-[#111317]/90 backdrop-blur-xl border-r border-[#3f4751]/20 flex flex-col py-6 space-y-2 shrink-0 hidden md:flex">
      {/* Tenant Control Header */}
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#99cbff]/20 flex items-center justify-center border border-[#99cbff]/40">
            <span className="material-symbols-outlined text-[#99cbff]" style={{ fontVariationSettings: "'FILL' 1" }}>
              cloud_done
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-lg text-[#e2e2e6] leading-tight">Tenant Control</h3>
            <p className="text-[10px] text-[#bfc7d3] uppercase tracking-widest font-mono">M365 GLOBAL ADMIN</p>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-4 px-6 py-3.5 transition-all text-left ${
                isActive
                  ? 'bg-[#3ba9ff]/20 text-[#99cbff] border-l-4 border-[#99cbff] font-semibold'
                  : 'text-[#bfc7d3] hover:bg-[#37393d]/50 hover:text-[#e2e2e6]'
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              <span className="font-mono text-xs tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer System Badge in Sidebar */}
      <div className="px-6 pt-4 border-t border-[#3f4751]/20">
        <div className="bg-[#1a1c1f] rounded-lg p-3 border border-[#3f4751]/30">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#00daf8] indicator-pulse"></span>
            <span className="text-[11px] font-mono font-bold text-[#e2e2e6]">PIM Active</span>
          </div>
          <p className="text-[10px] text-[#bfc7d3]/80 leading-snug">
            Elevated privileges expire in 3h 42m
          </p>
        </div>
      </div>
    </aside>
  );
};
