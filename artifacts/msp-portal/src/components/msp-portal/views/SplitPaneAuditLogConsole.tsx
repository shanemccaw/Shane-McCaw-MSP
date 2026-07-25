// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Terminal,
  Search,
  Filter,
  Clock,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  User,
  Copy,
  Download,
  ExternalLink,
  Code2,
  Tag,
  Activity,
  RefreshCw,
  SlidersHorizontal,
  ArrowRight,
  PanelRightClose,
  PanelRightOpen,
  Building2,
  Check,
  AlertTriangle,
  X,
  FileText,
  Zap,
  Globe,
  Smartphone,
  ShieldCheck,
  Flame,
  Share2,
  Info,
  Ticket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface AuditLogEntry {
  id: string; // e.g., 'AUD-88210-A9'
  timestamp: string; // ISO string or formatted date
  relativeTime: string; // e.g. '2m ago'
  tenantId: string;
  tenantName: string;
  actor: {
    name: string;
    upn: string;
    ip: string;
    location: string;
    role: string;
    clientApp: string;
    userAgent: string;
    sessionId: string;
  };
  action: string;
  category: 'Identity' | 'Exchange' | 'ConditionalAccess' | 'Intune' | 'Security';
  target: {
    name: string;
    type: string;
    id: string;
  };
  status: 'success' | 'failure' | 'gated';
  psaTicketId: string;
  changes: Array<{
    property: string;
    oldValue: string;
    newValue: string;
  }>;
  rawJson: Record<string, any>;
}

