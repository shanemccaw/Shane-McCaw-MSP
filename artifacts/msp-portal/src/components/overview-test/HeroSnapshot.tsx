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
        return <Activity className="w-5 h-5 text-primary" />;
      case 'security':
        return <Shield className="w-5 h-5 text-destructive" />;
      case 'governance':
        return <Scale className="w-5 h-5 text-[hsl(40,65%,55%)]" />;
      case 'copilot':
        return <Sparkles className="w-5 h-5 text-accent" />;
      default:
        return <Activity className="w-5 h-5 text-primary" />;
    }
  };

  const getIconBg = (category: string) => {
    switch (category) {
      case 'health':
        return 'bg-primary/10';
      case 'security':
        return 'bg-destructive/10';
      case 'governance':
        return 'bg-[hsl(40,65%,55%)]/10';
      case 'copilot':
        return 'bg-accent/10';
      default:
        return 'bg-primary/10';
    }
  };

  const getBorderHover = (category: string) => {
    switch (category) {
      case 'health':
        return 'hover:border-primary/60 hover:shadow-primary/10';
      case 'security':
        return 'hover:border-destructive/60 hover:shadow-destructive/10';
      case 'governance':
        return 'hover:border-[hsl(40,65%,55%)]/60 hover:shadow-[hsl(40,65%,55%)]/10';
      case 'copilot':
        return 'hover:border-accent/60 hover:shadow-accent/10';
      default:
        return 'hover:border-primary/60';
    }
  };

  const renderTrend = (trend: 'up' | 'down' | 'stable', changeText: string) => {
    if (trend === 'up') {
      return (
        <div className="flex items-center text-[hsl(149,36%,49%)] gap-1 text-xs font-semibold bg-[hsl(149,36%,49%)]/10 px-2 py-0.5 rounded-full border border-[hsl(149,36%,49%)]/20">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>{changeText}</span>
        </div>
      );
    }
    if (trend === 'down') {
      return (
        <div className="flex items-center text-destructive gap-1 text-xs font-semibold bg-destructive/10 px-2 py-0.5 rounded-full border border-destructive/20">
          <TrendingDown className="w-3.5 h-3.5" />
          <span>{changeText}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center text-muted-foreground gap-1 text-xs font-semibold bg-muted-foreground/10 px-2 py-0.5 rounded-full border border-muted-foreground/20">
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
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-tight mb-4">
            Your Tenant’s{' '}
            <span className="text-primary bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Real-Time Health
            </span>{' '}
            &{' '}
            <span className="text-accent bg-gradient-to-r from-accent to-accent/70 bg-clip-text text-transparent">
              Risk Posture
            </span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-3xl leading-relaxed">
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
                  isSelected ? 'ring-2 ring-primary bg-secondary' : 'bg-card'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className={`p-2.5 rounded-xl ${getIconBg(card.category)}`}>
                    {getIcon(card.category)}
                  </div>
                  {renderTrend(card.trend, card.change)}
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-1">{card.title}</h3>
                  <div className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight flex items-baseline gap-1">
                    {card.score}
                    <span className="text-xl font-normal text-muted-foreground">%</span>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground font-mono border-t border-border pt-2.5 flex items-center justify-between">
                  <span>Last scan: {card.lastScan}</span>
                  <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Filter →
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Primary CTA & Social Trust Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-card/60 p-4 sm:p-5 rounded-2xl border border-border">
          <button
            onClick={onViewFindings}
            className="w-full sm:w-auto px-7 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl shadow-lg shadow-primary/25 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 group"
          >
            <span>View Full Findings</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>

          <div className="flex items-center gap-4 text-muted-foreground text-xs font-mono">
            <span className="text-[11px] tracking-wider uppercase text-muted-foreground font-semibold">
              TRUSTED BY INDUSTRY LEADERS
            </span>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <div className="flex items-center gap-4 text-muted-foreground">
              <span title="Corporate Enterprises">
                <Building className="w-4 h-4 hover:text-foreground transition-colors" />
              </span>
              <span title="Manufacturing & Industrial">
                <Factory className="w-4 h-4 hover:text-foreground transition-colors" />
              </span>
              <span title="Financial & Government">
                <Landmark className="w-4 h-4 hover:text-foreground transition-colors" />
              </span>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
