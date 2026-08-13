// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Grid,
  Flame,
  ShieldAlert,
  Activity,
  Filter,
  Search,
  Zap,
  Lock,
  RefreshCw,
  SlidersHorizontal,
  ExternalLink,
  Eye,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  LayoutGrid,
  ListFilter,
  Check,
  ArrowUpRight,
  Users,
  Server,
  Layers,
  Clock,
  Key,
  Smartphone,
  Mail,
  Shield,
  CreditCard,
  UserCheck,
  Info,
  X,
  Play,
  CheckCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant, ToastMessage } from '../types';

// ==========================================
// Types & Domain Definitions
// ==========================================

export type DomainKey =
  | 'identity'
  | 'ca'
  | 'exchange'
  | 'intune'
  | 'defender'
  | 'licensing'
  | 'pim';

export interface DomainMetric {
  key: DomainKey;
  label: string;
  iconName: string;
  score: number; // 0-100
  status: 'healthy' | 'warning' | 'critical';
  miniText: string;
  lastPolled: string;
  graphEndpoint: string;
  activeAlerts: number;
  drifts: {
    id: string;
    title: string;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    detectedAt: string;
    description: string;
    safetyLevel: 'Safe' | 'Gated' | 'Blocked';
  }[];
}

export interface HeatmapTenant {
  id: string;
  name: string;
  domain: string;
  tier: 'Enterprise' | 'Business' | 'Gov' | 'MSP Standard';
  secureScore: number;
  domains: Record<DomainKey, DomainMetric>;
}

export interface DomainAction {
  id: string;
  label: string;
  description: string;
  safetyLevel: 'Safe' | 'Gated' | 'Blocked';
  graphApiPayload: string;
}

// Map of 1-click write actions per domain
const DOMAIN_ACTIONS: Record<DomainKey, DomainAction[]> = {
  identity: [
    {
      id: 'reset-mfa',
      label: 'Reset MFA & Force Re-registration',
      description: 'Invalidates existing MFA methods for at-risk accounts and prompts user on next login.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/users/{id}/authentication/methods/reset'
    },
    {
      id: 'revoke-sessions',
      label: 'Revoke All Active OAuth Sessions',
      description: 'Executes invalidateAllRefreshTokens via Graph API for compromised UPNs.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/users/{id}/revokeSignInSessions'
    },
    {
      id: 'gen-tap',
      label: 'Generate Temporary Access Pass (TAP)',
      description: 'Generates a one-time 1-hour TAP code for passwordless admin recovery.',
      safetyLevel: 'Gated',
      graphApiPayload: 'POST /v1.0/users/{id}/authentication/temporaryAccessPassMethods'
    },
    {
      id: 'enforce-sec-defaults',
      label: 'Enforce Security Defaults',
      description: 'Enables baseline security defaults tenant-wide across Entra ID.',
      safetyLevel: 'Safe',
      graphApiPayload: 'PATCH /v1.0/policies/identitySecurityDefaultsEnforcementPolicy'
    }
  ],
  ca: [
    {
      id: 'enforce-baseline-ca',
      label: 'Re-enforce Baseline CA Policies',
      description: 'Restores default Conditional Access policy set and overrides disabled switches.',
      safetyLevel: 'Safe',
      graphApiPayload: 'PATCH /v1.0/identity/conditionalAccess/policies/{id}'
    },
    {
      id: 'block-legacy-auth',
      label: 'Block Legacy Authentication',
      description: 'Applies zero-trust rule blocking Basic Auth (POP, IMAP, SMTP AUTH).',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/identity/conditionalAccess/policies'
    },
    {
      id: 'require-managed-dev',
      label: 'Require Compliant Device for Admins',
      description: 'Restricts Entra Admin portal access strictly to Intune-compliant hardware.',
      safetyLevel: 'Gated',
      graphApiPayload: 'POST /v1.0/identity/conditionalAccess/policies'
    },
    {
      id: 'isolate-drift-upns',
      label: 'Isolate Non-Compliant UPNs',
      description: 'Puts users attempting to bypass CA into restricted Quarantine group.',
      safetyLevel: 'Blocked',
      graphApiPayload: 'POST /v1.0/groups/{id}/members/$ref'
    }
  ],
  exchange: [
    {
      id: 'enable-anti-phish',
      label: 'Enable Anti-Phishing Strict Preset',
      description: 'Sets Mail Flow protection profile to Strict preset in Exchange Online Defense.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/security/threatProtection/antiphish/strict'
    },
    {
      id: 'block-autoforward',
      label: 'Block External Auto-Forwarding',
      description: 'Disables mail flow rules that allow automated forwarding to external domains.',
      safetyLevel: 'Safe',
      graphApiPayload: 'PATCH /v1.0/transportRules/block-external-forwarding'
    },
    {
      id: 'disable-basic-auth-exo',
      label: 'Disable EXO Basic Authentication',
      description: 'Turns off basic auth protocols across all Exchange Online mailboxes.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/exchange/settings/disableBasicAuth'
    },
    {
      id: 'audit-connectors',
      label: 'Audit & Lock Inbound Connectors',
      description: 'Validates TLS certificate requirements on all SMTP inbound connectors.',
      safetyLevel: 'Gated',
      graphApiPayload: 'GET /v1.0/exchange/inboundConnectors'
    }
  ],
  intune: [
    {
      id: 'sync-compliance',
      label: 'Enforce Device Compliance Sync',
      description: 'Triggers instant re-evaluation of all enrolled MDM devices via Intune.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/deviceManagement/managedDevices/{id}/syncDevice'
    },
    {
      id: 'remote-lock-uncompliant',
      label: 'Remote Lock Non-Compliant Endpoint',
      description: 'Sends remote lock payload to workstations failing compliance evaluation.',
      safetyLevel: 'Gated',
      graphApiPayload: 'POST /v1.0/deviceManagement/managedDevices/{id}/remoteLock'
    },
    {
      id: 'block-jailbroken',
      label: 'Block Jailbroken & Unenrolled',
      description: 'Blocks corporate email and Teams access on jailbroken/rooted mobile OS.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/deviceManagement/deviceCompliancePolicies'
    },
    {
      id: 'push-bitlocker-escrow',
      label: 'Escrow BitLocker Keys to Entra',
      description: 'Forces all Windows 11 endpoints to escrow recovery keys to Entra ID.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/informationProtection/bitlocker/recoveryKeys/backup'
    }
  ],
  defender: [
    {
      id: 'isolate-host',
      label: 'Isolate Compromised Endpoint',
      description: 'Cuts network connectivity for infected endpoint while retaining EDR socket.',
      safetyLevel: 'Blocked',
      graphApiPayload: 'POST /v1.0/security/alerts_v2/{id}/isolate'
    },
    {
      id: 'quarantine-malicious-mail',
      label: 'Quarantine Suspicious Mail Item',
      description: 'Purges detected phish/malware emails from all tenant mailboxes in bulk.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/security/threatProtection/quarantineMail'
    },
    {
      id: 'deploy-defender-sensor',
      label: 'Push Defender for Endpoint Sensor',
      description: 'Deploys MDE onboarding package to unmonitored devices.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/deviceManagement/intune/mdeOnboarding'
    },
    {
      id: 'trigger-air-investigation',
      label: 'Trigger Automated Incident Investigation',
      description: 'Launches automated investigation & self-healing playbook in Defender 365.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/security/incidents/{id}/runAIR'
    }
  ],
  licensing: [
    {
      id: 'reclaim-unused-licenses',
      label: 'Reclaim Inactive E5 Licenses',
      description: 'Unassigns paid licenses from accounts inactive for >45 days to optimize spend.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/users/{id}/assignLicense'
    },
    {
      id: 'convert-shared-mailbox',
      label: 'Convert Terminated Mailboxes to Shared',
      description: 'Converts user mailbox to shared mailbox and removes paid EXO license.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/users/{id}/convertToSharedMailbox'
    },
    {
      id: 'downgrade-overprovisioned',
      label: 'Right-size Overprovisioned Users',
      description: 'Swaps E5 to Business Premium for users with zero E5 feature consumption.',
      safetyLevel: 'Gated',
      graphApiPayload: 'POST /v1.0/users/{id}/assignLicense'
    },
    {
      id: 'auto-assign-group-licensing',
      label: 'Sync Group-Based Licensing',
      description: 'Enforces group-based license allocation rules across Entra ID.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/groups/{id}/assignLicenses'
    }
  ],
  pim: [
    {
      id: 'revoke-perm-admin',
      label: 'Revoke Standing Global Admin Roles',
      description: 'Converts permanent Global Admin assignments into PIM eligible requests.',
      safetyLevel: 'Gated',
      graphApiPayload: 'POST /v1.0/roleManagement/directory/roleAssignments'
    },
    {
      id: 'enforce-jit-mfa',
      label: 'Enforce JIT MFA + Ticket Approval',
      description: 'Requires ticket ID and dual-admin approval for PIM role activation.',
      safetyLevel: 'Safe',
      graphApiPayload: 'PATCH /v1.0/roleManagement/directory/roleEligibilityScheduleRequests'
    },
    {
      id: 'expire-active-roles',
      label: 'Expire All Active Elevated Sessions',
      description: 'Immediately terminates active PIM activations and resets token timers.',
      safetyLevel: 'Safe',
      graphApiPayload: 'POST /v1.0/roleManagement/directory/roleAssignmentScheduleRequests/deactivate'
    },
    {
      id: 'emergency-access-audit',
      label: 'Trigger Emergency Break-Glass Audit',
      description: 'Verifies break-glass admin accounts are excluded from CA and monitored.',
      safetyLevel: 'Safe',
      graphApiPayload: 'GET /v1.0/reports/getBreakGlassAccountAudit'
    }
  ]
};

