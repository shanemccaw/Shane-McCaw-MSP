import React from 'react';
import { Shield } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Admin Exposure — REAL privileged-access exposure counts from the monitor
 * check catalog, replacing the mock fixed-polygon "radar" (its vertex geometry
 * was hardcoded and unrelated to any data). Each tile is a real resolved
 * metric; band color follows the registry's RISK_COUNT_BANDS. Standing
 * Privileged Roles (identity:pim-permanent-roles) currently needs a Graph
 * scope the multi-tenant app doesn't have — it honestly renders "no data yet"
 * until that lands, never a guess.
 */

const EXPOSURE_METRICS: { key: string; label: string; caption: string }[] = [
  { key: 'identity.globalAdminCount', label: 'Global Administrators', caption: 'Real Global Admin role holders' },
  { key: 'identity.pimPermanentRoleCount', label: 'Standing Privileged Roles', caption: 'Permanent (non-PIM) assignments' },
  { key: 'identity.riskyUserCount', label: 'Risky Users', caption: 'Identity Protection risk state' },
  { key: 'identity.staleAccountCount', label: 'Stale Accounts', caption: 'No recent sign-in activity' },
  { key: 'identity.caFailureCount', label: 'CA Policy Failures', caption: 'Conditional Access failures in window' },
  { key: 'identity.highRiskSigninCount', label: 'High-Risk Sign-ins', caption: 'Flagged by Identity Protection' },
];

interface AdminExposureMatrixProps {
  metrics: Record<string, ResolvedMetric>;
}

export const AdminExposureMatrix: React.FC<AdminExposureMatrixProps> = ({ metrics }) => {
  const values = EXPOSURE_METRICS.map((def) => ({ def, value: resolvedValue(metrics[def.key]) }));
  const anyData = values.some((v) => v.value != null);

  return (
    <div className="bg-card border border-border p-6 rounded-xl flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          <Shield className="w-5 h-5 text-status-amber" />
          Admin Exposure
        </h3>
        <span className="font-mono text-xs text-muted-foreground">
          {anyData ? 'LIVE CHECKS' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-grow">
          {values.map(({ def, value }) => {
            const band = value != null ? riskCountBand(value) : null;
            return (
              <div
                key={def.key}
                className="p-3 rounded-lg border border-border bg-secondary/40 flex flex-col"
              >
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {def.label}
                </span>
                <span
                  className={`text-xl font-bold font-mono mt-1 ${
                    band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                  }`}
                >
                  {value != null ? value.toLocaleString() : '—'}
                </span>
                <span className="text-[10px] text-secondary-foreground/80 mt-0.5">
                  {value != null ? def.caption : 'No data collected yet'}
                </span>
                <div className="h-1 bg-muted rounded-full overflow-hidden mt-2">
                  {band && (
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: BAND_COLOR_VAR[band],
                        width: band === 'green' ? '25%' : band === 'amber' ? '60%' : '100%',
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-6 py-10">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Privileged-access exposure metrics appear once the identity checks
            have collected data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground">
        Counts from your live identity monitor checks · lower is better (Global
        Admins: 2–4 with break-glass is healthy)
      </div>
    </div>
  );
};
