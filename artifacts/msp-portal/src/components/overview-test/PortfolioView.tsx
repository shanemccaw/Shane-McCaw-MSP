import React from 'react';
import { Building2, ShieldCheck, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

interface PortfolioViewProps {
  onSelectTenant: (tenantName: string) => void;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({ onSelectTenant }) => {
  const tenants = [
    {
      name: 'Contoso Enterprise Global',
      domain: 'contoso.onmicrosoft.com',
      healthScore: 92,
      securityScore: 78,
      activeAlerts: 4,
      copilotUsers: 850,
      region: 'US East',
      status: 'Healthy',
    },
    {
      name: 'Fabrikam Health Sub',
      domain: 'fabrikam.onmicrosoft.com',
      healthScore: 84,
      securityScore: 81,
      activeAlerts: 2,
      copilotUsers: 340,
      region: 'EU West',
      status: 'Action Required',
    },
    {
      name: 'Northwind Traders M365',
      domain: 'northwind.onmicrosoft.com',
      healthScore: 95,
      securityScore: 91,
      activeAlerts: 0,
      copilotUsers: 1200,
      region: 'US West',
      status: 'Optimal',
    },
    {
      name: 'AdventureWorks Logistics',
      domain: 'adventureworks.onmicrosoft.com',
      healthScore: 71,
      securityScore: 65,
      activeAlerts: 7,
      copilotUsers: 180,
      region: 'APAC South',
      status: 'High Drift',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-8 animate-in fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Cross-Tenant Portfolio Overview</h2>
        <p className="text-xs text-slate-400 mt-1">
          Monitor multi-tenant posture, drift scores, and security findings across managed Microsoft 365 environments.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tenants.map((t) => (
          <div
            key={t.name}
            onClick={() => onSelectTenant(t.name)}
            className="glass-panel p-6 rounded-2xl flex flex-col justify-between gap-6 hover:border-[#479ef5]/50 transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#479ef5]/10 text-[#479ef5]">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white group-hover:text-[#479ef5] transition-colors">
                    {t.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">{t.domain}</p>
                </div>
              </div>

              <span
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono ${
                  t.status === 'Optimal'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : t.status === 'Healthy'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
              >
                {t.status}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 bg-[#101419] p-3 rounded-xl border border-white/5 text-center">
              <div>
                <div className="text-xl font-extrabold text-white font-mono">{t.healthScore}%</div>
                <div className="text-[10px] text-slate-400 uppercase">Health Score</div>
              </div>
              <div>
                <div className="text-xl font-extrabold text-[#479ef5] font-mono">{t.securityScore}%</div>
                <div className="text-[10px] text-slate-400 uppercase">Security Score</div>
              </div>
              <div>
                <div className="text-xl font-extrabold text-red-400 font-mono">{t.activeAlerts}</div>
                <div className="text-[10px] text-slate-400 uppercase">Alerts</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-white/5">
              <span>Region: {t.region} • Copilot: {t.copilotUsers} Users</span>
              <span className="text-[#479ef5] font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Inspect Tenant <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
