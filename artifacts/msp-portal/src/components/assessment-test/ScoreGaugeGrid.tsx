import React from 'react';
import { MetricGauge } from './types';
import { ScoreGaugeCard } from './ScoreGaugeCard';

interface ScoreGaugeGridProps {
  gauges: MetricGauge[];
  onSelectGauge?: (gauge: MetricGauge) => void;
}

export const ScoreGaugeGrid: React.FC<ScoreGaugeGridProps> = ({ gauges, onSelectGauge }) => {
  if (gauges.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-[#8a919d]">
        No pillar scores available yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {gauges.map((gauge) => (
        <ScoreGaugeCard key={gauge.id} gauge={gauge} onSelectGauge={onSelectGauge} />
      ))}
    </div>
  );
};