interface SplitPaneAuditLogConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// Mock Audit Log Entries (10+ realistic M365 security & admin events)
const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'AUD-99120-X1',
    timestamp: '2026-07-23 22:38:12 UTC',
    relativeTime: '2m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Jane Tech (MSP Lead)',
      upn: 'tech.jane@msp.com',
      ip: '192.168.1.104',
      location: 'Chicago, IL (US)',
      role: 'Global Administrator',
      clientApp: 'Microsoft Graph PowerShell v2.18',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.4',
      sessionId: 'sess-881920-ca-41',
    },
    action: 'Update Conditional Access Policy',
    category: 'ConditionalAccess',
    target: {
      name: 'CA-01-RequireMFA-ForAdmins',
      type: 'ConditionalAccessPolicy',
      id: 'd820194a-810a-4299-b100-992140a129ff',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99214',
    changes: [
      { property: 'State', oldValue: 'Disabled', newValue: 'Enabled (Enforced)' },
      { property: 'GrantControls', oldValue: 'BlockAccess', newValue: 'RequireMFA, RequireCompliantDevice' },
      { property: 'TargetUsers', oldValue: 'None', newValue: 'All Global Admins, Security Admins' },
    ],
    rawJson: {
      id: 'AUD-99120-X1',
      activityDateTime: '2026-07-23T22:38:12Z',
      activityDisplayName: 'Update Conditional Access Policy',
      category: 'PolicyManagement',
      initiatedBy: {
        user: {
          id: 'usr-msp-001',
          displayName: 'Jane Tech (MSP Lead)',
          userPrincipalName: 'tech.jane@msp.com',
          ipAddress: '192.168.1.104',
        },
      },
      targetResources: [
        {
          id: 'd820194a-810a-4299-b100-992140a129ff',
          displayName: 'CA-01-RequireMFA-ForAdmins',
          type: 'ConditionalAccessPolicy',
          modifiedProperties: [
            { displayName: 'state', oldValue: 'disabled', newValue: 'enabled' },
          ],
        },
      ],
      result: 'success',
      resultReason: 'Policy modified via Microsoft Graph API endpoint /identity/conditionalAccess/policies.',
    },
  },
  {
    id: 'AUD-99119-M2',
    timestamp: '2026-07-23 22:24:05 UTC',
    relativeTime: '16m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Alex Rivera',
      upn: 'alex.r@contoso.com',
      ip: '172.56.21.99',
      location: 'Dallas, TX (US)',
      role: 'End User',
      clientApp: 'Microsoft Authenticator App',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
      sessionId: 'sess-771029-mfa-09',
    },
    action: 'Reset User MFA Registration',
    category: 'Identity',
    target: {
      name: 'Alex Rivera',
      type: 'User',
      id: 'alex.r@contoso.com',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99201',
    changes: [
      { property: 'StrongAuthenticationMethod', oldValue: 'SMS (+1-555-0192)', newValue: 'FIDO2 Security Key (YubiKey 5)' },
      { property: 'MFA Registration Status', oldValue: 'Legacy Phone', newValue: 'Passkey / FIDO2 Enrolled' },
    ],
    rawJson: {
      id: 'AUD-99119-M2',
      activityDateTime: '2026-07-23T22:24:05Z',
      activityDisplayName: 'Reset User MFA Registration',
      category: 'UserManagement',
      initiatedBy: { user: { userPrincipalName: 'alex.r@contoso.com', ipAddress: '172.56.21.99' } },
      targetResources: [{ displayName: 'Alex Rivera', type: 'User', id: 'usr-cnt-8812' }],
      result: 'success',
    },
  },
  {
    id: 'AUD-99118-E4',
    timestamp: '2026-07-23 22:10:44 UTC',
    relativeTime: '30m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Automated Security Script',
      upn: 'svc-guardian@msp.com',
      ip: '52.168.99.12',
      location: 'Azure East US Datacenter',
      role: 'Service Principal',
      clientApp: 'Daemon Automation Bot',
      userAgent: 'Go-http-client/1.1 (M365-MSP-Bot)',
      sessionId: 'sess-991024-bot-01',
    },
    action: 'Create Mailbox Auto-Forwarding Rule',
    category: 'Exchange',
    target: {
      name: 'exec-assistant@contoso.com',
      type: 'Mailbox',
      id: 'mbx-exec-assistant-01',
    },
    status: 'failure',
    psaTicketId: 'HaloPSA #TK-99190',
    changes: [
      { property: 'ForwardingAddress', oldValue: 'None', newValue: 'external-audit@external-domain.org' },
      { property: 'DeliverToMailboxAndForward', oldValue: 'False', newValue: 'True' },
      { property: 'Anti-Spam Filter Policy Action', oldValue: 'Allowed', newValue: 'BLOCKED (External Forwarding Policy Violation)' },
    ],
    rawJson: {
      id: 'AUD-99118-E4',
      activityDateTime: '2026-07-23T22:10:44Z',
      activityDisplayName: 'Set-Mailbox / New-InboxRule',
      category: 'ExchangeAdmin',
      initiatedBy: { app: { displayName: 'M365-MSP-Bot', appId: 'app-99120-guid' } },
      targetResources: [{ displayName: 'exec-assistant@contoso.com', type: 'Mailbox' }],
      result: 'failure',
      resultReason: 'Exchange Transport Rule ET-04 explicitly blocks outbound external mailbox forwarding.',
    },
  },
  {
    id: 'AUD-99117-P9',
    timestamp: '2026-07-23 21:45:19 UTC',
    relativeTime: '55m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Mike Vance (MSP Admin)',
      upn: 'm.vance@msp.com',
      ip: '198.51.100.42',
      location: 'New York, NY (US)',
      role: 'Privileged Role Administrator',
      clientApp: 'Entra PIM Portal',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      sessionId: 'sess-881204-pim-77',
    },
    action: 'Privileged Identity (PIM) Activation',
    category: 'Security',
    target: {
      name: 'Global Administrator Role',
      type: 'DirectoryRole',
      id: 'role-global-admin-01',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99182',
    changes: [
      { property: 'PIM Activation Duration', oldValue: 'Inactive', newValue: 'Active (4 Hours Remaining)' },
      { property: 'Justification Reason', oldValue: 'None', newValue: 'PIM Step-Up: Emergency Exchange Transport Rule Remediation' },
    ],
    rawJson: {
      id: 'AUD-99117-P9',
      activityDateTime: '2026-07-23T21:45:19Z',
      activityDisplayName: 'Elevate Role Access via PIM',
      category: 'RoleManagement',
      result: 'success',
    },
  },
  {
    id: 'AUD-99116-I3',
    timestamp: '2026-07-23 21:12:00 UTC',
    relativeTime: '1h 28m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Intune Auto-Compliance Engine',
      upn: 'intune-system@microsoft.com',
      ip: '20.190.142.11',
      location: 'Microsoft Cloud Service',
      role: 'System Service',
      clientApp: 'Microsoft Intune MDM Connector',
      userAgent: 'IntuneService/3.0',
      sessionId: 'sess-intune-sync-11',
    },
    action: 'Trigger Remote Device Wipe',
    category: 'Intune',
    target: {
      name: 'FIN-LAP-8810 (Windows 11)',
      type: 'ManagedDevice',
      id: 'dev-fin-lap-8810-guid',
    },
    status: 'gated',
    psaTicketId: 'HaloPSA #TK-99175',
    changes: [
      { property: 'Wipe Action State', oldValue: 'Normal Device', newValue: 'Pending Admin Dual-Key Sign-off' },
      { property: 'Compliance State', oldValue: 'Non-Compliant (120 Days Offline)', newValue: 'Quarantine Lock' },
    ],
    rawJson: {
      id: 'AUD-99116-I3',
      activityDateTime: '2026-07-23T21:12:00Z',
      activityDisplayName: 'Wipe Device Request',
      category: 'DeviceManagement',
      result: 'gated',
      resultReason: 'Requires second MSP supervisor confirmation before issuing hardware cryptographic erase.',
    },
  },
  {
    id: 'AUD-99115-A4',
    timestamp: '2026-07-23 20:30:15 UTC',
    relativeTime: '2h 10m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Unknown External IP',
      upn: 'exec-assistant@contoso.com',
      ip: '185.220.101.5',
      location: 'Frankfurt, DE (Tor Exit Node)',
      role: 'User Account',
      clientApp: 'Legacy IMAP Connector',
      userAgent: 'Python-urllib/3.9',
      sessionId: 'sess-bad-auth-99',
    },
    action: 'Failed Sign-In Attempt (Legacy Auth)',
    category: 'Identity',
    target: {
      name: 'exec-assistant@contoso.com',
      type: 'User',
      id: 'usr-exec-assistant-01',
    },
    status: 'failure',
    psaTicketId: 'HaloPSA #TK-99160',
    changes: [
      { property: 'Authentication Result', oldValue: 'Success', newValue: 'Blocked (50053 - Account Locked / Password Spray Detected)' },
      { property: 'Risk Level', oldValue: 'Low', newValue: 'HIGH RISK (Flagged by Entra ID Protection)' },
    ],
    rawJson: {
      id: 'AUD-99115-A4',
      activityDateTime: '2026-07-23T20:30:15Z',
      activityDisplayName: 'Sign-in Activity',
      category: 'UserSignIn',
      result: 'failure',
      errorCode: 50053,
      failureReason: 'Account locked due to consecutive password spray attempts.',
    },
  },
  {
    id: 'AUD-99114-S8',
    timestamp: '2026-07-23 19:15:33 UTC',
    relativeTime: '3h 25m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Jane Tech (MSP Lead)',
      upn: 'tech.jane@msp.com',
      ip: '192.168.1.104',
      location: 'Chicago, IL (US)',
      role: 'Global Administrator',
      clientApp: 'Azure Portal',
      userAgent: 'Mozilla/5.0 Chrome/126.0.0.0',
      sessionId: 'sess-az-0012-role',
    },
    action: 'Assign Directory Role to User',
    category: 'Identity',
    target: {
      name: 'david.k@contoso.com',
      type: 'User',
      id: 'usr-david-k-guid',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99148',
    changes: [
      { property: 'Assigned Role', oldValue: 'None (Standard User)', newValue: 'Exchange Administrator' },
      { property: 'Assignment Type', oldValue: 'Permanent', newValue: 'Eligible (PIM Enforced)' },
    ],
    rawJson: {
      id: 'AUD-99114-S8',
      activityDateTime: '2026-07-23T19:15:33Z',
      activityDisplayName: 'Add Member to Role',
      category: 'RoleManagement',
      result: 'success',
    },
  },
  {
    id: 'AUD-99113-C2',
    timestamp: '2026-07-23 18:00:10 UTC',
    relativeTime: '4h 40m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Security Admin Bot',
      upn: 'sec-bot@msp.com',
      ip: '52.168.99.12',
      location: 'Azure East US Datacenter',
      role: 'Service Principal',
      clientApp: 'Defender for Cloud Apps SDK',
      userAgent: 'M365-Defender-SDK/1.4',
      sessionId: 'sess-def-bot-01',
    },
    action: 'Update Defender Anti-Phishing Policy',
    category: 'Security',
    target: {
      name: 'Default Strict Anti-Phishing Policy',
      type: 'DefenderPolicy',
      id: 'pol-anti-phish-strict-01',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99133',
    changes: [
      { property: 'Impression Threshold', oldValue: 'Standard (Level 2)', newValue: 'Aggressive (Level 4)' },
      { property: 'Quarantine Action', oldValue: 'Junk Folder', newValue: 'Quarantine Message' },
    ],
    rawJson: {
      id: 'AUD-99113-C2',
      activityDateTime: '2026-07-23T18:00:10Z',
      activityDisplayName: 'Set-AntiPhishPolicy',
      category: 'DefenderManagement',
      result: 'success',
    },
  },
  {
    id: 'AUD-99112-X9',
    timestamp: '2026-07-23 16:50:00 UTC',
    relativeTime: '5h 50m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Sarah Connor',
      upn: 's.connor@contoso.com',
      ip: '64.233.160.1',
      location: 'Seattle, WA (US)',
      role: 'SharePoint Admin',
      clientApp: 'SharePoint Admin Center Web',
      userAgent: 'Mozilla/5.0 Safari/605.1.15',
      sessionId: 'sess-sp-0012-share',
    },
    action: 'Change SharePoint External Sharing Setting',
    category: 'Exchange',
    target: {
      name: 'Site Collection: /sites/Executive-Finance',
      type: 'SharePointSite',
      id: 'site-exec-fin-guid',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99110',
    changes: [
      { property: 'SharingCapability', oldValue: 'ExternalUserSharingOnly', newValue: 'ExistingGuestsOnly' },
      { property: 'AnonymousLinkExpiration', oldValue: '30 Days', newValue: 'Disabled (No Anonymous Links)' },
    ],
    rawJson: {
      id: 'AUD-99112-X9',
      activityDateTime: '2026-07-23T16:50:00Z',
      activityDisplayName: 'Set-SPOSite External Sharing',
      category: 'SharePointAdmin',
      result: 'success',
    },
  },
  {
    id: 'AUD-99111-K4',
    timestamp: '2026-07-23 15:10:22 UTC',
    relativeTime: '7h 30m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    actor: {
      name: 'Jane Tech (MSP Lead)',
      upn: 'tech.jane@msp.com',
      ip: '192.168.1.104',
      location: 'Chicago, IL (US)',
      role: 'Global Administrator',
      clientApp: 'Entra Admin Center',
      userAgent: 'Mozilla/5.0 Chrome/126.0.0.0',
      sessionId: 'sess-app-reg-44',
    },
    action: 'Grant Admin Consent for Enterprise App',
    category: 'Identity',
    target: {
      name: 'Salesforce M365 Sync Connector',
      type: 'ServicePrincipal',
      id: 'spn-sf-sync-99120',
    },
    status: 'success',
    psaTicketId: 'HaloPSA #TK-99092',
    changes: [
      { property: 'OAuth Permissions Granted', oldValue: 'None', newValue: 'User.Read.All, Contacts.ReadWrite.All' },
      { property: 'Consent Granted By', oldValue: 'None', newValue: 'tech.jane@msp.com (Tenant Admin)' },
    ],
    rawJson: {
      id: 'AUD-99111-K4',
      activityDateTime: '2026-07-23T15:10:22Z',
      activityDisplayName: 'Grant Admin Consent',
      category: 'ApplicationManagement',
      result: 'success',
    },
  },
];

