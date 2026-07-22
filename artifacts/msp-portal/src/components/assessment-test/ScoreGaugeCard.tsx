import React, { useState } from 'react';
import { MetricGauge } from './types';
import {
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  ShieldCheck,
  Scale,
  FileCheck,
  Lock,
} from 'lucide-react';

interface ScoreGaugeCardProps {
  gauge: MetricGauge;
  onSelectGauge?: (gauge: MetricGauge) => void;
}

export const ScoreGaugeCard: React.FC<ScoreGaugeCardProps> = ({ gauge, onSelectGauge }) => {
  const [isHovered, setIsHovered] = useState(false);

  // Radius = 40, circumference = ~251.327
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - gauge.score / 100);

  // Color & Authority Profile generator
  // Security = Green, Governance = Amber, Compliance = Blue, Copilot = Copilot Gradient
  const getProfile = () => {
    const titleLower = gauge.title.toLowerCase();

    if (titleLower.includes('security')) {
      return {
        icon: <ShieldCheck className="w-3.5 h-3.5 text-[#34d399]" />,
        headerColor: 'text-[#34d399]',
        gradId: 'securityGaugeGrad',
        gradStops: (
          <linearGradient id="securityGaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        ),
        stroke: 'url(#securityGaugeGrad)',
        glowColor: 'rgba(52, 211, 153, 0.4)',
        numStyle: 'text-[#34d399] font-mono',
        cardHover: 'hover:border-[#34d399]/60 hover:bg-[#182721]',
        trendColor: 'text-[#34d399]',
      };
    }

    if (titleLower.includes('governance')) {
      return {
        icon: <Scale className="w-3.5 h-3.5 text-[#fbbf24]" />,
        headerColor: 'text-[#fbbf24]',
        gradId: 'governanceGaugeGrad',
        gradStops: (
          <linearGradient id="governanceGaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
        ),
        stroke: 'url(#governanceGaugeGrad)',
        glowColor: 'rgba(251, 191, 36, 0.4)',
        numStyle: 'text-[#fbbf24] font-mono',
        cardHover: 'hover:border-[#fbbf24]/60 hover:bg-[#282218]',
        trendColor: 'text-[#fbbf24]',
      };
    }

    if (titleLower.includes('compliance')) {
      return {
        icon: <FileCheck className="w-3.5 h-3.5 text-[#60a5fa]" />,
        headerColor: 'text-[#60a5fa]',
        gradId: 'complianceGaugeGrad',
        gradStops: (
          <linearGradient id="complianceGaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        ),
        stroke: 'url(#complianceGaugeGrad)',
        glowColor: 'rgba(96, 165, 250, 0.4)',
        numStyle: 'text-[#60a5fa] font-mono',
        cardHover: 'hover:border-[#60a5fa]/60 hover:bg-[#192333]',
        trendColor: 'text-[#60a5fa]',
      };
    }

    // Copilot Readiness - Microsoft Copilot colors
    return {
      icon: <Sparkles className="w-3.5 h-3.5 text-[#c084fc]" />,
      headerColor: 'text-[#e879f9]',
      gradId: 'copilotGaugeGrad',
      gradStops: (
        <linearGradient id="copilotGaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="40%" stopColor="#818cf8" />
          <stop offset="75%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#fb7185" />
        </linearGradient>
      ),
      stroke: 'url(#copilotGaugeGrad)',
      glowColor: 'rgba(192, 132, 252, 0.4)',
      numStyle: 'bg-gradient-to-r from-[#38bdf8] via-[#c084fc] to-[#fb7185] bg-clip-text text-transparent font-mono',
      cardHover: 'hover:border-[#c084fc]/60 hover:bg-[#282535]',
      trendColor: 'text-[#c084fc]',
    };
  };

  const profile = getProfile();

  // Honest "not covered" state — the customer's scanned package genuinely
  // doesn't cover this pillar, so no score exists. Renders a muted card that
  // says so plainly instead of a fabricated gauge value.
  if (gauge.notCovered) {
    return (
      <div className="bg-[#242424] rounded-xl card-border p-4 flex flex-col items-center justify-center relative overflow-hidden shadow-md opacity-70">
        <div className="flex items-center gap-1.5 mb-2">
          {profile.icon}
          <span className="text-[11px] font-bold uppercase tracking-wider text-center text-[#8a919d]">
            {gauge.title}
          </span>
        </div>
        <div className="relative flex items-center justify-center w-24 h-24 my-1">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="8"
            />
          </svg>
          <span className="absolute text-xl font-extrabold tracking-tight text-[#8a919d] font-mono">—</span>
        </div>
        <div className="mt-1 text-[11px] font-medium text-[#8a919d] text-center">
          Not covered by this scan
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectGauge?.(gauge)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`bg-[#242424] rounded-xl card-border p-4 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer transition-all duration-300 shadow-md ${profile.cardHover}`}
    >
      {/* Header title */}
      <div className="flex items-center gap-1.5 mb-2">
        {profile.icon}
        <span className={`text-[11px] font-bold uppercase tracking-wider text-center ${profile.headerColor}`}>
          {gauge.title}
        </span>
        <Info className="w-3 h-3 text-[#8a919d] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* SVG Radial Gauge with subtle animation & glow */}
      <div className="relative flex items-center justify-center w-24 h-24 my-1">
        <svg
          className="w-full h-full transition-transform duration-500 group-hover:scale-105"
          viewBox="0 0 100 100"
          style={{
            filter: isHovered ? `drop-shadow(0px 0px 8px ${profile.glowColor})` : 'none',
          }}
        >
          <defs>{profile.gradStops}</defs>

          <g className="-rotate-90 origin-center">
            {/* Track Circle */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="8"
            />

            {/* Animated Progress Circle */}
            <circle
              className="transition-all duration-1000 ease-out"
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={profile.stroke}
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </g>
        </svg>

        {/* Center Score with Gradient Text */}
        <span className={`absolute text-xl font-extrabold tracking-tight group-hover:scale-110 transition-transform duration-300 ${profile.numStyle}`}>
          {gauge.score}%
        </span>
      </div>

      {/* Trend indicator footer — only when real trend/benchmark data exists
          (real pillar gauges have no benchmark source yet; never fabricated) */}
      {(gauge.trend || gauge.benchmark) && (
        <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[#8a919d]">
          {gauge.trend === 'up' && <TrendingUp className={`w-3 h-3 ${profile.trendColor}`} />}
          {gauge.trend === 'down' && <TrendingDown className="w-3 h-3 text-[#f59e0b]" />}
          {gauge.trend === 'neutral' && <Minus className="w-3 h-3 text-[#8a919d]" />}
          {gauge.benchmark && <span className="truncate max-w-[120px]">{gauge.benchmark}</span>}
        </div>
      )}
    </div>
  );
};
