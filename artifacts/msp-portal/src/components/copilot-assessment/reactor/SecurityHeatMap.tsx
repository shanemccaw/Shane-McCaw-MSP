import React from 'react';
import { ShieldAlert, Flame, Eye, FileText, PenTool, Zap, Bot, Layers } from 'lucide-react';

interface SecurityHeatMapProps {
  mode: 'projected' | 'soc' | 'redteam';
  aiComfortLevel: number;
}

export const SecurityHeatMap: React.FC<SecurityHeatMapProps> = ({
  mode,
  aiComfortLevel
}) => {
  const isRedTeam = mode === 'redteam';

  // Action Modes
  const actionModes = [
    { key: 'read', label: '1. READ', icon: <Eye className="w-3.5 h-3.5" /> },
    { key: 'summarize', label: '2. SUMMARIZE', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'draft', label: '3. DRAFT', icon: <PenTool className="w-3.5 h-3.5" /> },
    { key: 'act', label: '4. ACT (GRAPH)', icon: <Zap className="w-3.5 h-3.5" /> },
    { key: 'automate', label: '5. AUTOMATE', icon: <Bot className="w-3.5 h-3.5" /> }
  ];

  // Sensitivity Types
  const sensitivityTypes = [
    { key: 'phi', label: 'PHI / HIPAA', base: 88, severity: 'Critical' },
    { key: 'pii', label: 'PII', base: 74, severity: 'High' },
    { key: 'cui', label: 'SBU / CUI', base: 65, severity: 'High' },
    { key: 'financial', label: 'Financial', base: 58, severity: 'Medium' },
    { key: 'internal', label: 'Internal', base: 35, severity: 'Low' }
  ];

  // Helper to calculate cell heat intensity (0 to 100)
  const getHeatValue = (sensitivityBase: number, actionIndex: number) => {
    const actionMultiplier = actionIndex === 0 ? 0.7 : actionIndex === 1 ? 0.9 : actionIndex === 2 ? 1.1 : actionIndex === 3 ? 1.3 : 1.5;
    const comfortMultiplier = aiComfortLevel === 1 ? 0.8 : aiComfortLevel === 2 ? 1.1 : 1.4;
    return Math.min(100, Math.round(sensitivityBase * actionMultiplier * comfortMultiplier));
  };

  const getHeatColor = (val: number) => {
    if (val > 80) return 'bg-rose-950/90 text-rose-300 border-rose-600 shadow-[0_0_12px_rgba(244,63,94,0.3)] font-black';
    if (val > 60) return 'bg-amber-950/80 text-amber-300 border-amber-600 font-bold';
    if (val > 40) return 'bg-sky-950/70 text-sky-300 border-sky-600';
    return 'bg-emerald-950/60 text-emerald-300 border-emerald-800';
  };

  return (
    <div className="bg-[#060912] border border-white/10 rounded-2xl p-4 space-y-4 my-3 select-none">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider">
              Security Heat Map — Blast Radius at Scale
            </h3>
            <p className="text-[10px] text-slate-400">
              Cross-evaluating Copilot Action Vectors against Data Sensitivity Classifications
            </p>
          </div>
        </div>

        <span className="text-[9.5px] font-mono text-amber-300 bg-amber-950/80 px-2.5 py-1 rounded-lg border border-amber-800 font-bold">
          {mode === 'projected' ? 'LATENT RISK MAP' : 'LIVE THREAT DENSITY'}
        </span>
      </div>

      {/* MATRIX TABLE */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-[10px] font-mono text-slate-400 uppercase">
              <th className="p-2 min-w-[130px]">Classification</th>
              {actionModes.map((act) => (
                <th key={act.key} className="p-2 min-w-[110px] text-center">
                  <div className="flex items-center justify-center space-x-1">
                    {act.icon}
                    <span>{act.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sensitivityTypes.map((st) => (
              <tr key={st.key} className="border-b border-white/5 hover:bg-slate-900/40 transition-colors">
                <td className="p-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white">{st.label}</span>
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                      st.severity === 'Critical' ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}>
                      {st.severity}
                    </span>
                  </div>
                </td>

                {actionModes.map((act, actIdx) => {
                  const heatVal = getHeatValue(st.base, actIdx);
                  const heatStyle = getHeatColor(heatVal);

                  return (
                    <td key={act.key} className="p-1.5 text-center">
                      <div className={`p-2 rounded-xl border text-xs font-mono transition-transform hover:scale-105 cursor-pointer ${heatStyle}`}>
                        <span>{heatVal}%</span>
                        <span className="text-[8px] block opacity-75 font-normal">
                          {heatVal > 75 ? 'UNRESTRICTED' : heatVal > 50 ? 'EXPOSED' : 'GOVERNED'}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KEY CALLOUT WARNING STRIP */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
        <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-[10.5px] text-rose-200 font-mono flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Copilot WOULD READ <strong>3,420 exposed PHI records</strong></span>
        </div>

        <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-[10.5px] text-amber-200 font-mono flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Copilot WOULD SUMMARIZE <strong>14 overshared CUI sites</strong></span>
        </div>

        <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/40 text-[10.5px] text-purple-200 font-mono flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-purple-400 shrink-0" />
          <span>Copilot WOULD ACT with <strong>12 permanent admin roles</strong></span>
        </div>
      </div>

    </div>
  );
};
