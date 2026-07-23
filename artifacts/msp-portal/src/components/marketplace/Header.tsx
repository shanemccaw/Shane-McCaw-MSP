import React from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { CategoryType, TopTabType } from '../types';

interface HeaderProps {
  topTab: TopTabType;
  setTopTab: (tab: TopTabType) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onCloseModal: () => void;
  onSelectCategory: (category: CategoryType) => void;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (cycle: 'monthly' | 'yearly') => void;
}

export const Header: React.FC<HeaderProps> = ({
  topTab,
  setTopTab,
  searchQuery,
  setSearchQuery,
  onCloseModal,
  onSelectCategory,
  billingCycle,
  setBillingCycle,
}) => {
  const tabs: TopTabType[] = ['Intelligence', 'Security', 'Automation'];

  const handleTabClick = (tab: TopTabType) => {
    setTopTab(tab);
    onSelectCategory(tab as CategoryType);
  };

  return (
    <header className="bg-[#282a2b] border-b border-white/5 flex justify-between items-center w-full px-4 md:px-6 py-3.5 shadow-sm rounded-t-xl shrink-0 z-10">
      {/* Brand Title */}
      <div className="flex items-center gap-3">
        <span className="font-headline text-xl md:text-2xl font-bold text-[#a0c9ff] tracking-tight">
          Boutique Marketplace
        </span>
      </div>

      {/* Center Navigation Tabs (Desktop) */}
      <div className="hidden md:flex items-center gap-6 lg:gap-8">
        {tabs.map((tab) => {
          const isActive = topTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`font-medium text-sm transition-all cursor-pointer relative py-1 ${
                isActive
                  ? 'text-[#a0c9ff] font-semibold'
                  : 'text-[#c0c7d3] hover:text-[#a0c9ff]'
              }`}
            >
              {tab}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#a0c9ff] rounded-full shadow-[0_0_8px_rgba(160,201,255,0.6)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right Tools (Search, Billing Toggle & Close) */}
      <div className="flex items-center gap-3">
        {/* Search Input */}
        <div className="relative group hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c0c7d3] w-4 h-4 transition-colors group-focus-within:text-[#a0c9ff]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search marketplace..."
            className="bg-[#121414] border border-[#404752] rounded-lg pl-9 pr-3 py-1.5 text-xs md:text-sm text-[#e2e2e2] w-48 lg:w-60 focus:ring-2 focus:ring-[#a0c9ff] focus:border-transparent focus:outline-none transition-all placeholder:text-[#8a919d]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#e2e2e2]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Billing Cycle Pill */}
        <div className="hidden lg:flex items-center bg-[#121414] p-0.5 rounded-lg border border-[#404752] text-xs font-mono-code">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              billingCycle === 'monthly'
                ? 'bg-[#479ef5] text-[#001c37] font-semibold shadow-sm'
                : 'text-[#c0c7d3] hover:text-[#e2e2e2]'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
              billingCycle === 'yearly'
                ? 'bg-[#479ef5] text-[#001c37] font-semibold shadow-sm'
                : 'text-[#c0c7d3] hover:text-[#e2e2e2]'
            }`}
          >
            Yearly
            <span className="text-[10px] px-1 py-0.2 bg-[#dab9ff] text-[#421871] rounded-full font-bold">
              -20%
            </span>
          </button>
        </div>

        {/* Close Modal Button */}
        <button
          onClick={onCloseModal}
          title="Minimize / Close Marketplace"
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#333535] active:scale-95 transition-all text-[#c0c7d3] hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
