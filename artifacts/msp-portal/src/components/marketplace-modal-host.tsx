/**
 * MarketplaceModalHost
 *
 * Renders MarketplaceModal inside a real Dialog overlay, driven by
 * MarketplaceContext. Mounted once at the app root (above the router) so it
 * sits on top of whatever page the user was on when they opened Marketplace,
 * rather than navigating away from it. Owns the same selection/wallet/billing
 * state MarketplacePage owns for the standalone /marketplace route — the two
 * are independent instances of the same content component.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MarketplaceModal } from "@/components/marketplace/MarketplaceModal";
import { useMarketplace } from "@/lib/marketplace-context";

export function MarketplaceModalHost() {
  const { isOpen, close } = useMarketplace();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [walletBalance] = useState(0);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const handleToggleSelectProduct = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    );
  };

  const handleConfirmSubscriptions = () => {
    setSelectedIds([]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-6xl w-[calc(100vw-2rem)] p-0 border-0 bg-transparent shadow-none max-h-[calc(100vh-4rem)] overflow-hidden [&>button]:z-10 [&>button]:text-white/70 [&>button]:hover:text-white">
        <DialogTitle className="sr-only">Marketplace</DialogTitle>
        <MarketplaceModal
          selectedIds={selectedIds}
          onToggleSelectProduct={handleToggleSelectProduct}
          walletBalance={walletBalance}
          billingCycle={billingCycle}
          setBillingCycle={setBillingCycle}
          onConfirmSubscriptions={handleConfirmSubscriptions}
        />
      </DialogContent>
    </Dialog>
  );
}
