import React, { useState, useEffect } from 'react';
import { Tenant } from '../../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
  onOpenNewDeployment: () => void;
  onOpenOpsManual: () => void;
  onGenerateScript: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  tenants,
  onSelectTenant,
  onOpenNewDeployment,
  onOpenOpsManual,
  onGenerateScript,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Open handled by parent or state
        }
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(query.toLowerCase()) ||
      t.id.toLowerCase().includes(query.toLowerCase()) ||
      t.primaryDomain.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#111317] border border-white/10 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Input Header */}
        <div className="p-4 border-b border-white/10 flex items-center gap-3 bg-[#1a1c1f]">
          <span className="material-symbols-outlined text-[#99cbff] text-xl">psychology</span>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tenants, run admin actions, or ask Copilot..."
            className="flex-1 bg-transparent text-sm text-[#e2e2e6] placeholder-[#bfc7d3]/40 focus:outline-none font-sans"
          />
          <kbd className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-[#bfc7d3]">
            ESC
          </kbd>
        </div>

        {/* Quick Actions & Results */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-4">
          {/* Admin Commands */}
          <div>
            <span className="px-3 text-[10px] font-mono text-[#99cbff] uppercase tracking-wider font-bold">
              Quick Admin Actions
            </span>
            <div className="mt-1 space-y-1">
              <button
                onClick={() => {
                  onClose();
                  onOpenNewDeployment();
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-[#e2e2e6] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-[#99cbff]">add_box</span>
                  <span>Provision New Tenant Environment</span>
                </div>
                <span className="font-mono text-[10px] text-[#bfc7d3]/50">Action</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onGenerateScript();
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-[#e2e2e6] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-[#a5eeff]">terminal</span>
                  <span>Generate MFA Remediation PowerShell Script</span>
                </div>
                <span className="font-mono text-[10px] text-[#bfc7d3]/50">Copilot</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onOpenOpsManual();
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-[#e2e2e6] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-[#d2bbff]">menu_book</span>
                  <span>View M365 Baseline Compliance Handbook</span>
                </div>
                <span className="font-mono text-[10px] text-[#bfc7d3]/50">Docs</span>
              </button>
            </div>
          </div>

          {/* Tenants Match */}
          <div>
            <span className="px-3 text-[10px] font-mono text-[#bfc7d3]/50 uppercase tracking-wider font-bold">
              Managed Tenants ({filteredTenants.length})
            </span>
            <div className="mt-1 space-y-1">
              {filteredTenants.map((tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => {
                    onClose();
                    onSelectTenant(tenant);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-[#e2e2e6] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] ${
                        tenant.status === 'critical'
                          ? 'bg-[#ffb4ab]/20 text-[#ffb4ab]'
                          : 'bg-[#99cbff]/20 text-[#99cbff]'
                      }`}
                    >
                      {tenant.shortLetter}
                    </span>
                    <span className="font-semibold">{tenant.name}</span>
                    <span className="font-mono text-[10px] text-[#bfc7d3]/40">{tenant.id}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-[#a5eeff]">
                      {tenant.secureScore}% Secure
                    </span>
                    <span className="material-symbols-outlined text-xs text-[#bfc7d3]/50">
                      chevron_right
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/10 bg-[#1a1c1f] flex justify-between items-center text-[10px] font-mono text-[#bfc7d3]/40">
          <span>Use ↑↓ to navigate, ENTER to execute</span>
          <span>Obsidian Copilot Engine v5.0</span>
        </div>
      </div>
    </div>
  );
};
