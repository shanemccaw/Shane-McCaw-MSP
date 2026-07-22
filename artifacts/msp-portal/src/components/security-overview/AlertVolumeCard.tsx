import React, { useState } from 'react';
import { DailyAlertVolume, SeverityLevel } from './types';
import { Clock, Sliders } from 'lucide-react';

interface AlertVolumeCardProps {
  volumeData: DailyAlertVolume[];
  mtta: string;
}

export const AlertVolumeCard: React.FC<AlertVolumeCardProps> = ({ volumeData, mtta }) => {
  const [activeSeverity, setActiveSeverity] = useState<SeverityLevel | 'all'>('all');
  const [hoveredDay, setHoveredDay] = useState<DailyAlertVolume | null>(null);

  const severityColors: Record<SeverityLevel, { bg: string; label: string; text: string }> = {
    critical: { bg: 'bg-[#93000a]', label: 'Critical', text: 'text-[#ffb4ab]' },
    high: { bg: 'bg-[#5a3289]', label: 'High', text: 'text-[#dab9ff]' },
    medium: { bg: 'bg-[#479ef5]', label: 'Medium', text: 'text-[#a0c9ff]' },
    low: { bg: 'bg-[#333535]', label: 'Low', text: 'text-[#8a919d]' },
  };

  return (
    <div className="glass-card rounded-xl p-6 border border-white/10 shadow-xl flex flex-col justify-between h-full">
      {/* Card Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="font-headline text-lg font-semibold text-[#a0c9ff] flex items-center gap-2">
            Alert Volume & Severity
          </h2>
          <p className="text-[#c0c7d3] text-xs font-mono">Daily severity distribution</p>
        </div>

        {/* MTTA metric */}
        <div className="flex items-center gap-3 bg-[#0c0f0f]/80 px-3 py-1.5 rounded-lg border border-white/5">
          <Clock className="w-4 h-4 text-[#a0c9ff]" />
          <div className="text-right">
            <span className="text-[#c0c7d3] font-mono text-[10px] uppercase block">MTTA</span>
            <span className="font-headline text-sm font-semibold text-white">{mtta}</span>
          </div>
        </div>
      </div>

      {/* Stacked Bar Chart */}
      <div className="flex-grow flex items-end gap-3 h-52 mb-4 pt-2">
        {volumeData.map((dayData, idx) => {
          const total =
            dayData.counts.critical +
            dayData.counts.high +
            dayData.counts.medium +
            dayData.counts.low;

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredDay(dayData)}
              onMouseLeave={() => setHoveredDay(null)}
              className="flex-grow flex flex-col justify-end gap-1 h-full relative group cursor-pointer"
            >
              {/* Stacked segments */}
              <div
                className={`w-full rounded-xs transition-all duration-200 ${
                  activeSeverity === 'all' || activeSeverity === 'critical'
                    ? 'bg-[#93000a] group-hover:brightness-125'
                    : 'bg-[#93000a]/20'
                }`}
                style={{ height: `${(dayData.counts.critical / total) * 100}%` }}
                title={`Critical: ${dayData.counts.critical}`}
              />
              <div
                className={`w-full rounded-xs transition-all duration-200 ${
                  activeSeverity === 'all' || activeSeverity === 'high'
                    ? 'bg-[#5a3289] group-hover:brightness-125'
                    : 'bg-[#5a3289]/20'
                }`}
                style={{ height: `${(dayData.counts.high / total) * 100}%` }}
                title={`High: ${dayData.counts.high}`}
              />
              <div
                className={`w-full rounded-xs transition-all duration-200 ${
                  activeSeverity === 'all' || activeSeverity === 'medium'
                    ? 'bg-[#479ef5] group-hover:brightness-125'
                    : 'bg-[#479ef5]/20'
                }`}
                style={{ height: `${(dayData.counts.medium / total) * 100}%` }}
                title={`Medium: ${dayData.counts.medium}`}
              />
              <div
                className={`w-full rounded-xs transition-all duration-200 ${
                  activeSeverity === 'all' || activeSeverity === 'low'
                    ? 'bg-[#333535] group-hover:brightness-125'
                    : 'bg-[#333535]/20'
                }`}
                style={{ height: `${(dayData.counts.low / total) * 100}%` }}
                title={`Low: ${dayData.counts.low}`}
              />

              {/* Day label / Today indicator */}
              {dayData.isToday ? (
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] text-[#a0c9ff] font-semibold tracking-wider">
                  TODAY
                </div>
              ) : (
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] text-[#c0c7d3]">
                  {dayData.day}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover Information / Dynamic Legend */}
      <div className="mt-8 pt-3 border-t border-[#404752]/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {(['critical', 'high', 'medium', 'low'] as SeverityLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setActiveSeverity(activeSeverity === level ? 'all' : level)}
              className={`flex items-center gap-1.5 transition-opacity ${
                activeSeverity === 'all' || activeSeverity === level ? 'opacity-100' : 'opacity-40'
              }`}
            >
              <div className={`w-3 h-3 ${severityColors[level].bg} rounded-xs`} />
              <span className="font-mono text-xs text-[#c0c7d3] capitalize">
                {severityColors[level].label}
              </span>
            </button>
          ))}
        </div>

        {hoveredDay && (
          <div className="font-mono text-[11px] text-[#a0c9ff] bg-[#0c0f0f]/90 px-2.5 py-1 rounded border border-[#479ef5]/30">
            {hoveredDay.day}: {hoveredDay.counts.critical + hoveredDay.counts.high + hoveredDay.counts.medium + hoveredDay.counts.low} alerts
          </div>
        )}
      </div>
    </div>
  );
};
