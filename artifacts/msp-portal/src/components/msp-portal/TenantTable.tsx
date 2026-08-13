// @ts-nocheck
import React, { useState } from 'react';
import {
  MoreHorizontal,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Lock,
  Key,
  Shield,
  ExternalLink,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { Tenant, LicenseTier, SyncStatusType } from '../types';

interface TenantTableProps {
  tenants: Tenant[];
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  licenseFilter: string;
  setLicenseFilter: (tier: string) => void;
  tableSearchQuery: string;
  setTableSearchQuery: (query: string) => void;
  onEnforceMFA: (tenant: Tenant) => void;
  onRevokeSessions: (tenant: Tenant) => void;
  onResetPasswords: (tenant: Tenant) => void;
  onRunInstantSync: (tenant: Tenant) => void;
  onSelectTenantDetail: (tenant: Tenant) => void;
}

export const TenantTable: React.FC<TenantTableProps> = ({
  tenants,
  statusFilter,
  setStatusFilter,
  licenseFilter,
  setLicenseFilter,
  tableSearchQuery,
  setTableSearchQuery,
  onEnforceMFA,
  onRevokeSessions,
  onResetPasswords,
  onRunInstantSync,
  onSelectTenantDetail,
}) => {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Filter logic
  const filteredTenants = tenants.filter((tenant) => {
    // Status filter
    if (statusFilter === 'Critical' && tenant.activeAlertsCount === 0 && tenant.secureScore >= 50 && tenant.mfaPercentage >= 70) return false;
    if (statusFilter === 'Warning' && tenant.syncStatus !== 'Warning' && tenant.mfaPercentage >= 70) return false;
    if (statusFilter === 'Healthy' && (tenant.syncStatus !== 'Healthy' || tenant.activeAlertsCount > 0)) return false;

    // License filter
    if (licenseFilter !== 'All Tiers' && tenant.licenseUsage.tier !== licenseFilter) return false;

    // Search query
    if (tableSearchQuery.trim()) {
      const q = tableSearchQuery.toLowerCase();
      const matchName = tenant.name.toLowerCase().includes(q);
      const matchDomain = tenant.primaryDomain.toLowerCase().includes(q);
      const matchCode = tenant.code.toLowerCase().includes(q);
      if (!matchName && !matchDomain && !matchCode) return false;
    }

    return true;
  });

  return (
    <div className="bg-[#101419] border border-[#404752] rounded-md flex flex-col flex-1 overflow-hidden min-h-[340px] shadow-sm">
      {/* Table Header Section */}
      <div className="bg-[#272a30] border-b border-[#404752] p-3 flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#a3c9ff]" />
          <h2 className="text-sm font-semibold text-[#e0e2ea] tracking-tight">
            Tenant Health Summary
          </h2>
          <span className="bg-[#181c22] border border-[#404752] px-2 py-0.5 rounded text-[11px] font-mono text-[#a3c9ff]">
            {filteredTenants.length} / {tenants.length}
          </span>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Status Select */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0b0e14] border border-[#404752] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[#0078d4] text-[#e0e2ea]"
          >
            <option value="All">Status: All</option>
            <option value="Critical">Critical Alerts / Risk</option>
            <option value="Warning">Warning / Sync Issues</option>
            <option value="Healthy">Healthy Only</option>
          </select>

          {/* License Tier Select */}
          <select
            value={licenseFilter}
            onChange={(e) => setLicenseFilter(e.target.value)}
            className="bg-[#0b0e14] border border-[#404752] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[#0078d4] text-[#e0e2ea]"
          >
            <option value="All Tiers">License: All Tiers</option>
            <option value="Business Premium">Business Premium</option>
            <option value="E3">E3</option>
            <option value="E5">E5</option>
          </select>

          {/* Local Filter Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e] w-3.5 h-3.5" />
            <input
              type="text"
              value={tableSearchQuery}
              onChange={(e) => setTableSearchQuery(e.target.value)}
              placeholder="Filter tenants..."
              className="bg-[#0b0e14] border border-[#404752] rounded pl-8 pr-2.5 py-1 text-xs focus:outline-none focus:border-[#0078d4] text-[#e0e2ea] placeholder-[#8a919e] w-40 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* Scrollable Data Table */}
      <div className="overflow-x-auto overflow-y-auto flex-1 relative">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead className="sticky top-0 bg-[#181c22] z-10 border-b border-[#404752]">
            <tr className="text-[#8a919e] font-bold text-[11px] uppercase tracking-wider">
              <th className="p-3">Tenant Name</th>
              <th className="p-3">License Usage</th>
              <th className="p-3">MFA %</th>
              <th className="p-3">Secure Score</th>
              <th className="p-3">Sync Status</th>
              <th className="p-3 text-center">Alerts</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#404752]/50 text-xs text-[#e0e2ea]">
            {filteredTenants.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[#8a919e]">
                  No tenants matching filter criteria. Try adjusting your status or license filters.
                </td>
              </tr>
            ) : (
              filteredTenants.map((tenant) => {
                const licensePercent = Math.round(
                  (tenant.licenseUsage.assigned / tenant.licenseUsage.total) * 100
                );
                const isHighRisk =
                  tenant.mfaPercentage < 60 ||
                  tenant.secureScore < 50 ||
                  tenant.activeAlertsCount > 0;

                return (
                  <tr
                    key={tenant.id}
                    className={`hover:bg-[#272a30]/60 transition-colors ${
                      isHighRisk ? 'bg-[#93000a]/10' : ''
                    }`}
                  >
                    {/* Tenant Name */}
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded bg-[#272a30] border border-[#404752] flex items-center justify-center font-bold text-xs text-[#a3c9ff] shrink-0">
                          {tenant.code}
                        </div>
                        <div>
                          <button
                            onClick={() => onSelectTenantDetail(tenant)}
                            className="font-semibold text-[#e0e2ea] hover:text-[#0078d4] text-left flex items-center gap-1 group"
                          >
                            <span>{tenant.name}</span>
                            <ChevronRight className="w-3 h-3 text-[#8a919e] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                          <div className="text-[10px] text-[#8a919e] font-mono">
                            {tenant.primaryDomain}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* License Usage */}
                    <td className="p-3 min-w-[170px]">
                      <div className="w-full bg-[#31353b] rounded-full h-1.5 mb-1 max-w-[180px]">
                        <div
                          className={`h-1.5 rounded-full ${
                            licensePercent > 90 ? 'bg-[#ffb4ab]' : 'bg-[#0078d4]'
                          }`}
                          style={{ width: `${Math.min(licensePercent, 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-[#8a919e] font-medium flex justify-between max-w-[180px]">
                        <span>
                          {tenant.licenseUsage.assigned}/{tenant.licenseUsage.total}{' '}
                          <span className="font-semibold text-[#a3c9ff]">{tenant.licenseUsage.tier}</span>
                        </span>
                        <span>{licensePercent}%</span>
                      </div>
                    </td>

                    {/* MFA % */}
                    <td className="p-3">
                      <span
                        className={`font-semibold ${
                          tenant.mfaPercentage < 60
                            ? 'text-[#ffb4ab]'
                            : tenant.mfaPercentage < 85
                            ? 'text-[#fb923c]'
                            : 'text-[#e0e2ea]'
                        }`}
                      >
                        {tenant.mfaPercentage}%
                      </span>
                    </td>

                    {/* Secure Score */}
                    <td className="p-3">
                      <span
                        className={`font-semibold ${
                          tenant.secureScore < 50
                            ? 'text-[#ffb4ab]'
                            : tenant.secureScore < 70
                            ? 'text-[#fb923c]'
                            : 'text-[#e0e2ea]'
                        }`}
                      >
                        {tenant.secureScore}
                      </span>
                      <span className="text-[10px] text-[#8a919e] ml-1">
                        / {tenant.maxSecureScore}
                      </span>
                    </td>

                    {/* Sync Status */}
                    <td className="p-3">
                      {tenant.syncStatus === 'Healthy' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#052e16] border border-[#166534] text-[#4ade80]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                          <span>Healthy</span>
                          <TrendingUp className="w-3 h-3 ml-0.5" />
                        </span>
                      )}

                      {tenant.syncStatus === 'Warning' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#451a03] border border-[#9a3412] text-[#fb923c]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#fb923c]" />
                          <span>Warning</span>
                        </span>
                      )}

                      {tenant.syncStatus === 'Sync Failed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#450a0a] border border-[#991b1b] text-[#ffb4ab]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#ffb4ab]" />
                          <span>Sync Failed</span>
                        </span>
                      )}

                      {tenant.syncStatus === 'Syncing' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#0078d4]/20 border border-[#0078d4] text-[#a3c9ff]">
                          <RefreshCw className="w-3 h-3 animate-spin text-[#0078d4]" />
                          <span>Syncing...</span>
                        </span>
                      )}
                    </td>

                    {/* Alerts Count */}
                    <td className="p-3 text-center">
                      {tenant.activeAlertsCount > 0 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#93000a] text-white font-bold text-[11px]">
                          {tenant.activeAlertsCount}
                        </span>
                      ) : (
                        <span className="text-[#8a919e]">0</span>
                      )}
                    </td>

                    {/* Actions Dropdown */}
                    <td className="p-3 text-right relative">
                      <button
                        onClick={() =>
                          setOpenDropdownId(openDropdownId === tenant.id ? null : tenant.id)
                        }
                        className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded hover:bg-[#272a30] transition-colors"
                        title="Remediation Options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {/* Dropdown Menu */}
                      {openDropdownId === tenant.id && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setOpenDropdownId(null)}
                          />
                          <div className="absolute right-0 mt-1 w-52 bg-[#1c2026] border border-[#404752] rounded shadow-2xl py-1 z-30 text-left text-xs">
                            <div className="px-3 py-1.5 border-b border-[#404752] font-semibold text-[#8a919e] text-[10px] uppercase">
                              Remediation Triggers
                            </div>

                            <button
                              onClick={() => {
                                onEnforceMFA(tenant);
                                setOpenDropdownId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#272a30] text-[#e0e2ea] flex items-center gap-2"
                            >
                              <Lock className="w-3.5 h-3.5 text-[#a3c9ff]" />
                              <span>Enforce MFA Policy</span>
                            </button>

                            <button
                              onClick={() => {
                                onRevokeSessions(tenant);
                                setOpenDropdownId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#272a30] text-[#ffb4ab] flex items-center gap-2"
                            >
                              <Shield className="w-3.5 h-3.5 text-[#ffb4ab]" />
                              <span>Revoke User Sessions</span>
                            </button>

                            <button
                              onClick={() => {
                                onResetPasswords(tenant);
                                setOpenDropdownId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#272a30] text-[#fb923c] flex items-center gap-2"
                            >
                              <Key className="w-3.5 h-3.5 text-[#fb923c]" />
                              <span>Reset Admin Passwords</span>
                            </button>

                            <button
                              onClick={() => {
                                onRunInstantSync(tenant);
                                setOpenDropdownId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#272a30] text-[#4ade80] flex items-center gap-2 border-t border-[#404752]/50 mt-1"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-[#4ade80]" />
                              <span>Run Instant Graph Sync</span>
                            </button>

                            <button
                              onClick={() => {
                                onSelectTenantDetail(tenant);
                                setOpenDropdownId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[#272a30] text-[#a3c9ff] flex items-center gap-2 border-t border-[#404752]/50"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-[#a3c9ff]" />
                              <span>View Tenant Telemetry</span>
                            </button>
                          </div>
                        </>
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

