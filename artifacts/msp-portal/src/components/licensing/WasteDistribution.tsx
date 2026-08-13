import React from 'react';
import { PieChart } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedBuckets,
} from '@/components/health-suite/useTopicHealthLive';
import type { LicenseWasteSummary } from '@/components/assessment-test/types';

/**
 * Waste Distribution — the Cost Engine's REAL per-SKU waste distribution
 * (licensing.wasteEstimateBreakdown: real seat counts × real
 * sku_price_reference list prices), replacing the mock pie chart. Totals come
 * from the same Cost Engine summary the /m365-health hero uses. SKUs with no
 * list price on file surface as a $0 bucket server-side rather than a guessed
 * figure — the footer says so.
 */

interface WasteDistributionProps {
  metrics: Record<string, ResolvedMetric>;
  licenseWaste: LicenseWasteSummary | null;
}

const SEGMENT_COLORS = [
  'var(--color-status-amber)',
  'var(--color-status-red)',
  'var(--color-status-violet)',
  'var(--color-status-blue)',
  'var(--color-status-teal)',
  'var(--color-status-green)',
];

export const WasteDistribution: React.FC<WasteDistributionProps> = ({
  metrics,
  licenseWaste,
}) => {
  const buckets = resolvedBuckets(metrics['licensing.wasteEstimateBreakdown'])
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = buckets.reduce((sum, b) => sum + b.value, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <PieChart className="w-3.5 h-3.5 text-status-amber" />
          WASTE DISTRIBUTION
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {licenseWaste != null
            ? `$${Math.round(licenseWaste.monthlyCents / 100).toLocaleString()}/mo · $${Math.round(licenseWaste.annualCents / 100).toLocaleString()}/yr`
            : 'AWAITING DATA'}
        </span>
      </div>

      {buckets.length > 0 && total > 0 ? (
        <>
          {/* Stacked distribution bar — real dollar shares */}
          <div className="flex h-4 w-full rounded-full overflow-hidden bg-muted mb-4">
            {buckets.map((bucket, i) => (
              <div
                key={bucket.label}
                className="h-full transition-all duration-500"
                style={{
                  width: `${(bucket.value / total) * 100}%`,
                  backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                }}
                title={`${bucket.label}: $${Math.round(bucket.value).toLocaleString()}/mo (${Math.round((bucket.value / total) * 100)}%)`}
              />
            ))}
          </div>
          <ul className="space-y-1.5 flex-grow">
            {buckets.slice(0, 6).map((bucket, i) => (
              <li key={bucket.label} className="flex justify-between items-center text-[11px] font-mono gap-2">
                <span className="flex items-center gap-1.5 text-secondary-foreground/90 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                  />
                  <span className="truncate">{bucket.label}</span>
                </span>
                <span className="font-bold text-foreground flex-shrink-0">
                  ${Math.round(bucket.value).toLocaleString()}/mo ·{' '}
                  {Math.round((bucket.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-8">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The waste distribution appears once the Cost Engine has real per-SKU
            seat data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Real seat counts × real list prices — SKUs without a price on file are
        excluded, never estimated.
      </div>
    </div>
  );
};
