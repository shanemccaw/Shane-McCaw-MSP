import React from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Globe, 
  Lock, 
  Users, 
  FileText, 
  Key, 
  AlertTriangle, 
  Database, 
  Layers,
  ChevronRight
} from 'lucide-react';
import { GovernanceState } from '../../types';

export interface ScorecardProps {
  governance: GovernanceState;
  selectedPillarId?: string;
  onSelectPillar?: (id: string) => void;
  // Simulation overrides
  tightenCA01?: boolean;
  fixUnlabeled?: boolean;
  resolveDLP?: boolean;
  removePermanentAdmins?: boolean;
  externalGuestsLevel?: number;
  federatedDomainsLevel?: number;
}

export const M365SecurityScorecard: React.FC<ScorecardProps> = ({
  governance,
  selectedPillarId,
  onSelectPillar,
  tightenCA01 = false,
  fixUnlabeled = false,
  resolveDLP = false,
  removePermanentAdmins = false,
  externalGuestsLevel = 70,
  federatedDomainsLevel = 88
}) => {
  const isCaEnforced = tightenCA01 || governance.ca01;
  const isLabelsFixed = fixUnlabeled || governance.sensitivityLabels;
  const isDlpActive = resolveDLP || governance.dlp !== 'off';
  const isPimActive = removePermanentAdmins || governance.pim;

  const guestsCount = Math.round((externalGuestsLevel / 100) * 1700);
  const domainsCount = Math.round((federatedDomainsLevel / 100) * 88);

  // 6 Sections matching Prompt F
  const sections = [
    {
      id: 'overexposure',
      title: '1. Overexposure & Oversharing',
      badge: isLabelsFixed ? 'High Exposure' : 'Critical Risk',
      badgeColor: isLabelsFixed ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-rose-950 text-rose-300 border-rose-800',
      icon: <Database className="w-3.5 h-3.5 text-rose-400" />,
      metrics: [
        { label: 'Unlabeled Files', value: isLabelsFixed ? '8%' : '62%', severity: isLabelsFixed ? 'Safe' : 'Critical' },
        { label: 'Overshared SharePoint Sites', value: isLabelsFixed ? '24 sites' : '142 sites', severity: isLabelsFixed ? 'Low' : 'High' },
        { label: 'Public Teams Channels', value: '210 channels', severity: 'Moderate' },
        { label: 'Anonymous Anyone Links', value: isLabelsFixed ? '4 active' : '64 active', severity: isLabelsFixed ? 'Safe' : 'Critical' }
      ]
    },
    {
      id: 'conditional_access',
      title: '2. Conditional Access & Zero Trust',
      badge: isCaEnforced ? 'Enforced' : 'Not Enforced',
      badgeColor: isCaEnforced ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800',
      icon: <Lock className="w-3.5 h-3.5 text-sky-400" />,
      metrics: [
        { label: 'CA01 Strict Policy Status', value: isCaEnforced ? 'Enforced' : 'Not Enforced ⚠️', severity: isCaEnforced ? 'Safe' : 'Critical' },
        { label: 'MFA Enforcement Rate', value: isCaEnforced ? '100% users' : '94% users', severity: 'Safe' },
        { label: 'Device Compliance Rate', value: isCaEnforced ? '96% compliant' : '78% compliant', severity: isCaEnforced ? 'Safe' : 'Moderate' }
      ]
    },
    {
      id: 'eeeu',
      title: '3. EEEU (External Exposure)',
      badge: externalGuestsLevel > 50 ? 'High Exposure' : 'Contained',
      badgeColor: externalGuestsLevel > 50 ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-emerald-950 text-emerald-300 border-emerald-800',
      icon: <Globe className="w-3.5 h-3.5 text-amber-400" />,
      metrics: [
        { label: 'External Guest Accounts', value: `${guestsCount.toLocaleString()} guests`, severity: externalGuestsLevel > 50 ? 'High' : 'Safe' },
        { label: 'Federated B2B Domains', value: `${domainsCount} domains`, severity: federatedDomainsLevel > 50 ? 'Moderate' : 'Safe' },
        { label: 'External Sharing Links', value: externalGuestsLevel > 50 ? '4,120 links' : '410 links', severity: externalGuestsLevel > 50 ? 'High' : 'Safe' }
      ]
    },
    {
      id: 'dlp',
      title: '4. DLP Enforcement & Coverage',
      badge: isDlpActive ? 'Active Coverage' : 'Unprotected',
      badgeColor: isDlpActive ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />,
      metrics: [
        { label: 'Active DLP Conflicts', value: isDlpActive ? '0 conflicts' : '18 conflicts ⚠️', severity: isDlpActive ? 'Safe' : 'Critical' },
        { label: 'Unprotected Sensitive Flows', value: isDlpActive ? '0 flows' : '42 flows', severity: isDlpActive ? 'Safe' : 'High' }
      ]
    },
    {
      id: 'labels',
      title: '5. Sensitivity Label Coverage',
      badge: isLabelsFixed ? 'Good (92%)' : 'Drift Detected',
      badgeColor: isLabelsFixed ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800',
      icon: <FileText className="w-3.5 h-3.5 text-emerald-400" />,
      metrics: [
        { label: 'Label Coverage Rate', value: isLabelsFixed ? '92%' : '38%', severity: isLabelsFixed ? 'Safe' : 'Critical' },
        { label: 'Classification Accuracy', value: isLabelsFixed ? '96% accurate' : '72% accurate', severity: isLabelsFixed ? 'Safe' : 'Moderate' },
        { label: 'Drifted Libraries', value: isLabelsFixed ? '0 libraries' : '24 libraries', severity: isLabelsFixed ? 'Safe' : 'High' }
      ]
    },
    {
      id: 'permissions',
      title: '6. Permissions & Admin Roles',
      badge: isPimActive ? 'JIT Active' : 'Permanent Admins',
      badgeColor: isPimActive ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800',
      icon: <Key className="w-3.5 h-3.5 text-rose-400" />,
      metrics: [
        { label: 'Permanent Admin Accounts', value: isPimActive ? '0 (JIT PIM)' : '12 permanent ⚠️', severity: isPimActive ? 'Safe' : 'Critical' },
        { label: 'Privileged Entra Roles', value: isPimActive ? '4 scoped' : '34 accounts', severity: isPimActive ? 'Safe' : 'High' },
        { label: 'Permission Sprawl Clusters', value: isPimActive ? '1 cluster' : '15 clusters', severity: isPimActive ? 'Safe' : 'High' }
      ]
    }
  ];

  return (
    <div className="bg-[#070B14] border border-white/10 rounded-2xl p-3.5 flex flex-col justify-between h-full select-none overflow-hidden space-y-3">
      
      {/* HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              M365 Security Scorecard
            </h4>
            <p className="text-[9.5px] text-slate-400">
              6 Core Pillars • Defender & Purview Telemetry
            </p>
          </div>
        </div>
        <span className="text-[9px] font-mono text-sky-300 bg-sky-950 px-2 py-0.5 rounded border border-sky-800 font-bold">
          M365 Native
        </span>
      </div>

      {/* PILLARS SCORECARD LIST */}
      <div className="space-y-2 flex-1 overflow-y-auto scrollbar-thin pr-1">
        {sections.map((section) => {
          const isSelected = selectedPillarId === section.id;

          return (
            <div
              key={section.id}
              onClick={() => onSelectPillar && onSelectPillar(section.id)}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer relative group ${
                isSelected
                  ? 'bg-sky-950/40 border-sky-500 ring-1 ring-sky-500/50 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                  : 'bg-black/50 border-white/10 hover:border-slate-700 hover:bg-slate-900/60'
              }`}
            >
              {/* Section Title Bar */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-1.5">
                  <div className="p-1 rounded bg-slate-900 border border-white/10">
                    {section.icon}
                  </div>
                  <span className="text-xs font-extrabold text-white group-hover:text-sky-300 transition-colors">
                    {section.title}
                  </span>
                </div>
                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded border ${section.badgeColor}`}>
                  {section.badge}
                </span>
              </div>

              {/* Section Metrics Breakdown Grid */}
              <div className="grid grid-cols-1 gap-1 text-[9.5px] font-mono border-t border-white/5 pt-1.5">
                {section.metrics.map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between py-0.5 px-1 rounded bg-slate-950/40">
                    <span className="text-slate-400">{m.label}:</span>
                    <span className={`font-bold ${
                      m.severity === 'Critical' ? 'text-rose-400' :
                      m.severity === 'High' ? 'text-amber-400' :
                      m.severity === 'Moderate' ? 'text-yellow-300' : 'text-emerald-400'
                    }`}>
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* FOOTER TIP */}
      <div className="p-2 rounded-xl bg-sky-950/30 border border-sky-800/40 text-[9.5px] font-mono text-sky-300 flex items-center justify-between shrink-0">
        <span>💡 Click a pillar to highlight corresponding axis in center radar</span>
      </div>

    </div>
  );
};
