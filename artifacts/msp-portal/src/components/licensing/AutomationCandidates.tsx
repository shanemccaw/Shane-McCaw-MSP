import React from 'react';
import { AutomationCandidate } from './types';
import { Zap, Rocket, Wand2, Bot, CheckCircle2 } from 'lucide-react';

interface AutomationCandidatesProps {
  candidates: AutomationCandidate[];
  onInitializePatch: (candidate: AutomationCandidate) => void;
}

export const AutomationCandidates: React.FC<AutomationCandidatesProps> = ({
  candidates,
  onInitializePatch,
}) => {
  const getTypePill = (type: string) => {
    switch (type) {
      case 'DELETE':
        return 'bg-[#ffb4ab] text-[#121414] font-bold';
      case 'PATCH':
        return 'bg-[#a0c9ff] text-[#003259] font-bold';
      case 'DEPLOY':
        return 'bg-[#5a3289] text-[#cda3ff] font-bold border border-[#cda3ff]/30';
      default:
        return 'bg-[#333535] text-[#e2e2e2] font-bold';
    }
  };

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'DELETE':
        return 'border-l-2 border-l-[#ffb4ab]';
      case 'PATCH':
        return 'border-l-2 border-l-[#a0c9ff]';
      case 'DEPLOY':
        return 'border-l-2 border-l-[#5a3289]';
      default:
        return '';
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'DELETE':
        return <Rocket className="w-3.5 h-3.5" />;
      case 'PATCH':
        return <Wand2 className="w-3.5 h-3.5" />;
      case 'DEPLOY':
        return <Bot className="w-3.5 h-3.5" />;
      default:
        return <Zap className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="pt-4">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-headline text-xl font-bold text-[#e2e2e2] flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#479ef5]" />
          Automation Candidates
        </h3>
        <span className="text-xs font-mono-tech text-[#c0c7d3]">
          Automated Remediation Engine Active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {candidates.map((card) => {
          const isApplied = card.status === 'applied';

          return (
            <div
              key={card.id}
              className={`glass-card p-6 rounded-xl flex flex-col justify-between ${getBorderColor(
                card.type
              )} relative hover:border-white/20 transition-all`}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className={`status-pill ${getTypePill(card.type)}`}>
                    {card.type}
                  </span>
                  <span className="text-xs font-mono-tech text-[#c0c7d3]">
                    Confidence: <span className="text-[#a0c9ff] font-bold">{card.confidence}%</span>
                  </span>
                </div>

                <h4 className="font-headline text-lg font-semibold text-[#e2e2e2]">
                  {card.title}
                </h4>

                <p className="text-xs font-sans text-[#c0c7d3] mt-2 leading-relaxed">
                  {card.description}
                </p>
              </div>

              <div className="mt-6">
                {isApplied ? (
                  <div className="w-full py-3 bg-green-500/10 border border-green-500/30 rounded text-xs font-mono-tech text-green-400 font-bold flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>PATCH APPLIED (SUCCESS)</span>
                  </div>
                ) : (
                  <button
                    onClick={() => onInitializePatch(card)}
                    className="w-full py-3 bg-[#333535] hover:bg-[#404752] text-[#e2e2e2] hover:text-white font-mono-tech text-xs tracking-wider font-semibold rounded transition-all flex items-center justify-center gap-2 group cursor-pointer border border-white/5 hover:border-[#479ef5]/40"
                  >
                    <span>INITIALIZE PATCH</span>
                    <span className="group-hover:translate-x-0.5 transition-transform">
                      {renderIcon(card.type)}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
