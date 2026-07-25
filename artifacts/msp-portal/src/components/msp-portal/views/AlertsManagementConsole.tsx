import React, { useState, useMemo } from 'react';
import {
  Bell,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Flame,
  Zap,
  Clock,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  ExternalLink,
  FileText,
  Code2,
  CheckSquare,
  Layers,
  MoreVertical,
  VolumeX,
  Ticket,
  Lock,
  Unlock,
  Building2,
  X,
  ChevronRight,
  Copy,
  Download,
  ShieldCheck,
  Globe,
  User,
  ArrowRight,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Info,
  Send,
  AlertCircle,
  HelpCircle,
  Eye,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';
import {
  SlaTimerPill,
  AiRemediationCopilot,
  CommercialUpsellBanner,
  ChangeControlGateModal,
  RbdAcceptanceAndRuleLinker,
  EmbeddedSopRunner,
  ScopeCreepAlertBanner,
  AlertResolutionWizardModal
} from '../common';

export interface MonitoringAlert {
  id: string; // e.g. 'ALT-88392'
  timestamp: string;
  relativeTime: string;
  tenantId: string;
  tenantName: string;
  title: string;
  description: string;
  category: 'Identity' | 'Exchange' | 'ConditionalAccess' | 'Intune' | 'Defender' | 'Licensing';
  severity: 'critical' | 'high' | 'warning' | 'info';
  targetResource: string;
  targetRole?: string;
  targetIp?: string;
  status: 'active' | 'pending_approval' | 'resolved' | 'muted';
  graphEndpoint: string;
  remediationActionId: string;
  remediationActionName: string;
  safetyLevel: 'safe' | 'gated';
  baselineExpected: string;
  detectedDrift: string;
  rawPayload: Record<string, any>;
}

interface AlertsManagementConsoleProps {
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

// 10+ Realistic M365 Security & Policy Drift Alerts
const INITIAL_ALERTS: MonitoringAlert[] = [
  {
    id: 'ALT-88392',
    timestamp: '2026-07-23 22:42:01 UTC',
    relativeTime: '3m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Global Administrator MFA Enforcement Disabled',
    description: 'Conditional Access policy CA-01-RequireMFA-ForAdmins was disabled or converted to report-only mode by an unmonitored admin session.',
    category: 'ConditionalAccess',
    severity: 'critical',
    targetResource: 'tech.lead@contoso.com',
    targetRole: 'Global Administrator',
    targetIp: '192.168.1.104',
    status: 'active',
    graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies/ca-01-mfa-admins',
    remediationActionId: 'ca-re-enforce-mfa',
    remediationActionName: 'Re-Enforce MFA Policy Immediately',
    safetyLevel: 'safe',
    baselineExpected: 'state: enabled (enforced with RequireMFA grant control)',
    detectedDrift: 'state: disabled (or reportOnly)',
    rawPayload: {
      alertId: 'ALT-88392',
      policyId: 'ca-01-mfa-admins',
      policyName: 'CA-01-RequireMFA-ForAdmins',
      state: 'disabled',
      grantControls: { builtInControls: ['mfa'] },
      modifiedBy: 'tech.lead@contoso.com',
      modifiedDateTime: '2026-07-23T22:42:01Z',
    },
  },
  {
    id: 'ALT-88391',
    timestamp: '2026-07-23 22:28:15 UTC',
    relativeTime: '17m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'External Mailbox Auto-Forwarding Rule Created',
    description: 'An inbox rule was generated forwarding incoming executive emails to an unverified external Gmail domain.',
    category: 'Exchange',
    severity: 'critical',
    targetResource: 'cfo.office@contoso.com',
    targetRole: 'Executive Mailbox',
    targetIp: '185.220.101.5 (Tor Exit Node)',
    status: 'active',
    graphEndpoint: 'GET /v1.0/users/cfo.office@contoso.com/mailFolders/inbox/messageRules',
    remediationActionId: 'ex-delete-forward-rule',
    remediationActionName: 'Purge Forwarding Rule & Revoke Sessions',
    safetyLevel: 'gated',
    baselineExpected: 'forwardTo: [] (no external redirect rules allowed)',
    detectedDrift: 'forwardTo: [{ name: "Audit Backup", email: "ex-audit-2026@gmail.com" }]',
    rawPayload: {
      alertId: 'ALT-88391',
      ruleId: 'rule-fwd-99120',
      displayName: 'Forward to External Audit',
      actions: { forwardTo: [{ emailAddress: { address: 'ex-audit-2026@gmail.com' } }] },
    },
  },
  {
    id: 'ALT-88390',
    timestamp: '2026-07-23 22:15:30 UTC',
    relativeTime: '30m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'High-Risk Impossible Travel Sign-In Detected',
    description: 'User authenticated from Frankfurt, DE and Chicago, US within a 12-minute interval.',
    category: 'Identity',
    severity: 'high',
    targetResource: 'alex.b@contoso.com',
    targetRole: 'Sales Director',
    targetIp: '185.220.101.5 / 192.168.1.42',
    status: 'active',
    graphEndpoint: 'GET /v1.0/identityProtection/riskyUsers/alex.b-guid',
    remediationActionId: 'id-revoke-user-sessions',
    remediationActionName: 'Revoke User Sign-In Sessions & Force Reset',
    safetyLevel: 'gated',
    baselineExpected: 'riskState: atRisk = false (Clean session telemetry)',
    detectedDrift: 'riskLevel: high, riskDetail: impossibleTravel',
    rawPayload: {
      alertId: 'ALT-88390',
      userPrincipalName: 'alex.b@contoso.com',
      riskLevel: 'high',
      riskEventType: 'impossibleTravel',
      locations: ['Frankfurt, DE', 'Chicago, IL, US'],
    },
  },
  {
    id: 'ALT-88389',
    timestamp: '2026-07-23 21:50:00 UTC',
    relativeTime: '55m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Intune Device Compliance Policy Drift',
    description: 'Windows 11 endpoint FIN-LAP-8810 disabled BitLocker encryption and secure boot.',
    category: 'Intune',
    severity: 'warning',
    targetResource: 'FIN-LAP-8810 (Windows 11 Enterprise)',
    targetRole: 'Finance Workstation',
    targetIp: '10.0.4.19',
    status: 'pending_approval',
    graphEndpoint: 'GET /v1.0/deviceManagement/managedDevices/dev-fin-lap-8810',
    remediationActionId: 'in-remediate-bitlocker',
    remediationActionName: 'Push BitLocker Re-Encryption Task',
    safetyLevel: 'safe',
    baselineExpected: 'isEncrypted: true, compliantState: compliant',
    detectedDrift: 'isEncrypted: false, compliantState: noncompliant',
    rawPayload: {
      alertId: 'ALT-88389',
      deviceName: 'FIN-LAP-8810',
      complianceState: 'noncompliant',
      failingRules: ['BitLockerRequired', 'SecureBootEnabled'],
    },
  },
  {
    id: 'ALT-88388',
    timestamp: '2026-07-23 21:10:44 UTC',
    relativeTime: '1h 35m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Unassigned M365 E5 Paid License Waste Detected',
    description: '14 M365 E5 licenses ($57/mo each) have been unassigned for over 45 consecutive days.',
    category: 'Licensing',
    severity: 'info',
    targetResource: 'Tenant Subscriptions (M365 E5 Plan)',
    targetRole: 'CSP Licensing Pool',
    targetIp: 'Graph Subscriptions API',
    status: 'active',
    graphEndpoint: 'GET /v1.0/subscribedSkus/m365-e5-sku-guid',
    remediationActionId: 'lic-reclaim-unassigned',
    remediationActionName: 'Autoscale Down NCE License Quantity',
    safetyLevel: 'safe',
    baselineExpected: 'unassignedLicenses: <= 2 (minimal buffer)',
    detectedDrift: 'unassignedLicenses: 14 ($798/mo unnecessary spending)',
    rawPayload: {
      alertId: 'ALT-88388',
      skuPartNumber: 'SPE_E5',
      totalLicenses: 120,
      assignedLicenses: 106,
      unassignedLicenses: 14,
      monthlyWasteUsd: 798.0,
    },
  },
  {
    id: 'ALT-88387',
    timestamp: '2026-07-23 20:30:00 UTC',
    relativeTime: '2h 15m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Defender Anti-Phishing Strict Mode Disabled',
    description: 'Anti-phishing impersonation threshold set back to Standard from Aggressive.',
    category: 'Defender',
    severity: 'warning',
    targetResource: 'Default Anti-Phishing Policy',
    targetRole: 'Exchange Transport Guard',
    targetIp: 'Defender Security Center',
    status: 'resolved',
    graphEndpoint: 'GET /v1.0/security/antiPhishPolicies/default-policy',
    remediationActionId: 'def-enforce-strict-phish',
    remediationActionName: 'Restore Aggressive Phishing Threshold',
    safetyLevel: 'safe',
    baselineExpected: 'phishThresholdLevel: 4 (Aggressive)',
    detectedDrift: 'phishThresholdLevel: 2 (Standard)',
    rawPayload: {
      alertId: 'ALT-88387',
      policyName: 'Default Anti-Phishing Policy',
      phishThresholdLevel: 2,
    },
  },
  {
    id: 'ALT-88386',
    timestamp: '2026-07-23 19:45:12 UTC',
    relativeTime: '3h 00m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Stale External Guest Account Activity',
    description: 'Guest account vendor.mark@external-partner.com inactive for 180+ days with active SharePoint links.',
    category: 'Identity',
    severity: 'warning',
    targetResource: 'vendor.mark@external-partner.com',
    targetRole: 'External Guest User',
    targetIp: 'Guest Identity Store',
    status: 'active',
    graphEndpoint: 'GET /v1.0/users/guest-vendor-mark-guid',
    remediationActionId: 'id-disable-stale-guest',
    remediationActionName: 'Disable Stale Guest Account & Revoke Links',
    safetyLevel: 'safe',
    baselineExpected: 'lastSignInDateTime: <= 90 days',
    detectedDrift: 'lastSignInDateTime: 184 days ago',
    rawPayload: {
      alertId: 'ALT-88386',
      userPrincipalName: 'vendor.mark@external-partner.com',
      accountEnabled: true,
      daysInactive: 184,
    },
  },
  {
    id: 'ALT-88385',
    timestamp: '2026-07-23 18:20:00 UTC',
    relativeTime: '4h 25m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Legacy Authentication Protocol Attempt',
    description: 'Blocked 242 IMAP4 authentication attempts targeting executive accounts.',
    category: 'Identity',
    severity: 'high',
    targetResource: 'Exec-Group-Mailboxes',
    targetRole: 'Authentication Endpoint',
    targetIp: '198.51.100.88',
    status: 'resolved',
    graphEndpoint: 'GET /v1.0/auditLogs/signIns?$filter=clientAppUsed eq IMAP4',
    remediationActionId: 'ca-block-legacy-auth',
    remediationActionName: 'Enforce Global Legacy Auth Block Policy',
    safetyLevel: 'safe',
    baselineExpected: 'legacyAuthBlocked: true',
    detectedDrift: 'IMAP4 connections allowed on tenant port 993',
    rawPayload: {
      alertId: 'ALT-88385',
      protocol: 'IMAP4',
      failedAttempts: 242,
    },
  },
  {
    id: 'ALT-88384',
    timestamp: '2026-07-23 17:00:10 UTC',
    relativeTime: '5h 45m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Anonymous SharePoint Link Expiration Bypass',
    description: 'Anonymous file sharing link created without mandatory 30-day expiration date.',
    category: 'Exchange',
    severity: 'warning',
    targetResource: '/sites/Finance/Documents/Q2-Forecast.xlsx',
    targetRole: 'SharePoint Document',
    targetIp: 'SharePoint Web API',
    status: 'active',
    graphEndpoint: 'GET /v1.0/sites/site-fin-guid/drive/items/item-q2-forecast',
    remediationActionId: 'sp-expire-anonymous-links',
    remediationActionName: 'Force 14-Day Expiration on Link',
    safetyLevel: 'safe',
    baselineExpected: 'linkExpiration: <= 30 days mandatory',
    detectedDrift: 'expirationDateTime: null (Never expires)',
    rawPayload: {
      alertId: 'ALT-88384',
      itemPath: '/sites/Finance/Documents/Q2-Forecast.xlsx',
      linkScope: 'anonymous',
      expirationDateTime: null,
    },
  },
  {
    id: 'ALT-88383',
    timestamp: '2026-07-23 15:30:00 UTC',
    relativeTime: '7h 15m ago',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Unconsented Third-Party Enterprise App Grant',
    description: 'App "Marketing Metrics Sync" granted Directory.Read.All without admin approval.',
    category: 'Identity',
    severity: 'high',
    targetResource: 'App: Marketing Metrics Sync',
    targetRole: 'Enterprise Service Principal',
    targetIp: 'OAuth Grant Endpoint',
    status: 'muted',
    graphEndpoint: 'GET /v1.0/oauth2PermissionGrants/grant-mktg-metrics',
    remediationActionId: 'id-revoke-oauth-grant',
    remediationActionName: 'Revoke App OAuth Permission Grant',
    safetyLevel: 'gated',
    baselineExpected: 'adminConsentRequired: true for Directory.Read.All',
    detectedDrift: 'consentType: Principal (User self-consented)',
    rawPayload: {
      alertId: 'ALT-88383',
      appDisplayName: 'Marketing Metrics Sync',
      scope: 'Directory.Read.All Contacts.Read',
    },
  },
];

export const AlertsManagementConsole: React.FC<AlertsManagementConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => {
    if (onShowToast) {
      onShowToast(type, title, description);
    }
  };

  // State
  const [alerts, setAlerts] = useState<MonitoringAlert[]>(INITIAL_ALERTS);
  const [selectedAlertId, setSelectedAlertId] = useState<string>('ALT-88392');
  const [selectedAlertIdsForBulk, setSelectedAlertIdsForBulk] = useState<string[]>([]);
  
  const [inspectorTab, setInspectorTab] = useState<'triage' | 'json'>('triage');
  const [isMutedAll, setIsMutedAll] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isRbdModalOpen, setIsRbdModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeWizardAlert, setActiveWizardAlert] = useState<MonitoringAlert | null>(null);

  const handleOpenWizard = (alertToInspect?: MonitoringAlert) => {
    const target = alertToInspect || selectedAlert;
    if (target) {
      setActiveWizardAlert(target);
      setIsWizardOpen(true);
    }
  };

  const handleConfirmRbd = (record: { rbdCode: string; clientUpn: string; justification: string }) => {
    if (!selectedAlert) return;
    setAlerts(prev => prev.map(a => a.id === selectedAlert.id ? {
      ...a,
      status: 'resolved',
      remediationActionName: `Covered by Linked ${record.rbdCode}`
    } : a));
    setIsRbdModalOpen(false);
    toast('success', 'RBD Waiver Logged & Rule Linked', `Alert ${selectedAlert.id} tagged as COVERED_BY_ACTIVE_RBD (${record.rbdCode}). Future alerts suppressed.`);
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('All Severities');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All Statuses');
  const [cardFilter, setCardFilter] = useState<'all' | 'critical' | 'warnings' | 'autoHealed' | 'pending'>('all');

  // Safety Confirmation Modal
  const [pendingGatedAction, setPendingGatedAction] = useState<{
    alert: MonitoringAlert;
    actionId: string;
    actionName: string;
  } | null>(null);
  const [psaReasonInput, setPsaReasonInput] = useState<string>('PSA-99412 - Urgent Remediation Required');

  // Active Tenant
  const activeTenant = useMemo(() => {
    return (
      selectedTenant ||
      tenants[0] || { id: 'contoso-01', name: 'Contoso Corporation', primaryDomain: 'contoso.onmicrosoft.com' }
    );
  }, [selectedTenant, tenants]);

  // Selected Alert for Right Inspector
  const selectedAlert = useMemo(() => {
    return alerts.find((a) => a.id === selectedAlertId) || alerts[0];
  }, [alerts, selectedAlertId]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const critical = alerts.filter((a) => a.severity === 'critical' && a.status === 'active').length;
    const warnings = alerts.filter((a) => (a.severity === 'warning' || a.severity === 'high') && a.status === 'active').length;
    const autoHealed = 112; // Static counter for auto-remediated
    const pending = alerts.filter((a) => a.status === 'pending_approval').length;

    return { critical, warnings, autoHealed, pending };
  }, [alerts]);

  // Filtered Alerts List
  const filteredAlerts = useMemo(() => {
    return alerts.filter((item) => {
      // Muted All check
      if (isMutedAll && item.severity !== 'critical') return false;

      // Card Filter take priority if selected
      if (cardFilter === 'critical') {
        if (item.severity !== 'critical' || item.status !== 'active') return false;
      } else if (cardFilter === 'warnings') {
        if ((item.severity !== 'warning' && item.severity !== 'high') || item.status !== 'active') return false;
      } else if (cardFilter === 'autoHealed') {
        if (item.status !== 'resolved') return false;
      } else if (cardFilter === 'pending') {
        if (item.status !== 'pending_approval') return false;
      }

      // Severity Filter
      if (selectedSeverity !== 'All Severities' && item.severity !== selectedSeverity.toLowerCase()) {
        return false;
      }

      // Category Filter
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }

      // Status Filter
      if (selectedStatus === 'Active' && item.status !== 'active') return false;
      if (selectedStatus === 'Pending Approval' && item.status !== 'pending_approval') return false;
      if (selectedStatus === 'Resolved' && item.status !== 'resolved') return false;
      if (selectedStatus === 'Muted' && item.status !== 'muted') return false;

      // Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesTarget = item.targetResource.toLowerCase().includes(q);
        const matchesEndpoint = item.graphEndpoint.toLowerCase().includes(q);

        return matchesTitle || matchesId || matchesTarget || matchesEndpoint;
      }

      return true;
    });
  }, [alerts, isMutedAll, cardFilter, selectedSeverity, selectedCategory, selectedStatus, searchQuery]);

  // Bulk Selection Toggles
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedAlertIdsForBulk(filteredAlerts.map((a) => a.id));
    } else {
      setSelectedAlertIdsForBulk([]);
    }
  };

  const handleToggleSingleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedAlertIdsForBulk.includes(id)) {
      setSelectedAlertIdsForBulk(selectedAlertIdsForBulk.filter((i) => i !== id));
    } else {
      setSelectedAlertIdsForBulk([...selectedAlertIdsForBulk, id]);
    }
  };

  // Execute Remediation Action
  const handleRemediateAlert = (alert: MonitoringAlert) => {
    if (alert.safetyLevel === 'gated') {
      // Open Gated Action Modal
      setPendingGatedAction({
        alert,
        actionId: alert.remediationActionId,
        actionName: alert.remediationActionName,
      });
      return;
    }

    // Direct Safe Remediation Execution
    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, status: 'resolved' } : a))
    );

    onExecuteWorkflow?.(alert.remediationActionId, { tenantId: alert.tenantId, alertId: alert.id });
    onShowToast?.(
      'success',
      'Remediation Dispatched',
      `Executed "${alert.remediationActionName}" for ${alert.targetResource}. Alert resolved.`
    );
  };

  // Confirm Gated Action
  const handleConfirmGatedAction = () => {
    if (!pendingGatedAction) return;

    const { alert, actionId, actionName } = pendingGatedAction;

    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, status: 'resolved' } : a))
    );

    onExecuteWorkflow?.(actionId, {
      tenantId: alert.tenantId,
      alertId: alert.id,
      psaTicket: psaReasonInput,
    });

    onShowToast?.(
      'success',
      'Gated Remediation Executed',
      `Dual-key approved: ${actionName}. Dispatched workflow for ${alert.targetResource}.`
    );

    setPendingGatedAction(null);
  };

  // Bulk Actions
  const handleBulkRemediate = () => {
    setAlerts((prev) =>
      prev.map((a) => (selectedAlertIdsForBulk.includes(a.id) ? { ...a, status: 'resolved' } : a))
    );
    onShowToast?.(
      'success',
      'Bulk Remediation Complete',
      `Resolved ${selectedAlertIdsForBulk.length} selected monitoring alerts across customer tenant.`
    );
    setSelectedAlertIdsForBulk([]);
  };

  const handleBulkMute = () => {
    setAlerts((prev) =>
      prev.map((a) => (selectedAlertIdsForBulk.includes(a.id) ? { ...a, status: 'muted' } : a))
    );
    onShowToast?.('info', 'Alerts Muted', `Muted ${selectedAlertIdsForBulk.length} alerts.`);
    setSelectedAlertIdsForBulk([]);
  };

  // Live Refresh
  const handlePollGraphAlerts = () => {
    setIsPolling(true);
    onShowToast?.('info', 'Polling Graph Alert Engine', 'Checking 122+ Graph API endpoints for policy drifts...');
    setTimeout(() => {
      setIsPolling(false);
      onShowToast?.('success', 'Alert Stream Updated', 'All Graph endpoint telemetry refreshed. 1 new critical alert checked.');
    }, 1000);
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & ALERT SEVERITY ROLLUP BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-red-950/80 border border-red-700 flex items-center justify-center text-red-400 shrink-0 font-mono">
              <Bell className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  Graph API Real-Time Monitoring & Threat Alerts
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800 font-bold">
                  /portal/alerts
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>Tenant Focus:</span>
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

                <span className="text-[#4ade80] text-[11px] font-mono flex items-center gap-1 ml-2">
                  <CheckCircle2 className="w-3 h-3" /> 122 Endpoints Polling (5m Interval)
                </span>
              </div>
            </div>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePollGraphAlerts}
              disabled={isPolling}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>{isPolling ? 'Polling Alerts...' : 'Poll Graph (5m)'}</span>
            </button>

            {/* Mute Non-Critical Toggle */}
            <button
              onClick={() => {
                setIsMutedAll(!isMutedAll);
                onShowToast?.('info', 'Notification Preference', isMutedAll ? 'Unmuted non-critical alerts.' : 'Muted all non-critical notifications.');
              }}
              className={cn(
                'px-3 py-1.5 border rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all',
                isMutedAll
                  ? 'bg-amber-950/80 text-amber-200 border-amber-700'
                  : 'bg-[#272a30] text-[#a3c9ff] border-[#404752] hover:bg-[#31353b]'
              )}
            >
              <VolumeX className="w-3.5 h-3.5" />
              <span>{isMutedAll ? 'Non-Critical Muted' : 'Mute Non-Critical'}</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.('success', 'Audit Report Exported', `Exported full tenant threat audit report for ${activeTenant.name}.`);
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Audit Report</span>
            </button>
          </div>

        </div>

        {/* Real-Time Alert Metrics KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div
            onClick={() => {
              if (cardFilter === 'critical') {
                setCardFilter('all');
                setSelectedSeverity('All Severities');
                setSelectedStatus('All Statuses');
              } else {
                setCardFilter('critical');
                setSelectedSeverity('Critical');
                setSelectedStatus('Active');
              }
            }}
            className={cn(
              "p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all border",
              cardFilter === 'critical'
                ? "bg-red-950/60 border-red-500 ring-2 ring-red-500/80 shadow-lg shadow-red-950/50"
                : "bg-[#101419] border-red-600/80 hover:bg-red-950/20 bg-red-950/10"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-red-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                CRITICAL THREATS
                {cardFilter === 'critical' && (
                  <span className="text-[9px] font-mono bg-red-500 text-white px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </div>
              <div className="text-xl font-bold font-mono text-red-300">
                {metrics.critical} <span className="text-xs font-normal text-red-400">Active</span>
              </div>
              <div className="text-[10px] text-red-400 font-mono">Requires Immediate Remediation</div>
            </div>
            <div className="p-2 rounded bg-red-950 border border-red-800 text-red-400 animate-pulse">
              <Flame className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => {
              if (cardFilter === 'warnings') {
                setCardFilter('all');
                setSelectedSeverity('All Severities');
                setSelectedStatus('All Statuses');
              } else {
                setCardFilter('warnings');
                setSelectedSeverity('High');
                setSelectedStatus('Active');
              }
            }}
            className={cn(
              "p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all border",
              cardFilter === 'warnings'
                ? "bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/80 shadow-lg shadow-amber-950/50"
                : "bg-[#101419] border-amber-500/40 hover:bg-amber-950/20"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                POLICY DRIFTS & WARNINGS
                {cardFilter === 'warnings' && (
                  <span className="text-[9px] font-mono bg-amber-500 text-black px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {metrics.warnings} <span className="text-xs font-normal text-amber-400">Drifts</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Non-compliant configurations</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => {
              if (cardFilter === 'autoHealed') {
                setCardFilter('all');
                setSelectedStatus('All Statuses');
                setSelectedSeverity('All Severities');
              } else {
                setCardFilter('autoHealed');
                setSelectedStatus('Resolved');
                setSelectedSeverity('All Severities');
              }
            }}
            className={cn(
              "p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all border",
              cardFilter === 'autoHealed'
                ? "bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-500/80 shadow-lg shadow-emerald-950/50"
                : "bg-[#101419] border-emerald-500/40 hover:bg-emerald-950/20"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                AUTO-REMEDIATED TODAY
                {cardFilter === 'autoHealed' && (
                  <span className="text-[9px] font-mono bg-emerald-500 text-black px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {metrics.autoHealed} <span className="text-xs font-normal text-emerald-400">Auto-Healed</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Resolved by background workflows</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => {
              if (cardFilter === 'pending') {
                setCardFilter('all');
                setSelectedStatus('All Statuses');
                setSelectedSeverity('All Severities');
              } else {
                setCardFilter('pending');
                setSelectedStatus('Pending Approval');
                setSelectedSeverity('All Severities');
              }
            }}
            className={cn(
              "p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all border",
              cardFilter === 'pending'
                ? "bg-purple-950/60 border-purple-500 ring-2 ring-purple-500/80 shadow-lg shadow-purple-950/50"
                : "bg-[#101419] border-purple-500/40 hover:bg-purple-950/20"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                PENDING APPROVAL
                {cardFilter === 'pending' && (
                  <span className="text-[9px] font-mono bg-purple-500 text-white px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </div>
              <div className="text-xl font-bold font-mono text-purple-200">
                {metrics.pending} <span className="text-xs font-normal text-purple-400">Gated Actions</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Awaiting Tech Dual-Key Approval</div>
            </div>
            <div className="p-2 rounded bg-purple-950/40 border border-purple-800 text-purple-400">
              <Lock className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. SEARCH, FILTER & BULK ACTION BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        <div className="flex items-center gap-2 flex-1 min-w-[300px]">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Alert Title, Target UPN, Alert ID, or Graph Endpoint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a919e] hover:text-white">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Severity Filter */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Severities">All Severities</option>
            <option value="Critical">🔴 Critical Only</option>
            <option value="High">🟠 High Only</option>
            <option value="Warning">🟡 Warning Only</option>
            <option value="Info">🔵 Info Only</option>
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Categories</option>
            <option value="Identity">Identity / MFA</option>
            <option value="ConditionalAccess">Conditional Access</option>
            <option value="Exchange">Exchange Online</option>
            <option value="Intune">Intune MDM</option>
            <option value="Defender">Defender Guard</option>
            <option value="Licensing">Licensing Waste</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Statuses">All Statuses</option>
            <option value="Active">Active / Unresolved</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Resolved">Resolved</option>
            <option value="Muted">Muted</option>
          </select>
        </div>

        {/* Floating Bulk Action Toolbar (When 1+ alerts checked) */}
        {selectedAlertIdsForBulk.length > 0 && (
          <div className="flex items-center gap-2 bg-[#0078d4]/20 border border-[#0078d4] px-3 py-1 rounded text-xs animate-in fade-in">
            <span className="font-bold text-[#a3c9ff] font-mono">
              {selectedAlertIdsForBulk.length} Selected
            </span>
            <button
              onClick={handleBulkRemediate}
              className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-[11px] cursor-pointer"
            >
              Bulk Remediate
            </button>
            <button
              onClick={handleBulkMute}
              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-amber-300 font-semibold rounded text-[11px] cursor-pointer"
            >
              Mute
            </button>
            <button
              onClick={() => setSelectedAlertIdsForBulk([])}
              className="text-[#8a919e] hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 3. SPLIT-PANE MAIN VIEW (60% ALERT STREAM | 40% REMEDIATION INSPECTOR) */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-[#0b0e14]">
        
        {/* High-Density Alert Stream Table (Full Width) */}
        <div className="w-full overflow-y-auto flex flex-col shrink-0">
          
          <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between shrink-0">
            <span>Graph API Drift Alert Stream ({filteredAlerts.length})</span>
            <span className="hidden sm:inline text-amber-300/90 font-sans font-semibold">⚡ Click any alert row to launch Remediation Wizard</span>
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#181c22] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                  <th className="p-2.5 w-8">
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={
                        filteredAlerts.length > 0 &&
                        selectedAlertIdsForBulk.length === filteredAlerts.length
                      }
                      className="rounded border-[#404752] bg-[#101419] text-[#0078d4] cursor-pointer"
                    />
                  </th>
                  <th className="p-2.5">Severity</th>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Alert Title & Category</th>
                  <th className="p-2.5">Impacted Target</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#404752]/60 font-mono text-[11.5px]">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#8a919e]">
                      No monitoring alerts found matching current filter parameters.
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((item) => {
                    const isSelected = selectedAlertId === item.id;
                    const isChecked = selectedAlertIdsForBulk.includes(item.id);

                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedAlertId(item.id);
                          handleOpenWizard(item);
                        }}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-[#272a30]/60',
                          isSelected ? 'bg-[#0078d4]/15 font-semibold text-white' : 'text-[#e0e2ea]'
                        )}
                      >
                        {/* Checkbox */}
                        <td className="p-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => handleToggleSingleSelect(item.id, e as any)}
                            className="rounded border-[#404752] bg-[#101419] text-[#0078d4] cursor-pointer"
                          />
                        </td>

                        {/* Severity Badge */}
                        <td className="p-2.5 whitespace-nowrap">
                          {item.severity === 'critical' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-600 text-white animate-pulse flex items-center gap-1 w-fit">
                              <Flame className="w-3 h-3" /> CRITICAL
                            </span>
                          ) : item.severity === 'high' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-600/30 text-amber-300 border border-amber-500/50">
                              HIGH
                            </span>
                          ) : item.severity === 'warning' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-200 border border-amber-500/30">
                              WARNING
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30">
                              INFO
                            </span>
                          )}
                        </td>

                        {/* Time */}
                        <td className="p-2.5 whitespace-nowrap text-[#8a919e]">
                          {item.relativeTime}
                        </td>

                        {/* Title & Category */}
                        <td className="p-2.5 font-sans">
                          <div className="font-bold text-[#e0e2ea] truncate max-w-[320px]">
                            {item.title}
                          </div>
                          <div className="text-[10px] font-mono text-purple-300">
                            {item.category} • {item.id} • {item.tenantName}
                          </div>
                        </td>

                        {/* Impacted Target */}
                        <td className="p-2.5 font-mono">
                          <div className="truncate max-w-[220px] text-[#a3c9ff]">
                            {item.targetResource}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-2.5">
                          {item.status === 'active' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                              ACTIVE
                            </span>
                          ) : item.status === 'pending_approval' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                              GATED PENDING
                            </span>
                          ) : item.status === 'resolved' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                              RESOLVED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#272a30] text-[#8a919e] border border-[#404752]">
                              MUTED
                            </span>
                          )}
                        </td>

                        {/* Direct 1-Click Action */}
                        <td className="p-2.5 text-right">
                          {item.status === 'resolved' ? (
                            <span className="text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-end gap-1">
                              <Check className="w-3 h-3" /> Fixed
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenWizard(item);
                              }}
                              className={cn(
                                'px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ml-auto',
                                item.safetyLevel === 'gated'
                                  ? 'bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-700'
                                  : 'bg-[#0078d4] hover:bg-[#0060ab] text-white shadow-sm'
                              )}
                            >
                              {item.safetyLevel === 'gated' ? (
                                <>
                                  <Lock className="w-3 h-3" /> <span>Wizard</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="w-3 h-3" /> <span>Fix / Wizard</span>
                                </>
                              )}
                            </button>
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

      {/* ========================================================================= */}
      {/* 4. SAFETY GATING & WORKFLOW CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {pendingGatedAction && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-amber-500 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-in zoom-in-95">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#404752] pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-amber-950 border border-amber-700 text-amber-300">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-amber-400">
                    <span>GATED ACTION APPROVAL REQUIRED</span>
                  </div>
                  <h2 className="text-base font-bold text-[#e0e2ea] mt-0.5">
                    {pendingGatedAction.actionName}
                  </h2>
                </div>
              </div>

              <button
                onClick={() => setPendingGatedAction(null)}
                className="p-1 rounded text-[#8a919e] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warning Text */}
            <div className="bg-[#101419] border border-amber-800/60 p-3.5 rounded text-xs text-amber-200 leading-relaxed space-y-1 font-mono">
              <p className="font-bold flex items-center gap-1.5 text-amber-300">
                <AlertCircle className="w-4 h-4" /> Dual-Key Senior Tech Confirmation
              </p>
              <p className="text-[11px] text-[#8a919e]">
                Target Resource: <strong className="text-white">{pendingGatedAction.alert.targetResource}</strong>
              </p>
              <p className="text-[11px] text-[#8a919e]">
                This action modifies live Azure/M365 production state or revokes user sign-in sessions. Provide a PSA ticket reference to proceed.
              </p>
            </div>

            {/* PSA Input */}
            <div>
              <label className="text-xs font-bold text-[#a3c9ff] font-mono block mb-1">
                Mandatory PSA Ticket / Change Reason ID
              </label>
              <input
                type="text"
                value={psaReasonInput}
                onChange={(e) => setPsaReasonInput(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] font-mono outline-none focus:border-amber-500"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#404752]">
              <button
                onClick={() => setPendingGatedAction(null)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmGatedAction}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Confirm & Dispatch Workflow</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* RBD ACCEPTANCE & RULE LINKING MODAL */}
      {selectedAlert && (
        <RbdAcceptanceAndRuleLinker
          isOpen={isRbdModalOpen}
          alertPayload={{
            alertId: selectedAlert.id,
            tenantId: selectedAlert.tenantId,
            tenantName: selectedAlert.tenantName,
            riskNotificationType: `${selectedAlert.category.toUpperCase()}_DRIFT_EXEMPTION`,
            targetResource: selectedAlert.targetResource,
            severity: selectedAlert.severity,
            title: selectedAlert.title,
          }}
          onClose={() => setIsRbdModalOpen(false)}
          onConfirmRbd={handleConfirmRbd}
        />
      )}

      {/* 3-PANEL ALERT RESOLUTION WIZARD MODAL */}
      <AlertResolutionWizardModal
        isOpen={isWizardOpen}
        alert={activeWizardAlert ? {
          id: activeWizardAlert.id,
          code: activeWizardAlert.id,
          title: activeWizardAlert.title,
          tenantId: activeWizardAlert.tenantId,
          tenantName: activeWizardAlert.tenantName,
          category: activeWizardAlert.category,
          severity: activeWizardAlert.severity,
          targetResource: activeWizardAlert.targetResource,
          description: activeWizardAlert.description,
          graphEndpoint: activeWizardAlert.graphEndpoint,
          rootCauseAnalysis: activeWizardAlert.detectedDrift,
        } : null}
        onClose={() => setIsWizardOpen(false)}
        onRemediateSuccess={(alertId) => {
          setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'resolved' } : a));
          toast('success', 'SOP Auto-Heal Executed', `Graph API remediation completed for ${alertId}.`);
        }}
        onAcceptRbdSuccess={(alertId, record) => {
          setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'resolved', remediationActionName: `Covered by Linked ${record.rbdCode}` } : a));
          toast('success', 'RBD Waiver Linked', `Risk waiver ${record.rbdCode} linked to alert ${alertId}.`);
        }}
        onSendQuoteSuccess={(alertId) => {
          toast('success', 'Gold Upgrade Quote Sent', `Commercial upgrade proposal emailed to client CISO for ${alertId}.`);
        }}
        onMicroTxSuccess={(alertId, amount) => {
          toast('success', 'Ad-Hoc Micro-Tx Billed', `$${amount}.00 ad-hoc remediation fee posted to ledger for ${alertId}.`);
        }}
      />

    </div>
  );
};
