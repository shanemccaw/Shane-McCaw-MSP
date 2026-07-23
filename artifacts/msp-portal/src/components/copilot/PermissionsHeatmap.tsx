import React from 'react';
import { FolderOpen, Shield } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
  BAND_COLOR_VAR,
} from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Oversharing Exposure — the REAL permission-exposure surface Copilot would
 * inherit, replacing the mock per-site/team "permissions heatmap" (a per-entity
 * sharing matrix isn't served by any endpoint — that per-entity drill-down
 * needs a new Graph check and is reported as a gap, not simulated).
 *
 * Real data shown: the copilot:overshare-exposure check count, the real
 * overshared-vs-total site ratio (compliance checks + the readiness
 * indicator's own backing counts), OneDrive external shares, and public
 * channels.
 */

interface PermissionsHeatmapProps {
  metrics: Record<string, ResolvedMetric>;
  copilotReadiness: CopilotReadinessLive | null;
}

export const PermissionsHeatmap: React.FC<PermissionsHeatmapProps> = ({
  metrics,
  copilotReadiness,
}) => {
  const exposureItems = resolvedValue(metrics['copilot.overshareExposureCount']);
  const oversharedSites =
    copilotReadiness?.sharePointTeams.oversharedSites ??
    resolvedValue(metrics['compliance.oversharedSiteCount']);
  const totalSites =
    copilotReadiness?.sharePointTeams.totalSites ??
    resolvedValue(metrics['compliance.sharePointSiteCount']);
  const oneDriveExternal = resolvedValue(metrics['compliance.oneDriveExternalCount']);
  const publicChannels = resolvedValue(metrics['compliance.publicChannelCount']);

  const ratio =
    oversharedSites != null && totalSites != null && totalSites > 0
      ? Math.round((oversharedSites / totalSites) * 1000) / 10
      : null;

  const tiles: { label: string; value: number | null; caption: string }[] = [
    { label: 'Overshare Exposure Items', value: exposureItems, caption: 'From the Copilot exposure check' },
    { label: 'Overshared Sites', value: oversharedSites, caption: 'Broad-access SharePoint sites' },
    { label: 'OneDrive External Shares', value: oneDriveExternal, caption: 'Externally shared content' },
    { label: 'Public Channels', value: publicChannels, caption: 'Org-wide visible channels' },
  ];

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-status-amber" />
          Oversharing Exposure
        </h3>
        <span className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          {ratio != null
            ? `${ratio}% of ${totalSites?.toLocaleString()} sites overshared`
            : 'Site ratio pending scan data'}
        </span>
      </div>

      {/* Real overshared-site ratio bar */}
      <div className="mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          {ratio != null && (
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(ratio, 100)}%`,
                backgroundColor:
                  BAND_COLOR_VAR[riskCountBand(oversharedSites ?? 0)],
              }}
            />
          )}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground mt-1">
          {ratio != null
            ? 'Real overshared-vs-total site ratio — what Copilot could surface today'
            : 'The ratio appears once the SharePoint sharing checks have collected data.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((tile) => {
          const band = tile.value != null ? riskCountBand(tile.value) : null;
          return (
            <div key={tile.label} className="p-3 rounded-lg border border-border bg-secondary/40">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {tile.label}
              </p>
              <p
                className={`text-2xl font-bold font-mono mt-1 ${
                  band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                }`}
              >
                {tile.value != null ? tile.value.toLocaleString() : '—'}
              </p>
              <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
                {tile.value != null ? tile.caption : 'No data yet'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        A per-site/per-team permission drill-down isn&apos;t collected yet (needs a
        new Graph check) — these are your real aggregate exposure counts.
      </div>
    </section>
  );
};
