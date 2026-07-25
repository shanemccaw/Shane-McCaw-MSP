import React, { useState, useMemo } from 'react';
import {
  UserMinus,
  Building2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  KeyRound,
  HardDrive,
  Mail,
  RefreshCw,
  Search,
  Filter,
  SlidersHorizontal,
  Download,
  Trash2,
  FileText,
  Sparkles,
  ChevronRight,
  Shield,
  Zap,
  Check,
  Plus,
  X,
  Radio,
  FileCode,
  ArrowUpRight,
  HelpCircle,
  Activity,
  FileCheck,
  AlertOctagon,
  Lock,
  UserCheck,
  ShieldCheck,
  Award,
  Terminal,
  ExternalLink,
  Users,
  Copy,
  Layers,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

export interface OffboardingStep {
  stepNumber: number;
  title: string;
  description: string;
  graphEndpoint: string;
  status: 'passed' | 'failed' | 'running' | 'pending';
  latencyMs?: number;
  timestamp?: string;
  responsePayload?: string;
}

export interface OffboardingRun {
  id: string;
  runCode: string;
  targetUserUpn: string;
  targetUserName: string;
  targetUserAvatar?: string;
  targetRole?: string;
  tenantId: string;
  tenantName: string;
  managerUpn: string;
  managerName?: string;
  pipelineType: 'standard_user' | 'executive_user' | 'tenant_handover';
  status: 'completed' | 'in_progress' | 'pending_approval' | 'failed';
  startedAt: string;
  completedAt: string | null;
  reclaimedLicenseSku: string;
  reclaimedMonthlyCost: number;
  completedSteps: number;
  totalSteps: number;
  steps: OffboardingStep[];
  outOfOfficeMessage?: string;
}

export interface TenantHandoverItem {
  id: string;
  tenantName: string;
  tenantId: string;
  primaryContactUpn: string;
  gdapStatus: 'Active GDAP' | 'Revoked 🔴' | 'Pending Handover';
  effectiveDate: string;
  agentCount: number;
  backupStatus: 'Exported 🟢' | 'Pending';
  status: 'completed' | 'in_progress' | 'scheduled';
  steps: { name: string; status: 'completed' | 'in_progress' | 'pending'; time?: string }[];
}

interface OffboardingConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
}

// Default 7-step templates for Graph API offboarding
const DEFAULT_7_STEPS: OffboardingStep[] = [
  {
    stepNumber: 1,
    title: 'Immediate Session Revocation',
    description: 'Invalidates all OAuth refresh tokens and active sign-in sessions instantly.',
    graphEndpoint: 'POST /v1.0/users/{id}/revokeSignInSessions',
    status: 'passed',
    latencyMs: 110,
    timestamp: '14:10:02',
    responsePayload: '{"@odata.context":"...","value":true,"HTTP":200}',
  },
  {
    stepNumber: 2,
    title: 'Account Disable & Password Scramble',
    description: 'Sets accountEnabled=false and generates a 64-char crypto entropy secret.',
    graphEndpoint: 'PATCH /v1.0/users/{id}',
    status: 'passed',
    latencyMs: 140,
    timestamp: '14:10:03',
    responsePayload: '{"accountEnabled":false,"passwordProfile":{...},"HTTP":204}',
  },
  {
    stepNumber: 3,
    title: 'Wipe MFA Authentication Methods',
    description: 'Deletes registered FIDO2 keys, Authenticator apps, and phone numbers.',
    graphEndpoint: 'DELETE /v1.0/users/{id}/authentication/methods',
    status: 'passed',
    latencyMs: 95,
    timestamp: '14:10:04',
    responsePayload: '{"deletedMethodsCount":3,"status":"SUCCESS"}',
  },
  {
    stepNumber: 4,
    title: 'Mailbox Conversion & Delegation',
    description: 'Converts to Shared Mailbox, assigns FullAccess/SendAs to manager, sets Out-Of-Office.',
    graphEndpoint: 'POST /v1.0/users/{id}/mailFolders/convertAndDelegate',
    status: 'passed',
    latencyMs: 320,
    timestamp: '14:10:05',
    responsePayload: '{"mailboxType":"SharedMailbox","delegatesAdded":1,"HTTP":200}',
  },
  {
    stepNumber: 5,
    title: 'OneDrive Data Hold & Delegation',
    description: 'Grants manager Secondary MySite Admin rights & enforces 10-year CIS retention hold.',
    graphEndpoint: 'POST /v1.0/users/{id}/drive/assignManagerAccess',
    status: 'passed',
    latencyMs: 410,
    timestamp: '14:10:07',
    responsePayload: '{"siteAdminAdded":true,"retentionPolicyId":"POL-CIS-10Y"}',
  },
  {
    stepNumber: 6,
    title: 'Reclaim Paid M365 Licenses',
    description: 'Removes M365 E5/E3 and Entra P2 paid SKUs to stop billing immediately.',
    graphEndpoint: 'POST /v1.0/users/{id}/assignLicenses',
    status: 'passed',
    latencyMs: 180,
    timestamp: '14:10:08',
    responsePayload: '{"addLicenses":[],"removeLicenses":["SPE_E5","AADP2"]}',
  },
  {
    stepNumber: 7,
    title: 'Strip Groups & Admin Roles',
    description: 'Removes target user from all Entra ID Security Groups, DLs, and Directory Roles.',
    graphEndpoint: 'DELETE /v1.0/users/{id}/memberOf/{groupId}',
    status: 'passed',
    latencyMs: 210,
    timestamp: '14:10:09',
    responsePayload: '{"groupsRemoved":12,"rolesRevoked":["Helpdesk Administrator"]}',
  },
];

