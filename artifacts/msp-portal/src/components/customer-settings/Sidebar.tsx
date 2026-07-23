import React from 'react';
import { Users, Shield, Bell, CreditCard, HelpCircle, LogOut, Zap } from 'lucide-react';
import { SidebarTab } from '../types';

interface SidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  onOpenUpgrade: () => void;
  onOpenSupport: () => void;
  onSignOut: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenUpgrade,
  onOpenSupport,
  onSignOut,
}) => {
  const navItems: { id: SidebarTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'Team', label: 'Team', icon: Users },
    { id: 'Security', label: 'Security', icon: Shield },
    { id: 'Notifications', label: 'Notifications', icon: Bell },
    { id: 'Data & Billing', label: 'Data & Billing', icon: CreditCard },
  ];

  return (
    <aside className="w-64 shrink-0 bg-[#121414] border-r border-[#242628] flex flex-col justify-between h-screen sticky top-0 p-5 select-none z-20">
      {/* Top Branding & Navigation */}
      <div className="flex flex-col gap-8">
        {/* Brand Title */}
        <div className="pt-1">
          <h1 className="font-display font-bold text-lg text-[#f1f3f5] tracking-tight leading-tight">
            Tenant Intelligence
          </h1>
          <p className="font-mono text-[10px] font-semibold tracking-widest text-[#8a919d] uppercase mt-1">
            SYSTEM SETTINGS
          </p>
        </div>

        {/* Sidebar Nav List */}
        <nav className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                  isActive
                    ? 'bg-[#5a3289] text-white shadow-md shadow-[#5a3289]/20'
                    : 'text-[#9ea6b5] hover:text-white hover:bg-[#1a1c1d]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#8a919d]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Action Footer */}
      <div className="flex flex-col gap-3 pt-6 border-t border-[#202223]">
        {/* Upgrade Plan Button */}
        <button
          onClick={onOpenUpgrade}
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-md bg-[#3881e6] hover:bg-[#479ef5] text-white font-medium text-sm transition-all shadow-sm active:scale-[0.98]"
        >
          <Zap className="w-4 h-4" />
          <span>Upgrade Plan</span>
        </button>

        {/* Support & Sign Out */}
        <div className="flex flex-col gap-1 mt-1">
          <button
            onClick={onOpenSupport}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[#9ea6b5] hover:text-white hover:bg-[#1a1c1d] transition-colors text-left"
          >
            <HelpCircle className="w-4 h-4 text-[#8a919d]" />
            <span>Support</span>
          </button>

          <button
            onClick={onSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[#9ea6b5] hover:text-red-400 hover:bg-[#201718] transition-colors text-left"
          >
            <LogOut className="w-4 h-4 text-[#8a919d]" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
