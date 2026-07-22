import React, { useState } from 'react';
import { Search, Bell, Settings, ShieldAlert, CheckCircle2, User, ChevronRight, X } from 'lucide-react';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  unreadCount: number;
}

export const Header: React.FC<HeaderProps> = ({ searchQuery, onSearchChange, unreadCount }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-[#121414]/80 backdrop-blur-md border-b border-[#404752]/20 shadow-sm px-6 py-2 flex justify-between items-center max-w-[1440px] mx-auto w-full">
      {/* Brand & App Title */}
      <div className="flex items-center gap-2">
        <span className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-bold text-[#a0c9ff] tracking-tight">
          Compliance Intelligence
        </span>
      </div>

      {/* Right Navigation controls */}
      <div className="flex items-center gap-4">
        {/* Search input */}
        <div className="hidden md:flex items-center bg-[#1a1c1c] px-3 py-1 border border-[#404752]/30 rounded-lg focus-within:border-[#479ef5] transition-colors">
          <Search className="w-4 h-4 text-[#c0c7d3] mr-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search insights..."
            className="bg-transparent border-none focus:outline-none focus:ring-0 text-[12px] font-['JetBrains_Mono'] text-[#e2e2e2] placeholder-[#c0c7d3]/40 w-48"
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="text-[#c0c7d3] hover:text-white ml-1">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action Icons */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowSettings(false);
                setShowProfile(false);
              }}
              className="p-2 text-[#c0c7d3] hover:text-[#a0c9ff] transition-colors rounded-lg hover:bg-[#242424] relative"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse" />
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-[#242424] border border-[#404752]/40 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between items-center pb-3 border-b border-[#404752]/30">
                  <h4 className="font-['Hanken_Grotesk'] font-bold text-sm text-[#e2e2e2]">Audit Notifications</h4>
                  <span className="text-[10px] font-['JetBrains_Mono'] text-[#a0c9ff] bg-[#a0c9ff]/10 px-2 py-0.5 rounded">
                    {unreadCount} Active
                  </span>
                </div>
                <div className="space-y-3 mt-3 max-h-64 overflow-y-auto pr-1">
                  <div className="p-2.5 rounded-lg bg-[#1a1c1c] border border-[#ffb4ab]/20 flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-[#ffb4ab] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[#e2e2e2]">High-risk gap in Teams</p>
                      <p className="text-[11px] text-[#c0c7d3] mt-0.5">Retention tag missing on 18 private channels.</p>
                      <span className="text-[10px] text-[#c0c7d3]/60 font-mono mt-1 block">12 mins ago</span>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#1a1c1c] border border-[#404752]/20 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#10b981] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[#e2e2e2]">Exchange Journal Rule Verified</p>
                      <p className="text-[11px] text-[#c0c7d3] mt-0.5">Auto-archive sync completed with 0 errors.</p>
                      <span className="text-[10px] text-[#c0c7d3]/60 font-mono mt-1 block">1 hour ago</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => {
                setShowSettings(!showSettings);
                setShowNotifications(false);
                setShowProfile(false);
              }}
              className="p-2 text-[#c0c7d3] hover:text-[#a0c9ff] transition-colors rounded-lg hover:bg-[#242424]"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            {showSettings && (
              <div className="absolute right-0 mt-2 w-72 bg-[#242424] border border-[#404752]/40 rounded-xl shadow-2xl p-4 z-50">
                <h4 className="font-['Hanken_Grotesk'] font-bold text-sm text-[#e2e2e2] pb-2 border-b border-[#404752]/30">
                  Compliance Settings
                </h4>
                <div className="space-y-2 mt-3 text-xs text-[#c0c7d3]">
                  <div className="flex justify-between items-center p-2 rounded hover:bg-[#1a1c1c] cursor-pointer">
                    <span>Audit Sync Interval</span>
                    <span className="font-mono text-[#a0c9ff]">Every 5m</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded hover:bg-[#1a1c1c] cursor-pointer">
                    <span>DLP Enforce Mode</span>
                    <span className="font-mono text-[#10b981]">Active</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded hover:bg-[#1a1c1c] cursor-pointer">
                    <span>Global Retention Lock</span>
                    <span className="font-mono text-[#f59e0b]">7-Year Standard</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Avatar */}
          <div className="relative ml-1">
            <button
              onClick={() => {
                setShowProfile(!showProfile);
                setShowNotifications(false);
                setShowSettings(false);
              }}
              className="w-8 h-8 rounded-full bg-[#a0c9ff]/20 border border-[#a0c9ff]/30 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-[#479ef5]/50 transition-all cursor-pointer"
            >
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcBwm6eTBOxSpPLvu8vn9Q2Kfv_4mRCqYyW7lDUtNevMS3IjyjT9khcwtKN7i7t9yLw_TTYeQdsHWvFNJ6nFrPIMK0oRuGJ0gF5ySWz6JjpUCOdUxQ68HFQUuOtf4XzGpo0wW1vp1npC6Y2mgklTT3HOX7EE38HC99n7FKK1Ma2ySafsM4xscigW0QSbnTwv2YY8C9ITren5u_ZldNVR26rWRi5fw2p7giae1KC9zam5eCLpoZtCSL"
                alt="Corporate Executive Avatar"
                className="w-full h-full object-cover"
              />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-[#242424] border border-[#404752]/40 rounded-xl shadow-2xl p-4 z-50">
                <div className="flex items-center gap-3 pb-3 border-b border-[#404752]/30">
                  <div className="w-10 h-10 rounded-full bg-[#a0c9ff]/20 overflow-hidden border border-[#a0c9ff]/30 shrink-0">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcBwm6eTBOxSpPLvu8vn9Q2Kfv_4mRCqYyW7lDUtNevMS3IjyjT9khcwtKN7i7t9yLw_TTYeQdsHWvFNJ6nFrPIMK0oRuGJ0gF5ySWz6JjpUCOdUxQ68HFQUuOtf4XzGpo0wW1vp1npC6Y2mgklTT3HOX7EE38HC99n7FKK1Ma2ySafsM4xscigW0QSbnTwv2YY8C9ITren5u_ZldNVR26rWRi5fw2p7giae1KC9zam5eCLpoZtCSL"
                      alt="User"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-[#e2e2e2]">Global Audit Lead</h5>
                    <p className="text-[11px] text-[#c0c7d3]">Obsidian Metric Security</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-xs text-[#c0c7d3]">
                  <div className="p-2 rounded hover:bg-[#1a1c1c] flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-2"><User className="w-3.5 h-3.5" /> User Credentials</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                  <div className="p-2 rounded hover:bg-[#1a1c1c] flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5" /> Audit History Logs</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
