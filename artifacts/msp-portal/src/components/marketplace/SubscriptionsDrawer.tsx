import React, { useState } from 'react';
import { X, Trash2, ArrowRight, Wallet, CheckCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { Product } from '../types';

interface SubscriptionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProducts: Product[];
  onRemoveProduct: (productId: string) => void;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (cycle: 'monthly' | 'yearly') => void;
  walletBalance: number;
  onConfirmSubscriptions: () => void;
}

export const SubscriptionsDrawer: React.FC<SubscriptionsDrawerProps> = ({
  isOpen,
  onClose,
  selectedProducts,
  onRemoveProduct,
  billingCycle,
  setBillingCycle,
  walletBalance,
  onConfirmSubscriptions,
}) => {
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const totalCost = selectedProducts.reduce((acc, p) => {
    return acc + (billingCycle === 'yearly' ? p.priceYearly : p.priceMonthly);
  }, 0);

  const remainingWallet = walletBalance - totalCost;

  const handleConfirm = () => {
    setIsSuccess(true);
    setTimeout(() => {
      onConfirmSubscriptions();
      setIsSuccess(false);
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="glass-modal w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#282a2b] border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#a0c9ff]" />
            <h3 className="font-headline text-lg font-bold text-[#e2e2e2]">
              Active Subscriptions Review
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#333535] text-[#c0c7d3] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          {isSuccess ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-[#10b981]/20 border border-[#10b981] flex items-center justify-center text-[#10b981] animate-bounce">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h4 className="font-headline text-xl font-bold text-white">
                Solutions Deployed Successfully!
              </h4>
              <p className="text-xs text-[#c0c7d3] max-w-md">
                Your portfolio dashboard is now synchronized with active intelligence, compliance, and security neural monitors.
              </p>
            </div>
          ) : selectedProducts.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[#1e2020] border border-white/10 flex items-center justify-center text-[#8a919d]">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="font-headline text-base text-[#e2e2e2]">
                No solutions selected yet
              </p>
              <p className="text-xs text-[#8a919d] max-w-xs">
                Select products from the marketplace to configure your portfolio intelligence stack.
              </p>
            </div>
          ) : (
            <>
              {/* Billing Cycle Selector */}
              <div className="flex items-center justify-between bg-[#121414] p-3 rounded-xl border border-white/5">
                <span className="text-xs text-[#c0c7d3] font-medium">
                  Billing Terms
                </span>
                <div className="flex bg-[#1e2020] p-1 rounded-lg border border-[#404752] text-xs font-mono-code">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-3 py-1 rounded-md transition-all ${
                      billingCycle === 'monthly'
                        ? 'bg-[#479ef5] text-[#001c37] font-semibold'
                        : 'text-[#c0c7d3]'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('yearly')}
                    className={`px-3 py-1 rounded-md transition-all ${
                      billingCycle === 'yearly'
                        ? 'bg-[#479ef5] text-[#001c37] font-semibold'
                        : 'text-[#c0c7d3]'
                    }`}
                  >
                    Annual (-20%)
                  </button>
                </div>
              </div>

              {/* Products List */}
              <div className="space-y-2.5">
                <h4 className="font-mono-code text-xs uppercase text-[#8a919d] tracking-wider">
                  Selected Solutions ({selectedProducts.length})
                </h4>
                {selectedProducts.map((p) => {
                  const price =
                    billingCycle === 'yearly' ? p.priceYearly : p.priceMonthly;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3.5 bg-[#1e2020] rounded-xl border border-white/5 hover:border-white/10 transition-all"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#e2e2e2]">
                            {p.title}
                          </span>
                          <span className="px-2 py-0.2 text-[9px] font-mono-code rounded bg-[#a0c9ff]/10 text-[#a0c9ff]">
                            {p.badge}
                          </span>
                        </div>
                        <p className="text-xs text-[#8a919d] truncate max-w-xs mt-0.5">
                          {p.category} • {p.provider}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-headline text-sm font-bold text-[#e2e2e2]">
                          ${price}/mo
                        </span>
                        <button
                          onClick={() => onRemoveProduct(p.id)}
                          title="Remove item"
                          className="text-[#8a919d] hover:text-[#ffb4ab] p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Wallet & Cost Breakdown */}
              <div className="bg-[#121414] p-4 rounded-xl border border-white/5 space-y-2 font-mono-code text-xs">
                <div className="flex justify-between text-[#c0c7d3]">
                  <span>Current Wallet Balance</span>
                  <span>${walletBalance.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[#a0c9ff]">
                  <span>Total Solutions Cost</span>
                  <span>-${totalCost.toLocaleString()}/mo</span>
                </div>
                <div className="pt-2 border-t border-white/5 flex justify-between text-sm font-bold text-[#e2e2e2]">
                  <span>Remaining Wallet Balance</span>
                  <span className={remainingWallet < 0 ? 'text-[#ffb4ab]' : 'text-[#10b981]'}>
                    ${remainingWallet.toLocaleString()}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isSuccess && selectedProducts.length > 0 && (
          <div className="p-4 bg-[#282a2b] border-t border-white/5 flex items-center justify-between">
            <div>
              <p className="font-mono-code text-[10px] text-[#8a919d] uppercase">
                Total Monthly Investment
              </p>
              <p className="font-headline text-xl font-bold text-[#e2e2e2]">
                ${totalCost}
                <span className="text-xs text-[#c0c7d3] font-normal">/mo</span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs md:text-sm text-[#c0c7d3] hover:text-white"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2.5 rounded-lg bg-[#479ef5] text-[#001c37] font-semibold text-xs md:text-sm hover:bg-[#a0c9ff] transition-all cursor-pointer flex items-center gap-2 shadow-[0_0_16px_rgba(71,158,245,0.4)]"
              >
                <span>Confirm & Activate</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
