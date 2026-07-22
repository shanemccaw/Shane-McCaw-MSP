import React from 'react';
import {
  Activity,
  Shield,
  Scale,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Building,
  Factory,
  Landmark,
} from 'lucide-react';
import { ScoreCardData } from './types';

interface HeroSnapshotProps {
  scoreCards: ScoreCardData[];
  onViewFindings: () => void;
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;
}

export const HeroSnapshot: React.FC<HeroSnapshotProps> = ({
  scoreCards,
  onViewFindings,
  selectedCategory,
  setSelectedCategory,
}) => {
  const getIcon = (category: string) => {
    switch (category) {
      case 'health':
        return <Activity className="w-5 h-5 text-[#479ef5]" />;
      case 'security':
        return <Shield className="w-5 h-5 text-[#ffb4ab]" />;
      case 'governance':
        return <Scale className="w-5 h-5 text-[#ffb95c]" />;
      case 'copilot':
        return <Sparkles className="w-5 h-5 text-[#d6bbf8]" />;
      default:
        return <Activity className="w-5 h-5 text-[#479ef5]" />;
    }
  };

  const getIconBg = (category: string) => {
    switch (category) {
      case 'health':
        return 'bg-[#479ef5]/10';
      case 'security':
        return 'bg-[#ffb4ab]/10';
      case 'governance':
        return 'bg-[#ffb95c]/10';
      case 'copilot':
        return 'bg-[#d6bbf8]/10';
      default:
        return 'bg-[#479ef5]/10';
    }
  };

  const getBorderHover = (category: string) => {
    switch (category) {
      case 'health':
        return 'hover:border-[#479ef5]/60 hover:shadow-[#479ef5]/10';
      case 'security':
        return 'hover:border-[#ffb4ab]/60 hover:shadow-[#ffb4ab]/10';
      case 'governance':
        return 'hover:border-[#ffb95c]/60 hover:shadow-[#ffb95c]/10';
      case 'copilot':
        return 'hover:border-[#d6bbf8]/60 hover:shadow-[#d6bbf8]/10';
      default:
        return 'hover:border-[#479ef5]/60';
    }
  };

  const renderTrend = (trend: 'up' | 'down' | 'stable', changeText: string) => {
    if (trend === 'up') {
      return (
        <div className="flex items-center text-emerald-400 gap-1 text-xs font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>{changeText}</span>
        </div>
      );
    }
    if (trend === 'down') {
      return (
        <div className="flex items-center text-red-400 gap-1 text-xs font-semibold bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
          <TrendingDown className="w-3.5 h-3.5" />
          <span>{changeText}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center text-slate-400 gap-1 text-xs font-semibold bg-slate-500/10 px-2 py-0.5 rounded-full border border-slate-500/20">
        <Minus className="w-3.5 h-3.5" />
        <span>{changeText}</span>
      </div>
    );
  };

  return (
    <section className="relative py-8 lg:py-12">
      <div className="max-w-6xl mx-auto">
        
        {/* Main Title & Description */}
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
            Your Tenant’s{' '}
            <span className="text-[#479ef5] bg-gradient-to-r from-[#479ef5] to-[#60a5fa] bg-clip-text text-transparent">
              Real-Time Health
            </span>{' '}
            &{' '}
            <span className="text-[#d6bbf8] bg-gradient-to-r from-[#d6bbf8] to-[#c084fc] bg-clip-text text-transparent">
              Risk Posture
            </span>
          </h1>
          <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
            For IT, security, and compliance teams managing Microsoft 365 risk, governance, and Copilot readiness.
            Instant visibility into cross-tenant drift and security anomalies.
          </p>
        </div>

        {/* 4 Score Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {scoreCards.map((card) => {
            const isSelected = selectedCategory === card.category;
            return (
              <div
                key={card.id}
                onClick={() => setSelectedCategory(isSelected ? null : card.category)}
                className={`glass-panel p-5 rounded-2xl flex flex-col justify-between gap-4 relative group cursor-pointer transition-all duration-200 border ${getBorderHover(
                  card.category
                )} ${
                  isSelected ? 'ring-2 ring-[#479ef5] bg-[#242830]' : 'bg-[#1c2025]'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className={`p-2.5 rounded-xl ${getIconBg(card.category)}`}>
                    {getIcon(card.category)}
                  </div>
                  {renderTrend(card.trend, card.change)}
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-400 mb-1">{card.title}</h3>
                  <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight flex items-baseline gap-1">
                    {card.score}
                    <span className="text-xl font-normal text-slate-400">%</span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono border-t border-white/5 pt-2.5 flex items-center justify-between">
                  <span>Last scan: {card.lastScan}</span>
                  <span className="text-[10px] text-[#479ef5] opacity-0 group-hover:opacity-100 transition-opacity">
                    Filter →
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Primary CTA & Social Trust Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-[#1c2025]/60 p-4 sm:p-5 rounded-2xl border border-white/5">
          <button
            onClick={onViewFindings}
            className="w-full sm:w-auto px-7 py-3 bg-[#479ef5] hover:bg-[#3b82f6] text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-[#479ef5]/25 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 group"
          >
            <span>View Full Findings</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>

          <div className="flex items-center gap-4 text-slate-400 text-xs font-mono">
            <span className="text-[11px] tracking-wider uppercase text-slate-400 font-semibold">
              TRUSTED BY INDUSTRY LEADERS
            </span>
            <div className="h-4 w-px bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-4 text-slate-400">
              <span title="Corporate Enterprises">
                <Building className="w-4 h-4 hover:text-white transition-colors" />
              </span>
              <span title="Manufacturing & Industrial">
                <Factory className="w-4 h-4 hover:text-white transition-colors" />
              </span>
              <span title="Financial & Government">
                <Landmark className="w-4 h-4 hover:text-white transition-colors" />
              </span>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
