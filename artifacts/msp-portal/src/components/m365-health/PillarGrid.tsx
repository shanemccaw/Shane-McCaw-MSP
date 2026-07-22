import React from 'react';
import {
  Shield,
  Gavel,
  ShieldCheck,
  Users,
  Bot,
  Network,
  Receipt,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
} from 'lucide-react';
import { PillarData } from './types';

interface PillarGridProps {
  pillars: PillarData[];
  onSelectPillar: (pillarId: string) => void;
  selectedPillarId?: string;
}

export const PillarGrid: React.FC<PillarGridProps> = ({
  pillars,
  onSelectPillar,
  selectedPillarId,
}) => {
  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'Shield':
        return Shield;
      case 'Gavel':
        return Gavel;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'Users':
        return Users;
      case 'Bot':
        return Bot;
      case 'Network':
        return Network;
      case 'Receipt':
        return Receipt;
      default:
        return Shield;
    }
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-mono font-bold text-[#c0c7d3] uppercase tracking-wider">
          7-Pillar Health Score Matrix
        </h3>
        <span className="text-[11px] font-mono text-[#8a919d]">Click any pillar for deep telemetry & actions</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {pillars.map((pillar) => {
          const IconComp = getIconComponent(pillar.icon);
          const isSelected = selectedPillarId === pillar.id;

          return (
            <div
              key={pillar.id}
              onClick={() => onSelectPillar(pillar.id)}
              className={`glass-card p-4 rounded-xl cursor-pointer transition-all duration-300 relative group flex flex-col justify-between ${
                isSelected
                  ? 'ring-2 ring-[#479ef5] bg-[#2a2a2a] shadow-[0_0_20px_rgba(71,158,245,0.2)]'
                  : 'hover:-translate-y-1'
              }`}
            >
              {/* Pillar top row: Icon & Trend pill */}
              <div className="flex justify-between items-start mb-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: `${pillar.color}15`,
                    color: pillar.color,
                  }}
                >
                  <IconComp className="w-4 h-4" />
                </div>

                <div className="flex items-center text-[10px] font-mono font-semibold">
                  {pillar.trend === 'up' && (
                    <span className="flex items-center text-[#a0c9ff]">
                      <TrendingUp className="w-3 h-3 mr-0.5" />
                      +{pillar.change}%
                    </span>
                  )}
                  {pillar.trend === 'down' && (
                    <span className="flex items-center text-[#ffb4ab]">
                      <TrendingDown className="w-3 h-3 mr-0.5" />
                      {pillar.change}%
                    </span>
                  )}
                  {pillar.trend === 'stable' && (
                    <span className="text-[#8a919d] font-bold">STABLE</span>
                  )}
                </div>
              </div>

              {/* Title & Score */}
              <div className="mb-3">
                <h4 className="text-[11px] font-mono text-[#c0c7d3] font-medium flex items-center justify-between">
                  <span>{pillar.name}</span>
                  <ChevronRight className="w-3 h-3 text-[#8a919d] opacity-0 group-hover:opacity-100 transition-opacity" />
                </h4>
                <p className="font-headline text-2xl font-bold text-[#e2e2e2] mt-0.5" style={{ color: isSelected ? pillar.color : undefined }}>
                  {pillar.score}
                </p>
              </div>

              {/* Sparkline Bars */}
              <div className="h-8 flex items-end space-x-1 pt-1 border-t border-[#404752]/30">
                {pillar.bars.map((barVal, bIdx) => (
                  <div
                    key={bIdx}
                    className="w-full rounded-t-sm transition-all duration-300 group-hover:brightness-125"
                    style={{
                      height: `${(barVal / 8) * 100}%`,
                      backgroundColor: pillar.color,
                      opacity: 0.7 + bIdx * 0.1,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
