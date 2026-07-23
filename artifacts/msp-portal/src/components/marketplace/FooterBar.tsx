import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { TEAM_MEMBERS } from '../data/products';

interface FooterBarProps {
  selectedCount: number;
  totalMonthlyCost: number;
  onCancel: () => void;
  onViewSubscriptions: () => void;
}

export const FooterBar: React.FC<FooterBarProps> = ({
  selectedCount,
  totalMonthlyCost,
  onCancel,
  onViewSubscriptions,
}) => {
  return (
    <footer className="bg-[#333535]/50 border-t border-white/5 px-4 md:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 rounded-b-xl z-10">
      {/* Team Avatars & Usage Indicator */}
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {TEAM_MEMBERS.slice(0, 2).map((member) => (
            <div
              key={member.id}
              title={`${member.name} (${member.role})`}
              className={`w-8 h-8 rounded-full border-2 border-[#1e2020] ${member.bgColor} flex items-center justify-center text-[10px] font-bold ${member.textColor} shadow-sm hover:z-10 transition-transform hover:scale-110 cursor-pointer`}
            >
              {member.initials}
            </div>
          ))}
          <div
            title="3 other team members"
            className="w-8 h-8 rounded-full border-2 border-[#1e2020] bg-[#333535] flex items-center justify-center text-[10px] font-bold text-[#e2e2e2] shadow-sm cursor-pointer"
          >
            +3
          </div>
        </div>
        <p className="text-xs md:text-sm text-[#c0c7d3] font-body">
          <span className="font-semibold text-[#e2e2e2]">5 teams</span> using these solutions
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 ml-auto">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs md:text-sm text-[#c0c7d3] hover:text-[#e2e2e2] transition-colors cursor-pointer rounded-lg hover:bg-white/5"
        >
          Cancel
        </button>

        <button
          onClick={onViewSubscriptions}
          className={`px-5 py-2.5 rounded-lg font-semibold text-xs md:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-md ${
            selectedCount > 0
              ? 'bg-[#479ef5] text-[#001c37] hover:bg-[#a0c9ff] active:scale-95 shadow-[0_0_16px_rgba(71,158,245,0.4)]'
              : 'bg-[#479ef5]/80 text-[#001c37] hover:bg-[#479ef5]'
          }`}
        >
          {selectedCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-[#001c37] text-[#a0c9ff] text-[11px] font-bold flex items-center justify-center">
              {selectedCount}
            </span>
          )}
          <span>
            {selectedCount > 0
              ? `View Subscriptions ($${totalMonthlyCost}/mo)`
              : 'View Subscriptions'}
          </span>
          <ArrowRight className="w-4 h-4 text-[#001c37]" />
        </button>
      </div>
    </footer>
  );
};
