// @ts-nocheck
import React from 'react';
import {
  X,
  ShieldCheck,
  Lock,
  Key,
  RefreshCw,
  Users,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { Tenant } from '../types';

interface TenantDetailDrawerProps {
  tenant: Tenant | null;
  onClose: () => void;
  onEnforceMFA: (tenant: Tenant) => void;
  onRevokeSessions: (tenant: Tenant) => void;
  onRunInstantSync: (tenant: Tenant) => void;
}

export const TenantDetailDrawer: React.FC<TenantDetailDrawerProps> = ({
  tenant,
  onClose,
  onEnforceMFA,
  onRevokeSessions,
  onRunInstantSync,
}) => {
  if (!tenant) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
      <div className="bg-[#1c2026] border-l border-[#404752] w-full max-w-2xl h-full flex flex-col shadow-2xl text-[#e0e2ea] overflow-hidden">
        {/* Drawer Header */}
        <div className="bg-[#272a30] p-4 border-b border-[#404752] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center font-bold text-sm text-[#a3c9ff]">
              {tenant.code}
            </div>
            <div>
              <h2 className="text-base font-bold text-[#e0e2ea]">{tenant.name}</h2>
              <div className="text-xs text-[#8a919e] font-mono flex items-center gap-2">
                <span>Domain: {tenant.primaryDomain}</span>
                <span>•</span>
                <span>Tenant ID: {tenant.tenantId}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919e] hover:text-[#e0e2ea] p-1.5 rounded hover:bg-[#31353b]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-[#101419] border border-[#404752] p-2.5 rounded text-center">
              <div className="text-[10px] text-[#8a919e] uppercase font-bold">Secure Score</div>
              <div className="text-lg font-bold text-[#a3c9ff]">
                {tenant.secureScore} <span className="text-xs text-[#8a919e]">/ {tenant.maxSecureScore}</span>
              </div>
            </div>

            <div className="bg-[#101419] border border-[#404752] p-2.5 rounded text-center">
              <div className="text-[10px] text-[#8a919e] uppercase font-bold">MFA Coverage</div>
              <div
                className={`text-lg font-bold ${
                  tenant.mfaPercentage < 70 ? 'text-[#ffb4ab]' : 'text-[#4ade80]'
                }`}
              >
                {tenant.mfaPercentage}%
              </div>
            </div>

            <div className="bg-[#101419] border border-[#404752] p-2.5 rounded text-center">
              <div className="text-[10px] text-[#8a919e] uppercase font-bold">Total Users</div>
              <div className="text-lg font-bold text-[#e0e2ea]">{tenant.userCount}</div>
            </div>

            <div className="bg-[#101419] border border-[#404752] p-2.5 rounded text-center">
              <div className="text-[10px] text-[#8a919e] uppercase font-bold">Global Admins</div>
              <div className="text-lg font-bold text-[#fb923c]">{tenant.adminCount}</div>
            </div>
          </div>

          {/* Quick Action Bar */}
          <div className="bg-[#272a30] border border-[#404752] p-3 rounded-md flex flex-wrap gap-2 items-center justify-between">
            <span className="font-semibold text-[#a3c9ff] text-xs">Direct Graph Triggers:</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onEnforceMFA(tenant)}
                className="bg-[#0078d4] text-white px-2.5 py-1 rounded text-xs font-semibold hover:bg-[#0060ab] transition-colors flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Enforce MFA</span>
              </button>

              <button
                onClick={() => onRevokeSessions(tenant)}
                className="bg-[#93000a] text-[#ffdad6] border border-[#7f1d1d] px-2.5 py-1 rounded text-xs font-semibold hover:bg-[#93000a]/80 transition-colors flex items-center gap-1.5"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Revoke Refresh Tokens</span>
              </button>

              <button
                onClick={() => onRunInstantSync(tenant)}
                className="bg-[#181c22] border border-[#404752] text-[#4ade80] px-2.5 py-1 rounded text-xs font-semibold hover:bg-[#272a30] transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Run Delta Sync</span>
              </button>
            </div>
          </div>

          {/* Licenses & Subscriptions Section */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
            <div className="font-bold text-xs text-[#e0e2ea] flex justify-between">
              <span>M365 License Allocation</span>
              <span className="text-[#a3c9ff]">{tenant.licenseUsage.tier}</span>
            </div>
            <div className="w-full bg-[#31353b] rounded-full h-2">
              <div
                className="bg-[#0078d4] h-2 rounded-full"
                style={{
                  width: `${(tenant.licenseUsage.assigned / tenant.licenseUsage.total) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-[#8a919e]">
              <span>Assigned Seats: {tenant.licenseUsage.assigned}</span>
              <span>Total Purchased: {tenant.licenseUsage.total}</span>
            </div>
          </div>

          {/* Security & Identity Policies */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
            <div className="font-bold text-xs text-[#e0e2ea] border-b border-[#404752] pb-1.5">
              Identity &amp; Access Control Telemetry
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex items-center justify-between p-2 bg-[#181c22] rounded border border-[#404752]/40">
                <span>Conditional Access Policies:</span>
                <span className="font-bold text-[#a3c9ff]">{tenant.conditionalAccessPoliciesCount} Active</span>
              </div>

              <div className="flex items-center justify-between p-2 bg-[#181c22] rounded border border-[#404752]/40">
                <span>PIM Enabled:</span>
                <span className={`font-bold ${tenant.pimEnabled ? 'text-[#4ade80]' : 'text-[#ffb4ab]'}`}>
                  {tenant.pimEnabled ? 'Yes (Strict)' : 'No'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 bg-[#181c22] rounded border border-[#404752]/40">
                <span>Security Defaults:</span>
                <span className="font-bold text-[#e0e2ea]">
                  {tenant.securityDefaults ? 'Active' : 'Disabled (Custom CA)'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 bg-[#181c22] rounded border border-[#404752]/40">
                <span>Last Graph Sync:</span>
                <span className="font-bold text-[#8a919e]">{tenant.lastSyncTimestamp}</span>
              </div>
            </div>
          </div>

          {/* Global Admin Accounts */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
            <div className="font-bold text-xs text-[#e0e2ea] border-b border-[#404752] pb-1.5 flex justify-between items-center">
              <span>Privileged Global Administrator UPNs</span>
              <span className="text-[10px] text-[#fb923c] font-mono">{tenant.globalAdminUPNs.length} Accounts</span>
            </div>

            <div className="space-y-1">
              {tenant.globalAdminUPNs.map((upn) => (
                <div
                  key={upn}
                  className="bg-[#181c22] p-2 rounded border border-[#404752]/40 font-mono text-[11px] text-[#e0e2ea] flex justify-between items-center"
                >
                  <span>{upn}</span>
                  <span className="text-[10px] bg-[#3a4a5f] text-[#a3c9ff] px-1.5 py-0.2 rounded font-sans">
                    GDAP Bound
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="bg-[#272a30] p-3 border-t border-[#404752] flex justify-between items-center shrink-0">
          <span className="text-[11px] text-[#8a919e]">
            Graph Telemetry Stream • Connected via Azure Lighthouse
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold hover:bg-[#404752]"
          >
            Close Drawer
          </button>
        </div>
      </div>
    </div>
  );
};

