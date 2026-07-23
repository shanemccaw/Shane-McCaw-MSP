import React from 'react';
import { Users, UserMinus, Globe, FolderX, Package, MailWarning } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Group & Collaboration Sprawl — REAL sprawl/ownership counts from the
 * compliance + collaboration + governance monitor checks, replacing the mock
 * 60-cell "risk concentration heatmap" (its cells carried fabricated group
 * names and risk levels with no data source). Ownerless = the real
 * orphaned-teams / orphaned-sites checks; external = real guest/invite
 * counts; each row is a real resolved metric with an honest em-dash when the
 * backing check hasn't collected yet.
 */

const SPRAWL_ROWS: {
  key: string;
  label: string;
  caption: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'compliance.orphanedTeamCount', label: 'Ownerless Teams', caption: 'Teams with no active owner', icon: UserMinus },
  { key: 'compliance.orphanedSiteCount', label: 'Orphaned SharePoint Sites', caption: 'Sites with no active owner', icon: FolderX },
  { key: 'compliance.guestUserCount', label: 'Guest Users', caption: 'External identities in your directory', icon: Globe },
  { key: 'compliance.externalInviteCount', label: 'External Invites', caption: 'Pending/recent external invitations', icon: MailWarning },
  { key: 'compliance.publicChannelCount', label: 'Public Channels', caption: 'Org-wide visible Teams channels', icon: Users },
  { key: 'governance.orphanedAccessPackageCount', label: 'Orphaned Access Packages', caption: 'Entitlement packages with no owner', icon: Package },
];

interface GroupSprawlProps {
  metrics: Record<string, ResolvedMetric>;
  /** Real context denominator (total Teams channels) when available. */
}

export const GroupSprawl: React.FC<GroupSprawlProps> = ({ metrics }) => {
  const rows = SPRAWL_ROWS.map((def) => ({ def, value: resolvedValue(metrics[def.key]) }));
  const anyData = rows.some((r) => r.value != null);
  const totalChannels = resolvedValue(metrics['collaboration.teamsChannelCount']);

  return (
    <div className="bg-card border border-border p-6 rounded-xl flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          <Users className="w-5 h-5 text-status-red" />
          Group &amp; Collaboration Sprawl
        </h3>
        <span className="font-mono text-xs text-muted-foreground">
          {totalChannels != null ? `${totalChannels.toLocaleString()} Teams channels` : anyData ? 'LIVE CHECKS' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <ul className="divide-y divide-border flex-grow">
          {rows.map(({ def, value }) => {
            const band = value != null ? riskCountBand(value) : null;
            const Icon = def.icon;
            return (
              <li key={def.key} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-secondary text-muted-foreground">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{def.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {value != null ? def.caption : 'No data collected yet'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-lg font-bold font-mono flex-shrink-0 ${
                    band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                  }`}
                >
                  {value != null ? value.toLocaleString() : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-6 py-10">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Sprawl and ownership metrics appear once the compliance and
            collaboration checks have collected data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground">
        Real counts from your live sprawl &amp; ownership checks · lower is better
      </div>
    </div>
  );
};
