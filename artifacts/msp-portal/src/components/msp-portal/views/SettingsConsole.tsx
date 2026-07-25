// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Settings,
  KeyRound,
  Building2,
  Users,
  ShieldCheck,
  Globe,
  Palette,
  Database,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Save,
  Lock,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Zap,
  Search,
  FileText,
  Sparkles,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  AlertTriangle,
  Check,
  RotateCcw,
  Download,
  History,
  Terminal,
  ShieldAlert,
  Clock,
  Activity,
  Layers,
  Radio,
  Server,
  Cpu,
  HelpCircle,
  UserPlus,
  CheckSquare,
  X,
  Sliders,
  Send,
  Webhook,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export interface PlatformSettings {
  graphAppId: string;
  graphTenantId: string;
  graphSecretValue: string;
  certificateFingerprint: string;
  graphConnectionStatus: 'connected' | 'error' | 'testing';
  gdapConsentCount: number;
  pollingIntervalMinutes: number;
  throttleOn429: boolean;
  circuitBreakerThreshold: number;
  auditRetentionDays: number;
  maxWorkerThreads: number;
  mspName: string;
  customDomain: string;
  logoUrl: string;
  accentTheme: 'Dark SOC Default' | 'Midnight Blue' | 'Cyber Emerald' | 'Obsidian Purple';
  supportEmail: string;
  requireMfa: boolean;
  ipWhitelistRange: string;
  sessionTimeoutHours: number;
}

export interface PsaConnector {
  id: string;
  name: string;
  provider: 'halopsa' | 'connectwise' | 'autotask' | 'sentinelone' | 'huntress' | 'datadog' | 'slack_webhook' | 'syslog';
  category: 'psa' | 'rmm_security' | 'notification' | 'syslog';
  apiUrl: string;
  clientId: string;
  secretKey: string;
  tenantOrCompanyId: string;
  status: 'active' | 'error' | 'disabled';
  lastSyncAt: string;
  deliveries24h: number;
}

export interface PlatformUser {
  id: string;
  name: string;
  upn: string;
  role: 'super_admin' | 'l2_operator' | 'sales_specialist' | 'auditor';
  mfaEnforced: boolean;
  ipWhitelisted: boolean;
  lastActive: string;
  status: 'active' | 'suspended';
}

export interface GdapRelationship {
  id: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
  expirationDate: string;
  status: 'active' | 'expiring_soon' | 'expired';
  partnerType: 'GDAP' | 'DAP';
}

export interface SettingsAuditItem {
  id: string;
  timestamp: string;
  operatorUpn: string;
  category: string;
  settingName: string;
  previousValue: string;
  newValue: string;
}

interface SettingsConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onSaveSettings?: (settings: PlatformSettings) => void;
}

// ==========================================
// MOCK DATA SEEDS
// ==========================================

const INITIAL_SETTINGS: PlatformSettings = {
  graphAppId: '4f8912bc-8891-423a-b812-99011234a567',
  graphTenantId: 'e89b1201-381a-4912-8812-102938475612',
  graphSecretValue: 'sec_7789a1b2c3d4e5f678901234567890ab',
  certificateFingerprint: 'SHA256:9F8A7B6C5D4E3F2A1B0C9D8E7F6A5B4C3D2E1F0A',
  graphConnectionStatus: 'connected',
  gdapConsentCount: 25,
  pollingIntervalMinutes: 5,
  throttleOn429: true,
  circuitBreakerThreshold: 10,
  auditRetentionDays: 90,
  maxWorkerThreads: 16,
  mspName: 'Shane McCaw Consulting',
  customDomain: 'portal.mccawconsulting.com',
  logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
  accentTheme: 'Dark SOC Default',
  supportEmail: 'support@mccawconsulting.com',
  requireMfa: true,
  ipWhitelistRange: '198.51.100.0/24, 203.0.113.42/32',
  sessionTimeoutHours: 8,
};

const INITIAL_CONNECTORS: PsaConnector[] = [
  {
    id: 'conn-1',
    name: 'HaloPSA Multi-Tenant Sync Engine',
    provider: 'halopsa',
    category: 'psa',
    apiUrl: 'https://halopsa.msp-global.com/api',
    clientId: 'halo_client_prod_9901',
    secretKey: 'whsec_halo_9918273645012938',
    tenantOrCompanyId: 'CONTOSO-PROD',
    status: 'active',
    lastSyncAt: '3 minutes ago',
    deliveries24h: 14200,
  },
  {
    id: 'conn-2',
    name: 'ConnectWise Manage Service Desk Sync',
    provider: 'connectwise',
    category: 'psa',
    apiUrl: 'https://api-na.connectwisedev.com/v4_6_release/apis/3.0',
    clientId: 'cw_client_app_8820',
    secretKey: 'sec_cw_9918273645123984',
    tenantOrCompanyId: 'NorthwindTraders',
    status: 'active',
    lastSyncAt: '8 minutes ago',
    deliveries24h: 8940,
  },
  {
    id: 'conn-3',
    name: 'Autotask PSA Incident Integration',
    provider: 'autotask',
    category: 'psa',
    apiUrl: 'https://webservices14.autotask.net/atservices/v1.0',
    clientId: 'autotask_user_4412',
    secretKey: 'sec_at_00192837465',
    tenantOrCompanyId: 'AT-COMPANY-8812',
    status: 'disabled',
    lastSyncAt: 'Yesterday',
    deliveries24h: 0,
  },
  {
    id: 'conn-4',
    name: 'Huntress Managed EDR Threat Feed',
    provider: 'huntress',
    category: 'rmm_security',
    apiUrl: 'https://api.huntress.io/v1',
    clientId: 'huntress_org_key_7719',
    secretKey: 'hnt_sec_8812736450192837',
    tenantOrCompanyId: 'MCCAW-CONSULTING',
    status: 'active',
    lastSyncAt: '1 minute ago',
    deliveries24h: 32100,
  },
  {
    id: 'conn-5',
    name: 'SentinelOne Singularity Control API',
    provider: 'sentinelone',
    category: 'rmm_security',
    apiUrl: 'https://usea1-100.sentinelone.net/web/api/v2.1',
    clientId: 's1_admin_token_3321',
    secretKey: 's1_api_tok_99182736450192837',
    tenantOrCompanyId: 'Global-MSP-Account',
    status: 'active',
    lastSyncAt: '4 minutes ago',
    deliveries24h: 48900,
  },
  {
    id: 'conn-6',
    name: 'Datadog SIEM Log & Telemetry Forwarder',
    provider: 'datadog',
    category: 'rmm_security',
    apiUrl: 'https://http-intake.logs.datadoghq.com/v1/input',
    clientId: 'dd_app_key_88291',
    secretKey: 'dd_api_key_77182930415263',
    tenantOrCompanyId: 'datadog-us1',
    status: 'active',
    lastSyncAt: '12 seconds ago',
    deliveries24h: 182000,
  },
  {
    id: 'conn-7',
    name: 'Slack #soc-alerts Channel Bot',
    provider: 'slack_webhook',
    category: 'notification',
    apiUrl: 'https://hooks.slack.com/services/T0000/B0000/XXXXX',
    clientId: 'slack_bot_id_9921',
    secretKey: 'whsec_slack_9918273645',
    tenantOrCompanyId: '#soc-alerts',
    status: 'active',
    lastSyncAt: '15 minutes ago',
    deliveries24h: 340,
  },
  {
    id: 'conn-8',
    name: 'Syslog TLS Enterprise Audit Collector',
    provider: 'syslog',
    category: 'syslog',
    apiUrl: 'syslog.mccawconsulting.com:514',
    clientId: 'syslog_fac_local0',
    secretKey: 'tls_cert_fingerprint_sha256',
    tenantOrCompanyId: 'Port 514 TLS',
    status: 'active',
    lastSyncAt: '2 minutes ago',
    deliveries24h: 98120,
  },
];

