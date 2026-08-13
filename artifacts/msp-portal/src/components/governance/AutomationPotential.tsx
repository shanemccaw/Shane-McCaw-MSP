import React from 'react';
import { GovernanceAutomation } from './types';
import { Bot, UserPlus, UserMinus, ShieldCheck, Zap, Check, Loader2 } from 'lucide-react';

interface AutomationPotentialProps {
  automations: GovernanceAutomation[];
  onExecute: (id: string) => void;
}

export const AutomationPotential: React.FC<AutomationPotentialProps> = ({
  automations,
  onExecute
}) => {
  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'UserPlus':
        return <UserPlus className="w-5 h-5 text-[#479ef5]" />;
      case 'UserMinus':
        return <UserMinus className="w-5 h-5 text-[#c084fc]" />;
      case 'ShieldCheck':
        return <ShieldCheck className="w-5 h-5 text-[#22c55e]" />;
      default:
        return <Bot className="w-5 h-5 text-[#479ef5]" />;
    }
  };

  const getStatusBadge = (status: string, accent: string) => {
    if (status === 'EXECUTED') {
      return (
        <span className="font-mono text-[10px] text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/30 px-2 py-0.5 rounded flex items-center gap-1 font-semibold">
          <Check className="w-3 h-3" /> EXECUTED
        </span>
      );
    }
    if (status === 'EXECUTING') {
      return (
        <span className="font-mono text-[10px] text-[#eab308] bg-[#eab308]/10 border border-[#eab308]/30 px-2 py-0.5 rounded flex items-center gap-1 font-semibold">
          <Loader2 className="w-3 h-3 animate-spin" /> RUNNING
        </span>
      );
    }

    if (accent === 'violet') {
      return (
        <span className="font-mono text-[10px] text-[#c084fc] bg-[#c084fc]/10 border border-[#c084fc]/30 px-2 py-0.5 rounded font-semibold">
          READY
        </span>
      );
    }
    if (accent === 'green') {
      return (
        <span className="font-mono text-[10px] text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/30 px-2 py-0.5 rounded font-semibold">
          READY
        </span>
      );
    }
    return (
      <span className="font-mono text-[10px] text-[#479ef5] bg-[#479ef5]/10 border border-[#479ef5]/30 px-2 py-0.5 rounded font-semibold">
        READY
      </span>
    );
  };

  return (
    <section className="space-y-4">
      <h3 className="font-headline text-xl font-semibold flex items-center gap-2 text-[#e2e2e2]">
        <Bot className="w-5 h-5 text-[#479ef5]" />
        Governance Automation Potential
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {automations.map((auto) => (
          <div
            key={auto.id}
            className={`bg-card border border-border p-6 rounded-xl flex flex-col justify-between transition-all duration-300 ${
              auto.accentColor === 'violet'
                ? 'border-t-2 border-t-[#c084fc]/40 hover:border-[#c084fc]'
                : auto.accentColor === 'green'
                ? 'border-t-2 border-t-[#22c55e]/40 hover:border-[#22c55e]'
                : 'border-t-2 border-t-[#479ef5]/40 hover:border-[#479ef5]'
            }`}
          >
            <div>
              <div className="flex justify-between items-center mb-4">
                {getIcon(auto.icon)}
                {getStatusBadge(auto.status, auto.accentColor)}
              </div>

              <h4 className="font-headline text-base font-semibold text-[#e2e2e2] mb-1">
                {auto.title}
              </h4>
              <p className="font-body text-xs text-[#8a919d] mb-4 min-h-[36px]">
                {auto.description}
              </p>

              <div className="p-2.5 bg-black/40 rounded font-mono text-[11px] text-[#c0c7d3] flex items-center gap-2 overflow-x-auto border border-white/5">
                <span
                  className={`font-semibold ${
                    auto.accentColor === 'violet'
                      ? 'text-[#c084fc]'
                      : auto.accentColor === 'green'
                      ? 'text-[#22c55e]'
                      : 'text-[#479ef5]'
                  }`}
                >
                  {auto.httpMethod}
                </span>
                <span className="truncate">{auto.endpoint}</span>
              </div>
            </div>

            <button
              onClick={() => onExecute(auto.id)}
              disabled={auto.status !== 'READY'}
              className={`mt-6 w-full py-2.5 px-4 font-body text-xs font-semibold rounded transition-all flex items-center justify-center gap-2 ${
                auto.status === 'EXECUTED'
                  ? 'bg-[#22c55e]/15 border border-[#22c55e]/40 text-[#22c55e] cursor-default'
                  : auto.status === 'EXECUTING'
                  ? 'bg-white/5 text-[#8a919d] cursor-wait'
                  : auto.accentColor === 'violet'
                  ? 'border border-[#c084fc] text-[#c084fc] hover:bg-[#c084fc]/15'
                  : auto.accentColor === 'green'
                  ? 'border border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e]/15'
                  : 'bg-[#479ef5] text-[#001c37] hover:brightness-110 shadow-[0_0_12px_rgba(71,158,245,0.3)]'
              }`}
            >
              {auto.status === 'EXECUTING' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : auto.status === 'EXECUTED' ? (
                <>
                  <Check className="w-4 h-4" />
                  Policy Enforced
                </>
              ) : (
                <>
                  {auto.actionText}
                  <Zap className="w-3.5 h-3.5 fill-current" />
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
