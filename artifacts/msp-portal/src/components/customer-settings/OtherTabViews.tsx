import React from 'react';
import { LayoutDashboard, BarChart3, Building2, Users, ArrowUpRight, TrendingUp, DollarSign, Activity } from 'lucide-react';
import { MainTab } from '../types';

interface OtherTabViewsProps {
  activeTab: MainTab;
  onNavigateToSettings: () => void;
}

export const OtherTabViews: React.FC<OtherTabViewsProps> = ({
  activeTab,
  onNavigateToSettings,
}) => {
  if (activeTab === 'Dashboard') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="flex items-center justify-between pb-4 border-b border-[#282a2b]">
          <div>
            <h1 className="font-display font-semibold text-2xl text-[#f1f3f5]">Executive Dashboard</h1>
            <p className="text-xs text-[#8a919d] mt-1">
              Real-time portfolio occupancy, financial metrics, and operational health.
            </p>
          </div>
          <button
            onClick={onNavigateToSettings}
            className="text-xs font-medium text-[#a0c9ff] hover:underline"
          >
            ← System Settings
          </button>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8a919d] font-medium">Total Revenue</span>
              <DollarSign className="w-4 h-4 text-[#a0c9ff]" />
            </div>
            <p className="font-display font-bold text-2xl text-white mt-2">$1,248,500</p>
            <div className="flex items-center gap-1 text-[11px] text-emerald-400 mt-1">
              <TrendingUp className="w-3 h-3" />
              <span>+12.4% vs last quarter</span>
            </div>
          </div>

          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8a919d] font-medium">Occupancy Rate</span>
              <Building2 className="w-4 h-4 text-[#dab9ff]" />
            </div>
            <p className="font-display font-bold text-2xl text-white mt-2">96.8%</p>
            <span className="text-[11px] text-[#8a919d] mt-1 inline-block">142 of 147 units filled</span>
          </div>

          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8a919d] font-medium">Active Tenants</span>
              <Users className="w-4 h-4 text-[#a0c9ff]" />
            </div>
            <p className="font-display font-bold text-2xl text-white mt-2">312</p>
            <span className="text-[11px] text-emerald-400 mt-1 inline-block">+8 new this month</span>
          </div>

          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#8a919d] font-medium">System Health</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="font-display font-bold text-2xl text-white mt-2">99.98%</p>
            <span className="text-[11px] text-[#8a919d] mt-1 inline-block">All systems operational</span>
          </div>
        </div>

        {/* Overview Modules */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5">
            <h2 className="font-display font-semibold text-sm text-white mb-3">Portfolio Performance</h2>
            <div className="h-48 bg-[#141616] rounded-lg border border-[#282a2b] flex items-center justify-center text-xs text-[#8a919d]">
              Interactive Occupancy & Revenue Chart
            </div>
          </div>

          <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5">
            <h2 className="font-display font-semibold text-sm text-white mb-3">Recent Tenant Activities</h2>
            <div className="space-y-3">
              {[
                { name: 'Apex Logistics LLC', action: 'Lease Renewal Signed', time: '10m ago' },
                { name: 'Quantum Analytics', action: 'Maintenance Request #402', time: '1h ago' },
                { name: 'Vanguard Retail', action: 'Monthly Rent Processed', time: '3h ago' },
              ].map((act, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[#282a2b] text-xs">
                  <div>
                    <p className="font-medium text-white">{act.name}</p>
                    <p className="text-[11px] text-[#8a919d]">{act.action}</p>
                  </div>
                  <span className="font-mono text-[10px] text-[#8a919d]">{act.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'Analytics') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="pb-4 border-b border-[#282a2b]">
          <h1 className="font-display font-semibold text-2xl text-[#f1f3f5]">Analytics & Reporting</h1>
          <p className="text-xs text-[#8a919d] mt-1">Deep dive financial forecasting and tenant churn metrics.</p>
        </div>
        <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-8 text-center">
          <BarChart3 className="w-10 h-10 text-[#a0c9ff] mx-auto mb-3" />
          <h2 className="font-display font-semibold text-base text-white">Analytics Engine Ready</h2>
          <p className="text-xs text-[#8a919d] max-w-md mx-auto mt-1">
            Custom reporting modules and predictive modeling datasets are active.
          </p>
        </div>
      </div>
    );
  }

  if (activeTab === 'Properties') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="pb-4 border-b border-[#282a2b]">
          <h1 className="font-display font-semibold text-2xl text-[#f1f3f5]">Managed Properties</h1>
          <p className="text-xs text-[#8a919d] mt-1">12 Commercial and Residential Complexes under management.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {['Avery Commercial Center', 'Silicon Tower Phase II', 'Metropolis Plaza'].map((p, idx) => (
            <div key={idx} className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5">
              <Building2 className="w-6 h-6 text-[#a0c9ff] mb-2" />
              <h3 className="font-display font-semibold text-sm text-white">{p}</h3>
              <p className="text-xs text-[#8a919d] mt-1">36 Units • 100% Occupied</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'Tenants') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div className="pb-4 border-b border-[#282a2b]">
          <h1 className="font-display font-semibold text-2xl text-[#f1f3f5]">Tenant Directory</h1>
          <p className="text-xs text-[#8a919d] mt-1">Active corporate and individual leases.</p>
        </div>
        <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5">
          <div className="space-y-2">
            {['Nexus Corp', 'Starlight BioTech', 'Aether Media Group'].map((t, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[#141616] rounded-lg border border-[#282a2b] text-xs">
                <span className="font-medium text-white">{t}</span>
                <span className="font-mono text-[11px] text-[#a0c9ff]">Active Lease</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