export const SplitPaneAuditLogConsole: React.FC<SplitPaneAuditLogConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
}) => {
  // State
  const [logs, setLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [selectedLogId, setSelectedLogId] = useState<string>('AUD-99120-X1');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [inspectorTab, setInspectorTab] = useState<'formatted' | 'json'>('formatted');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All Workloads');
  const [selectedOutcome, setSelectedOutcome] = useState<string>('All Outcomes');
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>('24h');
  const [isPolling, setIsPolling] = useState(false);

  // Active Tenant
  const activeTenant = useMemo(() => {
    return (
      selectedTenant ||
      tenants[0] || { id: 'contoso-01', name: 'Contoso Corporation', primaryDomain: 'contoso.onmicrosoft.com' }
    );
  }, [selectedTenant, tenants]);

  // Selected Log Item for Right Inspector Pane
  const selectedLog = useMemo(() => {
    return logs.find((l) => l.id === selectedLogId) || logs[0];
  }, [logs, selectedLogId]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const totalToday = 14291;
    const securityChanges = logs.filter(
      (l) => l.category === 'ConditionalAccess' || l.category === 'Security'
    ).length + 338;
    const failedSignIns = logs.filter((l) => l.status === 'failure').length + 10;
    const activeTechActors = 8;

    return { totalToday, securityChanges, failedSignIns, activeTechActors };
  }, [logs]);

  // Filtered Logs List
  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      // Category / Workload filter
      if (selectedCategory !== 'All Workloads' && item.category !== selectedCategory) {
        return false;
      }

      // Outcome Filter
      if (selectedOutcome === 'Success' && item.status !== 'success') return false;
      if (selectedOutcome === 'Failure' && item.status !== 'failure') return false;
      if (selectedOutcome === 'Gated' && item.status !== 'gated') return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesAction = item.action.toLowerCase().includes(q);
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesActor = item.actor.upn.toLowerCase().includes(q) || item.actor.name.toLowerCase().includes(q);
        const matchesTarget = item.target.name.toLowerCase().includes(q);
        const matchesIp = item.actor.ip.toLowerCase().includes(q);
        const matchesTicket = item.psaTicketId.toLowerCase().includes(q);

        return matchesAction || matchesId || matchesActor || matchesTarget || matchesIp || matchesTicket;
      }

      return true;
    });
  }, [logs, selectedCategory, selectedOutcome, searchQuery]);

  // Handle Poll Stream
  const handleRefreshPolling = () => {
    setIsPolling(true);
    onShowToast?.('info', 'Polling Entra Audit Logs', 'Fetching latest /auditLogs/directoryAudits from Graph API...');
    setTimeout(() => {
      setIsPolling(false);
      onShowToast?.('success', 'Audit Stream Synced', 'Fetched 10 latest Graph audit events.');
    }, 1000);
  };

  // Copy JSON
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(selectedLog.rawJson, null, 2));
    onShowToast?.('success', 'JSON Copied', `Copied unparsed Graph JSON for ${selectedLog.id} to clipboard.`);
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. HEADER & AUDIT METRICS BAR (FULL WIDTH) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0078d4]/20 border border-[#0078d4] flex items-center justify-center text-[#a3c9ff] shrink-0 font-mono">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  M365 Unified Security Audit & Triage Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-bold">
                  /portal/audit
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>Tenant Scope:</span>
                <select
                  value={activeTenant.id}
                  onChange={(e) => {
                    const t = tenants.find((x) => x.id === e.target.value) || null;
                    onSelectTenant?.(t);
                  }}
                  className="bg-[#101419] border border-[#404752] text-[#a3c9ff] text-xs font-semibold rounded px-2 py-0.5 outline-none focus:border-[#0078d4] cursor-pointer"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.primaryDomain})
                    </option>
                  ))}
                </select>

                <span className="text-emerald-400 text-[11px] font-mono flex items-center gap-1 ml-2">
                  <CheckCircle2 className="w-3 h-3" /> Graph Stream Live
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRefreshPolling}
              disabled={isPolling}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>{isPolling ? 'Polling Stream...' : 'Live Poll (5m)'}</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.('success', 'Audit Exported', `Exported ${filteredLogs.length} audit entries to CSV/JSON format.`);
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Stream (CSV/JSON)</span>
            </button>

            <button
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              className="p-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs cursor-pointer"
              title={isInspectorOpen ? 'Collapse Right Inspector' : 'Expand Right Inspector'}
            >
              {isInspectorOpen ? <PanelRightClose className="w-4 h-4 text-[#a3c9ff]" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          </div>

        </div>

        {/* Audit Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="bg-[#101419] border border-[#404752] p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#8a919e] flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-[#a3c9ff]" />
                TOTAL AUDIT EVENTS TODAY
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                {metrics.totalToday.toLocaleString()} <span className="text-xs font-normal text-emerald-400">(+8.2%)</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Directory & Sign-in logs</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4] text-[#a3c9ff]">
              <Terminal className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-purple-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                SECURITY & CA CHANGES
              </div>
              <div className="text-xl font-bold font-mono text-purple-200">
                {metrics.securityChanges} <span className="text-xs font-normal text-purple-400">Events</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Policies, PIM & MFA mods</div>
            </div>
            <div className="p-2 rounded bg-purple-950/40 border border-purple-800 text-purple-400">
              <Tag className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-red-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-red-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                FAILED SIGN-INS / BLOCKS
              </div>
              <div className="text-xl font-bold font-mono text-red-300">
                {metrics.failedSignIns} <span className="text-xs font-normal text-red-400">Alerts</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Spray & legacy auth blocks</div>
            </div>
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-400">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                ACTIVE TECH ACTORS
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {metrics.activeTechActors} <span className="text-xs font-normal text-emerald-400">MSP Admins</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Active admin sessions</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. SEARCH & MULTI-FILTER BAR (STICKY TOOLBAR) */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Actor UPN, Target, Action, IP, or HaloPSA Ticket..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a919e] hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Workload Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Workloads">All Categories</option>
            <option value="ConditionalAccess">Conditional Access</option>
            <option value="Identity">Identity & MFA</option>
            <option value="Exchange">Exchange Online</option>
            <option value="Intune">Intune & MDM</option>
            <option value="Security">Security & PIM</option>
          </select>

          {/* Outcome Filter */}
          <select
            value={selectedOutcome}
            onChange={(e) => setSelectedOutcome(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Outcomes">All Outcomes</option>
            <option value="Success">🟢 Success Only</option>
            <option value="Failure">🔴 Failure Only</option>
            <option value="Gated">🟡 Gated Only</option>
          </select>

          {/* Time Range Filter */}
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer font-mono"
          >
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        <div className="text-xs text-[#8a919e] font-mono">
          Showing <strong className="text-[#e0e2ea]">{filteredLogs.length}</strong> Audit Events
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. SPLIT-PANE CONTAINER (LEFT STREAM 60% | RIGHT INSPECTOR 40%) */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden bg-[#0b0e14] relative">
        
        {/* LEFT PANE (60% Width): High-Density Event Stream Table */}
        <div className={cn(
          'overflow-y-auto border-r border-[#404752] transition-all flex flex-col',
          isInspectorOpen ? 'w-full lg:w-[60%]' : 'w-full'
        )}>
          
          <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
            <span>Graph Directory Audit Stream</span>
            <span>Click row to load deep triage pane</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse font-sans">
              <thead>
                <tr className="bg-[#181c22] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                  <th className="p-2.5 w-8"></th>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Actor (Who)</th>
                  <th className="p-2.5">Action (What)</th>
                  <th className="p-2.5">Target Resource</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#404752]/60 font-mono text-[11.5px]">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                      No audit log entries found matching current filter parameters.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((item) => {
                    const isSelected = selectedLogId === item.id;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedLogId(item.id);
                          if (!isInspectorOpen) setIsInspectorOpen(true);
                        }}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-[#272a30]/60',
                          isSelected ? 'bg-[#0078d4]/15 font-semibold text-white' : 'text-[#e0e2ea]'
                        )}
                      >
                        {/* Selected Indicator Bar */}
                        <td className="p-2.5 text-center">
                          <div className={cn(
                            'w-1.5 h-6 rounded-full mx-auto',
                            isSelected ? 'bg-[#0078d4]' : 'bg-transparent'
                          )} />
                        </td>

                        {/* Timestamp */}
                        <td className="p-2.5 whitespace-nowrap">
                          <div className="font-bold text-[#e0e2ea]">{item.relativeTime}</div>
                          <div className="text-[10px] text-[#8a919e]">{item.timestamp.split(' ')[1]}</div>
                        </td>

                        {/* Actor */}
                        <td className="p-2.5">
                          <div className="font-bold text-[#a3c9ff] truncate max-w-[150px]">
                            {item.actor.name}
                          </div>
                          <div className="text-[10px] text-[#8a919e] truncate max-w-[150px]">
                            {item.actor.upn}
                          </div>
                        </td>

                        {/* Action */}
                        <td className="p-2.5 font-sans">
                          <div className="font-bold text-[#e0e2ea] truncate max-w-[180px]">
                            {item.action}
                          </div>
                          <div className="text-[10px] font-mono text-purple-300">
                            {item.category}
                          </div>
                        </td>

                        {/* Target Entity */}
                        <td className="p-2.5">
                          <div className="truncate max-w-[140px] text-[#e0e2ea]">
                            {item.target.name}
                          </div>
                          <div className="text-[10px] text-[#8a919e]">
                            {item.target.type}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-2.5">
                          {item.status === 'success' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                              SUCCESS
                            </span>
                          ) : item.status === 'failure' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white animate-pulse">
                              FAILURE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              GATED
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </div>

        {/* RIGHT PANE (40% Width): Deep Triage & Delta Inspector */}
        {isInspectorOpen && (
          <div className="w-full lg:w-[40%] bg-[#181c22] flex flex-col h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right">
            
            {/* Inspector Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono text-[10.5px]">
                  <span className="text-[#a3c9ff] font-bold">{selectedLog.id}</span>
                  <span>•</span>
                  <span className="text-[#8a919e]">{selectedLog.category}</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={handleCopyJson}
                    className="p-1 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
                    title="Copy Raw JSON"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setIsInspectorOpen(false)}
                    className="p-1 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h2 className="font-bold text-sm text-[#e0e2ea] leading-snug">
                {selectedLog.action}
              </h2>

              <div className="flex items-center justify-between text-xs font-mono pt-1">
                <span className="text-[#8a919e]">{selectedLog.timestamp}</span>
                {selectedLog.status === 'success' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    STATUS: SUCCESS
                  </span>
                ) : selectedLog.status === 'failure' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white">
                    STATUS: FAILURE
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                    STATUS: GATED
                  </span>
                )}
              </div>

              {/* Inspector Sub-Tabs */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#404752]">
                <button
                  onClick={() => setInspectorTab('formatted')}
                  className={cn(
                    'px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1',
                    inspectorTab === 'formatted'
                      ? 'bg-[#0078d4] text-white'
                      : 'bg-[#272a30] text-[#8a919e] hover:text-white'
                  )}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Formatted Triage & Delta</span>
                </button>

                <button
                  onClick={() => setInspectorTab('json')}
                  className={cn(
                    'px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1',
                    inspectorTab === 'json'
                      ? 'bg-[#0078d4] text-white'
                      : 'bg-[#272a30] text-[#8a919e] hover:text-white'
                  )}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Raw Graph JSON</span>
                </button>
              </div>
            </div>

            {/* Inspector Body */}
            <div className="p-4 space-y-4 text-xs font-sans overflow-y-auto flex-1">
              
              {inspectorTab === 'formatted' ? (
                <>
                  {/* Actor & Environment Context Card */}
                  <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2">
                    <h3 className="font-mono text-[11px] font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-[#0078d4]" />
                      <span>Initiating Actor & Environment</span>
                    </h3>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
                      <div>
                        <div className="text-[#8a919e]">Actor Name</div>
                        <div className="font-bold text-[#e0e2ea]">{selectedLog.actor.name}</div>
                      </div>

                      <div>
                        <div className="text-[#8a919e]">UPN / Identity</div>
                        <div className="font-bold text-[#a3c9ff] truncate">{selectedLog.actor.upn}</div>
                      </div>

                      <div>
                        <div className="text-[#8a919e]">IP Address</div>
                        <div className="font-bold text-amber-200">{selectedLog.actor.ip}</div>
                      </div>

                      <div>
                        <div className="text-[#8a919e]">Location</div>
                        <div className="font-bold text-[#e0e2ea]">{selectedLog.actor.location}</div>
                      </div>

                      <div className="col-span-2 pt-1 border-t border-[#404752]/60">
                        <div className="text-[#8a919e]">Client Application / SDK</div>
                        <div className="font-bold text-[#e0e2ea] text-[10.5px] truncate">{selectedLog.actor.clientApp}</div>
                      </div>
                    </div>
                  </div>

                  {/* Target Entity Card */}
                  <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2">
                    <h3 className="font-mono text-[11px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-purple-400" />
                      <span>Target Resource Context</span>
                    </h3>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div>
                        <div className="text-[#8a919e]">Resource Name</div>
                        <div className="font-bold text-[#e0e2ea]">{selectedLog.target.name}</div>
                      </div>

                      <div>
                        <div className="text-[#8a919e]">Resource Type</div>
                        <div className="font-bold text-purple-200">{selectedLog.target.type}</div>
                      </div>
                    </div>
                  </div>

                  {/* State Delta Card (Before vs After) */}
                  <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2.5">
                    <h3 className="font-mono text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
                      <span>State Modification Delta (Before vs After)</span>
                    </h3>

                    <div className="space-y-2 font-mono text-[11px]">
                      {selectedLog.changes.map((chg, idx) => (
                        <div key={idx} className="bg-[#181c22] border border-[#404752] p-2.5 rounded space-y-1">
                          <div className="text-[#a3c9ff] font-bold">{chg.property}</div>
                          
                          <div className="grid grid-cols-2 gap-2 pt-1 text-[10.5px]">
                            <div className="bg-red-950/40 border border-red-800/60 p-1.5 rounded text-red-300 truncate">
                              <span className="text-red-400 font-bold block text-[9.5px]">OLD VALUE:</span>
                              {chg.oldValue}
                            </div>

                            <div className="bg-emerald-950/40 border border-emerald-800/60 p-1.5 rounded text-emerald-300 truncate">
                              <span className="text-emerald-400 font-bold block text-[9.5px]">NEW VALUE:</span>
                              {chg.newValue}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Associated PSA Ticket Link */}
                  <div className="bg-[#101419] border border-[#0078d4]/40 rounded-lg p-3 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-[#a3c9ff]" />
                      <span>PSA Ticket Mapping: <strong className="text-white">{selectedLog.psaTicketId}</strong></span>
                    </div>

                    <button
                      onClick={() => {
                        onShowToast?.('info', 'PSA Ticket Opened', `Opening ticket ${selectedLog.psaTicketId} in HaloPSA...`);
                      }}
                      className="text-[#a3c9ff] underline hover:text-white cursor-pointer text-[11px]"
                    >
                      Inspect PSA Ticket
                    </button>
                  </div>
                </>
              ) : (
                /* RAW GRAPH JSON INSPECTOR */
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between bg-[#101419] p-2 rounded border border-[#404752]">
                    <span className="text-[#8a919e] text-[11px]">Unparsed Microsoft Graph API Event Payload</span>
                    <button
                      onClick={handleCopyJson}
                      className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy JSON</span>
                    </button>
                  </div>

                  <div className="bg-[#0b0e14] border border-[#404752] p-3 rounded font-mono text-[11px] text-[#4ade80] overflow-x-auto whitespace-pre leading-relaxed select-text">
                    {JSON.stringify(selectedLog.rawJson, null, 2)}
                  </div>
                </div>
              )}

            </div>

          </div>
        )}

      </div>

    </div>
  );
};

