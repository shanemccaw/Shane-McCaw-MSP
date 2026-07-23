import React from 'react';
import { Search, Bell } from 'lucide-react';
import { MainTab } from '../types';

interface TopHeaderProps {
  activeMainTab: MainTab;
  onSelectMainTab: (tab: MainTab) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  unreadNotifications: boolean;
  onToggleNotificationPanel: () => void;
  onOpenProfileModal: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeMainTab,
  onSelectMainTab,
  searchQuery,
  onSearchChange,
  unreadNotifications,
  onToggleNotificationPanel,
  onOpenProfileModal,
}) => {
  const tabs: MainTab[] = ['General Settings', 'Dashboard', 'Analytics', 'Properties', 'Tenants'];

  return (
    <header className="h-16 border-b border-[#242628] bg-[#121414] px-6 flex items-center justify-between sticky top-0 z-10">
      {/* Navigation Tabs */}
      <nav className="flex items-center gap-6 overflow-x-auto no-scrollbar py-1">
        {tabs.map((tab) => {
          const isActive = activeMainTab === tab;
          return (
            <button
              key={tab}
              onClick={() => onSelectMainTab(tab)}
              className={`text-sm font-medium transition-colors whitespace-nowrap relative py-1.5 ${
                isActive
                  ? 'text-[#f1f3f5] font-semibold'
                  : 'text-[#8a919d] hover:text-[#d0d6e0]'
              }`}
            >
              {tab}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#a0c9ff] rounded-full" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right Controls: Search, Bell, Profile */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Search Bar */}
        <div className="relative w-56 lg:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search system..."
            className="w-full bg-[#181a1a] border border-[#2b2d2f] rounded-full py-1.5 pl-9 pr-3 text-xs text-[#e2e2e2] placeholder-[#6b7280] focus:outline-none focus:border-[#479ef5] focus:ring-1 focus:ring-[#479ef5] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8a919d] hover:text-white"
            >
              ×
            </button>
          )}
        </div>

        {/* Notification Bell */}
        <button
          onClick={onToggleNotificationPanel}
          className="relative p-2 rounded-full text-[#8a919d] hover:text-white hover:bg-[#1f2122] transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadNotifications && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#479ef5] rounded-full ring-2 ring-[#121414]" />
          )}
        </button>

        {/* User Profile Avatar */}
        <button
          onClick={onOpenProfileModal}
          className="relative rounded-full ring-2 ring-[#282a2b] hover:ring-[#479ef5] transition-all overflow-hidden"
          title="User Profile"
        >
          <img
            src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=120"
            alt="Sarah Nguyen"
            className="w-8 h-8 object-cover"
            referrerPolicy="no-referrer"
          />
        </button>
      </div>
    </header>
  );
};
