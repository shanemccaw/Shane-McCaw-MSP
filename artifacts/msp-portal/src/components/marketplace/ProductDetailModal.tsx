import React from 'react';
import {
  X,
  CheckCircle2,
  Star,
  Building2,
  ShieldAlert,
  Zap,
  BarChart3,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Lock,
  Leaf,
} from 'lucide-react';
import { Product } from './types';

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  isSelected: boolean;
  onToggleSelect: (productId: string) => void;
  billingCycle: 'monthly' | 'yearly';
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
  isSelected,
  onToggleSelect,
  billingCycle,
}) => {
  if (!isOpen || !product) return null;

  const currentPrice =
    billingCycle === 'yearly' ? product.priceYearly : product.priceMonthly;

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'analytics':
        return <BarChart3 className="w-8 h-8 text-[#a0c9ff]" />;
      case 'shield':
        return <ShieldCheck className="w-8 h-8 text-[#dab9ff]" />;
      case 'sparkles':
        return <Sparkles className="w-8 h-8 text-[#a0c9ff]" />;
      case 'message':
        return <MessageSquare className="w-8 h-8 text-[#a0c9ff]" />;
      case 'lock':
        return <Lock className="w-8 h-8 text-[#ffb4ab]" />;
      case 'leaf':
        return <Leaf className="w-8 h-8 text-[#dab9ff]" />;
      default:
        return <BarChart3 className="w-8 h-8 text-[#a0c9ff]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-[#1e2020]/90 backdrop-blur-xl w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#282a2b] border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#121414] border border-white/10 flex items-center justify-center">
              {getIcon(product.iconName)}
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase text-[#a0c9ff] tracking-wider font-semibold">
                {product.category} • {product.badge}
              </span>
              <h3 className="font-sans text-lg font-bold text-[#e2e2e2]">
                {product.title}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#333535] text-[#c0c7d3] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Description */}
          <div>
            <h4 className="font-mono text-xs uppercase text-[#8a919d] tracking-wider mb-1">
              Overview
            </h4>
            <p className="text-sm text-[#e2e2e2] leading-relaxed">
              {product.description}
            </p>
          </div>

          {/* Key Metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-[#121414] p-3.5 rounded-xl border border-white/5">
            <div>
              <p className="font-mono text-[10px] text-[#8a919d] uppercase">Rating</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Star className="w-3.5 h-3.5 fill-[#a0c9ff] text-[#a0c9ff]" />
                <span className="text-sm font-bold text-[#e2e2e2]">
                  {product.rating}
                </span>
                <span className="text-xs text-[#8a919d]">({product.reviewsCount})</span>
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] text-[#8a919d] uppercase">Active Deployments</p>
              <p className="text-sm font-bold text-[#e2e2e2] mt-0.5">
                {product.activeTeams} Teams
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <p className="font-mono text-[10px] text-[#8a919d] uppercase">Provider</p>
              <p className="text-xs font-semibold text-[#a0c9ff] truncate mt-0.5">
                {product.provider}
              </p>
            </div>
          </div>

          {/* Key Features list */}
          <div>
            <h4 className="font-mono text-xs uppercase text-[#8a919d] tracking-wider mb-2.5">
              Capabilities & Features
            </h4>
            <div className="space-y-2">
              {product.features.map((feature, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 text-xs md:text-sm text-[#c0c7d3] bg-[#1e2020] p-2.5 rounded-lg border border-white/5"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#a0c9ff] shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#282a2b] border-t border-white/5 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] text-[#8a919d] uppercase">
              Subscription Cost
            </p>
            <p className="font-sans text-xl font-bold text-[#e2e2e2]">
              ${currentPrice}
              <span className="text-xs text-[#c0c7d3] font-normal">/mo</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs md:text-sm text-[#c0c7d3] hover:text-white"
            >
              Close
            </button>
            <button
              onClick={() => {
                onToggleSelect(product.id);
              }}
              className={`px-5 py-2.5 rounded-lg text-xs md:text-sm font-semibold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-[#10b981] text-white hover:bg-[#059669]'
                  : 'bg-[#479ef5] text-[#001c37] hover:bg-[#a0c9ff]'
              }`}
            >
              {isSelected ? 'Remove Subscription' : 'Add to Subscriptions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
