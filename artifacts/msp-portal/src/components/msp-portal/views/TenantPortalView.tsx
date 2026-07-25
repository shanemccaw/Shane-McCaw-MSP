import React, { useState } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Download,
  AlertTriangle,
  Zap,
  CheckCircle2,
  TrendingUp,
  Users,
  HardDrive,
  Laptop,
  Lock,
  Key,
  Shield,
  FileText,
  DollarSign,
  Award,
  ChevronRight,
  Clock,
  Sparkles,
  ArrowUpRight,
  Sliders,
  RotateCw,
  Search,
  ChevronDown,
  Info,
  Building2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { Tenant, ThreatFeedItem, PendingRemediation, AuditLogItem } from '../../types';

interface TenantPortalViewProps {
  tenant: Tenant;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant | null) => void;
  onEnforceMFA: (tenant: Tenant) => void;
  onRevokeSessions: (tenant: Tenant) => void;
  onRunSync: (tenant: Tenant) => void;
  onTriggerRemediation: (title: string, tenantName: string) => void;
  onExportReport: (tenantName: string) => void;
  onExecutePendingFix: (item: PendingRemediation) => void;
}

export const TenantPortalView: React.FC<TenantPortalViewProps> = ({
  tenant,
  tenants,
  onSelectTenant,
  onEnforceMFA,
  onRevokeSessions,
  onRunSync,
  onTriggerRemediation,
  onExportReport,
  onExecutePendingFix,
}) => {
  const [activeRemediationTab, setActiveRemediationTab] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const [copiedTenantId, setCopiedTenantId] = useState(false);
  const [isTenantDropdownOpen, setIsTenantDropdownOpen] = useState(false);

  // Copy Tenant ID helper
  const handleCopyTenantId = () => {
    navigator.clipboard.writeText(tenant.tenantId);
    setCopiedTenantId(true);
    setTimeout(() => setCopiedTenantId(false), 2000);
  };

  // Mock critical alerts specifically curated for this tenant view
  const tenantAlerts = [
    {
      id: 'ta-1',
      severity: 'HIGH',
      title: 'Expiring Azure AD App Secret',
      target: 'MSP-Automation-App-01',
      details: 'Client secret expires in 3 days. Graph API reporting & sync will fail if unrenewed.',
      actionText: 'Rotate Secret Now',
      actionTitle: `Rotate Azure AD App Secret for ${tenant.name}`,
    },
    {
      id: 'ta-2',
      severity: 'CRITICAL',
      title: 'MFA Non-Compliance Spike',
      target: '12 Admin/User Accounts',
      details: '12 accounts excluded from Conditional Access Policy CA001 during recent drift.',
      actionText: 'Enforce CA001 MFA',
      actionTitle: `Re-enforce Conditional Access Policy CA001 for ${tenant.name}`,
    },
    {
      id: 'ta-3',
      severity: 'MED',
      title: 'Unassigned Paid License Waste',
      target: '75 Unassigned E5 Seats',
      details: '$1,650/mo in idle paid seats sitting unallocated for over 45 days.',
      actionText: 'Reclaim / Deprovision',
      actionTitle: `Reclaim 75 Unassigned E5 Seats for ${tenant.name}`,
    },
    {
      id: 'ta-4',
      severity: 'HIGH',
      title: 'Impossible Travel Alert',
      target: 'owner@' + tenant.primaryDomain,
      details: 'Concurrent sign-ins detected from Lagos, NG and Chicago, US within 10 minutes.',
      actionText: 'Revoke Sessions',
      actionTitle: `Revoke Active Refresh Tokens for owner@${tenant.primaryDomain}`,
    },
  ];

  // Tenant-specific pending remediations
  const tenantRemediations: PendingRemediation[] = [
    {
      id: 'tpr-1',
      tenantName: tenant.name,
      tenantId: tenant.id,
      title: 'Disable Legacy POP3/IMAP Authentication',
      category: 'Security',
      severity: 'HIGH',
      affectedTarget: 'Exchange Online POP3/IMAP4 Protocols',
      createdTime: '2 hours ago',
      suggestedAction: 'Enforce Modern Auth across Exchange Online tenant',
    },
    {
      id: 'tpr-2',
      tenantName: tenant.name,
      tenantId: tenant.id,
      title: 'Enable PIM Time-bound Role Activation',
      category: 'Identity',
      severity: 'HIGH',
      affectedTarget: '2 Permanent Global Admins',
      createdTime: '5 hours ago',
      suggestedAction: 'Convert permanent Global Admin roles to PIM activation',
    },
    {
      id: 'tpr-3',
      tenantName: tenant.name,
      tenantId: tenant.id,
      title: 'Enforce BitLocker Encryption Baseline',
      category: 'Policy Drift',
      severity: 'MED',
      affectedTarget: '12 Unencrypted Windows 11 Laptops',
      createdTime: '1 day ago',
      suggestedAction: 'Push Intune Endpoint Security BitLocker Profile',
    },
    {
      id: 'tpr-4',
      tenantName: tenant.name,
      tenantId: tenant.id,
      title: 'Review Dormant External Guests (>90 Days)',
      category: 'Identity',
      severity: 'LOW',
      affectedTarget: '18 Inactive Guest Accounts',
      createdTime: '2 days ago',
      suggestedAction: 'Trigger Microsoft Graph Access Review sweep',
    },
    {
      id: 'tpr-5',
      tenantName: tenant.name,
      tenantId: tenant.id,
      title: 'Enable Defender Safe Attachments & Links',
      category: 'Security',
      severity: 'MED',
      affectedTarget: 'All Exchange Mailboxes',
      createdTime: '3 days ago',
      suggestedAction: 'Deploy baseline Anti-Phishing & Attachment Protection',
    },
  ];

  const filteredRemediations = tenantRemediations.filter((r) => {
    if (activeRemediationTab === 'CRITICAL') return r.severity === 'HIGH';
    if (activeRemediationTab === 'WARNING') return r.severity === 'MED';
    if (activeRemediationTab === 'INFO') return r.severity === 'LOW';
    return true;
  });

  // Automated workflows for this tenant
  const tenantWorkflows = [
    {
      id: 'wf-a',
      name: 'Microsoft Graph Delta Sync',
      cadence: 'Every 15 Minutes',
      lastRun: '2 mins ago',
      status: 'ACTIVE',
    },
    {
      id: 'wf-b',
      name: 'Auto-Revoke Inactive B2B Guests',
      cadence: 'Daily @ 02:00 UTC',
      lastRun: '18 hours ago',
      status: 'ACTIVE',
    },
    {
      id: 'wf-c',
      name: 'Conditional Access Drift Enforcer',
      cadence: 'Real-time Event Grid',
      lastRun: 'Continuous',
      status: 'ACTIVE',
    },
    {
      id: 'wf-d',
      name: 'BitLocker Endpoint Sync',
      cadence: 'Weekly on Sundays',
      lastRun: '3 days ago',
      status: 'SCHEDULED',
    },
  ];

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea] bg-[#0b0e14]">
      {/* 1. Header & Context Bar (Top Row) */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Tenant Name & Domain Details */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center font-bold text-base text-[#a3c9ff] shadow-inner">
              {tenant.code}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                  <span>{tenant.name}</span>
                  <span className="text-xs bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] px-2 py-0.5 rounded font-mono font-medium">
                    Managed Client
                  </span>
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#8a919e] font-mono mt-0.5">
                <span className="text-[#e0e2ea] font-semibold">{tenant.primaryDomain}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  ID: <span className="text-[#c0c7d4]">{tenant.tenantId.substring(0, 18)}...</span>
                  <button
                    onClick={handleCopyTenantId}
                    title="Copy Full Tenant GUID"
                    className="hover:text-[#a3c9ff] text-[#8a919e] transition-colors p-0.5"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {copiedTenantId && <span className="text-[10px] text-[#4ade80] font-sans font-bold">Copied!</span>}
                </span>
                <span>•</span>
                <span className="text-[#4ade80] font-sans font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                  GDAP Delegation Active
                </span>
              </div>
            </div>
          </div>

          {/* Right: Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Health Score Pill */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm">
              <div className="text-[10px] text-[#8a919e] font-bold uppercase tracking-wider">Health Score</div>
              <div className="flex items-center gap-1 text-sm font-bold text-[#4ade80]">
                <ShieldCheck className="w-4 h-4 text-[#4ade80]" />
                <span>{tenant.secureScore} / 100</span>
              </div>
            </div>

            {/* Sync Now Button */}
            <button
              onClick={() => onRunSync(tenant)}
              className="bg-[#272a30] border border-[#404752] text-[#e0e2ea] hover:bg-[#0078d4] hover:text-white px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span>Sync Now</span>
            </button>

            {/* Export Report Button */}
            <button
              onClick={() => onExportReport(tenant.name)}
              className="bg-[#272a30] border border-[#404752] text-[#e0e2ea] hover:bg-[#31353b] px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span>Export Report</span>
            </button>

            {/* Switch Tenant Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsTenantDropdownOpen(!isTenantDropdownOpen)}
                className="bg-[#0078d4] text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-[#0060ab] transition-colors flex items-center gap-1.5 shadow-md"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Switch Tenant</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {isTenantDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsTenantDropdownOpen(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-[#1c2026] border border-[#404752] rounded shadow-2xl py-1 z-50 text-xs">
                    <div className="px-3 py-1.5 border-b border-[#404752] text-[10px] font-bold text-[#8a919e] uppercase">
                      Select Tenant Focus
                    </div>
                    <button
                      onClick={() => {
                        onSelectTenant(null);
                        setIsTenantDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#272a30] text-[#a3c9ff] font-semibold flex items-center justify-between"
                    >
                      <span>Return to Global Console</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <div className="border-t border-[#404752]/50 max-h-48 overflow-y-auto divide-y divide-[#404752]/30">
                      {tenants.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            onSelectTenant(t);
                            setIsTenantDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-[#272a30] text-xs flex items-center justify-between ${
                            t.id === tenant.id ? 'bg-[#3a4a5f]/40 font-bold text-[#a3c9ff]' : 'text-[#e0e2ea]'
                          }`}
                        >
                          <div>
                            <div className="font-semibold">{t.name}</div>
                            <div className="text-[10px] text-[#8a919e] font-mono">{t.primaryDomain}</div>
                          </div>
                          {t.id === tenant.id && <CheckCircle2 className="w-3.5 h-3.5 text-[#a3c9ff]" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Back to Global Console button */}
            <button
              onClick={() => onSelectTenant(null)}
              className="bg-[#31353b] hover:bg-[#404752] text-[#8a919e] hover:text-[#e0e2ea] px-2.5 py-1.5 rounded text-xs transition-colors"
              title="Return to Global Multi-Tenant Overview"
            >
              Back to Global
            </button>
          </div>
        </div>

        {/* M365 License Tier Summary Line */}
        <div className="pt-2 border-t border-[#404752]/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[#8a919e]">Primary M365 License Tier:</span>
            <span className="bg-[#0078d4]/10 border border-[#0078d4]/30 text-[#a3c9ff] px-2.5 py-0.5 rounded font-semibold">
              {tenant.licenseUsage.tier} + Defender Plan 2 Mix
            </span>
            <span className="text-[#8a919e]">
              Active Seat Allocation: <strong className="text-[#e0e2ea]">{tenant.licenseUsage.assigned} / {tenant.licenseUsage.total} Seats</strong> ({Math.round((tenant.licenseUsage.assigned / tenant.licenseUsage.total) * 100)}%)
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[#8a919e] font-mono">
            <span>Last Graph Delta Sync: <strong className="text-[#4ade80]">{tenant.lastSyncTimestamp}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. Top Banner: High-Priority Alerts & Quick Remediation (Full Width) */}
      <div className="bg-[#101419] border border-[#ffb4ab]/60 rounded-lg p-3.5 shadow-md bg-gradient-to-r from-[#93000a]/20 via-[#101419] to-[#101419] space-y-3">
        <div className="flex items-center justify-between border-b border-[#404752]/60 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#ffb4ab] animate-pulse" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#ffdad6]">
              High-Priority Tenant Alerts &amp; Quick Remediation (4 Actionable Telemetry Signals)
            </h2>
          </div>
          <span className="text-[10px] text-[#ffb4ab] bg-[#93000a] px-2 py-0.5 rounded font-bold">
            Action Required
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tenantAlerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-[#181c22] border border-[#404752] p-3 rounded-md flex flex-col justify-between space-y-2 hover:border-[#ffb4ab] transition-colors"
            >
              <div>
                <div className="flex justify-between items-start mb-1">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                      alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                        ? 'bg-[#93000a] text-white'
                        : 'bg-[#713f12] text-white'
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="text-[10px] text-[#8a919e] font-mono">{alert.target}</span>
                </div>
                <div className="font-bold text-xs text-[#e0e2ea] mb-1">{alert.title}</div>
                <p className="text-[11px] text-[#8a919e] line-clamp-2">{alert.details}</p>
              </div>

              <button
                onClick={() => onTriggerRemediation(alert.actionTitle, tenant.name)}
                className="w-full bg-[#0078d4] hover:bg-[#0060ab] text-white py-1.5 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm mt-2"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{alert.actionText}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Core Grid Layout: Left Column (60%) vs Right Column (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN: Telemetry & Security Posture (7 Cols = ~60% Width) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Card A: Security & Compliance Rollup */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Security &amp; Compliance Posture</h2>
              </div>
              <span className="text-xs text-[#4ade80] font-semibold bg-[#052e16] border border-[#166534] px-2 py-0.5 rounded">
                +13.7% vs Industry Avg
              </span>
            </div>

            {/* Secure Score Comparison Bar */}
            <div className="space-y-2 bg-[#181c22] p-3 rounded border border-[#404752]/40">
              <div className="flex justify-between items-baseline text-xs">
                <span className="font-bold text-[#e0e2ea]">Microsoft Secure Score vs Benchmark</span>
                <span className="font-mono text-[#a3c9ff]">
                  <strong>{tenant.secureScore}</strong> / {tenant.maxSecureScore} Points
                </span>
              </div>

              <div className="space-y-1">
                {/* Tenant Score */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-[#8a919e]">
                    <span>{tenant.name} (Current)</span>
                    <span>{(tenant.secureScore / tenant.maxSecureScore * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-[#31353b] rounded-full h-2">
                    <div
                      className="bg-[#0078d4] h-2 rounded-full"
                      style={{ width: `${(tenant.secureScore / tenant.maxSecureScore) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Industry Benchmark */}
                <div className="space-y-0.5 pt-1">
                  <div className="flex justify-between text-[10px] text-[#8a919e]">
                    <span>Industry Benchmark (FinTech/SMB)</span>
                    <span>68.4%</span>
                  </div>
                  <div className="w-full bg-[#31353b] rounded-full h-2">
                    <div className="bg-[#fb923c] h-2 rounded-full" style={{ width: '68.4%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Security Controls Status Grid */}
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40 flex justify-between items-center">
                <div>
                  <div className="text-[10px] text-[#8a919e] font-bold uppercase">Conditional Access</div>
                  <div className="font-bold text-[#a3c9ff]">{tenant.conditionalAccessPoliciesCount} Active Policies</div>
                </div>
                <Lock className="w-4 h-4 text-[#0078d4]" />
              </div>

              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40 flex justify-between items-center">
                <div>
                  <div className="text-[10px] text-[#8a919e] font-bold uppercase">Admin MFA Coverage</div>
                  <div className="font-bold text-[#4ade80]">100% (4 / 4 Admins)</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
              </div>

              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40 flex justify-between items-center">
                <div>
                  <div className="text-[10px] text-[#8a919e] font-bold uppercase">PIM Role Activation</div>
                  <div className="font-bold text-[#e0e2ea]">{tenant.pimEnabled ? 'Enabled & Strict' : 'Disabled'}</div>
                </div>
                <Shield className="w-4 h-4 text-[#a3c9ff]" />
              </div>

              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40 flex justify-between items-center">
                <div>
                  <div className="text-[10px] text-[#8a919e] font-bold uppercase">Baseline Drift</div>
                  <div className="font-bold text-[#4ade80]">100% Compliant</div>
                </div>
                <Award className="w-4 h-4 text-[#4ade80]" />
              </div>
            </div>
          </div>

          {/* Card B: Informational & Health Telemetry */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Informational &amp; Health Telemetry</h2>
              </div>
              <span className="text-[11px] text-[#8a919e] font-mono">Graph API Live</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <Users className="w-3.5 h-3.5 text-[#0078d4]" />
                  <span className="font-bold text-[10px] uppercase">Active Users</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">{tenant.userCount} Active</div>
                <div className="text-[10px] text-[#8a919e]">6 Dormant (&gt;30 days)</div>
              </div>

              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <HardDrive className="w-3.5 h-3.5 text-[#a3c9ff]" />
                  <span className="font-bold text-[10px] uppercase">Mailbox Usage</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">1.2 TB Consumed</div>
                <div className="text-[10px] text-[#4ade80]">100% Health (0 Quota Warnings)</div>
              </div>

              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <Laptop className="w-3.5 h-3.5 text-[#4ade80]" />
                  <span className="font-bold text-[10px] uppercase">Device Sync</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">310 Enrolled</div>
                <div className="text-[10px] text-[#fb923c]">12 Pending Encryption</div>
              </div>
            </div>
          </div>

          {/* Card C: Remediation Center List */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between border-b border-[#404752] pb-2 gap-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Remediation Center (Actionable Queue)</h2>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 bg-[#181c22] p-0.5 rounded border border-[#404752]">
                {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveRemediationTab(tab)}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
                      activeRemediationTab === tab
                        ? 'bg-[#0078d4] text-white'
                        : 'text-[#8a919e] hover:text-[#e0e2ea]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {filteredRemediations.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#181c22] border border-[#404752]/60 p-3 rounded flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-[#0078d4] transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                          item.severity === 'HIGH'
                            ? 'bg-[#93000a] text-white'
                            : item.severity === 'MED'
                            ? 'bg-[#713f12] text-white'
                            : 'bg-[#1e3a8a] text-white'
                        }`}
                      >
                        {item.severity}
                      </span>
                      <span className="text-[10px] font-semibold text-[#a3c9ff]">{item.category}</span>
                      <span className="text-[10px] text-[#8a919e]">• {item.createdTime}</span>
                    </div>

                    <div className="font-bold text-xs text-[#e0e2ea]">{item.title}</div>
                    <div className="text-[11px] text-[#8a919e]">
                      Target: <span className="text-[#e0e2ea] font-medium">{item.affectedTarget}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => onExecutePendingFix(item)}
                    className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1 shrink-0 self-end sm:self-center shadow-sm"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Apply Fix</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Revenue & Growth Opportunities (5 Cols = ~40% Width) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card 1: Upsell & License Optimization */}
          <div className="bg-[#101419] border border-[#0078d4]/50 rounded-lg p-4 space-y-3 shadow-md bg-gradient-to-br from-[#101419] via-[#101419] to-[#0078d4]/10">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#4ade80]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Revenue &amp; License Optimization</h2>
              </div>
              <span className="text-[10px] bg-[#166534] text-[#4ade80] px-2 py-0.5 rounded font-bold">
                +$1,440 MRR Potential
              </span>
            </div>

            {/* Waste Identification */}
            <div className="bg-[#181c22] border border-[#ffb4ab]/30 p-3 rounded space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#ffb4ab]">Unassigned Seats Waste Identified</span>
                <span className="font-mono text-xs font-bold text-[#ffdad6]">$1,650 / mo</span>
              </div>
              <p className="text-[11px] text-[#8a919e]">
                75 idle E5 licenses unallocated for over 45 days. Reallocate or deprovision at contract renewal.
              </p>
            </div>

            {/* Missing Security Add-ons (Upsell) */}
            <div className="bg-[#181c22] border border-[#0078d4]/40 p-3 rounded space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#a3c9ff]">Defender for Endpoint Upgrade</span>
                <span className="font-mono text-xs font-bold text-[#4ade80]">+$1,440 MRR</span>
              </div>
              <p className="text-[11px] text-[#8a919e]">
                480 Business Premium users currently missing Plan 2 threat hunting and XDR detection.
              </p>
              <button
                onClick={() => onTriggerRemediation(`Generate Upgrade Proposal for ${tenant.name}`, tenant.name)}
                className="bg-[#0078d4] hover:bg-[#0060ab] text-white w-full py-1 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 mt-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Generate Client Upgrade Quote</span>
              </button>
            </div>

            {/* Upcoming Renewal */}
            <div className="bg-[#181c22] border border-[#404752] p-3 rounded flex justify-between items-center text-xs">
              <div>
                <div className="font-bold text-[#e0e2ea]">M365 Enterprise Agreement Renewal</div>
                <div className="text-[10px] text-[#8a919e]">Contract expires Sept 4, 2026</div>
              </div>
              <span className="text-xs font-bold text-[#fb923c] bg-[#451a03] border border-[#9a3412] px-2 py-0.5 rounded">
                In 42 Days
              </span>
            </div>
          </div>

          {/* Card 2: Active Automated Workflows */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Active Automated Workflows</h2>
              </div>
              <span className="text-[10px] text-[#4ade80] font-mono">4 Jobs Running</span>
            </div>

            <div className="space-y-2">
              {tenantWorkflows.map((wf) => (
                <div
                  key={wf.id}
                  className="bg-[#181c22] border border-[#404752]/50 p-2.5 rounded flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-[#e0e2ea]">{wf.name}</div>
                    <div className="text-[10px] text-[#8a919e] font-mono">
                      {wf.cadence} • Last: {wf.lastRun}
                    </div>
                  </div>

                  <button
                    onClick={() => onTriggerRemediation(`Trigger ${wf.name} for ${tenant.name}`, tenant.name)}
                    className="p-1.5 bg-[#272a30] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-colors text-[11px] font-semibold flex items-center gap-1"
                    title="Run Job On-Demand"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Run</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Tenant Activity Audit Stream */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Recent Tenant Audit Stream</h2>
              </div>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="p-2 rounded bg-[#181c22] border border-[#404752]/40 space-y-0.5">
                <div className="flex justify-between text-[10px] text-[#8a919e]">
                  <span>10 mins ago</span>
                  <span className="text-[#4ade80]">SUCCESS</span>
                </div>
                <div className="text-[#e0e2ea] font-sans font-semibold">CA Policy Update: Enforce FIDO2</div>
                <div className="text-[10px] text-[#8a919e] font-sans">Operator: m.vance@msp.com</div>
              </div>

              <div className="p-2 rounded bg-[#181c22] border border-[#404752]/40 space-y-0.5">
                <div className="flex justify-between text-[10px] text-[#8a919e]">
                  <span>1 hour ago</span>
                  <span className="text-[#4ade80]">SUCCESS</span>
                </div>
                <div className="text-[#e0e2ea] font-sans font-semibold">PIM Role Activation: Global Admin</div>
                <div className="text-[10px] text-[#8a919e] font-sans">Operator: secops@${tenant.primaryDomain}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