// Initial Mock Offboarding Runs
const INITIAL_RUNS: OffboardingRun[] = [
  {
    id: 'run-101',
    runCode: 'OFF-2026-042',
    targetUserUpn: 'alex.b@contoso.com',
    targetUserName: 'Alex Bennett',
    targetUserAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    targetRole: 'Sr. Solutions Architect',
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    managerUpn: 'jane.smith@contoso.com',
    managerName: 'Jane Smith (VP)',
    pipelineType: 'standard_user',
    status: 'completed',
    startedAt: '2026-07-22 14:10',
    completedAt: '2026-07-22 14:11',
    reclaimedLicenseSku: 'M365 E5 (+Entra P2)',
    reclaimedMonthlyCost: 57.0,
    completedSteps: 7,
    totalSteps: 7,
    outOfOfficeMessage: 'I am no longer with Contoso Corp. Please direct all technical inquiries to Jane Smith (jane.smith@contoso.com).',
    steps: DEFAULT_7_STEPS,
  },
  {
    id: 'run-102',
    runCode: 'OFF-2026-043',
    targetUserUpn: 'david.v@fabrikam.io',
    targetUserName: 'David Vance',
    targetUserAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    targetRole: 'VP of Finance (High Risk)',
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    managerUpn: 'cfo@fabrikam.io',
    managerName: 'Robert Vance (CFO)',
    pipelineType: 'executive_user',
    status: 'in_progress',
    startedAt: '2026-07-24 08:15',
    completedAt: null,
    reclaimedLicenseSku: 'M365 E5 + Defender P2',
    reclaimedMonthlyCost: 68.0,
    completedSteps: 4,
    totalSteps: 7,
    outOfOfficeMessage: 'For finance queries, please contact accounting@fabrikam.io.',
    steps: [
      { ...DEFAULT_7_STEPS[0], timestamp: '08:15:01' },
      { ...DEFAULT_7_STEPS[1], timestamp: '08:15:02' },
      { ...DEFAULT_7_STEPS[2], timestamp: '08:15:03' },
      { ...DEFAULT_7_STEPS[3], timestamp: '08:15:05' },
      {
        stepNumber: 5,
        title: 'OneDrive Data Hold & Delegation',
        description: 'Enforcing legal hold and generating OneDrive transfer URL...',
        graphEndpoint: 'POST /v1.0/users/{id}/drive/assignManagerAccess',
        status: 'running',
        latencyMs: 820,
        timestamp: '08:15:08',
        responsePayload: '{"status":"IN_PROGRESS","step":"LEGAL_HOLD_APPLYING"}',
      },
      {
        stepNumber: 6,
        title: 'Reclaim Paid M365 Licenses',
        description: 'Pending completion of OneDrive transfer hold...',
        graphEndpoint: 'POST /v1.0/users/{id}/assignLicenses',
        status: 'pending',
      },
      {
        stepNumber: 7,
        title: 'Strip Groups & Admin Roles',
        description: 'Pending license reclamation...',
        graphEndpoint: 'DELETE /v1.0/users/{id}/memberOf/{groupId}',
        status: 'pending',
      },
    ],
  },
  {
    id: 'run-103',
    runCode: 'OFF-2026-044',
    targetUserUpn: 'clara.m@northwind.com',
    targetUserName: 'Clara Miller',
    targetUserAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    targetRole: 'Regional Sales Manager',
    tenantId: 't-northwind-03',
    tenantName: 'Northwind Traders',
    managerUpn: 'dir.sales@northwind.com',
    managerName: 'Mark Sterling',
    pipelineType: 'standard_user',
    status: 'pending_approval',
    startedAt: '2026-07-24 07:30',
    completedAt: null,
    reclaimedLicenseSku: 'M365 Business Premium',
    reclaimedMonthlyCost: 22.0,
    completedSteps: 2,
    totalSteps: 7,
    outOfOfficeMessage: 'I have left Northwind Traders. Please reach out to sales@northwind.com.',
    steps: [
      { ...DEFAULT_7_STEPS[0], timestamp: '07:30:01' },
      { ...DEFAULT_7_STEPS[1], timestamp: '07:30:02' },
      {
        stepNumber: 3,
        title: 'Wipe MFA Authentication Methods',
        description: 'Awaiting CISO approval for executive data wipe overrides...',
        graphEndpoint: 'DELETE /v1.0/users/{id}/authentication/methods',
        status: 'pending',
      },
      { ...DEFAULT_7_STEPS[3], status: 'pending', latencyMs: undefined, responsePayload: undefined },
      { ...DEFAULT_7_STEPS[4], status: 'pending', latencyMs: undefined, responsePayload: undefined },
      { ...DEFAULT_7_STEPS[5], status: 'pending', latencyMs: undefined, responsePayload: undefined },
      { ...DEFAULT_7_STEPS[6], status: 'pending', latencyMs: undefined, responsePayload: undefined },
    ],
  },
  {
    id: 'run-104',
    runCode: 'OFF-2026-045',
    targetUserUpn: 'samuel.k@litware.com',
    targetUserName: 'Samuel King',
    targetUserAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    targetRole: 'DevOps Lead',
    tenantId: 't-litware-04',
    tenantName: 'Litware Systems',
    managerUpn: 'cto@litware.com',
    managerName: 'Elena Rostova',
    pipelineType: 'standard_user',
    status: 'completed',
    startedAt: '2026-07-20 11:20',
    completedAt: '2026-07-20 11:21',
    reclaimedLicenseSku: 'M365 E3 + Github Ent',
    reclaimedMonthlyCost: 48.0,
    completedSteps: 7,
    totalSteps: 7,
    steps: DEFAULT_7_STEPS,
  },
  {
    id: 'run-105',
    runCode: 'OFF-2026-046',
    targetUserUpn: 'rachel.g@adventureworks.com',
    targetUserName: 'Rachel Green',
    targetUserAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    targetRole: 'Marketing Specialist',
    tenantId: 't-adv-05',
    tenantName: 'AdventureWorks',
    managerUpn: 'mkt.head@adventureworks.com',
    managerName: 'Greg House',
    pipelineType: 'standard_user',
    status: 'failed',
    startedAt: '2026-07-19 16:45',
    completedAt: null,
    reclaimedLicenseSku: 'M365 Business Standard',
    reclaimedMonthlyCost: 12.5,
    completedSteps: 3,
    totalSteps: 7,
    steps: [
      { ...DEFAULT_7_STEPS[0], timestamp: '16:45:01' },
      { ...DEFAULT_7_STEPS[1], timestamp: '16:45:02' },
      { ...DEFAULT_7_STEPS[2], timestamp: '16:45:03' },
      {
        stepNumber: 4,
        title: 'Mailbox Conversion & Delegation',
        description: 'Failed: Exchange Online API returned 409 Conflict (Mailbox currently locked by litigation hold).',
        graphEndpoint: 'POST /v1.0/users/{id}/mailFolders/convertAndDelegate',
        status: 'failed',
        latencyMs: 1450,
        timestamp: '16:45:05',
        responsePayload: '{"error":{"code":"ErrorMailboxHoldConflict","message":"LitigationHoldEnabled requires override flag."}}',
      },
      { ...DEFAULT_7_STEPS[4], status: 'pending' },
      { ...DEFAULT_7_STEPS[5], status: 'pending' },
      { ...DEFAULT_7_STEPS[6], status: 'pending' },
    ],
  },
  {
    id: 'run-106',
    runCode: 'OFF-2026-047',
    targetUserUpn: 'thomas.h@woodgrove.com',
    targetUserName: 'Thomas Hayes',
    targetUserAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    targetRole: 'Infrastructure Admin',
    tenantId: 't-woodgrove-06',
    tenantName: 'Woodgrove Bank',
    managerUpn: 'ciso@woodgrove.com',
    managerName: 'Victoria Chen',
    pipelineType: 'executive_user',
    status: 'completed',
    startedAt: '2026-07-18 09:00',
    completedAt: '2026-07-18 09:01',
    reclaimedLicenseSku: 'M365 E5 (+Entra Suite)',
    reclaimedMonthlyCost: 85.0,
    completedSteps: 7,
    totalSteps: 7,
    steps: DEFAULT_7_STEPS,
  },
];

