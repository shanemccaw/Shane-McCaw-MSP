import React from 'react';
import { AutomationAction } from './types';
import { Megaphone, Zap, Sparkles, ArrowRight } from 'lucide-react';

interface AutomationPotentialProps {
  actions: AutomationAction[];
  onTriggerAction: (action: AutomationAction) => void;
  activeActionId?: string | null;
}

export const AutomationPotential: React.FC<AutomationPotentialProps> = ({
  actions,
  onTriggerAction,
  activeActionId
}) => {
  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'campaign':
        return <Megaphone className="w-5 h-5 text-[#479ef5]" />;
      case 'bolt':
        return <Zap className="w-5 h-5 text-[#dab9ff]" />;
      case 'auto_fix_high':
        return <Sparkles className="w-5 h-5 text-amber-500" />;
      default:
        return <Zap className="w-5 h-5 text-[#479ef5]" />;
    }
  };

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-8">
      {actions.map((act) => {
        const isExecuting = activeActionId === act.id;
        const isPrimaryBtn = act.buttonLabel === 'APPLY';

        return (
          <div
            key={act.id}
            className="p-6 rounded-xl flex flex-col gap-4 border border-white/10 hover:border-white/20 transition-all justify-between group"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `${act.accentColor}15` }}
                >
                  {renderIcon(act.icon)}
                </div>
                <h3 className="font-headline text-lg font-bold text-white tracking-tight">
                  {act.title}
                </h3>
              </div>

              <p className="font-body text-xs text-[#8a919d] leading-relaxed">
                {act.description}
              </p>
            </div>

            <button
              onClick={() => onTriggerAction(act)}
              disabled={isExecuting}
              className={`mt-2 py-2.5 px-4 rounded-lg font-mono-data text-xs font-bold transition-all active:scale-95 duration-150 flex items-center justify-center gap-2 ${
                isPrimaryBtn
                  ? 'bg-[#479ef5] hover:bg-[#388de4] text-[#003259] shadow-md shadow-[#479ef5]/10'
                  : 'border border-white/20 hover:bg-white/10 text-white'
              }`}
            >
              <span>{isExecuting ? 'Processing...' : act.buttonLabel}</span>
              {!isExecuting && <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        );
      })}
    </section>
  );
};
