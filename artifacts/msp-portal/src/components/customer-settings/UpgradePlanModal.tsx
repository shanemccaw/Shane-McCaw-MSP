import React from 'react';
import { X, Check, Zap, Shield } from 'lucide-react';

interface UpgradePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlan: (planName: string) => void;
}

export const UpgradePlanModal: React.FC<UpgradePlanModalProps> = ({
  isOpen,
  onClose,
  onSelectPlan,
}) => {
  if (!isOpen) return null;

  const plans = [
    {
      name: 'Starter',
      price: '$199',
      period: '/month',
      description: 'Ideal for small property portfolios up to 25 units.',
      features: ['Up to 5 Team Members', 'Standard Audit Trail', 'Daily Portfolio Snapshots', 'Email Support'],
      current: false,
    },
    {
      name: 'Enterprise Intelligence',
      price: '$499',
      period: '/month',
      description: 'For institutional portfolio managers with advanced compliance needs.',
      features: [
        'Unlimited Team Members',
        'Real-time Global Audit Trail',
        'Custom Data Retention (up to 15 yrs)',
        'Custom Webhooks & API Access',
        '24/7 Priority Support',
      ],
      current: true,
      popular: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl max-w-2xl w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-[#282a2b]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 pb-4 border-b border-[#282a2b]">
          <div className="p-2 rounded-lg bg-[#3881e6]/10 text-[#479ef5]">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-lg text-[#f1f3f5]">Upgrade Workspace Plan</h3>
            <p className="text-xs text-[#8a919d]">Unlock higher tenant capacity and compliance tools.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl p-5 border flex flex-col justify-between transition-all ${
                plan.popular
                  ? 'bg-[#141616] border-[#479ef5] shadow-lg shadow-[#479ef5]/10 relative'
                  : 'bg-[#141616] border-[#282a2b]'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 right-4 bg-[#3881e6] text-white text-[10px] font-mono font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                  Current Plan
                </span>
              )}

              <div>
                <h4 className="font-display font-semibold text-base text-white">{plan.name}</h4>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-display font-bold text-2xl text-white">{plan.price}</span>
                  <span className="text-xs text-[#8a919d]">{plan.period}</span>
                </div>
                <p className="text-xs text-[#8a919d] mt-2 leading-relaxed">{plan.description}</p>

                <div className="mt-4 pt-4 border-t border-[#282a2b] flex flex-col gap-2">
                  {plan.features.map((feat) => (
                    <div key={feat} className="flex items-center gap-2 text-xs text-[#d0d6e0]">
                      <Check className="w-3.5 h-3.5 text-[#479ef5] shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={() => onSelectPlan(plan.name)}
                  className={`w-full py-2 px-4 rounded-md text-xs font-medium transition-all ${
                    plan.popular
                      ? 'bg-[#282a2b] text-[#e2e2e2] hover:bg-[#333535]'
                      : 'bg-[#3881e6] hover:bg-[#479ef5] text-white shadow-sm'
                  }`}
                >
                  {plan.popular ? 'Active Plan' : 'Select Plan'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
