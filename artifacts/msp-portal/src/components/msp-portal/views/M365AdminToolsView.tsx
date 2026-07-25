import React, { useState } from 'react';
import {
  Grid,
  ExternalLink,
  ShieldCheck,
  Zap,
  Terminal,
  Key,
  Users,
  Copy,
  Check,
  RefreshCw,
  Search,
  Sliders,
  Server,
  Mail,
  Lock,
  Laptop,
  Layers,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Building2,
  FileCode,
  Globe,
  Activity,
  Play,
  Database,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react';
import { Tenant } from '../../types';
import { GlobalAdminCommandCenterView } from './GlobalAdminCommandCenterView';

interface M365AdminToolsViewProps {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  onSelectTenant: (tenant: Tenant | null) => void;
  onTriggerAction: (actionTitle: string, targetTenantName?: string) => void;
}

export const M365AdminToolsView: React.FC<M365AdminToolsViewProps> = ({
  tenants,
  selectedTenant,
  onSelectTenant,
  onTriggerAction,
}) => {
  const [searchPortalQuery, setSearchPortalQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'CORE' | 'SECURITY' | 'EXCHANGE' | 'ENDPOINT'>('ALL');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'COMMAND_CENTER' | 'PORTALS' | 'UTILITIES' | 'POWERSHELL' | 'HEALTH'>('COMMAND_CENTER');
  const [selectedToolTenant, setSelectedToolTenant] = useState<Tenant | null>(selectedTenant || tenants[0]);

  // Handle copy helper
  const handleCopyCode = (codeText: string, codeId: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeId(codeId);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  // Official Microsoft 365 Admin Portals List with Delegated Admin (GDAP) deep link templates
  const adminPortals = [
    {
      id: 'p-1',
      name: 'Microsoft 365 Admin Center',
      category: 'CORE',
      code: 'MAC',
      description: 'Primary portal for user management, licenses, billing, domain setup, and organization settings.',
      baseUrl: 'https://admin.microsoft.com/Adminportal/Home',
      gdapParam: '?DelegatedOrg=',
      status: 'Operational',
      color: 'from-[#0078d4]/20 to-[#0078d4]/5',
      iconColor: 'text-[#0078d4]',
      badge: 'Core Portal',
    },
    {
      id: 'p-2',
      name: 'Entra ID (Azure AD) Portal',
      category: 'SECURITY',
      code: 'ENTRA',
      description: 'Identity governance, Conditional Access, App Registrations, PIM, and MFA settings.',
      baseUrl: 'https://entra.microsoft.com/',
      gdapParam: '#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/Overview?delegatedDomain=',
      status: 'Operational',
      color: 'from-[#00a4ef]/20 to-[#00a4ef]/5',
      iconColor: 'text-[#00a4ef]',
      badge: 'Identity & Access',
    },
    {
      id: 'p-3',
      name: 'Defender XDR Security Center',
      category: 'SECURITY',
      code: 'SEC',
      description: 'Unified security portal for incident response, threat analytics, endpoints, and identity alerts.',
      baseUrl: 'https://security.microsoft.com/',
      gdapParam: '?tid=',
      status: 'Operational',
      color: 'from-[#d83b01]/20 to-[#d83b01]/5',
      iconColor: 'text-[#d83b01]',
      badge: 'Threat Hunting',
    },
    {
      id: 'p-4',
      name: 'Purview Compliance Center',
      category: 'SECURITY',
      code: 'PURVIEW',
      description: 'Data loss prevention (DLP), eDiscovery, audit logging, retention policies, and information protection.',
      baseUrl: 'https://compliance.microsoft.com/',
      gdapParam: '?tid=',
      status: 'Operational',
      color: 'from-[#107c41]/20 to-[#107c41]/5',
      iconColor: 'text-[#107c41]',
      badge: 'Compliance & DLP',
    },
    {
      id: 'p-5',
      name: 'Exchange Admin Center (EAC)',
      category: 'EXCHANGE',
      code: 'EAC',
      description: 'Mailbox provisioning, transport rules, spam filters, shared mailboxes, and mail flow diagnostics.',
      baseUrl: 'https://admin.exchange.microsoft.com/',
      gdapParam: '?DelegatedOrg=',
      status: 'Operational',
      color: 'from-[#0078d4]/20 to-[#0078d4]/5',
      iconColor: 'text-[#0078d4]',
      badge: 'Mail Infrastructure',
    },
    {
      id: 'p-6',
      name: 'Intune Endpoint Manager',
      category: 'ENDPOINT',
      code: 'INTUNE',
      description: 'Device enrollment, BitLocker baselines, application deployment, compliance policies, and remote wipe.',
      baseUrl: 'https://endpoint.microsoft.com/',
      gdapParam: '?DelegatedOrg=',
      status: 'Operational',
      color: 'from-[#5c2d91]/20 to-[#5c2d91]/5',
      iconColor: 'text-[#5c2d91]',
      badge: 'Device Management',
    },
    {
      id: 'p-7',
      name: 'Microsoft Teams Admin Center',
      category: 'CORE',
      code: 'TEAMS',
      description: 'Manage Teams policies, direct routing, guest access controls, meeting policies, and app store controls.',
      baseUrl: 'https://admin.teams.microsoft.com/',
      gdapParam: '?DelegatedOrg=',
      status: 'Operational',
      color: 'from-[#6264a7]/20 to-[#6264a7]/5',
      iconColor: 'text-[#6264a7]',
      badge: 'Collaboration',
    },
    {
      id: 'p-8',
      name: 'SharePoint & OneDrive Admin Center',
      category: 'CORE',
      code: 'SPO',
      description: 'Storage limits, external sharing permissions, site collection management, and access control policies.',
      baseUrl: 'https://admin.sharepoint.com/',
      gdapParam: '?DelegatedOrg=',
      status: 'Operational',
      color: 'from-[#008272]/20 to-[#008272]/5',
      iconColor: 'text-[#008272]',
      badge: 'Storage & Files',
    },
    {
      id: 'p-9',
      name: 'Microsoft Partner Center & Lighthouse',
      category: 'CORE',
      code: 'LIGHTHOUSE',
      description: 'Multi-tenant management portal for MSPs to manage GDAP relations, subscriptions, and security baselines.',
      baseUrl: 'https://lighthouse.microsoft.com/',
      gdapParam: '',
      status: 'Operational',
      color: 'from-[#ffb900]/20 to-[#ffb900]/5',
      iconColor: 'text-[#ffb900]',
      badge: 'MSP Hub',
    },
  ];

  const filteredPortals = adminPortals.filter((p) => {
    const matchesCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchPortalQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchPortalQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchPortalQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Pre-built MSP PowerShell Scripts
  const powerShellScripts = [
    {
      id: 'ps-1',
      title: 'Enforce Modern Authentication across Exchange Online',
      description: 'Disables legacy POP3, IMAP4, and Basic Auth across all user mailboxes in the active tenant.',
      category: 'Exchange / Security',
      code: `Set-OrganizationConfig -OAuth2ClientProfileEnabled $true
Get-CasMailbox -ResultSize Unlimited | Set-CasMailbox -PopEnabled $false -ImapEnabled $false -MapiHttpEnabled $true`,
    },
    {
      id: 'ps-2',
      title: 'Generate GDAP Temporary Emergency Global Admin Session',
      description: 'Request short-lived 8-hour Global Admin GDAP token with PIM justification for technician.',
      category: 'GDAP / Identity',
      code: `Connect-MgGraph -Scopes "RoleManagement.ReadWrite.Directory"
$Justification = "MSP Emergency Incident Remediation - Ticket #9482"
Enable-MgPrivilegedRoleAssignment -RoleId "62e90394-69f5-4237-[#tenant_id]" -DurationHours 8 -Justification $Justification`,
    },
    {
      id: 'ps-[#3]',
      title: 'Offboard User & Convert Mailbox to Shared with Litigation Hold',
      description: 'Automates user deprovisioning: revokes tokens, converts mailbox, sets 50GB shared quota, applies hold.',
      category: 'User Management',
      code: `Revoke-MgUserSignInSession -UserId "user@${selectedToolTenant?.primaryDomain || 'domain.com'}"
Set-Mailbox -Identity "user@${selectedToolTenant?.primaryDomain || 'domain.com'}" -Type Shared -LitigationHoldEnabled $true
Set-MailboxAutoReplyConfiguration -Identity "user@${selectedToolTenant?.primaryDomain || 'domain.com'}" -AutoReplyState Enabled -InternalMessage "This user has separated from the organization."`,
    },
    {
      id: 'ps-4',
      title: 'Audit All External Mail Forwarding Rules in Exchange',
      description: 'Queries Exchange Online for inbox rules forwarding emails outside the tenant domain.',
      category: 'Audit & Compliance',
      code: `Get-Mailbox -ResultSize Unlimited | Get-InboxRule | Where-Object { $_.ForwardTo -ne $null -or $_.ForwardAsAttachmentTo -ne $null } | Select-Object MailboxOwnerId, Name, ForwardTo, ForwardAsAttachmentTo`,
    },
  ];

  // Utility tools list
  const mspUtilities = [
    {
      id: 'u-1',
      name: 'Bulk License Reallocator & Waste Optimizer',
      desc: 'Identify unassigned paid E3/E5 seats and reallocate them to pending users across tenants.',
      icon: <Database className="w-5 h-5 text-[#0078d4]" />,
      actionText: 'Launch License Allocator',
    },
    {
      id: 'u-2',
      name: 'Offboarding Automation Wizard',
      desc: 'Step-by-step checklist to safely convert mailbox, backup OneDrive, wipe mobile device, and revoke GDAP tokens.',
      icon: <Users className="w-5 h-5 text-[#4ade80]" />,
      actionText: 'Start Offboarding Wizard',
    },
    {
      id: 'u-3',
      name: 'Conditional Access Baseline Pusher',
      desc: 'Deploy MSP standard CA policy set (MFA, Block Legacy, Require Compliant Device) with 1-click.',
      icon: <Lock className="w-5 h-5 text-[#fb923c]" />,
      actionText: 'Push CA Baseline Set',
    },
    {
      id: 'u-4',
      name: 'Emergency GDAP Access Grant',
      desc: 'Instantly elevate technician access permissions via Microsoft Partner Center GDAP delegated role.',
      icon: <Key className="w-5 h-5 text-[#a3c9ff]" />,
      actionText: 'Generate GDAP Session Token',
    },
  ];

  // API Health status
  const graphServicesHealth = [
    { service: 'Microsoft Graph v1.0 API', latency: '28 ms', status: 'Healthy', uptime: '99.99%' },
    { service: 'Exchange Online Web Services (EWS)', latency: '42 ms', status: 'Healthy', uptime: '99.98%' },
    { service: 'Entra ID Authentication Service', latency: '19 ms', status: 'Healthy', uptime: '100.0%' },
    { service: 'Intune Endpoint Management API', latency: '35 ms', status: 'Healthy', uptime: '99.95%' },
    { service: 'Defender Threat Protection API', latency: '31 ms', status: 'Healthy', uptime: '99.99%' },
  ];

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea] bg-[#0b0e14]">
      {/* Top Header Banner */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-4 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center text-[#a3c9ff] shadow-inner">
              <Grid className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                <span>Microsoft 365 Admin Tools Suite</span>
                <span className="text-xs bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] px-2 py-0.5 rounded font-mono font-medium">
                  GDAP Technician Hub
                </span>
              </h1>
              <p className="text-xs text-[#8a919e] mt-0.5">
                Centralized launcher, PowerShell script generator, and admin utilities for M365 multi-tenant administration.
              </p>
            </div>
          </div>

          {/* Active Tenant Context Switcher */}
          <div className="flex items-center gap-2.5 bg-[#101419] border border-[#404752] px-3 py-1.5 rounded-md">
            <Building2 className="w-4 h-4 text-[#0078d4]" />
            <div className="text-xs">
              <span className="text-[#8a919e]">Target Tenant: </span>
              <select
                value={selectedToolTenant?.id || ''}
                onChange={(e) => {
                  const found = tenants.find((t) => t.id === e.target.value);
                  if (found) setSelectedToolTenant(found);
                }}
                className="bg-[#181c22] border border-[#404752] text-[#a3c9ff] font-semibold text-xs rounded px-2 py-0.5 focus:outline-none focus:border-[#0078d4]"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.primaryDomain})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-2 pt-2 border-t border-[#404752]/50 text-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('COMMAND_CENTER')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'COMMAND_CENTER'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea]'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-[#a3c9ff]" />
            <span>Admin Command Center (80+ Tools)</span>
          </button>

          <button
            onClick={() => setActiveTab('PORTALS')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'PORTALS'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Admin Portals Waffle ({filteredPortals.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('UTILITIES')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'UTILITIES'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#4ade80]" />
            <span>MSP PowerTools</span>
          </button>

          <button
            onClick={() => setActiveTab('POWERSHELL')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'POWERSHELL'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-[#a3c9ff]" />
            <span>PowerShell Script Toolbox</span>
          </button>

          <button
            onClick={() => setActiveTab('HEALTH')}
            className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'HEALTH'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#4ade80]" />
            <span>Graph &amp; M365 API Health</span>
          </button>
        </div>
      </div>

      {/* TAB 0: GLOBAL ADMIN COMMAND CENTER (80+ TOOLS) */}
      {activeTab === 'COMMAND_CENTER' && (
        <GlobalAdminCommandCenterView
          tenants={tenants}
          selectedTenant={selectedToolTenant || selectedTenant}
          onSelectTenant={(t) => {
            setSelectedToolTenant(t);
            onSelectTenant(t);
          }}
          onDispatchWorkflow={(actionId, payload) => {
            onTriggerAction(`Dispatched Workflow: ${actionId}`, selectedToolTenant?.name);
          }}
        />
      )}

      {/* TAB 1: ADMIN PORTALS WAFFLE LAUNCHER */}
      {activeTab === 'PORTALS' && (
        <div className="space-y-4">
          {/* Search & Category Filter Bar */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e] w-3.5 h-3.5" />
              <input
                type="text"
                value={searchPortalQuery}
                onChange={(e) => setSearchPortalQuery(e.target.value)}
                placeholder="Filter M365 Admin Center portals (e.g. Defender, Intune, Exchange)..."
                className="bg-[#181c22] border border-[#404752] rounded pl-8 pr-3 py-1.5 text-xs text-[#e0e2ea] placeholder-[#8a919e] w-full focus:outline-none focus:border-[#0078d4]"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              {(['ALL', 'CORE', 'SECURITY', 'EXCHANGE', 'ENDPOINT'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                    selectedCategory === cat
                      ? 'bg-[#0078d4] text-white'
                      : 'bg-[#181c22] text-[#8a919e] hover:text-[#e0e2ea] border border-[#404752]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Grid of Admin Portals */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredPortals.map((portal) => {
              const fullGdapUrl = selectedToolTenant
                ? `${portal.baseUrl}${portal.gdapParam}${selectedToolTenant.primaryDomain}`
                : portal.baseUrl;

              return (
                <div
                  key={portal.id}
                  className="bg-[#101419] border border-[#404752] hover:border-[#0078d4] p-4 rounded-lg flex flex-col justify-between space-y-3 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] px-2 py-0.5 rounded font-mono">
                        {portal.code}
                      </span>
                      <span className="text-[10px] text-[#4ade80] font-mono flex items-center gap-1 bg-[#052e16] px-1.5 py-0.5 rounded border border-[#166534]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse"></span>
                        {portal.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-[#e0e2ea] group-hover:text-[#a3c9ff] transition-colors flex items-center gap-1.5">
                        <span>{portal.name}</span>
                      </h3>
                      <p className="text-xs text-[#8a919e] mt-1 line-clamp-2">{portal.description}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#404752]/50 space-y-2">
                    <div className="text-[10px] text-[#8a919e] font-mono truncate">
                      GDAP Context:{' '}
                      <span className="text-[#c0c7d4]">
                        {selectedToolTenant ? selectedToolTenant.primaryDomain : 'Global'}
                      </span>
                    </div>

                    <a
                      href={fullGdapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        // Also trigger action toast in app
                        onTriggerAction(`Launched ${portal.name} via GDAP`, selectedToolTenant?.name);
                      }}
                      className="w-full bg-[#0078d4] hover:bg-[#0060ab] text-white py-1.5 px-3 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Launch with GDAP Token</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: MSP POWERTOOLS */}
      {activeTab === 'UTILITIES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mspUtilities.map((util) => (
            <div
              key={util.id}
              className="bg-[#101419] border border-[#404752] p-4 rounded-lg flex flex-col justify-between space-y-3 hover:border-[#0078d4] transition-colors shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded bg-[#181c22] border border-[#404752]/60 shrink-0">{util.icon}</div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-[#e0e2ea]">{util.name}</h3>
                  <p className="text-xs text-[#8a919e]">{util.desc}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-[#404752]/50 flex items-center justify-between">
                <span className="text-[11px] text-[#8a919e] font-mono">
                  Target: <strong className="text-[#a3c9ff]">{selectedToolTenant?.name}</strong>
                </span>
                <button
                  onClick={() => onTriggerAction(`Executed Utility: ${util.name}`, selectedToolTenant?.name)}
                  className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Play className="w-3 h-3" />
                  <span>{util.actionText}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: POWERSHELL SCRIPT TOOLBOX */}
      {activeTab === 'POWERSHELL' && (
        <div className="space-y-4">
          <div className="bg-[#101419] border border-[#404752] p-3 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Terminal className="w-4 h-4 text-[#a3c9ff]" />
              <span className="font-bold text-[#e0e2ea]">Interactive Exchange &amp; Graph PowerShell Generator</span>
            </div>
            <span className="text-[10px] text-[#4ade80] font-mono bg-[#052e16] px-2 py-0.5 rounded border border-[#166534]">
              Graph SDK v2.0 Ready
            </span>
          </div>

          <div className="space-y-3.5">
            {powerShellScripts.map((script) => (
              <div
                key={script.id}
                className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-[#e0e2ea]">{script.title}</h3>
                    <p className="text-[11px] text-[#8a919e]">{script.description}</p>
                  </div>
                  <span className="text-[10px] bg-[#181c22] border border-[#404752] px-2 py-0.5 rounded font-mono text-[#a3c9ff]">
                    {script.category}
                  </span>
                </div>

                <div className="bg-[#080a0e] border border-[#272a30] rounded p-3 font-mono text-xs text-[#a3c9ff] relative group overflow-x-auto">
                  <pre className="whitespace-pre-wrap leading-relaxed">{script.code}</pre>
                  <button
                    onClick={() => handleCopyCode(script.code, script.id)}
                    className="absolute top-2 right-2 bg-[#181c22] hover:bg-[#0078d4] text-[#e0e2ea] p-1.5 rounded border border-[#404752] transition-colors flex items-center gap-1 text-[10px]"
                    title="Copy PowerShell Script"
                  >
                    {copiedCodeId === script.id ? (
                      <>
                        <Check className="w-3 h-3 text-[#4ade80]" />
                        <span className="text-[#4ade80] font-bold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: API & SERVICE HEALTH */}
      {activeTab === 'HEALTH' && (
        <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#404752] pb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#4ade80]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#e0e2ea]">
                Microsoft 365 Cloud Endpoint Telemetry
              </h2>
            </div>
            <span className="text-[10px] text-[#8a919e] font-mono">Updated 10 seconds ago</span>
          </div>

          <div className="divide-y divide-[#404752]/40 text-xs font-mono">
            {graphServicesHealth.map((item, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
                  <span className="font-semibold text-[#e0e2ea] font-sans">{item.service}</span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span>
                    Latency: <strong className="text-[#a3c9ff]">{item.latency}</strong>
                  </span>
                  <span>
                    30-Day Uptime: <strong className="text-[#4ade80]">{item.uptime}</strong>
                  </span>
                  <span className="bg-[#052e16] text-[#4ade80] px-2 py-0.5 rounded font-bold border border-[#166534]">
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
