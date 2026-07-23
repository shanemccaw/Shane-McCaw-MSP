import React from 'react';
import {
  Building,
  TrendingDown,
  TrendingUp,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  ShoppingBag,
  Bell,
  Search,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { MOCK_DASHBOARD_METRICS } from '../data/products';

interface BackgroundDashboardProps {
  isModalOpen: boolean;
  onOpenMarketplace: () => void;
  activeSubscriptionsCount: number;
}

export const BackgroundDashboard: React.FC<BackgroundDashboardProps> = ({
  isModalOpen,
  onOpenMarketplace,
  activeSubscriptionsCount,
}) => {
  return (
    <div
      className={`fixed inset-0 z-0 transition-all duration-500 overflow-hidden ${
        isModalOpen
          ? 'scale-98 opacity-40 blur-md pointer-events-none grayscale-[30%]'
          : 'scale-100 opacity-100 blur-none pointer-events-auto'
      }`}
    >
      {/* Background Grid Accent */}
      <div className="absolute inset-0 bg-[#121414] bg-[radial-gradient(#282a2b_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

      {/* Main Dashboard Layout */}
      <div className="relative z-10 flex flex-col h-screen w-full text-[#e2e2e2]">
        {/* Top App Header */}
        <header className="bg-[#1e2020] border-b border-white/5 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#479ef5] flex items-center justify-center font-bold text-[#001c37]">
                TI
              </div>
              <span className="font-headline font-bold text-lg text-white">
                Tenant Intelligence OS
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono-code bg-[#333535] text-[#a0c9ff]">
              Enterprise Edition
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={onOpenMarketplace}
              className="px-4 py-2 rounded-lg bg-[#479ef5] text-[#001c37] font-semibold text-xs md:text-sm hover:bg-[#a0c9ff] transition-all flex items-center gap-2 shadow-[0_0_12px_rgba(71,158,245,0.3)] cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Boutique Marketplace</span>
              {activeSubscriptionsCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-[#001c37] text-[#a0c9ff] text-[11px] font-bold flex items-center justify-center">
                  {activeSubscriptionsCount}
                </span>
              )}
            </button>

            <div className="w-8 h-8 rounded-full bg-[#333535] border border-white/10 flex items-center justify-center text-xs font-bold text-[#a0c9ff]">
              JD
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* Top Banner when modal minimized */}
          {!isModalOpen && (
            <div className="bg-gradient-to-r from-[#282a2b] via-[#1e2020] to-[#2a0053]/40 p-4 rounded-xl border border-[#a0c9ff]/20 flex items-center justify-between shadow-lg animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#479ef5]/20 border border-[#479ef5]/40 flex items-center justify-center text-[#a0c9ff]">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-headline text-base font-bold text-[#e2e2e2]">
                    Boutique Marketplace Solutions Active
                  </h3>
                  <p className="text-xs text-[#c0c7d3]">
                    Explore neural predictive engines, global compliance shields, and auto-remediation workflows.
                  </p>
                </div>
              </div>

              <button
                onClick={onOpenMarketplace}
                className="px-4 py-2 bg-[#a0c9ff] text-[#003259] rounded-lg font-semibold text-xs hover:bg-white transition-all cursor-pointer"
              >
                Open Marketplace Modal
              </button>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MOCK_DASHBOARD_METRICS.map((metric) => (
              <div
                key={metric.id}
                className="bg-[#1e2020] p-4 rounded-xl border border-white/5 space-y-2 hover:border-white/10 transition-all"
              >
                <p className="font-mono-code text-[11px] uppercase text-[#8a919d]">
                  {metric.title}
                </p>
                <div className="flex items-baseline justify-between">
                  <span className="font-headline text-2xl font-bold text-[#e2e2e2]">
                    {metric.value}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      metric.isPositive
                        ? 'bg-[#10b981]/10 text-[#10b981]'
                        : 'bg-[#ffb4ab]/10 text-[#ffb4ab]'
                    }`}
                  >
                    {metric.change}
                  </span>
                </div>
                {/* Sparkline chart simulation */}
                <div className="h-8 flex items-end gap-1 pt-2">
                  {metric.chartData.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-[#479ef5]/40 hover:bg-[#a0c9ff] rounded-t transition-all"
                      style={{ height: `${(val / 100) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Property Portfolio Table Preview */}
          <div className="bg-[#1e2020] rounded-xl border border-white/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
                  Managed Property Portfolios
                </h3>
                <p className="text-xs text-[#8a919d]">
                  Real-time intelligence monitoring across 12 institutional towers
                </p>
              </div>

              <span className="text-xs font-mono-code text-[#a0c9ff] bg-[#a0c9ff]/10 px-2.5 py-1 rounded-full border border-[#a0c9ff]/20">
                12 Active Buildings
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-[#8a919d] font-mono-code uppercase">
                    <th className="py-2.5 px-3">Building Name</th>
                    <th className="py-2.5 px-3">Units</th>
                    <th className="py-2.5 px-3">Occupancy</th>
                    <th className="py-2.5 px-3">Delinquency Volatility</th>
                    <th className="py-2.5 px-3">Compliance Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-[#c0c7d3]">
                  <tr>
                    <td className="py-3 px-3 font-semibold text-[#e2e2e2] flex items-center gap-2">
                      <Building className="w-4 h-4 text-[#a0c9ff]" />
                      Skyline Plaza Tower A
                    </td>
                    <td className="py-3 px-3">450 Units</td>
                    <td className="py-3 px-3 font-semibold text-[#10b981]">98.2%</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] font-mono-code text-[10px]">
                        LOW (4%)
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono-code text-[#a0c9ff]">AUDITED (100%)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-semibold text-[#e2e2e2] flex items-center gap-2">
                      <Building className="w-4 h-4 text-[#dab9ff]" />
                      Metropolis Innovation Hub
                    </td>
                    <td className="py-3 px-3">280 Units</td>
                    <td className="py-3 px-3 font-semibold text-[#10b981]">95.4%</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-[#479ef5]/10 text-[#479ef5] font-mono-code text-[10px]">
                        MODERATE (11%)
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono-code text-[#a0c9ff]">AUDITED (99.4%)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-semibold text-[#e2e2e2] flex items-center gap-2">
                      <Building className="w-4 h-4 text-[#ffb4ab]" />
                      Vanguard Commercial Center
                    </td>
                    <td className="py-3 px-3">620 Units</td>
                    <td className="py-3 px-3 font-semibold text-[#ffb4ab]">89.1%</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-[#ffb4ab]/10 text-[#ffb4ab] font-mono-code text-[10px]">
                        HIGH RISK (28%)
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono-code text-[#ffb4ab]">ACTION REQ.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
