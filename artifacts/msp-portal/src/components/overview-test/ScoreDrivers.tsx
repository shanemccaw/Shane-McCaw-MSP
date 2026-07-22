import React from 'react';
import {
  ShieldAlert,
  Scale,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
} from 'lucide-react';
import { ScoreDriverCategory } from './types';

interface ScoreDriversProps {
  categories: ScoreDriverCategory[];
  onOpenDriverDetail: (categoryTitle: string) => void;
}

export const ScoreDrivers: React.FC<ScoreDriversProps> = ({
  categories,
  onOpenDriverDetail,
}) => {
  const getCategoryHeaderIcon = (type: string) => {
    switch (type) {
      case 'security':
        return <ShieldAlert className="w-5 h-5 text-red-400" />;
      case 'governance':
        return <Scale className="w-5 h-5 text-amber-400" />;
      case 'copilot':
        return <Sparkles className="w-5 h-5 text-purple-300" />;
      default:
        return <ShieldAlert className="w-5 h-5 text-[#479ef5]" />;
    }
  };

  const renderSparkline = (data: number[], strokeColor: string) => {
    // Generate SVG path for sparkline
    const width = 40;
    const height = 20;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data
      .map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          className="sparkline-path"
        />
      </svg>
    );
  };

  const getItemIcon = (status: 'compliant' | 'warning' | 'error') => {
    switch (status) {
      case 'compliant':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />;
    }
  };

  return (
    <section className="mb-12 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">Score Drivers</h2>
        <span className="text-xs text-slate-400 font-mono">Weighted Health Vectors</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {categories.map((cat) => {
          const strokeColor =
            cat.type === 'security'
              ? '#ffb4ab'
              : cat.type === 'governance'
              ? '#ffb95c'
              : '#d6bbf8';

          return (
            <div
              key={cat.title}
              onClick={() => onOpenDriverDetail(cat.title)}
              className="glass-panel p-6 rounded-2xl flex flex-col justify-between gap-6 hover:border-white/20 transition-all cursor-pointer group hover:bg-[#242830]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {getCategoryHeaderIcon(cat.type)}
                  <h3 className="font-bold text-base text-white group-hover:text-[#479ef5] transition-colors">
                    {cat.title}
                  </h3>
                </div>
                {renderSparkline(cat.sparklineData, strokeColor)}
              </div>

              <ul className="space-y-4">
                {cat.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3">
                    {getItemIcon(item.status)}
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-200">{item.title}</p>
                      
                      {item.progress !== undefined ? (
                        <div className="w-full bg-white/10 h-1.5 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className="bg-[#479ef5] h-full rounded-full transition-all duration-500"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="pt-2 text-[11px] text-[#479ef5] font-medium flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>View Drivers Breakdown</span>
                <Info className="w-3 h-3" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
