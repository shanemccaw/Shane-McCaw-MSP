import React from 'react';
import { BarChart3, ShieldCheck, Sparkles, Repeat, Package, Check, Info } from 'lucide-react';
import { Product } from './types';
import { formatPrice, serviceTypeLabel } from './formatting';

interface ProductCardProps {
  product: Product;
  isSelected: boolean;
  onToggleSelect: (productId: number) => void;
  onOpenDetails: (product: Product) => void;
}

function getIcon(serviceType: string | null) {
  switch (serviceType) {
    case 'assessment':
      return <ShieldCheck className="w-7 h-7 text-[#dab9ff]" />;
    case 'monitoring_tier':
      return <BarChart3 className="w-7 h-7 text-[#a0c9ff]" />;
    case 'micro_offer':
      return <Sparkles className="w-7 h-7 text-[#a0c9ff]" />;
    case 'retainer':
      return <Repeat className="w-7 h-7 text-[#a0c9ff]" />;
    default:
      return <Package className="w-7 h-7 text-[#a0c9ff]" />;
  }
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  isSelected,
  onToggleSelect,
  onOpenDetails,
}) => {
  return (
    <div
      data-testid="marketplace-product-card"
      className="bg-[#1e2020] flex flex-col p-4 md:p-5 rounded-xl border border-white/5 h-full relative group"
    >
      {/* Top Bar: Icon & Badge */}
      <div className="flex justify-between items-start mb-4">
        <div
          onClick={() => onOpenDetails(product)}
          className="w-12 h-12 rounded-xl bg-[#121414] border border-white/10 flex items-center justify-center cursor-pointer hover:border-[#a0c9ff]/40 transition-colors"
        >
          {getIcon(product.serviceType)}
        </div>

        <div className="flex items-center gap-2">
          {product.badge && (
            <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-semibold uppercase tracking-wider border bg-[#a0c9ff]/10 text-[#a0c9ff] border-[#a0c9ff]/20">
              {product.badge}
            </span>
          )}
          <button
            onClick={() => onOpenDetails(product)}
            title="View Details"
            className="text-[#8a919d] hover:text-[#a0c9ff] p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Title */}
      <h3
        data-testid="marketplace-product-name"
        onClick={() => onOpenDetails(product)}
        className="font-sans text-lg font-semibold text-[#e2e2e2] mb-1.5 cursor-pointer hover:text-[#a0c9ff] transition-colors"
      >
        {product.name}
      </h3>

      {/* Description */}
      <p className="text-xs md:text-sm text-[#c0c7d3] flex-1 mb-5 leading-relaxed font-sans">
        {product.tagline || product.description || ''}
      </p>

      {/* Category / service type tag */}
      {serviceTypeLabel(product.serviceType) && (
        <div className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-[#a0c9ff] bg-[#a0c9ff]/5 px-2 py-0.5 rounded border border-[#a0c9ff]/10 w-fit">
          {serviceTypeLabel(product.serviceType)}
          {product.category ? ` • ${product.category}` : ''}
        </div>
      )}

      {/* Footer Row: Price & Select Button */}
      <div className="flex items-center justify-between mt-auto pt-3.5 border-t border-white/5">
        <div>
          <p className="font-mono text-[10px] text-[#8a919d] uppercase tracking-wider">
            {product.priceCents == null ? 'Pricing' : 'Starting at'}
          </p>
          <p className="font-sans text-lg md:text-xl font-bold text-[#e2e2e2]">
            {formatPrice(product)}
          </p>
        </div>

        <button
          onClick={() => onToggleSelect(product.id)}
          className={`px-4 py-2 rounded-lg font-sans text-xs md:text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
            isSelected
              ? 'bg-[#10b981] text-white hover:bg-[#059669] shadow-[0_0_12px_rgba(16,185,129,0.3)] active:scale-95'
              : 'bg-[#a0c9ff] text-[#003259] hover:bg-[#d2e4ff] active:scale-95 hover:shadow-[0_0_12px_rgba(160,201,255,0.4)]'
          }`}
        >
          {isSelected ? (
            <>
              <Check className="w-4 h-4 stroke-[3]" />
              Selected
            </>
          ) : (
            'Select'
          )}
        </button>
      </div>
    </div>
  );
};
