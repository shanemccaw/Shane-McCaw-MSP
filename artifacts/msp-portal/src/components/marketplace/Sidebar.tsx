import React from 'react';
import {
  LayoutGrid,
  Brain,
  Shield,
  Bot,
  BadgeCheck,
  Wallet,
  PlusCircle,
} from 'lucide-react';
import { CategoryType } from '../types';

interface SidebarProps {
  activeCategory: CategoryType;
  onSelectCategory: (category: CategoryType) => void;
  walletBalance: number;
  totalMonthlyCost: number;
  onAddFunds?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeCategory,
  onSelectCategory,
  walletBalance,
  totalMonthlyCost,
  onAddFunds,
}) => {
  const categories = [
    { id: 'All Products', label: 'All Products', icon: LayoutGrid },
    { id: 'Intelligence', label: 'Intelligence', icon: Brain },
    { id: 'Security', label: 'Security', icon: Shield },
    { id: 'Automation', label: 'Automation', icon: Bot },
    { id: 'Compliance', label: 'Compliance', icon: BadgeCheck },
  ] as const;

  const remainingWallet = walletBalance - totalMonthlyCost;

  return (
    <aside className="hidden lg:flex flex-col h-full w-64 bg-[#121414] border-r border-white/5 p-4 gap-2 shrink-0 select-none">
      {/* Category Header */}
      <div className="mb-4 px-1 pt-1">
        <h2 className="font-headline text-lg font-semibold text-[#e2e2e2] tracking-wide">
          Categories
        </h2>
        <p className="text-[#c0c7d3] text-xs opacity-60 font-body">
          Curated Solutions
        </p>
      </div>

      {/* Category Links */}
      <nav className="flex flex-col gap-1.5 flex-1">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id as CategoryType)}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-200 text-sm font-medium w-full text-left group cursor-pointer ${
                isActive
                  ? 'bg-[#5a3289] text-[#cda3ff] shadow-sm font-semibold'
                  : 'text-[#c0c7d3] hover:bg-[#333535] hover:text-[#a0c9ff]'
              }`}
            >
              <Icon
                className={`w-5 h-5 transition-colors ${
                  isActive
                    ? 'text-[#cda3ff]'
                    : 'text-[#c0c7d3] group-hover:text-[#a0c9ff]'
                }`}
              />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Wallet Balance Card */}
      <div className="mt-auto pt-4 border-t border-white/5">
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#1e2020] hover:bg-[#282a2b] border border-white/5 cursor-pointer transition-all group">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#479ef5] flex items-center justify-center text-[#003259] shadow-inner group-hover:scale-105 transition-transform">
              <Wallet className="w-4 h-4 text-[#001c37]" />
            </div>
            <div>
              <p className="font-mono-code text-[10px] uppercase tracking-wider text-[#c0c7d3]">
                Wallet Balance
              </p>
              <p className="font-headline text-sm font-bold text-[#e2e2e2]">
                ${remainingWallet.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {onAddFunds && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddFunds();
              }}
              title="Add funds to wallet"
              className="text-[#8a919d] hover:text-[#a0c9ff] p-1 rounded-md transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
