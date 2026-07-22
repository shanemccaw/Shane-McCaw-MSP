import React from 'react';
import { PriorityInsight } from '../types';
import { Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';

interface PriorityInsightsProps {
  insights: PriorityInsight[];
  onSelectInsight: (insight: PriorityInsight) => void;
}

export const PriorityInsights: React.FC<PriorityInsightsProps> = ({
  insights,
  onSelectInsight,
}) => {
  const getBadgeStyle = (id: number) => {
    switch (id) {
      case 1:
        return 'bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/30';
      case 2:
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 3:
        return 'bg-[#a0c9ff]/20 text-[#a0c9ff] border border-[#a0c9ff]/30';
      default:
        return 'bg-[#333535] text-[#c0c7d3] border border-white/10';
    }
  };

  return (
    <div className="glass-card p-6 rounded-xl flex flex-col justify-between h-full">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#a0c9ff]" />
            <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
              Priority Insights
            </h3>
          </div>
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] bg-[#1a1c1c] px-2 py-1 rounded border border-white/5">
            4 Actionable Alerts
          </span>
        </div>

        <ul className="space-y-4">
          {insights.map((item) => (
            <li
              key={item.id}
              onClick={() => onSelectInsight(item)}
              className="flex items-start gap-3.5 p-2.5 rounded-lg hover:bg-white/[0.03] border border-transparent hover:border-white/5 transition-all cursor-pointer group"
            >
              <span
                className={`w-6 h-6 rounded flex items-center justify-center font-mono-tech font-bold text-xs shrink-0 ${getBadgeStyle(
                  item.id
                )}`}
              >
                {item.id}
              </span>

              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-[#e2e2e2] font-semibold block group-hover:text-[#479ef5] transition-colors">
                    {item.title}
                  </strong>
                  {item.potentialSavings && (
                    <span className="text-[10px] font-mono-tech text-[#a0c9ff] bg-[#479ef5]/10 px-1.5 py-0.5 rounded">
                      {item.potentialSavings}
                    </span>
                  )}
                </div>
                <p className="text-[#c0c7d3] mt-1 leading-relaxed">
                  {item.description}
                </p>
              </div>

              <ArrowRight className="w-4 h-4 text-[#c0c7d3]/40 group-hover:text-[#479ef5] group-hover:translate-x-0.5 transition-all self-center shrink-0" />
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] font-mono-tech text-[#c0c7d3]">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[#479ef5]" /> Real-time posture score updated
        </span>
        <span className="text-[#a0c9ff] hover:underline cursor-pointer">
          Configure Alert Thresholds
        </span>
      </div>
    </div>
  );
};
