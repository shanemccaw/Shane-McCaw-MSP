import React, { useState } from 'react';
import { Zap, Play, CheckCircle2, Shield, Lock, Key } from 'lucide-react';

interface AutomationViewProps {
  onRunWorkflow: (name: string) => void;
}

export const AutomationView: React.FC<AutomationViewProps> = ({ onRunWorkflow }) => {
  const [runningWorkflow, setRunningWorkflow] = useState<string | null>(null);

  const workflows = [
    {
      id: 'wf-1',
      title: 'M365 Security Baseline Compliance Sweep',
      description: 'Automatically scans all 142 tenants and enforces MFA, disables basic auth, and audits guest access.',
      icon: <Shield className="w-5 h-5 text-[#0078d4]" />,
      cadence: 'Daily at 02:00 UTC',
    },
    {
      id: 'wf-2',
      title: 'Revoke Dormant Guest Accounts (>90 Days)',
      description: 'Queries Microsoft Graph B2B guest sign-in logs and revokes access for inactive guest accounts.',
      icon: <Lock className="w-5 h-5 text-[#4ade80]" />,
      cadence: 'Weekly on Sundays',
    },
    {
      id: 'wf-3',
      title: 'Global Emergency Session Invalidation',
      description: 'Triggers instant OAuth token revocation across all admin accounts in response to zero-day identity threats.',
      icon: <Key className="w-5 h-5 text-[#ffb4ab]" />,
      cadence: 'Manual On-Demand Trigger',
    },
  ];

  const handleRun = (title: string) => {
    setRunningWorkflow(title);
    setTimeout(() => {
      onRunWorkflow(title);
      setRunningWorkflow(null);
    }, 1200);
  };

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea]">
      <div className="bg-[#1c2026] p-3 border border-[#404752] rounded-md flex justify-between items-center">
        <div>
          <h2 className="text-base font-bold text-[#e0e2ea] flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#0078d4]" />
            <span>MSP Webhook &amp; Graph API Automation Engine</span>
          </h2>
          <p className="text-xs text-[#8a919e]">
            Configured GDAP automation scripts and incident response playbooks.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="bg-[#101419] border border-[#404752] p-4 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-[#0078d4] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded bg-[#181c22] border border-[#404752] shrink-0">
                {wf.icon}
              </div>
              <div className="space-y-1">
                <div className="font-bold text-sm text-[#e0e2ea]">{wf.title}</div>
                <div className="text-xs text-[#8a919e]">{wf.description}</div>
                <div className="text-[10px] text-[#a3c9ff] font-mono">Cadence: {wf.cadence}</div>
              </div>
            </div>

            <button
              onClick={() => handleRun(wf.title)}
              disabled={runningWorkflow === wf.title}
              className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-4 py-2 rounded text-xs font-semibold transition-colors flex items-center gap-2 shrink-0 self-end sm:self-center disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{runningWorkflow === wf.title ? 'Executing Workflow...' : 'Trigger Workflow'}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
