import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { MarketplaceModal } from '@/components/marketplace/MarketplaceModal';

export default function MarketplacePage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const handleToggleSelectProduct = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleConfirmSubscriptions = () => {
    setSelectedIds([]);
  };

  return (
    <AppShell title="Marketplace">
      <div className="min-h-full bg-[#121414] text-[#e2e2e2] font-body p-3 md:p-6 lg:p-8">
        <MarketplaceModal
          selectedIds={selectedIds}
          onToggleSelectProduct={handleToggleSelectProduct}
          walletBalance={walletBalance}
          billingCycle={billingCycle}
          setBillingCycle={setBillingCycle}
          onConfirmSubscriptions={handleConfirmSubscriptions}
        />
      </div>
    </AppShell>
  );
}
