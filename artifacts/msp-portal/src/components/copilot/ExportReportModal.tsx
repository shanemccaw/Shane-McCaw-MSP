import React, { useState } from 'react';
import { BarChart3, X, Check, Copy } from 'lucide-react';
import { ExecutiveMetrics, HeatmapEntity, ReadinessBlocker } from './types';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: ExecutiveMetrics;
  entities: HeatmapEntity[];
  blockers: ReadinessBlocker[];
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  metrics,
  entities,
  blockers
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const reportJson = JSON.stringify(
    {
      title: 'Copilot Readiness Overview Executive Report',
      timestamp: metrics.lastUpdated,
      executiveMetrics: {
        aggregateReadinessScore: metrics.aggregateReadiness,
        status: metrics.readinessStatus,
        permissionsHygiene: metrics.permissionsHygiene,
        sensitiveDataProtection: metrics.sensitiveDataProtection,
        copilotRiskScore: metrics.copilotRiskScore
      },
      criticalBlockers: blockers.map((b) => ({
        rank: b.rank,
        title: b.title,
        severity: b.severity,
        remediated: b.remediated
      })),
      entitiesAudited: entities.length
    },
    null,
    2
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(reportJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="max-w-2xl w-full rounded-xl border border-[#404752] p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="text-[#479ef5] w-6 h-6" />
            <h3 className="font-display text-xl font-bold text-white">
              Executive Intelligence Report Summary
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 p-3 bg-[#1a1a1a] rounded-lg border border-[#2b2b2b] text-center">
            <div>
              <span className="text-[10px] font-mono text-[#8a919d] uppercase block">
                READINESS SCORE
              </span>
              <span className="text-2xl font-display font-bold text-[#479ef5]">
                {metrics.aggregateReadiness}/100
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-[#8a919d] uppercase block">
                PERMISSIONS HYGIENE
              </span>
              <span className="text-2xl font-display font-bold text-white">
                {metrics.permissionsHygiene}/100
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-[#8a919d] uppercase block">
                COPILOT RISK
              </span>
              <span className="text-2xl font-display font-bold text-[#4caf50]">
                {metrics.copilotRiskScore}
              </span>
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-[#c0c7d3] block mb-2 font-semibold">
              Export Payload (JSON / Executive Briefing)
            </label>
            <pre className="p-4 bg-[#121414] border border-[#2b2b2b] rounded-lg font-mono text-xs text-sky-300 max-h-56 overflow-y-auto leading-relaxed">
              {reportJson}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#2b2b2b]">
          <span className="font-mono text-xs text-[#8a919d]">
            Generated for CISO & IT Governance Board
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 font-mono text-xs font-semibold bg-[#2b2b2b] text-white hover:bg-[#38393a] rounded-md transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'COPIED TO CLIPBOARD' : 'COPY JSON'}
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 font-mono text-xs font-bold bg-[#479ef5] text-[#003259] hover:bg-sky-400 rounded-md transition-all shadow-md"
            >
              DONE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
