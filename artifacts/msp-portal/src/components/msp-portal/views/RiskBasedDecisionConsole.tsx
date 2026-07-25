// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Scale,
  ShieldAlert,
  ShieldCheck,
  FileSignature,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  UserCheck,
  Download,
  Send,
  RefreshCw,
  Search,
  Filter,
  SlidersHorizontal,
  ExternalLink,
  Layers,
  Building2,
  Calendar,
  History,
  Plus,
  X,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Sparkles,
  Info,
  Eye,
  Shield,
  FileSpreadsheet,
  AlertCircle,
  XCircle,
  KeyRound,
  Laptop,
  CheckSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface CompensatingControl {
  type: 'technical' | 'administrative' | 'operational';
  description: string;
}

export interface MspAssessor {
  name: string;
  upn: string;
  timestamp: string;
}

export interface ClientApprover {
  name: string;
  title: string;
  email: string;
  signedAt: string | null;
  ipAddress: string | null;
  signatureHash: string | null;
}

export interface RiskBasedDecision {
  id: string; // e.g. 'RBD-2026-089'
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  controlViolated: string; // e.g. 'CIS 1.1.1 - Enforce MFA for All Users'
  framework: 'NIST 800-53' | 'CIS M365 Baseline' | 'HIPAA Security Rule' | 'CMMC Level 2';
  rawRiskLevel: 'critical' | 'high' | 'medium';
  residualRiskLevel: 'high' | 'medium' | 'low';
  rawRiskScore: number; // e.g. 20 (out of 25)
  residualRiskScore: number; // e.g. 8 (out of 25)
  liabilityValueUsd: number;
  hazardDescription: string;
  graphEndpoint: string;
  compensatingControls: CompensatingControl[];
  mspAssessor: MspAssessor;
  clientApprover: ClientApprover;
  createdAt: string;
  expirationDate: string; // YYYY-MM-DD
  status: 'active' | 'pending_signature' | 'expired' | 'revoked';
}

