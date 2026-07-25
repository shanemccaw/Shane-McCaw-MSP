// @ts-nocheck
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  GitCommit,
  GitPullRequest,
  RotateCcw,
  Calendar,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Download,
  Send,
  RefreshCw,
  Search,
  Filter,
  SlidersHorizontal,
  Lock,
  Layers,
  Activity,
  UserCheck,
  History,
  Sparkles,
  Plus,
  X,
  Building2,
  ChevronRight,
  Copy,
  Check,
  Code2,
  ShieldCheck,
  Eye,
  Play,
  ArrowRight,
  CornerUpLeft,
  Ticket,
  User,
  CheckSquare,
  FileSpreadsheet,
  AlertCircle,
  FileCode,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface ChangeRequest {
  id: string; // e.g. 'CR-2026-104'
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  description: string;
  changeClass: 'standard' | 'normal' | 'emergency';
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  category: 'ConditionalAccess' | 'Exchange' | 'Identity' | 'Intune' | 'Defender';
  targetResource: string; // Graph API endpoint
  psaTicketId: string; // e.g. 'HaloPSA #TK-88319'
  requestedBy: string; // UPN
  requestedAt: string;
  scheduledFor: string;
  impactedUsersCount: number;
  status:
    | 'pending_approval'
    | 'scheduled'
    | 'in_progress'
    | 'completed'
    | 'rolled_back'
    | 'rejected';
  backupVerified: boolean;
  backupHash: string;
  preChangeSnapshot: Record<string, any>;
  proposedPayload: Record<string, any>;
  rollbackScriptSnippet: string;
  executedAt?: string;
  approvedBy?: string;
}

interface ChangeManagementConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
}

