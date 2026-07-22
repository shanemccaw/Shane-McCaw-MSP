import React, { useState } from 'react';
import {
  Shield,
  Gavel,
  Bot,
  Receipt,
  Network,
  CheckCircle2,
  Wrench,
  AlertOctagon,
  AlertTriangle,
  Info,
  Filter,
  Sparkles,
} from 'lucide-react';
import { IntelligenceSignal } from './types';

interface IntelligenceSignalsProps {
  signals: IntelligenceSignal[];
  onAcknowledgeSignal: (id: string) => void;
  onRemediateSignal: (id: string) => void;
  onSelectSignal: (signal: IntelligenceSignal) => void;
}

export const IntelligenceSignals: React.FC<IntelligenceSignalsProps> = ({
  signals,
  onAcknowledgeSignal,
  onRemediateSignal,
  onSelectSignal,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<string>('All');

  const filteredSignals = signals.filter((s) => {
    if (filterSeverity === 'All') return true;
    return s.severity === filterSeverity;
  });

  const getPillarIcon = (pillar: string) => {
    switch (pillar.toLowerCase()) {
      case 'security':
        return <Shield className="w-5 h-5 text-[#a0c9ff]" />;
      case 'governance':
        return <Gavel className="w-5 h-5 text-[#dab9ff]" />;
      case 'copilot':
        return <Bot className="w-5 h-5 text-[#a0c9ff]" />;
      case 'licensing':
        return <Receipt className="w-5 h-5 text-[#d2e4ff]" />;
      case 'architecture':
        return <Network className="w-5 h-5 text-[#8a919d]" />;
      default:
        return <Shield className="w-5 h-5 text-[#a0c9ff]" />;
    }
  };

  const getSeverityBadge = (severity: IntelligenceSignal['severity']) => {
    switch (severity) {
      case 'Critical':
        return (
          <span className="status-pill bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/30 flex items-center space-x-1">
            <AlertOctagon className="w-3 h-3" />
            <span>Critical</span>
          </span>
        );
      case 'Warning':
        return (
          <span className="status-pill bg-[#c8c6c5]/20 text-[#e2e2e2] border border-[#c8c6c5]/30 flex items-center space-x-1">
            <AlertTriangle className="w-3 h-3 text-[#dab9ff]" />
            <span>Warning</span>
          </span>
        );
      case 'Optimization':
        return (
          <span className="status-pill bg-[#a0c9ff]/20 text-[#a0c9ff] border border-[#a0c9ff]/30 flex items-center space-x-1">
            <Sparkles className="w-3 h-3" />
            <span>Optimization</span>
          </span>
        );
    }
  };

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden mb-6">
      {/* Header */}
      <div className="bg-[#1e2020] px-6 py-4 border-b border-[#404752]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-bold text-[#e2e2e2]">
            Cross-Pillar Intelligence Signals
          </h3>
          <p className="text-xs text-[#8a919d] font-mono mt-0.5">
            Real-time multi-vector correlation log
          </p>
        </div>

        {/* Severity Filter Tabs */}
        <div className="flex items-center space-x-1.5 bg-[#121414] p-1 rounded-lg border border-[#404752]">
          {['All', 'Critical', 'Warning', 'Optimization'].map((sev) => (
            <button
              key={sev}
              onClick={() => setFilterSeverity(sev)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                filterSeverity === sev
                  ? 'bg-[#282a2b] text-[#a0c9ff] font-bold border border-[#404752]'
                  : 'text-[#8a919d] hover:text-[#c0c7d3]'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* Signals List */}
      <div className="divide-y divide-[#404752]/40">
        {filteredSignals.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[#8a919d]">
            No signals match the selected severity filter.
          </div>
        ) : (
          filteredSignals.map((sig) => (
            <div
              key={sig.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 hover:bg-[#282a2b] transition-colors group gap-4 ${
                sig.remediated ? 'opacity-50 bg-[#121414]/40' : ''
              }`}
            >
              <div
                className="flex items-start space-x-4 cursor-pointer flex-grow"
                onClick={() => onSelectSignal(sig)}
              >
                <div className="mt-0.5 flex-shrink-0">{getPillarIcon(sig.pillar)}</div>

                <div>
                  <div className="flex items-center space-x-2">
                    <p className={`text-sm font-semibold ${sig.remediated ? 'line-through text-[#8a919d]' : 'text-[#e2e2e2]'}`}>
                      {sig.title}
                    </p>
                    {sig.acknowledged && !sig.remediated && (
                      <span className="text-[10px] font-mono text-[#a0c9ff] bg-[#00345c] px-1.5 py-0.5 rounded">
                        ACKNOWLEDGED
                      </span>
                    )}
                    {sig.remediated && (
                      <span className="text-[10px] font-mono text-[#a0c9ff] bg-[#1a1c1c] border border-[#a0c9ff]/40 px-1.5 py-0.5 rounded flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3 text-[#a0c9ff]" />
                        <span>REMEDIATED</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#c0c7d3] mt-0.5 leading-relaxed">
                    {sig.description}
                  </p>
                </div>
              </div>

              {/* Status Badge & Hover Quick Actions */}
              <div className="flex items-center space-x-3 justify-end flex-shrink-0">
                <span className="text-[10px] font-mono text-[#8a919d] hidden md:inline">
                  {sig.timestamp}
                </span>

                {getSeverityBadge(sig.severity)}

                {/* Interactive Action Buttons */}
                {!sig.remediated && (
                  <div className="flex items-center space-x-1">
                    {!sig.acknowledged && (
                      <button
                        onClick={() => onAcknowledgeSignal(sig.id)}
                        className="px-2 py-1 text-[10px] font-mono bg-[#1a1c1c] text-[#c0c7d3] hover:text-[#a0c9ff] hover:bg-[#333535] rounded border border-[#404752] transition-colors"
                        title="Acknowledge Signal"
                      >
                        Ack
                      </button>
                    )}

                    <button
                      onClick={() => onRemediateSignal(sig.id)}
                      className="px-2.5 py-1 text-[10px] font-mono bg-[#479ef5]/20 text-[#a0c9ff] hover:bg-[#479ef5] hover:text-[#00345c] rounded border border-[#479ef5]/40 font-bold transition-all flex items-center space-x-1"
                      title="Run Auto-Remediation Workflow"
                    >
                      <Wrench className="w-3 h-3" />
                      <span>Remediate</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
