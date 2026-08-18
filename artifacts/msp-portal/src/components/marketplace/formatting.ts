import type { Product } from './types';

/** Real price formatting off priceCents/perSeat/billingType — no fabricated pricing. */
export function formatPrice(product: Product): string {
  if (product.priceCents == null) return 'Contact for pricing';
  const dollars = (product.priceCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: product.priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  if (product.perSeat) return `$${dollars}/user/mo`;
  if (product.billingType === 'recurring_monthly') return `$${dollars}/mo`;
  return `$${dollars} one-time`;
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  assessment: 'Assessment',
  monitoring_tier: 'Monitoring',
  micro_offer: 'Add-on',
  retainer: 'Retainer',
};

export function serviceTypeLabel(serviceType: string | null): string | null {
  if (!serviceType) return null;
  return SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}
