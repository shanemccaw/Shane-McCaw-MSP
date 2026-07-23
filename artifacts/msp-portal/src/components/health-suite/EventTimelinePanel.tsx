import React from 'react';
import { History } from 'lucide-react';
import { ResolvedMetric, resolvedEvents } from './useTopicHealthLive';

/**
 * Real event timeline panel — renders the merged, newest-first event list from
 * one or more timeline-shaped registry metrics (drift.* watchers, audit
 * event-lists). Every row is a real collected event ({t, label} + passthrough
 * metadata from the resolver); an empty feed renders the honest "no events
 * collected yet" state. Nothing is synthesized.
 */

export interface TimelineSourceDef {
  key: string;
  /** Short source tag shown on each event row (e.g. "CA policy"). */
  tag: string;
  /** Status token class for the tag chip. */
  tagClass: string;
}

interface EventTimelinePanelProps {
  title: string;
  subtitle: string;
  sources: TimelineSourceDef[];
  metrics: Record<string, ResolvedMetric>;
  /** Max events rendered (default 12). */
  limit?: number;
  emptyCopy: string;
}

export const EventTimelinePanel: React.FC<EventTimelinePanelProps> = ({
  title,
  subtitle,
  sources,
  metrics,
  limit = 12,
  emptyCopy,
}) => {
  const merged = sources
    .flatMap((src) =>
      resolvedEvents(metrics[src.key]).map((e) => ({ ...e, __tag: src.tag, __tagClass: src.tagClass })),
    )
    .filter((e) => e.t)
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, limit);

  // Sources that genuinely resolved (even to zero events) vs. no data at all —
  // lets the footer say "watching N feeds" honestly.
  const liveSources = sources.filter((src) => metrics[src.key]?.status === 'ok');

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-primary" />
          {title}
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">{subtitle}</span>
      </div>

      {merged.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8 text-center px-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {liveSources.length > 0
              ? 'No events in the look-back window — your watched feeds are clean.'
              : emptyCopy}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {merged.map((e, i) => (
            <li key={`${e.t}-${i}`} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <span
                  className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 ${e.__tagClass}`}
                >
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
      )}

      <div className="pt-2 mt-auto border-t border-border text-[10px] font-mono text-muted-foreground flex justify-between">
        <span>
          {liveSources.length > 0
            ? `Watching ${liveSources.length} of ${sources.length} feeds`
            : 'Feeds activate with monitoring data'}
        </span>
        <span>{merged.length > 0 ? `${merged.length} shown` : ''}</span>
      </div>
    </div>
  );
};
