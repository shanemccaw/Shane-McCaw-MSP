// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  ShieldAlert,
  KeyRound,
  Key,
  RefreshCw,
  Lock,
  Unlock,
  Mail,
  Search,
  Filter,
  MoreVertical,
  SlidersHorizontal,
  Zap,
  CheckSquare,
  Square,
  Trash2,
  UserPlus,
  FileSpreadsheet,
  Copy,
  ChevronDown,
  X,
  Shield,
  Check,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Download,
  Terminal,
  ExternalLink,
  Clock,
  Building2,
  Eye,
  FileText,
  User,
  Sliders,
  AlertOctagon,
  Globe,
  Radio,
  Layers,
  Info,
  BadgeCheck,
  Building,
  Briefcase,
  ShieldCheck,
  Flame,
  Power,
  UserCog,
  UserMinus,
} from 'lucide-react';
import { Tenant } from '../types';
import { UserOffboardingWizardModal } from '../common/UserOffboardingWizardModal';

export interface MspEmployeeAccount {
  id: string;
  employeeId: string;
  displayName: string;
  userPrincipalName: string;
  mail: string;
  jobTitle: string;
  department:
    | 'Security Operations'
    | 'Cloud Infrastructure'
    | 'Service Desk'
    | 'Client Success'
    | 'Executive Lead'
    | 'Professional Services';
  accountEnabled: boolean;
  status: 'Active' | 'Disabled' | 'PIM Elevated' | 'On Leave';
  gdapRoles: (
    | 'GDAP Global Admin'
    | 'GDAP Security Admin'
    | 'GDAP Exchange Admin'
    | 'GDAP User Admin'
    | 'GDAP Helpdesk Tech'
    | 'Read-Only Tech'
  )[];
  assignedClients: string[]; // Customer tenants assigned to this tech
  mfaStatus: 'FIDO2 Hardware Required' | 'Enforced' | 'Passwordless' | 'Missing MFA';
  authMethods: ('FIDO2 Hardware Key' | 'Authenticator App' | 'Passwordless TAP' | 'SMS Backup' | 'No MFA')[];
  riskLevel: 'High' | 'Medium' | 'Low' | 'None';
  riskDetail?: string;
  pimElevationStatus: 'Standard Role' | 'PIM Elevated (2h remaining)' | 'Break-Glass Active';
  lastSignInDateTime: string;
  lastSignInRelative: string;
  assignedLicenses: string[];
  createdDateTime: string;
  signInLogs: {
    id: string;
    createdDateTime: string;
    appDisplayName: string;
    targetTenantName: string;
    ipAddress: string;
    location: string;
    status: 'Success' | 'Failure';
    failureReason?: string;
  }[];
}

interface UserManagementConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onTriggerAction?: (actionTitle: string, tenantName: string) => void;
}