// Domain definitions
const DOMAIN_METADATA: { key: DomainKey; name: string; icon: React.ReactNode; shortLabel: string }[] = [
  { key: 'identity', name: 'Identity & MFA', icon: <Key className="w-4 h-4" />, shortLabel: 'Identity' },
  { key: 'ca', name: 'Conditional Access', icon: <Lock className="w-4 h-4" />, shortLabel: 'Cond. Access' },
  { key: 'exchange', name: 'Exchange / Mail Flow', icon: <Mail className="w-4 h-4" />, shortLabel: 'Exchange' },
  { key: 'intune', name: 'Intune & MDM', icon: <Smartphone className="w-4 h-4" />, shortLabel: 'Intune' },
  { key: 'defender', name: 'Defender & EDR', icon: <Shield className="w-4 h-4" />, shortLabel: 'Defender' },
  { key: 'licensing', name: 'Licensing & Cost', icon: <CreditCard className="w-4 h-4" />, shortLabel: 'Licensing' },
  { key: 'pim', name: 'PIM & Privileges', icon: <UserCheck className="w-4 h-4" />, shortLabel: 'PIM & Priv' }
];

// Mock Heatmap Tenants Data
const INITIAL_HEATMAP_TENANTS: HeatmapTenant[] = [
  {
    id: 't-1',
    name: 'Contoso Corporation',
    domain: 'contoso.com',
    tier: 'Enterprise',
    secureScore: 88.4,
    domains: {
      identity: {
        key: 'identity',
        label: 'Identity & MFA',
        iconName: 'Key',
        score: 98,
        status: 'healthy',
        miniText: 'MFA: 98%',
        lastPolled: '1m ago',
        graphEndpoint: '/v1.0/users/delta',
        activeAlerts: 0,
        drifts: []
      },
      ca: {
        key: 'ca',
        label: 'Conditional Access',
        iconName: 'Lock',
        score: 72,
        status: 'warning',
        miniText: 'CA: 2 Disabled',
        lastPolled: '2m ago',
        graphEndpoint: '/v1.0/identity/conditionalAccess/policies',
        activeAlerts: 1,
        drifts: [
          {
            id: 'd-c1',
            title: 'CA-02 Admin Location Policy Disabled',
            severity: 'Medium',
            detectedAt: '12m ago',
            description: 'Conditional access policy requiring trusted IP for global admins was disabled by m.vance.',
            safetyLevel: 'Safe'
          }
        ]
      },
      exchange: {
        key: 'exchange',
        label: 'Exchange / Mail Flow',
        iconName: 'Mail',
        score: 95,
        status: 'healthy',
        miniText: 'Mail: Clean',
        lastPolled: '1m ago',
        graphEndpoint: '/v1.0/transportRules',
        activeAlerts: 0,
        drifts: []
      },
      intune: {
        key: 'intune',
        label: 'Intune & MDM',
        iconName: 'Smartphone',
        score: 89,
        status: 'healthy',
        miniText: 'MDM: 94%',
        lastPolled: '3m ago',
        graphEndpoint: '/v1.0/deviceManagement/managedDevices',
        activeAlerts: 0,
        drifts: []
      },
      defender: {
        key: 'defender',
        label: 'Defender & EDR',
        iconName: 'Shield',
        score: 64,
        status: 'critical',
        miniText: 'Def: 3 High Alerts',
        lastPolled: '30s ago',
        graphEndpoint: '/v1.0/security/alerts_v2',
        activeAlerts: 3,
        drifts: [
          {
            id: 'd-d1',
            title: 'Suspicious PowerShell Execution on Executive Workstation',
            severity: 'Critical',
            detectedAt: '4m ago',
            description: 'Defender MDE detected base64 encoded payload executed via cmd.exe on DESKTOP-EX01.',
            safetyLevel: 'Blocked'
          },
          {
            id: 'd-d2',
            title: 'Impossible Travel Alert Detected for Admin UPN',
            severity: 'High',
            detectedAt: '18m ago',
            description: 'Admin account logged in from Seattle, WA and Bucharest, Romania within 15 minutes.',
            safetyLevel: 'Safe'
          }
        ]
      },
      licensing: {
        key: 'licensing',
        label: 'Licensing & Cost',
        iconName: 'CreditCard',
        score: 82,
        status: 'warning',
        miniText: 'Lic: 14 Unassigned E5',
        lastPolled: '5m ago',
        graphEndpoint: '/v1.0/subscribedSkus',
        activeAlerts: 1,
        drifts: [
          {
            id: 'd-l1',
            title: '14 Unassigned M365 E5 Licenses',
            severity: 'Low',
            detectedAt: '1h ago',
            description: '14 unassigned M365 E5 seats ($798/mo waste) idle for over 45 days.',
            safetyLevel: 'Safe'
          }
        ]
      },
      pim: {
        key: 'pim',
        label: 'PIM & Privileges',
        iconName: 'UserCheck',
        score: 96,
        status: 'healthy',
        miniText: 'PIM: 2 Active JIT',
        lastPolled: '2m ago',
        graphEndpoint: '/v1.0/roleManagement/directory/roleAssignments',
        activeAlerts: 0,
        drifts: []
      }
    }
  },
  {
    id: 't-2',
    name: 'Fabrikam Inc',
    domain: 'fabrikam.com',
    tier: 'Enterprise',
    secureScore: 59.2,
    domains: {
      identity: {
        key: 'identity',
        label: 'Identity & MFA',
        iconName: 'Key',
        score: 48,
        status: 'critical',
        miniText: 'MFA: 3 Admins No MFA',
        lastPolled: '45s ago',
        graphEndpoint: '/v1.0/users/delta',
        activeAlerts: 3,
        drifts: [
          {
            id: 'd-f1',
            title: '3 Global Admins Missing MFA Requirement',
            severity: 'Critical',
            detectedAt: '2m ago',
            description: 'Accounts admin1@fabrikam.com, syncadmin@fabrikam.com do not have registered MFA methods.',
            safetyLevel: 'Safe'
          }
        ]
      },
      ca: {
        key: 'ca',
        label: 'Conditional Access',
        iconName: 'Lock',
        score: 55,
        status: 'critical',
        miniText: 'CA: Basic Auth Allowed',
        lastPolled: '1m ago',
        graphEndpoint: '/v1.0/identity/conditionalAccess/policies',
        activeAlerts: 2,
        drifts: [
          {
            id: 'd-fc1',
            title: 'Legacy Auth Protocols Unblocked',
            severity: 'High',
            detectedAt: '22m ago',
            description: 'POP3 and IMAP4 basic authentication requests allowed through tenant firewall rules.',
            safetyLevel: 'Safe'
          }
        ]
      },
      exchange: {
        key: 'exchange',
        label: 'Exchange / Mail Flow',
        iconName: 'Mail',
        score: 78,
        status: 'warning',
        miniText: 'Mail: External Forwarding',
        lastPolled: '3m ago',
        graphEndpoint: '/v1.0/transportRules',
        activeAlerts: 1,
        drifts: [
          {
            id: 'd-fe1',
            title: 'External Auto-Forwarding Transport Rule Active',
            severity: 'Medium',
            detectedAt: '40m ago',
            description: 'Rule "Forward-Finance" routes copy of finance emails to external Gmail recipient.',
            safetyLevel: 'Safe'
          }
        ]
      },
      intune: {
        key: 'intune',
        label: 'Intune & MDM',
        iconName: 'Smartphone',
        score: 88,
        status: 'healthy',
        miniText: 'MDM: 92%',
        lastPolled: '2m ago',
        graphEndpoint: '/v1.0/deviceManagement/managedDevices',
        activeAlerts: 0,
        drifts: []
      },
      defender: {
        key: 'defender',
        label: 'Defender & EDR',
        iconName: 'Shield',
        score: 91,
        status: 'healthy',
        miniText: 'Def: 0 Alerts',
        lastPolled: '1m ago',
        graphEndpoint: '/v1.0/security/alerts_v2',
        activeAlerts: 0,
        drifts: []
      },
      licensing: {
        key: 'licensing',
        label: 'Licensing & Cost',
        iconName: 'CreditCard',
        score: 96,
        status: 'healthy',
        miniText: 'Lic: 100% Utilized',
        lastPolled: '4m ago',
        graphEndpoint: '/v1.0/subscribedSkus',
        activeAlerts: 0,
        drifts: []
      },
      pim: {
        key: 'pim',
        label: 'PIM & Privileges',
        iconName: 'UserCheck',
        score: 61,
        status: 'warning',
        miniText: 'PIM: 5 Permanent Admins',
        lastPolled: '2m ago',
        graphEndpoint: '/v1.0/roleManagement/directory/roleAssignments',
        activeAlerts: 1,
        drifts: [
          {
            id: 'd-fp1',
            title: '5 Permanent Non-PIM Global Admin Assignments',
            severity: 'Medium',
            detectedAt: '3h ago',
            description: 'Accounts hold permanent elevated role assignments without time-bound JIT expiration.',
            safetyLevel: 'Gated'
          }
        ]
      }
    }
  },
  {
    id: 't-3',
    name: 'Northwind Traders',
    domain: 'northwindtraders.com',
    tier: 'Business',
    secureScore: 92.1,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 100, status: 'healthy', miniText: 'MFA: 100%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 98, status: 'healthy', miniText: 'CA: 0 Drift', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 94, status: 'healthy', miniText: 'Mail: Strict', lastPolled: '2m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 80, status: 'warning', miniText: 'MDM: 12 Unenrolled', lastPolled: '3m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 1, drifts: [{ id: 'd-n1', title: '12 Unenrolled Mobile Devices Accessing Mail', severity: 'Medium', detectedAt: '1h ago', description: 'ActiveSync connection permitted for unenrolled personal iOS devices.', safetyLevel: 'Safe' }] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 97, status: 'healthy', miniText: 'Def: Clean', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 91, status: 'healthy', miniText: 'Lic: Optimal', lastPolled: '4m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 95, status: 'healthy', miniText: 'PIM: Enforced', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-4',
    name: 'Adventure Works',
    domain: 'adventureworks.com',
    tier: 'Enterprise',
    secureScore: 68.5,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 90, status: 'healthy', miniText: 'MFA: 95%', lastPolled: '2m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 85, status: 'healthy', miniText: 'CA: Enforced', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 45, status: 'critical', miniText: 'Mail: Open Relay', lastPolled: '1m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 2, drifts: [{ id: 'd-a1', title: 'Anonymously Accessible SMTP Relay Detected', severity: 'Critical', detectedAt: '10m ago', description: 'Connector allows outbound email sending without authentication.', safetyLevel: 'Safe' }] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 76, status: 'warning', miniText: 'MDM: 5 Jailbroken', lastPolled: '3m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 1, drifts: [{ id: 'd-a2', title: 'Jailbroken iOS Device Accessing Intune App', severity: 'High', detectedAt: '25m ago', description: 'Compromised iOS kernel detected on executive iPad.', safetyLevel: 'Gated' }] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 88, status: 'healthy', miniText: 'Def: Low Risk', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 72, status: 'warning', miniText: 'Lic: $1.2k Waste', lastPolled: '5m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 1, drifts: [{ id: 'd-a3', title: '22 Unassigned Copilot for M365 Seats', severity: 'Low', detectedAt: '2h ago', description: 'Unassigned Copilot licenses ($660/mo) pending assignment.', safetyLevel: 'Safe' }] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 92, status: 'healthy', miniText: 'PIM: Active', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-5',
    name: 'Woodgrove Bank',
    domain: 'woodgrovebank.com',
    tier: 'Gov',
    secureScore: 94.8,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 100, status: 'healthy', miniText: 'MFA: FIDO2 Strict', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 100, status: 'healthy', miniText: 'CA: Zero Trust', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 98, status: 'healthy', miniText: 'Mail: DLP Active', lastPolled: '2m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 96, status: 'healthy', miniText: 'MDM: BitLocker 100%', lastPolled: '1m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 92, status: 'healthy', miniText: 'Def: MDE Active', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 85, status: 'warning', miniText: 'Lic: 4 Expiring Certs', lastPolled: '4m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 1, drifts: [{ id: 'd-w1', title: 'Azure App Registration Cert Expiring in 7 Days', severity: 'Medium', detectedAt: '4h ago', description: 'SSO Certificate for Core-Banking app expiring on July 30th.', safetyLevel: 'Safe' }] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 100, status: 'healthy', miniText: 'PIM: Dual Admin', lastPolled: '1m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-6',
    name: 'Trey Research',
    domain: 'treyresearch.com',
    tier: 'Enterprise',
    secureScore: 54.0,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 50, status: 'critical', miniText: 'MFA: SMS Only', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 2, drifts: [{ id: 'd-tr1', title: 'Weak SMS MFA Method Allowed', severity: 'High', detectedAt: '30m ago', description: 'SIM swap vulnerable SMS method enabled as primary MFA.', safetyLevel: 'Safe' }] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 40, status: 'critical', miniText: 'CA: 0 Policies', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 3, drifts: [{ id: 'd-tr2', title: 'Zero Conditional Access Policies Enforced', severity: 'Critical', detectedAt: '1h ago', description: 'Tenant has no CA rules configured; unrestricted access enabled.', safetyLevel: 'Safe' }] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 80, status: 'healthy', miniText: 'Mail: OK', lastPolled: '3m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 60, status: 'warning', miniText: 'MDM: 40% Compliant', lastPolled: '2m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 1, drifts: [{ id: 'd-tr3', title: '60% Workstations Out of Compliance', severity: 'Medium', detectedAt: '2h ago', description: 'Windows 10 devices missing cumulative security updates.', safetyLevel: 'Safe' }] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 55, status: 'critical', miniText: 'Def: MDE Off', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 2, drifts: [{ id: 'd-tr4', title: 'Defender EDR Uninstalled on 18 Servers', severity: 'Critical', detectedAt: '15m ago', description: 'Antivirus service disabled on hypervisor management servers.', safetyLevel: 'Blocked' }] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 88, status: 'healthy', miniText: 'Lic: Normal', lastPolled: '5m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 52, status: 'warning', miniText: 'PIM: Not Enabled', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 1, drifts: [{ id: 'd-tr5', title: 'PIM License Unassigned to Admins', severity: 'Medium', detectedAt: '5h ago', description: 'Entra ID P2 license missing for 3 privileged administrators.', safetyLevel: 'Safe' }] }
    }
  },
  {
    id: 't-7',
    name: 'Tailspin Toys',
    domain: 'tailspintoys.com',
    tier: 'Business',
    secureScore: 81.3,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 92, status: 'healthy', miniText: 'MFA: 92%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 88, status: 'healthy', miniText: 'CA: Enforced', lastPolled: '2m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 79, status: 'warning', miniText: 'Mail: DKIM Misconfig', lastPolled: '3m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 1, drifts: [{ id: 'd-ts1', title: 'DKIM Selector CNAME Missing in DNS', severity: 'Medium', detectedAt: '12h ago', description: 'Outbound emails failing DKIM validation check at recipient gateways.', safetyLevel: 'Safe' }] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 90, status: 'healthy', miniText: 'MDM: Clean', lastPolled: '1m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 85, status: 'healthy', miniText: 'Def: Clean', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 95, status: 'healthy', miniText: 'Lic: Clean', lastPolled: '4m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 82, status: 'healthy', miniText: 'PIM: Active', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-8',
    name: 'Acme Global Services',
    domain: 'acmeglobal.com',
    tier: 'MSP Standard',
    secureScore: 61.8,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 70, status: 'warning', miniText: 'MFA: 78%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 1, drifts: [{ id: 'd-ag1', title: '14 Guest Users Without MFA Enforcement', severity: 'Medium', detectedAt: '1d ago', description: 'External B2B guest accounts not prompted for MFA.', safetyLevel: 'Safe' }] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 65, status: 'warning', miniText: 'CA: 1 Excluded', lastPolled: '2m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 1, drifts: [{ id: 'd-ag2', title: 'Global Exclusions Group Active in CA', severity: 'Medium', detectedAt: '2d ago', description: 'Dynamic group "All-Staff" excluded from Geo-location restrictions.', safetyLevel: 'Safe' }] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 85, status: 'healthy', miniText: 'Mail: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 42, status: 'critical', miniText: 'MDM: Compliance Off', lastPolled: '1m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 2, drifts: [{ id: 'd-ag3', title: 'Intune Compliance Grace Period Expired', severity: 'High', detectedAt: '3h ago', description: '45 endpoints non-compliant and unblocked from accessing Sharepoint.', safetyLevel: 'Gated' }] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 75, status: 'healthy', miniText: 'Def: Low', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 70, status: 'warning', miniText: 'Lic: 8 Expired', lastPolled: '5m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 1, drifts: [{ id: 'd-ag4', title: '8 Business Premium Seats Expired', severity: 'Medium', detectedAt: '12h ago', description: 'Subscriptions in 30-day grace period before total mailbox lock.', safetyLevel: 'Safe' }] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 80, status: 'healthy', miniText: 'PIM: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-9',
    name: 'CyberDyne Systems',
    domain: 'cyberdyne.io',
    tier: 'Enterprise',
    secureScore: 97.2,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 100, status: 'healthy', miniText: 'MFA: 100%', lastPolled: '30s ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 100, status: 'healthy', miniText: 'CA: Strict', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 96, status: 'healthy', miniText: 'Mail: Strict', lastPolled: '1m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 98, status: 'healthy', miniText: 'MDM: Enforced', lastPolled: '2m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 94, status: 'healthy', miniText: 'Def: Protected', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 92, status: 'healthy', miniText: 'Lic: Clean', lastPolled: '4m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 100, status: 'healthy', miniText: 'PIM: Strict', lastPolled: '1m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-10',
    name: 'Stark Tech Logistics',
    domain: 'starktech.com',
    tier: 'Enterprise',
    secureScore: 71.4,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 85, status: 'healthy', miniText: 'MFA: 90%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 70, status: 'warning', miniText: 'CA: IP Drift', lastPolled: '2m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 1, drifts: [{ id: 'd-st1', title: 'Trusted Location Subnet Mask Expanded', severity: 'Medium', detectedAt: '18h ago', description: 'Subnet /16 added to trusted locations list bypassing MFA.', safetyLevel: 'Safe' }] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 88, status: 'healthy', miniText: 'Mail: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 82, status: 'healthy', miniText: 'MDM: OK', lastPolled: '3m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 58, status: 'critical', miniText: 'Def: Ransomware Risk', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 2, drifts: [{ id: 'd-st2', title: 'Mass File Renaming Alert (Shadow Copies Deleted)', severity: 'Critical', detectedAt: '8m ago', description: 'vssadmin delete shadows executed on file server FS-02.', safetyLevel: 'Blocked' }] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 89, status: 'healthy', miniText: 'Lic: OK', lastPolled: '5m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 75, status: 'warning', miniText: 'PIM: 2 Expiring', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 1, drifts: [{ id: 'd-st3', title: 'PIM Activation Duration Limit Overridden', severity: 'Low', detectedAt: '1d ago', description: 'Role activation set to 24 hours instead of 8 hours max.', safetyLevel: 'Safe' }] }
    }
  },
  {
    id: 't-11',
    name: 'Apex Dynamics',
    domain: 'apexdynamics.com',
    tier: 'Business',
    secureScore: 86.0,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 94, status: 'healthy', miniText: 'MFA: 96%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 0, drifts: [] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 91, status: 'healthy', miniText: 'CA: Clean', lastPolled: '1m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 0, drifts: [] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 70, status: 'warning', miniText: 'Mail: SPF SoftFail', lastPolled: '3m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 1, drifts: [{ id: 'd-ap1', title: 'SPF Record Configured as ~all (SoftFail)', severity: 'Low', detectedAt: '2d ago', description: 'Recommended to set SPF to -all (HardFail) for strict domain protection.', safetyLevel: 'Safe' }] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 88, status: 'healthy', miniText: 'MDM: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 90, status: 'healthy', miniText: 'Def: Active', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 0, drifts: [] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 92, status: 'healthy', miniText: 'Lic: Clean', lastPolled: '4m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 85, status: 'healthy', miniText: 'PIM: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  },
  {
    id: 't-12',
    name: 'Horizon Logistics',
    domain: 'horizonlogistics.io',
    tier: 'MSP Standard',
    secureScore: 63.5,
    domains: {
      identity: { key: 'identity', label: 'Identity & MFA', iconName: 'Key', score: 62, status: 'warning', miniText: 'MFA: 65%', lastPolled: '1m ago', graphEndpoint: '/v1.0/users', activeAlerts: 1, drifts: [{ id: 'd-hl1', title: '35% Users Missing Authenticator App', severity: 'Medium', detectedAt: '6h ago', description: 'Users relying on telephony voice calls for MFA verification.', safetyLevel: 'Safe' }] },
      ca: { key: 'ca', label: 'Conditional Access', iconName: 'Lock', score: 58, status: 'warning', miniText: 'CA: Dev Exemption', lastPolled: '2m ago', graphEndpoint: '/v1.0/identity/conditionalAccess', activeAlerts: 1, drifts: [{ id: 'd-hl2', title: 'Developer UPNs Exempt from Device Compliance', severity: 'Medium', detectedAt: '12h ago', description: 'Dev team bypasses Intune device compliance requirement.', safetyLevel: 'Safe' }] },
      exchange: { key: 'exchange', label: 'Exchange / Mail Flow', iconName: 'Mail', score: 82, status: 'healthy', miniText: 'Mail: OK', lastPolled: '2m ago', graphEndpoint: '/v1.0/transportRules', activeAlerts: 0, drifts: [] },
      intune: { key: 'intune', label: 'Intune & MDM', iconName: 'Smartphone', score: 70, status: 'warning', miniText: 'MDM: 8 Pending Sync', lastPolled: '3m ago', graphEndpoint: '/v1.0/deviceManagement', activeAlerts: 0, drifts: [] },
      defender: { key: 'defender', label: 'Defender & EDR', iconName: 'Shield', score: 50, status: 'critical', miniText: 'Def: Phish Campaign', lastPolled: '1m ago', graphEndpoint: '/v1.0/security/alerts_v2', activeAlerts: 2, drifts: [{ id: 'd-hl3', title: 'Active Credential Harvesting Campaign Targeting HR', severity: 'High', detectedAt: '14m ago', description: '12 employees submitted credentials on fake Microsoft login page.', safetyLevel: 'Safe' }] },
      licensing: { key: 'licensing', label: 'Licensing & Cost', iconName: 'CreditCard', score: 88, status: 'healthy', miniText: 'Lic: OK', lastPolled: '5m ago', graphEndpoint: '/v1.0/subscribedSkus', activeAlerts: 0, drifts: [] },
      pim: { key: 'pim', label: 'PIM & Privileges', iconName: 'UserCheck', score: 74, status: 'warning', miniText: 'PIM: Partial', lastPolled: '2m ago', graphEndpoint: '/v1.0/roleManagement', activeAlerts: 0, drifts: [] }
    }
  }
];

