import React from 'react';
import { AutomationPolicy } from '../types';
import { Zap, Activity, CheckCircle2, RefreshCw } from 'lucide-react';

interface SecurityAutomationProps {
  policies: AutomationPolicy[];
  onTriggerPolicy: (policy: AutomationPolicy) => void;
  activeProcessingId: string | null;
}

export const SecurityAutomation: React.FC<SecurityAutomationProps> = ({
  policies,
  onTriggerPolicy,
  activeProcessingId,
}) => {
  return (
    <div className="space-y-4 flex flex-col justify-between h-full">
      <div className="space-y-4">
        <h2 className="font-headline text-lg font-semibold text-[#a0c9ff] flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#a0c9ff]" />
          Security Automation Potential
        </h2>

        <div className="grid grid-cols-1 gap-3">
          {policies.map((policy) => {
            const isProcessing = activeProcessingId === policy.id;
            const isDone = policy.status === 'enforced' || policy.status === 'synced' || policy.status === 'reviewed';

            return (
              <div
                key={policy.id}
                className={`glass-card p-4 rounded-xl flex items-center justify-between border-l-4 ${policy.borderClass} transition-all`}
              >
                <div>
                  <p className="font-headline text-2xl font-bold text-white mb-0.5">
                    {policy.percentageOrCount}
                  </p>
                  <p className="font-body text-sm text-[#e2e2e2] font-medium">{policy.title}</p>
                  <p className="text-[#c0c7d3] text-xs font-mono mt-0.5">{policy.subtext}</p>
                </div>

                <button
                  onClick={() => onTriggerPolicy(policy)}
                  disabled={isProcessing}
                  className={`px-4 py-1.5 rounded-lg font-mono text-xs font-semibold tracking-wider transition-all duration-200 shadow flex items-center gap-2 ${
                    isDone
                      ? 'bg-[#1a1c1c] text-[#40c463] border border-[#40c463]/40'
                      : `${policy.btnBgClass} ${policy.btnHoverClass} ${policy.btnTextClass}`
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      RUNNING
                    </>
                  ) : isDone ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      DONE
                    </>
                  ) : (
                    policy.actionText
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* System Status / Meta Info Banner */}
      <div className="bg-[#1e2020] rounded-lg p-3.5 border border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-2.5 h-2.5">
            <div className="absolute inset-0 bg-[#c8ffc8] rounded-full animate-ping opacity-75"></div>
            <div className="relative w-2.5 h-2.5 bg-[#40c463] rounded-full"></div>
          </div>
          <span className="font-mono text-xs text-[#c0c7d3] font-medium tracking-wide">
            GRAPH API STREAMING: ACTIVE
          </span>
        </div>
        <div className="text-[#c0c7d3] font-mono text-xs">v4.0.2-prod-obsidian</div>
      </div>
    </div>
  );
};
