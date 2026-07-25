import React, { useState } from 'react';
import { Clock, ShieldAlert, AlertTriangle, UserCheck, CheckCircle2, ChevronRight, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SlaTimerPillProps {
  minutesRemaining: number;
  slaTier?: string;
  onClaimAndWork?: () => void;
  isClaimed?: boolean;
  claimedBy?: string | null;
  compact?: boolean;
  className?: string;
}

export const SlaTimerPill: React.FC<SlaTimerPillProps> = ({
  minutesRemaining,
  slaTier = 'Platinum 15m Response',
  onClaimAndWork,
  isClaimed = false,
  claimedBy,
  compact = false,
  className
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Formatting remaining time
  const isOverdue = minutesRemaining < 0;
  const isRisk = minutesRemaining >= 0 && minutesRemaining < 15;
  const isWarning = minutesRemaining >= 15 && minutesRemaining <= 30;
  const absMins = Math.abs(minutesRemaining);
  const hours = Math.floor(absMins / 60);
  const mins = absMins % 60;

  const timeDisplay = isOverdue
    ? `+${hours > 0 ? `${hours}h ` : ''}${mins}m overdue`
    : hours > 0
    ? `${hours}h ${mins}m remaining`
    : `${mins}m remaining`;

  // Badge Visual States
  const getBadgeStyle = () => {
    if (isOverdue) {
      return 'bg-red-950/90 text-red-200 border-red-500/80 shadow-red-900/40 animate-pulse font-extrabold';
    }
    if (isRisk) {
      return 'bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-amber-900/30 font-bold';
    }
    if (isWarning) {
      return 'bg-yellow-950/50 text-yellow-300 border-yellow-600/40 font-medium';
    }
    return 'bg-slate-800/90 text-slate-300 border-slate-700 font-medium';
  };

  const getIcon = () => {
    if (isOverdue) return <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0 animate-bounce" />;
    if (isRisk) return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    return <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  };

  return (
    <div className="relative inline-block" onMouseLeave={() => setShowTooltip(false)}>
      <div
        onMouseEnter={() => setShowTooltip(true)}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all cursor-pointer select-none shadow-sm',
          getBadgeStyle(),
          className
        )}
      >
        {getIcon()}
        <span>{timeDisplay}</span>
        {!compact && (
          <span className="text-[10px] opacity-75 border-l border-current/20 pl-1.5 font-mono hidden sm:inline">
            {slaTier.split(' ')[0]}
          </span>
        )}
      </div>

      {/* SLA TIER HOVER / CLICK POPOVER */}
      {showTooltip && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 left-0 top-full mt-1.5 w-64 p-3 rounded-2xl bg-[#131927] border border-[#2a3854] shadow-2xl text-slate-100 text-xs space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-2 border-b border-[#23314a]">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-[#38BDF8]" />
              <span className="font-bold text-slate-200 uppercase text-[11px] tracking-wide">
                SLA Performance Tracker
              </span>
            </div>
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                isOverdue
                  ? 'bg-red-950 text-red-400 border-red-800'
                  : isRisk
                  ? 'bg-amber-950 text-amber-400 border-amber-800'
                  : 'bg-emerald-950 text-emerald-400 border-emerald-800'
              )}
            >
              {isOverdue ? 'SLA Breached' : isRisk ? 'At Risk' : 'On Track'}
            </span>
          </div>

          <div className="space-y-1 text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">Assigned SLA Tier:</span>
              <span className="font-semibold text-cyan-300">{slaTier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Time Status:</span>
              <span className={cn('font-mono font-bold', isOverdue ? 'text-red-400' : 'text-slate-200')}>
                {timeDisplay}
              </span>
            </div>
            {isClaimed && (
              <div className="flex justify-between items-center pt-1 border-t border-[#1f293d]">
                <span className="text-slate-400">Claimed By:</span>
                <span className="font-semibold text-emerald-400 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  {claimedBy || 'Active Tech'}
                </span>
              </div>
            )}
          </div>

          {/* 1-Click Claim Action */}
          {onClaimAndWork && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTooltip(false);
                onClaimAndWork();
              }}
              className={cn(
                'w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md mt-1',
                isClaimed
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  : 'bg-[#0078D4] hover:bg-[#005A9E] text-white shadow-[#0078D4]/30'
              )}
            >
              {isClaimed ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Work Claimed Task</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-3.5 h-3.5 text-white" />
                  <span>Claim & Work Task</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
