// @ts-nocheck
import React, { useState } from 'react';
import { Search, Bell, Grid, User, ShieldCheck, ChevronDown, CheckCircle2, AlertTriangle, Layers, Menu } from 'lucide-react';
import { Tenant } from '../types';

interface NavbarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTenant: Tenant | null;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant | null) => void;
  activeCriticalAlertsCount: number;
  onOpenAdminTools?: () => void;
  onToggleMobileSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  setSearchQuery,
  selectedTenant,
  tenants,
  onSelectTenant,
  activeCriticalAlertsCount,
  onOpenAdminTools,
  onToggleMobileSidebar,
}) => {
  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);

  return (
    <header className="bg-[#1c2026] border-b border-[#404752] flex justify-between items-center px-2.5 sm:px-4 h-11 shrink-0 w-full z-40 text-[#e0e2ea]">
      {/* Left Title & Global Indicator */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile Hamburger Menu Toggle Button */}
        {onToggleMobileSidebar && (
          <button
            onClick={onToggleMobileSidebar}
            title="Toggle Navigation Menu"
            className="lg:hidden text-[#a3c9ff] hover:text-white p-1.5 rounded hover:bg-[#272a30] transition-colors flex items-center justify-center shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center text-[#a3c9ff] shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="font-semibold text-xs sm:text-sm md:text-base text-[#e0e2ea] tracking-tight truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">
            M365 MSP Global Console
          </span>
        </div>

        {/* Selected tenant pill indicator if active */}
        {selectedTenant ? (
          <div className="hidden md:flex items-center gap-2 bg-[#181c22] border border-[#0078d4]/60 px-2.5 py-0.5 rounded text-xs">
            <span className="text-[#8a919e]">Active Focus:</span>
            <span className="font-semibold text-[#a3c9ff]">{selectedTenant.name}</span>
            <button
              onClick={() => onSelectTenant(null)}
              className="text-[#8a919e] hover:text-[#e0e2ea] ml-1 text-xs underline"
            >
              (Global)
            </button>
          </div>
        ) : (
          <div className="hidden lg:flex items-center gap-2 bg-[#052e16] border border-[#166534] px-2 py-0.5 rounded text-[11px] text-[#4ade80] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse"></span>
            Global Health: All 142 Tenants Connected
          </div>
        )}
      </div>

      {/* Right Tools & Tenant Switcher */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {/* Search input */}
        <div className="relative w-28 xs:w-36 sm:w-56 md:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e] w-3.5 h-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tenants..."
            className="bg-[#0b0e14] border border-[#404752] rounded pl-8 pr-2 sm:pr-3 py-1 text-xs focus:outline-none focus:border-[#0078d4] text-[#e0e2ea] placeholder-[#8a919e] w-full text-[11px] sm:text-xs"
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-2.5 text-[#c0c7d4]">
          {/* Notifications Bell */}
          <button
            title="Active Security Alerts"
            className="hover:text-[#a3c9ff] transition-colors relative p-1 rounded hover:bg-[#272a30]"
          >
            <Bell className="w-4 h-4" />
            {activeCriticalAlertsCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#ffb4ab] rounded-full ring-2 ring-[#1c2026]" />
            )}
          </button>

          {/* Grid / Apps */}
          <button
            onClick={onOpenAdminTools}
            title="Open M365 Admin Tools Suite"
            className="hover:text-[#a3c9ff] transition-colors p-1.5 rounded hover:bg-[#272a30] relative group flex items-center gap-1 text-xs"
          >
            <Grid className="w-4 h-4 text-[#a3c9ff]" />
            <span className="hidden xl:inline font-medium text-[#e0e2ea]">M365 Admin Tools</span>
          </button>

          {/* User Account */}
          <button title="Logged in as Super Admin" className="hidden sm:inline-flex hover:text-[#a3c9ff] transition-colors p-1 rounded hover:bg-[#272a30]">
            <User className="w-4 h-4" />
          </button>

          {/* Tenant Switcher Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setIsTenantMenuOpen(!isTenantMenuOpen)}
              className="bg-[#0078d4] text-white px-2 sm:px-3 py-1 rounded text-xs hover:bg-[#0060ab] transition-colors font-semibold flex items-center gap-1 shadow-sm"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="max-w-[70px] sm:max-w-none truncate">{selectedTenant ? selectedTenant.code : 'Tenant'}</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {/* Tenant Selection Dropdown Modal */}
            {isTenantMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsTenantMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-72 bg-[#1c2026] border border-[#404752] rounded shadow-2xl py-1 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-[#404752] bg-[#181c22] flex justify-between items-center">
                    <span className="font-semibold text-[#e0e2ea]">Select Active Tenant Scope</span>
                    <span className="text-[10px] text-[#8a919e]">{tenants.length} tenants</span>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-[#404752]/40">
                    <button
                      onClick={() => {
                        onSelectTenant(null);
                        setIsTenantMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-[#272a30] transition-colors flex items-center justify-between ${
                        selectedTenant === null ? 'bg-[#3a4a5f]/40 font-semibold text-[#a3c9ff]' : 'text-[#e0e2ea]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-[#0078d4]/30 text-[#a3c9ff] flex items-center justify-center text-[10px] font-bold">
                          ALL
                        </div>
                        <div>
                          <div>All Managed Tenants (Global Scope)</div>
                          <div className="text-[10px] text-[#8a919e]">Unified MSP Dashboard</div>
                        </div>
                      </div>
                      {selectedTenant === null && <CheckCircle2 className="w-3.5 h-3.5 text-[#a3c9ff]" />}
                    </button>

                    {tenants.map((tenant) => (
                      <button
                        key={tenant.id}
                        onClick={() => {
                          onSelectTenant(tenant);
                          setIsTenantMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-[#272a30] transition-colors flex items-center justify-between ${
                          selectedTenant?.id === tenant.id ? 'bg-[#3a4a5f]/40 font-semibold text-[#a3c9ff]' : 'text-[#e0e2ea]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-[#272a30] border border-[#404752] flex items-center justify-center font-bold text-[10px] text-[#e0e2ea]">
                            {tenant.code}
                          </div>
                          <div>
                            <div className="font-medium text-[#e0e2ea]">{tenant.name}</div>
                            <div className="text-[10px] text-[#8a919e] font-mono">{tenant.primaryDomain}</div>
                          </div>
                        </div>
                        {tenant.activeAlertsCount > 0 ? (
                          <span className="flex items-center gap-1 text-[10px] text-[#ffb4ab] font-bold">
                            <AlertTriangle className="w-3 h-3" /> {tenant.activeAlertsCount}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#4ade80]">Score: {tenant.secureScore}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

