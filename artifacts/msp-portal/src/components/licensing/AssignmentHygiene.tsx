import React from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedHistory,
  resolvedReason,
  reasonCopy,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Assignment Hygiene — REAL license-hygiene checks (inactive-user licenses,
 * duplicate assignments), replacing the mock per-department hygiene grid (a
 * department dimension isn't collected by any check). Both metrics carry real
 * history sparklines when the monitor has accumulated rows.
 *
 * The footer additionally surfaces two metrics the /licensing page has always
 * requested from /api/dashboard/resolve but which no component rendered —
 * `licensing.skuBreakdown` (the SKU-utilization check's real value) and
 * `drift.licenseAssignmentDriftCount` (the license-assignment drift watcher).
 * Both resolve as plain counts today (skuBreakdown is declared
 * shape:"distribution" but the resolve endpoint serves available monitor
 * metrics as scalars, so no per-SKU bucket list is served) — shown as the real
 * numbers they are, with their resolve reason when they don't resolve.
 */

interface AssignmentHygieneProps {
  metrics: Record<string, ResolvedMetric>;
}

const HYGIENE_METRICS: { key: string; label: string; caption: string }[] = [
  {
    key: 'licensing.inactiveLicenseCount',
    label: 'Inactive Licenses',
    caption: 'Paid seats on inactive users',
  },
  {
    key: 'licensing.duplicateLicenseCount',
    label: 'Duplicate Licenses',
    caption: 'Overlapping assignments',
  },
];

/** Real resolved metrics the page already requests but nothing rendered before. */
const SECONDARY_METRICS: { key: string; label: string }[] = [
  { key: 'licensing.skuBreakdown', label: 'SKU utilization check' },
  { key: 'drift.licenseAssignmentDriftCount', label: 'License assignment drift' },
];

export const AssignmentHygiene: React.FC<AssignmentHygieneProps> = ({ metrics }) => {
  const rows = HYGIENE_METRICS.map((def) => ({
    def,
    value: resolvedValue(metrics[def.key]),
    history: resolvedHistory(metrics[def.key]),
  }));
  const anyData = rows.some((r) => r.value != null);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-status-amber" />
          ASSIGNMENT HYGIENE
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {anyData ? 'LIVE CHECKS' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="space-y-5 flex-grow">
          {rows.map(({ def, value, history }) => {
            const band = value != null ? riskCountBand(value) : null;
            const maxHistory = Math.max(1, ...history.map((p) => p.value));
            return (
              <div key={def.key} className="space-y-1.5">
                <div className="flex justify-between items-baseline">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{def.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {value != null ? def.caption : 'No data collected yet'}
                    </p>
                  </div>
                  <span
                    className={`text-2xl font-bold font-mono ${
                      band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                    }`}
                  >
                    {value != null ? value.toLocaleString() : '—'}
                  </span>
                </div>
                {history.length >= 2 ? (
                  <div className="h-8 flex items-end space-x-0.5">
                    {history.slice(-30).map((p, i) => (
                      <div
                        key={`${p.t}-${i}`}
                        className="flex-1 rounded-t opacity-70"
                        style={{
                          height: `${Math.max((p.value / maxHistory) * 100, 6)}%`,
                          backgroundColor: BAND_COLOR_VAR[riskCountBand(p.value)],
                        }}
                        title={`${new Date(p.t).toLocaleDateString()}: ${p.value}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    History fills in as your live monitor accumulates readings.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-8">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            License-hygiene metrics appear once the licensing checks have
            collected data for your tenant.
          </p>
        </div>
      )}

      <ul className="mt-4 pt-3 border-t border-border space-y-1.5">
        {SECONDARY_METRICS.map(({ key, label }) => {
          const value = resolvedValue(metrics[key]);
          const band = value != null ? riskCountBand(value) : null;
          return (
            <li
              key={key}
              className="flex justify-between items-center text-[11px] font-mono gap-2"
              title={`${label} (${key})`}
            >
              <span className="text-muted-foreground truncate">{label}</span>
              <span
                className={`font-bold flex-shrink-0 ${
                  band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                }`}
              >
                {value != null
                  ? value.toLocaleString()
                  : reasonCopy(resolvedReason(metrics[key]))}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Per-department hygiene isn&apos;t collected — these are your real
        tenant-wide checks.
      </div>
    </div>
  );
};
