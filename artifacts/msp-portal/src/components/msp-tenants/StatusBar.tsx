import React from 'react';

interface StatusBarProps {
  highIncidentsCount: number;
  alertsCount: number;
  messagesCount: number;
  activeWorkflowsCount: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  highIncidentsCount,
  alertsCount,
  messagesCount,
  activeWorkflowsCount,
}) => {
  return (
    <footer className="fixed bottom-0 left-0 md:left-64 right-0 z-30 flex justify-between items-center h-10 px-6 border-t border-white/5 bg-[#111317]/90 backdrop-blur-md">
      <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto py-1">
        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[14px] text-[#ffb4ab]">
            confirmation_number
          </span>
          <span className="font-mono text-[10px] text-[#bfc7d3]">
            Incidents: <span className="text-[#e2e2e6] font-bold">{highIncidentsCount} High</span>
          </span>
        </div>

        <div className="text-white/10 hidden sm:inline">|</div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[14px] text-[#d2bbff]">
            campaign
          </span>
          <span className="font-mono text-[10px] text-[#bfc7d3]">
            Alerts: <span className="text-[#e2e2e6] font-bold">{alertsCount}</span>
          </span>
        </div>

        <div className="text-white/10 hidden sm:inline">|</div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[14px] text-[#99cbff]">
            chat
          </span>
          <span className="font-mono text-[10px] text-[#bfc7d3]">
            Admin Messages: <span className="text-[#e2e2e6] font-bold">{messagesCount}</span>
          </span>
        </div>

        <div className="text-white/10 hidden sm:inline">|</div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[14px] text-[#a5eeff]">
            play_arrow
          </span>
          <span className="font-mono text-[10px] text-[#bfc7d3]">
            Workflows: <span className="text-[#e2e2e6] font-bold">{activeWorkflowsCount.toLocaleString()}</span>
          </span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="status-dot text-[#a5eeff] scale-75"></span>
          <span className="font-mono text-[10px] text-[#bfc7d3] uppercase tracking-widest">
            Orchestrator Heartbeat: Stable
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#bfc7d3]/40">V5.0.0-OBSIDIAN</span>
      </div>
    </footer>
  );
};