interface TenantHeatmapDashboardProps {
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onOpenRemediationModal?: (actionTitle: string, tenantName: string) => void;
}

export const TenantHeatmapDashboard: React.FC<TenantHeatmapDashboardProps> = ({
  onShowToast,
  onOpenRemediationModal
}) => {
  // State
  const [tenants, setTenants] = useState<HeatmapTenant[]>(INITIAL_HEATMAP_TENANTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [density, setDensity] = useState<'compact' | 'expanded'>('compact');
  const [isPolling, setIsPolling] = useState(false);

  // Hover Tooltip State
  const [hoveredCell, setHoveredCell] = useState<{
    tenantId: string;
    domainKey: DomainKey;
    x: number;
    y: number;
  } | null>(null);

  // Selected Drawer State
  const [drawerData, setDrawerData] = useState<{
    tenant: HeatmapTenant;
    domainKey: DomainKey;
  } | null>(null);

  // Auto-Remediating state
  const [isRemediatingAll, setIsRemediatingAll] = useState(false);

  // Handle Instant Re-Poll
  const handleRePoll = () => {
    setIsPolling(true);
    if (onShowToast) {
      onShowToast('info', 'Graph API Re-Poll Triggered', 'Polled 122 M365 security endpoints across all managed tenants.');
    }
    setTimeout(() => {
      setIsPolling(false);
      // Slightly update random metrics to simulate fresh telemetry
      setTenants((prev) =>
        prev.map((t) => ({
          ...t,
          domains: {
            ...t.domains,
            identity: { ...t.domains.identity, lastPolled: 'Just now' },
            ca: { ...t.domains.ca, lastPolled: 'Just now' },
            exchange: { ...t.domains.exchange, lastPolled: 'Just now' },
            intune: { ...t.domains.intune, lastPolled: 'Just now' },
            defender: { ...t.domains.defender, lastPolled: 'Just now' },
            licensing: { ...t.domains.licensing, lastPolled: 'Just now' },
            pim: { ...t.domains.pim, lastPolled: 'Just now' }
          }
        }))
      );
      if (onShowToast) {
        onShowToast('success', 'Telemetry Updated', 'Heatmap matrix refreshed with latest Graph API responses.');
      }
    }, 1200);
  };

  // Bulk Auto-Remediate All Warnings
  const handleBulkRemediateWarnings = () => {
    setIsRemediatingAll(true);
    if (onShowToast) {
      onShowToast('info', 'Bulk Auto-Remediation Initiated', 'Dispatching zero-trust remediation scripts across all 🟡 Warning domains...');
    }

    setTimeout(() => {
      setTenants((prev) =>
        prev.map((t) => {
          const updatedDomains = { ...t.domains };
          (Object.keys(updatedDomains) as DomainKey[]).forEach((dk) => {
            if (updatedDomains[dk].status === 'warning') {
              updatedDomains[dk] = {
                ...updatedDomains[dk],
                status: 'healthy',
                score: 95,
                miniText: `${updatedDomains[dk].miniText.split(':')[0]}: Fixed`,
                activeAlerts: 0,
                drifts: []
              };
            }
          });
          return {
            ...t,
            secureScore: Math.min(98, parseFloat((t.secureScore + 4.5).toFixed(1))),
            domains: updatedDomains
          };
        })
      );
      setIsRemediatingAll(false);
      if (onShowToast) {
        onShowToast('success', 'Bulk Remediation Completed', 'All non-critical policy drifts & warning configurations resolved.');
      }
    }, 1800);
  };

  // Execute 1-Click Action from Drawer
  const handleExecuteAction = (action: DomainAction) => {
    if (!drawerData) return;
    const { tenant, domainKey } = drawerData;

    // Apply action fix locally
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenant.id) {
          const domainObj = t.domains[domainKey];
          return {
            ...t,
            secureScore: Math.min(99.5, parseFloat((t.secureScore + 3.2).toFixed(1))),
            domains: {
              ...t.domains,
              [domainKey]: {
                ...domainObj,
                status: 'healthy',
                score: 98,
                miniText: `${domainObj.miniText.split(':')[0]}: Clean`,
                activeAlerts: Math.max(0, domainObj.activeAlerts - 1),
                drifts: domainObj.drifts.filter((d) => d.safetyLevel !== action.safetyLevel)
              }
            }
          };
        }
        return t;
      })
    );

    if (onShowToast) {
      onShowToast(
        'success',
        `Graph Action Executed (${action.label})`,
        `Payload "${action.graphApiPayload}" dispatched successfully to ${tenant.name}.`
      );
    }

    if (onOpenRemediationModal) {
      onOpenRemediationModal(action.label, tenant.name);
    }
  };

  // Filtered tenants list
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      // Search query filter
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.domain.toLowerCase().includes(q) ||
        (Object.values(t.domains) as DomainMetric[]).some((d) => d.miniText.toLowerCase().includes(q) || d.graphEndpoint.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Severity filter
      if (severityFilter === 'critical') {
        return (Object.values(t.domains) as DomainMetric[]).some((d) => d.status === 'critical');
      }
      if (severityFilter === 'warning') {
        return (Object.values(t.domains) as DomainMetric[]).some((d) => d.status === 'warning');
      }

      return true;
    });
  }, [tenants, searchQuery, severityFilter]);

  // Aggregate stats
  const totalTenantsCount = tenants.length;
  let totalHealthy = 0;
  let totalWarnings = 0;
  let totalCritical = 0;

  tenants.forEach((t) => {
    (Object.values(t.domains) as DomainMetric[]).forEach((d) => {
      if (d.status === 'healthy') totalHealthy++;
      if (d.status === 'warning') totalWarnings++;
      if (d.status === 'critical') totalCritical++;
    });
  });

  const avgScore = (tenants.reduce((acc, t) => acc + t.secureScore, 0) / tenants.length).toFixed(1);

  // Helper for rendering cell color classes according to exact strict guidelines
  const getCellClasses = (status: 'healthy' | 'warning' | 'critical', isHovered: boolean) => {
    if (status === 'healthy') {
      return cn(
        'bg-emerald-950/40 border border-emerald-800/30 text-emerald-400',
        'hover:bg-emerald-900/50 hover:border-emerald-700/50 hover:shadow-[0_0_10px_rgba(16,185,129,0.2)]',
        isHovered && 'ring-1 ring-emerald-400/50 scale-[1.02]'
      );
    }
    if (status === 'warning') {
      return cn(
        'bg-amber-500/20 border border-amber-500/60 text-amber-300 ring-1 ring-amber-500/30',
        'hover:bg-amber-500/30 hover:border-amber-400 hover:shadow-[0_0_12px_rgba(245,158,11,0.35)]',
        isHovered && 'ring-2 ring-amber-400 scale-[1.02]'
      );
    }
    // Critical (LOUD Screaming Red with active pulse)
    return cn(
      'bg-red-500/30 border border-red-500 text-red-100 animate-pulse ring-2 ring-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.5)]',
      'hover:bg-red-500/40 hover:border-red-400 hover:shadow-[0_0_20px_rgba(239,68,68,0.8)]',
      isHovered && 'ring-2 ring-red-400 scale-[1.02]'
    );
  };

  const getStatusIcon = (status: 'healthy' | 'warning' | 'critical') => {
    if (status === 'healthy') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    if (status === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />;
    return <ShieldAlert className="w-3.5 h-3.5 text-red-300 shrink-0 animate-bounce" />;
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans relative">
      
      {/* 1. HEATMAP HEADER & GLOBAL DENSITY CONTROLS */}
      <header className="bg-[#0e1422] border-b border-[#252f44] px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 shrink-0 shadow-lg">
        {/* Left Title & Status Badge */}
        <div className="flex items-center justify-between md:justify-start gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#182338] border border-[#2b3a58] flex items-center justify-center text-[#38bdf8] shadow-inner shrink-0">
              <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm font-black tracking-tight text-white uppercase font-mono">
                  M365 Security & Drift Heatmap
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  122 Endpoints
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-[#8a9ab8]">
                NOC Monitoring Matrix • {totalTenantsCount} Clients
              </p>
            </div>
          </div>

          <button
            onClick={handleRePoll}
            disabled={isPolling}
            className="md:hidden flex items-center gap-1 bg-[#0078d4] text-white px-2.5 py-1 rounded-md text-xs font-semibold shrink-0"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isPolling && 'animate-spin')} />
            <span>Poll</span>
          </button>
        </div>

        {/* Center Cmd+K Global Search */}
        <div className="relative w-full md:max-w-xs lg:max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#5a6d90]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter tenants, domains..."
            className="w-full bg-[#131b2e] border border-[#25334d] text-xs text-[#e0e2ea] placeholder-[#5a6d90] pl-8 pr-8 py-1.5 rounded-md focus:outline-none focus:border-[#38bdf8] transition-all font-mono"
          />
        </div>

        {/* Right Controls - Scrollable Row on Mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 shrink-0">
          {/* View Switcher */}
          <div className="flex bg-[#131b2e] border border-[#25334d] p-0.5 rounded-md shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-all',
                viewMode === 'grid'
                  ? 'bg-[#25334d] text-white shadow-sm font-semibold'
                  : 'text-[#8a9ab8] hover:text-white'
              )}
              title="Grid Tile View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-all',
                viewMode === 'table'
                  ? 'bg-[#25334d] text-white shadow-sm font-semibold'
                  : 'text-[#8a9ab8] hover:text-white'
              )}
              title="Matrix Table View"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>

          {/* Severity Filter Toggles */}
          <div className="flex bg-[#131b2e] border border-[#25334d] p-0.5 rounded-md shrink-0">
            <button
              onClick={() => setSeverityFilter('all')}
              className={cn(
                'px-2 py-1 text-[11px] font-medium rounded transition-all',
                severityFilter === 'all'
                  ? 'bg-[#25334d] text-white font-semibold'
                  : 'text-[#8a9ab8] hover:text-white'
              )}
            >
              All
            </button>
            <button
              onClick={() => setSeverityFilter('critical')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-all',
                severityFilter === 'critical'
                  ? 'bg-red-950/80 text-red-200 border border-red-800/80 font-bold'
                  : 'text-[#8a9ab8] hover:text-red-300'
              )}
            >
              <span>Critical</span>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            </button>
            <button
              onClick={() => setSeverityFilter('warning')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-all',
                severityFilter === 'warning'
                  ? 'bg-amber-950/80 text-amber-200 border border-amber-800/80 font-bold'
                  : 'text-[#8a9ab8] hover:text-amber-300'
              )}
            >
              <span>Warnings</span>
            </button>
          </div>

          {/* Instant Re-Poll (Desktop) */}
          <button
            onClick={handleRePoll}
            disabled={isPolling}
            className="hidden md:flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-md transition-all shrink-0 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isPolling && 'animate-spin')} />
            <span>{isPolling ? 'Polling...' : 'Instant Re-Poll'}</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN HEATMAP MATRIX CANVAS */}
      <main className="flex-1 overflow-auto p-4 relative">
        {viewMode === 'grid' ? (
          /* GRID TILE VIEW */
          <div className="space-y-3 max-w-[1800px] mx-auto overflow-x-auto">
            <div className="min-w-[720px] space-y-3">
            {/* Header X-Axis Labels */}
            <div className="grid grid-cols-12 gap-2 items-center px-3 py-2 bg-[#0e1422] border border-[#252f44] rounded-lg font-mono text-xs font-bold text-[#8a9ab8]">
              <div className="col-span-3 flex items-center gap-2 text-white">
                <Users className="w-4 h-4 text-[#38bdf8]" />
                <span>Managed Client Tenant</span>
                <span className="text-[10px] text-[#5a6d90] font-normal">({filteredTenants.length} Showing)</span>
              </div>
              <div className="col-span-9 grid grid-cols-7 gap-2 text-center">
                {DOMAIN_METADATA.map((dm) => (
                  <div key={dm.key} className="flex items-center justify-center gap-1 py-1 bg-[#131c2e] rounded border border-[#232f48] text-cyan-300">
                    {dm.icon}
                    <span className="truncate">{dm.shortLabel}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tenant Matrix Rows */}
            <div className="space-y-2">
              {filteredTenants.map((tenant) => {
                const criticalInTenant = (Object.values(tenant.domains) as DomainMetric[]).some((d) => d.status === 'critical');
                const warningInTenant = (Object.values(tenant.domains) as DomainMetric[]).some((d) => d.status === 'warning');

                return (
                  <div
                    key={tenant.id}
                    className={cn(
                      'grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl border transition-all duration-200',
                      criticalInTenant
                        ? 'bg-[#150a0d] border-red-900/40 shadow-[inset_0_0_12px_rgba(239,68,68,0.1)]'
                        : warningInTenant
                        ? 'bg-[#14120a] border-amber-900/30'
                        : 'bg-[#0f1524] border-[#1d293d] hover:border-[#2b3d5b]'
                    )}
                  >
                    {/* Y-Axis Tenant Info Box */}
                    <div className="col-span-3 flex flex-col justify-center pr-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white truncate max-w-[180px]">
                          {tenant.name}
                        </span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#182338] text-cyan-300 border border-[#2b3a58]">
                          {tenant.secureScore}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-[#6b7c9c] font-mono">
                        <span className="truncate">{tenant.domain}</span>
                        <span className="text-[#8a9ab8]">{tenant.tier}</span>
                      </div>
                    </div>

                    {/* X-Axis Domain Heatmap Tiles */}
                    <div className="col-span-9 grid grid-cols-7 gap-2">
                      {DOMAIN_METADATA.map((dm) => {
                        const domainObj = tenant.domains[dm.key];
                        const isHovered =
                          hoveredCell?.tenantId === tenant.id && hoveredCell?.domainKey === dm.key;

                        return (
                          <div
                            key={dm.key}
                            onClick={() => setDrawerData({ tenant, domainKey: dm.key })}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredCell({
                                tenantId: tenant.id,
                                domainKey: dm.key,
                                x: rect.left + rect.width / 2,
                                y: rect.top - 10
                              });
                            }}
                            onMouseLeave={() => setHoveredCell(null)}
                            className={cn(
                              'cursor-pointer rounded-lg p-2 flex flex-col justify-between transition-all duration-150 select-none relative group',
                              density === 'compact' ? 'h-14' : 'h-20',
                              getCellClasses(domainObj.status, isHovered)
                            )}
                          >
                            {/* Top Bar of Cell */}
                            <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                              <span className="opacity-90">{dm.shortLabel}</span>
                              {getStatusIcon(domainObj.status)}
                            </div>

                            {/* Mini Metric Text */}
                            <div className="my-auto">
                              <div
                                className={cn(
                                  'font-mono font-bold leading-tight truncate',
                                  density === 'compact' ? 'text-[10px]' : 'text-xs'
                                )}
                              >
                                {domainObj.miniText}
                              </div>
                              {density === 'expanded' && (
                                <div className="text-[9px] opacity-75 font-mono mt-0.5 flex items-center justify-between">
                                  <span>Score: {domainObj.score}%</span>
                                  <span>{domainObj.activeAlerts > 0 ? `${domainObj.activeAlerts} Alerts` : 'OK'}</span>
                                </div>
                              )}
                            </div>

                            {/* Bottom Pulse indicator or drawer hint */}
                            <div className="flex items-center justify-between text-[9px] opacity-60 group-hover:opacity-100 font-mono">
                              <span>{domainObj.lastPolled}</span>
                              <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        ) : (
          /* MATRIX TABLE VIEW */
          <div className="max-w-[1800px] mx-auto bg-[#0e1422] border border-[#252f44] rounded-xl overflow-x-auto shadow-2xl">
            <table className="w-full min-w-[800px] text-left text-xs text-[#e0e2ea]">
              <thead className="bg-[#131c2e] text-[#8a9ab8] font-mono text-[11px] uppercase tracking-wider border-b border-[#252f44] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Managed Tenant</th>
                  <th className="py-3 px-2">Score</th>
                  {DOMAIN_METADATA.map((dm) => (
                    <th key={dm.key} className="py-3 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {dm.icon}
                        <span>{dm.shortLabel}</span>
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c273c]">
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-[#131a2b] transition-colors">
                    <td className="py-3 px-4 font-bold text-white">
                      <div>{tenant.name}</div>
                      <div className="text-[10px] font-mono text-[#6b7c9c] font-normal">{tenant.domain}</div>
                    </td>
                    <td className="py-3 px-2 font-mono font-bold text-cyan-300">
                      {tenant.secureScore}%
                    </td>
                    {DOMAIN_METADATA.map((dm) => {
                      const domainObj = tenant.domains[dm.key];
                      return (
                        <td key={dm.key} className="py-2 px-1 text-center">
                          <button
                            onClick={() => setDrawerData({ tenant, domainKey: dm.key })}
                            className={cn(
                              'w-full py-1.5 px-2 rounded text-[11px] font-mono font-bold flex items-center justify-between transition-all',
                              getCellClasses(domainObj.status, false)
                            )}
                          >
                            <span className="truncate">{domainObj.miniText}</span>
                            {getStatusIcon(domainObj.status)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setDrawerData({ tenant, domainKey: 'identity' })}
                        className="bg-[#182338] hover:bg-[#25334d] border border-[#2b3a58] text-cyan-300 px-2.5 py-1 rounded text-[11px] font-semibold transition-all"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* 3. CONTEXTUAL REMEDIATION SIDE-DRAWER (SLIDE-OVER ON TILE CLICK) */}
      {drawerData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-[#0f172a] border-l border-[#23324d] shadow-2xl flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 bg-[#131d33] border-b border-[#23324d] flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#38bdf8] font-mono font-bold mb-1 uppercase tracking-wider">
                  <span>{drawerData.tenant.name}</span>
                  <span>→</span>
                  <span className="text-amber-400">{DOMAIN_METADATA.find((m) => m.key === drawerData.domainKey)?.name}</span>
                </div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <span>Domain Telemetry &amp; Write Actions</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 text-xs font-mono rounded font-bold uppercase',
                      drawerData.tenant.domains[drawerData.domainKey].status === 'healthy' && 'bg-emerald-950 text-emerald-400 border border-emerald-800',
                      drawerData.tenant.domains[drawerData.domainKey].status === 'warning' && 'bg-amber-950 text-amber-300 border border-amber-800',
                      drawerData.tenant.domains[drawerData.domainKey].status === 'critical' && 'bg-red-950 text-red-200 border border-red-800 animate-pulse'
                    )}
                  >
                    {drawerData.tenant.domains[drawerData.domainKey].status}
                  </span>
                </h2>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8a9ab8] font-mono">
                  <span>Graph API: <code className="text-cyan-300">{drawerData.tenant.domains[drawerData.domainKey].graphEndpoint}</code></span>
                  <span>•</span>
                  <span>Last Sync: {drawerData.tenant.domains[drawerData.domainKey].lastPolled}</span>
                </div>
              </div>
              <button
                onClick={() => setDrawerData(null)}
                className="text-[#8a9ab8] hover:text-white p-1 rounded-md hover:bg-[#202d45] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Domain Score Header Card */}
              <div className="p-4 rounded-xl bg-[#131d31] border border-[#23324d] flex items-center justify-between">
                <div>
                  <div className="text-xs text-[#8a9ab8] font-mono">Domain Health Score</div>
                  <div className="text-2xl font-black text-white font-mono mt-0.5">
                    {drawerData.tenant.domains[drawerData.domainKey].score} / 100
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#8a9ab8] font-mono">Active Graph Alerts</div>
                  <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
                    {drawerData.tenant.domains[drawerData.domainKey].activeAlerts} Issues Detected
                  </div>
                </div>
              </div>

              {/* Active Drifts & Violations List */}
              <div>
                <h3 className="text-xs font-bold text-[#8a9ab8] font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>Active Drifts &amp; Graph API Findings</span>
                </h3>

                {drawerData.tenant.domains[drawerData.domainKey].drifts.length === 0 ? (
                  <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-400 text-xs font-mono flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Zero policy drift detected. All Entra &amp; M365 security controls comply with baseline.</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {drawerData.tenant.domains[drawerData.domainKey].drifts.map((drift) => (
                      <div
                        key={drift.id}
                        className="p-3.5 rounded-lg bg-[#141d2f] border border-[#23324d] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                            {drift.title}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800 font-bold">
                            {drift.severity} Severity
                          </span>
                        </div>
                        <p className="text-xs text-[#a3b3d1] leading-relaxed">
                          {drift.description}
                        </p>
                        <div className="text-[10px] text-[#5a6d90] font-mono pt-1 border-t border-[#1d2a42] flex justify-between">
                          <span>Detected: {drift.detectedAt}</span>
                          <span>Safety Level: <strong className="text-amber-300">{drift.safetyLevel}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct 1-Click Write Actions */}
              <div>
                <h3 className="text-xs font-bold text-[#8a9ab8] font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#38bdf8]" />
                  <span>Direct 1-Click Graph API Write Actions</span>
                </h3>

                <div className="space-y-3">
                  {DOMAIN_ACTIONS[drawerData.domainKey].map((action) => (
                    <div
                      key={action.id}
                      className="p-3.5 rounded-xl bg-[#131d31] border border-[#23324d] hover:border-[#38bdf8]/50 transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white font-mono">
                          {action.label}
                        </span>
                        {action.safetyLevel === 'Safe' && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Safe
                          </span>
                        )}
                        {action.safetyLevel === 'Gated' && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Gated
                          </span>
                        )}
                        {action.safetyLevel === 'Blocked' && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-red-950 text-red-300 border border-red-800 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Emergency
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#8a9ab8]">
                        {action.description}
                      </p>
                      <div className="pt-2 flex items-center justify-between">
                        <code className="text-[10px] font-mono text-[#38bdf8] bg-[#0b111e] px-2 py-1 rounded border border-[#1b273e] max-w-[320px] truncate">
                          {action.graphApiPayload}
                        </code>
                        <button
                          onClick={() => handleExecuteAction(action)}
                          className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1 rounded text-xs font-bold shadow-md transition-all flex items-center gap-1"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Execute Fix</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 bg-[#0e1422] border-t border-[#23324d] flex items-center justify-between text-xs text-[#8a9ab8]">
              <span>Tenant GDAP Scope: Active</span>
              <button
                onClick={() => setDrawerData(null)}
                className="bg-[#1a253a] hover:bg-[#25334d] text-white px-4 py-1.5 rounded-md font-semibold transition-all"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Hover Tooltip (When hovering cell) */}
      {hoveredCell && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full mb-2 w-72 bg-[#0d1424] border border-[#2b3a58] rounded-xl p-3 shadow-2xl text-xs space-y-1.5 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: hoveredCell.x, top: hoveredCell.y }}
        >
          {(() => {
            const targetTenant = tenants.find((t) => t.id === hoveredCell.tenantId);
            if (!targetTenant) return null;
            const targetDomain = targetTenant.domains[hoveredCell.domainKey];
            return (
              <>
                <div className="flex items-center justify-between font-bold text-white border-b border-[#1f2c45] pb-1.5">
                  <span>{targetTenant.name}</span>
                  <span className="text-cyan-300 font-mono text-[10px]">{targetDomain.label}</span>
                </div>
                <div className="text-[11px] text-[#8a9ab8] space-y-1 font-mono">
                  <div className="flex justify-between">
                    <span>Mini Telemetry:</span>
                    <strong className="text-white">{targetDomain.miniText}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Graph Endpoint:</span>
                    <code className="text-cyan-400 text-[9px]">{targetDomain.graphEndpoint}</code>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Poll Age:</span>
                    <span className="text-emerald-400">{targetDomain.lastPolled}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Alerts:</span>
                    <span className={targetDomain.activeAlerts > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                      {targetDomain.activeAlerts} Alerts
                    </span>
                  </div>
                </div>
                <div className="text-[9px] text-[#5a6d90] font-mono text-center pt-1 border-t border-[#1f2c45]">
                  Click tile to open Contextual Remediation Drawer
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* 4. BOTTOM SUMMARY BAR (QUICK HEALTH ROLLUP) */}
      <footer className="bg-[#0e1422] border-t border-[#252f44] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-2xl">
        {/* Counter Cards */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 bg-[#131b2e] border border-[#25334d] px-3 py-1.5 rounded-lg">
            <Server className="w-4 h-4 text-[#38bdf8]" />
            <span className="text-[#8a9ab8]">Tenants:</span>
            <strong className="text-white">{totalTenantsCount} Monitored</strong>
          </div>

          <div className="flex items-center gap-2 bg-emerald-950/30 border border-emerald-800/40 px-3 py-1.5 rounded-lg text-emerald-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Healthy:</span>
            <strong className="font-bold">{totalHealthy}</strong>
          </div>

          <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 px-3 py-1.5 rounded-lg text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <span>Warnings:</span>
            <strong className="font-bold">{totalWarnings}</strong>
          </div>

          <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/40 px-3 py-1.5 rounded-lg text-red-300">
            <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />
            <span>Critical:</span>
            <strong className="font-bold">{totalCritical}</strong>
          </div>

          <div className="flex items-center gap-1.5 text-[#8a9ab8] ml-2">
            <span>Avg Secure Score:</span>
            <strong className="text-cyan-300 font-bold">{avgScore}%</strong>
          </div>
        </div>

        {/* Direct Action Button */}
        <button
          onClick={handleBulkRemediateWarnings}
          disabled={isRemediatingAll || totalWarnings === 0}
          className="bg-amber-500 hover:bg-amber-600 text-black px-4 py-1.5 rounded-lg text-xs font-bold font-mono shadow-lg transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
        >
          <Zap className={cn('w-4 h-4 fill-current', isRemediatingAll && 'animate-spin')} />
          <span>{isRemediatingAll ? 'Executing Remediations...' : 'Execute Bulk Auto-Remediation for All 🟡 Warnings'}</span>
        </button>
      </footer>
    </div>
  );
};

export default TenantHeatmapDashboard;

