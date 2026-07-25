import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Terminal,
  CheckCircle2,
  RefreshCw,
  Lock,
  Play,
  Zap,
} from 'lucide-react';
import { ThreatFeedItem, Tenant } from '../types';

interface RemediationModalProps {
  item: ThreatFeedItem | null;
  tenant: Tenant | null;
  customActionTitle?: string;
  onClose: () => void;
  onConfirmRemediation: (details: string) => void;
}

export const RemediationModal: React.FC<RemediationModalProps> = ({
  item,
  tenant,
  customActionTitle,
  onClose,
  onConfirmRemediation,
}) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);

  const tenantName = item?.tenantName || tenant?.name || 'Selected Tenant';
  const actionTitle = customActionTitle || item?.title || 'Direct Graph API Remediation';

  const handleExecute = () => {
    setIsExecuting(true);
    setExecutionLogs([
      `[00:00.1] Establishing secure PowerShell Graph Session (Tenant: ${tenantName})...`,
      `[00:00.4] Authenticating with MSP Delegated Admin Privileges (GDAP)...`,
      `[00:00.8] Validating OAuth 2.0 Token Scopes: Policy.ReadWrite.ConditionalAccess, User.ReadWrite.All...`,
    ]);

    setTimeout(() => {
      setExecutionLogs((prev) => [
        ...prev,
        `[00:01.3] Querying Microsoft Graph API endpoint GET /v1.0/identity/conditionalAccess/policies...`,
        `[00:01.9] Executing remediation payload: Enforcing Security Compliance Baseline v4.2...`,
      ]);
    }, 700);

    setTimeout(() => {
      setExecutionLogs((prev) => [
        ...prev,
        `[00:02.5] Revoking user refresh tokens and forcing interactive MFA re-authentication...`,
        `[00:02.9] [SUCCESS] Microsoft Graph API HTTP 200 OK - Workflow completed cleanly.`,
      ]);
      setIsExecuting(false);
      setIsCompleted(true);
    }, 1500);
  };

  const handleFinish = () => {
    onConfirmRemediation(actionTitle);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1c2026] border border-[#404752] rounded-lg max-w-xl w-full shadow-2xl overflow-hidden flex flex-col text-[#e0e2ea]">
        {/* Modal Header */}
        <div className="bg-[#272a30] px-4 py-3 border-b border-[#404752] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 flex items-center justify-center text-[#a3c9ff]">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#e0e2ea]">Graph API Direct Remediation</h3>
              <p className="text-[11px] text-[#8a919e]">Tenant: {tenantName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded hover:bg-[#31353b]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 text-xs">
          {/* Details Box */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
            <div className="flex justify-between items-start">
              <div className="font-semibold text-sm text-[#a3c9ff]">{actionTitle}</div>
              {item?.severity && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#93000a] text-white">
                  {item.severity}
                </span>
              )}
            </div>

            <p className="text-[#c0c7d4]">
              {item?.description ||
                `Execute instant Microsoft Graph API workflow payload for ${tenantName} to enforce security baselines and revoke unauthorized sessions.`}
            </p>

            {item?.actionRequired && (
              <div className="bg-[#181c22] p-2 rounded border border-[#0078d4]/30 text-[11px] text-[#e0e2ea]">
                <span className="font-semibold text-[#0078d4]">Required Action: </span>
                {item.actionRequired}
              </div>
            )}
          </div>

          {/* Terminal Log Execution Box */}
          <div className="bg-[#0b0e14] border border-[#404752] rounded p-3 font-mono text-[11px] h-36 overflow-y-auto space-y-1">
            <div className="text-[#8a919e] flex items-center gap-1.5 border-b border-[#404752]/40 pb-1 mb-1">
              <Terminal className="w-3.5 h-3.5 text-[#0078d4]" />
              <span>Microsoft Graph Automation Engine Terminal</span>
            </div>

            {executionLogs.length === 0 ? (
              <div className="text-[#8a919e] italic pt-4 text-center">
                Click &quot;Execute Workflow&quot; below to trigger GDAP Graph API remediation script.
              </div>
            ) : (
              executionLogs.map((log, index) => (
                <div
                  key={index}
                  className={log.includes('[SUCCESS]') ? 'text-[#4ade80] font-semibold' : 'text-[#c0c7d4]'}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-[#272a30] px-4 py-3 border-t border-[#404752] flex justify-between items-center">
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="px-3 py-1.5 rounded border border-[#404752] text-xs font-medium hover:bg-[#31353b] text-[#e0e2ea] disabled:opacity-50"
          >
            Cancel
          </button>

          {!isCompleted ? (
            <button
              onClick={handleExecute}
              disabled={isExecuting}
              className="px-4 py-1.5 rounded bg-[#0078d4] text-white text-xs font-semibold hover:bg-[#0060ab] transition-colors flex items-center gap-2 disabled:opacity-50 shadow-md"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Executing Graph Payload...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute Workflow Now</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="px-4 py-1.5 rounded bg-[#166534] text-white text-xs font-semibold hover:bg-[#15803d] transition-colors flex items-center gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Close &amp; Mark Resolved</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
