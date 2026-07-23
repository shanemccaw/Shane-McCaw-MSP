import React, { useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { ResolvedMetric } from './useTopicHealthLive';

/**
 * Real day×hour activity heatmap — renders the resolver's real heatmap cells
 * ({x: hourOfDayUTC, y: dayOfWeekUTC, value} from aggregateSigninHeatmap over
 * raw collected events). Cell intensity is the real count scaled to the real
 * max; missing cells mean genuinely no events in that bucket. Honest empty
 * state when the backing check hasn't collected raw events yet.
 */

interface ActivityHeatmapPanelProps {
  title: string;
  subtitle: string;
  metricKey: string;
  metrics: Record<string, ResolvedMetric>;
  emptyCopy: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function extractCells(r: ResolvedMetric | undefined): { x: number; y: number; value: number }[] {
  if (!r || r.status !== 'ok') return [];
  const cells = (r.data as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return [];
  return cells.filter(
    (c): c is { x: number; y: number; value: number } =>
      !!c &&
      typeof (c as { x?: unknown }).x === 'number' &&
      typeof (c as { y?: unknown }).y === 'number' &&
      typeof (c as { value?: unknown }).value === 'number',
  );
}

export const ActivityHeatmapPanel: React.FC<ActivityHeatmapPanelProps> = ({
  title,
  subtitle,
  metricKey,
  metrics,
  emptyCopy,
}) => {
  const cells = extractCells(metrics[metricKey]);
  const [hovered, setHovered] = useState<{ day: number; hour: number; value: number } | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.y}:${c.x}`, c.value]));
  const max = Math.max(1, ...cells.map((c) => c.value));

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Grid3x3 className="w-3.5 h-3.5 text-primary" />
          {title}
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">{subtitle}</span>
      </div>

      {cells.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-10 text-center px-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{emptyCopy}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[420px]">
              {DAY_LABELS.map((label, day) => (
                <div key={day} className="flex items-center gap-1 mb-1">
                  <span className="w-8 text-[9px] font-mono text-muted-foreground flex-shrink-0">
                    {label}
                  </span>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const value = byKey.get(`${day}:${hour}`) ?? 0;
                    return (
                      <div
                        key={hour}
                        onMouseEnter={() => setHovered({ day, hour, value })}
                        onMouseLeave={() => setHovered(null)}
                        className="flex-1 aspect-square rounded-[2px] min-w-[10px] cursor-default"
                        style={{
                          backgroundColor:
                            value > 0
                              ? `color-mix(in srgb, var(--color-primary) ${Math.round((value / max) * 85) + 15}%, transparent)`
                              : 'hsl(var(--muted))',
                        }}
                        title={`${label} ${String(hour).padStart(2, '0')}:00 UTC — ${value} events`}
                      />
                    );
                  })}
                </div>
              ))}
              <div className="flex items-center gap-1 mt-1">
                <span className="w-8 flex-shrink-0" />
                <div className="flex-1 flex justify-between text-[9px] font-mono text-muted-foreground">
                  <span>00h</span>
                  <span>06h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>23h</span>
                </div>
              </div>
            </div>
          </div>
          <div className="pt-2 mt-3 border-t border-border text-[10px] font-mono text-muted-foreground flex justify-between">
            <span>
              {hovered
                ? `${DAY_LABELS[hovered.day]} ${String(hovered.hour).padStart(2, '0')}:00 UTC — ${hovered.value.toLocaleString()} events`
                : 'Real collected events bucketed by day × hour (UTC)'}
            </span>
            <span>peak {max.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
};
