import React from 'react';
import { Sparkles, Mail, Video, FileText, Code } from 'lucide-react';
import { CopilotBreakdownItem } from './types';

interface CopilotUsageProps {
  data?: CopilotBreakdownItem[];
}

export const CopilotUsage: React.FC<CopilotUsageProps> = ({
  data = [
    { key: 'email', label: 'Email', count: 442, color: '#479ef5', percentage: 40, description: 'Email Drafting' },
    { key: 'recap', label: 'Recap', count: 276, color: '#dab9ff', percentage: 25, description: 'Meeting Recap' },
    { key: 'doc', label: 'Doc', count: 221, color: '#f59e0b', percentage: 20, description: 'Summarization' },
    { key: 'code', label: 'Code', count: 166, color: '#22c55e', percentage: 15, description: 'Code Assist' }
  ]
}) => {
  const getIcon = (key: string) => {
    switch (key) {
      case 'email': return <Mail className="w-3.5 h-3.5 text-[#479ef5]" />;
      case 'recap': return <Video className="w-3.5 h-3.5 text-[#dab9ff]" />;
      case 'doc': return <FileText className="w-3.5 h-3.5 text-[#f59e0b]" />;
      case 'code': return <Code className="w-3.5 h-3.5 text-[#22c55e]" />;
      default: return <Sparkles className="w-3.5 h-3.5 text-[#ffb300]" />;
    }
  };

  return (
    <section className="bg-card border border-border p-6 rounded-xl flex flex-col justify-between h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#ffb300]" />
            Copilot Usage Breakdown
          </h2>
          <p className="text-xs text-[#8a919d] font-body mt-0.5">
            AI Assistant feature utilization distribution
          </p>
        </div>
        <span className="font-mono-data text-[10px] text-[#ffb300] bg-[#ffb300]/10 px-2 py-0.5 rounded border border-[#ffb300]/20 font-bold">
          1,105 Total Actions
        </span>
      </div>

      <div className="space-y-6 my-2">
        {/* Multi-segment distribution bar */}
        <div className="flex h-11 w-full rounded-xl overflow-hidden border border-white/10 shadow-inner p-0.5 bg-[#1a1c1c]">
          <div 
            className="bg-[#479ef5] h-full flex items-center justify-center font-mono-data text-xs font-bold text-[#001c37] transition-all rounded-l-lg hover:brightness-110 cursor-pointer" 
            style={{ width: '40%' }}
            title="Email: 40% (442 actions)"
          >
            Email
          </div>
          <div 
            className="bg-[#dab9ff] h-full flex items-center justify-center font-mono-data text-xs font-bold text-[#2a0053] transition-all hover:brightness-110 cursor-pointer" 
            style={{ width: '25%' }}
            title="Recap: 25% (276 actions)"
          >
            Recap
          </div>
          <div 
            className="bg-[#f59e0b] h-full flex items-center justify-center font-mono-data text-xs font-bold text-black transition-all hover:brightness-110 cursor-pointer" 
            style={{ width: '20%' }}
            title="Doc: 20% (221 actions)"
          >
            Doc
          </div>
          <div 
            className="bg-[#22c55e] h-full flex items-center justify-center font-mono-data text-xs font-bold text-black transition-all rounded-r-lg hover:brightness-110 cursor-pointer" 
            style={{ width: '15%' }}
            title="Code: 15% (166 actions)"
          >
            Code
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {data.map((item) => (
            <div 
              key={item.key}
              className="p-3 bg-[#1a1c1c] rounded-lg border border-white/5 hover:border-white/15 transition-all group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                {getIcon(item.key)}
                <p className="font-mono-data text-[10px] text-[#8a919d] uppercase tracking-wider">
                  {item.description}
                </p>
              </div>
              <p className="font-headline text-base font-bold text-white group-hover:text-[#479ef5] transition-colors">
                {item.count} <span className="text-xs font-normal text-[#8a919d]">actions</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-white/5 flex justify-between text-[11px] font-mono-data text-[#8a919d]">
        <span>Top adoption driver: Outlook Email Drafting</span>
        <span className="text-[#479ef5]">+18.4% WoW</span>
      </div>
    </section>
  );
};
