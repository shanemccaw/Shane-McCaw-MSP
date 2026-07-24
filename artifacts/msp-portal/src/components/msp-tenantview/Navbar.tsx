import React, { useState } from 'react';
import { TabType, Tenant, NotificationItem } from '@/components/msp-tenantview/types';

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  currentTenant: Tenant;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
  notifications: NotificationItem[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentTenant,
  tenants,
  onSelectTenant,
  notifications,
  searchQuery,
  setSearchQuery
}) => {
  const [showTenantDropdown, setShowTenantDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const unreadNotifications = notifications.filter(n => !n.read);

  return (
    <header className="bg-[#1e2023]/80 backdrop-blur-xl text-[#99cbff] font-sans w-full sticky top-0 z-50 border-b border-[#3f4751]/20 shadow-sm flex justify-between items-center px-6 md:px-8 h-16">
      <div className="flex items-center gap-6 lg:gap-8">
        <div 
          onClick={() => setActiveTab('tenant-intelligence')}
          className="font-bold text-2xl lg:text-[28px] text-[#99cbff] tracking-tighter cursor-pointer active:scale-95 flex items-center gap-2 select-none"
        >
          <span className="material-symbols-outlined text-2xl text-[#99cbff]" style={{ fontVariationSettings: "'FILL' 1" }}>
            shield_lock
          </span>
          <span>MSP Command Center</span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            onClick={() => setActiveTab('tenant-intelligence')}
            className={`pb-1 transition-all ${
              activeTab === 'tenant-intelligence'
                ? 'text-[#99cbff] font-bold border-b-2 border-[#99cbff]'
                : 'text-[#bfc7d3] hover:text-[#99cbff]'
            }`}
          >
            Tenant Intelligence
          </button>
          <button
            onClick={() => setActiveTab('multi-tenant')}
            className={`pb-1 transition-all ${
              activeTab === 'multi-tenant'
                ? 'text-[#99cbff] font-bold border-b-2 border-[#99cbff]'
                : 'text-[#bfc7d3] hover:text-[#99cbff]'
            }`}
          >
            Multi-Tenant View ({tenants.length})
          </button>
          <button
            onClick={() => setActiveTab('compliance-ops')}
            className={`pb-1 transition-all ${
              activeTab === 'compliance-ops'
                ? 'text-[#99cbff] font-bold border-b-2 border-[#99cbff]'
                : 'text-[#bfc7d3] hover:text-[#99cbff]'
            }`}
          >
            Compliance Ops
          </button>
        </nav>
      </div>

      <div className="flex items-center gap-3 lg:gap-4">
        {/* Tenant Selector Switcher Pill */}
        <div className="relative">
          <button
            onClick={() => setShowTenantDropdown(!showTenantDropdown)}
            className="bg-[#1a1c1f] hover:bg-[#282a2d] px-3.5 py-1.5 rounded-full border border-[#3f4751]/40 flex items-center gap-2 transition-colors text-xs font-mono"
            title="Switch Tenant"
          >
            <span className="w-2 h-2 rounded-full bg-[#00daf8] indicator-pulse"></span>
            <span className="text-[#e2e2e6] font-semibold">{currentTenant.name}</span>
            <span className="material-symbols-outlined text-sm text-[#bfc7d3]">unfold_more</span>
          </button>

          {showTenantDropdown && (
            <div className="absolute right-0 mt-2 w-64 bg-[#1e2023] border border-[#3f4751]/60 rounded-xl shadow-2xl py-2 z-50 glass-panel">
              <div className="px-3 py-1.5 text-[10px] font-mono text-[#bfc7d3] uppercase tracking-wider border-b border-[#3f4751]/20">
                Managed M365 Tenants
              </div>
              {tenants.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelectTenant(t);
                    setShowTenantDropdown(false);
                  }}
                  className={`w-full text-left px-3.5 py-2.5 hover:bg-[#282a2d] flex items-center justify-between transition-colors ${
                    t.id === currentTenant.id ? 'bg-[#3ba9ff]/10 text-[#99cbff] font-semibold' : 'text-[#e2e2e6]'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-xs">{t.name}</span>
                    <span className="text-[10px] font-mono text-[#bfc7d3]/70">{t.directoryId}</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    t.healthScore >= 90 ? 'bg-[#99cbff]/20 text-[#99cbff]' : 'bg-[#ffb4ab]/20 text-[#ffb4ab]'
                  }`}>
                    {t.healthScore}/100
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Global Search */}
        <div className="relative hidden sm:block">
          <div className="bg-[#1a1c1f] px-3.5 py-1.5 rounded-full border border-[#3f4751]/30 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#bfc7d3] text-sm">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Tenant Resources..."
              className="bg-transparent border-none outline-none text-xs w-36 lg:w-48 text-[#e2e2e6] placeholder:text-[#bfc7d3]/50"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[#bfc7d3] text-xs hover:text-white">×</button>
            )}
          </div>
        </div>

        {/* Notification Bell with Badge & Menu */}
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[#333538] transition-all relative text-[#e2e2e6]"
            title="Notifications"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
            {unreadNotifications.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#ffb4ab] rounded-full ring-2 ring-[#111317]"></span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#1e2023] border border-[#3f4751]/60 rounded-xl shadow-2xl p-4 z-50 glass-panel">
              <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#3f4751]/20">
                <span className="text-xs font-mono font-bold text-[#e2e2e6] uppercase tracking-wider">MSP Alerts & Telemetry</span>
                <span className="text-[10px] font-mono bg-[#3ba9ff]/20 text-[#99cbff] px-2 py-0.5 rounded">{notifications.length} Active</span>
              </div>
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {notifications.map(n => (
                  <div key={n.id} className={`p-2.5 rounded-lg border text-xs ${
                    n.severity === 'critical' ? 'bg-[#93000a]/15 border-[#ffb4ab]/30' : 'bg-[#1a1c1f] border-[#3f4751]/30'
                  }`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono font-bold text-[10px] text-[#99cbff] uppercase">{n.tenantName}</span>
                      <span className="text-[10px] text-[#bfc7d3]/70 font-mono">{n.timestamp}</span>
                    </div>
                    <div className="font-semibold text-[#e2e2e6] mb-0.5">{n.title}</div>
                    <p className="text-[11px] text-[#bfc7d3] leading-relaxed">{n.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Settings button */}
        <button 
          onClick={() => setActiveTab('compliance-ops')}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[#333538] transition-all text-[#e2e2e6]"
          title="MSP Control Settings"
        >
          <span className="material-symbols-outlined text-xl">settings</span>
        </button>

        {/* User Profile Avatar */}
        <div className="relative">
          <button 
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="w-8 h-8 rounded-full bg-[#cfe5ff] overflow-hidden border border-[#99cbff]/30 cursor-pointer hover:ring-2 hover:ring-[#99cbff]/50 transition-all"
          >
            <img 
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120" 
              alt="Admin User" 
              className="w-full h-full object-cover" 
            />
          </button>
          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-[#1e2023] border border-[#3f4751]/60 rounded-xl shadow-2xl py-2 z-50 text-xs">
              <div className="px-3 py-2 border-b border-[#3f4751]/20">
                <div className="font-semibold text-[#e2e2e6]">Global MSP Admin</div>
                <div className="text-[10px] text-[#bfc7d3] font-mono">admin@mspcommand.io</div>
              </div>
              <a href="#profile" className="block px-3 py-2 text-[#bfc7d3] hover:bg-[#282a2d] hover:text-white">Admin Profile</a>
              <a href="#audit" className="block px-3 py-2 text-[#bfc7d3] hover:bg-[#282a2d] hover:text-white">Audit Logs</a>
              <div className="border-t border-[#3f4751]/20 mt-1 pt-1">
                <span className="block px-3 py-1 text-[10px] text-[#00daf8] font-mono">Session: Encrypted TLS 1.3</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
