import React, { useState } from 'react';
import { Tenant } from '../../types';

interface TerminalModalProps {
  tenant: Tenant | null;
  onClose: () => void;
}

export const TerminalModal: React.FC<TerminalModalProps> = ({ tenant, onClose }) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([
    'Connected to Obsidian M365 CLI v5.0.0-OBSIDIAN',
    `Active Tenant: ${tenant?.name || 'Global'} [ID: ${tenant?.id || 'T-GLOBAL'}]`,
    'Type "help" or "m365 tenant get" to run commands.',
    '-------------------------------------------------------'
  ]);

  if (!tenant) return null;

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const cmd = input.trim();
    const newHistory = [...history, `obsidian@m365:~ $ ${cmd}`];

    if (cmd.toLowerCase() === 'clear') {
      setHistory(['Terminal cleared.']);
      setInput('');
      return;
    } else if (cmd.toLowerCase() === 'help') {
      newHistory.push(
        'Available commands:',
        '  m365 tenant get       - Display tenant status & scores',
        '  m365 gdap extend      - Request GDAP relationship extension',
        '  m365 drift sync       - Force policy drift reconciliation',
        '  clear                 - Clear console window'
      );
    } else if (cmd.toLowerCase().includes('m365 tenant get')) {
      newHistory.push(
        `{`,
        `  "id": "${tenant.id}",`,
        `  "name": "${tenant.name}",`,
        `  "secureScore": ${tenant.secureScore},`,
        `  "complianceScore": ${tenant.complianceScore},`,
        `  "gdapDaysRemaining": ${tenant.gdap.daysLeft},`,
        `  "users": ${tenant.usersCount},`,
        `  "mfaEnforced": "${tenant.mfaEnforcedPercent}%"`,
        `}`
      );
    } else if (cmd.toLowerCase().includes('gdap extend')) {
      newHistory.push('Dispatching GDAP relationship extension request to Microsoft Partner Portal...');
      newHistory.push('[SUCCESS] Invitation link generated: https://admin.microsoft.com/partner/gdap/invite/' + tenant.id);
    } else if (cmd.toLowerCase().includes('drift sync')) {
      newHistory.push('Initiating Microsoft Graph baseline drift check...');
      newHistory.push('[OK] Conditional Access rules verified against global policy template.');
    } else {
      newHistory.push(`Command not recognized: "${cmd}". Type "help" for command list.`);
    }

    setHistory(newHistory);
    setInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#0c0e11] border border-white/20 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden font-mono">
        {/* Header */}
        <div className="p-3 border-b border-white/10 bg-[#1e2023] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-[#99cbff]">terminal</span>
            <span className="text-xs text-[#e2e2e6] font-bold">
              Obsidian CLI Console - {tenant.name} ({tenant.id})
            </span>
          </div>
          <button onClick={onClose} className="p-1 text-[#bfc7d3] hover:text-[#e2e2e6]">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Console output */}
        <div className="p-4 h-80 overflow-y-auto text-xs space-y-1 text-[#99cbff]/90 bg-[#0c0e11]">
          {history.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">
              {line}
            </div>
          ))}
        </div>

        {/* Console input */}
        <form onSubmit={handleCommand} className="p-3 border-t border-white/10 bg-[#1a1c1f] flex items-center gap-2">
          <span className="text-xs text-[#a5eeff]">obsidian@m365:~ $</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            placeholder="Type M365 CLI command..."
            className="flex-1 bg-transparent text-xs text-[#e2e2e6] focus:outline-none font-mono"
          />
          <button type="submit" className="text-xs text-[#99cbff] font-bold hover:underline">
            Run
          </button>
        </form>
      </div>
    </div>
  );
};
