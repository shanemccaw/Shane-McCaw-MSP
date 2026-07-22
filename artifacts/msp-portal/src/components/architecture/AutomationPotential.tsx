import React from 'react';
import { Zap, Wrench, Radio, Check, Play } from 'lucide-react';
import { AutomationTarget } from './types';

interface AutomationPotentialProps {
  targets: AutomationTarget[];
  onApplyTarget: (id: string) => void;
  onApplyAll: () => void;
  isAllExecuted: boolean;
}

export const AutomationPotential: React.FC<AutomationPotentialProps> = ({
  targets,
  onApplyTarget,
  onApplyAll,
  isAllExecuted,
}) => {
  const getIcon = (type: AutomationTarget['iconType']) => {
    switch (type) {
      case 'lightning':
        return <Zap className="h-4 w-4 text-[#479ef5]" />;
      case 'wrench':
        return <Wrench className="h-4 w-4 text-[#479ef5]" />;
      case 'antenna':
      default:
        return <Radio className="h-4 w-4 text-[#479ef5]" />;
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-semibold text-[#e2e2e2]">
            Automation Potential
          </h2>
          {!isAllExecuted && (
            <button
              type="button"
              onClick={onApplyAll}
              className="inline-flex items-center gap-1 rounded bg-[#001c37] border border-[#479ef5]/40 px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-[#a0c9ff] hover:bg-[#479ef5] hover:text-[#001c37] transition-all"
            >
              <Play className="h-3 w-3 fill-current" />
              Automate All
            </button>
          )}
        </div>

        {/* 3 Action Target Cards */}
        <div className="space-y-2.5">
          {targets.map((tgt) => (
            <div
              key={tgt.id}
              onClick={() => tgt.status === 'pending' && onApplyTarget(tgt.id)}
              className={`flex items-center justify-between rounded-md border p-3 transition-all ${
                tgt.status === 'executed'
                  ? 'border-emerald-500/30 bg-emerald-950/10'
                  : 'border-[#282a2b] bg-[#121414] hover:border-[#479ef5]/50 hover:bg-[#282a2b]/40 cursor-pointer'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-xs font-bold ${
                      tgt.status === 'executed'
                        ? 'text-emerald-400 line-through'
                        : 'text-[#e2e2e2]'
                    }`}
                  >
                    {tgt.title}
                  </span>
                  {tgt.status === 'executed' && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400">
                      <Check className="h-2.5 w-2.5" /> EXECUTED
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-[#8a919d]">
                  Target: <span className="text-[#c0c7d3]">{tgt.targetMethod}</span>{' '}
                  <span className="text-[#8a919d]">{tgt.targetPath}</span>
                </div>
              </div>

              <div className="p-1">
                {tgt.status === 'executed' ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  getIcon(tgt.iconType)
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Projection Quote Banner */}
      <div className="mt-5 rounded-md border border-[#282a2b] bg-[#121414] p-3 text-center">
        <p className="font-mono text-xs italic text-[#c0c7d3]">
          &ldquo;By automating these 3 targets, the Architecture Score is projected
          to increase to <strong className="text-[#a0c9ff]">94/100</strong>.&rdquo;
        </p>
      </div>
    </div>
  );
};
