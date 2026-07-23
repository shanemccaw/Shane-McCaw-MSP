import React, { useState, useMemo } from 'react';
import { ProductCard } from './ProductCard';
import { ProductDetailModal } from './ProductDetailModal';
import { SubscriptionsDrawer } from './SubscriptionsDrawer';
import { Product, CategoryType } from './types';
import { INITIAL_PRODUCTS } from './products';
import { Search, X, SearchX, ArrowRight } from 'lucide-react';

interface MarketplaceModalProps {
  selectedIds: string[];
  onToggleSelectProduct: (productId: string) => void;
  walletBalance: number;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (cycle: 'monthly' | 'yearly') => void;
  onConfirmSubscriptions: () => void;
}

const CATEGORIES: { id: CategoryType; label: string }[] = [
  { id: 'All Products', label: 'All Products' },
  { id: 'Intelligence', label: 'Intelligence' },
  { id: 'Security', label: 'Security' },
  { id: 'Automation', label: 'Automation' },
  { id: 'Compliance', label: 'Compliance' },
];

export const MarketplaceModal: React.FC<MarketplaceModalProps> = ({
  selectedIds,
  onToggleSelectProduct,
  walletBalance,
  billingCycle,
  setBillingCycle,
  onConfirmSubscriptions,
}) => {
  const [activeCategory, setActiveCategory] = useState<CategoryType>('All Products');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Product Detail Modal state
  const [inspectProduct, setInspectProduct] = useState<Product | null>(null);

  // Subscriptions Drawer state
  const [isSubscriptionsDrawerOpen, setIsSubscriptionsDrawerOpen] = useState(false);

  // Filter products based on search query and category
  const filteredProducts = useMemo(() => {
    return INITIAL_PRODUCTS.filter((product) => {
      // Search match
      const matchesSearch =
        searchQuery.trim() === '' ||
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.badge.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.category.toLowerCase().includes(searchQuery.toLowerCase());

      // Category match
      let matchesCategory = true;
      if (activeCategory !== 'All Products') {
        matchesCategory = product.category === activeCategory;
      }

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory]);

  const selectedProducts = useMemo(() => {
    return INITIAL_PRODUCTS.filter((p) => selectedIds.includes(p.id));
  }, [selectedIds]);

  const totalMonthlyCost = useMemo(() => {
    return selectedProducts.reduce((sum, p) => {
      return sum + (billingCycle === 'yearly' ? p.priceYearly : p.priceMonthly);
    }, 0);
  }, [selectedProducts, billingCycle]);

  return (
    <>
      {/* Glassmorphism Boutique Marketplace Card */}
      <div className="bg-[#1e2020]/80 backdrop-blur-xl w-full max-w-6xl mx-auto flex flex-col rounded-2xl overflow-hidden shadow-2xl relative border border-white/10">
        {/* Boutique Header: brand title, search, billing cycle toggle */}
        <header className="bg-[#282a2b] border-b border-white/5 flex flex-wrap justify-between items-center gap-3 w-full px-4 md:px-6 py-3.5 shadow-sm rounded-t-xl shrink-0">
          <span className="font-sans text-xl md:text-2xl font-bold text-[#a0c9ff] tracking-tight">
            Boutique Marketplace
          </span>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c0c7d3] w-4 h-4 transition-colors group-focus-within:text-[#a0c9ff]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search marketplace..."
                className="bg-[#121414] border border-[#404752] rounded-lg pl-9 pr-3 py-1.5 text-xs md:text-sm text-[#e2e2e2] w-40 sm:w-56 lg:w-64 focus:ring-2 focus:ring-[#a0c9ff] focus:border-transparent focus:outline-none transition-all placeholder:text-[#8a919d]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#e2e2e2]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="hidden lg:flex items-center bg-[#121414] p-0.5 rounded-lg border border-[#404752] text-xs font-mono">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-[#479ef5] text-[#001c37] font-semibold shadow-sm'
                    : 'text-[#c0c7d3] hover:text-[#e2e2e2]'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                  billingCycle === 'yearly'
                    ? 'bg-[#479ef5] text-[#001c37] font-semibold shadow-sm'
                    : 'text-[#c0c7d3] hover:text-[#e2e2e2]'
                }`}
              >
                Yearly
                <span className="text-[10px] px-1 py-0.2 bg-[#dab9ff] text-[#421871] rounded-full font-bold">
                  -20%
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Category Pills */}
        <div className="flex items-center gap-2 px-4 md:px-6 py-3 overflow-x-auto bg-[#1a1c1c]/60 border-b border-white/5">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-full font-mono text-xs shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#5a3289] text-[#cda3ff] font-semibold shadow-sm'
                    : 'bg-[#282a2b] border border-[#404752] text-[#c0c7d3] hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#1a1c1c]/60">
          {/* Grid of Solutions */}
          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-2">
              {filteredProducts.map((product) => {
                const isSelected = selectedIds.includes(product.id);
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isSelected={isSelected}
                    onToggleSelect={onToggleSelectProduct}
                    onOpenDetails={setInspectProduct}
                    billingCycle={billingCycle}
                  />
                );
              })}
            </div>
          ) : (
            /* Empty state when search or filter yields no products */
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[#282a2b] flex items-center justify-center text-[#8a919d]">
                <SearchX className="w-6 h-6" />
              </div>
              <h4 className="font-sans text-base font-semibold text-[#e2e2e2]">
                No solutions found for "{searchQuery}"
              </h4>
              <p className="text-xs text-[#8a919d] max-w-sm">
                Try adjusting your search terms or select a different category above.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All Products');
                }}
                className="px-4 py-1.5 rounded-lg bg-[#a0c9ff]/10 text-[#a0c9ff] text-xs font-semibold hover:bg-[#a0c9ff]/20 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          )}
        </main>

        {/* Boutique Footer: subscriptions review CTA */}
        <footer className="bg-[#333535]/50 border-t border-white/5 px-4 md:px-6 py-3.5 flex flex-wrap items-center justify-end gap-3 shrink-0 rounded-b-xl">
          <button
            onClick={() => setIsSubscriptionsDrawerOpen(true)}
            className={`px-5 py-2.5 rounded-lg font-semibold text-xs md:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-md ${
              selectedIds.length > 0
                ? 'bg-[#479ef5] text-[#001c37] hover:bg-[#a0c9ff] active:scale-95 shadow-[0_0_16px_rgba(71,158,245,0.4)]'
                : 'bg-[#479ef5]/80 text-[#001c37] hover:bg-[#479ef5]'
            }`}
          >
            {selectedIds.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#001c37] text-[#a0c9ff] text-[11px] font-bold flex items-center justify-center">
                {selectedIds.length}
              </span>
            )}
            <span>
              {selectedIds.length > 0
                ? `View Subscriptions ($${totalMonthlyCost}/mo)`
                : 'View Subscriptions'}
            </span>
            <ArrowRight className="w-4 h-4 text-[#001c37]" />
          </button>
        </footer>
      </div>

      {/* Product Detailed Inspection Modal */}
      <ProductDetailModal
        product={inspectProduct}
        isOpen={!!inspectProduct}
        onClose={() => setInspectProduct(null)}
        isSelected={inspectProduct ? selectedIds.includes(inspectProduct.id) : false}
        onToggleSelect={onToggleSelectProduct}
        billingCycle={billingCycle}
      />

      {/* Active Subscriptions Drawer / Review Modal */}
      <SubscriptionsDrawer
        isOpen={isSubscriptionsDrawerOpen}
        onClose={() => setIsSubscriptionsDrawerOpen(false)}
        selectedProducts={selectedProducts}
        onRemoveProduct={onToggleSelectProduct}
        billingCycle={billingCycle}
        setBillingCycle={setBillingCycle}
        walletBalance={walletBalance}
        onConfirmSubscriptions={onConfirmSubscriptions}
      />
    </>
  );
};
