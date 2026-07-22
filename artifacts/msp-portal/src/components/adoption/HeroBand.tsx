import React, { useState } from 'react';
import { Users, Cloud, Sparkles, TrendingUp, Info } from 'lucide-react';

interface HeroBandProps {
  score?: number;
  scoreChange?: string;
  teamsUsers?: number;
  sharepointSites?: number;
  copilotUsers?: number;
}

export const HeroBand: React.FC<HeroBandProps> = ({
  score = 62,
  scoreChange = '+4.2% from last month',
  teamsUsers = 12402,
  sharepointSites = 842,
  copilotUsers = 1105
}) => {
  const [showScoreInfo, setShowScoreInfo] = useState(false);

  // Conic gradient percentage for gauge stroke
  const gaugeStyle = {
    background: `conic-gradient(#479ef5 ${score}%, #1a1a1a 0)`
  };

  return (
    <section className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch mb-6">
      {/* Adoption Health Score Box */}
      <div className="md:col-span-4 glass-card p-6 rounded-xl flex flex-col justify-center items-center text-center relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-full h-1 bg-[#479ef5]"></div>
        
        <div className="flex items-center gap-1.5 mb-4">
          <h2 className="font-mono-data text-xs text-[#c0c7d3] tracking-widest uppercase font-semibold">
            ADOPTION HEALTH SCORE
          </h2>
          <button 
            onClick={() => setShowScoreInfo(!showScoreInfo)}
            className="text-[#8a919d] hover:text-[#479ef5] transition-colors p-0.5"
            title="Score Breakdown Info"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Score Ring Gauge */}
        <div className="relative w-32 h-32 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-105">
          <div 
            className="absolute inset-0 rounded-full opacity-90 transition-all" 
            style={gaugeStyle}
          ></div>
          <div className="absolute inset-2 bg-[#1e2020] rounded-full flex flex-col items-center justify-center shadow-inner border border-white/5">
            <span className="font-headline text-5xl font-bold text-[#479ef5] tracking-tight">
              {score}
            </span>
            <span className="font-mono-data text-[10px] text-[#8a919d] mt-0.5">
              / 100
            </span>
          </div>
        </div>

        {/* Trend Indicator */}
        <div className="flex items-center gap-1 text-emerald-400 font-mono-data text-xs font-medium">
          <TrendingUp className="w-4 h-4" />
          <span>{scoreChange}</span>
        </div>

        {/* Info popover */}
        {showScoreInfo && (
          <div className="absolute inset-x-3 bottom-3 p-3 bg-[#1a1c1c] rounded-lg border border-[#479ef5]/40 text-left text-xs text-[#e2e2e2] shadow-xl z-10 animate-in fade-in zoom-in-95">
            <p className="font-bold text-[#479ef5] mb-1 font-mono-data text-[11px]">Score Components:</p>
            <ul className="space-y-1 text-[11px] text-[#c0c7d3]">
              <li>• Teams Collaboration Index: 68/100</li>
              <li>• SharePoint Activity Index: 58/100</li>
              <li>• Copilot License Active Usage: 60/100</li>
            </ul>
            <button 
              onClick={() => setShowScoreInfo(false)}
              className="mt-2 text-[10px] font-mono-data text-[#8a919d] hover:text-white underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* 3 Metric Cards */}
      <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Teams Users */}
        <div className="glass-card p-6 rounded-xl flex flex-col justify-between border-l-4 border-l-[#479ef5] hover:border-l-[6px] transition-all">
          <div className="w-10 h-10 rounded-lg bg-[#479ef5]/15 flex items-center justify-center text-[#479ef5] mb-4">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-mono-data text-xs text-[#c0c7d3] uppercase tracking-wider font-medium">
              Active Teams Users
            </h3>
            <p className="font-headline text-3xl font-bold text-white mt-1 tracking-tight">
              {teamsUsers.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Active SharePoint Sites */}
        <div className="glass-card p-6 rounded-xl flex flex-col justify-between border-l-4 border-l-[#b685e1] hover:border-l-[6px] transition-all">
          <div className="w-10 h-10 rounded-lg bg-[#b685e1]/15 flex items-center justify-center text-[#b685e1] mb-4">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-mono-data text-xs text-[#c0c7d3] uppercase tracking-wider font-medium">
              Active SharePoint Sites
            </h3>
            <p className="font-headline text-3xl font-bold text-white mt-1 tracking-tight">
              {sharepointSites.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Copilot Active Users */}
        <div className="glass-card p-6 rounded-xl flex flex-col justify-between border-l-4 border-l-[#ffb300] hover:border-l-[6px] transition-all">
          <div className="w-10 h-10 rounded-lg bg-[#ffb300]/15 flex items-center justify-center text-[#ffb300] mb-4">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-mono-data text-xs text-[#c0c7d3] uppercase tracking-wider font-medium">
              Copilot Active Users
            </h3>
            <p className="font-headline text-3xl font-bold text-white mt-1 tracking-tight">
              {copilotUsers.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
