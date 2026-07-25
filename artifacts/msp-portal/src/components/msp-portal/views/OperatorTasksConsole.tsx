import React, { useState, useMemo, useEffect } from 'react';
import {
  CheckSquare,
  ListTodo,
  Clock,
  AlertTriangle,
  Play,
  CheckCircle2,
  XCircle,
  UserCheck,
  ShieldAlert,
  Zap,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  FileText,
  Ticket,
  Layers,
  ExternalLink,
  Sparkles,
  ChevronRight,
  X,
  Plus,
  Send,
  User,
  Lock,
  Calendar,
  BarChart3,
  Check,
  ShieldCheck,
  Building2,
  ArrowRight,
  TrendingUp,
  MessageSquare,
  AlertCircle
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';
import {
  SlaTimerPill,
  ChangeControlGateModal,
  AiRemediationCopilot,
  CommercialUpsellBanner,
  RbdAcceptanceAndRuleLinker,
  EmbeddedSopRunner,
  ScopeCreepAlertBanner,
  AlertResolutionWizardModal
} from '../common';

// ============================================================================
// TYPES & DATA STRUCTURES
// ============================================================================

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';
export type TaskSource = 'alert' | 'sop' | 'scheduled' | 'psa';
export type ExecutionType = 'automated' | 'manual' | 'gated';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'blocked';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ActivityNote {
  id: string;
  timestamp: string;
  actor: string;
  note: string;
}

export interface OperatorTask {
  id: string;
  taskCode: string;
  title: string;
  description: string;
  tenantId: string;
  tenantName: string;
  priority: PriorityLevel;
  source: TaskSource;
  executionType: ExecutionType;
  targetResource: string;
  assignedTo: string | null;
  slaDeadline: string;
  remainingSeconds: number; // positive = remaining, negative = overdue
  status: TaskStatus;
  psaTicketId: string;
  actionId: string | null;
  graphEndpoint: string | null;
  checklists: ChecklistItem[];
  activityTrail: ActivityNote[];
  recommendedAction?: string;
  slaTier?: string;
}

interface OperatorTasksConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// ============================================================================
// INITIAL MOCK DATA
// ============================================================================

const INITIAL_TASKS: OperatorTask[] = [
  {
    id: 'tsk-1',
    taskCode: 'TSK-88392',
    title: 'Confirm & Remediate Unauthorized Inbox Forwarding Rule',
    description: 'Alert triggered by Defender for Cloud Apps. User "alex.wilson@contosobio.com" created an external auto-forwarding rule to "external-audit-shadow@gmail.com". Potential data exfiltration vector.',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    priority: 'critical',
    source: 'alert',
    executionType: 'automated',
    targetResource: 'alex.wilson@contosobio.com',
    assignedTo: 'Shane McCaw',
    slaDeadline: '15m SLA',
    remainingSeconds: 420, // 7 minutes left
    status: 'open',
    psaTicketId: 'HaloPSA #TK-99210',
    actionId: 'act-delete-forwarding-rule',
    graphEndpoint: 'POST /users/alex.wilson@contosobio.com/mailFolders/inbox/messageRules/removeExternal',
    recommendedAction: 'Execute automated 1-click Graph API rule deletion and purge session refresh tokens.',
    slaTier: 'Platinum 15m',
    checklists: [
      { id: 'c1', label: 'Verify user travel status with Department Manager', done: true },
      { id: 'c2', label: 'Confirm destination address is not on approved corporate exception list', done: true },
      { id: 'c3', label: 'Purge forwarding rule via Graph API payload', done: false }
    ],
    activityTrail: [
      { id: 'a1', timestamp: '10:02 AM', actor: 'System Alert Engine', note: 'Task created automatically via Defender Rule Breach alert.' },
      { id: 'a2', timestamp: '10:05 AM', actor: 'Shane McCaw', note: 'Claimed task. Contacted manager to confirm no exception filed.' }
    ]
  },
  {
    id: 'tsk-2',
    taskCode: 'TSK-88395',
    title: 'Executive MFA Emergency Bypass Review & Token Revocation',
    description: 'Temporary 24-hour Conditional Access bypass was requested for CEO "e.vance@contosobio.com" due to hardware token malfunction during overseas flight.',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    priority: 'critical',
    source: 'alert',
    executionType: 'gated',
    targetResource: 'e.vance@contosobio.com',
    assignedTo: null,
    slaDeadline: '15m SLA',
    remainingSeconds: -180, // Overdue by 3 mins
    status: 'open',
    psaTicketId: 'ConnectWise #CW-44102',
    actionId: 'act-revoke-bypass-tokens',
    graphEndpoint: 'POST /identity/conditionalAccess/policies/bypassGroup/members/$ref/delete',
    recommendedAction: 'Require senior approval code before revoking temporary bypass and forcing re-registration.',
    slaTier: 'Platinum 15m',
    checklists: [
      { id: 'c1', label: 'Confirm executive safe arrival via voice verification', done: false },
      { id: 'c2', label: 'Issue replacement FIDO2 security key', done: false },
      { id: 'c3', label: 'Revoke Conditional Access bypass policy exclusion', done: false }
    ],
    activityTrail: [
      { id: 'a1', timestamp: '09:45 AM', actor: 'Helpdesk Escalation Bot', note: 'Task logged from priority phone support queue.' }
    ]
  },
  {
    id: 'tsk-3',
    taskCode: 'TSK-88398',
    title: 'Monthly Stale Guest Account Cleanup & Access Review',
    description: 'Scheduled SOP audit item: 28 external guest accounts in Tenant domain have been inactive for > 90 days. Review and disable inactive guest identities.',
    tenantId: 't-2',
    tenantName: 'Vanguard Legal Partners',
    priority: 'medium',
    source: 'scheduled',
    executionType: 'manual',
    targetResource: 'Tenant Guest Identities (28 Users)',
    assignedTo: 'Shane McCaw',
    slaDeadline: '4h SLA',
    remainingSeconds: 12400, // ~3.4 hours left
    status: 'in_progress',
    psaTicketId: 'HaloPSA #TK-99180',
    actionId: null,
    graphEndpoint: null,
    recommendedAction: 'Export inactive guest user log, send notice to partner leads, and disable non-responsive guest accounts.',
    slaTier: 'Gold 4h',
    checklists: [
      { id: 'c1', label: 'Export 90-day inactive guest list from Entra ID Audit Logs', done: true },
      { id: 'c2', label: 'Dispatch courtesy notification email to primary sponsors', done: true },
      { id: 'c3', label: 'Disable unconfirmed guest accounts in Entra ID', done: false }
    ],
    activityTrail: [
      { id: 'a1', timestamp: '08:00 AM', actor: 'SOP Scheduler', note: 'Routine monthly maintenance task generated.' },
      { id: 'a2', timestamp: '08:30 AM', actor: 'Shane McCaw', note: 'Exported report and emailed 4 sponsor leads.' }
    ]
  },
  {
    id: 'tsk-4',
    taskCode: 'TSK-88401',
    title: 'Non-Compliant Intune Device Isolation (MacBook Pro M3)',
    description: 'Device "APEX-MBP-042" belonging to "m.vance@apexlogistics.com" failed FileVault encryption compliance policy for 7 consecutive days.',
    tenantId: 't-3',
    tenantName: 'Apex Logistics & Freight',
    priority: 'high',
    source: 'sop',
    executionType: 'automated',
    targetResource: 'APEX-MBP-042 (m.vance)',
    assignedTo: 'NOC Tech Level 2',
    slaDeadline: '1h SLA',
    remainingSeconds: 1850, // ~30 mins left
    status: 'open',
    psaTicketId: 'HaloPSA #TK-99255',
    actionId: 'act-isolate-intune-device',
    graphEndpoint: 'POST /deviceManagement/managedDevices/device-apex-mbp-042/wipeOrIsolate',
    recommendedAction: 'Trigger Intune network isolation payload until FileVault encryption is enabled locally.',
    slaTier: 'Gold 1h',
    checklists: [
      { id: 'c1', label: 'Check device last check-in timestamp in Intune console', done: true },
      { id: 'c2', label: 'Trigger network isolation via Graph API', done: false }
    ],
    activityTrail: [
      { id: 'a1', timestamp: '09:30 AM', actor: 'Intune Compliance Runner', note: 'Compliance check failed 7th consecutive cycle.' }
    ]
  },
  {
    id: 'tsk-5',
    taskCode: 'TSK-88405',
    title: 'Stale Global Admin Account Remediation & PIM Conversion',
    description: 'Permanent Global Administrator assignment detected for "legacy-admin@biohealth.io". Must be converted to Privileged Identity Management (PIM) eligible assignment.',
    tenantId: 't-4',
    tenantName: 'BioHealth Innovations',
    priority: 'high',
    source: 'alert',
    executionType: 'manual',
    targetResource: 'legacy-admin@biohealth.io',
    assignedTo: null,
    slaDeadline: '2h SLA',
    remainingSeconds: 4800,
    status: 'open',
    psaTicketId: 'HaloPSA #TK-99289',
    actionId: null,
    graphEndpoint: null,
    recommendedAction: 'Remove standing admin privileges and create PIM eligible role assignment in Entra ID.',
    slaTier: 'Gold 2h',
    checklists: [
      { id: 'c1', label: 'Verify identity owner and business requirement', done: false },
      { id: 'c2', label: 'Remove standing Global Admin assignment', done: false },
      { id: 'c3', label: 'Add user to PIM Eligible Role assignment group', done: false }
    ],
    activityTrail: [
      { id: 'a1', timestamp: '08:15 AM', actor: 'Governance Engine', note: 'Standing admin assignment flagged during weekly drift scan.' }
    ]
  },
  {
    id: 'tsk-6',
    taskCode: 'TSK-88410',
    title: 'Unassigned M365 License Reclamation Verification',
    description: '12 unassigned M365 E3 licenses detected in Meridian Capital tenant ($432/mo spend). Confirm deprovisioning with client CFO.',
    tenantId: 't-5',
    tenantName: 'Meridian Capital Partners',
    priority: 'low',
    source: 'psa',
    executionType: 'manual',
    targetResource: 'Meridian M365 Subscriptions',
    assignedTo: 'Shane McCaw',
    slaDeadline: '24h SLA',
    remainingSeconds: 68000,
    status: 'completed',
    psaTicketId: 'HaloPSA #TK-99150',
    actionId: null,
    graphEndpoint: null,
    recommendedAction: 'Confirm with CFO and reduce NCE license count before auto-renewal cutoff date.',
    slaTier: 'Silver 24h',
    checklists: [
      { id: 'c1', label: 'Confirm unassigned licenses with CFO David Chen', done: true },
      { id: 'c2', label: 'Adjust seat count in Microsoft Partner Center', done: true },
      { id: 'c3', label: 'Update MSP Billing ledger record', done: true }
    ],
    activityTrail: [
      { id: 'a1', timestamp: 'Yesterday', actor: 'FinOps Bot', note: 'License waste detected.' },
      { id: 'a2', timestamp: '09:00 AM', actor: 'Shane McCaw', note: 'Confirmed with CFO. Reduced license count by 12 seats.' }
    ]
  }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const OperatorTasksConsole: React.FC<OperatorTasksConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation View Tabs
  const [activeView, setActiveView] = useState<'queue' | 'scheduled' | 'analytics'>('queue');

  // Technician View Filter Mode
  const [myTasksOnly, setMyTasksOnly] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [executionTypeFilter, setExecutionTypeFilter] = useState('ALL');
  const [cardFilter, setCardFilter] = useState<'all' | 'my_tasks' | 'critical' | 'sla_risk' | 'resolved'>('all');

  // Tasks Collection State
  const [tasks, setTasks] = useState<OperatorTask[]>(INITIAL_TASKS);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('tsk-1');

  // Selected Tasks for Batch Operations
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Action Execution In-Progress state
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [gatedReason, setGatedReason] = useState('');
  const [workNoteInput, setWorkNoteInput] = useState('');

  // 3-Panel Resolution Wizard State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeWizardTask, setActiveWizardTask] = useState<OperatorTask | null>(null);

  const handleOpenWizard = (taskToInspect?: OperatorTask) => {
    const target = taskToInspect || selectedTask;
    if (target) {
      setActiveWizardTask(target);
      setIsWizardOpen(true);
    }
  };
  const [isRbdModalOpen, setIsRbdModalOpen] = useState(false);

  const handleConfirmTaskRbd = (record: { rbdCode: string; clientUpn: string; justification: string }) => {
    if (!selectedTask) return;
    setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, status: 'completed' } : t));
    setIsRbdModalOpen(false);
    toast('success', 'RBD Waiver Logged & Rule Linked', `Task ${selectedTask.taskCode} resolved under active RBD waiver (${record.rbdCode}). Rule linked.`);
  };

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Selected Task
  const selectedTask = useMemo(() => {
    return tasks.find(t => t.id === selectedTaskId) || tasks[0];
  }, [tasks, selectedTaskId]);

  // Operational KPI Totals
  const kpis = useMemo(() => {
    const myTasksCount = tasks.filter(t => t.assignedTo === 'Shane McCaw' && t.status !== 'completed').length;
    const criticalCount = tasks.filter(t => t.priority === 'critical' && t.status !== 'completed').length;
    const slaRiskCount = tasks.filter(t => t.remainingSeconds < 900 && t.status !== 'completed').length; // <15m
    const completedTodayCount = tasks.filter(t => t.status === 'completed').length;

    return {
      myTasksCount,
      criticalCount,
      slaRiskCount,
      completedTodayCount
    };
  }, [tasks]);

  // Filtered & Sorted Tasks
  const filteredTasks = useMemo(() => {
    let result = tasks.filter(t => {
      if (myTasksOnly && t.assignedTo !== 'Shane McCaw') return false;

      // Card Filter logic
      if (cardFilter === 'my_tasks') {
        if (t.assignedTo !== 'Shane McCaw' || t.status === 'completed') return false;
      } else if (cardFilter === 'critical') {
        if ((t.priority !== 'critical' && t.priority !== 'high') || t.status === 'completed') return false;
      } else if (cardFilter === 'sla_risk') {
        if (t.remainingSeconds >= 900 || t.status === 'completed') return false;
      } else if (cardFilter === 'resolved') {
        if (t.status !== 'completed') return false;
      }

      const matchesSearch =
        t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.taskCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.targetResource.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.psaTicketId.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesTenant = tenantFilter === 'ALL' || t.tenantId === tenantFilter;
      const matchesPriority = priorityFilter === 'ALL' || t.priority === priorityFilter;
      const matchesSource = sourceFilter === 'ALL' || t.source === sourceFilter;
      const matchesType = executionTypeFilter === 'ALL' || t.executionType === executionTypeFilter;

      return matchesSearch && matchesTenant && matchesPriority && matchesSource && matchesType;
    });

    // Sorting strategy based on active card
    if (cardFilter === 'sla_risk') {
      result = [...result].sort((a, b) => a.remainingSeconds - b.remainingSeconds);
    } else if (cardFilter === 'critical') {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      result = [...result].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    }

    return result;
  }, [tasks, myTasksOnly, cardFilter, searchTerm, tenantFilter, priorityFilter, sourceFilter, executionTypeFilter]);

  // Claim Task
  const handleClaimTask = (taskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          assignedTo: 'Shane McCaw',
          status: t.status === 'open' ? 'in_progress' : t.status,
          activityTrail: [
            ...t.activityTrail,
            { id: `a-${Date.now()}`, timestamp: 'Just now', actor: 'Shane McCaw', note: 'Claimed task from NOC operator queue.' }
          ]
        };
      }
      return t;
    }));

    toast('success', 'Task Claimed', 'Assigned task to Shane McCaw.');
  };

  // Claim Next Highest Priority
  const handleClaimNextHighest = () => {
    const unassignedCritical = tasks.find(t => t.assignedTo === null && t.priority === 'critical' && t.status !== 'completed');
    const target = unassignedCritical || tasks.find(t => t.assignedTo === null && t.status !== 'completed');

    if (!target) {
      toast('info', 'All Tasks Assigned', 'No unassigned open tasks remaining in the NOC queue.');
      return;
    }

    handleClaimTask(target.id);
    setSelectedTaskId(target.id);
  };

  // Execute Automated Graph Action
  const handleExecuteGraphAction = () => {
    if (!selectedTask) return;

    if (selectedTask.executionType === 'gated' && !gatedReason.trim()) {
      toast('error', 'Gated Approval Required', 'Please enter a Senior Tech approval code or ticket authorization reason.');
      return;
    }

    setIsExecutingAction(true);

    setTimeout(() => {
      setIsExecutingAction(false);

      setTasks(prev => prev.map(t => {
        if (t.id === selectedTask.id) {
          const updatedChecklists = t.checklists.map(c => ({ ...c, done: true }));
          return {
            ...t,
            status: 'completed',
            checklists: updatedChecklists,
            activityTrail: [
              ...t.activityTrail,
              {
                id: `a-${Date.now()}`,
                timestamp: 'Just now',
                actor: 'Shane McCaw',
                note: `Executed Graph API payload (${t.graphEndpoint}). Task auto-resolved.`
              }
            ]
          };
        }
        return t;
      }));

      setGatedReason('');
      toast('success', 'Graph Action Executed', `Successfully executed remediation payload for ${selectedTask.tenantName}.`);
    }, 1400);
  };

  // Toggle Checklist Item
  const handleToggleChecklist = (taskId: string, checklistId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updated = t.checklists.map(c => c.id === checklistId ? { ...c, done: !c.done } : c);
        const allDone = updated.every(c => c.done);

        return {
          ...t,
          checklists: updated,
          status: allDone ? 'completed' : 'in_progress'
        };
      }
      return t;
    }));
  };

  // Add Activity Note & Complete
  const handleAddNote = (completeTask: boolean) => {
    if (!workNoteInput.trim() && !completeTask) return;

    setTasks(prev => prev.map(t => {
      if (t.id === selectedTaskId) {
        const newTrail = [...t.activityTrail];
        if (workNoteInput.trim()) {
          newTrail.push({
            id: `a-${Date.now()}`,
            timestamp: 'Just now',
            actor: 'Shane McCaw',
            note: workNoteInput.trim()
          });
        }
        if (completeTask) {
          newTrail.push({
            id: `a-${Date.now()}-c`,
            timestamp: 'Just now',
            actor: 'Shane McCaw',
            note: 'Marked task complete and closed associated PSA work item.'
          });
        }

        return {
          ...t,
          status: completeTask ? 'completed' : 'in_progress',
          activityTrail: newTrail
        };
      }
      return t;
    }));

    setWorkNoteInput('');
    if (completeTask) {
      toast('success', 'Task Completed', `Task ${selectedTask.taskCode} resolved and PSA ticket closed.`);
    } else {
      toast('info', 'Note Added', 'Work note logged to task activity trail.');
    }
  };

  // Format SLA Timer Display
  const formatSlaClock = (seconds: number) => {
    if (seconds < 0) {
      const abs = Math.abs(seconds);
      const mins = Math.floor(abs / 60);
      return { text: `OVERDUE +${mins}m`, isOverdue: true };
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return {
      text: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} Remaining`,
      isOverdue: false
    };
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & OPERATOR TELEMETRY KPI BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & View Control Options */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-[#0078d4]/20 to-[#a3c9ff]/10 border border-[#0078d4]/40 rounded-lg">
              <CheckSquare className="w-6 h-6 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">Technician Work Queue &amp; Remediation Console</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  /portal/tasks
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Gated Graph API remediation actions, SOP escalations, SLA tracking clocks &amp; PSA ticket synchronization.
              </p>
            </div>
          </div>

          {/* Action Header Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* My Tasks vs All Operator Queue Toggle */}
            <button
              onClick={() => {
                setMyTasksOnly(!myTasksOnly);
                toast('info', 'Queue Filter Updated', myTasksOnly ? 'Showing all NOC operator tasks.' : 'Filtering to my assigned tasks only.');
              }}
              className={cn(
                "px-3 py-2 rounded text-xs font-semibold transition-all flex items-center gap-1.5 border",
                myTasksOnly
                  ? "bg-[#0078d4] text-white border-[#0078d4] font-bold shadow-md"
                  : "bg-[#181c22] text-[#8a919e] hover:text-[#e0e2ea] border-[#404752]"
              )}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{myTasksOnly ? 'My Tasks Only (Active)' : 'Filter: My Tasks Only'}</span>
            </button>

            <button
              onClick={handleClaimNextHighest}
              className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md active:scale-95"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Claim Next Highest Priority</span>
            </button>

            <button
              onClick={() => {
                toast('info', 'Refreshing Work Queue', 'Fetching latest Graph API alerts & PSA tickets...');
              }}
              className="p-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded transition-colors"
              title="Refresh Work Queue"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 KPI Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div
            onClick={() => setCardFilter(prev => prev === 'my_tasks' ? 'all' : 'my_tasks')}
            className={cn(
              "p-3 rounded-lg flex items-center justify-between shadow-inner cursor-pointer transition-all border",
              cardFilter === 'my_tasks'
                ? "bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/80 shadow-lg shadow-blue-950/50"
                : "bg-[#181c22]/90 border-[#404752] hover:bg-[#202630]"
            )}
          >
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold flex items-center gap-1">
                My Assigned Tasks
                {cardFilter === 'my_tasks' && (
                  <span className="text-[9px] font-mono bg-blue-500 text-white px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </span>
              <div className="text-xl font-bold font-mono text-[#a3c9ff] flex items-baseline gap-1">
                <span>{kpis.myTasksCount} Tasks</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">Active</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <ListTodo className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div
            onClick={() => setCardFilter(prev => prev === 'critical' ? 'all' : 'critical')}
            className={cn(
              "p-3 rounded-lg flex items-center justify-between shadow-inner cursor-pointer transition-all border",
              cardFilter === 'critical'
                ? "bg-red-950/70 border-red-500 ring-2 ring-red-500/80 shadow-lg shadow-red-950/50"
                : "bg-[#181c22]/90 border-[#404752] hover:bg-[#202630]"
            )}
          >
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold flex items-center gap-1">
                Critical / High Threat
                {cardFilter === 'critical' && (
                  <span className="text-[9px] font-mono bg-red-500 text-white px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </span>
              <div className="text-xl font-bold font-mono text-red-400 flex items-baseline gap-2">
                <span>{kpis.criticalCount} Critical</span>
                <span className="text-[10px] font-mono font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded border border-red-500/30">
                  ACTION REQUIRED
                </span>
              </div>
            </div>
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md">
              <ShieldAlert className="w-5 h-5 text-red-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div
            onClick={() => setCardFilter(prev => prev === 'sla_risk' ? 'all' : 'sla_risk')}
            className={cn(
              "p-3 rounded-lg flex items-center justify-between shadow-inner cursor-pointer transition-all border",
              cardFilter === 'sla_risk'
                ? "bg-amber-950/70 border-amber-500 ring-2 ring-amber-500/80 shadow-lg shadow-amber-950/50"
                : "bg-[#181c22]/90 border-[#404752] hover:bg-[#202630]"
            )}
          >
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold flex items-center gap-1">
                SLA Clock Exposure (&lt;15m)
                {cardFilter === 'sla_risk' && (
                  <span className="text-[9px] font-mono bg-amber-500 text-black px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </span>
              <div className="text-xl font-bold font-mono text-amber-400 flex items-baseline gap-2">
                <span>{kpis.slaRiskCount} SLA Risks</span>
                <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                  BREACH NEAR
                </span>
              </div>
            </div>
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div
            onClick={() => setCardFilter(prev => prev === 'resolved' ? 'all' : 'resolved')}
            className={cn(
              "p-3 rounded-lg flex items-center justify-between shadow-inner cursor-pointer transition-all border",
              cardFilter === 'resolved'
                ? "bg-emerald-950/70 border-emerald-500 ring-2 ring-emerald-500/80 shadow-lg shadow-emerald-950/50"
                : "bg-[#181c22]/90 border-[#404752] hover:bg-[#202630]"
            )}
          >
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold flex items-center gap-1">
                Resolved Shift Work
                {cardFilter === 'resolved' && (
                  <span className="text-[9px] font-mono bg-emerald-500 text-black px-1.5 py-0.2 rounded font-extrabold ml-1">
                    FILTER ACTIVE
                  </span>
                )}
              </span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>{kpis.completedTodayCount} Resolved</span>
                <span className="text-xs font-normal text-emerald-400 font-sans">Shift Goal: 20</span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] px-4 py-2.5 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation View Sub-Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752] overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveView('queue')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'queue'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span>Task Work Queue ({filteredTasks.length})</span>
          </button>

          <button
            onClick={() => setActiveView('scheduled')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'scheduled'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Calendar className="w-3.5 h-3.5 text-purple-400" />
            <span>Scheduled Maintenance Queue</span>
          </button>

          <button
            onClick={() => setActiveView('analytics')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'analytics'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Operator SLA Throughput</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[260px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Task Title, UPN, Ticket..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] rounded pl-8 pr-7 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a919e] hover:text-[#e0e2ea]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Priority Level Dropdown */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Priority: All</option>
            <option value="critical">Critical 🔴</option>
            <option value="high">High 🟠</option>
            <option value="medium">Medium 🟡</option>
            <option value="low">Low 🔵</option>
          </select>

          {/* Task Source Dropdown */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Source: All</option>
            <option value="alert">Drift Alert Engine</option>
            <option value="sop">SOP Execution</option>
            <option value="scheduled">Scheduled Routine</option>
            <option value="psa">PSA Ticket Sync</option>
          </select>

          {/* Execution Type Dropdown */}
          <select
            value={executionTypeFilter}
            onChange={(e) => setExecutionTypeFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Type: All Execution</option>
            <option value="automated">1-Click Graph Action</option>
            <option value="manual">Manual Checklist</option>
            <option value="gated">Gated Senior Approval</option>
          </select>

          {(searchTerm || priorityFilter !== 'ALL' || sourceFilter !== 'ALL' || executionTypeFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setPriorityFilter('ALL');
                setSourceFilter('ALL');
                setExecutionTypeFilter('ALL');
              }}
              className="text-[#8a919e] hover:text-red-400 px-2 py-1 flex items-center gap-1 font-mono text-[11px]"
            >
              <X className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN CONTENT VIEW */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden bg-[#090d16] p-4">
        
        {/* ======================================================================= */}
        {/* VIEW 1: SPLIT-PANE HIGH-DENSITY TASK WORKBENCH (60% QUEUE | 40% INSPECTOR) */}
        {/* ======================================================================= */}
        {activeView === 'queue' && (
          <div className="w-full h-full flex gap-4 overflow-hidden">
            
            {/* FULL WIDTH TASK QUEUE TABLE */}
            <div className="w-full bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
              
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs shrink-0">
                <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-[#a3c9ff]" />
                  <span>NOC Operational Work Queue ({filteredTasks.length} Work Items)</span>
                </span>
                <span className="hidden sm:inline text-amber-300 font-semibold text-[11px]">⚡ Click any task row to launch Remediation & Execution Wizard</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] sticky top-0 border-b border-[#404752] z-10">
                    <tr>
                      <th className="p-3">Priority &amp; Task Code</th>
                      <th className="p-3">Task Title &amp; Target Tenant</th>
                      <th className="p-3">SLA Countdown</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Assignee</th>
                      <th className="p-3 text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40 font-mono text-[11.5px]">
                    {filteredTasks.map(task => {
                      const isSelected = task.id === selectedTaskId;

                      let prioBadge = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
                      if (task.priority === 'medium') prioBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
                      if (task.priority === 'high') prioBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/50';
                      if (task.priority === 'critical') prioBadge = 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse';

                      return (
                        <tr
                          key={task.id}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            handleOpenWizard(task);
                          }}
                          className={cn(
                            "hover:bg-[#181c22] transition-colors cursor-pointer",
                            isSelected ? "bg-[#1a212d]" : "",
                            task.status === 'completed' ? "opacity-60" : ""
                          )}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className={cn("px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border", prioBadge)}>
                                {task.priority}
                              </span>
                              <span className="font-mono text-[11px] text-[#8a919e]">{task.taskCode}</span>
                            </div>
                          </td>

                          <td className="p-3 font-sans">
                            <div className="font-bold text-[#f0f4f8] line-clamp-1">{task.title}</div>
                            <div className="text-[11px] font-mono text-[#8a919e] flex items-center gap-1 mt-0.5">
                              <Building2 className="w-3 h-3 text-[#a3c9ff]" />
                              <span>{task.tenantName}</span>
                              <span className="text-[#404752]">&bull;</span>
                              <span className="text-[#a3c9ff] truncate max-w-[200px]">{task.targetResource}</span>
                            </div>
                          </td>

                          <td className="p-3">
                            <SlaTimerPill
                              minutesRemaining={Math.floor(task.remainingSeconds / 60)}
                              slaTier={task.slaTier || 'Platinum 15m'}
                              isClaimed={!!task.assignedTo}
                              claimedBy={task.assignedTo}
                              onClaimAndWork={() => handleClaimTask(task.id)}
                            />
                          </td>

                          <td className="p-3">
                            {task.executionType === 'automated' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30 flex items-center gap-1 w-fit">
                                <Zap className="w-3 h-3" />
                                <span>1-CLICK</span>
                              </span>
                            )}
                            {task.executionType === 'gated' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-fit">
                                <Lock className="w-3 h-3" />
                                <span>GATED</span>
                              </span>
                            )}
                            {task.executionType === 'manual' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-blue-300 border border-blue-500/30 flex items-center gap-1 w-fit">
                                <CheckSquare className="w-3 h-3" />
                                <span>MANUAL</span>
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-[#8a919e] font-mono text-[11px]">
                            {task.assignedTo ? (
                              <span className="text-[#f0f4f8] font-semibold">{task.assignedTo}</span>
                            ) : (
                              <span className="text-amber-400 font-bold italic">Unassigned</span>
                            )}
                          </td>

                          <td className="p-3 text-right">
                            {task.status === 'completed' ? (
                              <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center justify-end gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Resolved</span>
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTaskId(task.id);
                                  handleOpenWizard(task);
                                }}
                                className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-[11px] font-mono font-bold flex items-center gap-1 ml-auto"
                              >
                                <Zap className="w-3 h-3" />
                                <span>Fix / Wizard</span>
                              </button>
                            )}
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT PANE (REMOVED IN FAVOR OF WIZARD MODAL) */}
            {false && selectedTask && (
              <div className="hidden lg:flex flex-col w-[40%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-2xl">
                
                {/* Inspector Header */}
                <div className="p-3.5 bg-[#181c22] border-b border-[#404752] flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30">
                        {selectedTask.taskCode}
                      </span>
                      <span className="text-xs font-mono text-[#8a919e]">{selectedTask.psaTicketId}</span>
                    </div>
                    <h3 className="text-xs font-bold text-[#f0f4f8] mt-1 leading-snug">
                      {selectedTask.title}
                    </h3>
                  </div>

                  {!selectedTask.assignedTo ? (
                    <button
                      onClick={() => handleClaimTask(selectedTask.id)}
                      className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-xs font-bold font-mono"
                    >
                      Claim Task
                    </button>
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-1 bg-[#181c22] border border-[#404752] text-[#a3c9ff] rounded font-bold">
                      {selectedTask.assignedTo}
                    </span>
                  )}
                </div>

                {/* Inspector Scroll Workspace */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  
                  {/* SECTION A: TASK CONTEXT & THREAT TELEMETRY */}
                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[#8a919e]">
                      <span>Target Tenant: <strong className="text-[#f0f4f8]">{selectedTask.tenantName}</strong></span>
                      <span className="text-purple-300 font-bold">{selectedTask.slaTier}</span>
                    </div>

                    <div className="bg-[#101419] p-2.5 rounded border border-[#404752] space-y-1">
                      <div className="text-[11px] font-bold text-[#a3c9ff] flex items-center gap-1.5">
                        <TargetIcon className="w-3.5 h-3.5 text-purple-400" />
                        <span>Target UPN / Resource: {selectedTask.targetResource}</span>
                      </div>
                      <p className="text-xs text-[#8a919e] leading-relaxed">
                        {selectedTask.description}
                      </p>
                    </div>

                    {selectedTask.recommendedAction && (
                      <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded text-[11px] text-[#a3c9ff] flex items-start gap-2">
                        <Sparkles className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
                        <div>
                          <strong className="block text-white font-mono">Recommended Resolution Path:</strong>
                          <span>{selectedTask.recommendedAction}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SECTION B: INTERACTIVE CHECKLIST / AUTOMATED EXECUTION */}
                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                        <span>Execution &amp; Verification Protocol</span>
                      </span>
                      <span className="text-[10px] text-[#8a919e]">{selectedTask.executionType.toUpperCase()}</span>
                    </div>

                    {/* Step Checklists */}
                    {selectedTask.checklists.length > 0 && (
                      <div className="space-y-2">
                        {selectedTask.checklists.map(item => (
                          <label
                            key={item.id}
                            className="flex items-start gap-2.5 p-2 bg-[#101419] border border-[#404752] rounded hover:border-[#606a7a] cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={item.done}
                              onChange={() => handleToggleChecklist(selectedTask.id, item.id)}
                              className="mt-0.5 accent-[#0078d4]"
                            />
                            <span className={cn("text-xs leading-snug", item.done ? "line-through text-[#8a919e]" : "text-[#e0e2ea]")}>
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Scope Creep & Out-of-Contract Service Banner */}
                    <ScopeCreepAlertBanner
                      isOutOfScope={selectedTask.priority === 'critical' || selectedTask.source === 'alert'}
                      outOfScopeReason={`Task ${selectedTask.taskCode} execution on ${selectedTask.tenantName} exceeds baseline maintenance tier scope.`}
                      upgradeEstimate="$250.00 Ad-Hoc Micro-Tx OR +$4.00/seat Gold Upgrade"
                      tenantName={selectedTask.tenantName}
                      onGenerateMicroTx={() => {
                        toast('success', 'Micro-Tx Generated', `$250.00 Ad-Hoc fee charged for ${selectedTask.tenantName}.`);
                      }}
                      onPushToPipeline={() => {
                        toast('success', 'Proposal Pushed', `Gold Upgrade proposal pushed to Offer Pipeline.`);
                      }}
                    />

                    {/* DUAL PATH RESOLUTION ACTION BAR */}
                    <div className="bg-[#101419] border border-[#404752] rounded-lg p-3 space-y-2 font-sans">
                      <div className="text-[11px] font-bold text-[#a3c9ff] uppercase tracking-wider font-mono flex items-center justify-between">
                        <span>Operational Decision Gate:</span>
                        <span className="text-slate-400 font-normal">Select Resolution Path</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => handleOpenWizard(selectedTask)}
                          className="p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 font-bold text-xs flex items-center justify-between transition cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-emerald-400" />
                            Fix Risk / Launch Wizard
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
                        </button>

                        <button
                          onClick={() => setIsRbdModalOpen(true)}
                          className="p-2.5 rounded-lg border border-red-500/40 bg-red-950/30 hover:bg-red-900/40 text-red-300 font-bold text-xs flex items-center justify-between transition cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                            Accept Risk / RBD
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>

                    {/* Embedded SOP Runbook Runner */}
                    <EmbeddedSopRunner
                      sopCode={`SOP-${selectedTask.taskCode.slice(0, 3).toUpperCase()}-04`}
                      sopTitle={`Standard Operating Procedure: ${selectedTask.title}`}
                      onExecuteAll={() => {
                        handleExecuteGraphAction();
                        toast('success', 'SOP Steps Applied', `Completed runbook steps for task ${selectedTask.taskCode}.`);
                      }}
                    />

                    {/* AI REMEDIATION COPILOT EMBEDDED DRAWER */}
                    {selectedTask.graphEndpoint && (
                      <AiRemediationCopilot
                        title={`Remediation for ${selectedTask.title}`}
                        rootCause={selectedTask.description}
                        impactAssessment={{
                          usersAffected: selectedTask.priority === 'critical' ? 42 : 8,
                          devicesAffected: selectedTask.priority === 'critical' ? 12 : 2,
                          description: 'Calculated identity blast radius based on Entra ID directory graph analysis.'
                        }}
                        remediationPayload={{
                          action: selectedTask.actionId || 'remediate_policy_drift',
                          targetResource: selectedTask.targetResource,
                          tenantId: selectedTask.tenantId,
                          graphEndpoint: selectedTask.graphEndpoint,
                          executionMode: selectedTask.executionType
                        }}
                        targetEndpoint={selectedTask.graphEndpoint}
                        tenantName={selectedTask.tenantName}
                        onExecuteRemediation={(ticketRef, justification) => {
                          handleExecuteGraphAction();
                          toast('success', 'AI Remediation Executed', `Logged under change ref #${ticketRef}: ${justification}`);
                        }}
                      />
                    )}
                  </div>

                  {/* COMMERCIAL UPSELL MONETIZATION OPPORTUNITY */}
                  {(selectedTask.priority === 'critical' || selectedTask.source === 'alert') && (
                    <CommercialUpsellBanner
                      tenantName={selectedTask.tenantName}
                      tenantId={selectedTask.tenantId}
                      detectedProblem={`Repeated security policy drift and elevated SLA risk detected during ${selectedTask.taskCode}.`}
                      recommendedPackageName="Gold Secured Workplace"
                      pricePerSeatMonth={4.00}
                      estimatedSeats={65}
                      onPushToOfferPipeline={(tName, pkg, mrr) => {
                        toast('success', 'Proposal Created', `Pushed ${pkg} (+ $${mrr}/mo MRR) for ${tName} into Offer Pipeline.`);
                      }}
                      onSendQuoteToClientAdmin={(tName, pkg, mrr) => {
                        toast('info', 'Quote Sent', `Sent proposal for ${pkg} ($${mrr}/mo) to ${tName} primary client admin.`);
                      }}
                    />
                  )}

                  {/* SECTION C: AUDIT TRAIL & ACTIVITY NOTES */}
                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-3">
                    <h4 className="font-mono text-xs font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-blue-400" />
                      <span>Audit Trail &amp; Work Notes ({selectedTask.activityTrail.length})</span>
                    </h4>

                    {/* Timeline Log */}
                    <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                      {selectedTask.activityTrail.map(note => (
                        <div key={note.id} className="p-2 bg-[#101419] border border-[#404752] rounded text-[11px] space-y-0.5">
                          <div className="flex justify-between font-mono text-[#8a919e]">
                            <span className="font-bold text-[#a3c9ff]">{note.actor}</span>
                            <span>{note.timestamp}</span>
                          </div>
                          <p className="text-[#e0e2ea]">{note.note}</p>
                        </div>
                      ))}
                    </div>

                    {/* Add Work Note Input */}
                    <div className="space-y-2 pt-2 border-t border-[#404752]">
                      <textarea
                        rows={2}
                        placeholder="Log technician notes or troubleshooting context..."
                        value={workNoteInput}
                        onChange={(e) => setWorkNoteInput(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                      />

                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => handleAddNote(false)}
                          className="px-3 py-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-xs font-mono font-semibold text-[#a3c9ff] rounded"
                        >
                          + Log Note
                        </button>

                        <button
                          onClick={() => handleAddNote(true)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold rounded flex items-center gap-1 shadow-md"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Mark Complete &amp; Close Ticket</span>
                        </button>
                      </div>
                    </div>

                  </div>

                </div>

              </div>
            )}

          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 2: SCHEDULED MAINTENANCE & RECURRING QUEUE */}
        {/* ======================================================================= */}
        {activeView === 'scheduled' && (
          <div className="w-full h-full max-w-5xl mx-auto space-y-4 overflow-y-auto pr-1">
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-[#f0f4f8] flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-400" />
                    <span>Scheduled Maintenance Routine Runbooks</span>
                  </h2>
                  <p className="text-xs text-[#8a919e]">
                    Automated recurring operational tasks generated based on client MSP service level agreements.
                  </p>
                </div>

                <button
                  onClick={() => toast('info', 'Schedule Created', 'Added new recurring maintenance runbook.')}
                  className="px-3 py-1.5 bg-[#0078d4] text-white text-xs font-bold rounded flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Scheduled Task</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {tasks.filter(t => t.source === 'scheduled').map(task => (
                  <div key={task.id} className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-[#f0f4f8]">{task.title}</span>
                      <span className="font-mono text-purple-300">{task.slaDeadline}</span>
                    </div>
                    <p className="text-xs text-[#8a919e]">{task.description}</p>
                    <div className="pt-2 border-t border-[#404752] flex justify-between items-center text-xs font-mono">
                      <span className="text-[#a3c9ff]">{task.tenantName}</span>
                      <button
                        onClick={() => { setSelectedTaskId(task.id); setActiveView('queue'); }}
                        className="text-[#0078d4] hover:underline flex items-center gap-1"
                      >
                        <span>Open Task</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 3: OPERATOR SLA & WORKLOAD ANALYTICS */}
        {/* ======================================================================= */}
        {activeView === 'analytics' && (
          <div className="w-full h-full max-w-5xl mx-auto space-y-4 overflow-y-auto pr-1">
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-4 shadow-xl">
              <h2 className="text-sm font-bold text-[#f0f4f8] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span>NOC Operator Throughput &amp; SLA Compliance Metrics</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg text-center space-y-1">
                  <span className="text-xs text-[#8a919e] font-mono uppercase">Mean Time To Resolution (MTTR)</span>
                  <div className="text-3xl font-extrabold font-mono text-emerald-400">12.4m</div>
                  <span className="text-[11px] text-emerald-400">Target: &lt;15m (100% SLA)</span>
                </div>

                <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg text-center space-y-1">
                  <span className="text-xs text-[#8a919e] font-mono uppercase">Shift Auto-Remediation Rate</span>
                  <div className="text-3xl font-extrabold font-mono text-purple-400">74.2%</div>
                  <span className="text-[11px] text-[#8a919e]">1-Click Graph API Payload Usage</span>
                </div>

                <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg text-center space-y-1">
                  <span className="text-xs text-[#8a919e] font-mono uppercase">First-Touch Resolution (FTR)</span>
                  <div className="text-3xl font-extrabold font-mono text-[#a3c9ff]">91.8%</div>
                  <span className="text-[11px] text-[#a3c9ff]">No Escalation Needed</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* RBD ACCEPTANCE & RULE LINKING MODAL */}
      {selectedTask && (
        <RbdAcceptanceAndRuleLinker
          isOpen={isRbdModalOpen}
          alertPayload={{
            alertId: selectedTask.id,
            tenantId: selectedTask.tenantId,
            tenantName: selectedTask.tenantName,
            riskNotificationType: `${selectedTask.taskCode.toUpperCase()}_POLICY_EXEMPTION`,
            targetResource: selectedTask.targetResource || selectedTask.tenantName,
            severity: selectedTask.priority === 'critical' ? 'critical' : selectedTask.priority === 'high' ? 'high' : 'medium',
            title: selectedTask.title,
          }}
          onClose={() => setIsRbdModalOpen(false)}
          onConfirmRbd={handleConfirmTaskRbd}
        />
      )}

      {/* 3-PANEL ALERT RESOLUTION WIZARD MODAL */}
      <AlertResolutionWizardModal
        isOpen={isWizardOpen}
        wizardMode="operator_task"
        alert={activeWizardTask ? {
          id: activeWizardTask.id,
          code: activeWizardTask.taskCode,
          title: activeWizardTask.title,
          tenantId: activeWizardTask.tenantId,
          tenantName: activeWizardTask.tenantName,
          category: activeWizardTask.source.toUpperCase(),
          severity: activeWizardTask.priority === 'critical' ? 'critical' : activeWizardTask.priority === 'high' ? 'high' : 'medium',
          targetResource: activeWizardTask.targetResource,
          description: activeWizardTask.description,
          graphEndpoint: activeWizardTask.graphEndpoint || undefined,
          rootCauseAnalysis: activeWizardTask.description,
          taskSource: activeWizardTask.source,
          executionType: activeWizardTask.executionType,
          assignedTo: activeWizardTask.assignedTo,
          psaTicketId: activeWizardTask.psaTicketId,
          checklists: activeWizardTask.checklists,
          activityTrail: activeWizardTask.activityTrail,
          remainingSeconds: activeWizardTask.remainingSeconds,
        } : null}
        onClose={() => setIsWizardOpen(false)}
        onToggleChecklist={(taskId, chkId) => {
          setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
              return {
                ...t,
                checklists: t.checklists.map(c => c.id === chkId ? { ...c, done: !c.done } : c)
              };
            }
            return t;
          }));
        }}
        onAddWorkNote={(taskId, note) => {
          setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
              return {
                ...t,
                activityTrail: [
                  ...t.activityTrail,
                  { id: `note-${Date.now()}`, timestamp: 'Just now', actor: 'Shane McCaw', note }
                ]
              };
            }
            return t;
          }));
          toast('success', 'Technician Work Note Logged', `Added note to task ${taskId} and synced with PSA Ticket ${activeWizardTask?.psaTicketId || 'CW-89102'}.`);
        }}
        onReassignTask={(taskId, newAssignee) => {
          setTasks(prev => prev.map(t => t.id === taskId ? { ...t, assignedTo: newAssignee === 'Unassigned' ? null : newAssignee } : t));
          toast('info', 'Operator Reassigned', `Task ${taskId} assigned to ${newAssignee}.`);
        }}
        onRemediateSuccess={(alertId) => {
          setTasks(prev => prev.map(t => t.id === alertId ? { ...t, status: 'completed' } : t));
          toast('success', 'Operator Task Dispatched', `Task ${alertId} completed and Graph API payload deployed.`);
        }}
        onAcceptRbdSuccess={(alertId, record) => {
          setTasks(prev => prev.map(t => t.id === alertId ? { ...t, status: 'completed' } : t));
          toast('success', 'RBD Waiver Linked', `Risk waiver ${record.rbdCode} linked to task ${alertId}.`);
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

// Target Icon Helper Component
function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
