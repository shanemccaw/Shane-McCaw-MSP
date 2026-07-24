import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenantview/types';

interface ServiceHealthGridProps {
  tenant: Tenant;
  onSelectService?: (serviceName: string) => void;
}

export const ServiceHealthGrid: React.FC<ServiceHealthGridProps> = ({ tenant, onSelectService }) => {
  const { exchange, sharepoint, teams, entra } = tenant.services;
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  const handleCardClick = (name: string) => {
    setSelectedCard(name);
    if (onSelectService) onSelectService(name);
  };

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
      {/* 1. Exchange Online */}
      <div 
        onClick={() => handleCardClick('Exchange Online')}
        className="glass-panel rounded-xl p-5 hover:bg-[#37393d]/30 transition-all cursor-pointer accent-glow border border-[#3f4751]/20 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-[#99cbff]/10 rounded-lg border border-[#99cbff]/20">
              <span className="material-symbols-outlined text-[#99cbff]">mail</span>
            </div>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
              exchange.status === 'HEALTHY' 
                ? 'text-[#00daf8] bg-[#00daf8]/10 border border-[#00daf8]/20'
                : 'text-[#ffb4ab] bg-[#93000a]/20 border border-[#ffb4ab]/30'
            }`}>
              {exchange.status}
            </span>
          </div>
          
          <h4 className="text-[#e2e2e6] font-semibold text-base mb-1">Exchange Online</h4>
          
          <div className="space-y-3 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#bfc7d3]">Mailbox Usage</span>
              <span className="text-[#e2e2e6] font-mono font-bold">{exchange.usageTb} TB</span>
            </div>
            
            <div className="w-full bg-[#1e2023] rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-[#99cbff] h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${exchange.usagePercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 mt-4 border-t border-[#3f4751]/20 text-xs">
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Latency</span>
            <span className="text-[#e2e2e6] font-mono font-bold">{exchange.latencyMs}ms</span>
          </div>
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Flow</span>
            <span className="text-[#00daf8] font-mono font-bold">{exchange.flowStatus}</span>
          </div>
        </div>
      </div>

      {/* 2. SharePoint & OneDrive */}
      <div 
        onClick={() => handleCardClick('SharePoint & OneDrive')}
        className="glass-panel rounded-xl p-5 hover:bg-[#37393d]/30 transition-all cursor-pointer accent-glow border border-[#3f4751]/20 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-[#99cbff]/10 rounded-lg border border-[#99cbff]/20">
              <span className="material-symbols-outlined text-[#99cbff]">cloud</span>
            </div>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
              sharepoint.status === 'HEALTHY' 
                ? 'text-[#00daf8] bg-[#00daf8]/10'
                : 'text-[#ffb4ab] bg-[#93000a]/30 border border-[#ffb4ab]/40 animate-pulse'
            }`}>
              {sharepoint.status}
            </span>
          </div>
          
          <h4 className="text-[#e2e2e6] font-semibold text-base mb-1">SharePoint & OneDrive</h4>
          
          <div className="space-y-3 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#bfc7d3]">Storage Used</span>
              <span className="text-[#ffb4ab] font-mono font-bold">{sharepoint.storagePercent}%</span>
            </div>
            
            <div className="w-full bg-[#1e2023] rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-[#ffb4ab] h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${sharepoint.storagePercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 mt-4 border-t border-[#3f4751]/20 text-xs">
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Sites</span>
            <span className="text-[#e2e2e6] font-mono font-bold">{sharepoint.sitesCount.toLocaleString()}</span>
          </div>
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Ext. Sharing</span>
            <span className="text-[#99cbff] font-mono font-bold">{sharepoint.extSharing}</span>
          </div>
        </div>
      </div>

      {/* 3. Microsoft Teams */}
      <div 
        onClick={() => handleCardClick('Microsoft Teams')}
        className="glass-panel rounded-xl p-5 hover:bg-[#37393d]/30 transition-all cursor-pointer accent-glow border border-[#3f4751]/20 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-[#99cbff]/10 rounded-lg border border-[#99cbff]/20">
              <span className="material-symbols-outlined text-[#99cbff]">forum</span>
            </div>
            <span className="text-[10px] font-mono text-[#00daf8] px-2 py-0.5 bg-[#00daf8]/10 rounded border border-[#00daf8]/20 font-bold">
              {teams.status}
            </span>
          </div>
          
          <h4 className="text-[#e2e2e6] font-semibold text-base mb-1">Microsoft Teams</h4>
          
          <div className="space-y-3 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#bfc7d3]">Active Daily Users</span>
              <span className="text-[#e2e2e6] font-mono font-bold">{teams.dailyActiveUsers.toLocaleString()}</span>
            </div>
            
            {/* Sparkline / Bar chart visual */}
            <div className="h-6 flex items-end gap-1.5 pt-1">
              {teams.usageTrend.map((val, idx) => (
                <div 
                  key={idx} 
                  className={`flex-1 rounded-t-sm transition-all duration-300 ${
                    idx === 2 ? 'bg-[#99cbff]' : 'bg-[#99cbff]/30 hover:bg-[#99cbff]/60'
                  }`}
                  style={{ height: `${val}%` }}
                  title={`Day ${idx + 1}: ${val}% activity`}
                ></div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 mt-4 border-t border-[#3f4751]/20 text-xs">
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Call Quality</span>
            <span className="text-[#e2e2e6] font-mono font-bold">{teams.callQualityPercent}%</span>
          </div>
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Guests</span>
            <span className="text-[#e2e2e6] font-mono font-bold">{teams.activeGuests} Active</span>
          </div>
        </div>
      </div>

      {/* 4. Entra ID (Azure AD) */}
      <div 
        onClick={() => handleCardClick('Entra ID')}
        className="glass-panel rounded-xl p-5 hover:bg-[#37393d]/30 transition-all cursor-pointer accent-glow border border-[#3f4751]/20 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-[#99cbff]/10 rounded-lg border border-[#99cbff]/20">
              <span className="material-symbols-outlined text-[#99cbff]">fingerprint</span>
            </div>
            <span className="text-[10px] font-mono text-[#ffb4ab] px-2 py-0.5 bg-[#93000a]/20 border border-[#ffb4ab]/30 rounded font-bold">
              {entra.status}
            </span>
          </div>
          
          <h4 className="text-[#e2e2e6] font-semibold text-base mb-1">Entra ID (Azure AD)</h4>
          
          <div className="space-y-3 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#bfc7d3]">Sign-in Success</span>
              <span className="text-[#00daf8] font-mono font-bold">{entra.signInSuccessPercent}%</span>
            </div>
            
            <div className="w-full bg-[#1e2023] rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-[#00daf8] h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${entra.signInSuccessPercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 mt-4 border-t border-[#3f4751]/20 text-xs">
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">Identity Prot.</span>
            <span className="text-[#ffb4ab] font-mono font-bold">{entra.identityProt}</span>
          </div>
          <div>
            <span className="block text-[#bfc7d3] text-[9px] uppercase font-mono tracking-wider">AD Sync</span>
            <span className="text-[#e2e2e6] font-mono font-bold">{entra.adSyncStatus}</span>
          </div>
        </div>
      </div>
    </section>
  );
};