// 6+ Realistic M365 Change Requests
const INITIAL_CHANGE_REQUESTS: ChangeRequest[] = [
  {
    id: 'CR-2026-104',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    title: 'Deploy Phishing-Resistant FIDO2 MFA Policy to Executive Group',
    description:
      'Enforce strict FIDO2 security key or Certificate-Based Authentication for 42 Executive and Finance team accounts via Conditional Access Policy update.',
    changeClass: 'normal',
    riskLevel: 'high',
    category: 'ConditionalAccess',
    targetResource: '/v1.0/identity/conditionalAccess/policies/ca-exec-fido2-8821',
    psaTicketId: 'HaloPSA #TK-88319',
    requestedBy: 'alex.vance@mspplatform.com',
    requestedAt: '2026-07-23 18:20 UTC',
    scheduledFor: '2026-07-26 02:00 UTC (Maintenance Window)',
    impactedUsersCount: 42,
    status: 'pending_approval',
    backupVerified: true,
    backupHash: 'SHA256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    preChangeSnapshot: {
      id: 'ca-exec-fido2-8821',
      displayName: 'Exec Group Access Baseline',
      state: 'enabledForReportingButNotEnforced',
      conditions: {
        users: { includeGroups: ['GRP-EXEC-FINANCE-01'] },
        applications: { includeApplications: ['All'] },
      },
      grantControls: {
        operator: 'OR',
        builtInControls: ['mfa'],
      },
    },
    proposedPayload: {
      id: 'ca-exec-fido2-8821',
      displayName: 'Exec Group Access Baseline - Strict FIDO2',
      state: 'enabled',
      conditions: {
        users: { includeGroups: ['GRP-EXEC-FINANCE-01'] },
        applications: { includeApplications: ['All'] },
      },
      grantControls: {
        operator: 'OR',
        authenticationStrength: {
          id: '00000000-0000-0000-0000-000000000002',
          displayName: 'Phishing-Resistant MFA',
        },
      },
    },
    rollbackScriptSnippet:
      'PATCH /v1.0/identity/conditionalAccess/policies/ca-exec-fido2-8821 -d @preChangeSnapshot.json',
  },
  {
    id: 'CR-2026-103',
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.onmicrosoft.com',
    title: 'Block Unauthenticated SMTP Submission Globally in Exchange Online',
    description: 'Disable legacy authenticated SMTP across all mailboxes to eliminate password sniffing vulnerability.',
    changeClass: 'standard',
    riskLevel: 'medium',
    category: 'Exchange',
    targetResource: '/v1.0/admin/exchange/transportConfigs/smtpClientAuthenticationDisabled',
    psaTicketId: 'ConnectWise #CW-99102',
    requestedBy: 'mchen@mspplatform.com',
    requestedAt: '2026-07-22 14:10 UTC',
    scheduledFor: '2026-07-25 04:00 UTC',
    impactedUsersCount: 150,
    status: 'scheduled',
    backupVerified: true,
    backupHash: 'SHA256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284ddd200126d9069b',
    preChangeSnapshot: {
      smtpClientAuthenticationDisabled: false,
      allowLegacySmtpRelayAccounts: ['svc.scanner@fabrikam.com'],
    },
    proposedPayload: {
      smtpClientAuthenticationDisabled: true,
      allowLegacySmtpRelayAccounts: ['svc.scanner@fabrikam.com'],
    },
    rollbackScriptSnippet:
      'Set-TransportConfig -SmtpClientAuthenticationDisabled $false',
  },
  {
    id: 'CR-2026-102',
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    primaryDomain: 'woodgrovebank.com',
    title: 'Emergency Revocation of Compromised Admin Refresh Tokens',
    description: 'Emergency break-fix: Invalidate active user sessions and refresh tokens for compromised tenant admin account.',
    changeClass: 'emergency',
    riskLevel: 'critical',
    category: 'Identity',
    targetResource: '/v1.0/users/sec.admin@woodgrovebank.com/revokeSignInSessions',
    psaTicketId: 'HaloPSA #TK-90112',
    requestedBy: 'alex.vance@mspplatform.com',
    requestedAt: '2026-07-23 21:00 UTC',
    scheduledFor: '2026-07-23 21:05 UTC (Immediate Execution)',
    impactedUsersCount: 1,
    status: 'completed',
    backupVerified: true,
    backupHash: 'SHA256:1198c22b90d21a99f812034821a980bbd41f5a91823bc8e0',
    preChangeSnapshot: {
      userPrincipalName: 'sec.admin@woodgrovebank.com',
      refreshTokensValidFromDateTime: '2026-07-20T10:00:00Z',
      accountEnabled: true,
    },
    proposedPayload: {
      userPrincipalName: 'sec.admin@woodgrovebank.com',
      refreshTokensValidFromDateTime: '2026-07-23T21:05:00Z',
      accountEnabled: true,
    },
    rollbackScriptSnippet: 'N/A - Security Revocation Cannot Be Undone (Re-authentication required)',
    executedAt: '2026-07-23 21:05 UTC',
    approvedBy: 'lead.soc@mspplatform.com',
  },
  {
    id: 'CR-2026-101',
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    primaryDomain: 'northwind.onmicrosoft.com',
    title: 'Deploy Intune iOS Compliance Policy with BitLocker Enforcement',
    description: 'Enforce iOS 17.5 minimum version and mobile passcode compliance across 35 corporate iPhones.',
    changeClass: 'normal',
    riskLevel: 'medium',
    category: 'Intune',
    targetResource: '/v1.0/deviceManagement/deviceCompliancePolicies/ios-policy-99',
    psaTicketId: 'ConnectWise #CW-98210',
    requestedBy: 'mchen@mspplatform.com',
    requestedAt: '2026-07-20 11:00 UTC',
    scheduledFor: '2026-07-22 01:00 UTC',
    impactedUsersCount: 35,
    status: 'completed',
    backupVerified: true,
    backupHash: 'SHA256:3e21a094b81c6d88f910a2741122aa71e3b0c44298fc1c149afbf4c8996fb924',
    preChangeSnapshot: {
      osMinimumVersion: '16.0.0',
      passcodeRequired: true,
      passcodeMinimumLength: 6,
    },
    proposedPayload: {
      osMinimumVersion: '17.5.0',
      passcodeRequired: true,
      passcodeMinimumLength: 8,
    },
    rollbackScriptSnippet:
      'PUT /v1.0/deviceManagement/deviceCompliancePolicies/ios-policy-99 -d @preChangeSnapshot.json',
    executedAt: '2026-07-22 01:02 UTC',
    approvedBy: 'alex.vance@mspplatform.com',
  },
  {
    id: 'CR-2026-100',
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    primaryDomain: 'adventureworks.com',
    title: 'Defender for Office 365 Automated Investigation & Response (AIR) Tuning',
    description: 'Enable automatic remediation for high-confidence phishing alerts in Exchange mailboxes.',
    changeClass: 'standard',
    riskLevel: 'low',
    category: 'Defender',
    targetResource: '/v1.0/security/threatProtection/airPolicies/phish-auto-remediator',
    psaTicketId: 'HaloPSA #TK-87110',
    requestedBy: 'alex.vance@mspplatform.com',
    requestedAt: '2026-07-19 09:30 UTC',
    scheduledFor: '2026-07-21 03:00 UTC',
    impactedUsersCount: 80,
    status: 'completed',
    backupVerified: true,
    backupHash: 'SHA256:7a10b98f2190c1284a001192834b92c13e21a094b81c6d88f910a2741122aa71',
    preChangeSnapshot: {
      autoRemediationLevel: 'SemiAutomated',
      approvalTimeoutHours: 24,
    },
    proposedPayload: {
      autoRemediationLevel: 'FullAutomation',
      approvalTimeoutHours: 0,
    },
    rollbackScriptSnippet:
      'PATCH /v1.0/security/threatProtection/airPolicies/phish-auto-remediator -d "{\"autoRemediationLevel\":\"SemiAutomated\"}"',
    executedAt: '2026-07-21 03:00 UTC',
    approvedBy: 'lead.soc@mspplatform.com',
  },
  {
    id: 'CR-2026-099',
    tenantId: 'tailspin-06',
    tenantName: 'Tailspin Toys',
    primaryDomain: 'tailspintoys.com',
    title: 'Restrict External Guest Access in SharePoint Online & OneDrive',
    description: 'Disable guest sharing permissions for anonymous links across marketing SharePoint site.',
    changeClass: 'normal',
    riskLevel: 'medium',
    category: 'Identity',
    targetResource: '/v1.0/admin/sharepoint/settings/tenantSharingLimits',
    psaTicketId: 'ConnectWise #CW-97120',
    requestedBy: 'mchen@mspplatform.com',
    requestedAt: '2026-07-18 16:00 UTC',
    scheduledFor: '2026-07-20 02:00 UTC',
    impactedUsersCount: 25,
    status: 'rolled_back',
    backupVerified: true,
    backupHash: 'SHA256:8f92a39c4e1b8200d41f5a91823bc8e07a10b98f2190c1284a001192834b92c1',
    preChangeSnapshot: {
      sharingCapability: 'ExternalUserAndGuestSharing',
      requireAnonymousLinksExpirationInDays: 30,
    },
    proposedPayload: {
      sharingCapability: 'ExistingExternalUserSharingOnly',
      requireAnonymousLinksExpirationInDays: 7,
    },
    rollbackScriptSnippet:
      'PATCH /v1.0/admin/sharepoint/settings/tenantSharingLimits -d @preChangeSnapshot.json',
    executedAt: '2026-07-20 02:01 UTC',
    approvedBy: 'alex.vance@mspplatform.com',
  },
];