const INITIAL_GDAP_TENANTS: GdapRelationship[] = [
  {
    id: 'gdap-1',
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    roles: ['Global Administrator', 'Cloud Application Admin', 'User Administrator', 'Intune Admin'],
    expirationDate: '2027-03-15',
    status: 'active',
    partnerType: 'GDAP',
  },
  {
    id: 'gdap-2',
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    roles: ['Global Administrator', 'Security Administrator', 'Exchange Admin'],
    expirationDate: '2026-08-10',
    status: 'expiring_soon',
    partnerType: 'GDAP',
  },
  {
    id: 'gdap-3',
    tenantId: 't-northwind-03',
    tenantName: 'Northwind Traders',
    roles: ['Cloud Application Admin', 'User Administrator', 'Privileged Role Admin'],
    expirationDate: '2027-01-20',
    status: 'active',
    partnerType: 'GDAP',
  },
  {
    id: 'gdap-4',
    tenantId: 't-litware-04',
    tenantName: 'Litware Systems',
    roles: ['Global Administrator', 'Helpdesk Administrator'],
    expirationDate: '2026-09-01',
    status: 'expiring_soon',
    partnerType: 'GDAP',
  },
  {
    id: 'gdap-5',
    tenantId: 't-adventure-05',
    tenantName: 'AdventureWorks',
    roles: ['Global Administrator', 'Security Reader', 'Intune Admin'],
    expirationDate: '2027-05-12',
    status: 'active',
    partnerType: 'GDAP',
  },
  {
    id: 'gdap-6',
    tenantId: 't-woodgrove-06',
    tenantName: 'Woodgrove Bank',
    roles: ['Global Administrator', 'Privileged Role Admin', 'Billing Admin'],
    expirationDate: '2026-07-28',
    status: 'expiring_soon',
    partnerType: 'GDAP',
  },
];

const INITIAL_USERS: PlatformUser[] = [
  {
    id: 'usr-1',
    name: 'Shane McCaw',
    upn: 'shane@mccawconsulting.com',
    role: 'super_admin',
    mfaEnforced: true,
    ipWhitelisted: true,
    lastActive: '2 minutes ago',
    status: 'active',
  },
  {
    id: 'usr-2',
    name: 'Alex Chen',
    upn: 'alex.c@mccawconsulting.com',
    role: 'super_admin',
    mfaEnforced: true,
    ipWhitelisted: true,
    lastActive: '15 minutes ago',
    status: 'active',
  },
  {
    id: 'usr-3',
    name: 'Sarah Jenkins',
    upn: 'sarah.j@mccawconsulting.com',
    role: 'l2_operator',
    mfaEnforced: true,
    ipWhitelisted: true,
    lastActive: '1 hour ago',
    status: 'active',
  },
  {
    id: 'usr-4',
    name: 'Marcus Vance',
    upn: 'marcus.v@mccawconsulting.com',
    role: 'l2_operator',
    mfaEnforced: true,
    ipWhitelisted: true,
    lastActive: '3 hours ago',
    status: 'active',
  },
  {
    id: 'usr-5',
    name: 'Elena Rostova',
    upn: 'elena.r@mccawconsulting.com',
    role: 'sales_specialist',
    mfaEnforced: true,
    ipWhitelisted: false,
    lastActive: 'Yesterday',
    status: 'active',
  },
  {
    id: 'usr-6',
    name: 'David K.',
    upn: 'david.k@mccawconsulting.com',
    role: 'auditor',
    mfaEnforced: true,
    ipWhitelisted: true,
    lastActive: '2 days ago',
    status: 'active',
  },
];

