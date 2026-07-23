import React from 'react';
import { AppWindow } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedEvents,
  riskCountBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * App Registration Watch — the REAL app-registration drift watchers from the
 * dedicated drift engine (app config, redirect URIs, secrets, certificates),
 * replacing the mock per-app inventory table. A full per-app registration
 * inventory (names, owners, credential expiry dates) isn't served by any
 * endpoint yet — that needs a new Graph check on the existing app
 * registration; reported as a gap, not simulated. What IS real: each
 * watcher's change events in the look-back window.
 */

const WATCHERS: { key: string; label: string; tag: string }[] = [
  { key: 'drift.appConfigDriftCount', label: 'App Config Drift', tag: 'CONFIG' },
  { key: 'drift.redirectUriDriftCount', label: 'Redirect URI Drift', tag: 'REDIRECT' },
  { key: 'drift.secretDriftCount', label: 'App Secret Drift', tag: 'SECRET' },
  { key: 'drift.certificateDriftCount', label: 'Certificate Drift', tag: 'CERT' },
];

interface AppRegistrationInventoryProps {
  metrics: Record<string, ResolvedMetric>;
}

export const AppRegistrationInventory: React.FC<AppRegistrationInventoryProps> = ({ metrics }) => {
  const counts = WATCHERS.map((w) => ({ ...w, value: resolvedValue(metrics[w.key]) }));
  const merged = WATCHERS.flatMap((w) =>
    resolvedEvents(metrics[w.key]).map((e) => ({ ...e, __tag: w.tag })),
  )
    .filter((e) => e.t)
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 8);
  const watching = counts.some((c) => metrics[c.key]?.status === 'ok');

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <AppWindow className="w-3.5 h-3.5 text-status-violet" />
          APP REGISTRATION WATCH
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {watching ? 'Drift watchers live' : 'Awaiting data'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        {counts.map(({ key, label, value }) => {
          const band = value != null ? riskCountBand(value) : null;
          return (
            <div key={key} className="p-2.5 rounded-lg border border-border bg-secondary/40">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider truncate">
                {label}
              </p>
              <p
                className={`text-lg font-bold font-mono ${
                  band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                }`}
              >
                {value != null ? value.toLocaleString() : '—'}
              </p>
            </div>
          );
        })}
      </div>

      {merged.length > 0 ? (
        <ul className="divide-y divide-border flex-grow">
          {merged.map((e, i) => (
            <li key={`${e.t}-${i}`} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 bg-status-violet/15 text-status-violet border-status-violet/30">
                  {e.__tag}
                </span>
                <span className="text-xs text-secondary-foreground/90 leading-relaxed break-words">
                  {e.label}
                </span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                {new Date(e.t).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-6">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {watching
              ? 'No app-registration changes in the look-back window.'
              : 'App-registration drift events appear once the watchers have collected data for your tenant.'}
          </p>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        A full per-app inventory (owners, credential expiry) isn&apos;t collected
        yet — these are your real drift-watch events.
      </div>
    </div>
  );
};
