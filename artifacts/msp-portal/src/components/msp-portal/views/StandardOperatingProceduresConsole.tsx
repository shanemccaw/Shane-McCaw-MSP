import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  FileText,
  Code2,
  Terminal,
  Zap,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  Layers,
  GitBranch,
  UserCheck,
  Download,
  Sparkles,
  ChevronRight,
  Plus,
  X,
  Building2,
  UserX,
  ShieldCheck,
  Check,
  Trash2,
  ArrowRight,
  AlertTriangle,
  RotateCcw,
  CheckSquare,
  Copy,
  ExternalLink,
  Lock,
  Pause,
  StopCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

export interface SopStep {
  stepNumber: number;
  title: string;
  description: string;
  type: 'manual' | 'automated';
  actionId?: string;
  graphEndpoint?: string;
  payloadTemplate?: string;
  status?: 'pending' | 'running' | 'success' | 'failed';
  executedAt?: string;
  verifiedBy?: string;
}

export interface StandardOperatingProcedure {
  id: string; // e.g., 'SOP-SEC-004'
  code: string;
  title: string;
  description: string;
  category:
    | 'User Offboarding / Onboarding'
    | 'Incident Response'
    | 'Security Drift Remediation'
    | 'Exchange / Mail Flow'
    | 'Device Management';
  version: string;
  automationType: 'automated' | 'hybrid' | 'manual';
  estimatedMinutes: number;
  complianceTags: string[];
  workloadTags: string[];
  steps: SopStep[];
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  versionStatus: 'Published / Active' | 'Draft / Under Review' | 'Archived';
}

export interface SopExecutionRun {
  runId: string; // e.g., 'RUN-2026-8819'
  sopId: string;
  sopTitle: string;
  tenantId: string;
  tenantName: string;
  targetEntity: string; // e.g. UPN or Device ID
  operator: string;
  startedAt: string;
  completedAt?: string;
  status: 'In Progress' | 'Completed' | 'Blocked' | 'Failed';
  currentStepIndex: number;
  totalSteps: number;
  passedStepsCount: number;
  psaTicketId: string;
  logs: string[];
}

