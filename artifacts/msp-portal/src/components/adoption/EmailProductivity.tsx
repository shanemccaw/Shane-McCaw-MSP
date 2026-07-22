import React from 'react';
import { Mail, ArrowUpRight, ArrowDownLeft, AlertCircle } from 'lucide-react';

interface EmailProductivityProps {
  score?: number;
  sentMessages?: number;
  receivedMessages?: number;
  unreadBacklog?: number;
}

export const EmailProductivity: React.FC<EmailProductivityProps> = ({
  score = 78,
  sentMessages = 4203,
  receivedMessages = 8110,
  unreadBacklog = 1452
}) => {
  return (
    <section className="bg-card border border-border p-6 rounded-xl flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="font-headline text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#479ef5]" />
            Email Productivity
          </h2>
          <p className="font-mono-data text-xs text-[#8a919d] mt-0.5">
            Traffic & Response Rate
          </p>
        </div>

        <div className="bg-[#479ef5]/20 border border-[#479ef5]/30 text-[#d2e4ff] px-3 py-1 rounded-full font-mono-data text-xs font-bold shadow-sm">
          Score: {score}
        </div>
      </div>

      {/* Progress Bars */}
      <div className="space-y-4 my-2">
        {/* Sent Messages */}
        <div className="space-y-1.5">
          <div className="flex justify-between font-mono-data text-xs">
            <span className="text-[#c0c7d3] flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-[#479ef5]" /> Sent Messages
            </span>
            <span className="text-[#479ef5] font-bold">{sentMessages.toLocaleString()}</span>
          </div>
          <div className="w-full bg-[#1a1c1c] h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div 
              className="bg-[#479ef5] h-full rounded-full transition-all duration-500 shadow-sm shadow-[#479ef5]/20" 
              style={{ width: '65%' }}
            ></div>
          </div>
        </div>

        {/* Received */}
        <div className="space-y-1.5">
          <div className="flex justify-between font-mono-data text-xs">
            <span className="text-[#c0c7d3] flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-[#dab9ff]" /> Received
            </span>
            <span className="text-[#dab9ff] font-bold">{receivedMessages.toLocaleString()}</span>
          </div>
          <div className="w-full bg-[#1a1c1c] h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div 
              className="bg-[#dab9ff] h-full rounded-full transition-all duration-500 shadow-sm shadow-[#dab9ff]/20" 
              style={{ width: '85%' }}
            ></div>
          </div>
        </div>

        {/* Unread Backlog */}
        <div className="space-y-1.5">
          <div className="flex justify-between font-mono-data text-xs">
            <span className="text-[#c0c7d3] flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" /> Unread Backlog
            </span>
            <span className="text-red-400 font-bold">{unreadBacklog.toLocaleString()}</span>
          </div>
          <div className="w-full bg-[#1a1c1c] h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div 
              className="bg-red-500 h-full rounded-full transition-all duration-500 shadow-sm shadow-red-500/20" 
              style={{ width: '25%' }}
            ></div>
          </div>
        </div>
      </div>

      {/* Summary Note */}
      <div className="pt-3 border-t border-white/5 text-[11px] font-mono-data text-[#8a919d] flex items-center justify-between">
        <span>Sent/Received Ratio: 1 : 1.93</span>
        <span className="text-emerald-400">Avg Response: 18 min</span>
      </div>
    </section>
  );
};