interface RiskBasedDecisionConsoleProps {
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

// 6+ Realistic M365 Risk-Based Decisions
const INITIAL_RBDS: RiskBasedDecision[] = [
  {
    id: 'RBD-2026-089',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    title: 'MFA Exemption for Legacy On-Prem ERP Service Account',
    controlViolated: 'CIS 1.1.1 - Enforce MFA for All Administrative & Service Accounts',
    framework: 'CIS M365 Baseline',
    rawRiskLevel: 'critical',
    residualRiskLevel: 'medium',
    rawRiskScore: 20,
    residualRiskScore: 8,
    liabilityValueUsd: 45000,
    hazardDescription:
      'Legacy ERP synchronizer service account (erp.sync@contoso.com) cannot support interactive modern authentication or OAuth2 MFA prompts. Without MFA, account is vulnerable to credential stuffing and password spraying attacks.',
    graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies/mfa-enforcement',
    compensatingControls: [
      {
        type: 'technical',
        description: 'Conditional Access Policy restricts sign-ins strictly to Trusted Corporate Public IP (203.0.113.45/32).',
      },
      {
        type: 'technical',
        description: 'Sign-in frequency capped at 12 hours with forced 32-character complex auto-rotated password.',
      },
      {
        type: 'operational',
        description: 'Real-time Sentinel anomaly alert triggers SOC paging if sign-in originates outside office hours.',
      },
    ],
    mspAssessor: {
      name: 'Alex Vance',
      upn: 'alex.vance@mspplatform.com',
      timestamp: '2026-06-10 14:30 UTC',
    },
    clientApprover: {
      name: 'Sarah Jenkins',
      title: 'Chief Information Officer',
      email: 'sjenkins@contoso.com',
      signedAt: '2026-06-12 09:15 UTC',
      ipAddress: '203.0.113.195',
      signatureHash: 'SHA256:8f92a39c4e1b8200d41f5a91823bc8e0',
    },
    createdAt: '2026-06-10',
    expirationDate: '2026-08-15', // Expiring in < 30 days
    status: 'active',
  },
  {
    id: 'RBD-2026-088',
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.onmicrosoft.com',
    title: 'External Mail Forwarding Rule Exception for Executive Assistant',
    controlViolated: 'NIST IA-2 / CIS 2.1 - Disable Automatic External Mail Forwarding',
    framework: 'NIST 800-53',
    rawRiskLevel: 'high',
    residualRiskLevel: 'medium',
    rawRiskScore: 16,
    residualRiskScore: 9,
    liabilityValueUsd: 25000,
    hazardDescription:
      'Executive Assistant requested automatic mail forwarding to external legal counsel inbox (legal@external-law.com). Uncontrolled forwarding risks Data Loss Prevention (DLP) breaches and exfiltration of sensitive M365 content.',
    graphEndpoint: 'GET /v1.0/users/exec.assistant@fabrikam.com/mailFolders/inbox/messageRules',
    compensatingControls: [
      {
        type: 'technical',
        description: 'Purview DLP policy automatically encrypts all messages forwarded to external-law.com domain.',
      },
      {
        type: 'administrative',
        description: 'Quarterly compliance audit of forwarded message headers by Fabrikam Legal Officer.',
      },
    ],
    mspAssessor: {
      name: 'Marcus Chen',
      upn: 'mchen@mspplatform.com',
      timestamp: '2026-07-01 11:20 UTC',
    },
    clientApprover: {
      name: 'David Ross',
      title: 'VP of Operations',
      email: 'dross@fabrikam.com',
      signedAt: '2026-07-02 16:45 UTC',
      ipAddress: '198.51.100.82',
      signatureHash: 'SHA256:3e21a094b81c6d88f910a2741122aa71',
    },
    createdAt: '2026-07-01',
    expirationDate: '2026-10-01',
    status: 'active',
  },
  {
    id: 'RBD-2026-087',
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    primaryDomain: 'woodgrovebank.com',
    title: 'Bypass Device Compliance Enforcement for C-Suite iPad Devices',
    controlViolated: 'CMMC AC.L2-3.1.18 - Require Managed Devices for Corporate Resource Access',
    framework: 'CMMC Level 2',
    rawRiskLevel: 'critical',
    residualRiskLevel: 'high',
    rawRiskScore: 22,
    residualRiskScore: 14,
    liabilityValueUsd: 85000,
    hazardDescription:
      'Executive leadership team utilizes personal iPad devices without Intune MDM enrollment for board meeting slides. Bypassing Intune compliance risks unencrypted local storage and unpatched OS vulnerabilities.',
    graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies/device-compliance-gate',
    compensatingControls: [
      {
        type: 'technical',
        description: 'App Protection Policies (MAM) enforced: copy/paste disabled, PIN required, remote wipe enabled for Office apps.',
      },
      {
        type: 'technical',
        description: 'Access restricted exclusively to OneDrive for Business Board Documents folder.',
      },
    ],
    mspAssessor: {
      name: 'Alex Vance',
      upn: 'alex.vance@mspplatform.com',
      timestamp: '2026-07-15 09:00 UTC',
    },
    clientApprover: {
      name: 'Elena Rostova',
      title: 'Chief Information Security Officer',
      email: 'elena.rostova@woodgrovebank.com',
      signedAt: null,
      ipAddress: null,
      signatureHash: null,
    },
    createdAt: '2026-07-15',
    expirationDate: '2027-01-15',
    status: 'pending_signature',
  },
  {
    id: 'RBD-2026-086',
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    primaryDomain: 'northwind.onmicrosoft.com',
    title: 'Legacy Basic Authentication Allowed for Warehouse Barcode Scanners',
    controlViolated: 'CIS 1.2 - Disable Legacy Authentication Protocols (POP3/IMAP4/SMTP)',
    framework: 'CIS M365 Baseline',
    rawRiskLevel: 'high',
    residualRiskLevel: 'medium',
    rawRiskScore: 18,
    residualRiskScore: 10,
    liabilityValueUsd: 30000,
    hazardDescription:
      'Industrial hardware scanners rely on standard basic AUTH SMTP to send inventory logs. Basic auth lacks MFA and is vulnerable to password sniffing and brute force attacks.',
    graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies/block-legacy-auth',
    compensatingControls: [
      {
        type: 'technical',
        description: 'SMTP endpoint restricted to Exchange Online Dedicated Relay with explicit IP whitelist.',
      },
      {
        type: 'operational',
        description: 'Account isolated from corporate directory and blocked from accessing user mailboxes or Teams.',
      },
    ],
    mspAssessor: {
      name: 'Marcus Chen',
      upn: 'mchen@mspplatform.com',
      timestamp: '2026-05-10 16:00 UTC',
    },
    clientApprover: {
      name: 'Robert Miller',
      title: 'Director of Supply Chain',
      email: 'rmiller@northwind.com',
      signedAt: '2026-05-12 10:20 UTC',
      ipAddress: '203.0.113.12',
      signatureHash: 'SHA256:7a10b98f2190c1284a001192834b92c1',
    },
    createdAt: '2026-05-10',
    expirationDate: '2026-08-10', // Expiring in < 30 days
    status: 'active',
  },
  {
    id: 'RBD-2026-085',
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    primaryDomain: 'adventureworks.com',
    title: 'Anonymous Sharing Link Duration Extension for Marketing Dept',
    controlViolated: 'HIPAA 164.312(a)(1) / CIS 3.1 - Restrict Anonymous File Sharing Links',
    framework: 'HIPAA Security Rule',
    rawRiskLevel: 'medium',
    residualRiskLevel: 'low',
    rawRiskScore: 12,
    residualRiskScore: 5,
    liabilityValueUsd: 15000,
    hazardDescription:
      'Marketing department requested 180-day expiration on public media kit sharing links instead of standard 14-day policy, increasing exposure window for shared SharePoint folders.',
    graphEndpoint: 'GET /v1.0/admin/sharepoint/settings/sharingLimits',
    compensatingControls: [
      {
        type: 'technical',
        description: 'Anonymous links strictly constrained to "Marketing Assets" SharePoint Site Collection.',
      },
      {
        type: 'operational',
        description: 'Automated script purges links with zero views for 30 consecutive days.',
      },
    ],
    mspAssessor: {
      name: 'Alex Vance',
      upn: 'alex.vance@mspplatform.com',
      timestamp: '2026-04-01 10:00 UTC',
    },
    clientApprover: {
      name: 'Jessica Taylor',
      title: 'CMO',
      email: 'jtaylor@adventureworks.com',
      signedAt: '2026-04-02 14:10 UTC',
      ipAddress: '198.51.100.4',
      signatureHash: 'SHA256:1198c22b90d21a99f812034821a980bb',
    },
    createdAt: '2026-04-01',
    expirationDate: '2026-07-01', // Expired!
    status: 'expired',
  },
  {
    id: 'RBD-2026-084',
    tenantId: 'tailspin-06',
    tenantName: 'Tailspin Toys',
    primaryDomain: 'tailspintoys.com',
    title: 'Global Admin Account Lacking FIDO2 Hardware Key Enrolment',
    controlViolated: 'NIST IA-2(1) - Multi-Factor Authentication with Cryptographic Key',
    framework: 'NIST 800-53',
    rawRiskLevel: 'high',
    residualRiskLevel: 'medium',
    rawRiskScore: 17,
    residualRiskScore: 9,
    liabilityValueUsd: 50000,
    hazardDescription:
      'Emergency Break-Glass Global Admin account utilizes Authenticator TOTP instead of FIDO2 YubiKey hardware token while hardware procurement is pending.',
    graphEndpoint: 'GET /v1.0/identity/authenticationMethods/fido2Methods',
    compensatingControls: [
      {
        type: 'technical',
        description: 'Credentials split in encrypted physical vault (LAPS style). Password changed automatically after each use.',
      },
      {
        type: 'operational',
        description: 'Immediate P1 SOC incident dispatched to MSP On-Call Engineer whenever account signs in.',
      },
    ],
    mspAssessor: {
      name: 'Marcus Chen',
      upn: 'mchen@mspplatform.com',
      timestamp: '2026-07-20 18:15 UTC',
    },
    clientApprover: {
      name: 'Brian Thorne',
      title: 'Managing Director',
      email: 'bthorne@tailspintoys.com',
      signedAt: null,
      ipAddress: null,
      signatureHash: null,
    },
    createdAt: '2026-07-20',
    expirationDate: '2026-10-20',
    status: 'pending_signature',
  },
];

export const RiskBasedDecisionConsole: React.FC<RiskBasedDecisionConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [rbdList, setRbdList] = useState<RiskBasedDecision[]>(INITIAL_RBDS);
  const [selectedRbdId, setSelectedRbdId] = useState<string>('RBD-2026-089');
  const [activeTab, setActiveTab] = useState<'matrix' | 'pending' | 'expiration'>('matrix');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantFilter, setTenantFilter] = useState('All');
  const [riskLevelFilter, setRiskLevelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [frameworkFilter, setFrameworkFilter] = useState('All');

  // Wizard Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // New RBD Form State
  const [newRbdTenantId, setNewRbdTenantId] = useState('contoso-01');
  const [newRbdTitle, setNewRbdTitle] = useState('');
  const [newRbdControl, setNewRbdControl] = useState('CIS 1.1.1 - Enforce MFA for All Users');
  const [newRbdFramework, setNewRbdFramework] = useState<RiskBasedDecision['framework']>('CIS M365 Baseline');
  const [newRbdHazard, setNewRbdHazard] = useState('');
  const [newRbdLiability, setNewRbdLiability] = useState<number>(35000);
  const [newRbdRawRisk, setNewRbdRawRisk] = useState<'critical' | 'high' | 'medium'>('high');
  const [newRbdResidualRisk, setNewRbdResidualRisk] = useState<'high' | 'medium' | 'low'>('medium');

  // Controls list for creation wizard
  const [wizardControls, setWizardControls] = useState<CompensatingControl[]>([
    { type: 'technical', description: 'Conditional Access Policy restricts sign-in locations to trusted IPs.' },
    { type: 'operational', description: 'Real-time alert configured in SIEM/Sentinel for immediate triage.' },
  ]);
  const [newControlText, setNewControlText] = useState('');
  const [newControlType, setNewControlType] = useState<'technical' | 'administrative' | 'operational'>('technical');

  // Approver
  const [approverName, setApproverName] = useState('');
  const [approverTitle, setApproverTitle] = useState('');
  const [approverEmail, setApproverEmail] = useState('');

  // Selected RBD details
  const selectedRbd = useMemo(() => {
    return rbdList.find((r) => r.id === selectedRbdId) || rbdList[0];
  }, [rbdList, selectedRbdId]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const activeCount = rbdList.filter((r) => r.status === 'active').length;
    
    const highResidualCount = rbdList.filter(
      (r) => (r.residualRiskLevel === 'high' || r.rawRiskLevel === 'critical') && r.status === 'active'
    ).length;

    // Expiring in < 30 days or already expired
    const today = new Date('2026-07-23');
    const expiringSoonCount = rbdList.filter((r) => {
      if (r.status === 'expired') return true;
      const exp = new Date(r.expirationDate);
      const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 3600 * 24));
      return diffDays <= 30 && r.status === 'active';
    }).length;

    const totalLiability = rbdList
      .filter((r) => r.status === 'active' || r.status === 'pending_signature')
      .reduce((acc, curr) => acc + curr.liabilityValueUsd, 0);

    return {
      activeCount,
      highResidualCount,
      expiringSoonCount,
      totalLiability,
    };
  }, [rbdList]);

  // Filtered List
  const filteredRbdList = useMemo(() => {
    return rbdList.filter((r) => {
      // Tenant filter
      if (tenantFilter !== 'All' && r.tenantId !== tenantFilter) return false;

      // Risk level filter
      if (riskLevelFilter !== 'All' && r.residualRiskLevel !== riskLevelFilter.toLowerCase()) return false;

      // Status filter
      if (statusFilter !== 'All' && r.status !== statusFilter.toLowerCase()) return false;

      // Framework filter
      if (frameworkFilter !== 'All' && r.framework !== frameworkFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = r.title.toLowerCase().includes(q);
        const matchesId = r.id.toLowerCase().includes(q);
        const matchesControl = r.controlViolated.toLowerCase().includes(q);
        const matchesTenant = r.tenantName.toLowerCase().includes(q);
        const matchesApprover = r.clientApprover.email.toLowerCase().includes(q);

        return matchesTitle || matchesId || matchesControl || matchesTenant || matchesApprover;
      }

      return true;
    });
  }, [rbdList, tenantFilter, riskLevelFilter, statusFilter, frameworkFilter, searchQuery]);

  // Handlers
  const handleAddWizardControl = () => {
    if (!newControlText.trim()) return;
    setWizardControls((prev) => [
      ...prev,
      { type: newControlType, description: newControlText.trim() },
    ]);
    setNewControlText('');
  };

  const handleRemoveWizardControl = (index: number) => {
    setWizardControls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateRbd = () => {
    const tenantObj = tenants.find((t) => t.id === newRbdTenantId);
    const tenantName = tenantObj ? tenantObj.name : 'Contoso Corporation';
    const primaryDomain = tenantObj ? tenantObj.domain : 'contoso.onmicrosoft.com';

    const newId = `RBD-2026-${Math.floor(100 + Math.random() * 900)}`;

    const createdRbd: RiskBasedDecision = {
      id: newId,
      tenantId: newRbdTenantId,
      tenantName,
      primaryDomain,
      title: newRbdTitle || 'Conditional Risk Acceptance Request',
      controlViolated: newRbdControl,
      framework: newRbdFramework,
      rawRiskLevel: newRbdRawRisk,
      residualRiskLevel: newRbdResidualRisk,
      rawRiskScore: newRbdRawRisk === 'critical' ? 22 : newRbdRawRisk === 'high' ? 17 : 12,
      residualRiskScore: newRbdResidualRisk === 'high' ? 14 : newRbdResidualRisk === 'medium' ? 8 : 4,
      liabilityValueUsd: newRbdLiability,
      hazardDescription: newRbdHazard || 'Identified policy deviation requiring formal executive risk authorization.',
      graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies/custom-exemption',
      compensatingControls: wizardControls,
      mspAssessor: {
        name: 'Alex Vance',
        upn: 'alex.vance@mspplatform.com',
        timestamp: '2026-07-23 22:55 UTC',
      },
      clientApprover: {
        name: approverName || 'Client Risk Officer',
        title: approverTitle || 'CIO',
        email: approverEmail || 'exec@clientdomain.com',
        signedAt: null,
        ipAddress: null,
        signatureHash: null,
      },
      createdAt: '2026-07-23',
      expirationDate: '2027-07-23',
      status: 'pending_signature',
    };

    setRbdList((prev) => [createdRbd, ...prev]);
    setSelectedRbdId(newId);
    setIsWizardOpen(false);
    setWizardStep(1);

    onExecuteWorkflow?.('dispatch-rbd-digital-signature', {
      rbdId: newId,
      clientEmail: createdRbd.clientApprover.email,
    });

    onShowToast?.(
      'success',
      'Risk Acceptance Document Generated',
      `Sent digital signature link for ${newId} to ${createdRbd.clientApprover.email}`
    );
  };

  const handleResendSignature = (rbd: RiskBasedDecision) => {
    onExecuteWorkflow?.('resend-rbd-signature-link', {
      rbdId: rbd.id,
      clientEmail: rbd.clientApprover.email,
    });

    onShowToast?.(
      'info',
      'Signature Notification Dispatched',
      `Re-sent DocuSign/DocuVault signature link to ${rbd.clientApprover.email}`
    );
  };

  const handleRevokeRbd = (rbd: RiskBasedDecision) => {
    setRbdList((prev) =>
      prev.map((r) => (r.id === rbd.id ? { ...r, status: 'revoked' } : r))
    );

    onExecuteWorkflow?.('revoke-risk-acceptance', {
      rbdId: rbd.id,
      tenantId: rbd.tenantId,
    });

    onShowToast?.(
      'warning',
      'Risk Acceptance Revoked',
      `Revoked ${rbd.id}. M365 baseline enforcement triggered for ${rbd.tenantName}.`
    );
  };

  const handleSimulateClientSignOff = (rbd: RiskBasedDecision) => {
    setRbdList((prev) =>
      prev.map((r) =>
        r.id === rbd.id
          ? {
              ...r,
              status: 'active',
              clientApprover: {
                ...r.clientApprover,
                signedAt: '2026-07-23 23:00 UTC',
                ipAddress: '203.0.113.199',
                signatureHash: `SHA256:${Math.random().toString(16).substring(2, 12)}...`,
              },
            }
          : r
      )
    );

    onShowToast?.(
      'success',
      'Executive Digital Signature Verified',
      `Client Executive ${rbd.clientApprover.name} signed ${rbd.id}. Risk acceptance active.`
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & RISK EXPOSURE ROLLUP BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-600 flex items-center justify-center text-amber-400 shrink-0 font-mono">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  Risk-Based Decisions & Liability Acceptance Console (RBD / RAM)
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                  /portal/rbd
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>NIST SP 800-30 & CIS Benchmark Risk Acceptance Matrix</span>
                <span>•</span>
                <span className="text-emerald-400 text-[11px] font-mono flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Digital Executive Sign-Off Engine Active
                </span>
              </div>
            </div>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                onShowToast?.(
                  'info',
                  'Graph Baseline Polled',
                  'Refreshed M365 policy violation baseline across all managed client tenants.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Control Baseline</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'Master Risk Register PDF Exported',
                  'Exported CMMC / NIST Compliant Risk Acceptance Register PDF.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Export Risk Register</span>
            </button>

            <button
              onClick={() => {
                setIsWizardOpen(true);
                setWizardStep(1);
              }}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Create New RBD / Risk Acceptance</span>
            </button>
          </div>

        </div>

        {/* Risk Exposure Rollup Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ACTIVE RISK ACCEPTANCES
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {metrics.activeCount} <span className="text-xs font-normal text-emerald-400">Approved RBDs</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Formal executive sign-offs on file</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <FileSignature className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-red-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-red-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                HIGH RESIDUAL EXPOSURE
              </div>
              <div className="text-xl font-bold font-mono text-red-200">
                {metrics.highResidualCount} <span className="text-xs font-normal text-red-400">Critical / High</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Accepted risks with elevated score</div>
            </div>
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                EXPIRING &lt; 30 DAYS
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {metrics.expiringSoonCount} <span className="text-xs font-normal text-amber-400">RBDs Pending Review</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Mandatory annual re-evaluation required</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <Calendar className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-[#0078d4]/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-[#0078d4]" />
                UNMITIGATED LIABILITY
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                ${metrics.totalLiability.toLocaleString()} <span className="text-xs font-normal text-[#a3c9ff]">USD</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Quantified financial risk exposure</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Scale className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752]">
          <button
            onClick={() => setActiveTab('matrix')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'matrix'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Risk Register & Inspector</span>
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'pending'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <FileSignature className="w-3.5 h-3.5 text-amber-400" />
            <span>Pending Sign-Off Queue ({rbdList.filter((r) => r.status === 'pending_signature').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('expiration')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'expiration'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Clock className="w-3.5 h-3.5 text-purple-400" />
            <span>Expiration & Re-evaluation Audit</span>
          </button>
        </div>

        {/* Multi-Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Title, Control ID, UPN, Domain..."
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
            <option value="contoso-01">Contoso Corp</option>
            <option value="fabrikam-02">Fabrikam Inc</option>
            <option value="woodgrove-04">Woodgrove Bank</option>
            <option value="northwind-03">Northwind Traders</option>
            <option value="adventure-05">AdventureWorks</option>
            <option value="tailspin-06">Tailspin Toys</option>
          </select>

          {/* Residual Risk Level */}
          <select
            value={riskLevelFilter}
            onChange={(e) => setRiskLevelFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Residual Risks</option>
            <option value="high">High Residual 🔴</option>
            <option value="medium">Medium Residual 🟡</option>
            <option value="low">Low Residual 🔵</option>
          </select>

          {/* Lifecycle State */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Lifecycle States</option>
            <option value="active">Active / Approved 🟢</option>
            <option value="pending_signature">Awaiting Signature 🟡</option>
            <option value="expired">Expired 🔴</option>
            <option value="revoked">Revoked ⚪</option>
          </select>

          {/* Framework Tag */}
          <select
            value={frameworkFilter}
            onChange={(e) => setFrameworkFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Frameworks</option>
            <option value="NIST 800-53">NIST SP 800-53</option>
            <option value="CIS M365 Baseline">CIS M365 Baseline</option>
            <option value="HIPAA Security Rule">HIPAA Security Rule</option>
            <option value="CMMC Level 2">CMMC Level 2</option>
          </select>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. CORE SUB-TABS CONTENT */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden relative flex">
        
        {/* TAB 1: ACTIVE RISK REGISTER & INSPECTOR (60% / 40% SPLIT) */}
        {activeTab === 'matrix' && (
          <div className="w-full h-full flex flex-col lg:flex-row overflow-hidden">
            
            {/* LEFT PANE (60% Width): Master RBD Table */}
            <div className="w-full lg:w-[60%] h-full overflow-y-auto border-r border-[#404752] p-4 space-y-3 shrink-0">
              <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
                <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                  <span>Master Risk-Based Decision Register ({filteredRbdList.length})</span>
                  <span>Click row to view formal document</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                        <th className="p-3">Risk ID & Title</th>
                        <th className="p-3">Tenant</th>
                        <th className="p-3">Control Violated</th>
                        <th className="p-3">Risk Score</th>
                        <th className="p-3">Signed By</th>
                        <th className="p-3">Expiration</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                      {filteredRbdList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-[#8a919e]">
                            No Risk Acceptance records match the selected criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredRbdList.map((rbd) => {
                          const isSelected = rbd.id === selectedRbd.id;

                          return (
                            <tr
                              key={rbd.id}
                              onClick={() => setSelectedRbdId(rbd.id)}
                              className={cn(
                                'hover:bg-[#272a30]/80 cursor-pointer transition-colors',
                                isSelected ? 'bg-[#0078d4]/15 border-l-4 border-l-[#0078d4]' : ''
                              )}
                            >
                              {/* Risk ID & Title */}
                              <td className="p-3 font-sans">
                                <div className="font-bold text-[#e0e2ea] flex items-center gap-1.5">
                                  <span>{rbd.title}</span>
                                </div>
                                <div className="text-[10px] font-mono text-amber-400 mt-0.5">
                                  {rbd.id} • {rbd.framework}
                                </div>
                              </td>

                              {/* Tenant Name */}
                              <td className="p-3 font-sans">
                                <div className="font-semibold text-[#e0e2ea]">{rbd.tenantName}</div>
                                <div className="text-[10px] font-mono text-[#8a919e]">{rbd.primaryDomain}</div>
                              </td>

                              {/* Control Violated */}
                              <td className="p-3 max-w-[160px] truncate font-mono text-[11px] text-[#a3c9ff]">
                                {rbd.controlViolated}
                              </td>

                              {/* Risk Metrics Badge */}
                              <td className="p-3 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-bold text-white',
                                      rbd.rawRiskLevel === 'critical'
                                        ? 'bg-red-600'
                                        : rbd.rawRiskLevel === 'high'
                                        ? 'bg-amber-600'
                                        : 'bg-yellow-600'
                                    )}
                                  >
                                    RAW: {rbd.rawRiskScore}/25
                                  </span>
                                  <span className="text-[#8a919e]">➔</span>
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] font-bold',
                                      rbd.residualRiskLevel === 'high'
                                        ? 'bg-red-950 text-red-300 border border-red-800'
                                        : rbd.residualRiskLevel === 'medium'
                                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    )}
                                  >
                                    RES: {rbd.residualRiskScore}/25
                                  </span>
                                </div>
                              </td>

                              {/* Signed By */}
                              <td className="p-3 text-[11px] font-sans">
                                {rbd.clientApprover.signedAt ? (
                                  <div>
                                    <div className="font-semibold text-emerald-400 flex items-center gap-1">
                                      <UserCheck className="w-3 h-3" /> {rbd.clientApprover.name}
                                    </div>
                                    <div className="text-[10px] text-[#8a919e] font-mono">
                                      {rbd.clientApprover.title}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-amber-400 font-mono text-[11px]">Awaiting Sign-off</span>
                                )}
                              </td>

                              {/* Expiration Timer */}
                              <td className="p-3 font-mono text-[11px]">
                                <span className="text-[#e0e2ea]">{rbd.expirationDate}</span>
                              </td>

                              {/* Status */}
                              <td className="p-3 whitespace-nowrap">
                                {rbd.status === 'active' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                    APPROVED 🟢
                                  </span>
                                ) : rbd.status === 'pending_signature' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                                    PENDING 🟡
                                  </span>
                                ) : rbd.status === 'expired' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                                    EXPIRED 🔴
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#272a30] text-[#8a919e] border border-[#404752]">
                                    REVOKED ⚪
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

            {/* RIGHT PANE (40% Width): Complete RBD Document Inspector */}
            <div className="w-full lg:w-[40%] h-full overflow-y-auto bg-[#101419] p-4 lg:p-5 space-y-5">
              
              {/* Document Header Controls */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3 shadow-md">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">
                      {selectedRbd.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#272a30] text-[#a3c9ff] border border-[#404752]">
                      {selectedRbd.framework}
                    </span>
                  </div>

                  {selectedRbd.status === 'active' && (
                    <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                      FORMAL RISK ACCEPTANCE ACTIVE
                    </span>
                  )}
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#e0e2ea] leading-snug">
                    {selectedRbd.title}
                  </h2>
                  <div className="text-xs text-[#8a919e] font-mono mt-1">
                    Customer Tenant: <strong className="text-[#e0e2ea]">{selectedRbd.tenantName}</strong> ({selectedRbd.primaryDomain})
                  </div>
                </div>

                <div className="pt-2 border-t border-[#404752]/60 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      onShowToast?.(
                        'success',
                        'Signed PDF Downloaded',
                        `Exported official Risk Acceptance Memorandum PDF for ${selectedRbd.id}.`
                      );
                    }}
                    className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Signed PDF</span>
                  </button>

                  {selectedRbd.status === 'active' && (
                    <button
                      onClick={() => handleRevokeRbd(selectedRbd)}
                      className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-red-300 border border-red-800 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                      <span>Revoke Risk Acceptance</span>
                    </button>
                  )}

                  {selectedRbd.status === 'pending_signature' && (
                    <button
                      onClick={() => handleSimulateClientSignOff(selectedRbd)}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <FileSignature className="w-3.5 h-3.5" />
                      <span>Simulate Client Sign-off</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Section A: Threat & Risk Identification */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Section A: Threat & Risk Identification</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block">M365 Control Violated:</label>
                    <div className="font-mono text-amber-300 font-bold bg-[#101419] p-2 rounded border border-[#404752] mt-0.5">
                      {selectedRbd.controlViolated}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block">Plain-English Hazard Description:</label>
                    <p className="text-[#e0e2ea] bg-[#101419] p-2.5 rounded border border-[#404752] mt-0.5 leading-relaxed text-[11px]">
                      {selectedRbd.hazardDescription}
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block">M365 Graph Telemetry Trigger:</label>
                    <div className="font-mono text-[11px] text-[#a3c9ff] bg-[#101419] p-2 rounded border border-[#404752] mt-0.5 truncate">
                      {selectedRbd.graphEndpoint}
                    </div>
                  </div>

                  {/* Raw Risk Rating Grid */}
                  <div className="pt-2">
                    <div className="text-[11px] font-mono text-[#8a919e] uppercase mb-1">Unmitigated Raw Risk Score:</div>
                    <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                      <div className="p-2 bg-[#101419] rounded border border-[#404752]">
                        <div className="text-[10px] text-[#8a919e]">Likelihood</div>
                        <div className="font-bold text-amber-300">High (4/5)</div>
                      </div>
                      <div className="p-2 bg-[#101419] rounded border border-[#404752]">
                        <div className="text-[10px] text-[#8a919e]">Impact</div>
                        <div className="font-bold text-red-400">Severe (5/5)</div>
                      </div>
                      <div className="p-2 bg-red-950/80 rounded border border-red-800">
                        <div className="text-[10px] text-red-300">Raw Risk</div>
                        <div className="font-bold text-red-200">{selectedRbd.rawRiskScore} / 25 (CRITICAL)</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section B: Compensating Controls & Safeguards */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Section B: Compensating Controls & Safeguards</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="text-[11px] text-[#8a919e]">
                    Mandatory technical and administrative mitigations implemented to reduce vulnerability footprint:
                  </div>

                  <div className="space-y-1.5">
                    {selectedRbd.compensatingControls.map((ctrl, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-[#101419] rounded border border-[#404752] flex items-start gap-2 text-[11px]"
                      >
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold shrink-0 mt-0.5',
                            ctrl.type === 'technical'
                              ? 'bg-blue-950 text-blue-300 border border-blue-800'
                              : ctrl.type === 'operational'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          )}
                        >
                          {ctrl.type}
                        </span>
                        <span className="text-[#e0e2ea] leading-normal">{ctrl.description}</span>
                      </div>
                    ))}
                  </div>

                  {/* Post-Control Residual Evaluation */}
                  <div className="pt-2">
                    <div className="text-[11px] font-mono text-[#8a919e] uppercase mb-1">Post-Control Residual Risk Score:</div>
                    <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                      <div className="p-2 bg-[#101419] rounded border border-[#404752]">
                        <div className="text-[10px] text-[#8a919e]">Post-Likelihood</div>
                        <div className="font-bold text-emerald-400">Low (2/5)</div>
                      </div>
                      <div className="p-2 bg-[#101419] rounded border border-[#404752]">
                        <div className="text-[10px] text-[#8a919e]">Post-Impact</div>
                        <div className="font-bold text-amber-300">Moderate (4/5)</div>
                      </div>
                      <div className="p-2 bg-emerald-950/80 rounded border border-emerald-800">
                        <div className="text-[10px] text-emerald-300">Residual Risk</div>
                        <div className="font-bold text-emerald-200">{selectedRbd.residualRiskScore} / 25 ({selectedRbd.residualRiskLevel.toUpperCase()})</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section C: Chain of Approval & Sign-off History */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <FileSignature className="w-4 h-4 text-[#0078d4]" />
                  <span>Section C: Chain of Approval & Digital Sign-off</span>
                </div>

                <div className="grid grid-cols-1 gap-3 text-xs">
                  
                  {/* MSP Assessor Box */}
                  <div className="p-3 bg-[#101419] rounded border border-[#404752] space-y-1">
                    <div className="text-[10px] font-mono text-[#8a919e] uppercase flex items-center justify-between">
                      <span>MSP Lead Security Assessor</span>
                      <span className="text-emerald-400 font-bold">RECOMMENDED FOR ACCEPTANCE</span>
                    </div>
                    <div className="font-bold text-[#e0e2ea]">{selectedRbd.mspAssessor.name}</div>
                    <div className="text-[11px] font-mono text-[#a3c9ff]">{selectedRbd.mspAssessor.upn}</div>
                    <div className="text-[10px] text-[#8a919e] font-mono">Assessed on: {selectedRbd.mspAssessor.timestamp}</div>
                  </div>

                  {/* Client Approver Box */}
                  <div className="p-3 bg-[#101419] rounded border border-[#404752] space-y-1">
                    <div className="text-[10px] font-mono text-[#8a919e] uppercase flex items-center justify-between">
                      <span>Client Executive Risk Owner</span>
                      {selectedRbd.clientApprover.signedAt ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED SIGNATURE
                        </span>
                      ) : (
                        <span className="text-amber-400 font-bold">AWAITING SIGNATURE</span>
                      )}
                    </div>
                    
                    <div className="font-bold text-[#e0e2ea]">{selectedRbd.clientApprover.name}</div>
                    <div className="text-[11px] font-mono text-[#8a919e]">{selectedRbd.clientApprover.title} ({selectedRbd.clientApprover.email})</div>

                    {selectedRbd.clientApprover.signedAt ? (
                      <div className="pt-2 border-t border-[#404752]/60 space-y-1 font-mono text-[10px]">
                        <div className="text-[#e0e2ea]">Signed At: {selectedRbd.clientApprover.signedAt}</div>
                        <div className="text-[#8a919e]">Signer IP: {selectedRbd.clientApprover.ipAddress}</div>
                        <div className="text-emerald-400 truncate">Fingerprint: {selectedRbd.clientApprover.signatureHash}</div>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <button
                          onClick={() => handleResendSignature(selectedRbd)}
                          className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          <span>Resend Digital Sign-off Request</span>
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: PENDING SIGN-OFF & APPROVAL QUEUE */}
        {activeTab === 'pending' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-4">
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Pending Risk Acceptance Memorandums Awaiting Client Sign-Off ({rbdList.filter((r) => r.status === 'pending_signature').length})</span>
                <span>Send automated reminders or copy direct signing link</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">RBD ID & Title</th>
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">Designated Client Executive</th>
                      <th className="p-3">Unmitigated Risk</th>
                      <th className="p-3">Generated Date</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {rbdList.filter((r) => r.status === 'pending_signature').length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                          No pending risk acceptance sign-off requests in queue.
                        </td>
                      </tr>
                    ) : (
                      rbdList
                        .filter((r) => r.status === 'pending_signature')
                        .map((rbd) => (
                          <tr key={rbd.id} className="hover:bg-[#272a30]/60 transition-colors">
                            <td className="p-3 font-sans">
                              <div className="font-bold text-[#e0e2ea]">{rbd.title}</div>
                              <div className="text-[10px] font-mono text-amber-400">{rbd.id} • {rbd.controlViolated}</div>
                            </td>

                            <td className="p-3 font-sans">
                              <div className="font-semibold text-[#e0e2ea]">{rbd.tenantName}</div>
                              <div className="text-[10px] font-mono text-[#8a919e]">{rbd.primaryDomain}</div>
                            </td>

                            <td className="p-3 font-sans">
                              <div className="font-semibold text-amber-300">{rbd.clientApprover.name || 'Unassigned'}</div>
                              <div className="text-[10px] font-mono text-[#8a919e]">{rbd.clientApprover.title} ({rbd.clientApprover.email})</div>
                            </td>

                            <td className="p-3 font-mono font-bold text-red-400">
                              ${rbd.liabilityValueUsd.toLocaleString()} Exposure
                            </td>

                            <td className="p-3 font-mono text-[#8a919e]">
                              {rbd.createdAt}
                            </td>

                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleResendSignature(rbd)}
                                  className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[11px] font-bold cursor-pointer flex items-center gap-1"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Resend Email</span>
                                </button>

                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(`https://portal.mspplatform.com/sign-rbd/${rbd.id}`);
                                    onShowToast?.('success', 'Sign-Off Link Copied', `Copied magic signature link for ${rbd.id}.`);
                                  }}
                                  className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[11px] font-semibold cursor-pointer flex items-center gap-1"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Link</span>
                                </button>

                                <button
                                  onClick={() => handleSimulateClientSignOff(rbd)}
                                  className="px-2.5 py-1 bg-emerald-800 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Sign Now</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: EXPIRATION & RE-EVALUATION AUDIT */}
        {activeTab === 'expiration' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-6">
            
            <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-[#e0e2ea] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-400" />
                  <span>Mandatory Re-Evaluation Schedule (NIST SP 800-30 Rule 4.3)</span>
                </h3>
                <p className="text-xs text-[#8a919e] mt-1">
                  All active Risk Acceptance Memorandums (RAMs) expire after 365 days or upon major tenant policy updates. Expired risk acceptances require client re-authorization or immediate baseline policy enforcement.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                <div className="bg-[#101419] p-3 rounded border border-red-800/80 space-y-1">
                  <div className="text-xs font-bold text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> EXPIRED RISK ACCEPTANCES (1)
                  </div>
                  <div className="text-xs text-[#e0e2ea]">
                    RBD-2026-085 (AdventureWorks) expired on 2026-07-01.
                  </div>
                  <button
                    onClick={() => {
                      onShowToast?.('warning', 'Baseline Enforcement Initiated', 'Auto-enforced standard M365 sharing policy for AdventureWorks.');
                    }}
                    className="mt-2 px-3 py-1 bg-red-900/80 hover:bg-red-800 text-white text-[11px] font-bold rounded cursor-pointer"
                  >
                    Auto-Enforce Baseline Policy
                  </button>
                </div>

                <div className="bg-[#101419] p-3 rounded border border-amber-800/80 space-y-1">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1">
                    <Clock className="w-4 h-4" /> EXPIRING WITHIN 30 DAYS (2)
                  </div>
                  <div className="text-xs text-[#e0e2ea]">
                    RBD-2026-089 (Contoso) & RBD-2026-086 (Northwind) require review.
                  </div>
                  <button
                    onClick={() => {
                      onShowToast?.('info', 'Annual Re-Evaluation Dispatched', 'Sent annual Risk Acceptance re-evaluation package to Contoso & Northwind CISOs.');
                    }}
                    className="mt-2 px-3 py-1 bg-amber-900/80 hover:bg-amber-800 text-white text-[11px] font-bold rounded cursor-pointer"
                  >
                    Initiate Re-Evaluation
                  </button>
                </div>

                <div className="bg-[#101419] p-3 rounded border border-emerald-800/80 space-y-1">
                  <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> COMPLIANT & ACTIVE (3)
                  </div>
                  <div className="text-xs text-[#e0e2ea]">
                    All compensating controls verified active via automated Graph telemetry checks.
                  </div>
                </div>

              </div>
            </div>

            {/* Master Expiration Timeline Table */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider">
                Full Risk Acceptance Lifecycle & Expiration Calendar
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] text-[11px] uppercase">
                      <th className="p-3">RBD ID</th>
                      <th className="p-3">Customer Tenant</th>
                      <th className="p-3">Risk Title</th>
                      <th className="p-3">Approved Date</th>
                      <th className="p-3">Expiration Date</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 text-[12px]">
                    {rbdList.map((rbd) => (
                      <tr key={rbd.id} className="hover:bg-[#272a30]/60 transition-colors">
                        <td className="p-3 font-bold text-amber-400">{rbd.id}</td>
                        <td className="p-3 text-[#e0e2ea] font-sans font-semibold">{rbd.tenantName}</td>
                        <td className="p-3 text-[#a3c9ff] font-sans max-w-[200px] truncate">{rbd.title}</td>
                        <td className="p-3 text-[#8a919e]">{rbd.createdAt}</td>
                        <td className="p-3 font-bold text-[#e0e2ea]">{rbd.expirationDate}</td>
                        <td className="p-3">
                          {rbd.status === 'active' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                              ACTIVE
                            </span>
                          ) : rbd.status === 'expired' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                              EXPIRED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              onShowToast?.('info', 'Re-evaluation Dispatched', `Triggered annual review workflow for ${rbd.id}.`);
                            }}
                            className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[11px] font-semibold cursor-pointer"
                          >
                            Re-Evaluate
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

      </div>

      {/* ========================================================================= */}
      {/* 4. WIZARD MODAL: CREATE NEW RBD / RISK ACCEPTANCE */}
      {/* ========================================================================= */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-[#e0e2ea]">
                  Formal Risk Acceptance Builder (RBD / RAM)
                </h3>
              </div>
              <button
                onClick={() => setIsWizardOpen(false)}
                className="text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Progress Indicator */}
            <div className="px-6 py-3 bg-[#0b0e14] border-b border-[#404752] flex items-center justify-between text-xs font-mono">
              <div className={cn('flex items-center gap-1.5', wizardStep >= 1 ? 'text-amber-400 font-bold' : 'text-[#8a919e]')}>
                <span className="w-5 h-5 rounded-full bg-amber-950 border border-amber-800 flex items-center justify-center text-[10px]">1</span>
                <span>Tenant & Control</span>
              </div>
              <span className="text-[#404752]">➔</span>
              <div className={cn('flex items-center gap-1.5', wizardStep >= 2 ? 'text-emerald-400 font-bold' : 'text-[#8a919e]')}>
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center text-[10px]">2</span>
                <span>Compensating Controls</span>
              </div>
              <span className="text-[#404752]">➔</span>
              <div className={cn('flex items-center gap-1.5', wizardStep >= 3 ? 'text-[#a3c9ff] font-bold' : 'text-[#8a919e]')}>
                <span className="w-5 h-5 rounded-full bg-blue-950 border border-blue-800 flex items-center justify-center text-[10px]">3</span>
                <span>Residual Risk Rating</span>
              </div>
              <span className="text-[#404752]">➔</span>
              <div className={cn('flex items-center gap-1.5', wizardStep >= 4 ? 'text-purple-400 font-bold' : 'text-[#8a919e]')}>
                <span className="w-5 h-5 rounded-full bg-purple-950 border border-purple-800 flex items-center justify-center text-[10px]">4</span>
                <span>Sign-off Authority</span>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
              
              {/* STEP 1: Tenant & Violated Control */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                      1. Select Customer Tenant:
                    </label>
                    <select
                      value={newRbdTenantId}
                      onChange={(e) => setNewRbdTenantId(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4]"
                    >
                      <option value="contoso-01">Contoso Corporation (contoso.onmicrosoft.com)</option>
                      <option value="fabrikam-02">Fabrikam Inc (fabrikam.onmicrosoft.com)</option>
                      <option value="woodgrove-04">Woodgrove Bank (woodgrovebank.com)</option>
                      <option value="northwind-03">Northwind Traders (northwind.onmicrosoft.com)</option>
                      <option value="adventure-05">AdventureWorks (adventureworks.com)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                      2. Risk Acceptance Title:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Conditional MFA Exemption for Legacy Payroll Server"
                      value={newRbdTitle}
                      onChange={(e) => setNewRbdTitle(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Control Violated:
                      </label>
                      <input
                        type="text"
                        value={newRbdControl}
                        onChange={(e) => setNewRbdControl(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Compliance Framework:
                      </label>
                      <select
                        value={newRbdFramework}
                        onChange={(e) => setNewRbdFramework(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4]"
                      >
                        <option value="CIS M365 Baseline">CIS M365 Baseline</option>
                        <option value="NIST 800-53">NIST SP 800-53</option>
                        <option value="HIPAA Security Rule">HIPAA Security Rule</option>
                        <option value="CMMC Level 2">CMMC Level 2</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                      Hazard Description & Operational Need:
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Explain why the client cannot comply with standard baseline policy..."
                      value={newRbdHazard}
                      onChange={(e) => setNewRbdHazard(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Compensating Controls */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="text-xs text-[#8a919e]">
                    Define mandatory technical, administrative, or operational safeguards that mitigate the unmitigated hazard:
                  </div>

                  <div className="space-y-2">
                    {wizardControls.map((ctrl, index) => (
                      <div
                        key={index}
                        className="p-2.5 bg-[#101419] rounded border border-[#404752] flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-blue-950 text-blue-300 border border-blue-800">
                            {ctrl.type}
                          </span>
                          <span className="text-[#e0e2ea]">{ctrl.description}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveWizardControl(index)}
                          className="text-red-400 hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Control Input */}
                  <div className="p-3 bg-[#101419] rounded border border-[#404752] space-y-2">
                    <div className="text-xs font-bold text-[#e0e2ea]">Add New Compensating Control:</div>
                    <div className="flex gap-2">
                      <select
                        value={newControlType}
                        onChange={(e) => setNewControlType(e.target.value as any)}
                        className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] rounded px-2 py-1 text-xs outline-none"
                      >
                        <option value="technical">Technical</option>
                        <option value="administrative">Administrative</option>
                        <option value="operational">Operational</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Describe mitigation safeguard..."
                        value={newControlText}
                        onChange={(e) => setNewControlText(e.target.value)}
                        className="flex-1 bg-[#181c22] border border-[#404752] text-[#e0e2ea] rounded px-2 py-1 text-xs outline-none"
                      />
                      <button
                        onClick={handleAddWizardControl}
                        className="px-3 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-xs cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Residual Risk Rating */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Unmitigated Raw Risk Level:
                      </label>
                      <select
                        value={newRbdRawRisk}
                        onChange={(e) => setNewRbdRawRisk(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                      >
                        <option value="critical">Critical (Score: 22/25)</option>
                        <option value="high">High (Score: 17/25)</option>
                        <option value="medium">Medium (Score: 12/25)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Post-Control Residual Risk Level:
                      </label>
                      <select
                        value={newRbdResidualRisk}
                        onChange={(e) => setNewRbdResidualRisk(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                      >
                        <option value="high">High Residual (Score: 14/25)</option>
                        <option value="medium">Medium Residual (Score: 8/25)</option>
                        <option value="low">Low Residual (Score: 4/25)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                      Estimated Unmitigated Financial Exposure ($ USD):
                    </label>
                    <input
                      type="number"
                      value={newRbdLiability}
                      onChange={(e) => setNewRbdLiability(Number(e.target.value))}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Sign-off Authority */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div className="text-xs text-[#8a919e]">
                    Specify the Client Executive (CISO, CIO, CEO) authorized to digitally execute the Risk Acceptance Memorandum:
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                      Client Executive Full Name:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Sarah Jenkins"
                      value={approverName}
                      onChange={(e) => setApproverName(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Executive Title:
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Chief Information Officer"
                        value={approverTitle}
                        onChange={(e) => setApproverTitle(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-[#e0e2ea] block mb-1">
                        Executive Email (DocuVault / Sign Link):
                      </label>
                      <input
                        type="email"
                        placeholder="sjenkins@contoso.com"
                        value={approverEmail}
                        onChange={(e) => setApproverEmail(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-[#101419] border-t border-[#404752] flex items-center justify-between">
              {wizardStep > 1 ? (
                <button
                  onClick={() => setWizardStep((prev) => (prev - 1) as any)}
                  className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold cursor-pointer"
                >
                  Previous
                </button>
              ) : (
                <div />
              )}

              {wizardStep < 4 ? (
                <button
                  onClick={() => setWizardStep((prev) => (prev + 1) as any)}
                  className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-xs cursor-pointer"
                >
                  Next Step
                </button>
              ) : (
                <button
                  onClick={handleCreateRbd}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs cursor-pointer shadow-sm flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Generate & Send Digital RAM</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