interface StandardOperatingProceduresConsoleProps {
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

// 6+ Realistic M365 Standard Operating Procedures
const INITIAL_SOPS: StandardOperatingProcedure[] = [
  {
    id: 'SOP-SEC-004',
    code: 'SOP-OFFBOARD-01',
    title: 'Emergency Compromised User Lockdown & Triage',
    description: 'Immediate multi-stage containment runbook for compromised M365 user accounts. Invalidates sessions, wipes MFA, revokes refresh tokens, and secures mailbox.',
    category: 'Incident Response',
    version: 'v2.2',
    automationType: 'hybrid',
    estimatedMinutes: 3,
    complianceTags: ['CIS M365 1.1', 'NIST IA-2', 'CMMC Level 2'],
    workloadTags: ['Entra ID', 'Exchange', 'Defender'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'Arch. Shane McCaw',
    lastUpdatedAt: '2026-07-20',
    steps: [
      {
        stepNumber: 1,
        title: 'Revoke All Active Sign-In Sessions & Refresh Tokens',
        description: 'Dispatches Graph API POST request to invalidate OAuth refresh tokens across all active sessions and connected devices.',
        type: 'automated',
        actionId: 'revoke-user-sessions',
        graphEndpoint: 'POST /v1.0/users/{upn}/revokeSignInSessions',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Reset & Wipe Enrolled MFA Authentication Methods',
        description: 'Purges registered FIDO2 keys, Authenticator push bindings, and SMS phone numbers to prevent re-entry.',
        type: 'automated',
        actionId: 'reset-mfa-methods',
        graphEndpoint: 'DELETE /v1.0/users/{upn}/authentication/methods',
        payloadTemplate: '{ "resetAll": true }',
        status: 'pending',
      },
      {
        stepNumber: 3,
        title: 'Verify User Identity via Callback / Video (Manual Tech Check)',
        description: 'Technician must perform mandatory out-of-band identity verification via phone or manager approval callback.',
        type: 'manual',
        status: 'pending',
      },
      {
        stepNumber: 4,
        title: 'Convert Mailbox to Shared & Forward to Direct Manager',
        description: 'Converts target user mailbox to SharedMailbox type and configures automatic forwarding with copy retention.',
        type: 'automated',
        actionId: 'convert-mailbox-shared',
        graphEndpoint: 'POST /v1.0/admin/exchange/mailboxes/{upn}/convertType',
        payloadTemplate: '{ "mailboxType": "Shared", "forwardTo": "{managerUpn}" }',
        status: 'pending',
      },
      {
        stepNumber: 5,
        title: 'Log Incident Reference Ticket in PSA (HaloPSA / ConnectWise)',
        description: 'Document containment timestamps, verified user contact, and triage outcome in ticket.',
        type: 'manual',
        status: 'pending',
      },
    ],
  },
  {
    id: 'SOP-OFFB-002',
    code: 'SOP-USER-OFFB',
    title: 'Standard M365 Employee Offboarding Workflow',
    description: 'Comprehensive 6-step offboarding checklist and automation pipeline for terminating user access safely.',
    category: 'User Offboarding / Onboarding',
    version: 'v3.1',
    automationType: 'hybrid',
    estimatedMinutes: 5,
    complianceTags: ['CIS M365 2.4', 'HIPAA 164.308', 'NIST AC-2'],
    workloadTags: ['Entra ID', 'Exchange', 'Intune', 'OneDrive'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'Lead Tech Alex Vance',
    lastUpdatedAt: '2026-07-22',
    steps: [
      {
        stepNumber: 1,
        title: 'Disable User Account & Set BlockSignIn Flag',
        description: 'Executes PATCH /v1.0/users/{upn} to set accountEnabled: false.',
        type: 'automated',
        actionId: 'disable-entra-user',
        graphEndpoint: 'PATCH /v1.0/users/{upn}',
        payloadTemplate: '{ "accountEnabled": false }',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Remove User from All Dynamic & Static Security Groups',
        description: 'Strips licenses and group memberships to prevent unauthorized resource access.',
        type: 'automated',
        actionId: 'strip-user-groups',
        graphEndpoint: 'POST /v1.0/users/{upn}/memberOf/remove',
        payloadTemplate: '{ "removeAllGroups": true }',
        status: 'pending',
      },
      {
        stepNumber: 3,
        title: 'Initiate Intune Corporate Device Remote Wipe (If Applicable)',
        description: 'Issues selective or full remote wipe command to Intune registered laptops and mobile devices.',
        type: 'automated',
        actionId: 'intune-device-wipe',
        graphEndpoint: 'POST /v1.0/deviceManagement/managedDevices/{deviceId}/wipe',
        payloadTemplate: '{ "keepEnrollmentData": false }',
        status: 'pending',
      },
      {
        stepNumber: 4,
        title: 'Verify Physical Hardware Return with Client HR (Manual Checklist)',
        description: 'Confirm laptop, security badge, and mobile keys have been logged in hardware inventory system.',
        type: 'manual',
        status: 'pending',
      },
      {
        stepNumber: 5,
        title: 'Delegate OneDrive & Email Access to Manager',
        description: 'Grants 30-day delegate permissions to manager for business continuity review.',
        type: 'automated',
        actionId: 'grant-onedrive-delegate',
        graphEndpoint: 'POST /v1.0/users/{upn}/onedrive/permissions',
        payloadTemplate: '{ "delegateUpn": "{managerUpn}", "role": "read" }',
        status: 'pending',
      },
    ],
  },
  {
    id: 'SOP-DRIFT-001',
    code: 'SOP-CA-BASELINE',
    title: 'Conditional Access Security Drift Alignment & Audit',
    description: 'Enforces MSP baseline Conditional Access policies (MFA, Block Legacy Auth, Geo-Fencing) across client tenants.',
    category: 'Security Drift Remediation',
    version: 'v1.4',
    automationType: 'automated',
    estimatedMinutes: 2,
    complianceTags: ['CIS M365 Baseline 5.2', 'NIST IA-5'],
    workloadTags: ['Entra ID', 'ConditionalAccess'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'Arch. Shane McCaw',
    lastUpdatedAt: '2026-07-18',
    steps: [
      {
        stepNumber: 1,
        title: 'Scan Tenant Conditional Access Policies for Drift',
        description: 'Queries Graph API endpoint to compare current policy set against MSP standard template JSON.',
        type: 'automated',
        actionId: 'scan-ca-drift',
        graphEndpoint: 'GET /v1.0/identity/conditionalAccess/policies',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Deploy / Update Mandatory Block Legacy Authentication Policy',
        description: 'Pushes Graph API payload to enforce blocking of Exchange ActiveSync and Basic Auth clients.',
        type: 'automated',
        actionId: 'deploy-legacy-auth-block',
        graphEndpoint: 'POST /v1.0/identity/conditionalAccess/policies',
        payloadTemplate: '{ "displayName": "MSP-Block-Legacy-Auth", "state": "enabled" }',
        status: 'pending',
      },
      {
        stepNumber: 3,
        title: 'Enforce Require Compliant Device or MFA for Cloud Apps',
        description: 'Activates device posture validation requirement for executive and finance cloud applications.',
        type: 'automated',
        actionId: 'deploy-mfa-grant-control',
        graphEndpoint: 'POST /v1.0/identity/conditionalAccess/policies/mfa-grant',
        payloadTemplate: '{ "grantControls": { "builtInControls": ["mfa", "compliantDevice"] } }',
        status: 'pending',
      },
    ],
  },
  {
    id: 'SOP-GUEST-009',
    code: 'SOP-GUEST-CLEAN',
    title: 'Stale External Guest Account Purge & Access Review',
    description: 'Identifies and removes external guest user objects with no interactive sign-ins within the last 90 days.',
    category: 'Security Drift Remediation',
    version: 'v1.1',
    automationType: 'automated',
    estimatedMinutes: 4,
    complianceTags: ['CIS M365 1.3', 'CMMC Level 2'],
    workloadTags: ['Entra ID', 'Guest Access'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'SecOps Tech M. Chen',
    lastUpdatedAt: '2026-07-15',
    steps: [
      {
        stepNumber: 1,
        title: 'Query Entra ID for Inactive Guest Users (>90 Days)',
        description: 'Fetches guest users where signInActivity.lastSignInDateTime < 90 days ago.',
        type: 'automated',
        actionId: 'query-inactive-guests',
        graphEndpoint: 'GET /v1.0/users?$filter=userType eq \'Guest\'',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Soft-Delete Inactive Guest User Objects',
        description: 'Executes DELETE /v1.0/users/{guestId} for confirmed stale guest accounts.',
        type: 'automated',
        actionId: 'purge-guest-users',
        graphEndpoint: 'DELETE /v1.0/users/{guestId}',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 3,
        title: 'Revoke Unused External SharePoint Site Invitations',
        description: 'Cleans up pending guest sharing links across team sites.',
        type: 'automated',
        actionId: 'revoke-sharepoint-invites',
        graphEndpoint: 'DELETE /v1.0/sites/sharingLinks',
        payloadTemplate: '{}',
        status: 'pending',
      },
    ],
  },
  {
    id: 'SOP-EXCH-003',
    code: 'SOP-MAIL-TRANSPORT',
    title: 'Anti-Phishing Transport Rule & External Email Banner Setup',
    description: 'Deploys HTML warning banners to all incoming external messages and enforces strict DKIM/DMARC checks.',
    category: 'Exchange / Mail Flow',
    version: 'v2.0',
    automationType: 'automated',
    estimatedMinutes: 3,
    complianceTags: ['NIST SI-8', 'CIS M365 3.1'],
    workloadTags: ['Exchange Online', 'Defender for O365'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'Arch. Shane McCaw',
    lastUpdatedAt: '2026-07-10',
    steps: [
      {
        stepNumber: 1,
        title: 'Verify External Email Warning Transport Rule State',
        description: 'Checks Exchange PowerShell / Graph endpoint for [External Email] prepend rule.',
        type: 'automated',
        actionId: 'verify-transport-rule',
        graphEndpoint: 'GET /v1.0/admin/exchange/transportRules',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Deploy HTML External Warning Banner Rule',
        description: 'Injects high-visibility amber warning box at top of incoming external email bodies.',
        type: 'automated',
        actionId: 'deploy-banner-rule',
        graphEndpoint: 'POST /v1.0/admin/exchange/transportRules/externalBanner',
        payloadTemplate: '{ "ApplyHtmlDisclaimerText": "<div style=\"background:#fff3cd;padding:8px;\">CAUTION: External Email</div>" }',
        status: 'pending',
      },
    ],
  },
  {
    id: 'SOP-INT-007',
    code: 'SOP-[#INTUNE-RETIRE]',
    title: 'Stale Intune Managed Device Retirement & BitLocker Escrow',
    description: 'Escrows BitLocker recovery keys to Azure Key Vault before wiping or retiring inactive endpoints.',
    category: 'Device Management',
    version: 'v1.0',
    automationType: 'hybrid',
    estimatedMinutes: 6,
    complianceTags: ['NIST CM-8', 'HIPAA 164.312'],
    workloadTags: ['Intune', 'BitLocker', 'Entra ID'],
    versionStatus: 'Published / Active',
    lastUpdatedBy: 'Lead Tech Alex Vance',
    lastUpdatedAt: '2026-07-12',
    steps: [
      {
        stepNumber: 1,
        title: 'Escrow BitLocker & FileVault Recovery Keys to Secure Vault',
        description: 'Extracts recovery keys via Graph API and backs them up to central MSP Key Vault.',
        type: 'automated',
        actionId: 'escrow-bitlocker-keys',
        graphEndpoint: 'GET /v1.0/informationProtection/bitlocker/recoveryKeys',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 2,
        title: 'Perform Intune Retire / Wipe Action on Target Endpoint',
        description: 'Triggers corporate data wipe on target device GUID.',
        type: 'automated',
        actionId: 'intune-retire-device',
        graphEndpoint: 'POST /v1.0/deviceManagement/managedDevices/{deviceId}/retire',
        payloadTemplate: '{}',
        status: 'pending',
      },
      {
        stepNumber: 3,
        title: 'Physical Asset Tag Audit Sign-off (Manual Checklist)',
        description: 'Confirm device serial number matches asset decommissioning record.',
        type: 'manual',
        status: 'pending',
      },
    ],
  },
];

// Mock Active Runs for Tab 2
const INITIAL_ACTIVE_RUNS: SopExecutionRun[] = [
  {
    runId: 'RUN-2026-8819',
    sopId: 'SOP-SEC-004',
    sopTitle: 'Emergency Compromised User Lockdown & Triage',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    targetEntity: 'UPN: marcus.vance@contoso.com',
    operator: 'alex.vance@mspplatform.com',
    startedAt: '2026-07-23 22:50 UTC',
    status: 'In Progress',
    currentStepIndex: 2,
    totalSteps: 5,
    passedStepsCount: 2,
    psaTicketId: 'HaloPSA #TK-99102',
    logs: [
      '[22:50:01] RUN STARTED by alex.vance@mspplatform.com on tenant Contoso Corporation',
      '[22:50:02] Step 1 Executing: Revoke All Active Sign-In Sessions',
      '[22:50:03] Graph API POST /v1.0/users/marcus.vance@contoso.com/revokeSignInSessions HTTP 200 OK (120ms)',
      '[22:50:04] Step 1 SUCCESS 🟢 - All refresh tokens invalidated',
      '[22:50:05] Step 2 Executing: Reset & Wipe Enrolled MFA Authentication Methods',
      '[22:50:07] Graph API DELETE /v1.0/users/marcus.vance@contoso.com/authentication/methods HTTP 204 No Content (180ms)',
      '[22:50:08] Step 2 SUCCESS 🟢 - FIDO2 & Push authenticator bindings removed',
      '[22:50:09] Step 3 Awaiting Technician Identity Callback Verification...',
    ],
  },
  {
    runId: 'RUN-2026-8812',
    sopId: 'SOP-OFFB-002',
    sopTitle: 'Standard M365 Employee Offboarding Workflow',
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    targetEntity: 'UPN: sarah.jenkins@woodgrovebank.com',
    operator: 'mchen@mspplatform.com',
    startedAt: '2026-07-23 22:15 UTC',
    status: 'Blocked',
    currentStepIndex: 3,
    totalSteps: 5,
    passedStepsCount: 3,
    psaTicketId: 'ConnectWise #CW-88120',
    logs: [
      '[22:15:00] RUN STARTED by mchen@mspplatform.com',
      '[22:15:02] Step 1 SUCCESS: Account Disabled',
      '[22:15:05] Step 2 SUCCESS: Groups Stripped',
      '[22:15:10] Step 3 SUCCESS: Intune Device Selective Wipe Sent',
      '[22:15:12] Step 4 BLOCKED: Awaiting HR Hardware Return Sign-off',
    ],
  },
];

// Mock Audit Logs for Tab 3
const INITIAL_AUDIT_LOGS: SopExecutionRun[] = [
  {
    runId: 'RUN-2026-8790',
    sopId: 'SOP-DRIFT-001',
    sopTitle: 'Conditional Access Security Drift Alignment & Audit',
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    targetEntity: 'Tenant Global Baseline',
    operator: 'SYSTEM_AUTOPILOT',
    startedAt: '2026-07-22 14:00 UTC',
    completedAt: '2026-07-22 14:02 UTC',
    status: 'Completed',
    currentStepIndex: 3,
    totalSteps: 3,
    passedStepsCount: 3,
    psaTicketId: 'HaloPSA #TK-88102',
    logs: [
      '[14:00:00] Autopilot Drift Scan triggered for Fabrikam Inc',
      '[14:00:15] Legacy Auth Block Policy pushed to Graph API',
      '[14:01:00] MFA Grant Controls enforced for Executive Group',
      '[14:02:00] Run Completed Successfully 🟢 (3/3 Steps Passed)',
    ],
  },
  {
    runId: 'RUN-2026-8750',
    sopId: 'SOP-GUEST-009',
    sopTitle: 'Stale External Guest Account Purge & Access Review',
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    targetEntity: '14 Stale Guest Accounts',
    operator: 'alex.vance@mspplatform.com',
    startedAt: '2026-07-21 09:30 UTC',
    completedAt: '2026-07-21 09:34 UTC',
    status: 'Completed',
    currentStepIndex: 3,
    totalSteps: 3,
    passedStepsCount: 3,
    psaTicketId: 'ConnectWise #CW-77210',
    logs: [
      '[09:30:00] Scanned 14 stale guest accounts in Northwind Traders',
      '[09:32:00] Executed soft-delete for 14 guest objects',
      '[09:34:00] Purged 8 orphaned SharePoint sharing links',
    ],
  },
];

export const StandardOperatingProceduresConsole: React.FC<
  StandardOperatingProceduresConsoleProps
> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [sops, setSops] = useState<StandardOperatingProcedure[]>(INITIAL_SOPS);
  const [activeRuns, setActiveRuns] = useState<SopExecutionRun[]>(INITIAL_ACTIVE_RUNS);
  const [auditLogs, setAuditLogs] = useState<SopExecutionRun[]>(INITIAL_AUDIT_LOGS);

  const [selectedSopId, setSelectedSopId] = useState<string>('SOP-SEC-004');
  const [activeTab, setActiveTab] = useState<'library' | 'queue' | 'audit'>('library');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [automationFilter, setAutomationFilter] = useState('All');
  const [complianceFilter, setComplianceFilter] = useState('All');

  // Interactive Runner State (Right Pane)
  const [runnerTenantId, setRunnerTenantId] = useState<string>('contoso-01');
  const [runnerTargetEntity, setRunnerTargetEntity] = useState<string>('alex.b@contoso.com');
  const [currentStepStatuses, setCurrentStepStatuses] = useState<Record<number, 'pending' | 'running' | 'success' | 'failed'>>({});
  const [manualCheckboxes, setManualCheckboxes] = useState<Record<number, boolean>>({});
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] SOP Runner Engine Ready.',
    '[INFO] Select target tenant and user UPN to execute runbook steps.',
  ]);
  const [isExecutingAll, setIsExecutingAll] = useState(false);

  // Wizard Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // New SOP Form State
  const [newSopTitle, setNewSopTitle] = useState('');
  const [newSopCode, setNewSopCode] = useState('SOP-CUSTOM-01');
  const [newSopCategory, setNewSopCategory] = useState<StandardOperatingProcedure['category']>('Incident Response');
  const [newSopAutomationType, setNewSopAutomationType] = useState<'automated' | 'hybrid' | 'manual'>('hybrid');
  const [newSopCompliance, setNewSopCompliance] = useState('CIS M365 1.1, NIST IA-2');
  const [newSopDescription, setNewSopDescription] = useState('');
  const [newSopSteps, setNewSopSteps] = useState<SopStep[]>([
    {
      stepNumber: 1,
      title: 'Revoke User Sessions & Refresh Tokens',
      description: 'Executes Graph API POST to revoke sign-in sessions.',
      type: 'automated',
      graphEndpoint: 'POST /v1.0/users/{upn}/revokeSignInSessions',
      status: 'pending',
    },
    {
      stepNumber: 2,
      title: 'Verify Identity with HR Contact',
      description: 'Manual verification callback by technician.',
      type: 'manual',
      status: 'pending',
    },
  ]);

  // Selected SOP
  const selectedSop = useMemo(() => {
    return sops.find((s) => s.id === selectedSopId) || sops[0];
  }, [sops, selectedSopId]);

  // Metrics
  const metrics = useMemo(() => {
    const totalSops = sops.length;
    const automatedCount = sops.filter((s) => s.automationType === 'automated' || s.automationType === 'hybrid').length;
    const autoRatio = Math.round((automatedCount / totalSops) * 100);
    const avgMins = Math.round(
      sops.reduce((acc, s) => acc + s.estimatedMinutes, 0) / totalSops
    );

    return {
      totalSops,
      autoRatio,
      avgMins,
      monthlyExecutions: 142,
    };
  }, [sops]);

  // Filtered SOPs
  const filteredSops = useMemo(() => {
    return sops.filter((sop) => {
      if (categoryFilter !== 'All' && sop.category !== categoryFilter) return false;
      if (automationFilter !== 'All' && sop.automationType !== automationFilter.toLowerCase()) return false;
      if (complianceFilter !== 'All' && !sop.complianceTags.some((c) => c.includes(complianceFilter))) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          sop.title.toLowerCase().includes(q) ||
          sop.code.toLowerCase().includes(q) ||
          sop.id.toLowerCase().includes(q) ||
          sop.workloadTags.some((w) => w.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [sops, categoryFilter, automationFilter, complianceFilter, searchQuery]);

  // Runner Actions
  const handleExecuteSingleStep = (step: SopStep) => {
    setCurrentStepStatuses((prev) => ({ ...prev, [step.stepNumber]: 'running' }));

    const logEntry = `[${new Date().toLocaleTimeString()}] Executing Step ${step.stepNumber}: ${step.title}...`;
    setTerminalLogs((prev) => [...prev, logEntry]);

    setTimeout(() => {
      setCurrentStepStatuses((prev) => ({ ...prev, [step.stepNumber]: 'success' }));
      const successLog = `[${new Date().toLocaleTimeString()}] Graph API ${step.graphEndpoint || 'Action'} HTTP 200 OK (145ms) - Step ${step.stepNumber} PASSED 🟢`;
      setTerminalLogs((prev) => [...prev, successLog]);

      onExecuteWorkflow?.('execute-sop-step', {
        sopId: selectedSop.id,
        stepNumber: step.stepNumber,
        tenantId: runnerTenantId,
        targetEntity: runnerTargetEntity,
      });

      onShowToast?.(
        'success',
        `Step ${step.stepNumber} Passed`,
        `Successfully executed ${step.title} on target ${runnerTargetEntity}.`
      );
    }, 800);
  };

  const handleToggleManualStep = (stepNumber: number) => {
    const nextVal = !manualCheckboxes[stepNumber];
    setManualCheckboxes((prev) => ({ ...prev, [stepNumber]: nextVal }));

    if (nextVal) {
      setCurrentStepStatuses((prev) => ({ ...prev, [stepNumber]: 'success' }));
      setTerminalLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Step ${stepNumber} Manual Checkmark Verified by Tech 🟢`,
      ]);
    } else {
      setCurrentStepStatuses((prev) => ({ ...prev, [stepNumber]: 'pending' }));
    }
  };

  const handleExecuteAllSteps = () => {
    setIsExecutingAll(true);
    setTerminalLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] INIT FULL AUTOMATED PIPELINE for ${selectedSop.code} on Tenant: ${runnerTenantId}...`,
    ]);

    let delay = 0;
    selectedSop.steps.forEach((step) => {
      setTimeout(() => {
        setCurrentStepStatuses((prev) => ({ ...prev, [step.stepNumber]: 'running' }));
        setTerminalLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] Step ${step.stepNumber} Running: ${step.title}...`,
        ]);

        setTimeout(() => {
          setCurrentStepStatuses((prev) => ({ ...prev, [step.stepNumber]: 'success' }));
          setManualCheckboxes((prev) => ({ ...prev, [step.stepNumber]: true }));
          setTerminalLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] Step ${step.stepNumber} SUCCESS 🟢 (${step.type.toUpperCase()})`,
          ]);
        }, 600);
      }, delay);

      delay += 1200;
    });

    setTimeout(() => {
      setIsExecutingAll(false);
      setTerminalLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] FULL RUNBOOK COMPLETED 🟢 All ${selectedSop.steps.length} steps executed successfully.`,
      ]);

      // Add to audit logs
      const newRun: SopExecutionRun = {
        runId: `RUN-2026-${Math.floor(8820 + Math.random() * 500)}`,
        sopId: selectedSop.id,
        sopTitle: selectedSop.title,
        tenantId: runnerTenantId,
        tenantName: tenants.find((t) => t.id === runnerTenantId)?.name || 'Contoso Corp',
        targetEntity: runnerTargetEntity,
        operator: 'alex.vance@mspplatform.com',
        startedAt: '2026-07-23 23:05 UTC',
        completedAt: '2026-07-23 23:06 UTC',
        status: 'Completed',
        currentStepIndex: selectedSop.steps.length,
        totalSteps: selectedSop.steps.length,
        passedStepsCount: selectedSop.steps.length,
        psaTicketId: 'HaloPSA #TK-99304',
        logs: terminalLogs,
      };

      setAuditLogs((prev) => [newRun, ...prev]);

      onShowToast?.(
        'success',
        'SOP Execution Complete',
        `Completed all ${selectedSop.steps.length} steps for ${selectedSop.code} on ${runnerTargetEntity}.`
      );
    }, delay + 800);
  };

  const handleCreateSop = () => {
    const newId = `SOP-CUSTOM-${Math.floor(100 + Math.random() * 900)}`;

    const createdSop: StandardOperatingProcedure = {
      id: newId,
      code: newSopCode || 'SOP-NEW-01',
      title: newSopTitle || 'Custom Standard Operating Procedure',
      description: newSopDescription || 'New automated MSP runbook procedure.',
      category: newSopCategory,
      version: 'v1.0',
      automationType: newSopAutomationType,
      estimatedMinutes: 4,
      complianceTags: newSopCompliance.split(',').map((s) => s.trim()),
      workloadTags: ['Entra ID', 'Exchange'],
      versionStatus: 'Published / Active',
      lastUpdatedBy: 'Arch. Shane McCaw',
      lastUpdatedAt: '2026-07-23',
      steps: newSopSteps,
    };

    setSops((prev) => [createdSop, ...prev]);
    setSelectedSopId(newId);
    setIsWizardOpen(false);
    setWizardStep(1);

    onExecuteWorkflow?.('publish-new-sop', {
      sopId: newId,
      code: newSopCode,
    });

    onShowToast?.(
      'success',
      'New SOP Published to Library',
      `Published ${newSopCode} (${newSopTitle}) into global runbook index.`
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & PROCEDURE VELOCITY KPI BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/50 flex items-center justify-center text-indigo-300 shrink-0 font-mono">
              <BookOpen className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  Standard Operating Procedures & Automated Runbook Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold">
                  /portal/sop
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>ITIL v4 Service Delivery & Automated Graph API Pipeline Runner</span>
                <span>•</span>
                <span className="text-emerald-400 text-[11px] font-mono flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> 80+ Azure Write Action Bindings Active
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
                  'Execution Logs Refreshed',
                  'Synced active runbook state and terminal streams across tenant agents.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Execution Logs</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'Master SOP Index PDF Exported',
                  'Exported complete SOC2 / ITIL Standard Operating Procedure Catalog.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Export Master Index PDF</span>
            </button>

            <button
              onClick={() => {
                setIsWizardOpen(true);
                setWizardStep(1);
              }}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Create New SOP / Runbook</span>
            </button>
          </div>

        </div>

        {/* Procedure Velocity KPI Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="bg-[#101419] border border-indigo-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-indigo-300 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                PUBLISHED SOPS & RUNBOOKS
              </div>
              <div className="text-xl font-bold font-mono text-indigo-200">
                {metrics.totalSops} <span className="text-xs font-normal text-indigo-400">Active Procedures</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Library version-controlled index</div>
            </div>
            <div className="p-2 rounded bg-indigo-950/40 border border-indigo-800 text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                AUTOMATED EXECUTION RATIO
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {metrics.autoRatio}% <span className="text-xs font-normal text-emerald-400">Graph API Direct</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Handled automatically without manual tech input</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-[#0078d4]/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#0078d4]" />
                AVG EXECUTION TIME
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                {metrics.avgMins}m 12s <span className="text-xs font-normal text-[#a3c9ff]">(Down from 35m)</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Mean duration across all 25 tenants</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                EXECUTIONS THIS MONTH
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {metrics.monthlyExecutions} <span className="text-xs font-normal text-amber-400">Completed Runs</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Logged with full step verification trace</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <Play className="w-5 h-5" />
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
            onClick={() => setActiveTab('library')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'library'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>SOP & Runbook Library</span>
          </button>

          <button
            onClick={() => setActiveTab('queue')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'queue'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Play className="w-3.5 h-3.5 text-amber-400" />
            <span>Live Execution Queue ({activeRuns.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'audit'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Audit History & Verification Logs</span>
          </button>
        </div>

        {/* Multi-Filter Bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search SOP Title, Workload, ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Category Dropdown */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="All">All Categories</option>
            <option value="User Offboarding / Onboarding">User Offboarding / Onboarding</option>
            <option value="Incident Response">Incident Response</option>
            <option value="Security Drift Remediation">Security Drift Remediation</option>
            <option value="Exchange / Mail Flow">Exchange / Mail Flow</option>
            <option value="Device Management">Device Management</option>
          </select>

          {/* Execution Type Dropdown */}
          <select
            value={automationFilter}
            onChange={(e) => setAutomationFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="All">All Execution Types</option>
            <option value="automated">Fully Automated ⚡</option>
            <option value="hybrid">Hybrid (Manual + Graph) 🥞</option>
            <option value="manual">Manual Checklist 📋</option>
          </select>

          {/* Compliance Tag Dropdown */}
          <select
            value={complianceFilter}
            onChange={(e) => setComplianceFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="All">All Compliance Tags</option>
            <option value="CIS M365">CIS M365 Baseline</option>
            <option value="NIST">NIST 800-53 / IA-2</option>
            <option value="HIPAA">HIPAA Security</option>
            <option value="CMMC">CMMC Level 2</option>
          </select>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. CORE SUB-TABS CONTENT */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden relative flex">
        
        {/* TAB 1: SOP LIBRARY & INTERACTIVE STEP RUNNER (50% / 50% SPLIT) */}
        {activeTab === 'library' && (
          <div className="w-full h-full flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
            
            {/* LEFT PANE (50% Width): Master SOP Directory Grid */}
            <div className="w-full lg:w-[50%] border-b lg:border-b-0 lg:border-r border-[#404752] p-4 space-y-3 shrink-0 lg:shrink overflow-y-auto max-h-[500px] lg:max-h-none lg:h-full">
              <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
                <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                  <span>SOP Directory Catalog ({filteredSops.length})</span>
                  <span>Select SOP to load Runner</span>
                </div>

                <div className="p-3 space-y-2.5">
                  {filteredSops.length === 0 ? (
                    <div className="p-8 text-center text-[#8a919e] text-xs">
                      No Standard Operating Procedures match the filter criteria.
                    </div>
                  ) : (
                    filteredSops.map((sop) => {
                      const isSelected = sop.id === selectedSop.id;

                      return (
                        <div
                          key={sop.id}
                          onClick={() => {
                            setSelectedSopId(sop.id);
                            setCurrentStepStatuses({});
                            setManualCheckboxes({});
                          }}
                          className={cn(
                            'p-3.5 rounded-lg border transition-all cursor-pointer space-y-2.5',
                            isSelected
                              ? 'bg-indigo-950/30 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                              : 'bg-[#101419] border-[#404752] hover:bg-[#272a30]'
                          )}
                        >
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono font-bold text-indigo-300">
                                  {sop.code}
                                </span>
                                <span className="text-[10px] font-mono text-[#8a919e]">({sop.id})</span>
                                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                                  {sop.version}
                                </span>
                              </div>
                              <h3 className="text-sm font-bold text-[#e0e2ea] mt-1">
                                {sop.title}
                              </h3>
                            </div>

                            {/* Automation Level Badge */}
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0',
                                sop.automationType === 'automated'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : sop.automationType === 'hybrid'
                                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                  : 'bg-amber-950 text-amber-300 border border-amber-800'
                              )}
                            >
                              {sop.automationType}
                            </span>
                          </div>

                          <p className="text-xs text-[#8a919e] line-clamp-2 leading-relaxed">
                            {sop.description}
                          </p>

                          {/* Workload Tags & Step Info */}
                          <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-[#404752]/60 text-xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {sop.workloadTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 rounded bg-[#181c22] border border-[#404752] text-[10px] font-mono text-[#a3c9ff]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>

                            <div className="text-[11px] font-mono text-[#8a919e] flex items-center gap-2">
                              <span>{sop.steps.length} Steps</span>
                              <span>•</span>
                              <span>Est: {sop.estimatedMinutes}m</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT PANE (50% Width): Interactive Step-by-Step SOP Execution Console */}
            <div className="w-full lg:w-[50%] h-full overflow-y-auto bg-[#101419] p-4 lg:p-5 space-y-4">
              
              {/* Runner Header Controls */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3 shadow-md">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                      {selectedSop.code}
                    </span>
                    <span className="text-xs text-[#8a919e] font-mono">{selectedSop.category}</span>
                  </div>

                  <button
                    onClick={handleExecuteAllSteps}
                    disabled={isExecutingAll}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isExecutingAll ? 'Running Pipeline...' : 'Execute All Automated Steps'}</span>
                  </button>
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#e0e2ea] leading-snug">
                    {selectedSop.title}
                  </h2>
                  <p className="text-xs text-[#8a919e] mt-1">{selectedSop.description}</p>
                </div>

                {/* Target Context Pickers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#404752]/60 text-xs">
                  <div>
                    <label className="text-[10px] font-mono text-[#8a919e] uppercase block mb-1">Target Tenant:</label>
                    <select
                      value={runnerTenantId}
                      onChange={(e) => setRunnerTenantId(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="contoso-01">Contoso Corporation</option>
                      <option value="fabrikam-02">Fabrikam Inc</option>
                      <option value="woodgrove-04">Woodgrove Bank</option>
                      <option value="northwind-03">Northwind Traders</option>
                      <option value="adventure-05">AdventureWorks</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-[#8a919e] uppercase block mb-1">Target Entity (UPN / Device):</label>
                    <input
                      type="text"
                      value={runnerTargetEntity}
                      onChange={(e) => setRunnerTargetEntity(e.target.value)}
                      placeholder="e.g. alex.b@contoso.com"
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Interactive Step Pipeline Checklist */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="text-xs font-mono font-bold text-indigo-300 uppercase tracking-wider flex items-center justify-between border-b border-[#404752] pb-2">
                  <span>Step Pipeline Execution ({selectedSop.steps.length} Steps)</span>
                  <span className="text-[10px] text-[#8a919e]">1-Click Graph API Runner</span>
                </div>

                <div className="space-y-3">
                  {selectedSop.steps.map((step) => {
                    const status = currentStepStatuses[step.stepNumber] || 'pending';
                    const isManualChecked = manualCheckboxes[step.stepNumber] || false;

                    return (
                      <div
                        key={step.stepNumber}
                        className={cn(
                          'p-3 rounded border transition-all text-xs space-y-2',
                          status === 'success'
                            ? 'bg-emerald-950/20 border-emerald-500/50'
                            : status === 'running'
                            ? 'bg-indigo-950/30 border-indigo-500 animate-pulse'
                            : 'bg-[#101419] border-[#404752]'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <span className="w-5 h-5 rounded-full bg-[#181c22] border border-[#404752] text-[10px] font-mono font-bold flex items-center justify-center text-[#a3c9ff] shrink-0 mt-0.5">
                              {step.stepNumber}
                            </span>

                            <div>
                              <div className="font-bold text-[#e0e2ea] flex items-center gap-1.5">
                                <span>{step.title}</span>
                                {step.type === 'automated' ? (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                                    AUTOMATED ⚡
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                                    MANUAL CHECKLIST 📋
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#8a919e] mt-0.5 leading-relaxed">
                                {step.description}
                              </p>
                            </div>
                          </div>

                          {/* Action Button or Checkbox */}
                          <div>
                            {step.type === 'automated' ? (
                              <button
                                onClick={() => handleExecuteSingleStep(step)}
                                disabled={status === 'running' || status === 'success'}
                                className={cn(
                                  'px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all',
                                  status === 'success'
                                    ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow'
                                )}
                              >
                                {status === 'success' ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Passed 🟢</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-3.5 h-3.5" />
                                    <span>Execute Step {step.stepNumber}</span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <label className="flex items-center gap-1.5 bg-[#181c22] px-2.5 py-1 rounded border border-[#404752] cursor-pointer hover:border-indigo-500">
                                <input
                                  type="checkbox"
                                  checked={isManualChecked}
                                  onChange={() => handleToggleManualStep(step.stepNumber)}
                                  className="rounded border-[#404752] text-indigo-600 focus:ring-0 cursor-pointer"
                                />
                                <span className="text-[10px] font-mono text-[#e0e2ea]">
                                  {isManualChecked ? 'Verified 🟢' : 'Mark Verified'}
                                </span>
                              </label>
                            )}
                          </div>
                        </div>

                        {step.graphEndpoint && (
                          <div className="font-mono text-[10px] text-[#a3c9ff] bg-[#181c22] p-1.5 rounded border border-[#404752]">
                            Endpoint: {step.graphEndpoint}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Output Terminal Box */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-2">
                <div className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#404752] pb-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span>Live Output Stream & Graph API Trace</span>
                </div>

                <div className="bg-[#0b0e14] border border-[#404752] p-3 rounded text-[11px] font-mono text-emerald-300 h-[140px] overflow-y-auto space-y-1">
                  {terminalLogs.map((log, idx) => (
                    <div key={idx} className="leading-tight">
                      {log}
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: LIVE EXECUTION QUEUE */}
        {activeTab === 'queue' && (
          <div className="w-full h-full p-4 lg:p-6 overflow-y-auto space-y-4">
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Active In-Progress SOP Runs ({activeRuns.length})</span>
                <span>Real-time Technician Execution Trackers</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Run GUID & SOP Name</th>
                      <th className="p-3">Target Tenant</th>
                      <th className="p-3">Target Entity</th>
                      <th className="p-3">Operator</th>
                      <th className="p-3">Step Progress</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {activeRuns.map((run) => (
                      <tr key={run.runId} className="hover:bg-[#272a30]/80">
                        <td className="p-3 font-sans">
                          <div className="font-bold text-[#e0e2ea]">{run.sopTitle}</div>
                          <div className="text-[10px] font-mono text-[#a3c9ff]">{run.runId} • {run.psaTicketId}</div>
                        </td>

                        <td className="p-3 font-sans font-semibold text-[#e0e2ea]">
                          {run.tenantName}
                        </td>

                        <td className="p-3 font-mono text-[11px] text-[#a3c9ff]">
                          {run.targetEntity}
                        </td>

                        <td className="p-3 font-sans text-[11px] text-[#8a919e]">
                          {run.operator.split('@')[0]}
                        </td>

                        <td className="p-3">
                          <div className="text-[11px] font-mono text-emerald-400 font-bold mb-1">
                            Step {run.currentStepIndex} of {run.totalSteps}
                          </div>
                          <div className="w-24 bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                            <div
                              className="bg-emerald-500 h-full transition-all"
                              style={{ width: `${(run.currentStepIndex / run.totalSteps) * 100}%` }}
                            />
                          </div>
                        </td>

                        <td className="p-3">
                          {run.status === 'In Progress' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 animate-pulse">
                              IN PROGRESS 🔵
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                              BLOCKED 🟡
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-right font-sans">
                          <button
                            onClick={() => {
                              setSelectedSopId(run.sopId);
                              setActiveTab('library');
                            }}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-bold cursor-pointer"
                          >
                            Inspect & Resume Run
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

        {/* TAB 3: AUDIT HISTORY & VERIFICATION LOGS */}
        {activeTab === 'audit' && (
          <div className="w-full h-full p-4 lg:p-6 overflow-y-auto space-y-4">
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Completed SOP Runbook Audit Register ({auditLogs.length})</span>
                <span>Fully Verified Historical Execution Certificates</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Run GUID & SOP</th>
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">Target Scope</th>
                      <th className="p-3">Executed By</th>
                      <th className="p-3">Completed At</th>
                      <th className="p-3">Pass Rate</th>
                      <th className="p-3 text-right">Certificate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {auditLogs.map((log) => (
                      <tr key={log.runId} className="hover:bg-[#272a30]/80">
                        <td className="p-3 font-sans">
                          <div className="font-bold text-[#e0e2ea]">{log.sopTitle}</div>
                          <div className="text-[10px] font-mono text-[#a3c9ff]">{log.runId} • {log.psaTicketId}</div>
                        </td>

                        <td className="p-3 font-sans font-semibold text-[#e0e2ea]">
                          {log.tenantName}
                        </td>

                        <td className="p-3 text-[11px] font-mono text-[#a3c9ff]">
                          {log.targetEntity}
                        </td>

                        <td className="p-3 font-sans text-[11px] text-[#8a919e]">
                          {log.operator}
                        </td>

                        <td className="p-3 text-[11px] text-[#e0e2ea]">
                          {log.completedAt}
                        </td>

                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            {log.passedStepsCount}/{log.totalSteps} PASSED 🟢
                          </span>
                        </td>

                        <td className="p-3 text-right font-sans">
                          <button
                            onClick={() => {
                              onShowToast?.(
                                'success',
                                'SOP Certificate Generated',
                                `Downloaded compliance verification certificate for ${log.runId}.`
                              );
                            }}
                            className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[11px] font-semibold cursor-pointer"
                          >
                            <Download className="w-3 h-3 inline mr-1" />
                            PDF Certificate
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
      {/* 4. INTERACTIVE SOP CREATION / EDITING WIZARD MODAL */}
      {/* ========================================================================= */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">
                  Author New Standard Operating Procedure / Runbook
                </h2>
              </div>
              <button
                onClick={() => setIsWizardOpen(false)}
                className="p-1 rounded hover:bg-[#272a30] text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Wizard Step Progress Indicator */}
            <div className="p-3 bg-[#101419] border-b border-[#404752] flex items-center justify-around text-xs font-mono">
              <div className={cn('flex items-center gap-1.5', wizardStep === 1 ? 'text-indigo-400 font-bold' : 'text-[#8a919e]')}>
                <span>1. Metadata</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#404752]" />
              <div className={cn('flex items-center gap-1.5', wizardStep === 2 ? 'text-indigo-400 font-bold' : 'text-[#8a919e]')}>
                <span>2. Step Pipeline</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#404752]" />
              <div className={cn('flex items-center gap-1.5', wizardStep === 3 ? 'text-indigo-400 font-bold' : 'text-[#8a919e]')}>
                <span>3. Graph API Binding</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#404752]" />
              <div className={cn('flex items-center gap-1.5', wizardStep === 4 ? 'text-indigo-400 font-bold' : 'text-[#8a919e]')}>
                <span>4. Compliance & Publish</span>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {wizardStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block mb-1">SOP Code & Title:</label>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={newSopCode}
                        onChange={(e) => setNewSopCode(e.target.value)}
                        placeholder="SOP-OFFBOARD-01"
                        className="bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs font-mono"
                      />
                      <input
                        type="text"
                        value={newSopTitle}
                        onChange={(e) => setNewSopTitle(e.target.value)}
                        placeholder="Procedure Title..."
                        className="col-span-2 bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-mono text-[#8a919e] uppercase block mb-1">Category:</label>
                      <select
                        value={newSopCategory}
                        onChange={(e) => setNewSopCategory(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs cursor-pointer"
                      >
                        <option value="User Offboarding / Onboarding">User Offboarding / Onboarding</option>
                        <option value="Incident Response">Incident Response</option>
                        <option value="Security Drift Remediation">Security Drift Remediation</option>
                        <option value="Exchange / Mail Flow">Exchange / Mail Flow</option>
                        <option value="Device Management">Device Management</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-mono text-[#8a919e] uppercase block mb-1">Automation Level:</label>
                      <select
                        value={newSopAutomationType}
                        onChange={(e) => setNewSopAutomationType(e.target.value as any)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs cursor-pointer"
                      >
                        <option value="hybrid">Hybrid (Manual + Graph)</option>
                        <option value="automated">Fully Automated ⚡</option>
                        <option value="manual">Manual Checklist 📋</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block mb-1">Description & Objective:</label>
                    <textarea
                      rows={3}
                      value={newSopDescription}
                      onChange={(e) => setNewSopDescription(e.target.value)}
                      placeholder="Enter detailed ITIL objective..."
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs"
                    />
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#e0e2ea]">Define Procedural Steps ({newSopSteps.length}):</span>
                    <button
                      onClick={() => {
                        setNewSopSteps((prev) => [
                          ...prev,
                          {
                            stepNumber: prev.length + 1,
                            title: `New Step ${prev.length + 1}`,
                            description: 'Step action details...',
                            type: 'automated',
                            status: 'pending',
                          },
                        ]);
                      }}
                      className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold cursor-pointer"
                    >
                      + Add Step
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {newSopSteps.map((step, idx) => (
                      <div key={idx} className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-indigo-300">Step {step.stepNumber}</span>
                          <select
                            value={step.type}
                            onChange={(e) => {
                              const val = e.target.value as 'manual' | 'automated';
                              setNewSopSteps((prev) =>
                                prev.map((s, i) => (i === idx ? { ...s, type: val } : s))
                              );
                            }}
                            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-[10px] p-1 rounded cursor-pointer"
                          >
                            <option value="automated">Automated (Graph API)</option>
                            <option value="manual">Manual Checklist</option>
                          </select>
                        </div>

                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewSopSteps((prev) =>
                              prev.map((s, i) => (i === idx ? { ...s, title: val } : s))
                            );
                          }}
                          className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs p-1.5 rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-3">
                  <div className="font-bold text-[#e0e2ea]">Map Graph API Write Endpoints:</div>
                  <div className="space-y-2">
                    {newSopSteps.filter((s) => s.type === 'automated').map((step, idx) => (
                      <div key={idx} className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-1">
                        <div className="font-bold text-indigo-300">{step.title}</div>
                        <input
                          type="text"
                          defaultValue={step.graphEndpoint || 'POST /v1.0/users/{upn}/revokeSignInSessions'}
                          className="w-full bg-[#181c22] border border-[#404752] text-[#a3c9ff] font-mono text-[11px] p-1.5 rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-mono text-[#8a919e] uppercase block mb-1">Compliance Tags (Comma-separated):</label>
                    <input
                      type="text"
                      value={newSopCompliance}
                      onChange={(e) => setNewSopCompliance(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] p-2 rounded text-xs font-mono"
                    />
                  </div>

                  <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded text-emerald-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Validation Passed & Ready for Production</span>
                    </div>
                    <p className="text-[11px] text-[#8a919e]">
                      This procedure will be published immediately to all 25 client tenant runners.
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
                  className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-bold cursor-pointer"
                >
                  Back
                </button>
              ) : <div />}

              {wizardStep < 4 ? (
                <button
                  onClick={() => setWizardStep((prev) => (prev + 1) as any)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold cursor-pointer"
                >
                  Next Step
                </button>
              ) : (
                <button
                  onClick={handleCreateSop}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer shadow-sm"
                >
                  Publish SOP Version to Library
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
export default StandardOperatingProceduresConsole;
