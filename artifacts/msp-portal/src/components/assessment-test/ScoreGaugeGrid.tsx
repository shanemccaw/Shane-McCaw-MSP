import React from 'react';
import { MetricGauge } from '../types';
import { ScoreGaugeCard } from './ScoreGaugeCard';

interface ScoreGaugeGridProps {
  gauges: MetricGauge[];
  onSelectGauge?: (gauge: MetricGauge) => void;
}

export const ScoreGaugeGrid: React.FC<ScoreGaugeGridProps> = ({ gauges, onSelectGauge }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {gauges.map((gauge) => (
        <ScoreGaugeCard key={gauge.id} gauge={gauge} onSelectGauge={onSelectGauge} />
      ))}
    </div>
  );
};
