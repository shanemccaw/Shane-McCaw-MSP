import React from 'react';

interface TopNavBarProps {
  onOpenCommandPalette: () => void;
  onOpenNotifications: () => void;
  unreadNotificationsCount: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const TopNavBar: React.FC<TopNavBarProps> = ({
  onOpenCommandPalette,
  onOpenNotifications,
  unreadNotificationsCount,
  searchQuery,
  setSearchQuery,
}) => {
  return (
    <nav className="fixed top-0 w-full z-50 flex justify-between items-center h-16 px-8 border-b border-white/5 bg-[#111317]/90 backdrop-blur-xl">
      {/* Brand & Cluster Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="material-symbols-outlined text-[#99cbff] text-2xl group-hover:scale-105 transition-transform">
            terminal
          </span>
          <span className="font-semibold text-[22px] text-[#e2e2e6] tracking-tighter">
            Command<span className="text-[#99cbff]">Center</span>
          </span>
        </div>

        <div className="h-6 w-px bg-white/10 ml-2 hidden sm:block"></div>

        <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-[#1a1c1f] rounded-full border border-white/5 shadow-inner">
          <span className="status-dot text-[#a5eeff]"></span>
          <span className="font-mono text-[10px] text-[#bfc7d3] uppercase tracking-widest font-bold">
            Alpha Cluster: 12 Nodes Online
          </span>
        </div>
      </div>

      {/* Center Search & Actions */}
      <div className="flex items-center gap-6">
        {/* Admin Copilot Command Bar */}
        <div className="relative group cursor-pointer" onClick={onOpenCommandPalette}>
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <span className="material-symbols-outlined text-[#99cbff] text-[20px]">
              psychology
            </span>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ask Admin Copilot: 'Show all tenants with GDAP expiring in 7 days'..."
            className="bg-[#1a1c1f] border border-white/10 rounded-lg pl-11 pr-16 py-2.5 text-sm w-[280px] md:w-[420px] focus:ring-1 focus:ring-[#99cbff]/50 transition-all placeholder:text-[#bfc7d3]/30 font-sans glass text-[#e2e2e6]"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-[#bfc7d3]">
              ⌘
            </kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-[#bfc7d3]">
              K
            </kbd>
          </div>
        </div>

        {/* Notifications & Profile */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenNotifications}
            className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5 text-[#bfc7d3] hover:text-[#e2e2e6] transition-all"
            title="Notifications"
          >
            <span className="material-symbols-outlined text-[22px]">notifications</span>
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse"></span>
            )}
          </button>

          <div className="relative group">
            <div className="h-9 w-9 rounded-lg overflow-hidden border border-white/10 ml-2 cursor-pointer hover:border-[#99cbff]/50 transition-all">
              <img
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"
                alt="MSP Administrator profile"
                className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all"
              />
            </div>
            <div className="absolute right-0 mt-2 w-48 bg-[#1e2023] border border-white/10 rounded-lg shadow-xl p-2 hidden group-hover:block z-50">
              <div className="px-3 py-2 border-b border-white/5">
                <p className="text-xs font-bold text-[#e2e2e6]">Alex Rivera</p>
                <p className="text-[10px] font-mono text-[#bfc7d3]">Lead MSP Architect</p>
              </div>
              <button 
                onClick={onOpenCommandPalette}
                className="w-full text-left px-3 py-2 text-xs text-[#bfc7d3] hover:bg-white/5 rounded mt-1 flex items-center justify-between"
              >
                <span>Command Palette</span>
                <span className="text-[10px] font-mono opacity-50">⌘K</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};
