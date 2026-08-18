import React from 'react';
import { X, Trash2, Sparkles, ShieldCheck } from 'lucide-react';
import { Product } from './types';
import { formatPrice, serviceTypeLabel } from './formatting';

interface SubscriptionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProducts: Product[];
  onRemoveProduct: (productId: number) => void;
}

export const SubscriptionsDrawer: React.FC<SubscriptionsDrawerProps> = ({
  isOpen,
  onClose,
  selectedProducts,
  onRemoveProduct,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-[#1e2020]/90 backdrop-blur-xl w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#282a2b] border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#a0c9ff]" />
            <h3 className="font-sans text-lg font-bold text-[#e2e2e2]">
              Selected Products
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
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {selectedProducts.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[#1e2020] border border-white/10 flex items-center justify-center text-[#8a919d]">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="font-sans text-base text-[#e2e2e2]">
                No products selected yet
              </p>
              <p className="text-xs text-[#8a919d] max-w-xs">
                Select products from the marketplace to review them here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <h4 className="font-mono text-xs uppercase text-[#8a919d] tracking-wider">
                Selected Products ({selectedProducts.length})
              </h4>
              {selectedProducts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3.5 bg-[#1e2020] rounded-xl border border-white/5 hover:border-white/10 transition-all"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#e2e2e2]">
                        {p.name}
                      </span>
                      {p.badge && (
                        <span className="px-2 py-0.2 text-[9px] font-mono rounded bg-[#a0c9ff]/10 text-[#a0c9ff]">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8a919d] truncate max-w-xs mt-0.5">
                      {[serviceTypeLabel(p.serviceType), p.category].filter(Boolean).join(' • ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-sans text-sm font-bold text-[#e2e2e2]">
                      {formatPrice(p)}
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
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedProducts.length > 0 && (
          <div className="p-4 bg-[#282a2b] border-t border-white/5 flex items-center justify-between">
            <p className="text-xs text-[#8a919d]">
              Cart &amp; checkout coming soon.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs md:text-sm text-[#c0c7d3] hover:text-white"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
