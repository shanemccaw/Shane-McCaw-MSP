import React, { useState } from 'react';
import { AppRegistration } from '../types';

interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  apps: AppRegistration[];
  onUpdateStatus: (appId: string, status: 'Approved' | 'Revoked') => void;
}

export const AppModal: React.FC<AppModalProps> = ({ isOpen, onClose, apps, onUpdateStatus }) => {
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filteredApps = apps.filter(app => {
    if (filter === 'high' && app.riskLevel !== 'HIGH') return false;
    if (filter === 'medium' && app.riskLevel !== 'MEDIUM') return false;
    if (filter === 'low' && app.riskLevel !== 'LOW') return false;
    if (search && !app.name.toLowerCase().includes(search.toLowerCase()) && !app.appId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-[#1e2023] border border-[#3f4751]/60 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl glass-panel overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-[#3f4751]/20 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#99cbff]">apps</span>
              <h2 className="text-xl font-bold text-[#e2e2e6]">All 24 App Registrations & Enterprise Consents</h2>
            </div>
            <p className="text-xs text-[#bfc7d3] mt-0.5">Audit OAuth 2.0 Graph API permissions and third-party risk profiles</p>
          </div>
          <button 
            onClick={onClose} 
            className="w-8 h-8 rounded-lg bg-[#333538] hover:bg-[#3f4751] text-[#bfc7d3] hover:text-white flex items-center justify-center transition-colors"
          >
            ×
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 bg-[#111317] border-b border-[#3f4751]/20 flex flex-col sm:flex-row justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded text-xs font-mono ${filter === 'all' ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold' : 'text-[#bfc7d3]'}`}
            >
              ALL APPS
            </button>
            <button
              onClick={() => setFilter('high')}
              className={`px-3 py-1 rounded text-xs font-mono ${filter === 'high' ? 'bg-[#93000a]/30 text-[#ffb4ab] font-bold' : 'text-[#bfc7d3]'}`}
            >
              HIGH RISK
            </button>
            <button
              onClick={() => setFilter('medium')}
              className={`px-3 py-1 rounded text-xs font-mono ${filter === 'medium' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-[#bfc7d3]'}`}
            >
              MEDIUM RISK
            </button>
            <button
              onClick={() => setFilter('low')}
              className={`px-3 py-1 rounded text-xs font-mono ${filter === 'low' ? 'bg-[#00daf8]/20 text-[#00daf8] font-bold' : 'text-[#bfc7d3]'}`}
            >
              LOW RISK
            </button>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search app name or ID..."
            className="bg-[#1e2023] border border-[#3f4751]/40 rounded px-3 py-1 text-xs text-[#e2e2e6] placeholder:text-[#bfc7d3]/50 focus:outline-none"
          />
        </div>

        {/* App list */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {filteredApps.map(app => (
            <div key={app.id} className="p-4 bg-[#111317] rounded-xl border border-[#3f4751]/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#333538] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-xl text-[#bfc7d3]">{app.iconName}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#e2e2e6]">{app.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                      app.riskLevel === 'HIGH' ? 'bg-[#93000a]/30 text-[#ffb4ab]' : 'bg-[#00daf8]/10 text-[#00daf8]'
                    }`}>
                      RISK {app.riskScore}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-[#bfc7d3]/70">App ID: {app.appId}</div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {app.permissions.map((p, i) => (
                      <span key={i} className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                        p.isHighRisk ? 'bg-[#93000a]/30 text-[#ffb4ab]' : 'bg-[#333538] text-[#bfc7d3]'
                      }`}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  onClick={() => onUpdateStatus(app.appId, 'Approved')}
                  className={`px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors ${
                    app.status === 'Approved' ? 'bg-[#99cbff]/20 text-[#99cbff] border border-[#99cbff]/40' : 'bg-[#333538] text-[#bfc7d3] hover:text-white'
                  }`}
                >
                  Approve
                </button>
                <button
                  onClick={() => onUpdateStatus(app.appId, 'Revoked')}
                  className={`px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors ${
                    app.status === 'Revoked' ? 'bg-[#93000a]/40 text-[#ffb4ab] border border-[#ffb4ab]/40' : 'bg-[#333538] text-[#bfc7d3] hover:text-[#ffb4ab]'
                  }`}
                >
                  Revoke Consent
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#111317] border-t border-[#3f4751]/20 flex justify-between items-center text-xs font-mono text-[#bfc7d3]">
          <span>Showing {filteredApps.length} Apps</span>
          <button onClick={onClose} className="px-4 py-1.5 bg-[#333538] hover:bg-[#3f4751] text-white rounded-lg">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
