import React, { useState, useMemo } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ProductCard } from './ProductCard';
import { FooterBar } from './FooterBar';
import { ProductDetailModal } from './ProductDetailModal';
import { SubscriptionsDrawer } from './SubscriptionsDrawer';
import { Product, CategoryType, TopTabType } from '../types';
import { INITIAL_PRODUCTS } from '../data/products';
import { SearchX, Sparkles, LayoutGrid } from 'lucide-react';

interface MarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: string[];
  onToggleSelectProduct: (productId: string) => void;
  walletBalance: number;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (cycle: 'monthly' | 'yearly') => void;
  onConfirmSubscriptions: () => void;
}

export const MarketplaceModal: React.FC<MarketplaceModalProps> = ({
  isOpen,
  onClose,
  selectedIds,
  onToggleSelectProduct,
  walletBalance,
  billingCycle,
  setBillingCycle,
  onConfirmSubscriptions,
}) => {
  const [activeCategory, setActiveCategory] = useState<CategoryType>('All Products');
  const [topTab, setTopTab] = useState<TopTabType>('Intelligence');
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

  if (!isOpen) return null;

  const mobileCategories: { id: CategoryType; label: string }[] = [
    { id: 'All Products', label: 'All' },
    { id: 'Intelligence', label: 'Intelligence' },
    { id: 'Security', label: 'Security' },
    { id: 'Automation', label: 'Automation' },
    { id: 'Compliance', label: 'Compliance' },
  ];

  return (
    <>
      {/* Modal Backdrop Container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 lg:p-8 animate-fade-in">
        {/* Glassmorphism Marketplace Modal Card */}
        <div className="glass-modal w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl relative border border-white/10">
          {/* Top Navbar */}
          <Header
            topTab={topTab}
            setTopTab={setTopTab}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onCloseModal={onClose}
            onSelectCategory={setActiveCategory}
            billingCycle={billingCycle}
            setBillingCycle={setBillingCycle}
          />

          {/* Modal Main Body (Sidebar + Content Area) */}
          <div className="flex flex-1 overflow-hidden relative">
            {/* Left Sidebar */}
            <Sidebar
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              walletBalance={walletBalance}
              totalMonthlyCost={totalMonthlyCost}
            />

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-hide bg-[#1a1c1c]/60">
              {/* Mobile Horizontal Category Pills */}
              <div className="lg:hidden flex items-center gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                {mobileCategories.map((cat) => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3.5 py-1.5 rounded-full font-mono-code text-xs shrink-0 transition-all cursor-pointer ${
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
                  <h4 className="font-headline text-base font-semibold text-[#e2e2e2]">
                    No solutions found for "{searchQuery}"
                  </h4>
                  <p className="text-xs text-[#8a919d] max-w-sm">
                    Try adjusting your search terms or select a different category from the sidebar.
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
          </div>

          {/* Modal Footer */}
          <FooterBar
            selectedCount={selectedIds.length}
            totalMonthlyCost={totalMonthlyCost}
            onCancel={onClose}
            onViewSubscriptions={() => setIsSubscriptionsDrawerOpen(true)}
          />
        </div>
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
