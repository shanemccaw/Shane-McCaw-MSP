import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="pt-12 pb-8 border-t border-white/5 text-center mt-12">
      <div className="inline-flex flex-col items-center gap-1.5">
        <div className="flex gap-3 mb-3">
          <div className="w-1.5 h-1.5 bg-[#479ef5] rounded-full animate-ping"></div>
          <div className="w-1.5 h-1.5 bg-[#479ef5] rounded-full"></div>
          <div className="w-1.5 h-1.5 bg-[#479ef5] rounded-full"></div>
        </div>
        <p className="font-mono text-xs text-[#c0c7d3] tracking-widest uppercase">
          © 2024 GOVERNANCE INTELLIGENCE CORE • V4.2.0-STABLE
        </p>
        <p className="font-mono text-[10px] text-[#8a919d]">
          AUTHENTICATED AS: SYSTEM_ADMIN_X92
        </p>
      </div>
    </footer>
  );
};
