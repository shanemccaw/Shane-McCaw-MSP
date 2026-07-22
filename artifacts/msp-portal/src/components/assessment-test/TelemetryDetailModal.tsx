import React, { useState } from 'react';
import { TelemetryItem, RecommendedOffer } from './types';
import {
  X,
  Copy,
  Check,
  Terminal,
  Brain,
  ShieldAlert,
  ArrowRight,
  Play,
  Microscope,
  ShoppingBag,
  ArrowUpRight,
} from 'lucide-react';

interface TelemetryDetailModalProps {
  item: TelemetryItem | null;
  onClose: () => void;
  onRemediate?: (item: TelemetryItem) => void;
  /** Real Sales Offer Engine match for this finding (null = honestly none). */
  offer?: RecommendedOffer | null;
}

export const TelemetryDetailModal: React.FC<TelemetryDetailModalProps> = ({
  item,
  onClose,
  onRemediate,
  offer = null,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executed, setExecuted] = useState(false);

  if (!item) return null;

  const handleCopyScript = () => {
    if (item.powershellSnippet) {
      navigator.clipboard.writeText(item.powershellSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExecuteRemediation = () => {
    setIsExecuting(true);
    setTimeout(() => {
      setIsExecuting(false);
      setExecuted(true);
      onRemediate?.(item);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#242424] border border-white/10 rounded-xl max-w-xl w-full p-6 shadow-2xl relative overflow-hidden flex flex-col gap-4">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#479ef5]/10 border border-[#479ef5]/30 flex items-center justify-center text-[#479ef5]">
              <ShieldAlert className="w-5 h-5 text-[#479ef5]" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#479ef5] px-2 py-0.5 rounded bg-[#479ef5]/10 border border-[#479ef5]/20">
                Finding #{item.id} • {item.type.toUpperCase()}
              </span>
              <h3 className="text-lg font-bold text-[#e0e2ea] mt-1">{item.title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919d] hover:text-[#e0e2ea] p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-1">
            Telemetry Findings
          </h4>
          <p className="text-sm text-[#c0c7d3] leading-relaxed">{item.description}</p>
        </div>

        {/* Architect Says Box */}
        <div className="bg-[#1a1a1a] border border-[#479ef5]/30 rounded-lg p-3.5 relative">
          <div className="flex items-center gap-2 text-xs font-bold text-[#479ef5] mb-1">
            <Brain className="w-4 h-4" />
            <span>AI Architect Recommendation</span>
          </div>
          <p className="text-xs text-[#c0c7d3] italic">"{item.architectSays}"</p>
        </div>

        {/* How this was determined — the real check/signal behind the finding.
            Deliberately its own block, separate from both the narrative quote
            above and the remediation content below. */}
        {item.determinedBy && (
          <div>
            <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Microscope className="w-3.5 h-3.5 text-[#2dd4bf]" />
              How This Was Determined
            </h4>
            <div className="bg-[#101419] p-3 rounded-lg border border-white/5 flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-[#2dd4bf]">
                {item.determinedBy.source}
              </span>
              <p className="text-xs text-[#c0c7d3] leading-relaxed">
                {item.determinedBy.method}
              </p>
            </div>
          </div>
        )}

        {/* Remediation Step */}
        {item.remediationStep && (
          <div>
            <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-1">
              Recommended Remediation Action
            </h4>
            <div className="bg-[#101419] p-3 rounded-lg border border-white/5 text-xs text-[#e0e2ea] flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-[#34d399] flex-shrink-0" />
              <span>{item.remediationStep}</span>
            </div>
          </div>
        )}

        {/* Recommended Offer — REAL Sales Offer Engine output (real catalog
            service, engine-adjusted price, real link to the customer offers
            page). Honest empty state when no live offer matches this finding. */}
        <div>
          <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5 text-[#f59e0b]" />
            Recommended Offer
          </h4>
          {offer ? (
            <div className="bg-[#101419] p-3 rounded-lg border border-[#f59e0b]/25 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-[#e0e2ea]">{offer.serviceName}</span>
                <span className="text-sm font-bold text-[#34d399] font-mono whitespace-nowrap">
                  ${Math.round(offer.priceCents / 100).toLocaleString()}
                </span>
              </div>
              {offer.rationale && (
                <p className="text-[11px] text-[#8a919d] leading-relaxed">{offer.rationale}</p>
              )}
              <a
                href={offer.link}
                className="inline-flex items-center gap-1 self-start text-[11px] font-semibold text-[#479ef5] hover:underline"
              >
                View offer <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          ) : (
            <div className="bg-[#101419] p-3 rounded-lg border border-white/5 text-[11px] text-[#8a919d]">
              No live offer currently matches this finding.
            </div>
          )}
        </div>

        {/* PowerShell Script */}
        {item.powershellSnippet && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#479ef5]" />
                Automated PowerShell Fix
              </h4>
              <button
                onClick={handleCopyScript}
                className="text-[11px] text-[#479ef5] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-[#34d399]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied!' : 'Copy Script'}</span>
              </button>
            </div>
            <pre className="bg-[#101419] p-3 rounded-lg border border-white/10 font-mono text-xs text-[#34d399] overflow-x-auto select-all">
              {item.powershellSnippet}
            </pre>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10 mt-1">
          <span className="text-xs text-[#8a919d]">
            {item.affectedCount ? `${item.affectedCount} resources affected` : 'Impact: Tenant-wide'}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-[#c0c7d3] hover:bg-white/5 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleExecuteRemediation}
              disabled={isExecuting || executed}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                executed
                  ? 'bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/30'
                  : 'bg-[#479ef5] hover:bg-[#388ee0] text-[#001c37]'
              }`}
            >
              {executed ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Remediation Applied</span>
                </>
              ) : isExecuting ? (
                <span>Executing Policy...</span>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Apply Auto-Fix</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
