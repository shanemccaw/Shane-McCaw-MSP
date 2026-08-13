import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="max-w-[1440px] mx-auto px-6 pt-12 pb-8 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4 text-[#c0c7d3] font-mono-tech text-xs mt-12">
      <div>
        ArchIntel Systems <span className="text-[#479ef5] font-bold mx-1.5">V2.4.1</span> — Enterprise Tenant Intelligence
      </div>
      <div className="flex items-center gap-6">
        <button className="hover:text-[#479ef5] transition-colors cursor-pointer">
          Documentation
        </button>
        <button className="hover:text-[#479ef5] transition-colors cursor-pointer">
          Security Audit
        </button>
        <button className="hover:text-[#479ef5] transition-colors cursor-pointer">
          API Access
        </button>
      </div>
    </footer>
  );
};
