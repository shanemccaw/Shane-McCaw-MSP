import React, { useState } from 'react';
import { ExecutiveMetrics } from '../types';

interface FooterBarProps {
  metrics: ExecutiveMetrics;
  onToggleLiveFeed: () => void;
  onOpenExportReport: () => void;
}

export const FooterBar: React.FC<FooterBarProps> = ({
  metrics,
  onToggleLiveFeed,
  onOpenExportReport
}) => {
  const [showDocs, setShowDocs] = useState(false);

  return (
    <>
      <footer className="pt-8 pb-12 border-t border-[#2b2b2b] flex flex-col md:flex-row justify-between items-center text-[#c0c7d3] font-mono text-xs gap-4">
        {/* Left Status Identifiers */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#479ef5] font-bold tracking-wider">INTEL SUITE</span>
          <span className="opacity-30">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            System Health: Nominal
          </span>
          <span className="opacity-30">|</span>
          <span>Last Updated: {metrics.lastUpdated}</span>
        </div>

        {/* Right Links & Controls */}
        <div className="flex items-center gap-6 flex-wrap">
          <button
            onClick={() => setShowDocs(true)}
            className="hover:text-[#479ef5] transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">description</span>
            Documentation
          </button>

          <button
            onClick={onOpenExportReport}
            className="hover:text-[#479ef5] transition-colors flex items-center gap-1 text-[#479ef5] font-semibold"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            Export Report
          </button>

          <div
            onClick={onToggleLiveFeed}
            className="flex items-center gap-2 text-[#479ef5] cursor-pointer hover:opacity-80 transition-opacity select-none"
          >
            <span
              className={`w-2 h-2 rounded-full bg-[#479ef5] ${
                metrics.liveDataFeedActive ? 'animate-ping' : 'opacity-40'
              }`}
            />
            <span>
              {metrics.liveDataFeedActive ? 'Live Data Feed' : 'Feed Paused'}
            </span>
          </div>
        </div>
      </footer>

      {/* Documentation Drawer Modal */}
      {showDocs && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="glass-card max-w-xl w-full rounded-xl border border-[#404752] p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-3">
              <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[#479ef5]">
                  menu_book
                </span>
                Copilot Governance Architecture Docs
              </h3>
              <button
                onClick={() => setShowDocs(false)}
                className="text-[#8a919d] hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3 font-body text-xs text-[#c0c7d3] max-h-80 overflow-y-auto leading-relaxed">
              <p>
                <strong>Microsoft 365 Copilot Readiness Scoring Engine:</strong> The readiness score combines Permissions Hygiene (35%), Sensitive Data Protection (35%), and DLP Enforcement (30%).
              </p>
              <ul className="list-disc pl-5 space-y-1 font-mono text-[11px] text-[#8a919d]">
                <li>Permissions Hygiene tracks anonymous sharing links and guest access.</li>
                <li>Sensitive Data Protection calculates Purview label coverage across SharePoint and OneDrive.</li>
                <li>DLP Effectiveness logs blocked vs. allowed policy violations.</li>
              </ul>
              <p>
                <strong>Automated Remediation Workflows:</strong> Selecting "Deploy Fix" or "Harden Tenant" triggers API scripts to purge stale anonymous sharing links, enforce MIP labels, and restrict guest accounts in Entra ID.
              </p>
            </div>

            <div className="pt-3 border-t border-[#2b2b2b] text-right">
              <button
                onClick={() => setShowDocs(false)}
                className="px-4 py-2 font-mono text-xs bg-[#479ef5] text-[#003259] font-bold rounded-md"
              >
                CLOSE DOCS
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
