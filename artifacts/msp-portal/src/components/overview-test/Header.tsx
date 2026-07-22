import React, { useState } from 'react';
import {
  ShieldCheck,
  Bell,
  Settings,
  RefreshCw,
  ChevronDown,
  Building2,
  CheckCircle2,
  X,
} from 'lucide-react';
import { TenantConfig } from './types';

interface HeaderProps {
  tenantConfig: TenantConfig;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRefreshScan: () => void;
  isScanning: boolean;
  addToast: (msg: string, type?: 'success' | 'info') => void;
}

export const Header: React.FC<HeaderProps> = ({
  tenantConfig,
  activeTab,
  setActiveTab,
  onRefreshScan,
  isScanning,
  addToast,
}) => {
  const [showTenantMenu, setShowTenantMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const tenants = [
    { name: 'Contoso Enterprise Global', domain: 'contoso.onmicrosoft.com', status: 'Primary' },
    { name: 'Fabrikam Health Sub', domain: 'fabrikam.onmicrosoft.com', status: 'Secondary' },
    { name: 'Northwind Traders M365', domain: 'northwind.onmicrosoft.com', status: 'Secondary' },
  ];

  const notifications = [
    { id: 1, title: 'New Admin MFA Alert', time: '10m ago', text: '4 admins added without MFA enabled.', unread: true },
    { id: 2, title: 'Drift Detected on iOS', time: '1h ago', timeText: '12 devices missing iOS update 17.5.1', unread: true },
    { id: 3, title: 'Automated Scan Complete', time: '3h ago', text: 'Score updated to 92%', unread: false },
  ];

  const navItems = ['Overview', 'Portfolio', 'Analytics', 'Compliance'];

  return (
    <header className="sticky top-0 z-40 w-full bg-[#1c2025]/90 backdrop-blur-md border-b border-white/10 shadow-sm transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Left: Brand logo & Navigation */}
          <div className="flex items-center gap-6 lg:gap-10">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('Overview')}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#479ef5] to-[#2563eb] flex items-center justify-center text-white shadow-md shadow-[#479ef5]/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
                  Tenant Intelligence
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#479ef5]/10 text-[#479ef5] rounded border border-[#479ef5]/20 hidden sm:inline-block">
                    PRO
                  </span>
                </span>
              </div>
            </div>

            {/* Tenant Selector Dropdown */}
            <div className="relative hidden xl:block">
              <button
                onClick={() => setShowTenantMenu(!showTenantMenu)}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#242830] hover:bg-[#2c313c] border border-white/10 rounded-lg text-xs text-slate-300 transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-[#479ef5]" />
                <span className="font-medium text-white truncate max-w-[160px]">{tenantConfig.name}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showTenantMenu && (
                <div className="absolute left-0 mt-2 w-64 bg-[#1c2025] border border-white/10 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Switch Active Tenant
                  </div>
                  {tenants.map((t, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        addToast(`Switched tenant to ${t.name}`, 'info');
                        setShowTenantMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-[#272a30] flex items-center justify-between text-slate-200 transition-colors"
                    >
                      <div>
                        <div className="font-medium text-white">{t.name}</div>
                        <div className="text-[11px] text-slate-400">{t.domain}</div>
                      </div>
                      {idx === 0 && <CheckCircle2 className="w-4 h-4 text-[#479ef5]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Primary Nav Links */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = activeTab === item;
                return (
                  <button
                    key={item}
                    onClick={() => setActiveTab(item)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-[#479ef5]/15 text-[#479ef5] border border-[#479ef5]/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right: Actions, Scan button, Notifications, User */}
          <div className="flex items-center gap-3 sm:gap-4">
            
            {/* Live Scan Trigger */}
            <button
              onClick={onRefreshScan}
              disabled={isScanning}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                isScanning
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
                  : 'bg-[#242830] hover:bg-[#2c313c] border-white/10 text-slate-200 hover:text-white'
              }`}
              title="Trigger instant tenant security scan"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-amber-400' : 'text-[#479ef5]'}`} />
              <span className="hidden sm:inline">
                {isScanning ? 'Scanning Tenant...' : 'Run Scan'}
              </span>
            </button>

            {/* Notifications Menu */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5 relative transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-[#1c2025] border border-white/10 rounded-2xl shadow-2xl py-3 z-50">
                  <div className="px-4 pb-2 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Security Alerts</span>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
                    {notifications.map((n) => (
                      <div key={n.id} className="p-3 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className="flex items-center justify-between text-xs font-semibold text-white">
                          <span>{n.title}</span>
                          <span className="text-[10px] text-slate-400">{n.time}</span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1">{n.text || n.timeText}</p>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 pt-2 border-t border-white/10 text-center">
                    <button
                      onClick={() => {
                        addToast('Notifications marked as read', 'info');
                        setShowNotifications(false);
                      }}
                      className="text-[11px] text-[#479ef5] hover:underline"
                    >
                      Mark all as read
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Settings Trigger */}
            <button
              onClick={() => {
                setShowSettings(true);
                addToast('Opened Tenant Configuration Settings', 'info');
              }}
              className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Profile Avatar */}
            <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuApZ35jT2FdT6fC7AEkvvKYyvmRI6nQBMIH33Vy0p4PsBp_lwRVmNt2BX7Hxx-EZQMAjItoCI7xYxZJU9FaDPpqCE6HqaGWKQnJE7Hgfp9BWVfLj2hRBXbzLUWXLkhG8myasBCmDEeObOvCF5i3Qa5fI-d4B9SmimqLJPUrKTFszVuwR4oF8BY9xfBHv6z5Z6ogEOKDH2t7tUj6PMYR-G18z3YEApw0sp22UzsgbRIY91irWK7Ac-Fj"
                alt="User Profile"
                className="w-8 h-8 rounded-full border border-white/20 object-cover hover:ring-2 hover:ring-[#479ef5] transition-all cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Settings Drawer / Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1c2025] border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#479ef5]" />
                Tenant Scanner Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 py-4 text-xs text-slate-300">
              <div>
                <label className="block font-semibold mb-1 text-slate-200">Active Tenant Context</label>
                <input
                  type="text"
                  readOnly
                  value={tenantConfig.name}
                  className="w-full bg-[#101419] border border-white/10 rounded-lg px-3 py-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1 text-slate-200">Microsoft Graph API Status</label>
                <div className="flex items-center gap-2 text-emerald-400 font-mono bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Authenticated - Scope: Directory.ReadWrite.All, AuditLog.Read.All
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1 text-slate-200">Automated Scan Frequency</label>
                <select className="w-full bg-[#101419] border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-[#479ef5]">
                  <option>Every 15 Minutes (Real-Time)</option>
                  <option>Hourly Baseline</option>
                  <option>Daily Audit at 00:00 UTC</option>
                </select>
              </div>
            </div>
            <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-lg bg-[#242830] hover:bg-[#2c313c] text-xs font-semibold text-slate-300"
              >
                Close
              </button>
              <button
                onClick={() => {
                  addToast('Settings updated successfully', 'success');
                  setShowSettings(false);
                }}
                className="px-4 py-2 rounded-lg bg-[#479ef5] hover:bg-[#3b82f6] text-xs font-bold text-slate-950 shadow-md shadow-[#479ef5]/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
