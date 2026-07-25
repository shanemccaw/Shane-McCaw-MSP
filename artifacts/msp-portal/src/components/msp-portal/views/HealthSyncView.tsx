// @ts-nocheck
import React from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Play, Zap } from 'lucide-react';
import { Tenant } from '../types';

interface HealthSyncViewProps {
  tenants: Tenant[];
  onRunSync: (tenant: Tenant) => void;
  onSyncAll: () => void;
}

export const HealthSyncView: React.FC<HealthSyncViewProps> = ({
  tenants,
  onRunSync,
  onSyncAll,
}) => {
  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea]">
      <div className="bg-[#1c2026] p-3 border border-[#404752] rounded-md flex justify-between items-center">
        <div>
          <h2 className="text-base font-bold text-[#e0e2ea] flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-[#0078d4]" />
            <span>Microsoft Graph Sync &amp; Identity Telemetry Health</span>
          </h2>
          <p className="text-xs text-[#8a919e]">
            Live status of Microsoft Entra Connect &amp; Cloud Sync pipelines across managed tenants.
          </p>
        </div>

        <button
          onClick={onSyncAll}
          className="bg-[#0078d4] text-white px-3.5 py-1.5 rounded text-xs font-semibold hover:bg-[#0060ab] flex items-center gap-1.5 shadow-md"
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Trigger Global Instant Sync</span>
        </button>
      </div>

      <div className="bg-[#101419] border border-[#404752] rounded-md overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-[#181c22] border-b border-[#404752] font-bold text-[#8a919e]">
            <tr>
              <th className="p-3">Tenant</th>
              <th className="p-3">Primary Domain</th>
              <th className="p-3">Sync Status</th>
              <th className="p-3">Last Sync Timestamp</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#404752]/40">
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-[#272a30]/50 transition-colors">
                <td className="p-3 font-semibold text-[#e0e2ea]">{t.name}</td>
                <td className="p-3 font-mono text-[#8a919e]">{t.primaryDomain}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      t.syncStatus === 'Healthy'
                        ? 'bg-[#052e16] text-[#4ade80] border border-[#166534]'
                        : t.syncStatus === 'Syncing'
                        ? 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]'
                        : 'bg-[#450a0a] text-[#ffb4ab] border border-[#991b1b]'
                    }`}
                  >
                    {t.syncStatus}
                  </span>
                </td>
                <td className="p-3 text-[#8a919e] font-mono">{t.lastSyncTimestamp}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => onRunSync(t)}
                    className="bg-[#272a30] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white border border-[#404752] px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1 ml-auto"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Instant Delta Sync</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

