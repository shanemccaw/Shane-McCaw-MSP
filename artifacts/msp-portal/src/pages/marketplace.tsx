import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { MarketplaceModal } from '@/components/marketplace/MarketplaceModal';

export default function MarketplacePage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const handleToggleSelectProduct = (productId: number) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  return (
    <AppShell title="Marketplace">
      <div className="min-h-full bg-[#121414] text-[#e2e2e2] font-body p-3 md:p-6 lg:p-8">
        <MarketplaceModal
          selectedIds={selectedIds}
          onToggleSelectProduct={handleToggleSelectProduct}
        />
      </div>
    </AppShell>
  );
}
