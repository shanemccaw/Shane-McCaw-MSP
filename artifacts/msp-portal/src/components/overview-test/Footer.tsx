import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full py-6 mt-16 border-t border-white/5 bg-[#1c2025]/80 text-xs">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
        
        {/* Left: Brand name & version */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#479ef5]">Tenant Intelligence Snapshot</span>
          <span className="text-[10px] font-mono text-slate-500">v2.4.1</span>
        </div>

        {/* Center: Copyright */}
        <p className="text-slate-400 text-center">
          © 2026 Tenant Intelligence Snapshot. All rights reserved.
        </p>

        {/* Right: Policy links & API Status */}
        <div className="flex items-center gap-6 text-slate-400">
          <a href="#" className="hover:text-[#479ef5] transition-colors">
            Privacy Policy
          </a>
          <a href="#" className="hover:text-[#479ef5] transition-colors">
            Terms of Service
          </a>
          <div className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="font-mono text-emerald-400 font-semibold">API Status: Operational</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