// Mock Tenant Handover Records
const INITIAL_TENANT_HANDOVERS: TenantHandoverItem[] = [
  {
    id: 'handover-01',
    tenantName: 'Tailwind Traders',
    tenantId: 't-tailwind-88',
    primaryContactUpn: 'it.dir@tailwindtraders.com',
    gdapStatus: 'Revoked 🔴',
    effectiveDate: '2026-08-01',
    agentCount: 142,
    backupStatus: 'Exported 🟢',
    status: 'in_progress',
    steps: [
      { name: 'Export M365 Tenant Configuration (JSON/Terraform)', status: 'completed', time: '09:00 AM' },
      { name: 'Uninstall MSP Remote RMM & SOC Agents', status: 'completed', time: '09:15 AM' },
      { name: 'Revoke GDAP / DAP MSP Partner Access Relationships', status: 'in_progress', time: '09:30 AM' },
      { name: 'Generate Encrypted Master Admin Password Handoff', status: 'pending' },
      { name: 'Issue Offboarding Completion Compliance Certificate', status: 'pending' },
    ],
  },
  {
    id: 'handover-02',
    tenantName: 'Alpine Ski House',
    tenantId: 't-alpine-99',
    primaryContactUpn: 'admin@alpineskihouse.com',
    gdapStatus: 'Pending Handover',
    effectiveDate: '2026-08-15',
    agentCount: 45,
    backupStatus: 'Pending',
    status: 'scheduled',
    steps: [
      { name: 'Export M365 Tenant Configuration (JSON/Terraform)', status: 'pending' },
      { name: 'Uninstall MSP Remote RMM & SOC Agents', status: 'pending' },
      { name: 'Revoke GDAP / DAP MSP Partner Access Relationships', status: 'pending' },
      { name: 'Generate Encrypted Master Admin Password Handoff', status: 'pending' },
      { name: 'Issue Offboarding Completion Compliance Certificate', status: 'pending' },
    ],
  },
];

