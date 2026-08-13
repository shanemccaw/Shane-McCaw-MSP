import React from 'react';

export const FooterTelemetry: React.FC = () => {
  return (
    <footer className="fixed bottom-0 left-0 right-0 w-full h-8 z-50 bg-[#0c0e11]/95 backdrop-blur-lg border-t border-[#3f4751]/30 flex justify-between items-center px-4 md:px-8 text-[10px] font-mono select-none">
      <div className="flex gap-4 md:gap-8">
        <div className="text-[#00daf8] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00daf8] indicator-pulse"></span>
          <span>GLOBAL TELEMETRY STREAMING</span>
        </div>
        <div className="text-[#bfc7d3]/70 hidden sm:flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">cloud_sync</span>
          <span>GRAPH SYNC: 100%</span>
        </div>
      </div>

      <div className="flex gap-4 md:gap-8">
        <div className="text-[#bfc7d3]/70 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">speed</span>
          <span>LATENCY: 24MS</span>
        </div>
        <div className="text-[#bfc7d3]/70 hidden md:flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">verified_user</span>
          <span>SECURITY ENGINE: ACTIVE</span>
        </div>
      </div>
    </footer>
  );
};
