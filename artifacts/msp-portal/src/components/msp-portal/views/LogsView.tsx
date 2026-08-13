// @ts-nocheck
import React from 'react';
import { FileText, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { AuditLogItem } from '../types';

interface LogsViewProps {
  logs: AuditLogItem[];
}

export const LogsView: React.FC<LogsViewProps> = ({ logs }) => {
  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea]">
      <div className="bg-[#1c2026] p-3 border border-[#404752] rounded-md flex justify-between items-center">
        <div>
          <h2 className="text-base font-bold text-[#e0e2ea] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#0078d4]" />
            <span>MSP Operations &amp; Graph API Audit Trail</span>
          </h2>
          <p className="text-xs text-[#8a919e]">
            Immutable telemetry log of remediation triggers, security policy changes, and OAuth requests.
          </p>
        </div>
      </div>

      <div className="bg-[#101419] border border-[#404752] rounded-md overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-[#181c22] border-b border-[#404752] font-bold text-[#8a919e]">
            <tr>
              <th className="p-3">Timestamp</th>
              <th className="p-3">Tenant Scope</th>
              <th className="p-3">Initiated By</th>
              <th className="p-3">Action Payload</th>
              <th className="p-3">Status</th>
              <th className="p-3">Telemetry Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#404752]/40 font-mono text-[11px]">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-[#272a30]/50 transition-colors">
                <td className="p-3 text-[#8a919e] whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </td>
                <td className="p-3 font-semibold text-[#a3c9ff] whitespace-nowrap">{log.tenantName}</td>
                <td className="p-3 text-[#e0e2ea]">{log.initiatedBy}</td>
                <td className="p-3 text-[#e0e2ea] font-sans font-semibold">{log.action}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      log.status === 'SUCCESS'
                        ? 'bg-[#052e16] text-[#4ade80] border border-[#166534]'
                        : 'bg-[#450a0a] text-[#ffb4ab] border border-[#991b1b]'
                    }`}
                  >
                    {log.status}
                  </span>
                </td>
                <td className="p-3 text-[#8a919e] max-w-md truncate font-sans">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

