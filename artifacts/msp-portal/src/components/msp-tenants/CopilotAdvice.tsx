import React, { useState } from 'react';

interface CopilotAdviceProps {
  onGenerateScript: () => void;
}

export const CopilotAdvice: React.FC<CopilotAdviceProps> = ({ onGenerateScript }) => {
  const [dismissed, setDismissed] = useState(false);
  const [currentAdviceIndex, setCurrentAdviceIndex] = useState(0);

  const adviceList = [
    {
      text: `"I've noticed 3 tenants have overlapping MFA exclusion policies that violate your global baseline. Would you like me to generate a remediation script?"`,
      tag: 'MFA Drift',
    },
    {
      text: `"Stark Industries GDAP session expires in 48 hours. I can auto-dispatch an extension request to the client global admin."`,
      tag: 'GDAP Renewal',
    },
    {
      text: `"Contoso Corp user activity shows 40% growth in Entra ID P2 adoption. Potential $2,400/mo license upsell opportunity."`,
      tag: 'Revenue Signal',
    },
  ];

  if (dismissed) {
    return (
      <div className="w-full lg:w-80 glass-dark rounded-xl p-4 border border-white/5 flex items-center justify-between text-xs text-[#bfc7d3]/60">
        <span className="font-mono">Copilot Standing By</span>
        <button
          onClick={() => setDismissed(false)}
          className="text-[#99cbff] hover:underline font-mono text-[10px]"
        >
          Restore Advice
        </button>
      </div>
    );
  }

  const advice = adviceList[currentAdviceIndex];

  return (
    <div className="w-full lg:w-80 glass-dark rounded-xl p-5 border border-white/5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono text-[#bfc7d3] uppercase tracking-widest font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-[#99cbff]">psychology</span>
            Admin Copilot Advice
          </h3>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#99cbff]/10 text-[#99cbff]">
            {advice.tag}
          </span>
        </div>

        <div className="bg-[#99cbff]/5 rounded-lg p-3.5 border border-[#99cbff]/20">
          <p className="text-[11px] text-[#e2e2e6]/90 leading-relaxed italic">
            {advice.text}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onGenerateScript}
              className="px-3 py-1.5 bg-[#99cbff] text-[#003355] hover:brightness-110 text-[10px] font-bold font-mono rounded uppercase transition-all shadow-sm flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-xs">code</span>
              Generate
            </button>
            <button
              onClick={() => {
                if (currentAdviceIndex < adviceList.length - 1) {
                  setCurrentAdviceIndex(currentAdviceIndex + 1);
                } else {
                  setDismissed(true);
                }
              }}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[#bfc7d3] text-[10px] font-bold font-mono rounded uppercase transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 text-right">
        <button
          onClick={() => setCurrentAdviceIndex((prev) => (prev + 1) % adviceList.length)}
          className="text-[9px] font-mono text-[#bfc7d3]/40 hover:text-[#99cbff] transition-colors"
        >
          Next Insight ({currentAdviceIndex + 1}/{adviceList.length}) →
        </button>
      </div>
    </div>
  );
};
