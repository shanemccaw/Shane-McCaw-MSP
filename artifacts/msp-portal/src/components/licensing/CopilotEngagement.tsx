import React from 'react';
import { Sparkles, Bot, Zap } from 'lucide-react';

interface CopilotEngagementProps {
  onAutoAssignTrigger?: () => void;
}

export const CopilotEngagement: React.FC<CopilotEngagementProps> = ({ onAutoAssignTrigger }) => {
  const deployedPercent = 60;
  const strokeDasharray = 364.4;
  const strokeDashoffset = strokeDasharray * (1 - deployedPercent / 100);

  return (
    <div className="glass-card p-6 rounded-xl flex flex-col justify-between h-full relative overflow-hidden">
      <div className="absolute top-4 right-4 h-8 w-8 rounded-full border border-[#479ef5]/30 bg-[#479ef5]/10 flex items-center justify-center">
        <Sparkles className="w-4 h-4 text-[#479ef5]" />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-6">
          <Bot className="w-5 h-5 text-[#cda3ff]" />
          <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
            Copilot Engagement
          </h3>
        </div>

        {/* Ring Chart */}
        <div className="flex flex-col items-center justify-center my-4">
          <div className="relative w-36 h-36 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              {/* Background Track */}
              <circle
                className="text-[#404752]"
                cx="72"
                cy="72"
                fill="transparent"
                r="58"
                stroke="currentColor"
                strokeWidth="8"
              ></circle>
              {/* Value Fill */}
              <circle
                className="text-[#a0c9ff] transition-all duration-1000 ease-out"
                cx="72"
                cy="72"
                fill="transparent"
                r="58"
                stroke="currentColor"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                strokeWidth="8"
              ></circle>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-headline text-3xl font-bold text-[#e2e2e2]">
                {deployedPercent}%
              </span>
              <span className="text-[10px] font-mono-tech text-[#c0c7d3] uppercase tracking-wider">
                DEPLOYED
              </span>
            </div>
          </div>
        </div>

        {/* Breakdown List */}
        <div className="w-full space-y-2 mt-4 pt-4 border-t border-white/5 font-mono-tech text-xs">
          <div className="flex justify-between items-center text-[#c0c7d3]">
            <span>Eligible Base</span>
            <span className="font-bold text-[#e2e2e2]">2,400</span>
          </div>
          <div className="flex justify-between items-center text-[#a0c9ff]">
            <span>Licensed</span>
            <span className="font-bold">1,440</span>
          </div>
          <div className="flex justify-between items-center text-[#ffb4ab]">
            <span>Active Unlicensed</span>
            <span className="font-bold">288</span>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-2">
        <button
          onClick={onAutoAssignTrigger}
          className="w-full py-2 px-3 bg-[#5a3289]/20 hover:bg-[#5a3289]/40 border border-[#cda3ff]/30 rounded text-xs font-mono-tech text-[#cda3ff] hover:text-white transition-all flex items-center justify-center gap-2 font-medium"
        >
          <Zap className="w-3.5 h-3.5 text-[#cda3ff]" />
          <span>Provision 288 High-AI Seats</span>
        </button>
      </div>
    </div>
  );
};
