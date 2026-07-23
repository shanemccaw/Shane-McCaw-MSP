import React, { useState } from 'react';
import { BackgroundDashboard } from './components/BackgroundDashboard';
import { MarketplaceModal } from './components/MarketplaceModal';

export default function App() {
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [walletBalance, setWalletBalance] = useState(12450.0);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const handleToggleSelectProduct = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleConfirmSubscriptions = () => {
    // Deduct cost and save active subscriptions
    setSelectedIds([]);
  };

  return (
    <div className="min-h-screen bg-[#121414] text-[#e2e2e2] font-body relative overflow-hidden select-none">
      {/* Background Dashboard (Blurred & Darkened when Marketplace is active) */}
      <BackgroundDashboard
        isModalOpen={isMarketplaceOpen}
        onOpenMarketplace={() => setIsMarketplaceOpen(true)}
        activeSubscriptionsCount={selectedIds.length}
      />

      {/* Boutique Marketplace Modal */}
      <MarketplaceModal
        isOpen={isMarketplaceOpen}
        onClose={() => setIsMarketplaceOpen(false)}
        selectedIds={selectedIds}
        onToggleSelectProduct={handleToggleSelectProduct}
        walletBalance={walletBalance}
        billingCycle={billingCycle}
        setBillingCycle={setBillingCycle}
        onConfirmSubscriptions={handleConfirmSubscriptions}
      />
    </div>
  );
}
