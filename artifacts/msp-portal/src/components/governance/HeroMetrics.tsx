import React from 'react';
import { GovernanceHealth } from './types';
import { TrendingUp, Users, AlertOctagon, ShieldAlert } from 'lucide-react';

interface HeroMetricsProps {
  data: GovernanceHealth;
  onCardClick?: (metricKey: string) => void;
}

export const HeroMetrics: React.FC<HeroMetricsProps> = ({ data, onCardClick }) => {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Governance Health Score */}
      <div 
        onClick={() => onCardClick?.('health')}
        className="glass-card p-6 flex flex-col justify-between border-t-2 border-t-[#479ef5] rounded-xl relative overflow-hidden h-48 cursor-pointer group"
      >
        <div className="flex justify-between items-start">
          <span className="font-mono text-xs text-[#c0c7d3] uppercase font-medium">
            GOVERNANCE HEALTH SCORE
          </span>
          <ShieldAlert className="w-4 h-4 text-[#479ef5]/60 group-hover:text-[#479ef5] transition-colors" />
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-4xl md:text-5xl font-bold metric-glow-blue text-[#e2e2e2]">
              {data.score}
            </span>
            <span className="font-headline text-lg text-[#479ef5]">/{data.maxScore}</span>
          </div>
          <div className="w-full h-1.5 bg-[#333535] rounded-full mt-3 overflow-hidden">
            <div 
              className="h-full bg-[#479ef5] transition-all duration-700 ease-out shadow-[0_0_12px_rgba(71,158,245,0.6)]"
              style={{ width: `${(data.score / data.maxScore) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 2. Policy Drift Events (30D) */}
      <div 
        onClick={() => onCardClick?.('drift')}
        className="glass-card p-6 flex flex-col justify-between border-t-2 border-t-[#eab308] rounded-xl h-48 cursor-pointer group"
      >
        <div className="flex justify-between items-start">
          <span className="font-mono text-xs text-[#c0c7d3] uppercase font-medium">
            POLICY DRIFT EVENTS (30D)
          </span>
          <TrendingUp className="w-4 h-4 text-[#eab308]/60 group-hover:text-[#eab308] transition-colors" />
        </div>
        <div>
          <span className="font-display text-4xl md:text-5xl font-bold text-[#eab308] metric-glow-amber">
            {data.driftEvents30D}
          </span>
          <div className="flex items-center gap-1.5 text-[#ef4444] mt-2">
            <TrendingUp className="w-4 h-4" />
            <span className="font-mono text-xs">+{data.driftTrendPercent}% vs last period</span>
          </div>
        </div>
      </div>

      {/* 3. Admin Accounts */}
      <div 
        onClick={() => onCardClick?.('admins')}
        className="glass-card p-6 flex flex-col justify-between border-t-2 border-t-[#c084fc] rounded-xl h-48 cursor-pointer group"
      >
        <div className="flex justify-between items-start">
          <span className="font-mono text-xs text-[#c0c7d3] uppercase font-medium">
            ADMIN ACCOUNTS
          </span>
          <Users className="w-4 h-4 text-[#c084fc]/60 group-hover:text-[#c084fc] transition-colors" />
        </div>
        <div>
          <span className="font-display text-4xl md:text-5xl font-bold text-[#c084fc] metric-glow-violet">
            {data.adminAccounts}
          </span>
          <p className="font-body text-xs text-[#8a919d] mt-2">
            {data.pendingReviewsCount} Pending Review Requests
          </p>
        </div>
      </div>

      {/* 4. Group Sprawl Index */}
      <div 
        onClick={() => onCardClick?.('sprawl')}
        className="glass-card p-6 flex flex-col justify-between border-t-2 border-t-[#ef4444] rounded-xl h-48 cursor-pointer group"
      >
        <div className="flex justify-between items-start">
          <span className="font-mono text-xs text-[#c0c7d3] uppercase font-medium">
            GROUP SPRAWL INDEX
          </span>
          <AlertOctagon className="w-4 h-4 text-[#ef4444]/60 group-hover:text-[#ef4444] transition-colors" />
        </div>
        <div>
          <span className="font-display text-4xl md:text-5xl font-bold text-[#ef4444] metric-glow-red">
            {data.groupSprawlIndex}%
          </span>
          <p className="font-body text-xs text-[#8a919d] mt-2">
            Critical: High Density
          </p>
        </div>
      </div>
    </section>
  );
};