export const OffboardingConsole: React.FC<OffboardingConsoleProps> = ({
  tenants = [],
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [activeTab, setActiveTab] = useState<'user_pipelines' | 'tenant_handovers'>('user_pipelines');
  const [runs, setRuns] = useState<OffboardingRun[]>(INITIAL_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>('run-101');
  const [tenantHandovers, setTenantHandovers] = useState<TenantHandoverItem[]>(INITIAL_TENANT_HANDOVERS);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenantFilter, setSelectedTenantFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modals
  const [showUserWizard, setShowUserWizard] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);

  // User Offboarding Wizard Form State
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizardTenant, setWizardTenant] = useState('Contoso Corp');
  const [wizardTargetUpn, setWizardTargetUpn] = useState('');
  const [wizardTargetName, setWizardTargetName] = useState('');
  const [wizardTargetRole, setWizardTargetRole] = useState('');
  const [wizardManagerUpn, setWizardManagerUpn] = useState('');
  const [wizardPipelineType, setWizardPipelineType] = useState<OffboardingRun['pipelineType']>('standard_user');
  const [wizardOooText, setWizardOooText] = useState('I am no longer with the organization. Please direct all inquiries to my manager.');
  const [wizardReclaimLicense, setWizardReclaimLicense] = useState(true);
  const [wizardStripGroups, setWizardStripGroups] = useState(true);

  // Tenant Handover Form State
  const [handoverTenantName, setHandoverTenantName] = useState('');
  const [handoverContactUpn, setHandoverContactUpn] = useState('');
  const [handoverDate, setHandoverDate] = useState('2026-08-30');

  // Active Selected Run
  const activeRun = useMemo(() => {
    return runs.find((r) => r.id === selectedRunId) || runs[0];
  }, [runs, selectedRunId]);

  // Toast Helper
  const triggerToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const completedCount = runs.filter((r) => r.status === 'completed').length + 32; // Total this month
    const activeRunsCount = runs.filter((r) => r.status === 'in_progress' || r.status === 'pending_approval').length;
    const totalReclaimedMrr = runs
      .filter((r) => r.status === 'completed')
      .reduce((sum, r) => sum + r.reclaimedMonthlyCost, 0) + 980; // Total reclaimed MRR

    return {
      completedThisMonth: completedCount,
      avgVelocity: '45s Avg Execution',
      reclaimedMrr: `$${totalReclaimedMrr.toLocaleString()}`,
      activeRuns: activeRunsCount,
    };
  }, [runs]);

  // Filtered Runs List
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      const matchesSearch =
        run.runCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.targetUserUpn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.targetUserName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.managerUpn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.tenantName.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (selectedTenantFilter !== 'all' && run.tenantName !== selectedTenantFilter) return false;
      if (typeFilter !== 'all' && run.pipelineType !== typeFilter) return false;

      if (statusFilter === 'completed' && run.status !== 'completed') return false;
      if (statusFilter === 'in_progress' && run.status !== 'in_progress') return false;
      if (statusFilter === 'pending_approval' && run.status !== 'pending_approval') return false;
      if (statusFilter === 'failed' && run.status !== 'failed') return false;

      return true;
    });
  }, [runs, searchQuery, selectedTenantFilter, typeFilter, statusFilter]);

  // Handlers
  const handleExecuteAllRemainingSteps = () => {
    if (!activeRun) return;

    // Simulate pipeline progression
    const updatedSteps: OffboardingStep[] = activeRun.steps.map((step) => {
      if (step.status === 'pending' || step.status === 'running' || step.status === 'failed') {
        return {
          ...step,
          status: 'passed' as const,
          latencyMs: Math.floor(80 + Math.random() * 250),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          responsePayload: '{"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#status","HTTP":200,"status":"SUCCESS"}',
        };
      }
      return step;
    });

    setRuns((prev) =>
      prev.map((r) => {
        if (r.id === activeRun.id) {
          return {
            ...r,
            status: 'completed' as const,
            completedSteps: r.totalSteps,
            completedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
            steps: updatedSteps,
          };
        }
        return r;
      })
    );

    triggerToast('success', 'Pipeline Execution Complete', `All 7 Graph API offboarding steps passed for ${activeRun.targetUserUpn}.`);

    if (onExecuteWorkflow) {
      onExecuteWorkflow('execute_full_offboarding_pipeline', {
        runCode: activeRun.runCode,
        targetUserUpn: activeRun.targetUserUpn,
        tenantName: activeRun.tenantName,
      });
    }
  };

  const handleStepSingleAction = (stepNumber: number) => {
    if (!activeRun) return;

    setRuns((prev) =>
      prev.map((r) => {
        if (r.id === activeRun.id) {
          const newSteps = r.steps.map((s) => {
            if (s.stepNumber === stepNumber) {
              return {
                ...s,
                status: 'passed' as const,
                latencyMs: Math.floor(90 + Math.random() * 180),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                responsePayload: '{"status":"MANUAL_TRIGGER_SUCCESS","HTTP":200}',
              };
            }
            return s;
          });

          const passedCount = newSteps.filter((s) => s.status === 'passed').length;
          const isAllPassed = passedCount === r.totalSteps;

          return {
            ...r,
            completedSteps: passedCount,
            status: isAllPassed ? ('completed' as const) : ('in_progress' as const),
            completedAt: isAllPassed ? new Date().toISOString().replace('T', ' ').substring(0, 16) : r.completedAt,
            steps: newSteps,
          };
        }
        return r;
      })
    );

    triggerToast('info', `Step ${stepNumber} Executed`, `Graph API action executed for ${activeRun.steps[stepNumber - 1].title}.`);
  };

  const handleCreateUserOffboarding = () => {
    if (!wizardTargetUpn.trim()) return;

    const newCode = `OFF-2026-0${Math.floor(48 + Math.random() * 50)}`;
    const newRun: OffboardingRun = {
      id: `run-${Date.now()}`,
      runCode: newCode,
      targetUserUpn: wizardTargetUpn.trim(),
      targetUserName: wizardTargetName.trim() || wizardTargetUpn.split('@')[0],
      targetRole: wizardTargetRole || 'Standard User',
      tenantId: `t-${wizardTenant.toLowerCase().replace(/\s+/g, '')}`,
      tenantName: wizardTenant,
      managerUpn: wizardManagerUpn.trim() || `manager@${wizardTenant.toLowerCase().replace(/\s+/g, '')}.com`,
      managerName: wizardManagerUpn.split('@')[0] || 'Designated Manager',
      pipelineType: wizardPipelineType,
      status: 'in_progress',
      startedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      completedAt: null,
      reclaimedLicenseSku: wizardReclaimLicense ? 'M365 E5 (+Defender P2)' : 'None',
      reclaimedMonthlyCost: wizardReclaimLicense ? 57.0 : 0,
      completedSteps: 2,
      totalSteps: 7,
      outOfOfficeMessage: wizardOooText,
      steps: [
        { ...DEFAULT_7_STEPS[0], timestamp: new Date().toLocaleTimeString() },
        { ...DEFAULT_7_STEPS[1], timestamp: new Date().toLocaleTimeString() },
        { ...DEFAULT_7_STEPS[2], status: 'pending' },
        { ...DEFAULT_7_STEPS[3], status: 'pending' },
        { ...DEFAULT_7_STEPS[4], status: 'pending' },
        { ...DEFAULT_7_STEPS[5], status: 'pending' },
        { ...DEFAULT_7_STEPS[6], status: 'pending' },
      ],
    };

    setRuns([newRun, ...runs]);
    setSelectedRunId(newRun.id);
    setShowUserWizard(false);
    setWizardStep(1);
    setWizardTargetUpn('');
    setWizardTargetName('');

    triggerToast('success', 'Offboarding Pipeline Dispatched', `Run ${newCode} initiated for ${newRun.targetUserUpn}.`);
  };

  const handleCreateTenantHandover = () => {
    if (!handoverTenantName.trim()) return;

    const newHandover: TenantHandoverItem = {
      id: `handover-${Date.now()}`,
      tenantName: handoverTenantName.trim(),
      tenantId: `t-${handoverTenantName.toLowerCase().replace(/\s+/g, '')}`,
      primaryContactUpn: handoverContactUpn.trim() || `contact@${handoverTenantName.toLowerCase().replace(/\s+/g, '')}.com`,
      gdapStatus: 'Pending Handover',
      effectiveDate: handoverDate,
      agentCount: 50,
      backupStatus: 'Pending',
      status: 'scheduled',
      steps: [
        { name: 'Export M365 Tenant Configuration (JSON/Terraform)', status: 'pending' },
        { name: 'Uninstall MSP Remote RMM & SOC Agents', status: 'pending' },
        { name: 'Revoke GDAP / DAP MSP Partner Access Relationships', status: 'pending' },
        { name: 'Generate Encrypted Master Admin Password Handoff', status: 'pending' },
        { name: 'Issue Offboarding Completion Compliance Certificate', status: 'pending' },
      ],
    };

    setTenantHandovers([newHandover, ...tenantHandovers]);
    setShowTenantModal(false);
    setHandoverTenantName('');
    setHandoverContactUpn('');

    triggerToast('success', 'Tenant Handover Scheduled', `Initiated tenant deprovisioning protocol for ${newHandover.tenantName}.`);
  };

  const handleStepTenantHandover = (handoverId: string, stepIndex: number) => {
    setTenantHandovers((prev) =>
      prev.map((h) => {
        if (h.id === handoverId) {
          const newSteps = h.steps.map((s, idx) => {
            if (idx === stepIndex) {
              return {
                ...s,
                status: 'completed' as const,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              };
            }
            return s;
          });

          const completed = newSteps.filter((s) => s.status === 'completed').length;
          const isDone = completed === newSteps.length;

          return {
            ...h,
            status: isDone ? ('completed' as const) : ('in_progress' as const),
            gdapStatus: stepIndex >= 2 ? ('Revoked 🔴' as const) : h.gdapStatus,
            backupStatus: stepIndex >= 0 ? ('Exported 🟢' as const) : h.backupStatus,
            steps: newSteps,
          };
        }
        return h;
      })
    );

    triggerToast('info', 'Tenant Handover Step Passed', `Handover milestone updated.`);
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & OFFBOARDING TELEMETRY BAR */}
      <div className="bg-[#101419] border-b border-[#272f3d] px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-md">
        {/* Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
            <UserMinus className="w-5 h-5 text-amber-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">MSP User &amp; Tenant Offboarding Execution Engine</h1>
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Radio className="w-2.5 h-2.5 animate-ping text-amber-400" /> GRAPH API 7-STEP PROTOCOL
              </span>
            </div>
            <p className="text-[11px] text-[#8a919e] font-medium">
              Deterministic, Auditable Identity Lifecycle Deprovisioning &amp; GDAP Handover
            </p>
          </div>
        </div>

        {/* Offboarding Metrics KPI Summary Cards */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <UserCheck className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Offboarded This Month</div>
              <div className="text-xs font-bold text-white font-mono">{metrics.completedThisMonth} Users</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Execution Velocity</div>
              <div className="text-xs font-bold text-amber-400 font-mono">{metrics.avgVelocity}</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Award className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Reclaimed License MRR</div>
              <div className="text-xs font-bold text-emerald-400 font-mono">{metrics.reclaimedMrr} / mo</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Active Pipeline Runs</div>
              <div className="text-xs font-bold text-purple-300 font-mono">{metrics.activeRuns} Runs Active</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowUserWizard(true)}
            className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            + Initiate User Offboarding
          </button>

          <button
            onClick={() => setShowTenantModal(true)}
            className="bg-[#1f293d] hover:bg-[#2a3752] text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            Initiate Tenant Handover
          </button>

          <button
            onClick={() => {
              triggerToast('success', 'Master Audit Log Exported', 'Downloaded Offboarding_Audit_Log_Master_2026.csv with compliance signatures.');
            }}
            className="p-1.5 bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#8a919e] hover:text-white rounded-md transition-all"
            title="Export Master Audit Log CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      <div className="bg-[#0c1018] border-b border-[#272f3d] px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search Input */}
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search User UPN, Run Code (OFF-2026-042), Manager, or Tenant..."
            className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4] transition-colors"
          />
        </div>

        {/* Filter Selectors */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Tenant Selector */}
          <select
            value={selectedTenantFilter}
            onChange={(e) => setSelectedTenantFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All Tenants</option>
            <option value="Contoso Corp">Contoso Corp</option>
            <option value="Fabrikam Inc">Fabrikam Inc</option>
            <option value="Northwind Traders">Northwind Traders</option>
            <option value="Litware Systems">Litware Systems</option>
            <option value="AdventureWorks">AdventureWorks</option>
            <option value="Woodgrove Bank">Woodgrove Bank</option>
          </select>

          {/* Pipeline Type */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All Pipeline Types</option>
            <option value="standard_user">Standard User</option>
            <option value="executive_user">Executive / High-Risk</option>
            <option value="tenant_handover">Tenant Handover</option>
          </select>

          {/* Execution Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All Execution States</option>
            <option value="completed">Completed 🟢</option>
            <option value="in_progress">In Progress 🔵</option>
            <option value="pending_approval">Awaiting Sign-off 🟡</option>
            <option value="failed">Failed Step 🔴</option>
          </select>
        </div>

        {/* Sub-Tab Navigation Toggle */}
        <div className="flex items-center gap-1 bg-[#141a26] p-1 rounded-md border border-[#272f3d]">
          <button
            onClick={() => setActiveTab('user_pipelines')}
            className={cn(
              'px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all',
              activeTab === 'user_pipelines'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-white'
            )}
          >
            <UserMinus className="w-3.5 h-3.5" />
            User Offboarding Runs ({runs.length})
          </button>

          <button
            onClick={() => setActiveTab('tenant_handovers')}
            className={cn(
              'px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all',
              activeTab === 'tenant_handovers'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-white'
            )}
          >
            <Building2 className="w-3.5 h-3.5" />
            Tenant Handover Engine ({tenantHandovers.length})
          </button>
        </div>
      </div>

      {/* 3. MAIN CONTENT AREA */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'user_pipelines' ? (
          /* TAB 1: USER OFFBOARDING PIPELINE (SPLIT-PANE: 55% Directory | 45% Execution Runner) */
          <div className="flex h-full overflow-hidden">
            {/* LEFT PANE (55% Width): Directory Table */}
            <div className="w-[55%] min-w-[340px] border-r border-[#272f3d] bg-[#0c1018] flex flex-col h-full shrink-0">
              <div className="p-2.5 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between text-xs font-semibold text-[#a3c9ff]">
                <span>Master Offboarding Directory ({filteredRuns.length} Runs)</span>
                <span className="text-[10px] text-[#8a919e] font-mono">Sorted by Most Recent</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider sticky top-0 border-b border-[#272f3d] font-mono">
                    <tr>
                      <th className="py-2.5 px-3">Run &amp; Target User</th>
                      <th className="py-2.5 px-3">Tenant</th>
                      <th className="py-2.5 px-3">Manager Recipient</th>
                      <th className="py-2.5 px-3">Steps Progress</th>
                      <th className="py-2.5 px-3">Reclaimed SKU</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {filteredRuns.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                          No offboarding runs match current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredRuns.map((run) => {
                        const isSelected = run.id === activeRun.id;

                        return (
                          <tr
                            key={run.id}
                            onClick={() => setSelectedRunId(run.id)}
                            className={cn(
                              'cursor-pointer transition-all border-l-2',
                              isSelected
                                ? 'bg-[#161f2e] border-l-[#0078d4] text-white'
                                : 'border-l-transparent hover:bg-[#121722] text-[#c0c7d4]'
                            )}
                          >
                            {/* Run & User */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <img
                                  src={run.targetUserAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
                                  alt={run.targetUserName}
                                  className="w-7 h-7 rounded-full object-cover border border-[#374151] shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-xs text-white truncate flex items-center gap-1">
                                    <span>{run.targetUserName}</span>
                                    {run.pipelineType === 'executive_user' && (
                                      <span className="bg-red-500/20 text-red-300 border border-red-500/40 text-[9px] px-1 rounded font-mono">
                                        EXEC
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-[#8a919e] font-mono truncate">{run.runCode} • {run.targetUserUpn}</div>
                                </div>
                              </div>
                            </td>

                            {/* Tenant */}
                            <td className="py-2.5 px-3">
                              <span className="bg-[#181c22] border border-[#272f3d] text-[#a3c9ff] text-[10px] px-2 py-0.5 rounded font-mono">
                                {run.tenantName}
                              </span>
                            </td>

                            {/* Manager */}
                            <td className="py-2.5 px-3 text-[11px] text-[#8a919e]">
                              <div className="truncate max-w-[130px]" title={run.managerUpn}>
                                👤 {run.managerName || run.managerUpn.split('@')[0]}
                              </div>
                            </td>

                            {/* Progress */}
                            <td className="py-2.5 px-3">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span
                                    className={cn(
                                      'font-bold',
                                      run.status === 'completed'
                                        ? 'text-emerald-400'
                                        : run.status === 'failed'
                                        ? 'text-red-400'
                                        : 'text-amber-400'
                                    )}
                                  >
                                    {run.completedSteps}/{run.totalSteps} Passed
                                  </span>
                                  <span className="text-[#8a919e]">
                                    {Math.round((run.completedSteps / run.totalSteps) * 100)}%
                                  </span>
                                </div>
                                <div className="w-full bg-[#181c22] h-1.5 rounded-full overflow-hidden border border-[#272f3d]">
                                  <div
                                    className={cn(
                                      'h-full transition-all duration-300',
                                      run.status === 'completed'
                                        ? 'bg-emerald-400'
                                        : run.status === 'failed'
                                        ? 'bg-red-500'
                                        : 'bg-amber-400'
                                    )}
                                    style={{ width: `${(run.completedSteps / run.totalSteps) * 100}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Reclaimed SKU */}
                            <td className="py-2.5 px-3">
                              <div className="text-[10px] font-mono text-emerald-400 font-semibold truncate max-w-[120px]">
                                {run.reclaimedLicenseSku}
                              </div>
                              <div className="text-[9px] text-[#8a919e] font-mono">+${run.reclaimedMonthlyCost}/mo saved</div>
                            </td>

                            {/* Direct Actions */}
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRunId(run.id);
                                  }}
                                  className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-all"
                                  title="Inspect Pipeline Steps"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRunId(run.id);
                                    setShowCertModal(true);
                                  }}
                                  className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-emerald-600 text-emerald-400 hover:text-white rounded transition-all"
                                  title="Download Compliance Certificate PDF"
                                >
                                  <Award className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT PANE (45% Width): Interactive 7-Step Offboarding Execution Console */}
            <div className="flex-1 bg-[#090d16] flex flex-col h-full overflow-hidden">
              {/* Runner Header */}
              <div className="p-3 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <img
                    src={activeRun.targetUserAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
                    alt={activeRun.targetUserName}
                    className="w-10 h-10 rounded-full object-cover border border-[#374151]"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-white">{activeRun.targetUserName}</h2>
                      <span className="bg-[#181c22] border border-[#272f3d] text-[#a3c9ff] text-[10px] px-2 py-0.5 rounded font-mono">
                        {activeRun.tenantName}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                          activeRun.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : activeRun.status === 'failed'
                            ? 'bg-red-500/20 text-red-400 border-red-500/40'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        )}
                      >
                        {activeRun.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8a919e] font-mono flex items-center gap-2 mt-0.5">
                      <span>{activeRun.targetUserUpn}</span>
                      <span>•</span>
                      <span>Manager: {activeRun.managerUpn}</span>
                    </div>
                  </div>
                </div>

                {/* Runner Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExecuteAllRemainingSteps}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shadow transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Execute All Remaining Steps
                  </button>

                  <button
                    onClick={() => setShowCertModal(true)}
                    className="bg-[#1c2333] hover:bg-[#252f45] text-[#a3c9ff] border border-[#374151] px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    Audit Certificate
                  </button>
                </div>
              </div>

              {/* 7-Step Pipeline Visualizer */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#090d16]">
                <div className="flex items-center justify-between text-xs font-bold text-[#a3c9ff] pb-1 border-b border-[#272f3d]">
                  <span>7-Step Deterministic Graph API Pipeline Protocol</span>
                  <span className="font-mono text-[10px] text-[#8a919e]">
                    Started: {activeRun.startedAt}
                  </span>
                </div>

                {activeRun.steps.map((step) => {
                  return (
                    <div
                      key={step.stepNumber}
                      className={cn(
                        'p-3 rounded-lg border transition-all space-y-2',
                        step.status === 'passed'
                          ? 'bg-[#0f1813] border-emerald-500/30 text-white'
                          : step.status === 'failed'
                          ? 'bg-[#1f1012] border-red-500/40 text-white'
                          : step.status === 'running'
                          ? 'bg-[#1f1a10] border-amber-500/40 text-white animate-pulse'
                          : 'bg-[#101419] border-[#272f3d] text-[#8a919e]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <span
                            className={cn(
                              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono shrink-0 mt-0.5',
                              step.status === 'passed'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : step.status === 'failed'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                : step.status === 'running'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-[#181c22] text-[#8a919e] border border-[#272f3d]'
                            )}
                          >
                            {step.stepNumber}
                          </span>

                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-xs text-white">{step.title}</h3>
                              <span className="font-mono text-[10px] text-[#8a919e]">
                                {step.graphEndpoint}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#c0c7d4] mt-0.5">{step.description}</p>
                          </div>
                        </div>

                        {/* Status badge & Step Action */}
                        <div className="flex items-center gap-2 shrink-0">
                          {step.status === 'passed' && (
                            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Passed ({step.latencyMs}ms)
                            </span>
                          )}

                          {step.status === 'failed' && (
                            <button
                              onClick={() => handleStepSingleAction(step.stepNumber)}
                              className="text-[10px] font-mono text-red-300 bg-red-500/20 hover:bg-red-500/30 px-2 py-0.5 rounded border border-red-500/40 flex items-center gap-1 font-bold"
                            >
                              <XCircle className="w-3 h-3 text-red-400" /> Retry Step
                            </button>
                          )}

                          {step.status === 'running' && (
                            <span className="text-[10px] font-mono text-amber-300 flex items-center gap-1 font-bold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/40">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Executing...
                            </span>
                          )}

                          {step.status === 'pending' && (
                            <button
                              onClick={() => handleStepSingleAction(step.stepNumber)}
                              className="text-[10px] font-mono text-[#a3c9ff] bg-[#181c22] hover:bg-[#0078d4] hover:text-white px-2 py-0.5 rounded border border-[#272f3d] transition-all"
                            >
                              Run Single Step
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Payload / Terminal snippet */}
                      {step.responsePayload && (
                        <div className="bg-[#080b10] p-2 rounded text-[10px] font-mono text-[#a3c9ff] overflow-x-auto border border-[#1e2532]">
                          <span className="text-[#8a919e]">// Graph API Response ({step.timestamp}):</span>{' '}
                          {step.responsePayload}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Terminal Log Output Window */}
              <div className="p-3 bg-[#080b10] border-t border-[#272f3d] shrink-0 font-mono text-[10px] text-[#8a919e] space-y-1">
                <div className="flex items-center justify-between text-white font-bold text-xs pb-1 border-b border-[#1e2532]">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" /> Real-Time Graph API Stream Audit Log
                  </span>
                  <span className="text-[9px] text-[#8a919e]">CONNECTED TO ENTRA ID HOOK</span>
                </div>
                <div className="text-emerald-400">
                  [14:10:02] [DISPATCH] Initiating 7-step deterministic offboarding protocol for UPN: {activeRun.targetUserUpn}...
                </div>
                <div className="text-[#a3c9ff]">
                  [14:10:05] [MAILBOX] Exchange Online converted mailbox to Shared. Granted FullAccess to {activeRun.managerUpn}.
                </div>
                <div className="text-emerald-300">
                  [14:10:08] [LICENSE] Reclaimed paid SKU {activeRun.reclaimedLicenseSku}. Saved +${activeRun.reclaimedMonthlyCost}/mo.
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* TAB 2: TENANT OFFBOARDING & GDAP HANDOVER (Deprovisioning Engine) */
          <div className="p-6 overflow-y-auto h-full space-y-6 bg-[#090d16]">
            {/* Header Banner */}
            <div className="bg-[#101419] border border-[#272f3d] p-5 rounded-lg flex items-center justify-between gap-4 shadow-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-white">Full Customer Tenant Deprovisioning &amp; Handover Engine</h2>
                </div>
                <p className="text-xs text-[#8a919e] max-w-2xl">
                  Automate complete tenant exit protocols for departing clients: Revoke GDAP/DAP MSP relationships, uninstall SOC RMM monitoring agents, export configuration backups, and securely generate admin password handoff packages.
                </p>
              </div>

              <button
                onClick={() => setShowTenantModal(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-md text-xs font-bold flex items-center gap-2 shadow"
              >
                <Plus className="w-4 h-4" />
                Initiate New Tenant Handover
              </button>
            </div>

            {/* Tenant Handovers Directory */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {tenantHandovers.map((handover) => (
                <div key={handover.id} className="bg-[#101419] border border-[#272f3d] rounded-lg p-4 space-y-4 shadow-md">
                  <div className="flex items-start justify-between border-b border-[#272f3d] pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-white">{handover.tenantName}</h3>
                        <span className="bg-[#181c22] border border-[#272f3d] text-[#a3c9ff] text-[10px] px-2 py-0.5 rounded font-mono">
                          {handover.tenantId}
                        </span>
                      </div>
                      <p className="text-xs text-[#8a919e] mt-0.5">Contact: {handover.primaryContactUpn}</p>
                    </div>

                    <span
                      className={cn(
                        'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                        handover.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      )}
                    >
                      {handover.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Metadata Chips */}
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    <div className="bg-[#141a26] p-2 rounded border border-[#272f3d]">
                      <div className="text-[10px] text-[#8a919e]">GDAP Status</div>
                      <div className="font-bold text-red-400">{handover.gdapStatus}</div>
                    </div>

                    <div className="bg-[#141a26] p-2 rounded border border-[#272f3d]">
                      <div className="text-[10px] text-[#8a919e]">Config Backup</div>
                      <div className="font-bold text-emerald-400">{handover.backupStatus}</div>
                    </div>

                    <div className="bg-[#141a26] p-2 rounded border border-[#272f3d]">
                      <div className="text-[10px] text-[#8a919e]">RMM Agents</div>
                      <div className="font-bold text-amber-300">{handover.agentCount} Installed</div>
                    </div>
                  </div>

                  {/* Step Checklist */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-[#a3c9ff]">Deprovisioning Milestones</div>
                    {handover.steps.map((step, idx) => (
                      <div
                        key={idx}
                        className="bg-[#141a26] border border-[#272f3d] p-2 rounded flex items-center justify-between text-xs"
                      >
                        <span className="text-[#c0c7d4] font-medium">{step.name}</span>
                        {step.status === 'completed' ? (
                          <span className="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Passed ({step.time})
                          </span>
                        ) : (
                          <button
                            onClick={() => handleStepTenantHandover(handover.id, idx)}
                            className="text-[10px] font-mono bg-[#0078d4] text-white px-2 py-0.5 rounded hover:bg-[#0063b1]"
                          >
                            Mark Passed
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: USER OFFBOARDING WIZARD */}
      {showUserWizard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden space-y-4 p-6 text-white">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2">
                <UserMinus className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base text-white">Initiate Single User Offboarding Protocol</h3>
              </div>
              <button onClick={() => setShowUserWizard(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Wizard Indicator */}
            <div className="flex items-center justify-between text-xs font-mono text-[#8a919e] border-b border-[#272f3d] pb-2">
              <span className={cn(wizardStep === 1 && 'text-amber-400 font-bold')}>1. Target Selection</span>
              <span className={cn(wizardStep === 2 && 'text-amber-400 font-bold')}>2. Data Handover</span>
              <span className={cn(wizardStep === 3 && 'text-amber-400 font-bold')}>3. Licenses &amp; Groups</span>
              <span className={cn(wizardStep === 4 && 'text-amber-400 font-bold')}>4. Confirmation</span>
            </div>

            {/* WIZARD STEP 1: TARGET SELECTION */}
            {wizardStep === 1 && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">Target Tenant</label>
                  <select
                    value={wizardTenant}
                    onChange={(e) => setWizardTenant(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                  >
                    <option value="Contoso Corp">Contoso Corp</option>
                    <option value="Fabrikam Inc">Fabrikam Inc</option>
                    <option value="Northwind Traders">Northwind Traders</option>
                    <option value="Litware Systems">Litware Systems</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">Target User UPN *</label>
                  <input
                    type="text"
                    value={wizardTargetUpn}
                    onChange={(e) => setWizardTargetUpn(e.target.value)}
                    placeholder="e.g. john.doe@contoso.com"
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white focus:border-[#0078d4]"
                  />
                </div>

                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">User Display Name &amp; Role</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={wizardTargetName}
                      onChange={(e) => setWizardTargetName(e.target.value)}
                      placeholder="John Doe"
                      className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                    />
                    <input
                      type="text"
                      value={wizardTargetRole}
                      onChange={(e) => setWizardTargetRole(e.target.value)}
                      placeholder="Sr Engineer"
                      className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">Pipeline Protocol Tier</label>
                  <select
                    value={wizardPipelineType}
                    onChange={(e) => setWizardPipelineType(e.target.value as any)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                  >
                    <option value="standard_user">Standard User Offboarding</option>
                    <option value="executive_user">Executive / High-Risk (Requires CISO Audit)</option>
                  </select>
                </div>
              </div>
            )}

            {/* WIZARD STEP 2: DATA HANDOVER */}
            {wizardStep === 2 && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">Designated Manager / Recipient UPN</label>
                  <input
                    type="text"
                    value={wizardManagerUpn}
                    onChange={(e) => setWizardManagerUpn(e.target.value)}
                    placeholder="manager.jane@contoso.com"
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-[#8a919e] mb-1 font-semibold">Out-of-Office Auto-Responder Message</label>
                  <textarea
                    rows={3}
                    value={wizardOooText}
                    onChange={(e) => setWizardOooText(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white text-xs"
                  />
                </div>
              </div>
            )}

            {/* WIZARD STEP 3: LICENSES & GROUPS */}
            {wizardStep === 3 && (
              <div className="space-y-3 text-xs">
                <label className="flex items-center gap-2 p-2 bg-[#181c22] rounded border border-[#272f3d] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wizardReclaimLicense}
                    onChange={(e) => setWizardReclaimLicense(e.target.checked)}
                    className="rounded bg-[#0c1018]"
                  />
                  <div>
                    <div className="font-bold text-white">Reclaim Paid M365 &amp; Entra Licenses</div>
                    <div className="text-[10px] text-[#8a919e]">Removes paid SKUs to stop monthly subscription charges immediately.</div>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2 bg-[#181c22] rounded border border-[#272f3d] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wizardStripGroups}
                    onChange={(e) => setWizardStripGroups(e.target.checked)}
                    className="rounded bg-[#0c1018]"
                  />
                  <div>
                    <div className="font-bold text-white">Strip Security Groups &amp; Admin Roles</div>
                    <div className="text-[10px] text-[#8a919e]">Removes target user from all Entra ID directory role assignments.</div>
                  </div>
                </label>
              </div>
            )}

            {/* WIZARD STEP 4: CONFIRMATION */}
            {wizardStep === 4 && (
              <div className="space-y-3 text-xs bg-[#141a26] p-3 rounded border border-[#272f3d]">
                <div className="font-bold text-amber-300">Ready to Dispatch 7-Step Pipeline:</div>
                <ul className="list-disc pl-4 space-y-1 text-[#c0c7d4]">
                  <li>Target User: <strong className="text-white">{wizardTargetUpn}</strong></li>
                  <li>Tenant: <strong className="text-white">{wizardTenant}</strong></li>
                  <li>Manager Delegate: <strong className="text-white">{wizardManagerUpn || 'Default Manager'}</strong></li>
                  <li>Pipeline: <strong className="text-white">{wizardPipelineType.toUpperCase()}</strong></li>
                </ul>
              </div>
            )}

            {/* Wizard Navigation */}
            <div className="flex items-center justify-between pt-3 border-t border-[#272f3d]">
              {wizardStep > 1 ? (
                <button
                  onClick={() => setWizardStep((s) => (s - 1) as any)}
                  className="bg-[#181c22] hover:bg-[#222832] text-white px-3 py-1.5 rounded text-xs"
                >
                  Back
                </button>
              ) : (
                <div />
              )}

              {wizardStep < 4 ? (
                <button
                  onClick={() => setWizardStep((s) => (s + 1) as any)}
                  className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-4 py-1.5 rounded text-xs font-bold"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleCreateUserOffboarding}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1 shadow"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Execute Deterministic Offboarding
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TENANT HANDOVER WIZARD */}
      {showTenantModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl w-full max-w-md shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-400" /> Initiate Tenant Handover Protocol
              </h3>
              <button onClick={() => setShowTenantModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8a919e] mb-1 font-semibold">Tenant Name *</label>
                <input
                  type="text"
                  value={handoverTenantName}
                  onChange={(e) => setHandoverTenantName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-[#8a919e] mb-1 font-semibold">Client Handoff Contact UPN</label>
                <input
                  type="text"
                  value={handoverContactUpn}
                  onChange={(e) => setHandoverContactUpn(e.target.value)}
                  placeholder="contact@acme.com"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-[#8a919e] mb-1 font-semibold">Effective Exit Date</label>
                <input
                  type="date"
                  value={handoverDate}
                  onChange={(e) => setHandoverDate(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#272f3d]">
              <button
                onClick={() => setShowTenantModal(false)}
                className="bg-[#181c22] text-[#8a919e] px-3 py-1.5 rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTenantHandover}
                className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded text-xs font-bold"
              >
                Schedule Handover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: AUDIT COMPLIANCE CERTIFICATE PDF PREVIEW */}
      {showCertModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl w-full max-w-2xl shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base text-white">Cryptographically Signed Offboarding Audit Certificate</h3>
              </div>
              <button onClick={() => setShowCertModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#080b10] border border-[#272f3d] p-5 rounded-lg font-mono text-xs text-[#c0c7d4] space-y-3 shadow-inner">
              <div className="flex justify-between items-start border-b border-[#1e2532] pb-3">
                <div>
                  <div className="text-amber-300 font-bold text-sm">MSP GLOBAL IDENTITY GOVERNANCE</div>
                  <div className="text-[#8a919e] text-[10px]">ISO 27001 / NIST SP 800-53 REV 5 COMPLIANT</div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 font-bold">CERTIFICATE ID: {activeRun.runCode}-CERT</div>
                  <div className="text-[10px] text-[#8a919e]">ISSUED: {activeRun.completedAt || activeRun.startedAt}</div>
                </div>
              </div>

              <div className="space-y-1 text-[11px]">
                <div><span className="text-[#8a919e]">TARGET USER:</span> <strong className="text-white">{activeRun.targetUserName} ({activeRun.targetUserUpn})</strong></div>
                <div><span className="text-[#8a919e]">CUSTOMER TENANT:</span> <strong className="text-white">{activeRun.tenantName} ({activeRun.tenantId})</strong></div>
                <div><span className="text-[#8a919e]">DELEGATED MANAGER:</span> <strong className="text-white">{activeRun.managerUpn}</strong></div>
                <div><span className="text-[#8a919e]">GRAPH API STEPS PASSED:</span> <strong className="text-emerald-400">{activeRun.completedSteps} / {activeRun.totalSteps} (100% VERIFIED)</strong></div>
              </div>

              <div className="bg-[#101419] p-3 rounded text-[10px] border border-[#1e2532] space-y-1">
                <div className="text-[#8a919e] font-bold">CRYPTOGRAPHIC SHA-256 PROOF HASH:</div>
                <div className="text-emerald-300 break-all">
                  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855f
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-[#8a919e] font-mono">
                Verified by Graph API Audit Hook • Signed by Shane McCaw (Global Admin)
              </span>
              <button
                onClick={() => {
                  triggerToast('success', 'PDF Downloaded', `Saved ${activeRun.runCode}_Audit_Certificate.pdf`);
                  setShowCertModal(false);
                }}
                className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download PDF Certificate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
