import React from 'react';
import { Layers } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedBuckets,
} from '@/components/health-suite/useTopicHealthLive';
import type { LicenseWasteSummary } from '@/components/assessment-test/types';

/**
 * SKU Inventory — REAL license data, replacing the mock SKU table. What's
 * genuinely servable today:
 *   • The Cost Engine summary (status.stats.licenseWaste): real seat count,
 *     SKU count, and the top waste SKU with its real monthly cost.
 *   • licensing.wasteEstimateBreakdown buckets: real per-SKU waste dollars
 *     (seat counts × sku_price_reference list price).
 * A full per-SKU assigned-vs-purchased inventory isn't exposed by a resolver
 * transform yet (the licensing:sku-utilization check collects it, but the
 * resolve endpoint serves that metric as a scalar) — stated here, reported in
 * PLATFORM_BUILD.md as a small resolver addition on existing infrastructure.
 */

interface SkuInventoryProps {
  metrics: Record<string, ResolvedMetric>;
  licenseWaste: LicenseWasteSummary | null;
}

export const SkuInventory: React.FC<SkuInventoryProps> = ({ metrics, licenseWaste }) => {
  const wasteBuckets = resolvedBuckets(metrics['licensing.wasteEstimateBreakdown'])
    .slice()
    .sort((a, b) => b.value - a.value);
  const maxWaste = Math.max(1, ...wasteBuckets.map((b) => b.value));
  const anyData = licenseWaste != null || wasteBuckets.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" />
          SKU INVENTORY
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {licenseWaste != null
            ? `${licenseWaste.skuCount.toLocaleString()} SKUs · ${licenseWaste.seatCount.toLocaleString()} waste seats`
            : anyData
              ? 'LIVE DATA'
              : 'AWAITING DATA'}
        </span>
      </div>

      {licenseWaste?.topSku && (
        <div className="p-3 rounded-lg border border-status-amber/30 bg-status-amber/5 mb-4">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Top waste SKU
          </p>
          <div className="flex justify-between items-baseline mt-1 gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {licenseWaste.topSku.displayName}
            </span>
            <span className="text-sm font-bold font-mono text-status-amber flex-shrink-0">
              ${Math.round(licenseWaste.topSku.monthlyCents / 100).toLocaleString()}/mo
            </span>
          </div>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {licenseWaste.topSku.count.toLocaleString()} wasted seat
            {licenseWaste.topSku.count === 1 ? '' : 's'} at real list price
          </p>
        </div>
      )}

      {wasteBuckets.length > 0 ? (
        <div className="space-y-2.5 flex-grow">
          {wasteBuckets.slice(0, 8).map((bucket) => (
            <div key={bucket.label} className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono gap-2">
                <span className="text-secondary-foreground/90 truncate">{bucket.label}</span>
                <span className="font-bold text-foreground flex-shrink-0">
                  ${Math.round(bucket.value).toLocaleString()}/mo
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-status-amber transition-all duration-500"
                  style={{ width: `${(bucket.value / maxWaste) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-8">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Per-SKU waste appears once the license-waste check has collected
            seat data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Waste dollars per SKU at real list prices — a full assigned-vs-purchased
        SKU table isn&apos;t servable yet.
      </div>
    </div>
  );
};
