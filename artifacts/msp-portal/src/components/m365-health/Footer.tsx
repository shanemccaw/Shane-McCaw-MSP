import React from 'react';
import { Shield, Cpu, Activity } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="max-w-[1440px] mx-auto px-6 py-8 border-t border-[#404752]/40 text-center text-xs font-mono text-[#8a919d]">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-[#479ef5]" />
          <span>Tenant Intelligence Overview © 2026</span>
        </div>

        <div className="flex items-center space-x-4">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[#a0c9ff]" />
            <span>Obsidian Metric Data Core v4.2.1</span>
          </span>
          <span>•</span>
          <span>Security Engine #9182</span>
        </div>

        <div className="text-[11px] text-[#8a919d]">
          Strict Compliance Standards: ISO 27001 / SOC 2 / GDPR / HIPAA
        </div>
      </div>
    </footer>
  );
};
