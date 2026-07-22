import React from 'react';
import { MetricGauge } from './types';
import { X, ShieldCheck, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';

interface MetricGaugeModalProps {
  gauge: MetricGauge | null;
  onClose: () => void;
}

export const MetricGaugeModal: React.FC<MetricGaugeModalProps> = ({ gauge, onClose }) => {
  if (!gauge) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#242424] border border-white/10 rounded-xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden flex flex-col gap-4">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#479ef5]/10 border border-[#479ef5]/30 flex items-center justify-center text-[#479ef5] text-xl font-bold font-mono">
              {gauge.score}%
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#479ef5]">
                Metric Intelligence
              </span>
              <h3 className="text-lg font-bold text-[#e0e2ea]">{gauge.title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919d] hover:text-[#e0e2ea] p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Overview */}
        <div>
          <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-1">
            Analysis Overview
          </h4>
          <p className="text-sm text-[#c0c7d3] leading-relaxed">{gauge.description}</p>
        </div>

        {/* Benchmark & Trend */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#101419] p-3 rounded-lg border border-white/5">
            <div className="text-[11px] text-[#8a919d] mb-1">Benchmark Position</div>
            <div className="text-xs font-semibold text-[#34d399] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{gauge.benchmark}</span>
            </div>
          </div>

          <div className="bg-[#101419] p-3 rounded-lg border border-white/5">
            <div className="text-[11px] text-[#8a919d] mb-1">30-Day Velocity</div>
            <div className="text-xs font-semibold text-[#479ef5] flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{gauge.trendValue}</span>
            </div>
          </div>
        </div>

        {/* Action recommendations */}
        <div>
          <h4 className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider mb-2">
            Priority Action Items
          </h4>
          <ul className="space-y-2 text-xs text-[#c0c7d3]">
            <li className="flex items-start gap-2 bg-[#1a1a1a] p-2.5 rounded-md border border-white/5">
              <AlertCircle className="w-4 h-4 text-[#479ef5] flex-shrink-0 mt-0.5" />
              <span>Enable Microsoft Entra ID Protection automated risk policies for sign-in & user risk.</span>
            </li>
            <li className="flex items-start gap-2 bg-[#1a1a1a] p-2.5 rounded-md border border-white/5">
              <CheckCircle2 className="w-4 h-4 text-[#34d399] flex-shrink-0 mt-0.5" />
              <span>Verify that all Global Admin accounts require FIDO2 hardware keys or Authenticator app.</span>
            </li>
          </ul>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#479ef5] hover:bg-[#388ee0] text-[#001c37] text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
