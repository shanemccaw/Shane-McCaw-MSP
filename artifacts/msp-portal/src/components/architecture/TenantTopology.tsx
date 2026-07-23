import React from 'react';
import { Network, FolderOpen, MessageSquare, Mail, Globe, Workflow, AppWindow } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Tenant Surface — the REAL inventory counts across the tenant's workload
 * surface (sites, channels, mailboxes, guests, Power Platform apps/flows),
 * replacing the mock node-graph topology (its nodes and edge weights were
 * invented; a real relationship graph between workloads isn't collected —
 * that would need new Graph checks; reported as a gap, not simulated).
 */

const SURFACE_NODES: {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}[] = [
  { key: 'compliance.sharePointSiteCount', label: 'SharePoint Sites', icon: FolderOpen, accentClass: 'text-status-blue' },
  { key: 'collaboration.teamsChannelCount', label: 'Teams Channels', icon: MessageSquare, accentClass: 'text-status-violet' },
  { key: 'collaboration.mailboxCount', label: 'Mailboxes', icon: Mail, accentClass: 'text-status-teal' },
  { key: 'compliance.guestUserCount', label: 'Guest Users', icon: Globe, accentClass: 'text-status-amber' },
  { key: 'powerPlatform.appCount', label: 'Power Apps', icon: AppWindow, accentClass: 'text-status-green' },
  { key: 'powerPlatform.flowCount', label: 'Power Automate Flows', icon: Workflow, accentClass: 'text-primary' },
];

interface TenantTopologyProps {
  metrics: Record<string, ResolvedMetric>;
}

export const TenantTopology: React.FC<TenantTopologyProps> = ({ metrics }) => {
  const nodes = SURFACE_NODES.map((n) => ({ ...n, value: resolvedValue(metrics[n.key]) }));
  const anyData = nodes.some((n) => n.value != null);

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          Tenant Surface
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {anyData ? 'Real inventory checks' : 'AWAITING DATA'}
        </span>
      </div>

      {anyData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {nodes.map((node) => {
            const Icon = node.icon;
            return (
              <div
                key={node.key}
                className="p-3 rounded-lg border border-border bg-secondary/40 flex flex-col items-center text-center"
              >
                <Icon className={`w-5 h-5 ${node.accentClass}`} />
                <p className={`text-xl font-bold font-mono mt-2 ${node.value != null ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {node.value != null ? node.value.toLocaleString() : '—'}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-tight">
                  {node.label}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-10 text-center px-6">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Tenant surface counts appear once the inventory checks have
            collected data for your tenant.
          </p>
        </div>
      )}

      <div className="mt-4 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Real workload inventory counts — a cross-workload relationship graph
        isn&apos;t collected yet.
      </div>
    </section>
  );
};
