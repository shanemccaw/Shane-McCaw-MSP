import React from 'react';
import {
  X,
  Shield,
  Gavel,
  ShieldCheck,
  Users,
  Bot,
  Network,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  TrendingUp,
  Target,
} from 'lucide-react';
import { PillarData } from '../types';

interface PillarDetailModalProps {
  pillar: PillarData | null;
  onClose: () => void;
  onRunRecommendation: (pillarId: string, recommendation: string) => void;
}

export const PillarDetailModal: React.FC<PillarDetailModalProps> = ({
  pillar,
  onClose,
  onRunRecommendation,
}) => {
  if (!pillar) return null;

  const getPillarIcon = (iconName: string) => {
    switch (iconName) {
      case 'Shield':
        return Shield;
      case 'Gavel':
        return Gavel;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'Users':
        return Users;
      case 'Bot':
        return Bot;
      case 'Network':
        return Network;
      case 'Receipt':
        return Receipt;
      default:
        return Shield;
    }
  };

  const IconComponent = getPillarIcon(pillar.icon);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="glass-card bg-[#1e2020] border border-[#404752] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-[#404752] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${pillar.color}20`, color: pillar.color }}
            >
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-headline text-xl font-bold text-[#e2e2e2]">
                  {pillar.name} Pillar Telemetry
                </h3>
                <span className="status-pill bg-[#333535] text-[#a0c9ff]">
                  {pillar.shortCode}
                </span>
              </div>
              <p className="text-xs text-[#c0c7d3] mt-0.5">{pillar.description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8a919d] hover:text-[#e2e2e2] hover:bg-[#333535] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Top Score Banner */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-[#121414] rounded-xl border border-[#404752]/50 text-center">
            <div>
              <p className="text-[10px] font-mono text-[#8a919d] uppercase">Current Score</p>
              <p className="text-3xl font-headline font-bold mt-0.5" style={{ color: pillar.color }}>
                {pillar.score}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-mono text-[#8a919d] uppercase">Target Benchmark</p>
              <p className="text-3xl font-headline font-bold text-[#e2e2e2] mt-0.5">
                {pillar.targetScore}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-mono text-[#8a919d] uppercase">30-Day Velocity</p>
              <p className="text-2xl font-headline font-bold text-[#a0c9ff] mt-1 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 mr-1" />
                +{pillar.change}%
              </p>
            </div>
          </div>

          {/* Sub-metrics breakdown */}
          <div>
            <h4 className="text-xs font-mono font-bold text-[#c0c7d3] uppercase mb-3">
              Diagnostic Controls & Sub-Metrics
            </h4>
            <div className="space-y-2">
              {pillar.subMetrics.map((m, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-[#1a1c1c] rounded-lg border border-[#404752]/40"
                >
                  <span className="text-xs font-mono text-[#e2e2e2]">{m.name}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-[#a0c9ff]">{m.value}</span>
                    {m.status === 'good' && (
                      <CheckCircle2 className="w-4 h-4 text-[#a0c9ff]" />
                    )}
                    {m.status === 'warning' && (
                      <AlertTriangle className="w-4 h-4 text-[#dab9ff]" />
                    )}
                    {m.status === 'critical' && (
                      <AlertTriangle className="w-4 h-4 text-[#ffb4ab]" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prescriptive Remediation Steps */}
          <div>
            <h4 className="text-xs font-mono font-bold text-[#c0c7d3] uppercase mb-3">
              Recommended Remediation Actions
            </h4>
            <div className="space-y-2">
              {pillar.recommendations.map((rec, rIdx) => (
                <div
                  key={rIdx}
                  className="flex items-center justify-between p-3 bg-[#1a1c1c] rounded-lg border border-[#404752]/40 gap-3"
                >
                  <p className="text-xs text-[#c0c7d3] leading-relaxed flex-grow">{rec}</p>
                  <button
                    onClick={() => onRunRecommendation(pillar.id, rec)}
                    className="px-3 py-1.5 bg-[#479ef5]/20 text-[#a0c9ff] hover:bg-[#479ef5] hover:text-[#00345c] font-mono text-xs font-bold rounded-lg border border-[#479ef5]/40 transition-all flex items-center space-x-1 flex-shrink-0 cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Apply Fix</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-[#121414] border-t border-[#404752] flex justify-between items-center text-xs font-mono text-[#8a919d]">
          <span>Obsidian Metric Core Policy Ruleset #841</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#333535] text-[#e2e2e2] rounded-lg border border-[#404752] hover:bg-[#38393a]"
          >
            Close Telemetry View
          </button>
        </div>
      </div>
    </div>
  );
};