// Mock MSP Internal Staff & Technician Directory Dataset
const INITIAL_MSP_EMPLOYEES: MspEmployeeAccount[] = [
  {
    id: 'emp-001',
    employeeId: 'APEX-TECH-101',
    displayName: 'Michael Vance',
    userPrincipalName: 'm.vance@apexms.com',
    mail: 'm.vance@apexms.com',
    jobTitle: 'VP of Managed Security & GDAP Lead',
    department: 'Security Operations',
    accountEnabled: true,
    status: 'PIM Elevated',
    gdapRoles: ['GDAP Global Admin', 'GDAP Security Admin'],
    assignedClients: ['All 12 Client Tenants', 'Contoso Corp', 'Fabrikam Inc', 'Woodgrove Bank'],
    mfaStatus: 'FIDO2 Hardware Required',
    authMethods: ['FIDO2 Hardware Key', 'Authenticator App'],
    riskLevel: 'None',
    pimElevationStatus: 'PIM Elevated (2h remaining)',
    lastSignInDateTime: '2026-07-23 21:50:12',
    lastSignInRelative: '4 mins ago',
    assignedLicenses: ['Microsoft 365 E5 Partner', 'Microsoft Copilot for Security'],
    createdDateTime: '2021-03-15',
    signInLogs: [
      {
        id: 'log-101',
        createdDateTime: '2026-07-23 21:50:12',
        appDisplayName: 'Partner Center GDAP Portal',
        targetTenantName: 'Contoso Corporation (Client)',
        ipAddress: '198.51.100.42',
        location: 'New York, US (MSP HQ)',
        status: 'Success',
      },
      {
        id: 'log-102',
        createdDateTime: '2026-07-23 20:10:00',
        appDisplayName: 'Microsoft Defender XDR',
        targetTenantName: 'Fabrikam Inc (Client)',
        ipAddress: '198.51.100.42',
        location: 'New York, US',
        status: 'Success',
      },
    ],
  },
  {
    id: 'emp-002',
    employeeId: 'APEX-TECH-102',
    displayName: 'Sarah Connor',
    userPrincipalName: 's.connor@apexms.com',
    mail: 's.connor@apexms.com',
    jobTitle: 'Principal Cloud Security Engineer',
    department: 'Cloud Infrastructure',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP Security Admin', 'GDAP Exchange Admin'],
    assignedClients: ['Contoso Corp', 'Fabrikam Inc', 'Woodgrove Bank', 'Southridge Video'],
    mfaStatus: 'FIDO2 Hardware Required',
    authMethods: ['FIDO2 Hardware Key'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 21:15:00',
    lastSignInRelative: '38 mins ago',
    assignedLicenses: ['Microsoft 365 E5 Partner'],
    createdDateTime: '2022-01-10',
    signInLogs: [
      {
        id: 'log-201',
        createdDateTime: '2026-07-23 21:15:00',
        appDisplayName: 'Exchange Admin Center (GDAP)',
        targetTenantName: 'Woodgrove Bank (Client)',
        ipAddress: '198.51.100.44',
        location: 'Chicago, US (MSP Node)',
        status: 'Success',
      },
    ],
  },
  {
    id: 'emp-003',
    employeeId: 'APEX-TECH-103',
    displayName: 'Marcus Brody',
    userPrincipalName: 'm.brody@apexms.com',
    mail: 'm.brody@apexms.com',
    jobTitle: 'L2 Service Desk Lead',
    department: 'Service Desk',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP Helpdesk Tech', 'GDAP User Admin'],
    assignedClients: ['Contoso Corp', 'Northwind Traders', 'Tailwind Traders'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'High',
    riskDetail: 'Multiple failed logins detected on MSP VPN Gateway',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 20:45:00',
    lastSignInRelative: '1 hour ago',
    assignedLicenses: ['Business Premium Partner'],
    createdDateTime: '2023-06-01',
    signInLogs: [
      {
        id: 'log-301',
        createdDateTime: '2026-07-23 20:45:00',
        appDisplayName: 'Apex PSA Ticketing Bridge',
        targetTenantName: 'Apex Internal MSP',
        ipAddress: '198.51.100.88',
        location: 'Dallas, US',
        status: 'Failure',
        failureReason: 'Invalid MFA OTP code provided',
      },
    ],
  },
  {
    id: 'emp-004',
    employeeId: 'APEX-TECH-104',
    displayName: 'David Miller',
    userPrincipalName: 'd.miller@apexms.com',
    mail: 'd.miller@apexms.com',
    jobTitle: 'Technical Account Manager (TAM)',
    department: 'Client Success',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['Read-Only Tech'],
    assignedClients: ['Contoso Corp', 'Fabrikam Inc', 'Adatum Corp', 'AdventureWorks'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 18:30:00',
    lastSignInRelative: '3 hours ago',
    assignedLicenses: ['Business Premium Partner'],
    createdDateTime: '2022-11-15',
    signInLogs: [],
  },
  {
    id: 'emp-005',
    employeeId: 'APEX-TECH-105',
    displayName: 'Jessica Alba',
    userPrincipalName: 'j.alba@apexms.com',
    mail: 'j.alba@apexms.com',
    jobTitle: 'Lead SOC Analyst & Incident Handler',
    department: 'Security Operations',
    accountEnabled: true,
    status: 'PIM Elevated',
    gdapRoles: ['GDAP Security Admin', 'GDAP Global Admin'],
    assignedClients: ['All 12 Client Tenants'],
    mfaStatus: 'FIDO2 Hardware Required',
    authMethods: ['FIDO2 Hardware Key', 'Authenticator App'],
    riskLevel: 'None',
    pimElevationStatus: 'PIM Elevated (2h remaining)',
    lastSignInDateTime: '2026-07-23 21:52:00',
    lastSignInRelative: '2 mins ago',
    assignedLicenses: ['Microsoft 365 E5 Partner', 'Defender XDR Analyst'],
    createdDateTime: '2021-08-20',
    signInLogs: [
      {
        id: 'log-501',
        createdDateTime: '2026-07-23 21:52:00',
        appDisplayName: 'Sentinel Threat Hunting Portal',
        targetTenantName: 'All Client Tenants Scope',
        ipAddress: '198.51.100.12',
        location: 'San Francisco, US',
        status: 'Success',
      },
    ],
  },
  {
    id: 'emp-006',
    employeeId: 'APEX-TECH-106',
    displayName: 'Robert Chen',
    userPrincipalName: 'r.chen@apexms.com',
    mail: 'r.chen@apexms.com',
    jobTitle: 'M365 Email & Messaging Engineer',
    department: 'Cloud Infrastructure',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP Exchange Admin'],
    assignedClients: ['Woodgrove Bank', 'Contoso Corp', 'Wide World Importers'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 19:20:00',
    lastSignInRelative: '2 hours ago',
    assignedLicenses: ['Microsoft 365 E5 Partner'],
    createdDateTime: '2023-02-14',
    signInLogs: [],
  },
  {
    id: 'emp-007',
    employeeId: 'APEX-TECH-107',
    displayName: 'Emily Watson',
    userPrincipalName: 'e.watson@apexms.com',
    mail: 'e.watson@apexms.com',
    jobTitle: 'Former Tier 1 Support Tech',
    department: 'Service Desk',
    accountEnabled: false,
    status: 'Disabled',
    gdapRoles: ['Read-Only Tech'],
    assignedClients: [],
    mfaStatus: 'Missing MFA',
    authMethods: ['No MFA'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-04-10 09:00:00',
    lastSignInRelative: 'Disabled (104 days ago)',
    assignedLicenses: [],
    createdDateTime: '2023-09-01',
    signInLogs: [],
  },
  {
    id: 'emp-008',
    employeeId: 'APEX-TECH-108',
    displayName: 'Alice Garcia',
    userPrincipalName: 'a.garcia@apexms.com',
    mail: 'a.garcia@apexms.com',
    jobTitle: 'L1 Service Desk Specialist',
    department: 'Service Desk',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP Helpdesk Tech'],
    assignedClients: ['Tailwind Traders', 'Northwind Traders', 'Alpine Ski House'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'Low',
    riskDetail: 'New mobile device enrolled without compliance check',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 17:10:00',
    lastSignInRelative: '4 hours ago',
    assignedLicenses: ['Business Premium Partner'],
    createdDateTime: '2024-03-10',
    signInLogs: [],
  },
  {
    id: 'emp-009',
    employeeId: 'APEX-TECH-109',
    displayName: 'John Smith',
    userPrincipalName: 'j.smith@apexms.com',
    mail: 'j.smith@apexms.com',
    jobTitle: 'Identity & Entra ID Specialist',
    department: 'Cloud Infrastructure',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP User Admin', 'GDAP Security Admin'],
    assignedClients: ['Contoso Corp', 'Woodgrove Bank', 'Fabrikam Inc'],
    mfaStatus: 'Passwordless',
    authMethods: ['Passwordless TAP', 'FIDO2 Hardware Key'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 21:00:00',
    lastSignInRelative: '53 mins ago',
    assignedLicenses: ['Microsoft 365 E5 Partner'],
    createdDateTime: '2022-07-22',
    signInLogs: [],
  },
  {
    id: 'emp-010',
    employeeId: 'APEX-TECH-110',
    displayName: 'Karen Page',
    userPrincipalName: 'k.page@apexms.com',
    mail: 'k.page@apexms.com',
    jobTitle: 'Director of Compliance & Audit',
    department: 'Executive Lead',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['Read-Only Tech'],
    assignedClients: ['All 12 Client Tenants'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 16:00:00',
    lastSignInRelative: '5 hours ago',
    assignedLicenses: ['Microsoft 365 E5 Partner'],
    createdDateTime: '2020-01-15',
    signInLogs: [],
  },
  {
    id: 'emp-011',
    employeeId: 'APEX-TECH-111',
    displayName: 'Hiroshi Tanaka',
    userPrincipalName: 'h.tanaka@apexms.com',
    mail: 'h.tanaka@apexms.com',
    jobTitle: 'Principal Escalation Architect',
    department: 'Professional Services',
    accountEnabled: true,
    status: 'On Leave',
    gdapRoles: ['GDAP Global Admin'],
    assignedClients: ['Contoso Corp', 'Fabrikam Inc'],
    mfaStatus: 'FIDO2 Hardware Required',
    authMethods: ['FIDO2 Hardware Key'],
    riskLevel: 'None',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-20 12:00:00',
    lastSignInRelative: '3 days ago',
    assignedLicenses: ['Microsoft 365 E5 Partner'],
    createdDateTime: '2021-05-18',
    signInLogs: [],
  },
  {
    id: 'emp-012',
    employeeId: 'APEX-TECH-112',
    displayName: 'Tom Holland',
    userPrincipalName: 't.holland@apexms.com',
    mail: 't.holland@apexms.com',
    jobTitle: 'Junior Field Support Engineer',
    department: 'Service Desk',
    accountEnabled: true,
    status: 'Active',
    gdapRoles: ['GDAP Helpdesk Tech'],
    assignedClients: ['Alpine Ski House', 'Southridge Video'],
    mfaStatus: 'Enforced',
    authMethods: ['Authenticator App'],
    riskLevel: 'Medium',
    riskDetail: 'Unusual IP address location detected on weekend login',
    pimElevationStatus: 'Standard Role',
    lastSignInDateTime: '2026-07-23 15:40:00',
    lastSignInRelative: '6 hours ago',
    assignedLicenses: ['Business Premium Partner'],
    createdDateTime: '2025-01-20',
    signInLogs: [],
  },
];

export const UserManagementConsole: React.FC<UserManagementConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onExecuteWorkflow,
  onShowToast,
  onTriggerAction,
}) => {
  // State
  const [employees, setEmployees] = useState<MspEmployeeAccount[]>(INITIAL_MSP_EMPLOYEES);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'PIM Elevated' | 'Disabled' | 'On Leave'>('All');
  const [deptFilter, setDeptFilter] = useState<string>('All');
  const [gdapFilter, setGdapFilter] = useState<string>('All');
  const [mfaFilter, setMfaFilter] = useState<string>('All');

  // Modals & Drawers
  const [inspectEmployee, setInspectEmployee] = useState<MspEmployeeAccount | null>(null);

  // Gated Workflow Confirmation Modal
  const [gatedModalConfig, setGatedModalConfig] = useState<{
    actionId: string;
    title: string;
    employee: MspEmployeeAccount;
    endpoint: string;
    payload: Record<string, any>;
  } | null>(null);

  const [ticketReasonId, setTicketReasonId] = useState('INC-MSP-2026-881');
  const [isDispatching, setIsDispatching] = useState(false);

  // TAP Modal
  const [generatedTapData, setGeneratedTapData] = useState<{
    employee: MspEmployeeAccount;
    passcode: string;
    duration: string;
    expiresAt: string;
  } | null>(null);

  // Create Staff Modal
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [newStaffForm, setNewStaffForm] = useState({
    displayName: '',
    userPrincipalName: '',
    jobTitle: 'Systems Engineer',
    department: 'Service Desk' as const,
    gdapRole: 'GDAP Helpdesk Tech' as const,
    assignedClientsStr: 'Contoso Corp, Fabrikam Inc',
  });

  // Bulk Import Modal
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  // Offboard Staff Modal
  const [offboardTarget, setOffboardTarget] = useState<MspEmployeeAccount | null>(null);
  const [isOffboardingWizardOpen, setIsOffboardingWizardOpen] = useState(false);

  // KPI Computations
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((e) => e.status === 'Active' || e.status === 'PIM Elevated').length;
  const pimElevatedCount = employees.filter((e) => e.status === 'PIM Elevated' || e.pimElevationStatus.includes('PIM')).length;
  const fido2Covered = employees.filter((e) => e.mfaStatus === 'FIDO2 Hardware Required' || e.mfaStatus === 'Passwordless').length;
  const mfaEnforcedRate = Math.round((fido2Covered / totalEmployees) * 100);
  const riskyEmployees = employees.filter((e) => e.riskLevel === 'High' || e.riskLevel === 'Medium').length;

  // Filtered List
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const q = searchQuery.toLowerCase();
      const matchesQuery =
        emp.displayName.toLowerCase().includes(q) ||
        emp.userPrincipalName.toLowerCase().includes(q) ||
        emp.jobTitle.toLowerCase().includes(q) ||
        emp.employeeId.toLowerCase().includes(q) ||
        emp.assignedClients.some((c) => c.toLowerCase().includes(q));

      const matchesStatus = statusFilter === 'All' || emp.status === statusFilter;
      const matchesDept = deptFilter === 'All' || emp.department === deptFilter;
      const matchesGdap =
        gdapFilter === 'All' || emp.gdapRoles.some((r) => r.toLowerCase().includes(gdapFilter.toLowerCase()));
      const matchesMfa = mfaFilter === 'All' || emp.mfaStatus === mfaFilter;

      return matchesQuery && matchesStatus && matchesDept && matchesGdap && matchesMfa;
    });
  }, [employees, searchQuery, statusFilter, deptFilter, gdapFilter, mfaFilter]);

  // Checkbox Selection
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredEmployees.map((emp) => emp.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Dispatch Gated Action
  const handleConfirmGatedAction = () => {
    if (!gatedModalConfig) return;
    setIsDispatching(true);

    setTimeout(() => {
      setIsDispatching(false);
      const { actionId, employee, payload } = gatedModalConfig;

      if (onExecuteWorkflow) {
        onExecuteWorkflow(actionId, {
          ...payload,
          ticketId: ticketReasonId,
          targetStaffUPN: employee.userPrincipalName,
          executedBy: 'security-director@apexms.com',
          timestamp: new Date().toISOString(),
        });
      }

      if (actionId === 'suspend-staff') {
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employee.id
              ? { ...e, status: 'Disabled', accountEnabled: false, pimElevationStatus: 'Standard Role' }
              : e
          )
        );
        onShowToast?.('warning', 'MSP Engineer Suspended', `Disabled account & revoked GDAP tokens for ${employee.displayName}.`);
      } else if (actionId === 'revoke-gdap-tokens') {
        onShowToast?.('success', 'GDAP Tokens Revoked', `Terminated active GDAP cross-tenant sessions for ${employee.displayName}.`);
      } else if (actionId === 'trigger-pim-elevation') {
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employee.id
              ? {
                  ...e,
                  status: 'PIM Elevated',
                  pimElevationStatus: 'PIM Elevated (2h remaining)',
                  gdapRoles: Array.from(new Set([...e.gdapRoles, 'GDAP Global Admin'])),
                }
              : e
          )
        );
        onShowToast?.('success', 'PIM Privilege Elevated', `Granted 2-hour GDAP Global Admin access to ${employee.displayName}.`);
      }

      setGatedModalConfig(null);
    }, 600);
  };

  // Generate TAP
  const handleGenerateTap = (emp: MspEmployeeAccount) => {
    const rawPass = `APEX#7k9$${Math.floor(1000 + Math.random() * 9000)}`;
    setGeneratedTapData({
      employee: emp,
      passcode: rawPass,
      duration: '8 Hours',
      expiresAt: '2026-07-24 06:00:00 (Tomorrow)',
    });
    onShowToast?.('success', 'Staff TAP Created', `Temporary Access Pass generated for ${emp.displayName}.`);
  };

  // Create Staff
  const handleCreateStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffForm.displayName || !newStaffForm.userPrincipalName) return;

    const upn = newStaffForm.userPrincipalName.includes('@')
      ? newStaffForm.userPrincipalName
      : `${newStaffForm.userPrincipalName}@apexms.com`;

    const clients = newStaffForm.assignedClientsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const newEmp: MspEmployeeAccount = {
      id: `emp-${Date.now()}`,
      employeeId: `APEX-TECH-${Math.floor(120 + Math.random() * 80)}`,
      displayName: newStaffForm.displayName,
      userPrincipalName: upn,
      mail: upn,
      jobTitle: newStaffForm.jobTitle,
      department: newStaffForm.department,
      accountEnabled: true,
      status: 'Active',
      gdapRoles: [newStaffForm.gdapRole],
      assignedClients: clients.length > 0 ? clients : ['Contoso Corp'],
      mfaStatus: 'FIDO2 Hardware Required',
      authMethods: ['FIDO2 Hardware Key', 'Authenticator App'],
      riskLevel: 'None',
      pimElevationStatus: 'Standard Role',
      lastSignInDateTime: 'Never',
      lastSignInRelative: 'New Account',
      assignedLicenses: ['Microsoft 365 E5 Partner'],
      createdDateTime: new Date().toISOString().split('T')[0],
      signInLogs: [],
    };

    setEmployees((prev) => [newEmp, ...prev]);
    setIsCreateStaffOpen(false);
    onShowToast?.('success', 'MSP Staff Account Provisioned', `Added ${newEmp.userPrincipalName} to Apex MSP Directory.`);
  };

  // Offboard Staff
  const handleExecuteOffboard = () => {
    if (!offboardTarget) return;
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === offboardTarget.id
          ? {
              ...e,
              status: 'Disabled',
              accountEnabled: false,
              assignedClients: [],
              gdapRoles: ['Read-Only Tech'],
              pimElevationStatus: 'Standard Role',
            }
          : e
      )
    );
    onShowToast?.(
      'success',
      'MSP Offboarding Completed',
      `Disabled ${offboardTarget.userPrincipalName}, cleared GDAP client access, and reclaimed partner licenses.`
    );
    setOffboardTarget(null);
  };

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea] bg-[#0b0e14] font-sans select-none">
      
      {/* ========================================================================= */}
      {/* 1. MSP EXECUTIVE HEADER & GDAP IDENTITY METRICS BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 shadow-md space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          
          {/* Header Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center font-bold text-base text-[#a3c9ff] shadow-inner shrink-0">
              <UserCog className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                  <span>MSP Employee & Technician Directory</span>
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 text-xs font-mono font-medium">
                  Partner Tenant: apexms.com
                </span>
              </div>

              <p className="text-xs text-[#8a919e] mt-0.5">
                Manage Apex MSP engineers, GDAP delegated tenant permissions, PIM privilege elevations, and FIDO2 hardware tokens.
              </p>
            </div>
          </div>

          {/* KPI Cards (6 Counters) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 min-w-[320px] xl:min-w-[680px]">
            
            {/* Total MSP Employees */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>MSP Staff</span>
                <Users className="w-3.5 h-3.5 text-[#a3c9ff]" />
              </span>
              <div className="text-base font-bold text-[#e0e2ea] font-mono">{totalEmployees} Engineers</div>
            </div>

            {/* Active Technicians */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>Active Techs</span>
                <UserCheck className="w-3.5 h-3.5 text-[#4ade80]" />
              </span>
              <div className="text-base font-bold text-[#4ade80] font-mono">{activeEmployees} Active</div>
            </div>

            {/* PIM Elevated Techs */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>PIM Elevated</span>
                <Flame className="w-3.5 h-3.5 text-amber-400" />
              </span>
              <div className="text-base font-bold text-amber-400 font-mono">{pimElevatedCount} Elevated</div>
            </div>

            {/* FIDO2 Hardware Enforcement */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>FIDO2 Enforced</span>
                <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
              </span>
              <div className="text-base font-bold text-purple-300 font-mono">{mfaEnforcedRate}% Covered</div>
            </div>

            {/* Managed Client Tenants Scope */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>Managed Clients</span>
                <Building2 className="w-3.5 h-3.5 text-[#a3c9ff]" />
              </span>
              <div className="text-base font-bold text-[#a3c9ff] font-mono">12 Tenants</div>
            </div>

            {/* Risky Accounts */}
            <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-mono uppercase font-bold tracking-wider flex items-center justify-between">
                <span>Flagged Risk</span>
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
              </span>
              <div className="text-base font-bold text-red-400 font-mono">{riskyEmployees} Risky</div>
            </div>

          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & SEARCH / FILTERS */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 space-y-3 shadow-md">
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Search Bar */}
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-[#8a919e] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search MSP staff by Name, UPN (@apexms.com), Job Title, Employee ID, or Client..."
              className="w-full bg-[#101419] border border-[#404752] rounded-md pl-9 pr-8 py-1.5 text-xs text-[#e0e2ea] placeholder-[#8a919e] outline-none focus:border-[#0078d4] transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setOffboardTarget(null);
                setIsOffboardingWizardOpen(true);
              }}
              className="bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white px-3.5 py-1.5 rounded text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <UserMinus className="w-3.5 h-3.5" />
              <span>⚡ User Offboarding Wizard</span>
            </button>

            <button
              onClick={() => setIsCreateStaffOpen(true)}
              className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded text-xs font-semibold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Engineer</span>
            </button>

            <button
              onClick={() => setIsBulkImportOpen(true)}
              className="bg-[#272a30] border border-[#404752] hover:bg-[#31353b] hover:border-[#0078d4] text-[#e0e2ea] px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#4ade80]" />
              <span>Bulk Import</span>
            </button>

            <button
              onClick={() =>
                onShowToast?.(
                  'success',
                  'MSP Roster Exported',
                  'Generated PDF audit report for Apex Managed Services internal staff & GDAP assignments.'
                )
              }
              className="bg-[#272a30] border border-[#404752] hover:bg-[#31353b] hover:border-[#0078d4] text-[#e0e2ea] px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" />
              <span>Export Audit</span>
            </button>

            <button
              onClick={() =>
                onShowToast?.('info', 'Partner Center Synced', 'Updated GDAP delegated roles & active technician sessions.')
              }
              className="p-1.5 bg-[#272a30] border border-[#404752] hover:border-[#0078d4] text-[#e0e2ea] rounded cursor-pointer"
              title="Refresh GDAP Telemetry"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#a3c9ff]" />
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-[#404752]/50">
          <span className="text-[#8a919e] font-mono font-medium flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5 text-[#a3c9ff]" /> Filters:
          </span>

          {/* Department */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded px-2.5 py-1 text-xs outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">Dept: All Departments</option>
            <option value="Security Operations">Security Operations</option>
            <option value="Cloud Infrastructure">Cloud Infrastructure</option>
            <option value="Service Desk">Service Desk</option>
            <option value="Client Success">Client Success</option>
            <option value="Executive Lead">Executive Lead</option>
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded px-2.5 py-1 text-xs outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">Status: All</option>
            <option value="Active">Status: Active Techs</option>
            <option value="PIM Elevated">Status: PIM Elevated 🔥</option>
            <option value="Disabled">Status: Disabled Staff</option>
            <option value="On Leave">Status: On Leave</option>
          </select>

          {/* GDAP Role */}
          <select
            value={gdapFilter}
            onChange={(e) => setGdapFilter(e.target.value)}
            className="bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded px-2.5 py-1 text-xs outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">GDAP Role: All</option>
            <option value="GDAP Global Admin">GDAP Global Admin 🔴</option>
            <option value="GDAP Security Admin">GDAP Security Admin 🟣</option>
            <option value="GDAP Helpdesk Tech">GDAP Helpdesk Tech 🔵</option>
            <option value="Read-Only">Read-Only Tech</option>
          </select>

          {/* Reset */}
          {(deptFilter !== 'All' || statusFilter !== 'All' || gdapFilter !== 'All' || searchQuery) && (
            <button
              onClick={() => {
                setDeptFilter('All');
                setStatusFilter('All');
                setGdapFilter('All');
                setSearchQuery('');
              }}
              className="text-xs text-[#a3c9ff] hover:underline font-semibold ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Floating Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-[#101419] border border-[#0078d4]/60 rounded-lg p-3 shadow-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#e0e2ea]">
            <span className="px-2 py-0.5 rounded bg-[#0078d4] font-mono text-white text-xs">
              {selectedIds.length} Selected
            </span>
            <span>MSP Staff Bulk Actions</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                onShowToast?.('success', 'GDAP Tokens Revoked', `Revoked active cross-tenant sessions for ${selectedIds.length} engineers.`);
                setSelectedIds([]);
              }}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Revoke GDAP Tokens
            </button>

            <button
              onClick={() => {
                onShowToast?.('warning', 'FIDO2 Enforcement', `Required hardware token enrollment for ${selectedIds.length} accounts.`);
                setSelectedIds([]);
              }}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Enforce FIDO2
            </button>

            <button
              onClick={() => {
                setEmployees((prev) =>
                  prev.map((e) => (selectedIds.includes(e.id) ? { ...e, status: 'Disabled', accountEnabled: false } : e))
                );
                onShowToast?.('error', 'Staff Suspended', `Disabled ${selectedIds.length} MSP employee accounts.`);
                setSelectedIds([]);
              }}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Suspend Accounts
            </button>

            <button onClick={() => setSelectedIds([])} className="px-2 py-1 text-[#8a919e] hover:text-[#e0e2ea] text-xs font-semibold cursor-pointer">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. HIGH-DENSITY MSP STAFF DIRECTORY TABLE */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-md">
        
        <div className="p-3.5 border-b border-[#404752] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#e0e2ea] text-xs uppercase tracking-wider font-mono flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[#a3c9ff]" />
              <span>Apex MSP Internal Staff Roster (<code className="text-[#a3c9ff]">@apexms.com</code>)</span>
            </h3>
            <p className="text-xs text-[#8a919e]">
              Showing {filteredEmployees.length} of {employees.length} technician profiles
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#404752] bg-[#101419] text-[#8a919e] font-mono uppercase text-[11px]">
                <th className="py-2 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filteredEmployees.length && filteredEmployees.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-[#404752] bg-[#101419] text-[#0078d4] focus:ring-0 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-3">MSP Engineer Name & UPN</th>
                <th className="py-2 px-3">GDAP Delegated Roles</th>
                <th className="py-2 px-3">Account & PIM Status</th>
                <th className="py-2 px-3">Assigned Client Scope</th>
                <th className="py-2 px-3">Authentication & Hardware</th>
                <th className="py-2 px-3 text-right">Quick Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#404752]/40 font-sans">
              {filteredEmployees.map((emp) => {
                const isSelected = selectedIds.includes(emp.id);
                const isGdapGlobal = emp.gdapRoles.includes('GDAP Global Admin');
                const initials = emp.displayName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2);

                return (
                  <tr
                    key={emp.id}
                    className={`hover:bg-[#272a30]/50 transition-colors ${
                      isSelected ? 'bg-[#0078d4]/10' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleRow(emp.id)}
                        className="rounded border-[#404752] bg-[#101419] text-[#0078d4] focus:ring-0 cursor-pointer"
                      />
                    </td>

                    {/* Name & UPN */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-md flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
                            isGdapGlobal
                              ? 'bg-[#0078d4]/30 text-[#a3c9ff] border border-[#0078d4]/60'
                              : 'bg-[#272a30] text-[#a3c9ff] border border-[#404752]'
                          }`}
                        >
                          {initials}
                        </div>

                        <div>
                          <div className="font-semibold text-[#e0e2ea] flex items-center gap-1.5">
                            <span>{emp.displayName}</span>
                            <span className="text-[10px] text-[#8a919e] font-mono">({emp.employeeId})</span>
                          </div>
                          <div className="text-[10.5px] font-mono text-[#a3c9ff]">{emp.userPrincipalName}</div>
                          <div className="text-[10px] text-[#8a919e]">{emp.jobTitle} • {emp.department}</div>
                        </div>
                      </div>
                    </td>

                    {/* GDAP Roles */}
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {emp.gdapRoles.map((role, i) => (
                          <span
                            key={i}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                              role === 'GDAP Global Admin'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                                : role === 'GDAP Security Admin'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                : role === 'GDAP Exchange Admin'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                : 'bg-[#272a30] text-[#e0e2ea] border border-[#404752]'
                            }`}
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Status & PIM */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1 ${
                            emp.status === 'Active'
                              ? 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                              : emp.status === 'PIM Elevated'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : emp.status === 'Disabled'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              emp.status === 'Active'
                                ? 'bg-[#4ade80]'
                                : emp.status === 'PIM Elevated'
                                ? 'bg-amber-400 animate-ping'
                                : 'bg-red-400'
                            }`}
                          />
                          {emp.status}
                        </span>

                        <div className="text-[9.5px] font-mono text-[#8a919e]">
                          PIM: {emp.pimElevationStatus}
                        </div>
                      </div>
                    </td>

                    {/* Assigned Clients Scope */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-0.5 max-w-[180px]">
                        <div className="text-xs font-medium text-[#e0e2ea] truncate">
                          {emp.assignedClients[0] || 'No Clients Assigned'}
                        </div>
                        {emp.assignedClients.length > 1 && (
                          <span className="text-[10px] text-[#a3c9ff] font-mono font-semibold">
                            +{emp.assignedClients.length - 1} More Tenants
                          </span>
                        )}
                      </div>
                    </td>

                    {/* MFA & Hardware */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                            emp.mfaStatus === 'FIDO2 Hardware Required'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                              : 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                          }`}
                        >
                          {emp.mfaStatus}
                        </span>
                        <div className="text-[10px] text-[#8a919e]">{emp.authMethods.join(', ')}</div>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setInspectEmployee(emp)}
                          className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] hover:border-[#0078d4] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold cursor-pointer transition-all flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>

                        <button
                          onClick={() => {
                            setOffboardTarget(emp);
                            setIsOffboardingWizardOpen(true);
                          }}
                          className="px-2 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded text-xs font-semibold cursor-pointer transition-all flex items-center gap-1"
                          title="Launch Offboarding Wizard for employee"
                        >
                          <UserMinus className="w-3.5 h-3.5 text-red-400" />
                          <span>Offboard</span>
                        </button>

                        <button
                          onClick={() =>
                            setGatedModalConfig({
                              actionId: 'revoke-gdap-tokens',
                              title: 'Revoke GDAP Cross-Tenant Sessions',
                              employee: emp,
                              endpoint: `POST /partnerCenter/delegatedAccess/${emp.id}/revokeSessions`,
                              payload: { staffUPN: emp.userPrincipalName, forceOauthTermination: true },
                            })
                          }
                          className="p-1.5 bg-[#272a30] hover:bg-amber-900/40 text-amber-300 border border-[#404752] rounded cursor-pointer transition-colors"
                          title="Revoke GDAP Tokens"
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. INSPECT MSP STAFF DRAWER */}
      {/* ========================================================================= */}
      {inspectEmployee && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex justify-end animate-in fade-in">
          <div className="w-full max-w-xl bg-[#181c22] border-l border-[#404752] h-full p-5 overflow-y-auto space-y-5 shadow-2xl">
            
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  <UserCog className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#e0e2ea]">{inspectEmployee.displayName}</h2>
                  <div className="text-xs font-mono text-[#a3c9ff]">{inspectEmployee.userPrincipalName}</div>
                </div>
              </div>

              <button onClick={() => setInspectEmployee(null)} className="p-1.5 text-[#8a919e] hover:text-[#e0e2ea] rounded bg-[#272a30]">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Summary Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
                <div className="text-[#8a919e] font-mono text-[10px] uppercase font-bold">Employee ID</div>
                <div className="font-mono text-[#e0e2ea]">{inspectEmployee.employeeId}</div>
              </div>
              <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
                <div className="text-[#8a919e] font-mono text-[10px] uppercase font-bold">Department</div>
                <div className="text-[#a3c9ff] font-medium">{inspectEmployee.department}</div>
              </div>
              <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
                <div className="text-[#8a919e] font-mono text-[10px] uppercase font-bold">PIM Status</div>
                <div className="font-mono text-amber-400">{inspectEmployee.pimElevationStatus}</div>
              </div>
              <div className="p-2.5 rounded-md bg-[#101419] border border-[#404752] space-y-0.5">
                <div className="text-[#8a919e] font-mono text-[10px] uppercase font-bold">MFA Hardware</div>
                <div className="font-mono text-purple-300">{inspectEmployee.mfaStatus}</div>
              </div>
            </div>

            {/* Assigned Customer Tenants Scope */}
            <div className="p-3.5 rounded-md bg-[#101419] border border-[#404752] space-y-2">
              <h4 className="text-xs font-bold text-[#e0e2ea] font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-[#a3c9ff]" />
                <span>Assigned Customer Scope ({inspectEmployee.assignedClients.length})</span>
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {inspectEmployee.assignedClients.map((client, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-[#272a30] border border-[#404752] text-xs font-medium text-[#e0e2ea]">
                    {client}
                  </span>
                ))}
              </div>
            </div>

            {/* Emergency Action Buttons */}
            <div className="p-3.5 rounded-md bg-[#101419] border border-[#404752] space-y-2.5">
              <h4 className="text-xs font-bold text-[#e0e2ea] font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Technician Identity Actions</span>
              </h4>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleGenerateTap(inspectEmployee)}
                  className="p-2 bg-[#272a30] hover:bg-[#31353b] hover:border-[#0078d4] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Generate TAP</span>
                </button>

                <button
                  onClick={() =>
                    setGatedModalConfig({
                      actionId: 'trigger-pim-elevation',
                      title: 'Elevate GDAP Privileges (PIM)',
                      employee: inspectEmployee,
                      endpoint: `POST /entra/pim/elevateStaff/${inspectEmployee.id}`,
                      payload: { role: 'GDAP Global Admin', durationHours: 2 },
                    })
                  }
                  className="p-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Flame className="w-4 h-4" />
                  <span>Elevate PIM Admin (2h)</span>
                </button>
              </div>

              <button
                onClick={() => setOffboardTarget(inspectEmployee)}
                className="w-full p-2 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-500/40 rounded text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserX className="w-4 h-4" />
                <span>Offboard MSP Engineer</span>
              </button>
            </div>

            {/* Audit Logs */}
            <div className="p-3.5 rounded-md bg-[#101419] border border-[#404752] space-y-2.5">
              <h4 className="text-xs font-bold text-[#e0e2ea] font-mono uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-purple-400" />
                <span>Recent Partner Center Sign-in Logs</span>
              </h4>

              {inspectEmployee.signInLogs.length === 0 ? (
                <p className="text-xs text-[#8a919e] italic">No recent cross-tenant sign-in logs recorded.</p>
              ) : (
                <div className="space-y-2">
                  {inspectEmployee.signInLogs.map((log) => (
                    <div key={log.id} className="p-2.5 bg-[#181c22] border border-[#404752] rounded text-xs space-y-1">
                      <div className="flex justify-between items-center text-[#e0e2ea] font-semibold">
                        <span>{log.appDisplayName}</span>
                        <span className={log.status === 'Success' ? 'text-[#4ade80]' : 'text-red-400'}>{log.status}</span>
                      </div>
                      <div className="text-[10.5px] text-[#8a919e]">Target: {log.targetTenantName}</div>
                      <div className="text-[10px] text-[#8a919e] font-mono">{log.createdDateTime} • {log.ipAddress} ({log.location})</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. GATED ACTION CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {gatedModalConfig && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
            
            <div className="flex items-center gap-3 text-amber-400">
              <ShieldAlert className="w-7 h-7" />
              <div>
                <h3 className="text-base font-black text-white">{gatedModalConfig.title}</h3>
                <p className="text-xs text-slate-400">Security Gate Approval & Audit Logging Required</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 text-xs space-y-1.5">
              <div className="text-slate-400 font-bold">Target Technician:</div>
              <div className="font-mono text-indigo-300">{gatedModalConfig.employee.displayName} ({gatedModalConfig.employee.userPrincipalName})</div>
              <div className="text-slate-400 font-bold mt-2">Graph API Endpoint:</div>
              <div className="font-mono text-slate-300 text-[11px] bg-slate-900 p-2 rounded border border-slate-800">{gatedModalConfig.endpoint}</div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#e0e2ea]">PSA Ticket ID / Reason (Required):</label>
              <input
                type="text"
                value={ticketReasonId}
                onChange={(e) => setTicketReasonId(e.target.value)}
                placeholder="INC-MSP-2026-XXXX"
                className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-xs text-[#e0e2ea] outline-none focus:border-[#0078d4] font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setGatedModalConfig(null)} className="px-3 py-1.5 bg-[#272a30] text-[#e0e2ea] rounded text-xs font-semibold hover:bg-[#31353b]">
                Cancel
              </button>
              <button
                onClick={handleConfirmGatedAction}
                disabled={isDispatching}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-md"
              >
                {isDispatching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>Confirm & Dispatch Action</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. CREATE MSP STAFF MODAL */}
      {/* ========================================================================= */}
      {isCreateStaffOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleCreateStaffSubmit} className="bg-[#181c22] border border-[#404752] rounded-lg p-5 max-w-md w-full space-y-4 shadow-2xl">
            
            <div className="flex items-center justify-between border-b border-[#404752] pb-2.5">
              <h3 className="text-sm font-bold text-[#e0e2ea] flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#a3c9ff]" />
                <span>Create MSP Staff Account</span>
              </h3>
              <button type="button" onClick={() => setIsCreateStaffOpen(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="font-semibold text-[#e0e2ea]">Display Name:</label>
                <input
                  type="text"
                  required
                  value={newStaffForm.displayName}
                  onChange={(e) => setNewStaffForm({ ...newStaffForm, displayName: e.target.value })}
                  placeholder="e.g. Alex Morgan"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="font-semibold text-[#e0e2ea]">User Principal Name (@apexms.com):</label>
                <input
                  type="text"
                  required
                  value={newStaffForm.userPrincipalName}
                  onChange={(e) => setNewStaffForm({ ...newStaffForm, userPrincipalName: e.target.value })}
                  placeholder="a.morgan@apexms.com"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] outline-none focus:border-[#0078d4] font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-[#e0e2ea]">Job Title:</label>
                <input
                  type="text"
                  value={newStaffForm.jobTitle}
                  onChange={(e) => setNewStaffForm({ ...newStaffForm, jobTitle: e.target.value })}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="font-semibold text-[#e0e2ea]">Department:</label>
                <select
                  value={newStaffForm.department}
                  onChange={(e) => setNewStaffForm({ ...newStaffForm, department: e.target.value as any })}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] outline-none focus:border-[#0078d4] cursor-pointer"
                >
                  <option value="Service Desk">Service Desk</option>
                  <option value="Security Operations">Security Operations</option>
                  <option value="Cloud Infrastructure">Cloud Infrastructure</option>
                  <option value="Client Success">Client Success</option>
                  <option value="Professional Services">Professional Services</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-[#e0e2ea]">Initial GDAP Role:</label>
                <select
                  value={newStaffForm.gdapRole}
                  onChange={(e) => setNewStaffForm({ ...newStaffForm, gdapRole: e.target.value as any })}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] outline-none focus:border-[#0078d4] cursor-pointer"
                >
                  <option value="GDAP Helpdesk Tech">GDAP Helpdesk Tech</option>
                  <option value="GDAP Security Admin">GDAP Security Admin</option>
                  <option value="GDAP User Admin">GDAP User Admin</option>
                  <option value="Read-Only Tech">Read-Only Tech</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setIsCreateStaffOpen(false)} className="px-3 py-1.5 bg-[#272a30] text-[#e0e2ea] rounded text-xs font-semibold hover:bg-[#31353b]">
                Cancel
              </button>
              <button type="submit" className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold">
                Provision Account
              </button>
            </div>

          </form>
        </div>
      )}

      {/* TAP Dialog */}
      {generatedTapData && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[#a3c9ff]">
              <KeyRound className="w-5 h-5" />
              <h3 className="text-sm font-bold text-[#e0e2ea]">Temporary Access Pass (TAP)</h3>
            </div>

            <div className="p-3.5 bg-[#101419] rounded border border-[#0078d4]/40 text-center space-y-2">
              <div className="text-xs text-[#8a919e]">One-Time Passcode for {generatedTapData.employee.displayName}</div>
              <div className="text-xl font-mono font-bold text-[#a3c9ff] tracking-wider bg-[#181c22] p-2.5 rounded border border-[#404752]">
                {generatedTapData.passcode}
              </div>
              <div className="text-[10px] text-[#8a919e]">Valid Duration: {generatedTapData.duration} • Expires {generatedTapData.expiresAt}</div>
            </div>

            <button onClick={() => setGeneratedTapData(null)} className="w-full py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white font-semibold rounded text-xs">
              Done & Close
            </button>
          </div>
        </div>
      )}

      {/* 7-STEP DETERMINISTIC USER OFFBOARDING WIZARD MODAL */}
      <UserOffboardingWizardModal
        isOpen={isOffboardingWizardOpen}
        initialEmployee={offboardTarget}
        onClose={() => {
          setIsOffboardingWizardOpen(false);
          setOffboardTarget(null);
        }}
        onShowToast={onShowToast}
        onCompleteOffboarding={(details) => {
          if (offboardTarget) {
            setEmployees(prev => prev.map(emp => emp.id === offboardTarget.id ? { ...emp, status: 'Disabled', accountEnabled: false } : emp));
          }
        }}
      />

    </div>
  );
};

