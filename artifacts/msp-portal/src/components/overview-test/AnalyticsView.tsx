import React from 'react';
import { BarChart3, TrendingUp, ShieldAlert, Sparkles, Activity } from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  return (
    <div className="max-w-6xl mx-auto py-8 space-y-8 animate-in fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Tenant Drift & Telemetry Analytics</h2>
        <p className="text-xs text-slate-400 mt-1">
          Historical trend analysis of security posture, identity compliance, and Copilot readiness metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Card 1: 30-Day Trend Chart Simulator */}
        <div className="glass-panel p-6 rounded-2xl lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#479ef5]" />
              30-Day Security & Drift Trajectory
            </h3>
            <div className="flex gap-2 text-xs">
              <span className="px-2.5 py-1 bg-[#479ef5]/20 text-[#479ef5] rounded font-mono font-bold">Health (+4.2%)</span>
              <span className="px-2.5 py-1 bg-purple-500/20 text-purple-300 rounded font-mono font-bold">Copilot (+12%)</span>
            </div>
          </div>

          <div className="h-56 flex items-end justify-between gap-2 pt-6 px-2 border-b border-white/10">
            {[65, 68, 72, 70, 75, 80, 82, 85, 84, 88, 90, 92].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                <div
                  className="w-full bg-gradient-to-t from-[#479ef5]/30 to-[#479ef5] rounded-t group-hover:brightness-125 transition-all"
                  style={{ height: `${val}%` }}
                />
                <span className="text-[9px] font-mono text-slate-500">W{idx + 1}</span>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-xs text-slate-400">
            <span>Scan Baseline: Jun 21</span>
            <span className="text-emerald-400 font-bold">Current Score: 92% (Peak Optimal)</span>
          </div>
        </div>

        {/* Card 2: Workload Vulnerability Index */}
        <div className="glass-panel p-6 rounded-2xl space-y-6">
          <h3 className="font-bold text-white text-base flex items-center gap-2 border-b border-white/10 pb-4">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            Workload Risk Index
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Entra ID (Azure AD)</span>
                <span className="text-amber-400 font-bold font-mono">Medium Risk (78%)</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-amber-400 h-full rounded-full" style={{ width: '78%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Exchange Online</span>
                <span className="text-red-400 font-bold font-mono">High Risk (62%)</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-red-400 h-full rounded-full" style={{ width: '62%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">SharePoint & OneDrive</span>
                <span className="text-emerald-400 font-bold font-mono">Low Risk (91%)</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-400 h-full rounded-full" style={{ width: '91%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Microsoft Teams</span>
                <span className="text-[#479ef5] font-bold font-mono">Optimal (95%)</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-[#479ef5] h-full rounded-full" style={{ width: '95%' }} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