export const ChangeManagementConsole: React.FC<ChangeManagementConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [selectedCrId, setSelectedCrId] = useState<string>('CR-2026-104');
  const [activeTab, setActiveTab] = useState<'active' | 'calendar' | 'rollback'>('active');

  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantFilter, setTenantFilter] = useState('All');
  const [changeClassFilter, setChangeClassFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Wizard Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // New CR Form State
  const [newCrTenantId, setNewCrTenantId] = useState('contoso-01');
  const [newCrTitle, setNewCrTitle] = useState('');
  const [newCrDescription, setNewCrDescription] = useState('');
  const [newCrClass, setNewCrClass] = useState<'standard' | 'normal' | 'emergency'>('normal');
  const [newCrRisk, setNewCrRisk] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [newCrCategory, setNewCrCategory] = useState<ChangeRequest['category']>('ConditionalAccess');
  const [newCrResource, setNewCrResource] = useState('/v1.0/identity/conditionalAccess/policies/new-policy');
  const [newCrPsaTicket, setNewCrPsaTicket] = useState('HaloPSA #TK-91204');
  const [newCrSchedule, setNewCrSchedule] = useState('2026-07-27 02:00 UTC (Next Maint Window)');
  const [newCrImpactedUsers, setNewCrImpactedUsers] = useState<number>(25);

  const [newCrPreJson, setNewCrPreJson] = useState('{\n  "state": "disabled",\n  "conditions": {}\n}');
  const [newCrProposedJson, setNewCrProposedJson] = useState('{\n  "state": "enabled",\n  "conditions": {\n    "users": { "include": ["All"] }\n  }\n}');

  // Selected CR
  const selectedCr = useMemo(() => {
    return changeRequests.find((cr) => cr.id === selectedCrId) || changeRequests[0];
  }, [changeRequests, selectedCrId]);

  // Load CRs
  const loadChangeRequests = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/msp/change-requests');
      if (res.ok) {
        const data = await res.json();
        setChangeRequests(data);
        if (data.length > 0) {
          setSelectedCrId((prev) => {
            const exists = data.some((cr: any) => cr.id === prev);
            return exists ? prev : data[0].id;
          });
        }
      } else {
        onShowToast?.('error', 'Failed to load change requests', 'Server returned error status');
      }
    } catch (error) {
      onShowToast?.('error', 'Error loading change requests', 'Could not connect to the API');
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, onShowToast]);

  useEffect(() => {
    loadChangeRequests();
  }, [loadChangeRequests]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const pendingCount = changeRequests.filter((cr) => cr.status === 'pending_approval').length;
    const scheduledCount = changeRequests.filter((cr) => cr.status === 'scheduled').length;
    const emergency24hCount = changeRequests.filter(
      (cr) => cr.changeClass === 'emergency'
    ).length;

    const rollbackReadyCount = changeRequests.filter((cr) => cr.backupVerified).length;
    const totalCount = changeRequests.length;
    const rollbackRate = totalCount > 0 ? Math.round((rollbackReadyCount / totalCount) * 100) : 100;

    return {
      pendingCount,
      scheduledCount,
      emergency24hCount,
      rollbackRate,
    };
  }, [changeRequests]);

  // Filtered CR List
  const filteredRequests = useMemo(() => {
    return changeRequests.filter((cr) => {
      if (tenantFilter !== 'All' && cr.tenantId !== tenantFilter) return false;
      if (changeClassFilter !== 'All' && cr.changeClass !== changeClassFilter.toLowerCase()) return false;
      if (statusFilter !== 'All' && cr.status !== statusFilter.toLowerCase()) return false;
      if (categoryFilter !== 'All' && cr.category !== categoryFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          cr.id.toLowerCase().includes(q) ||
          cr.title.toLowerCase().includes(q) ||
          cr.tenantName.toLowerCase().includes(q) ||
          cr.psaTicketId.toLowerCase().includes(q) ||
          cr.requestedBy.toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [changeRequests, tenantFilter, changeClassFilter, statusFilter, categoryFilter, searchQuery]);

  // Handlers
  const openWizard = () => {
    if (tenants && tenants.length > 0) {
      setNewCrTenantId(tenants[0].id);
    }
    setIsWizardOpen(true);
    setWizardStep(1);
  };

  const handleApproveCr = async (cr: ChangeRequest) => {
    try {
      const res = await fetchWithAuth(`/api/msp/change-requests/${cr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'scheduled',
          approvedBy: 'lead.architect@mspplatform.com',
        }),
      });

      if (res.ok) {
        onShowToast?.(
          'success',
          'Change Request Approved & Scheduled',
          `Approved ${cr.id} for tenant ${cr.tenantName}. Queued for maintenance window.`
        );
        loadChangeRequests();
      } else {
        onShowToast?.('error', 'Approval failed', 'Server returned error status');
      }
    } catch (e) {
      onShowToast?.('error', 'Approval error', 'Could not save approval');
    }

    onExecuteWorkflow?.('approve-change-request', {
      crId: cr.id,
      tenantId: cr.tenantId,
      scheduledFor: cr.scheduledFor,
    });
  };

  const handleRejectCr = async (cr: ChangeRequest) => {
    try {
      const res = await fetchWithAuth(`/api/msp/change-requests/${cr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
        }),
      });

      if (res.ok) {
        onShowToast?.('warning', 'Change Request Rejected', `Marked ${cr.id} as rejected.`);
        loadChangeRequests();
      } else {
        onShowToast?.('error', 'Rejection failed', 'Server returned error status');
      }
    } catch (e) {
      onShowToast?.('error', 'Rejection error', 'Could not save rejection');
    }

    onExecuteWorkflow?.('reject-change-request', {
      crId: cr.id,
      tenantId: cr.tenantId,
    });
  };

  const handleExecuteNow = async (cr: ChangeRequest) => {
    try {
      const res = await fetchWithAuth(`/api/msp/change-requests/${cr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          executedAt: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
          approvedBy: 'lead.architect@mspplatform.com',
        }),
      });

      if (res.ok) {
        onShowToast?.(
          'success',
          'Change Request Executed Live',
          `Pushed Graph API payload for ${cr.id} to ${cr.tenantName}. Pre-change snapshot archived.`
        );
        loadChangeRequests();
      } else {
        onShowToast?.('error', 'Execution failed', 'Server returned error status');
      }
    } catch (e) {
      onShowToast?.('error', 'Execution error', 'Could not save execution state');
    }

    onExecuteWorkflow?.('execute-m365-change-now', {
      crId: cr.id,
      tenantId: cr.tenantId,
      targetResource: cr.targetResource,
      payload: cr.proposedPayload,
    });
  };

  const handleExecuteRollback = async (cr: ChangeRequest) => {
    try {
      const res = await fetchWithAuth(`/api/msp/change-requests/${cr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rolled_back',
        }),
      });

      if (res.ok) {
        onShowToast?.(
          'warning',
          '1-Click Automated Rollback Dispatched',
          `Restored ${cr.tenantName} Graph API state to pre-change snapshot for ${cr.id}.`
        );
        loadChangeRequests();
      } else {
        onShowToast?.('error', 'Rollback failed', 'Server returned error status');
      }
    } catch (e) {
      onShowToast?.('error', 'Rollback error', 'Could not save rollback state');
    }

    onExecuteWorkflow?.('execute-1click-rollback', {
      crId: cr.id,
      tenantId: cr.tenantId,
      targetResource: cr.targetResource,
      preChangeSnapshot: cr.preChangeSnapshot,
    });
  };

  const handleCreateCr = async () => {
    const tenantObj = tenants.find((t) => t.id === newCrTenantId);
    const tenantName = tenantObj ? tenantObj.name : 'Contoso Corporation';
    const primaryDomain = tenantObj ? tenantObj.primaryDomain : 'contoso.onmicrosoft.com';

    let parsedPreJson = {};
    let parsedPropJson = {};
    try {
      parsedPreJson = JSON.parse(newCrPreJson);
      parsedPropJson = JSON.parse(newCrProposedJson);
    } catch (e) {
      // fallback
    }

    const payload = {
      tenantId: newCrTenantId,
      tenantName,
      primaryDomain,
      title: newCrTitle || 'Standard M365 Configuration Change',
      description: newCrDescription || 'Managed ITIL change request submitted via MSP SaaS Portal.',
      changeClass: newCrClass,
      riskLevel: newCrRisk,
      category: newCrCategory,
      targetResource: newCrResource,
      psaTicketId: newCrPsaTicket || 'HaloPSA #TK-99201',
      scheduledFor: newCrSchedule,
      impactedUsersCount: newCrImpactedUsers,
      preChangeSnapshot: parsedPreJson,
      proposedPayload: parsedPropJson,
      rollbackScriptSnippet: `PATCH ${newCrResource} -d @preChangeSnapshot.json`,
    };

    try {
      const res = await fetchWithAuth('/api/msp/change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        onShowToast?.(
          'success',
          'Change Request Submitted',
          `Created ${data.id} for ${tenantName}. Pre-change state snapshot verified.`
        );
        setIsWizardOpen(false);
        setWizardStep(1);
        loadChangeRequests();
        setSelectedCrId(data.id);
      } else {
        onShowToast?.('error', 'Submission failed', 'Server returned error status');
      }
    } catch (e) {
      onShowToast?.('error', 'Submission error', 'Could not create change request');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & CHANGE VELOCITY KPI BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center text-[#a3c9ff] shrink-0 font-mono">
              <GitPullRequest className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  ITIL Change Control & Automated Rollback Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-bold">
                  /portal/changes
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>ITIL v4 Change Enablement & Graph API Pre-State Backup Engine</span>
                <span>•</span>
                <span className="text-emerald-400 text-[11px] font-mono flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> 100% Pre-Change Snapshot Isolation Active
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                onShowToast?.(
                  'info',
                  'Schedule Refreshed',
                  'Synced upcoming maintenance windows with HaloPSA & ConnectWise Manage.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Maintenance Schedule</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'Change Audit Log PDF Exported',
                  'Exported complete SOC2 / ITIL Change Management Audit Register.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Export Audit Log PDF</span>
            </button>

            <button
              onClick={openWizard}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Submit New Change Request</span>
            </button>
          </div>

        </div>

        {/* Change Velocity KPI Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                PENDING APPROVALS
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {metrics.pendingCount} <span className="text-xs font-normal text-amber-400">CRs Awaiting Review</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Awaiting senior tech or client sign-off</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <GitPullRequest className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-[#0078d4]/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#0078d4]" />
                SCHEDULED MAINTENANCE
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                {metrics.scheduledCount} <span className="text-xs font-normal text-[#a3c9ff]">Queued Windows</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Approved changes for off-hours deploy</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Calendar className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-red-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-red-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                EMERGENCY CHANGES (24H)
              </div>
              <div className="text-xl font-bold font-mono text-red-200">
                {metrics.emergency24hCount} <span className="text-xs font-normal text-red-400">Emergency CRs</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">High-priority break-fix deployments</div>
            </div>
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                ROLLBACK PROTECTION RATE
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {metrics.rollbackRate}% <span className="text-xs font-normal text-emerald-400">Snapshot Verified</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Pre-change Graph JSON state backed up</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752] overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('active')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'active'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            <span>Active CR Register & Inspector</span>
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'calendar'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Maintenance Schedule ({changeRequests.filter((c) => c.status === 'scheduled').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('rollback')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'rollback'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            <span>Change History & Rollback Vault</span>
          </button>
        </div>

        {/* Multi-Filter Bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search CR ID, Title, UPN, Ticket..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
            />
          </div>

          {/* Tenant Selector */}
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Change Class */}
          <select
            value={changeClassFilter}
            onChange={(e) => setChangeClassFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Change Classes</option>
            <option value="standard">Standard (Low Risk)</option>
            <option value="normal">Normal (Med/High Risk)</option>
            <option value="emergency">Emergency (Critical)</option>
          </select>

          {/* Lifecycle Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="pending_approval">Awaiting Approval 🟡</option>
            <option value="scheduled">Scheduled 🔵</option>
            <option value="completed">Completed 🟢</option>
            <option value="rolled_back">Rolled Back ⏪</option>
            <option value="rejected">Rejected 🔴</option>
          </select>

          {/* Workload Category */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Workloads</option>
            <option value="ConditionalAccess">Conditional Access</option>
            <option value="Exchange">Exchange / Mail</option>
            <option value="Identity">Identity / Entra</option>
            <option value="Intune">Intune / Devices</option>
            <option value="Defender">Defender / Security</option>
          </select>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. CORE SUB-TABS CONTENT */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden relative flex">
        
        {/* TAB 1: ACTIVE CR REGISTER & INSPECTOR (60% / 40% SPLIT) */}
        {activeTab === 'active' && (
          <div className="w-full h-full flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
            
            {/* LEFT PANE (60% Width): Master CR Table */}
            <div className="w-full lg:w-[60%] border-b lg:border-b-0 lg:border-r border-[#404752] p-4 space-y-3 shrink-0 lg:shrink overflow-y-auto max-h-[500px] lg:max-h-none lg:h-full">
              <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
                <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                  <span>Master Change Control Queue ({filteredRequests.length})</span>
                  <span>Click row to view Proposed JSON Diff</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                        <th className="p-3">CR ID & Title</th>
                        <th className="p-3">Tenant</th>
                        <th className="p-3">Class & Risk</th>
                        <th className="p-3">Target M365 Entity</th>
                        <th className="p-3">Requested By</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                      {filteredRequests.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                            No Change Requests match the selected criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredRequests.map((cr) => {
                          const isSelected = cr.id === selectedCr.id;

                          return (
                            <tr
                              key={cr.id}
                              onClick={() => setSelectedCrId(cr.id)}
                              className={cn(
                                'hover:bg-[#272a30]/80 cursor-pointer transition-colors',
                                isSelected ? 'bg-[#0078d4]/15 border-l-4 border-l-[#0078d4]' : ''
                              )}
                            >
                              {/* CR ID & Title */}
                              <td className="p-3 font-sans">
                                <div className="font-bold text-[#e0e2ea] flex items-center gap-1.5">
                                  <span>{cr.title}</span>
                                </div>
                                <div className="text-[10px] font-mono text-[#a3c9ff] mt-0.5 flex items-center gap-2">
                                  <span>{cr.id}</span>
                                  <span>•</span>
                                  <span className="text-[#8a919e]">{cr.psaTicketId}</span>
                                </div>
                              </td>

                              {/* Tenant Name */}
                              <td className="p-3 font-sans whitespace-nowrap">
                                <div className="font-semibold text-[#e0e2ea]">{cr.tenantName}</div>
                                <div className="text-[10px] font-mono text-[#8a919e]">{cr.primaryDomain}</div>
                              </td>

                              {/* Class & Risk Badge */}
                              <td className="p-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                                      cr.changeClass === 'emergency'
                                        ? 'bg-red-950 text-red-300 border border-red-800'
                                        : cr.changeClass === 'normal'
                                        ? 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40'
                                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    )}
                                  >
                                    {cr.changeClass}
                                  </span>

                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-bold text-white',
                                      cr.riskLevel === 'critical'
                                        ? 'bg-red-600'
                                        : cr.riskLevel === 'high'
                                        ? 'bg-amber-600'
                                        : 'bg-emerald-700'
                                    )}
                                  >
                                    {cr.riskLevel.toUpperCase()}
                                  </span>
                                </div>
                              </td>

                              {/* Target Resource */}
                              <td className="p-3 max-w-[160px] truncate font-mono text-[11px] text-[#a3c9ff]">
                                {cr.targetResource}
                              </td>

                              {/* Requested By */}
                              <td className="p-3 text-[11px] font-sans whitespace-nowrap">
                                <div className="text-[#e0e2ea]">{cr.requestedBy.split('@')[0]}</div>
                                <div className="text-[10px] font-mono text-[#8a919e]">{cr.requestedAt.split(' ')[0]}</div>
                              </td>

                              {/* Status */}
                              <td className="p-3 whitespace-nowrap">
                                {cr.status === 'pending_approval' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 animate-pulse">
                                    PENDING 🟡
                                  </span>
                                ) : cr.status === 'scheduled' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                                    SCHEDULED 🔵
                                  </span>
                                ) : cr.status === 'completed' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                    COMPLETED 🟢
                                  </span>
                                ) : cr.status === 'rolled_back' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                                    ROLLED BACK ⏪
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#272a30] text-[#8a919e] border border-[#404752]">
                                    REJECTED 🔴
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
            </div>

            {/* RIGHT PANE (40% Width): Deep Change Inspector & JSON Diff */}
            <div className="w-full lg:w-[40%] h-full overflow-y-auto bg-[#101419] p-4 lg:p-5 space-y-5">
              
              {/* Header Actions */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3 shadow-md">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                      {selectedCr.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#272a30] text-[#a3c9ff] border border-[#404752]">
                      {selectedCr.psaTicketId}
                    </span>
                  </div>

                  {selectedCr.backupVerified && (
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> SNAPSHOT BACKED UP
                    </span>
                  )}
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#e0e2ea] leading-snug">
                    {selectedCr.title}
                  </h2>
                  <div className="text-xs text-[#8a919e] font-mono mt-1">
                    Target Tenant: <strong className="text-[#e0e2ea]">{selectedCr.tenantName}</strong> ({selectedCr.primaryDomain})
                  </div>
                </div>

                {/* Direct Approval Actions */}
                <div className="pt-2 border-t border-[#404752]/60 flex items-center gap-2 flex-wrap">
                  {selectedCr.status === 'pending_approval' && (
                    <>
                      <button
                        onClick={() => handleApproveCr(selectedCr)}
                        className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & Schedule</span>
                      </button>

                      <button
                        onClick={() => handleRejectCr(selectedCr)}
                        className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-red-300 border border-red-800 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        <span>Reject CR</span>
                      </button>
                    </>
                  )}

                  {selectedCr.status === 'scheduled' && (
                    <button
                      onClick={() => handleExecuteNow(selectedCr)}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Execute Change Live Now</span>
                    </button>
                  )}

                  {selectedCr.status === 'completed' && (
                    <button
                      onClick={() => handleExecuteRollback(selectedCr)}
                      className="px-3 py-1.5 bg-purple-900 hover:bg-purple-800 text-purple-200 border border-purple-600 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-purple-300" />
                      <span>1-Click Rollback to Pre-State</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Section A: Justification & Business Impact */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <FileText className="w-4 h-4 text-[#0078d4]" />
                  <span>Section A: Justification & Business Impact</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block">Description & Scope:</label>
                    <p className="text-[#e0e2ea] bg-[#101419] p-2.5 rounded border border-[#404752] mt-0.5 leading-relaxed text-[11px]">
                      {selectedCr.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-[#101419] p-2 rounded border border-[#404752]">
                      <div className="text-[10px] text-[#8a919e]">Target Graph Endpoint</div>
                      <div className="text-[#a3c9ff] truncate mt-0.5">{selectedCr.targetResource}</div>
                    </div>
                    <div className="bg-[#101419] p-2 rounded border border-[#404752]">
                      <div className="text-[10px] text-[#8a919e]">Affected Accounts</div>
                      <div className="text-amber-300 font-bold mt-0.5">{selectedCr.impactedUsersCount} Users</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-[#101419] p-2 rounded border border-[#404752]">
                      <div className="text-[10px] text-[#8a919e]">Scheduled Window</div>
                      <div className="text-[#e0e2ea] font-semibold mt-0.5">{selectedCr.scheduledFor}</div>
                    </div>
                    <div className="bg-[#101419] p-2 rounded border border-[#404752]">
                      <div className="text-[10px] text-[#8a919e]">PSA Reference</div>
                      <div className="text-[#a3c9ff] font-semibold mt-0.5">{selectedCr.psaTicketId}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section B: Proposed State Diff (Before vs After JSON) */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between border-b border-[#404752] pb-2">
                  <div className="flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-emerald-400" />
                    <span>Section B: Proposed State JSON Diff</span>
                  </div>
                  <span className="text-[10px] text-[#8a919e]">Graph API Payload</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  {/* Before / Pre-Change Snapshot */}
                  <div>
                    <div className="text-[10px] text-red-300 font-bold mb-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> PRE-CHANGE SNAPSHOT
                    </div>
                    <pre className="bg-[#101419] border border-red-900/50 text-red-200 p-2.5 rounded text-[10px] h-[180px] overflow-auto whitespace-pre">
                      {JSON.stringify(selectedCr.preChangeSnapshot, null, 2)}
                    </pre>
                  </div>

                  {/* After / Proposed Payload */}
                  <div>
                    <div className="text-[10px] text-emerald-400 font-bold mb-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> PROPOSED TARGET STATE
                    </div>
                    <pre className="bg-[#101419] border border-emerald-900/50 text-emerald-200 p-2.5 rounded text-[10px] h-[180px] overflow-auto whitespace-pre">
                      {JSON.stringify(selectedCr.proposedPayload, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Section C: Rollback Strategy & Pre-State Backup */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <RotateCcw className="w-4 h-4 text-purple-400" />
                  <span>Section C: Automated Rollback Script & Hash</span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-[#8a919e] uppercase block">State Snapshot Integrity Hash:</label>
                    <div className="text-[11px] text-[#a3c9ff] bg-[#101419] p-2 rounded border border-[#404752] truncate">
                      {selectedCr.backupHash}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-[#8a919e] uppercase block">Automated Rollback Command Payload:</label>
                    <div className="text-[11px] text-purple-300 bg-[#101419] p-2 rounded border border-purple-900/60 font-mono">
                      {selectedCr.rollbackScriptSnippet}
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: MAINTENANCE CALENDAR & EXECUTION SCHEDULE */}
        {activeTab === 'calendar' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-6">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#404752] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-[#e0e2ea] flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#0078d4]" />
                    Scheduled Maintenance Window Queue
                  </h2>
                  <p className="text-xs text-[#8a919e] mt-0.5">
                    Off-hours deployment timeline across managed M365 tenant environments.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold px-2.5 py-1 bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 rounded">
                  {changeRequests.filter((c) => c.status === 'scheduled').length} Scheduled
                </span>
              </div>

              <div className="space-y-3">
                {changeRequests.filter((c) => c.status === 'scheduled' || c.status === 'pending_approval').length === 0 ? (
                  <div className="p-8 text-center text-[#8a919e]">No maintenance windows scheduled.</div>
                ) : (
                  changeRequests
                    .filter((c) => c.status === 'scheduled' || c.status === 'pending_approval')
                    .map((cr) => (
                      <div
                        key={cr.id}
                        className="bg-[#101419] border border-[#404752] p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-[#0078d4]/60 transition-all"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-amber-400">{cr.id}</span>
                            <span className="text-xs font-semibold text-[#e0e2ea]">{cr.title}</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#272a30] text-[#a3c9ff]">
                              {cr.tenantName}
                            </span>
                          </div>

                          <div className="text-xs text-[#8a919e] flex items-center gap-3">
                            <span className="flex items-center gap-1 text-[#e0e2ea] font-mono">
                              <Clock className="w-3.5 h-3.5 text-[#0078d4]" /> {cr.scheduledFor}
                            </span>
                            <span>•</span>
                            <span>Target: {cr.targetResource}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {cr.status === 'scheduled' ? (
                            <button
                              onClick={() => handleExecuteNow(cr)}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold cursor-pointer transition-all shadow-sm flex items-center gap-1"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Execute Change Now</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleApproveCr(cr)}
                              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold cursor-pointer transition-all shadow-sm flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve & Lock Window</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: CHANGE HISTORY, PIR & ROLLBACK VAULT */}
        {activeTab === 'rollback' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-6">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#404752] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-[#e0e2ea] flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-purple-400" />
                    Completed Production Changes & 1-Click Rollback Vault
                  </h2>
                  <p className="text-xs text-[#8a919e] mt-0.5">
                    Historical record of applied M365 changes. Click Rollback to restore pre-change state snapshot.
                  </p>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                {changeRequests.filter((c) => c.status === 'completed' || c.status === 'rolled_back').length === 0 ? (
                  <div className="p-8 text-center text-[#8a919e]">No completed changes in history vault.</div>
                ) : (
                  changeRequests
                    .filter((c) => c.status === 'completed' || c.status === 'rolled_back')
                    .map((cr) => (
                      <div
                        key={cr.id}
                        className="bg-[#101419] border border-[#404752] p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#a3c9ff]">{cr.id}</span>
                            <span className="font-semibold text-[#e0e2ea] font-sans">{cr.title}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#272a30] text-[#e0e2ea] font-sans">
                              {cr.tenantName}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#8a919e] flex items-center gap-3">
                            <span>Executed At: {cr.executedAt || '2026-07-22 UTC'}</span>
                            <span>•</span>
                            <span>Backup Hash: {cr.backupHash.substring(0, 20)}...</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {cr.status === 'completed' ? (
                            <button
                              onClick={() => handleExecuteRollback(cr)}
                              className="px-3 py-1.5 bg-purple-900 hover:bg-purple-800 text-purple-100 border border-purple-600 rounded text-xs font-bold cursor-pointer transition-all shadow-sm flex items-center gap-1.5"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-purple-300" />
                              <span>⏪ Execute 1-Click Rollback</span>
                            </button>
                          ) : (
                            <span className="px-3 py-1 rounded text-xs font-bold bg-purple-950 text-purple-300 border border-purple-800">
                              STATE RESTORED (ROLLED BACK)
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. INTERACTIVE CHANGE REQUEST CREATION WIZARD MODAL */}
      {/* ========================================================================= */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitPullRequest className="w-5 h-5 text-[#0078d4]" />
                <h3 className="font-bold text-sm text-[#e0e2ea]">
                  Submit ITIL Change Request (CR) — Step {wizardStep} of 4
                </h3>
              </div>
              <button
                onClick={() => setIsWizardOpen(false)}
                className="text-[#8a919e] hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Wizard Step Progress Indicator */}
            <div className="bg-[#101419] border-b border-[#404752] px-6 py-2 grid grid-cols-4 gap-2 text-center text-xs font-mono">
              <div
                className={cn(
                  'py-1 rounded border',
                  wizardStep === 1
                    ? 'bg-[#0078d4]/20 border-[#0078d4] text-[#a3c9ff] font-bold'
                    : wizardStep > 1
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                    : 'bg-[#272a30] border-[#404752] text-[#8a919e]'
                )}
              >
                1. Target
              </div>
              <div
                className={cn(
                  'py-1 rounded border',
                  wizardStep === 2
                    ? 'bg-[#0078d4]/20 border-[#0078d4] text-[#a3c9ff] font-bold'
                    : wizardStep > 2
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                    : 'bg-[#272a30] border-[#404752] text-[#8a919e]'
                )}
              >
                2. Payload JSON
              </div>
              <div
                className={cn(
                  'py-1 rounded border',
                  wizardStep === 3
                    ? 'bg-[#0078d4]/20 border-[#0078d4] text-[#a3c9ff] font-bold'
                    : wizardStep > 3
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                    : 'bg-[#272a30] border-[#404752] text-[#8a919e]'
                )}
              >
                3. Risk Score
              </div>
              <div
                className={cn(
                  'py-1 rounded border',
                  wizardStep === 4
                    ? 'bg-[#0078d4]/20 border-[#0078d4] text-[#a3c9ff] font-bold'
                    : 'bg-[#272a30] border-[#404752] text-[#8a919e]'
                )}
              >
                4. Schedule
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
              
              {/* STEP 1: TARGET SELECTION */}
              {wizardStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Target Client Tenant:</label>
                    <select
                      value={newCrTenantId}
                      onChange={(e) => setNewCrTenantId(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none focus:border-[#0078d4]"
                    >
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Change Request Title:</label>
                    <input
                      type="text"
                      placeholder="e.g. Enforce Conditional Access Device Compliance"
                      value={newCrTitle}
                      onChange={(e) => setNewCrTitle(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Target Graph Endpoint Resource:</label>
                    <input
                      type="text"
                      value={newCrResource}
                      onChange={(e) => setNewCrResource(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none font-mono focus:border-[#0078d4]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">PSA Ticket ID:</label>
                    <input
                      type="text"
                      value={newCrPsaTicket}
                      onChange={(e) => setNewCrPsaTicket(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none font-mono focus:border-[#0078d4]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: DEFINE PAYLOAD JSON */}
              {wizardStep === 2 && (
                <div className="space-y-3 font-mono">
                  <div>
                    <label className="text-xs font-bold text-red-300 block mb-1">
                      Pre-Change State JSON (Snapshot):
                    </label>
                    <textarea
                      rows={5}
                      value={newCrPreJson}
                      onChange={(e) => setNewCrPreJson(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-red-200 p-2 rounded outline-none focus:border-[#0078d4] text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-emerald-400 block mb-1">
                      Proposed Target State JSON Payload:
                    </label>
                    <textarea
                      rows={5}
                      value={newCrProposedJson}
                      onChange={(e) => setNewCrProposedJson(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-emerald-200 p-2 rounded outline-none focus:border-[#0078d4] text-[11px]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: RISK ASSESSMENT MATRIX */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-[#e0e2ea] block mb-1">ITIL Change Class:</label>
                      <select
                        value={newCrClass}
                        onChange={(e) => setNewCrClass(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none focus:border-[#0078d4]"
                      >
                        <option value="standard">Standard (Pre-approved / Low Risk)</option>
                        <option value="normal">Normal (Requires CAB / High Impact)</option>
                        <option value="emergency">Emergency (Break-Fix / Critical)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Calculated Risk Level:</label>
                      <select
                        value={newCrRisk}
                        onChange={(e) => setNewCrRisk(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none focus:border-[#0078d4]"
                      >
                        <option value="low">Low Risk</option>
                        <option value="medium">Medium Risk</option>
                        <option value="high">High Risk</option>
                        <option value="critical">Critical Risk</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Affected Account Count:</label>
                    <input
                      type="number"
                      value={newCrImpactedUsers}
                      onChange={(e) => setNewCrImpactedUsers(Number(e.target.value))}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none font-mono focus:border-[#0078d4]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: SCHEDULE SETUP */}
              {wizardStep === 4 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-[#e0e2ea] block mb-1">Target Maintenance Window:</label>
                    <input
                      type="text"
                      value={newCrSchedule}
                      onChange={(e) => setNewCrSchedule(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded outline-none font-mono focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded text-emerald-300 text-xs">
                    <p className="font-bold">Pre-Change Graph State Backup Notice:</p>
                    <p className="mt-1 text-[11px] text-emerald-200">
                      Submitting this Change Request will automatically execute a live Graph API GET scan on {newCrResource} and archive the SHA256 hashed JSON state snapshot in the Rollback Vault.
                    </p>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-[#101419] border-t border-[#404752] flex items-center justify-between">
              {wizardStep > 1 ? (
                <button
                  onClick={() => setWizardStep((prev) => (prev - 1) as any)}
                  className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold cursor-pointer"
                >
                  Previous
                </button>
              ) : (
                <div />
              )}

              {wizardStep < 4 ? (
                <button
                  onClick={() => setWizardStep((prev) => (prev + 1) as any)}
                  className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold cursor-pointer"
                >
                  Next Step ➔
                </button>
              ) : (
                <button
                  onClick={handleCreateCr}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold cursor-pointer shadow"
                >
                  Submit CR & Snapshot State
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

