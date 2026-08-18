import React from 'react';
import { X, CheckCircle2, BarChart3, ShieldCheck, Sparkles, Repeat, Package } from 'lucide-react';
import { Product } from './types';
import { formatPrice, serviceTypeLabel } from './formatting';

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  isSelected: boolean;
  onToggleSelect: (productId: number) => void;
}

function getIcon(serviceType: string | null) {
  switch (serviceType) {
    case 'assessment':
      return <ShieldCheck className="w-8 h-8 text-[#dab9ff]" />;
    case 'monitoring_tier':
      return <BarChart3 className="w-8 h-8 text-[#a0c9ff]" />;
    case 'micro_offer':
      return <Sparkles className="w-8 h-8 text-[#a0c9ff]" />;
    case 'retainer':
      return <Repeat className="w-8 h-8 text-[#a0c9ff]" />;
    default:
      return <Package className="w-8 h-8 text-[#a0c9ff]" />;
  }
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
  isSelected,
  onToggleSelect,
}) => {
  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-[#1e2020]/90 backdrop-blur-xl w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#282a2b] border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#121414] border border-white/10 flex items-center justify-center">
              {getIcon(product.serviceType)}
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase text-[#a0c9ff] tracking-wider font-semibold">
                {[serviceTypeLabel(product.serviceType), product.category, product.badge]
                  .filter(Boolean)
                  .join(' • ')}
              </span>
              <h3 className="font-sans text-lg font-bold text-[#e2e2e2]">
                {product.name}
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
            {product.tagline && (
              <p className="text-sm text-[#a0c9ff] font-medium mb-1.5">{product.tagline}</p>
            )}
            <p className="text-sm text-[#e2e2e2] leading-relaxed">
              {product.description || 'No description available.'}
            </p>
          </div>

          {/* Key Features list */}
          {product.deliverables.length > 0 && (
            <div>
              <h4 className="font-mono text-xs uppercase text-[#8a919d] tracking-wider mb-2.5">
                Deliverables
              </h4>
              <div className="space-y-2">
                {product.deliverables.map((deliverable, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 text-xs md:text-sm text-[#c0c7d3] bg-[#1e2020] p-2.5 rounded-lg border border-white/5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#a0c9ff] shrink-0 mt-0.5" />
                    <span>{deliverable}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#282a2b] border-t border-white/5 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] text-[#8a919d] uppercase">
              {product.priceCents == null ? 'Pricing' : 'Cost'}
            </p>
            <p className="font-sans text-xl font-bold text-[#e2e2e2]">
              {formatPrice(product)}
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
              {isSelected ? 'Remove Selection' : 'Add to Selection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
