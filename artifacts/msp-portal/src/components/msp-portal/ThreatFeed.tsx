import React from 'react';
import {
  Activity,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { ThreatFeedItem } from '../types';

interface ThreatFeedProps {
  threatItems: ThreatFeedItem[];
  onTriggerRemediation: (item: ThreatFeedItem) => void;
  onViewAllLogs: () => void;
}

export const ThreatFeed: React.FC<ThreatFeedProps> = ({
  threatItems,
  onTriggerRemediation,
  onViewAllLogs,
}) => {
  return (
    <div className="bg-[#101419] border border-[#404752] rounded-md flex flex-col shrink-0 min-h-[200px] shadow-sm">
      {/* Feed Header */}
      <div className="p-2.5 border-b border-[#404752] bg-[#272a30] flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#0078d4]" />
          <span className="font-semibold text-xs text-[#e0e2ea] tracking-tight">
            Threat &amp; Drift Feed
          </span>
          <span className="bg-[#0b0e14] border border-[#404752] text-[10px] text-[#a3c9ff] px-2 py-0.5 rounded font-mono">
            Graph Stream Live
          </span>
        </div>
        <button
          onClick={onViewAllLogs}
          className="text-[#a3c9ff] text-xs font-semibold hover:underline flex items-center gap-1"
        >
          <span>View all logs</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Horizontal Scroll Feed Cards */}
      <div className="p-3 overflow-x-auto">
        <div className="flex gap-3 min-w-max pb-1">
          {threatItems.map((item) => {
            let severityBg = 'border-[#7f1d1d] bg-[#450a0a]/30';
            let badgeBg = 'bg-[#7f1d1d] text-white';
            let buttonStyle = 'bg-[#93000a] text-[#ffdad6] border-[#7f1d1d] hover:bg-[#93000a]/80';

            if (item.severity === 'MED') {
              severityBg = 'border-[#713f12] bg-[#422006]/30';
              badgeBg = 'bg-[#713f12] text-white';
              buttonStyle = 'bg-[#31353b] text-[#e0e2ea] border-[#404752] hover:bg-[#272a30]';
            } else if (item.severity === 'LOW') {
              severityBg = 'border-[#1e3a8a] bg-[#172554]/30';
              badgeBg = 'bg-[#1e3a8a] text-white';
              buttonStyle = 'bg-[#31353b] text-[#e0e2ea] border-[#404752] hover:bg-[#272a30]';
            }

            const isResolved = item.status === 'RESOLVED';

            return (
              <div
                key={item.id}
                className={`border p-3 rounded-md w-64 sm:w-72 flex flex-col justify-between transition-all relative ${
                  isResolved
                    ? 'border-[#166534] bg-[#052e16]/20 opacity-80'
                    : severityBg
                }`}
              >
                <div>
                  <div className="flex justify-between items-start mb-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${badgeBg}`}>
                      {item.severity}
                    </span>
                    <span className="text-[10px] text-[#8a919e] font-mono">{item.timestamp}</span>
                  </div>

                  <div className="font-semibold text-xs text-[#e0e2ea] mb-1 line-clamp-2">
                    {item.title}
                  </div>

                  <div className="text-[11px] text-[#8a919e] mb-2 flex items-center justify-between">
                    <span>
                      {item.tenantName} • <span className="text-[#a3c9ff]">{item.sourceModule}</span>
                    </span>
                  </div>

                  {item.targetUPN && (
                    <div className="text-[10px] text-[#8a919e] font-mono bg-[#0b0e14]/50 px-1.5 py-0.5 rounded border border-[#404752]/30 mb-2 truncate">
                      UPN: {item.targetUPN}
                    </div>
                  )}
                </div>

                <div className="mt-2 pt-2 border-t border-[#404752]/40">
                  {isResolved ? (
                    <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-[#4ade80] font-semibold bg-[#052e16] rounded border border-[#166534]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Remediated</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => onTriggerRemediation(item)}
                      className={`w-full py-1 rounded border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm ${buttonStyle}`}
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>
                        {item.actionType === 'FIX_NOW'
                          ? 'Fix Now'
                          : item.actionType === 'REVIEW'
                          ? 'Review'
                          : item.actionType === 'ACKNOWLEDGE'
                          ? 'Acknowledge'
                          : item.actionType === 'REVOKE_SESSIONS'
                          ? 'Revoke Sessions'
                          : 'View Diff'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
