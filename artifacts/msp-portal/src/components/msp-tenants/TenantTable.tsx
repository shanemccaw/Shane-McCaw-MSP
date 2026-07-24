import React from 'react';
import { Tenant } from '../types';

interface TenantTableProps {
  tenants: Tenant[];
  onOpenTriage: (tenant: Tenant) => void;
  onOpenTerminal: (tenant: Tenant) => void;
  onSelectTenantDetail: (tenant: Tenant) => void;
  onOrchestrateSync: (tenantId: string) => void;
}

export const TenantTable: React.FC<TenantTableProps> = ({
  tenants,
  onOpenTriage,
  onOpenTerminal,
  onSelectTenantDetail,
  onOrchestrateSync,
}) => {
  return (
    <div className="glass-dark rounded-xl overflow-hidden border border-white/5">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-[#1e2023]/50 border-b border-white/5">
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold">
                Tenant Identity
              </th>
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold">
                Momentum (Secure/Comp)
              </th>
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold">
                M365 Vitals
              </th>
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold">
                Access (GDAP)
              </th>
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold">
                Automation
              </th>
              <th className="px-6 py-4 font-mono text-[10px] text-[#bfc7d3]/50 uppercase tracking-[0.2em] font-bold text-right">
                State
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-[#bfc7d3]/50 font-mono text-xs">
                  No tenants matching filter criteria.
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => {
                const isCritical = tenant.status === 'critical';
                const isExpired = tenant.gdap.isExpired;
                const isSyncing = tenant.automation.isSyncing;

                return (
                  <tr
                    key={tenant.id}
                    className="hover:bg-white/[0.03] transition-all group cursor-pointer"
                    onClick={() => onSelectTenantDetail(tenant)}
                  >
                    {/* Tenant Identity */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${
                            isCritical
                              ? 'bg-[#ffb4ab]/20 border-[#ffb4ab]/30 text-[#ffb4ab]'
                              : tenant.status === 'healthy'
                              ? 'bg-[#99cbff]/20 border-[#99cbff]/30 text-[#99cbff]'
                              : isExpired
                              ? 'bg-[#d2bbff]/20 border-[#d2bbff]/30 text-[#d2bbff]'
                              : 'bg-[#333538] border-white/10 text-[#bfc7d3]'
                          }`}
                        >
                          {tenant.shortLetter}
                        </div>
                        <div>
                          <div className="font-semibold text-[#e2e2e6] text-sm flex items-center gap-2">
                            <span>{tenant.name}</span>
                            {isCritical && (
                              <span className="w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse"></span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#bfc7d3]/40 font-mono">
                            ID: {tenant.id}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Momentum */}
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        {/* Secure Score */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono w-12 opacity-50 font-bold">
                            SECURE
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold ${
                                tenant.secureScore < 50
                                  ? 'text-[#ffb4ab]'
                                  : tenant.secureScore > 85
                                  ? 'text-[#a5eeff]'
                                  : 'text-[#99cbff]'
                              }`}
                            >
                              {tenant.secureScore}%
                            </span>
                            <div
                              className={`sparkline ${
                                tenant.secureScore < 50
                                  ? 'text-[#ffb4ab]'
                                  : 'text-[#a5eeff]'
                              }`}
                            >
                              {tenant.secureSparkline.map((val, idx) => (
                                <div
                                  key={idx}
                                  className="sparkline-bar"
                                  style={{ height: `${val * 1.2 + 2}px` }}
                                ></div>
                              ))}
                            </div>
                            <span
                              className={`text-[9px] font-mono ${
                                tenant.securePtsDelta < 0
                                  ? 'text-[#ffb4ab]'
                                  : tenant.securePtsDelta > 0
                                  ? 'text-[#a5eeff]'
                                  : 'text-[#bfc7d3]/40'
                              }`}
                            >
                              {tenant.securePtsDelta > 0 ? `+${tenant.securePtsDelta}` : tenant.securePtsDelta} pts
                            </span>
                          </div>
                        </div>

                        {/* Compliance Score */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono w-12 opacity-50 font-bold">
                            COMPL
                          </span>
                          <div className="flex items-center gap-2 text-[#bfc7d3]">
                            <span
                              className={`text-xs font-bold ${
                                tenant.complianceScore > 85 ? 'text-[#99cbff]' : 'text-[#bfc7d3]'
                              }`}
                            >
                              {tenant.complianceScore}%
                            </span>
                            <div className="sparkline text-[#99cbff]">
                              {tenant.complianceSparkline.map((val, idx) => (
                                <div
                                  key={idx}
                                  className="sparkline-bar"
                                  style={{ height: `${val * 1.1 + 2}px` }}
                                ></div>
                              ))}
                            </div>
                            <span className="text-[9px] font-mono text-[#bfc7d3]/60">
                              {tenant.compliancePtsDelta > 0 ? `+${tenant.compliancePtsDelta}` : tenant.compliancePtsDelta || '--'} pts
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* M365 Vitals */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div
                            className={`text-xs font-bold ${
                              tenant.baselineAlignment < 60
                                ? 'text-[#ffb4ab]'
                                : tenant.baselineAlignment > 90
                                ? 'text-[#a5eeff]'
                                : 'text-[#99cbff]'
                            }`}
                          >
                            {tenant.baselineAlignment}%
                          </div>
                          <div className="text-[8px] font-mono opacity-40 uppercase font-bold">
                            Baseline
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <div
                            className={`w-5 h-5 rounded-sm flex items-center justify-center border ${
                              tenant.incidentsCount > 0
                                ? 'bg-[#ffb4ab]/20 border-[#ffb4ab]/30'
                                : 'bg-[#a5eeff]/20 border-[#a5eeff]/30'
                            }`}
                            title={tenant.incidentsCount > 0 ? `${tenant.incidentsCount} Incidents` : 'Healthy'}
                          >
                            <span
                              className={`material-symbols-outlined text-[10px] ${
                                tenant.incidentsCount > 0 ? 'text-[#ffb4ab]' : 'text-[#a5eeff]'
                              }`}
                            >
                              {tenant.incidentsCount > 0 ? 'warning' : 'check_circle'}
                            </span>
                          </div>

                          <div
                            className={`w-5 h-5 rounded-sm flex items-center justify-center border ${
                              tenant.hasLockReset
                                ? 'bg-[#a5eeff]/20 border-[#a5eeff]/30'
                                : 'bg-white/5 border-white/10 opacity-40'
                            }`}
                            title="Encrypted / MFA"
                          >
                            <span
                              className={`material-symbols-outlined text-[10px] ${
                                tenant.hasLockReset ? 'text-[#a5eeff]' : ''
                              }`}
                            >
                              lock
                            </span>
                          </div>

                          <div
                            className={`w-5 h-5 rounded-sm flex items-center justify-center border ${
                              tenant.hasSyncIssue
                                ? 'bg-[#99cbff]/20 border-[#99cbff]/30'
                                : 'bg-white/5 border-white/10 opacity-40'
                            }`}
                            title="Cloud Sync Active"
                          >
                            <span
                              className={`material-symbols-outlined text-[10px] ${
                                tenant.hasSyncIssue ? 'text-[#99cbff]' : ''
                              }`}
                            >
                              cloud_sync
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Access (GDAP) */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`material-symbols-outlined text-[12px] ${
                              isCritical || isExpired ? 'text-[#ffb4ab]' : 'text-[#99cbff]'
                            }`}
                          >
                            {isExpired ? 'no_accounts' : 'timer'}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold uppercase ${
                              isCritical || isExpired
                                ? 'text-[#ffb4ab]'
                                : 'text-[#bfc7d3]/80'
                            }`}
                          >
                            {tenant.gdap.text}
                          </span>
                        </div>
                        <div className="h-1 w-20 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              isCritical || isExpired ? 'bg-[#ffb4ab]' : 'bg-[#a5eeff]'
                            }`}
                            style={{ width: `${tenant.gdap.percent}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>

                    {/* Automation */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {tenant.automation.isFailed ? (
                          <>
                            <span className="material-symbols-outlined text-sm text-[#ffb4ab]">
                              dangerous
                            </span>
                            <span className="text-[10px] font-mono text-[#ffb4ab] font-bold">
                              {tenant.automation.text}
                            </span>
                          </>
                        ) : isSyncing ? (
                          <div className="flex items-center gap-2 text-[#99cbff]">
                            <span className="material-symbols-outlined text-sm animate-spin-slow">
                              autorenew
                            </span>
                            <span className="text-[10px] font-mono">Syncing Policy...</span>
                          </div>
                        ) : tenant.automation.isIdle ? (
                          <div className="flex items-center gap-2 text-[#bfc7d3]/60">
                            <span className="material-symbols-outlined text-sm">schedule</span>
                            <span className="text-[10px] font-mono uppercase">Idle</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-[#bfc7d3]/70">
                            <span className="material-symbols-outlined text-sm text-[#a5eeff]">
                              task_alt
                            </span>
                            <span className="text-[10px] font-mono">
                              {tenant.automation.text}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* State / Actions */}
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {isCritical ? (
                        <button
                          onClick={() => onOpenTriage(tenant)}
                          className="bg-[#ffb4ab]/10 hover:bg-[#ffb4ab]/20 text-[#ffb4ab] text-[10px] font-mono uppercase px-3 py-1.5 rounded border border-[#ffb4ab]/30 transition-all font-bold shadow-sm"
                        >
                          Triage Now
                        </button>
                      ) : isSyncing ? (
                        <button
                          onClick={() => onOrchestrateSync(tenant.id)}
                          className="bg-[#99cbff]/10 hover:bg-[#99cbff]/20 text-[#99cbff] text-[10px] font-mono uppercase px-3 py-1.5 rounded border border-[#99cbff]/30 transition-all font-bold"
                        >
                          Orchestrate
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onOpenTerminal(tenant)}
                            className="p-1.5 rounded hover:bg-white/10 text-[#bfc7d3] hover:text-[#99cbff] transition-colors"
                            title="Open CLI Terminal"
                          >
                            <span className="material-symbols-outlined text-sm">terminal</span>
                          </button>
                          <button
                            onClick={() => onSelectTenantDetail(tenant)}
                            className="p-1.5 rounded hover:bg-white/10 text-[#bfc7d3] hover:text-[#99cbff] transition-colors"
                            title="View Full Dashboard"
                          >
                            <span className="material-symbols-outlined text-sm">
                              open_in_new
                            </span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