const INITIAL_AUDIT_LOGS: SettingsAuditItem[] = [
  {
    id: 'aud-101',
    timestamp: '2026-07-24 08:45:12',
    operatorUpn: 'shane@mccawconsulting.com',
    category: 'Engine Parameters',
    settingName: 'pollingIntervalMinutes',
    previousValue: '15 Min',
    newValue: '5 Min (Recommended)',
  },
  {
    id: 'aud-102',
    timestamp: '2026-07-23 16:20:05',
    operatorUpn: 'alex.c@mccawconsulting.com',
    category: 'PSA Integration',
    settingName: 'HaloPSA API Endpoint',
    previousValue: 'https://halopsa.dev.msp/api',
    newValue: 'https://halopsa.msp-global.com/api',
  },
  {
    id: 'aud-103',
    timestamp: '2026-07-22 11:05:40',
    operatorUpn: 'shane@mccawconsulting.com',
    category: 'Platform RBAC',
    settingName: 'User Role: Sarah Jenkins',
    previousValue: 'Read-Only Auditor',
    newValue: 'L2 Operator',
  },
  {
    id: 'aud-104',
    timestamp: '2026-07-20 09:30:00',
    operatorUpn: 'shane@mccawconsulting.com',
    category: 'White-Label Branding',
    settingName: 'mspName',
    previousValue: 'McCaw Tech',
    newValue: 'Shane McCaw Consulting',
  },
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export const SettingsConsole: React.FC<SettingsConsoleProps> = ({
  tenants = [],
  onShowToast,
  onSaveSettings,
}) => {
  // Navigation Sub-Tabs
  const [activeTab, setActiveTab] = useState<'graph' | 'connectors' | 'engine' | 'rbac' | 'branding'>('graph');

  // Core Platform Configuration State
  const [settings, setSettings] = useState<PlatformSettings>(INITIAL_SETTINGS);
  const [connectors, setConnectors] = useState<PsaConnector[]>(INITIAL_CONNECTORS);
  const [gdapTenants, setGdapTenants] = useState<GdapRelationship[]>(INITIAL_GDAP_TENANTS);
  const [users, setUsers] = useState<PlatformUser[]>(INITIAL_USERS);
  const [auditLogs, setAuditLogs] = useState<SettingsAuditItem[]>(INITIAL_AUDIT_LOGS);

  // Secret Visibility Toggles
  const [showGraphSecret, setShowGraphSecret] = useState(false);
  const [visibleConnectorSecrets, setVisibleConnectorSecrets] = useState<Record<string, boolean>>({});

  // UI Interactive States & Modals
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingGraph, setIsTestingGraph] = useState(false);
  const [graphTestResult, setGraphTestResult] = useState<any | null>(null);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditConnectorModal, setShowEditConnectorModal] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<PsaConnector | null>(null);

  // Filters & Searches
  const [gdapSearch, setGdapSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [connectorCategoryFilter, setConnectorCategoryFilter] = useState<'all' | 'psa' | 'rmm_security' | 'notification' | 'syslog'>('all');

  // Form State for Invite User
  const [newUserName, setNewUserName] = useState('');
  const [newUserUpn, setNewUserUpn] = useState('');
  const [newUserRole, setNewUserRole] = useState<PlatformUser['role']>('l2_operator');

  // Form State for Edit Connector
  const [editConnUrl, setEditConnUrl] = useState('');
  const [editConnClientId, setEditConnClientId] = useState('');
  const [editConnSecret, setEditConnSecret] = useState('');

  // Helper Toast Trigger
  const triggerToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // Toggle secret mask for specific connector
  const toggleConnectorSecret = (id: string) => {
    setVisibleConnectorSecrets((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Filtered GDAP Tenants
  const filteredGdapTenants = useMemo(() => {
    return gdapTenants.filter(
      (g) =>
        g.tenantName.toLowerCase().includes(gdapSearch.toLowerCase()) ||
        g.tenantId.toLowerCase().includes(gdapSearch.toLowerCase()) ||
        g.roles.some((r) => r.toLowerCase().includes(gdapSearch.toLowerCase()))
    );
  }, [gdapTenants, gdapSearch]);

  // Filtered Technicians
  const filteredUsers = useMemo(() => {
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.upn.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.role.toLowerCase().includes(userSearch.toLowerCase())
    );
  }, [users, userSearch]);

  // Filtered Connectors
  const filteredConnectors = useMemo(() => {
    if (connectorCategoryFilter === 'all') return connectors;
    return connectors.filter((c) => c.category === connectorCategoryFilter);
  }, [connectors, connectorCategoryFilter]);

  // Handler: Save All Settings
  const handleSaveAll = () => {
    setIsSaving(true);

    setTimeout(() => {
      setIsSaving(false);
      triggerToast('success', 'Global Settings Saved', 'Platform configuration, Graph credentials & RBAC rules successfully persisted.');

      // Inject into Audit Log
      const newAudit: SettingsAuditItem = {
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        operatorUpn: 'shane@mccawconsulting.com',
        category: 'Global Save',
        settingName: 'Platform Global Sync',
        previousValue: 'Draft Updates',
        newValue: 'Persisted to Key Vault & DB',
      };
      setAuditLogs([newAudit, ...auditLogs]);

      if (onSaveSettings) {
        onSaveSettings(settings);
      }
    }, 600);
  };

  // Handler: Test Graph API Connection
  const handleTestGraphConnection = () => {
    setIsTestingGraph(true);
    setGraphTestResult(null);

    setTimeout(() => {
      setIsTestingGraph(false);
      const res = {
        status: 'SUCCESS',
        latencyMs: 112,
        graphEndpoint: 'https://graph.microsoft.com/v1.0',
        verifiedScopes: [
          'Directory.ReadWrite.All',
          'Directory.AccessAsUser.All',
          'RoleManagement.ReadWrite.Directory',
          'Policy.ReadWrite.ConditionalAccess',
          'User.ReadWrite.All',
          'AuditLog.Read.All',
        ],
        gdapConsentsVerified: 25,
        publisherTenant: 'Shane McCaw Consulting (e89b1201)',
      };
      setGraphTestResult(res);
      setSettings((prev) => ({ ...prev, graphConnectionStatus: 'connected' }));

      triggerToast('success', 'Graph API Connection Verified', `HTTP 200 OK — Latency 112ms across 25 client tenant GDAP scopes.`);
    }, 800);
  };

  // Handler: Grant Admin Consent Link
  const handleCopyAdminConsentLink = () => {
    const consentUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${settings.graphAppId}&state=msp_nexus_gdap_init&redirect_uri=https://${settings.customDomain}/portal/settings`;
    navigator.clipboard.writeText(consentUrl);
    triggerToast('info', 'Admin Consent Link Copied', 'Paste into browser to authorize partner GDAP relationship across client tenants.');
  };

  // Handler: Test PSA Connector Sync
  const handleTestConnectorSync = (conn: PsaConnector) => {
    triggerToast('info', `Testing ${conn.name}`, `Initiating OAuth handshake and synthetic probe to ${conn.apiUrl}...`);

    setTimeout(() => {
      setConnectors((prev) =>
        prev.map((c) => {
          if (c.id === conn.id) {
            return {
              ...c,
              status: 'active',
              lastSyncAt: 'Just now',
            };
          }
          return c;
        })
      );
      triggerToast('success', `${conn.name} Online`, `Handshake verified (HTTP 200 OK). Credentials & scopes valid.`);
    }, 600);
  };

  // Handler: Open Edit Connector Modal
  const handleOpenEditConnector = (conn: PsaConnector) => {
    setSelectedConnector(conn);
    setEditConnUrl(conn.apiUrl);
    setEditConnClientId(conn.clientId);
    setEditConnSecret(conn.secretKey);
    setShowEditConnectorModal(true);
  };

  // Handler: Save Connector Edit
  const handleSaveConnectorEdit = () => {
    if (!selectedConnector) return;

    setConnectors((prev) =>
      prev.map((c) => {
        if (c.id === selectedConnector.id) {
          return {
            ...c,
            apiUrl: editConnUrl,
            clientId: editConnClientId,
            secretKey: editConnSecret,
            status: 'active',
            lastSyncAt: 'Updated just now',
          };
        }
        return c;
      })
    );

    setShowEditConnectorModal(false);
    triggerToast('success', 'Connector Credentials Updated', `Updated settings for ${selectedConnector.name}.`);
  };

  // Handler: Invite New Technician
  const handleInviteUser = () => {
    if (!newUserName.trim() || !newUserUpn.trim()) return;

    const newUser: PlatformUser = {
      id: `usr-${Date.now()}`,
      name: newUserName.trim(),
      upn: newUserUpn.trim(),
      role: newUserRole,
      mfaEnforced: true,
      ipWhitelisted: true,
      lastActive: 'Invited (Pending login)',
      status: 'active',
    };

    setUsers([newUser, ...users]);
    setShowInviteModal(false);
    setNewUserName('');
    setNewUserUpn('');

    triggerToast('success', 'Technician Invited', `Sent administrative onboarding link to ${newUser.upn} (${newUser.role}).`);
  };

  // Handler: Export Config JSON Backup
  const handleExportConfigBackup = () => {
    const backupData = {
      timestamp: new Date().toISOString(),
      platformSettings: settings,
      connectors: connectors.map((c) => ({ ...c, secretKey: '***REDACTED***' })),
      gdapTenantsCount: gdapTenants.length,
      platformUsersCount: users.length,
      exporter: 'shane@mccawconsulting.com',
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `msp-nexus-settings-backup-${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    triggerToast('success', 'Configuration Backup Exported', 'Encrypted settings JSON downloaded to local machine.');
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & PLATFORM HEALTH SUMMARY BAR */}
      <div className="bg-[#101419] border-b border-[#272f3d] px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-md">
        {/* Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#0078d4]/20 border border-[#0078d4]/40 flex items-center justify-center text-[#0078d4] shadow-inner">
            <Settings className="w-5 h-5 text-cyan-400 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">Global Management &amp; Security Control Center</h1>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" /> MSP MULTI-TENANT ARCHITECTURE
              </span>
            </div>
            <p className="text-[11px] text-[#8a919e] font-medium">
              Graph API App Credentials, PSA/RMM Integration Vault, Engine Cadence &amp; White-Label Portal Config
            </p>
          </div>
        </div>

        {/* Global Settings KPI Summary Cards */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Graph Status */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Graph App Registration</div>
              <div className="text-xs font-bold text-emerald-400 font-mono flex items-center gap-1">
                <span>CONNECTED 🟢</span>
                <span className="text-[10px] text-[#8a919e]">({settings.gdapConsentCount} GDAPs)</span>
              </div>
            </div>
          </div>

          {/* Active Connectors */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Active PSA &amp; RMM</div>
              <div className="text-xs font-bold text-white font-mono">
                {connectors.filter((c) => c.status === 'active').length} / {connectors.length} Live APIs
              </div>
            </div>
          </div>

          {/* Engine Polling Cadence */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Engine Polling Rate</div>
              <div className="text-xs font-bold text-blue-300 font-mono">
                Every {settings.pollingIntervalMinutes}m ({settings.maxWorkerThreads} Workers)
              </div>
            </div>
          </div>

          {/* Active Admin Seats */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Platform Tech Seats</div>
              <div className="text-xs font-bold text-purple-300 font-mono">{users.length} Active Technicians</div>
            </div>
          </div>
        </div>

        {/* Global Control Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 shadow transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {isSaving ? 'Saving Settings...' : '💾 Save All Changes'}
          </button>

          <button
            onClick={handleExportConfigBackup}
            className="bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#c0c7d4] hover:text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
            title="Export Configuration Backup JSON"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export Backup
          </button>

          <button
            onClick={() => setShowAuditDrawer(true)}
            className="bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#c0c7d4] hover:text-white p-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
            title="View Audit Change History"
          >
            <History className="w-4 h-4 text-amber-400" />
          </button>
        </div>
      </div>

      {/* 2. CORE NAVIGATION SUB-TABS (5 FOCUSED TABS) */}
      <div className="bg-[#0c1018] border-b border-[#272f3d] px-4 py-2 flex items-center gap-1 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('graph')}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap',
            activeTab === 'graph'
              ? 'bg-[#0078d4] text-white shadow'
              : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
          )}
        >
          <KeyRound className="w-3.5 h-3.5 text-cyan-300" />
          🔐 Microsoft Graph &amp; GDAP Authorization
        </button>

        <button
          onClick={() => setActiveTab('connectors')}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap',
            activeTab === 'connectors'
              ? 'bg-[#0078d4] text-white shadow'
              : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
          )}
        >
          <Zap className="w-3.5 h-3.5 text-amber-300" />
          🔌 PSA, RMM &amp; Security Integration Vault ({connectors.length})
        </button>

        <button
          onClick={() => setActiveTab('engine')}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap',
            activeTab === 'engine'
              ? 'bg-[#0078d4] text-white shadow'
              : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-blue-300" />
          ⚡ Engine Polling &amp; System Parameters
        </button>

        <button
          onClick={() => setActiveTab('rbac')}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap',
            activeTab === 'rbac'
              ? 'bg-[#0078d4] text-white shadow'
              : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
          )}
        >
          <Users className="w-3.5 h-3.5 text-purple-300" />
          👥 Platform Team &amp; RBAC Management ({users.length})
        </button>

        <button
          onClick={() => setActiveTab('branding')}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap',
            activeTab === 'branding'
              ? 'bg-[#0078d4] text-white shadow'
              : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
          )}
        >
          <Palette className="w-3.5 h-3.5 text-pink-300" />
          🎨 White-Label &amp; Portal Customization
        </button>
      </div>

      {/* 3. MAIN CONTENT AREA */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: MICROSOFT GRAPH & GDAP AUTHORIZATION */}
        {activeTab === 'graph' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            {/* Top Multi-Tenant App Registration Card */}
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
                <div className="flex items-center gap-2.5">
                  <KeyRound className="w-5 h-5 text-cyan-400" />
                  <div>
                    <h2 className="text-sm font-bold text-white">Central Entra ID Multi-Tenant App Registration</h2>
                    <p className="text-[11px] text-[#8a919e]">
                      Global Application ID &amp; Secret used for Microsoft Graph API queries across all 25 client tenant GDAP scopes.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestGraphConnection}
                    disabled={isTestingGraph}
                    className="bg-[#1f293d] hover:bg-[#2a3752] text-cyan-300 border border-cyan-500/30 px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isTestingGraph ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    {isTestingGraph ? 'Verifying Handshake...' : '⚡ Test Graph API Connection'}
                  </button>

                  <button
                    onClick={handleCopyAdminConsentLink}
                    className="bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#a3c9ff] hover:text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                    Grant Admin Consent Link
                  </button>
                </div>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Application (Client) ID */}
                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold flex items-center gap-1">
                    <span>Application (Client) ID</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={settings.graphAppId}
                      onChange={(e) => setSettings({ ...settings, graphAppId: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                    />
                    <Copy
                      onClick={() => {
                        navigator.clipboard.writeText(settings.graphAppId);
                        triggerToast('info', 'App ID Copied', settings.graphAppId);
                      }}
                      className="w-3.5 h-3.5 absolute right-3 top-3 text-[#8a919e] hover:text-white cursor-pointer"
                    />
                  </div>
                </div>

                {/* Directory (Tenant) ID */}
                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold flex items-center gap-1">
                    <span>Directory (Publisher Tenant) ID</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={settings.graphTenantId}
                      onChange={(e) => setSettings({ ...settings, graphTenantId: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                    />
                    <Copy
                      onClick={() => {
                        navigator.clipboard.writeText(settings.graphTenantId);
                        triggerToast('info', 'Tenant ID Copied', settings.graphTenantId);
                      }}
                      className="w-3.5 h-3.5 absolute right-3 top-3 text-[#8a919e] hover:text-white cursor-pointer"
                    />
                  </div>
                </div>

                {/* Client Secret Value (Masked) */}
                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold flex items-center gap-1">
                    <span>Client Secret Value</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showGraphSecret ? 'text' : 'password'}
                      value={settings.graphSecretValue}
                      onChange={(e) => setSettings({ ...settings, graphSecretValue: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-3 pr-10 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGraphSecret(!showGraphSecret)}
                      className="absolute right-3 top-2.5 text-[#8a919e] hover:text-white"
                    >
                      {showGraphSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Certificate Fingerprint */}
                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold flex items-center justify-between">
                    <span>mTLS Certificate Thumbprint (Optional)</span>
                    <span className="text-[10px] text-emerald-400 font-mono">SHA-256 Valid</span>
                  </label>
                  <input
                    type="text"
                    value={settings.certificateFingerprint}
                    onChange={(e) => setSettings({ ...settings, certificateFingerprint: e.target.value })}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                  />
                </div>
              </div>

              {/* Test Result Output Box (If tested) */}
              {graphTestResult && (
                <div className="bg-[#090d16] border border-cyan-500/40 rounded-md p-3.5 font-mono text-xs space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between text-cyan-400 font-bold">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Graph API Handshake Verified ({graphTestResult.latencyMs}ms)
                    </span>
                    <span className="text-[10px] text-[#8a919e]">{graphTestResult.graphEndpoint}</span>
                  </div>
                  <div className="text-[11px] text-[#a3c9ff] grid grid-cols-2 gap-2 pt-1 border-t border-[#1e2532]">
                    <div>
                      <span className="text-[#8a919e]">Publisher:</span> {graphTestResult.publisherTenant}
                    </div>
                    <div>
                      <span className="text-[#8a919e]">GDAP Consents Verified:</span> {graphTestResult.gdapConsentsVerified} Clients
                    </div>
                  </div>
                  <div className="pt-1">
                    <div className="text-[10px] text-[#8a919e] uppercase font-bold mb-1">Granted Directory Scopes:</div>
                    <div className="flex flex-wrap gap-1">
                      {graphTestResult.verifiedScopes.map((scope: string) => (
                        <span key={scope} className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] px-1.5 py-0.5 rounded">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* GDAP Partner Relationship Health Table */}
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-5 shadow-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#272f3d] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Granular Delegated Admin Privileges (GDAP) Health Directory
                  </h3>
                  <p className="text-[11px] text-[#8a919e]">
                    Active partner consent relationships and authorized security roles across client tenants.
                  </p>
                </div>

                <div className="relative min-w-[240px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
                  <input
                    type="text"
                    value={gdapSearch}
                    onChange={(e) => setGdapSearch(e.target.value)}
                    placeholder="Search tenant name or role..."
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider font-mono border-b border-[#272f3d]">
                    <tr>
                      <th className="py-2.5 px-3">Client Tenant Name</th>
                      <th className="py-2.5 px-3">Tenant ID GUID</th>
                      <th className="py-2.5 px-3">Granted GDAP Roles</th>
                      <th className="py-2.5 px-3">Expiration Date</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {filteredGdapTenants.map((g) => (
                      <tr key={g.id} className="hover:bg-[#161f2e] transition-colors text-[#c0c7d4]">
                        <td className="py-2.5 px-3 font-bold text-white">{g.tenantName}</td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-[#8a919e]">{g.tenantId}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {g.roles.map((r) => (
                              <span key={r} className="bg-[#181c22] border border-[#272f3d] text-[9px] text-[#a3c9ff] px-1.5 py-0.5 rounded font-mono">
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs">{g.expirationDate}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={cn(
                              'text-[10px] font-mono font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1',
                              g.status === 'active'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            )}
                          >
                            {g.status === 'active' ? 'Active 🟢' : 'Expiring Soon 🟡'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              triggerToast('info', 'GDAP Consent Refresh Triggered', `Initiated 1-Click GDAP extension request for ${g.tenantName}.`);
                            }}
                            className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-all text-[11px] px-2 font-semibold"
                          >
                            Re-Authorize
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PSA, RMM & SECURITY INTEGRATION VAULT */}
        {activeTab === 'connectors' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            {/* Toolbar Filter */}
            <div className="flex items-center justify-between bg-[#101419] border border-[#272f3d] p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-white">Integration Vault Categories</span>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => setConnectorCategoryFilter('all')}
                  className={cn(
                    'px-2.5 py-1 rounded font-semibold transition-all',
                    connectorCategoryFilter === 'all' ? 'bg-[#0078d4] text-white' : 'bg-[#181c22] text-[#8a919e] hover:text-white'
                  )}
                >
                  All ({connectors.length})
                </button>
                <button
                  onClick={() => setConnectorCategoryFilter('psa')}
                  className={cn(
                    'px-2.5 py-1 rounded font-semibold transition-all',
                    connectorCategoryFilter === 'psa' ? 'bg-[#0078d4] text-white' : 'bg-[#181c22] text-[#8a919e] hover:text-white'
                  )}
                >
                  PSA Ticketing (3)
                </button>
                <button
                  onClick={() => setConnectorCategoryFilter('rmm_security')}
                  className={cn(
                    'px-2.5 py-1 rounded font-semibold transition-all',
                    connectorCategoryFilter === 'rmm_security' ? 'bg-[#0078d4] text-white' : 'bg-[#181c22] text-[#8a919e] hover:text-white'
                  )}
                >
                  RMM &amp; SIEM (3)
                </button>
                <button
                  onClick={() => setConnectorCategoryFilter('notification')}
                  className={cn(
                    'px-2.5 py-1 rounded font-semibold transition-all',
                    connectorCategoryFilter === 'notification' ? 'bg-[#0078d4] text-white' : 'bg-[#181c22] text-[#8a919e] hover:text-white'
                  )}
                >
                  Notifications (1)
                </button>
                <button
                  onClick={() => setConnectorCategoryFilter('syslog')}
                  className={cn(
                    'px-2.5 py-1 rounded font-semibold transition-all',
                    connectorCategoryFilter === 'syslog' ? 'bg-[#0078d4] text-white' : 'bg-[#181c22] text-[#8a919e] hover:text-white'
                  )}
                >
                  Syslog TLS (1)
                </button>
              </div>
            </div>

            {/* Grid of Connectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredConnectors.map((c) => {
                const isSecretVisible = visibleConnectorSecrets[c.id] || false;

                return (
                  <div
                    key={c.id}
                    className="bg-[#101419] border border-[#272f3d] hover:border-cyan-500/30 rounded-lg p-4 shadow-lg space-y-3 transition-all"
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded bg-[#181c22] border border-[#272f3d] flex items-center justify-center text-amber-400 font-bold font-mono text-xs">
                          {c.provider.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-white">{c.name}</h3>
                          <p className="text-[10px] text-[#8a919e] font-mono">{c.tenantOrCompanyId}</p>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                          c.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : 'bg-red-500/20 text-red-400 border-red-500/40'
                        )}
                      >
                        {c.status.toUpperCase()} 🟢
                      </span>
                    </div>

                    {/* Endpoint URL & Client ID */}
                    <div className="space-y-1.5 text-xs font-mono">
                      <div className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-[11px] text-[#8a919e] truncate">
                        <span className="text-[#0078d4] font-bold">URI:</span> {c.apiUrl}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-[#181c22] border border-[#272f3d] rounded p-1.5 truncate">
                          <span className="text-[#8a919e]">Client ID:</span> <span className="text-white">{c.clientId}</span>
                        </div>
                        <div className="bg-[#181c22] border border-[#272f3d] rounded p-1.5 flex items-center justify-between">
                          <span className="text-[#8a919e]">Secret:</span>
                          <span className="text-white truncate">
                            {isSecretVisible ? c.secretKey : '••••••••••••••••'}
                          </span>
                          <button
                            onClick={() => toggleConnectorSecret(c.id)}
                            className="text-[#8a919e] hover:text-white ml-1"
                          >
                            {isSecretVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#1e2532] text-xs">
                      <span className="text-[10px] text-[#8a919e]">Synced {c.lastSyncAt} • {c.deliveries24h.toLocaleString()} req/24h</span>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestConnectorSync(c)}
                          className="bg-[#1f293d] hover:bg-[#2a3752] text-cyan-300 border border-cyan-500/30 px-2.5 py-1 rounded text-[11px] font-bold transition-all"
                        >
                          ⚡ Test Sync
                        </button>
                        <button
                          onClick={() => handleOpenEditConnector(c)}
                          className="bg-[#181c22] hover:bg-[#222832] text-[#a3c9ff] border border-[#272f3d] px-2.5 py-1 rounded text-[11px] font-semibold transition-all"
                        >
                          Edit Keys
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: ENGINE POLLING & SYSTEM PARAMETERS */}
        {activeTab === 'engine' && (
          <div className="space-y-4 max-w-5xl mx-auto">
            {/* Polling Cadence Selector Card */}
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-5 shadow-lg space-y-4">
              <div className="border-b border-[#272f3d] pb-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                  Global Engine Polling Cadence &amp; Backoff Controls
                </h2>
                <p className="text-[11px] text-[#8a919e]">
                  Configure Microsoft Graph API query frequencies, worker thread allocations, and rate limit circuit breakers.
                </p>
              </div>

              {/* Slider for Polling Interval */}
              <div className="space-y-3 bg-[#181c22] border border-[#272f3d] p-4 rounded-md">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Graph API Delta Sync Interval</span>
                  <span className="font-mono text-cyan-400 font-bold bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
                    Every {settings.pollingIntervalMinutes} Minutes (Active)
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  {[1, 5, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setSettings({ ...settings, pollingIntervalMinutes: mins })}
                      className={cn(
                        'py-2 rounded-md font-mono font-bold transition-all border',
                        settings.pollingIntervalMinutes === mins
                          ? 'bg-[#0078d4] text-white border-[#0078d4] shadow'
                          : 'bg-[#101419] text-[#8a919e] hover:text-white border-[#272f3d]'
                      )}
                    >
                      {mins} Min {mins === 5 && '(Rec)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Circuit Breakers & Retries */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* 429 Throttle Circuit Breaker */}
                <div className="bg-[#181c22] border border-[#272f3d] p-4 rounded-md space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">HTTP 429 Throttle Auto-Pause</span>
                    <input
                      type="checkbox"
                      checked={settings.throttleOn429}
                      onChange={(e) => setSettings({ ...settings, throttleOn429: e.target.checked })}
                      className="w-4 h-4 rounded bg-[#101419] border-[#272f3d] text-[#0078d4]"
                    />
                  </div>
                  <p className="text-[11px] text-[#8a919e]">
                    Automatically back off and queue Graph API requests when Microsoft throttling headers are detected.
                  </p>
                </div>

                {/* Audit Retention Window */}
                <div className="bg-[#181c22] border border-[#272f3d] p-4 rounded-md space-y-2">
                  <label className="font-bold text-white block">Telemetry &amp; Audit Log Retention</label>
                  <select
                    value={settings.auditRetentionDays}
                    onChange={(e) => setSettings({ ...settings, auditRetentionDays: Number(e.target.value) })}
                    className="w-full bg-[#101419] border border-[#272f3d] text-white rounded-md px-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
                  >
                    <option value={30}>30 Days Storage Window</option>
                    <option value={90}>90 Days (Recommended for SOC Compliance)</option>
                    <option value={365}>1 Year Immutable Cold Storage</option>
                    <option value={9999}>Indefinite Retention</option>
                  </select>
                </div>
              </div>

              {/* Parallel Workers allocation */}
              <div className="bg-[#181c22] border border-[#272f3d] p-4 rounded-md space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Parallel Sync Worker Threads</span>
                  <span className="font-mono text-purple-300 font-bold">{settings.maxWorkerThreads} Worker Threads</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={32}
                  step={4}
                  value={settings.maxWorkerThreads}
                  onChange={(e) => setSettings({ ...settings, maxWorkerThreads: Number(e.target.value) })}
                  className="w-full accent-[#0078d4]"
                />
                <div className="flex justify-between text-[10px] text-[#8a919e] font-mono">
                  <span>4 Workers (Low Compute)</span>
                  <span>16 Workers (Balanced)</span>
                  <span>32 Workers (High Throughput)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PLATFORM TEAM & RBAC MANAGEMENT */}
        {activeTab === 'rbac' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-5 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#272f3d] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-400" />
                    Internal MSP Technician Access &amp; RBAC Security
                  </h2>
                  <p className="text-[11px] text-[#8a919e]">
                    Administrative seats, MFA enforcement rules, and IP whitelisting for internal technicians.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search technician name..."
                      className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    + Invite New Technician
                  </button>
                </div>
              </div>

              {/* Technician Access Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider font-mono border-b border-[#272f3d]">
                    <tr>
                      <th className="py-2.5 px-3">Technician Name</th>
                      <th className="py-2.5 px-3">UPN / Email</th>
                      <th className="py-2.5 px-3">Role Level</th>
                      <th className="py-2.5 px-3">MFA Status</th>
                      <th className="py-2.5 px-3">Last Active</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#161f2e] transition-colors text-[#c0c7d4]">
                        <td className="py-2.5 px-3 font-bold text-white flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-[10px]">
                            {u.name.substring(0, 2).toUpperCase()}
                          </div>
                          {u.name}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#8a919e]">{u.upn}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={cn(
                              'text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase',
                              u.role === 'super_admin'
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                : u.role === 'l2_operator'
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                : 'bg-[#181c22] text-[#8a919e] border-[#272f3d]'
                            )}
                          >
                            {u.role.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded">
                            ENFORCED 🟢
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#8a919e] font-mono">{u.lastActive}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              triggerToast('info', 'Permissions Updated', `Modified access policy for ${u.name}.`);
                            }}
                            className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#a3c9ff] rounded text-[11px] px-2 font-semibold"
                          >
                            Edit Role
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: WHITE-LABEL & PORTAL CUSTOMIZATION */}
        {activeTab === 'branding' && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-5 shadow-lg space-y-4">
              <div className="border-b border-[#272f3d] pb-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Palette className="w-4 h-4 text-pink-400" />
                  White-Label Branding &amp; Custom Subdomain Configuration
                </h2>
                <p className="text-[11px] text-[#8a919e]">
                  Customize platform title, custom CNAME domain, logo branding, and client-facing portal visual themes.
                </p>
              </div>

              {/* Form Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold">MSP Platform Name</label>
                  <input
                    type="text"
                    value={settings.mspName}
                    onChange={(e) => setSettings({ ...settings, mspName: e.target.value })}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-bold focus:outline-none focus:border-[#0078d4]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold">Custom Portal Subdomain (CNAME)</label>
                  <input
                    type="text"
                    value={settings.customDomain}
                    onChange={(e) => setSettings({ ...settings, customDomain: e.target.value })}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-cyan-300 font-mono focus:outline-none focus:border-[#0078d4]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold">Company Logo URL</label>
                  <input
                    type="text"
                    value={settings.logoUrl}
                    onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[#8a919e] font-semibold">Support Email Address</label>
                  <input
                    type="text"
                    value={settings.supportEmail}
                    onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                  />
                </div>
              </div>

              {/* Theme Palette Picker */}
              <div className="space-y-2 pt-2 border-t border-[#1e2532] text-xs">
                <label className="text-white font-bold block">Console Color Palette &amp; Theme Accent</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {['Dark SOC Default', 'Midnight Blue', 'Cyber Emerald', 'Obsidian Purple'].map((theme) => (
                    <button
                      key={theme}
                      onClick={() => setSettings({ ...settings, accentTheme: theme as any })}
                      className={cn(
                        'p-3 rounded-lg border text-left font-semibold transition-all',
                        settings.accentTheme === theme
                          ? 'bg-[#0078d4]/20 border-[#0078d4] text-white shadow'
                          : 'bg-[#181c22] border-[#272f3d] text-[#8a919e] hover:text-white'
                      )}
                    >
                      <div className="text-xs">{theme}</div>
                      <div className="text-[10px] text-[#8a919e] font-mono mt-1">NOC High Contrast</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview Box */}
              <div className="bg-[#090d16] border border-[#272f3d] rounded-md p-4 space-y-2">
                <span className="text-[10px] uppercase tracking-wider text-[#8a919e] font-bold block">
                  🎨 Live Client Portal Branding Preview
                </span>
                <div className="bg-[#101419] border border-[#272f3d] rounded-md p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={settings.logoUrl}
                      alt="MSP Logo"
                      className="w-7 h-7 rounded object-cover border border-[#272f3d]"
                    />
                    <div>
                      <div className="text-xs font-bold text-white">{settings.mspName}</div>
                      <div className="text-[10px] text-cyan-400 font-mono">https://{settings.customDomain}</div>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono border border-emerald-500/40">
                    SECURE PORTAL READY
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: AUDIT CHANGE HISTORY DRAWER */}
      {showAuditDrawer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end animate-fadeIn">
          <div className="w-full max-w-md bg-[#101419] border-l border-[#272f3d] h-full flex flex-col p-4 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" />
                <h2 className="text-sm font-bold text-white">Settings Audit History Log</h2>
              </div>
              <button onClick={() => setShowAuditDrawer(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="bg-[#181c22] border border-[#272f3d] rounded p-3 space-y-1">
                  <div className="flex justify-between text-[10px] text-[#8a919e]">
                    <span>{log.timestamp}</span>
                    <span className="text-cyan-400">{log.operatorUpn}</span>
                  </div>
                  <div className="font-bold text-white text-xs">{log.category}: {log.settingName}</div>
                  <div className="text-[11px] text-[#8a919e] grid grid-cols-2 gap-1 pt-1 border-t border-[#272f3d]">
                    <div className="text-red-400 line-through truncate">Old: {log.previousValue}</div>
                    <div className="text-emerald-400 truncate">New: {log.newValue}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: INVITE TECHNICIAN MODAL */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-purple-400" />
                Invite Administrative Technician
              </h2>
              <button onClick={() => setShowInviteModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Technician Full Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Jordan Miller"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">User Principal Name (UPN / Email)</label>
                <input
                  type="text"
                  value={newUserUpn}
                  onChange={(e) => setNewUserUpn(e.target.value)}
                  placeholder="jordan.m@mccawconsulting.com"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Platform RBAC Role Level</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full bg-[#181c22] border border-[#272f3d] text-white rounded px-3 py-2 focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="super_admin">Super Admin / Lead Architect</option>
                  <option value="l2_operator">L2 Operator (Remediation &amp; Execution)</option>
                  <option value="sales_specialist">Billing &amp; Sales Specialist</option>
                  <option value="auditor">Read-Only Auditor</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#272f3d]">
              <button
                onClick={() => setShowInviteModal(false)}
                className="px-3 py-1.5 rounded text-xs bg-[#181c22] text-[#8a919e] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteUser}
                className="px-3.5 py-1.5 rounded text-xs font-bold bg-[#0078d4] hover:bg-[#0063b1] text-white"
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT CONNECTOR MODAL */}
      {showEditConnectorModal && selectedConnector && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg w-full max-w-lg p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Edit Credentials for {selectedConnector.name}
              </h2>
              <button onClick={() => setShowEditConnectorModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="text-[#8a919e] block mb-1">API Base URL</label>
                <input
                  type="text"
                  value={editConnUrl}
                  onChange={(e) => setEditConnUrl(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="text-[#8a919e] block mb-1">Client ID / App Key</label>
                <input
                  type="text"
                  value={editConnClientId}
                  onChange={(e) => setEditConnClientId(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="text-[#8a919e] block mb-1">API Secret Key / Bearer Token</label>
                <input
                  type="password"
                  value={editConnSecret}
                  onChange={(e) => setEditConnSecret(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none focus:border-[#0078d4]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#272f3d]">
              <button
                onClick={() => setShowEditConnectorModal(false)}
                className="px-3 py-1.5 rounded text-xs bg-[#181c22] text-[#8a919e] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConnectorEdit}
                className="px-3.5 py-1.5 rounded text-xs font-bold bg-[#0078d4] hover:bg-[#0063b1] text-white"
              >
                Save Credentials
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

