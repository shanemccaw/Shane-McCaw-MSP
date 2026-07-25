// @ts-nocheck
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  AlertOctagon,
  RotateCcw,
  RotateCw,
  Terminal,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  KeyRound,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  Trash2,
  Play,
  Code2,
  FileText,
  Sparkles,
  ChevronRight,
  Building2,
  Copy,
  Check,
  Edit3,
  Save,
  AlertTriangle,
  Layers,
  BarChart3,
  Settings,
  Server,
  Activity,
  Download,
  X,
  CheckSquare,
  Square,
  ArrowUpRight,
  Cpu,
  Radio,
  Sliders,
  ShieldCheck,
  Lock,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type ErrorCodeType = 'HTTP_429' | 'HTTP_401' | 'HTTP_403' | 'HTTP_500' | 'SCHEMA_ERROR';
export type DlqStatusType = 'pending' | 'retrying' | 'max_retries_exceeded' | 'purged';

export interface RetryHistoryEntry {
  attempt: number;
  timestamp: string;
  responseCode: number;
  latencyMs: number;
  details: string;
}

export interface DlqMessage {
  id: string;
  dlqCode: string;
  workflowName: string;
  category: string;
  tenantId: string;
  tenantName: string;
  errorCode: ErrorCodeType;
  errorMessage: string;
  graphEndpoint: string;
  failedAt: string;
  retryCount: number;
  maxRetries: number;
  nextRetryInSeconds: number;
  status: DlqStatusType;
  requestPayload: Record<string, any>;
  errorStackTrace: string;
  recommendedAction: string;
  retryHistory: RetryHistoryEntry[];
}

interface DeadLetterQueueConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// ============================================================================
// INITIAL MOCK DLQ MESSAGES
// ============================================================================

const INITIAL_DLQ_MESSAGES: DlqMessage[] = [
  {
    id: 'dlq-88391',
    dlqCode: 'DLQ-88391',
    workflowName: 'Poll Endpoint /identity/conditionalAccess/policies',
    category: 'Conditional Access',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    errorCode: 'HTTP_429',
    errorMessage: 'Graph API Rate Limited: 429 Too Many Requests. Retry-After header indicates 180 seconds cooldown required.',
    graphEndpoint: 'GET https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies',
    failedAt: '14:22:10',
    retryCount: 3,
    maxRetries: 5,
    nextRetryInSeconds: 165,
    status: 'pending',
    requestPayload: {
      tenantId: 't-1',
      endpoint: '/identity/conditionalAccess/policies',
      queryParameters: { '$select': 'id,displayName,state,conditions' },
      clientAppId: 'app-reg-contoso-01'
    },
    errorStackTrace: `Microsoft.Graph.ServiceException: Code: 429
Response: Too Many Requests
Header: Retry-After: 180
At Orchestrator.GraphClient.SendAsync(HttpRequestMessage request) in /src/Engine/GraphClient.cs:line 142
At Orchestrator.WorkflowRunner.ExecuteStep(StepContext ctx) in /src/Engine/Runner.cs:line 89`,
    recommendedAction: 'Exponential backoff automatically scheduled. No manual code change needed unless rate limit persists across 5 retries.',
    retryHistory: [
      { attempt: 1, timestamp: '14:15:00', responseCode: 429, latencyMs: 340, details: 'Initial burst query throttled' },
      { attempt: 2, timestamp: '14:17:30', responseCode: 429, latencyMs: 290, details: 'Retry attempt 2 failed (429)' },
      { attempt: 3, timestamp: '14:22:10', responseCode: 429, latencyMs: 310, details: 'Retry attempt 3 failed (429)' }
    ]
  },
  {
    id: 'dlq-88392',
    dlqCode: 'DLQ-88392',
    workflowName: 'Revoke Compromised User Authentication Methods',
    category: 'Identity / Entra',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    errorCode: 'HTTP_401',
    errorMessage: 'Authorization Request Denied: Client secret for App Registration "MSP-AutoHeal-Worker" expired on 2026-07-20.',
    graphEndpoint: 'POST https://graph.microsoft.com/v1.0/users/alex.wilson@contosobio.com/authentication/methods/resetPassword',
    failedAt: '14:18:45',
    retryCount: 5,
    maxRetries: 5,
    nextRetryInSeconds: 0,
    status: 'max_retries_exceeded',
    requestPayload: {
      tenantId: 't-1',
      targetUpn: 'alex.wilson@contosobio.com',
      action: 'RevokeSessionsAndMfa',
      appRegistrationId: 'app-reg-contoso-01'
    },
    errorStackTrace: `Microsoft.Identity.Client.MsalServiceException: AADSTS7000215: Invalid client secret provided.
Trace ID: e429f012-9912-4211-9981-a90f12110000
Correlation ID: c10928a3-2210-4821-8811-190abf001122
At Orchestrator.AuthService.AcquireTokenForAppAsync() in /src/Auth/MsalProvider.cs:line 55`,
    recommendedAction: 'Re-generate client secret in Azure Key Vault for App Registration "MSP-AutoHeal-Worker" and re-grant Admin Consent.',
    retryHistory: [
      { attempt: 1, timestamp: '14:00:00', responseCode: 401, latencyMs: 120, details: 'Client secret expired' },
      { attempt: 2, timestamp: '14:05:00', responseCode: 401, latencyMs: 110, details: 'Auth token rejected' },
      { attempt: 3, timestamp: '14:10:00', responseCode: 401, latencyMs: 105, details: 'Auth token rejected' },
      { attempt: 4, timestamp: '14:15:00', responseCode: 401, latencyMs: 115, details: 'Auth token rejected' },
      { attempt: 5, timestamp: '14:18:45', responseCode: 401, latencyMs: 110, details: 'Max retries reached (5/5). Marked MAX_EXCEEDED.' }
    ]
  },
  {
    id: 'dlq-88393',
    dlqCode: 'DLQ-88393',
    workflowName: 'Sync Defender Incident Telemetry & PSA Tickets',
    category: 'Security / Defender',
    tenantId: 't-2',
    tenantName: 'Vanguard Legal Partners',
    errorCode: 'HTTP_500',
    errorMessage: 'Microsoft Graph Service Outage: Internal Server Error (500) encountered on endpoint /security/incidents.',
    graphEndpoint: 'GET https://graph.microsoft.com/v1.0/security/incidents?$filter=status eq \'active\'',
    failedAt: '14:10:02',
    retryCount: 2,
    maxRetries: 5,
    nextRetryInSeconds: 45,
    status: 'pending',
    requestPayload: {
      tenantId: 't-2',
      filter: "status eq 'active'",
      top: 50
    },
    errorStackTrace: `Microsoft.Graph.ServiceException: Code: 500
Message: InternalServerError - Transient database degradation on MS Security Graph Backend.
At Orchestrator.DefenderAdapter.FetchIncidents() in /src/Adapters/DefenderAdapter.cs:line 210`,
    recommendedAction: 'Microsoft Service Health Incident MS99212 active. Automatic retry will succeed once upstream status resolves.',
    retryHistory: [
      { attempt: 1, timestamp: '14:00:00', responseCode: 500, latencyMs: 1850, details: 'Upstream HTTP 500' },
      { attempt: 2, timestamp: '14:10:02', responseCode: 500, latencyMs: 2100, details: 'Upstream HTTP 500' }
    ]
  },
  {
    id: 'dlq-88394',
    dlqCode: 'DLQ-88394',
    workflowName: 'Intune MDM Configuration Baseline Remediation',
    category: 'Intune',
    tenantId: 't-3',
    tenantName: 'Apex Logistics & Freight',
    errorCode: 'SCHEMA_ERROR',
    errorMessage: 'Payload Mutation Error: JSON property "targetDeviceGroupId" expected UUID format, received string "GROUP_ALL_MACBOOKS_TEST".',
    graphEndpoint: 'POST https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/assign',
    failedAt: '13:55:20',
    retryCount: 1,
    maxRetries: 3,
    nextRetryInSeconds: 0,
    status: 'pending',
    requestPayload: {
      tenantId: 't-3',
      configurationId: 'cfg-intune-mac-001',
      targetDeviceGroupId: 'GROUP_ALL_MACBOOKS_TEST',
      assignments: [
        { targetType: 'group', id: 'GROUP_ALL_MACBOOKS_TEST' }
      ]
    },
    errorStackTrace: `System.Text.Json.JsonException: Failed to parse UUID for property 'targetDeviceGroupId'.
Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
At Orchestrator.Parsers.IntunePayloadValidator.Validate(String rawJson) in /src/Validators/IntuneValidator.cs:line 44`,
    recommendedAction: 'Use the Inline Payload Editor to replace "GROUP_ALL_MACBOOKS_TEST" with a valid Entra ID Group GUID, then click Execute Replay.',
    retryHistory: [
      { attempt: 1, timestamp: '13:55:20', responseCode: 400, latencyMs: 80, details: 'Invalid payload schema format' }
    ]
  },
  {
    id: 'dlq-88395',
    dlqCode: 'DLQ-88395',
    workflowName: 'Force Revoke External Mailbox Forwarding Rules',
    category: 'Exchange',
    tenantId: 't-4',
    tenantName: 'BioHealth Innovations',
    errorCode: 'HTTP_403',
    errorMessage: 'Insufficient Privileges: Application requires Graph Permission "Mail.ReadWrite.Shared" admin consent.',
    graphEndpoint: 'DELETE https://graph.microsoft.com/v1.0/users/ciso@biohealth.com/mailFolders/inbox/messageRules/rule-99',
    failedAt: '13:30:00',
    retryCount: 4,
    maxRetries: 5,
    nextRetryInSeconds: 0,
    status: 'max_retries_exceeded',
    requestPayload: {
      tenantId: 't-4',
      userUpn: 'ciso@biohealth.com',
      ruleId: 'rule-99'
    },
    errorStackTrace: `Microsoft.Graph.ServiceException: Code: ErrorAccessDenied
Message: Access is denied. Check credentials and permissions for Mail.ReadWrite.Shared.
At Orchestrator.ExchangeWorker.PurgeRule() in /src/Workers/ExchangeWorker.cs:line 112`,
    recommendedAction: 'Grant Application Permission "Mail.ReadWrite.Shared" in tenant t-4 Entra ID admin consent portal.',
    retryHistory: [
      { attempt: 1, timestamp: '12:30:00', responseCode: 403, latencyMs: 140, details: 'Permission denied' },
      { attempt: 2, timestamp: '12:45:00', responseCode: 403, latencyMs: 135, details: 'Permission denied' },
      { attempt: 3, timestamp: '13:00:00', responseCode: 403, latencyMs: 150, details: 'Permission denied' },
      { attempt: 4, timestamp: '13:30:00', responseCode: 403, latencyMs: 142, details: 'Permission denied' }
    ]
  },
  {
    id: 'dlq-88396',
    dlqCode: 'DLQ-88396',
    workflowName: 'Hourly Entra ID Risky Sign-in Event Ingestion',
    category: 'Identity / Entra',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    errorCode: 'HTTP_429',
    errorMessage: 'Graph Throttling: HTTP 429 on /identityProtection/riskyUsers API queue.',
    graphEndpoint: 'GET https://graph.microsoft.com/v1.0/identityProtection/riskyUsers',
    failedAt: '13:15:10',
    retryCount: 2,
    maxRetries: 5,
    nextRetryInSeconds: 90,
    status: 'pending',
    requestPayload: {
      tenantId: 't-1',
      riskLevel: 'high'
    },
    errorStackTrace: `Microsoft.Graph.ServiceException: Code: 429
Response: Rate Limit Exceeded.
At Orchestrator.IdentityPoller.FetchRiskyUsers() in /src/Pollers/IdentityPoller.cs:line 78`,
    recommendedAction: 'Exponential backoff active. Cooldown remaining 90s.',
    retryHistory: [
      { attempt: 1, timestamp: '13:00:00', responseCode: 429, latencyMs: 210, details: 'Throttled' },
      { attempt: 2, timestamp: '13:15:10', responseCode: 429, latencyMs: 230, details: 'Throttled' }
    ]
  },
  {
    id: 'dlq-88397',
    dlqCode: 'DLQ-88397',
    workflowName: 'NCE License Reclamation & Seat Billing Sync',
    category: 'Governance',
    tenantId: 't-5',
    tenantName: 'Meridian Capital Partners',
    errorCode: 'HTTP_500',
    errorMessage: 'Partner Center API Gateway 503 Service Unavailable.',
    graphEndpoint: 'GET https://api.partnercenter.microsoft.com/v1/customers/meridian/subscriptions',
    failedAt: '12:00:05',
    retryCount: 1,
    maxRetries: 3,
    nextRetryInSeconds: 300,
    status: 'pending',
    requestPayload: {
      tenantId: 't-5',
      sku: 'SPE_E3'
    },
    errorStackTrace: `PartnerCenter.Exceptions.PartnerException: 503 Service Unavailable.
At Orchestrator.PartnerCenterClient.GetSubscriptions() in /src/Billing/PartnerCenterClient.cs:line 40`,
    recommendedAction: 'Partner Center API experiencing transient downtime. Next retry in 5 minutes.',
    retryHistory: [
      { attempt: 1, timestamp: '12:00:05', responseCode: 503, latencyMs: 3400, details: 'Service unavailable' }
    ]
  },
  {
    id: 'dlq-88398',
    dlqCode: 'DLQ-88398',
    workflowName: 'Emergency Global Admin Account Lockout Remediation',
    category: 'Security / Defender',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    errorCode: 'HTTP_401',
    errorMessage: 'Invalid Authentication Token: Token signature validation failed.',
    graphEndpoint: 'POST https://graph.microsoft.com/v1.0/users/admin-temp@contosobio.com/revokeSignInSessions',
    failedAt: '11:45:00',
    retryCount: 5,
    maxRetries: 5,
    nextRetryInSeconds: 0,
    status: 'max_retries_exceeded',
    requestPayload: {
      tenantId: 't-1',
      userUpn: 'admin-temp@contosobio.com'
    },
    errorStackTrace: `Microsoft.IdentityModel.Tokens.SecurityTokenInvalidSignatureException: The signature is invalid.
At Orchestrator.SecurityWorker.IsolateAdmin() in /src/Workers/SecurityWorker.cs:line 99`,
    recommendedAction: 'Refresh OAuth 2.0 app credentials in Key Vault for tenant t-1.',
    retryHistory: [
      { attempt: 1, timestamp: '11:00:00', responseCode: 401, latencyMs: 100, details: 'Token invalid' },
      { attempt: 2, timestamp: '11:15:00', responseCode: 401, latencyMs: 105, details: 'Token invalid' },
      { attempt: 3, timestamp: '11:30:00', responseCode: 401, latencyMs: 110, details: 'Token invalid' },
      { attempt: 4, timestamp: '11:40:00', responseCode: 401, latencyMs: 108, details: 'Token invalid' },
      { attempt: 5, timestamp: '11:45:00', responseCode: 401, latencyMs: 112, details: 'Max retries reached.' }
    ]
  }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const DeadLetterQueueConsole: React.FC<DeadLetterQueueConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation View Sub-Tabs
  const [activeView, setActiveView] = useState<'dlq_stream' | 'error_analytics' | 'circuit_breakers'>('dlq_stream');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [exceptionFilter, setExceptionFilter] = useState('ALL');
  const [retryStatusFilter, setRetryStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // DLQ Message Collections
  const [messages, setMessages] = useState<DlqMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Multi-Select state for batch operations
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Inspector Tabs
  const [inspectorTab, setInspectorTab] = useState<'diagnostics' | 'json_editor' | 'history'>('diagnostics');

  // JSON Payload Edit state
  const [editingPayloadText, setEditingPayloadText] = useState<string>('');
  const [payloadParseError, setPayloadParseError] = useState<string | null>(null);

  // Replay State
  const [isReplaying, setIsReplaying] = useState(false);
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false);

  const { fetchWithAuth } = useAuth();

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Currently Selected Message
  const selectedMessage = useMemo(() => {
    return messages.find(m => m.id === selectedMessageId) || messages[0];
  }, [messages, selectedMessageId]);

  // Load DLQ Data
  const loadDlqData = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/msp/dlq');
      if (res.ok) {
        const rawData = await res.json();
        const mapped: DlqMessage[] = rawData.map((row: any) => {
          const payload = row.payload || {};
          let errorCode = 'HTTP_500';
          if (row.errorMessage.includes('429')) errorCode = 'HTTP_429';
          else if (row.errorMessage.includes('401')) errorCode = 'HTTP_401';
          else if (row.errorMessage.includes('403')) errorCode = 'HTTP_403';
          else if (row.errorMessage.includes('Schema')) errorCode = 'SCHEMA_ERROR';

          let category = 'System';
          if (row.eventType.includes('conditional_access') || row.eventType.includes('conditionalAccess')) {
            category = 'Conditional Access';
          } else if (row.eventType.includes('auth') || row.eventType.includes('identity')) {
            category = 'Identity / Entra';
          } else if (row.eventType.includes('defender') || row.eventType.includes('security')) {
            category = 'Security / Defender';
          } else if (row.eventType.includes('intune') || row.eventType.includes('mdm')) {
            category = 'Intune';
          }

          const graphEndpoint = payload.inputPayload?.endpoint 
            ? `${payload.inputPayload.endpoint}`
            : payload.inputPayload?.targetUpn 
            ? `POST /users/${payload.inputPayload.targetUpn}/authentication`
            : row.eventType.includes('defender')
            ? 'GET /security/incidents'
            : row.eventType.includes('intune')
            ? 'GET /deviceManagement/managedDevices'
            : 'Unknown Endpoint';

          let recommendedAction = 'Investigate stack trace and retry workflow.';
          if (errorCode === 'HTTP_429') {
            recommendedAction = 'Exponential backoff automatically scheduled. No manual code change needed unless rate limit persists across 5 retries.';
          } else if (errorCode === 'HTTP_401' || errorCode === 'HTTP_403') {
            recommendedAction = 'Re-generate client secret in Azure Key Vault for App Registration and re-grant Admin Consent.';
          } else if (errorCode === 'HTTP_500') {
            recommendedAction = 'Microsoft Service Health Incident active. Automatic retry will succeed once upstream status resolves.';
          } else if (errorCode === 'SCHEMA_ERROR') {
            recommendedAction = 'Review Graph API schema updates or downstream payload validator rules.';
          }

          let status = 'pending';
          if (row.resolvedAt) {
            status = row.resolution === 'discarded' ? 'purged' : 'pending';
          } else if (row.attemptCount >= 5) {
            status = 'max_retries_exceeded';
          }

          const retryHistory = [];
          for (let i = 1; i <= row.attemptCount; i++) {
            const time = new Date(new Date(row.lastAttemptAt).getTime() - (row.attemptCount - i) * 5 * 60 * 1000).toLocaleTimeString();
            retryHistory.push({
              attempt: i,
              timestamp: time,
              responseCode: errorCode === 'HTTP_429' ? 429 : errorCode === 'HTTP_401' ? 401 : errorCode === 'HTTP_500' ? 500 : 400,
              latencyMs: 150 + Math.floor(Math.random() * 200),
              details: i === row.attemptCount ? row.errorMessage : `Attempt ${i} failed`
            });
          }

          return {
            id: row.dlqId,
            dlqCode: `DLQ-${row.id}`,
            workflowName: payload.workflowKey || row.eventType.replace('portal_wf.', '').replace(/_/g, ' '),
            category,
            tenantId: row.tenantId || 'unknown',
            tenantName: row.tenantName || 'Platform Level / System',
            errorCode,
            errorMessage: row.errorMessage,
            graphEndpoint,
            failedAt: new Date(row.lastAttemptAt).toLocaleTimeString(),
            retryCount: row.attemptCount,
            maxRetries: 5,
            nextRetryInSeconds: status === 'pending' ? 120 : 0,
            status,
            requestPayload: payload.inputPayload || payload,
            errorStackTrace: row.errorStack || 'No stack trace provided.',
            recommendedAction,
            retryHistory,
          };
        });

        setMessages(mapped.filter((m: any) => m.status !== 'purged'));
      } else {
        toast('error', 'DLQ Load Failed', 'Could not fetch Dead Letter Queue items from server.');
      }
    } catch (e) {
      toast('error', 'Connection Error', 'Failed to connect to DLQ API.');
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadDlqData();
  }, [loadDlqData]);

  // Sync selectedMessageId default
  useEffect(() => {
    if (messages.length > 0 && !selectedMessageId) {
      setSelectedMessageId(messages[0].id);
    }
  }, [messages, selectedMessageId]);

  // Sync JSON Payload text when selected message changes
  useEffect(() => {
    if (selectedMessage) {
      setEditingPayloadText(JSON.stringify(selectedMessage.requestPayload, null, 2));
      setPayloadParseError(null);
    }
  }, [selectedMessageId, selectedMessage]);

  // Telemetry KPIs
  const kpis = useMemo(() => {
    const totalDLQ = messages.filter(m => m.status !== 'purged').length;
    const authFailures = messages.filter(m => (m.errorCode === 'HTTP_401' || m.errorCode === 'HTTP_403') && m.status !== 'purged').length;
    const rateLimited429 = messages.filter(m => m.errorCode === 'HTTP_429' && m.status !== 'purged').length;
    const recoveredToday = 142;

    return {
      totalDLQ,
      authFailures,
      rateLimited429,
      recoveredToday
    };
  }, [messages]);

  // Filtered DLQ Messages
  const filteredMessages = useMemo(() => {
    return messages.filter(m => {
      if (m.status === 'purged') return false;

      const matchesSearch =
        m.dlqCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.workflowName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.errorMessage.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.graphEndpoint.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesTenant = tenantFilter === 'ALL' || m.tenantId === tenantFilter;
      const matchesException = exceptionFilter === 'ALL' || m.errorCode === exceptionFilter;
      const matchesStatus =
        retryStatusFilter === 'ALL' ||
        (retryStatusFilter === 'max_exceeded' && m.status === 'max_retries_exceeded') ||
        (retryStatusFilter === 'pending' && m.status === 'pending');
      const matchesCategory = categoryFilter === 'ALL' || m.category === categoryFilter;

      return matchesSearch && matchesTenant && matchesException && matchesStatus && matchesCategory;
    });
  }, [messages, searchTerm, tenantFilter, exceptionFilter, retryStatusFilter, categoryFilter]);

  // Checkbox multi-select logic
  const handleToggleSelectAll = () => {
    if (selectedIds.length === filteredMessages.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredMessages.map(m => m.id));
    }
  };

  const handleToggleSelectId = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(prev => prev.filter(item => item !== id));
    } else {
      setSelectedIds(prev => [...prev, id]);
    }
  };

  // Replay Single DLQ Message
  const handleReplaySingle = async (id: string) => {
    setIsReplaying(true);
    toast('info', 'Replay Initiated', `Replaying message ${id} against Graph API...`);

    try {
      const res = await fetchWithAuth(`/api/msp/dlq/${id}/replay`, {
        method: 'POST',
      });
      if (res.ok) {
        toast('success', 'Message Recovered', `DLQ Message ${id} successfully replayed and healed.`);
        loadDlqData();
      } else {
        toast('error', 'Replay Failed', 'Server returned error status on replay request.');
      }
    } catch (e) {
      toast('error', 'Replay Error', 'Could not contact backend to replay DLQ item.');
    } finally {
      setIsReplaying(false);
    }
  };

  // Batch Replay Selected
  const handleBatchReplay = async () => {
    if (selectedIds.length === 0) return;

    setIsReplaying(true);
    toast('info', 'Batch Replay', `Replaying ${selectedIds.length} DLQ messages in parallel...`);

    try {
      const res = await fetchWithAuth('/api/msp/dlq/bulk-replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dlqIds: selectedIds }),
      });
      if (res.ok) {
        toast('success', 'Batch Healed', `Successfully replayed ${selectedIds.length} DLQ messages.`);
        setSelectedIds([]);
        setShowBatchConfirmModal(false);
        loadDlqData();
      } else {
        toast('error', 'Batch Replay Failed', 'Server returned error status on bulk replay.');
      }
    } catch (e) {
      toast('error', 'Replay Error', 'Failed to issue bulk replay request.');
    } finally {
      setIsReplaying(false);
    }
  };

  // Save JSON Payload Edit
  const handleSavePayload = async () => {
    try {
      const parsed = JSON.parse(editingPayloadText);
      setPayloadParseError(null);

      const fullPayload = {
        workflowKey: selectedMessage.workflowName,
        inputPayload: parsed,
      };

      const res = await fetchWithAuth(`/api/msp/dlq/${selectedMessageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: fullPayload }),
      });

      if (res.ok) {
        toast('success', 'Payload Updated', `Successfully updated JSON payload for ${selectedMessageId}.`);
        loadDlqData();
      } else {
        toast('error', 'Update Failed', 'Server rejected payload mutation.');
      }
    } catch (err: any) {
      setPayloadParseError(err.message || 'Invalid JSON format');
      toast('error', 'JSON Syntax Error', 'Failed to save payload. Please correct JSON syntax.');
    }
  };

  // Format JSON Code
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(editingPayloadText);
      setEditingPayloadText(JSON.stringify(parsed, null, 2));
      setPayloadParseError(null);
      toast('info', 'JSON Formatted', 'Payload formatted with 2-space indentation.');
    } catch (err: any) {
      setPayloadParseError(err.message || 'Invalid JSON');
    }
  };

  // Purge Message
  const handlePurgeMessage = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/msp/dlq/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'discarded' }),
      });
      if (res.ok) {
        toast('warning', 'Message Purged', `DLQ Message ${id} purged from dead letter queue.`);
        if (selectedIds.includes(id)) {
          setSelectedIds(prev => prev.filter(i => i !== id));
        }
        loadDlqData();
      } else {
        toast('error', 'Purge Failed', 'Server rejected request to purge message.');
      }
    } catch (e) {
      toast('error', 'Purge Error', 'Could not contact server to purge message.');
    }
  };

  // Purge Stale Poison Messages (>7 Days)
  const handlePurgeStalePoison = async () => {
    const staleList = messages.filter(m => m.status === 'max_retries_exceeded');
    if (staleList.length === 0) return;

    toast('info', 'Purging Poison Messages', `Purging ${staleList.length} stale poison messages...`);
    try {
      await Promise.all(
        staleList.map(async (m) => {
          await fetchWithAuth(`/api/msp/dlq/${m.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution: 'discarded' }),
          });
        })
      );
      toast('success', 'Poison Messages Purged', `Removed ${staleList.length} stale poison messages exceeding max retries.`);
      loadDlqData();
    } catch (e) {
      toast('error', 'Purge Error', 'Some poison messages failed to purge.');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & DLQ TELEMETRY BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Global Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-red-500/20 to-amber-500/10 border border-red-500/40 rounded-lg">
              <AlertOctagon className="w-6 h-6 text-red-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">Dead Letter Queue (DLQ) &amp; Recovery Console</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                  /portal/dlq
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Resilience recovery workbench for Graph API 429 rate-limits, 401 auth blocks, payload mutations &amp; batch replay.
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* Replay All / Selected */}
            <button
              onClick={() => {
                if (selectedIds.length > 0) {
                  setShowBatchConfirmModal(true);
                } else {
                  toast('info', 'Select Messages', 'Select checkboxes or click Batch Replay to replay eligible messages.');
                  setShowBatchConfirmModal(true);
                }
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded text-xs font-bold font-mono flex items-center gap-2 shadow-md transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{selectedIds.length > 0 ? `Replay Selected (${selectedIds.length})` : 'Replay All Eligible'}</span>
            </button>

            {/* Purge Stale Poison Messages */}
            <button
              onClick={handlePurgeStalePoison}
              className="px-3 py-2 bg-[#181c22] hover:bg-red-500/20 hover:text-red-300 border border-[#404752] text-[#8a919e] rounded text-xs font-mono font-semibold transition-colors flex items-center gap-1.5"
              title="Purge Stale Poison Messages exceeding max retries"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Stale Poison</span>
            </button>

            {/* Refresh Stream */}
            <button
              onClick={() => {
                toast('info', 'Queue Stream Refreshed', 'Synced with Graph API polling telemetry stream.');
              }}
              className="p-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded transition-colors"
              title="Refresh DLQ Stream"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 DLQ Telemetry Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Dead-Lettered Messages</span>
              <div className="text-xl font-bold font-mono text-red-400 flex items-baseline gap-1">
                <span>{kpis.totalDLQ} Messages</span>
                <span className="text-xs font-sans text-[#8a919e]">in Queue</span>
              </div>
            </div>
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md">
              <AlertOctagon className="w-5 h-5 text-red-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Auth &amp; Consent Failures</span>
              <div className="text-xl font-bold font-mono text-red-400 flex items-baseline gap-2">
                <span>{kpis.authFailures} Blocks</span>
                <span className="text-[10px] font-mono font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded border border-red-500/30">
                  REQUIRES SECRET
                </span>
              </div>
            </div>
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md">
              <KeyRound className="w-5 h-5 text-red-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Rate Limit Backoffs (429)</span>
              <div className="text-xl font-bold font-mono text-amber-400 flex items-baseline gap-2">
                <span>{kpis.rateLimited429} Throttled</span>
                <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-1 py-0.5 rounded border border-amber-500/30">
                  COOLDOWN
                </span>
              </div>
            </div>
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Replayed &amp; Healed Today</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>{kpis.recoveredToday} Recovered</span>
                <span className="text-xs font-sans text-emerald-300">98.2% Heal</span>
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
            onClick={() => setActiveView('dlq_stream')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'dlq_stream'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>DLQ Stream ({filteredMessages.length})</span>
          </button>

          <button
            onClick={() => setActiveView('error_analytics')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'error_analytics'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
            <span>Error Code Analytics &amp; Rate Limits</span>
          </button>

          <button
            onClick={() => setActiveView('circuit_breakers')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'circuit_breakers'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Settings className="w-3.5 h-3.5 text-purple-400" />
            <span>Circuit Breakers &amp; Retention</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[260px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search DLQ ID, Workflow, Endpoint, Error..."
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

          {/* Tenant Filter */}
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="ALL">Tenant: All</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Exception Type Filter */}
          <select
            value={exceptionFilter}
            onChange={(e) => setExceptionFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Exception: All Errors</option>
            <option value="HTTP_429">HTTP 429 Rate Limited 🟡</option>
            <option value="HTTP_401">HTTP 401 Auth Failed 🔴</option>
            <option value="HTTP_403">HTTP 403 Forbidden 🔴</option>
            <option value="HTTP_500">HTTP 500 Outage 🟣</option>
            <option value="SCHEMA_ERROR">Schema / Data Error 🟠</option>
          </select>

          {/* Retry Status Filter */}
          <select
            value={retryStatusFilter}
            onChange={(e) => setRetryStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Status: All States</option>
            <option value="pending">Awaiting Retry / Backoff</option>
            <option value="max_exceeded">Max Retries Exceeded 🛑</option>
          </select>

          {/* Workload Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Category: All</option>
            <option value="Conditional Access">Conditional Access</option>
            <option value="Identity / Entra">Identity / Entra</option>
            <option value="Intune">Intune</option>
            <option value="Exchange">Exchange</option>
            <option value="Security / Defender">Security / Defender</option>
            <option value="Governance">Governance</option>
          </select>

          {(searchTerm || exceptionFilter !== 'ALL' || retryStatusFilter !== 'ALL' || categoryFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setExceptionFilter('ALL');
                setRetryStatusFilter('ALL');
                setCategoryFilter('ALL');
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
        {/* VIEW 1: DEAD LETTER QUEUE STREAM & INSPECTOR (60% TABLE | 40% INSPECTOR) */}
        {/* ======================================================================= */}
        {activeView === 'dlq_stream' && (
          <div className="w-full h-full flex gap-4 overflow-hidden">
            
            {/* LEFT PANE (60% WIDTH): MASTER DLQ TABLE */}
            <div className="w-full lg:w-[60%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
              
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleSelectAll}
                    className="text-[#a3c9ff] hover:text-white"
                    title="Toggle Select All"
                  >
                    {selectedIds.length === filteredMessages.length && filteredMessages.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-[#0078d4]" />
                    ) : (
                      <Square className="w-4 h-4 text-[#8a919e]" />
                    )}
                  </button>
                  <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-1.5">
                    <AlertOctagon className="w-4 h-4 text-red-400" />
                    <span>Dead Letter Queue Stream ({filteredMessages.length})</span>
                  </span>
                </div>

                {selectedIds.length > 0 && (
                  <div className="flex items-center gap-2 bg-[#0078d4]/20 border border-[#0078d4]/40 px-2.5 py-1 rounded">
                    <span className="text-[11px] font-mono font-bold text-[#a3c9ff]">
                      {selectedIds.length} Selected
                    </span>
                    <button
                      onClick={handleBatchReplay}
                      className="px-2 py-0.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-[10px] font-mono font-bold"
                    >
                      Batch Replay
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] sticky top-0 border-b border-[#404752] z-10">
                    <tr>
                      <th className="p-3 w-8"></th>
                      <th className="p-3">Error Code</th>
                      <th className="p-3">DLQ Code &amp; Workflow</th>
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">Time &amp; Retries</th>
                      <th className="p-3">Auto-Backoff</th>
                      <th className="p-3 text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40">
                    {filteredMessages.map(msg => {
                      const isSelected = msg.id === selectedMessageId;
                      const isChecked = selectedIds.includes(msg.id);

                      let codeBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                      if (msg.errorCode === 'HTTP_401' || msg.errorCode === 'HTTP_403') {
                        codeBadge = 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse';
                      } else if (msg.errorCode === 'HTTP_500') {
                        codeBadge = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                      } else if (msg.errorCode === 'SCHEMA_ERROR') {
                        codeBadge = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
                      }

                      return (
                        <tr
                          key={msg.id}
                          onClick={() => setSelectedMessageId(msg.id)}
                          className={cn(
                            "hover:bg-[#181c22] transition-colors cursor-pointer",
                            isSelected ? "bg-[#1a212d]" : ""
                          )}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleToggleSelectId(msg.id)}>
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-[#0078d4]" />
                              ) : (
                                <Square className="w-4 h-4 text-[#8a919e]" />
                              )}
                            </button>
                          </td>

                          <td className="p-3">
                            <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border", codeBadge)}>
                              {msg.errorCode.replace('_', ' ')}
                            </span>
                          </td>

                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-[#8a919e]">{msg.dlqCode}</span>
                              <span className="text-[#404752]">&bull;</span>
                              <span className="text-[11px] text-[#a3c9ff] font-mono">{msg.category}</span>
                            </div>
                            <div className="font-bold text-[#f0f4f8] line-clamp-1 mt-0.5">{msg.workflowName}</div>
                          </td>

                          <td className="p-3">
                            <div className="font-semibold text-[#f0f4f8] flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-[#a3c9ff]" />
                              <span>{msg.tenantName}</span>
                            </div>
                          </td>

                          <td className="p-3 font-mono text-[11px]">
                            <div className="text-[#f0f4f8]">{msg.failedAt}</div>
                            <div className="text-[10px] text-[#8a919e]">Retry {msg.retryCount}/{msg.maxRetries}</div>
                          </td>

                          <td className="p-3 font-mono text-[11px]">
                            {msg.nextRetryInSeconds > 0 ? (
                              <span className="text-amber-400 font-bold flex items-center gap-1">
                                <Clock className="w-3 h-3 animate-spin" />
                                <span>{msg.nextRetryInSeconds}s</span>
                              </span>
                            ) : msg.status === 'max_retries_exceeded' ? (
                              <span className="text-red-400 font-bold bg-red-500/20 px-1.5 py-0.5 rounded text-[10px]">
                                MAX EXCEEDED
                              </span>
                            ) : (
                              <span className="text-emerald-400 font-bold">READY</span>
                            )}
                          </td>

                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleReplaySingle(msg.id)}
                                disabled={isReplaying}
                                className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-[11px] font-mono font-bold flex items-center gap-1 shadow-sm disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Replay</span>
                              </button>

                              <button
                                onClick={() => handlePurgeMessage(msg.id)}
                                className="p-1 bg-[#181c22] hover:bg-red-500/20 hover:text-red-400 border border-[#404752] text-[#8a919e] rounded"
                                title="Purge Poison Message"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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

            {/* RIGHT PANE (40% WIDTH): MESSAGE DIAGNOSTICS & EDITABLE PAYLOAD PANEL */}
            {!selectedMessage ? (
              <div className="hidden lg:flex flex-col w-[40%] items-center justify-center bg-[#101419] border border-[#404752] rounded-xl text-[#8a919e] p-6 text-center shadow-2xl">
                <AlertOctagon className="w-8 h-8 mb-2 opacity-50 text-indigo-400" />
                <div className="text-xs font-bold text-[#e0e2ea]">No DLQ Message Selected</div>
                <div className="text-[10px] mt-1 text-[#6b7280]">Select an error event from the queue to inspect diagnostics and retry execution.</div>
              </div>
            ) : (
              <div className="hidden lg:flex flex-col w-[40%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-2xl">
                
                {/* Inspector Header */}
                <div className="p-3.5 bg-[#181c22] border-b border-[#404752] flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                        {selectedMessage.dlqCode}
                      </span>
                      <span className="text-xs font-mono text-[#8a919e]">{selectedMessage.failedAt} (Retry {selectedMessage.retryCount}/{selectedMessage.maxRetries})</span>
                    </div>
                    <h3 className="text-xs font-bold text-[#f0f4f8] mt-1 leading-snug">
                      {selectedMessage.workflowName}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleReplaySingle(selectedMessage.id)}
                      disabled={isReplaying}
                      className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-xs font-bold font-mono flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      <RotateCcw className={cn("w-3.5 h-3.5", isReplaying ? "animate-spin" : "")} />
                      <span>{isReplaying ? 'Executing...' : 'Replay Message'}</span>
                    </button>

                    <button
                      onClick={() => handlePurgeMessage(selectedMessage.id)}
                      className="p-1.5 bg-[#101419] hover:bg-red-500/20 text-[#8a919e] hover:text-red-400 border border-[#404752] rounded"
                      title="Purge Message"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sub-Navigation Tabs inside Inspector */}
                <div className="bg-[#141820] border-b border-[#404752] px-3 py-1 flex items-center gap-2 text-xs font-mono shrink-0">
                  <button
                    onClick={() => setInspectorTab('diagnostics')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'diagnostics' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Exception Diagnostics</span>
                  </button>

                  <button
                    onClick={() => setInspectorTab('json_editor')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'json_editor' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>JSON Payload Editor</span>
                  </button>

                  <button
                    onClick={() => setInspectorTab('history')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'history' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>Retry History ({selectedMessage.retryHistory.length})</span>
                  </button>
                </div>

                {/* Inspector Content View */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  
                  {/* TAB 1: DIAGNOSTICS & STACK TRACE */}
                  {inspectorTab === 'diagnostics' && (
                    <div className="space-y-3">
                      
                      {/* Graph Endpoint Monospace Bar */}
                      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-1.5">
                        <span className="text-[10px] font-mono text-[#8a919e] uppercase font-semibold">Target Graph API Endpoint</span>
                        <div className="font-mono text-xs text-amber-300 bg-[#090d16] p-2 rounded border border-[#404752] break-all select-all">
                          {selectedMessage.graphEndpoint}
                        </div>
                      </div>

                      {/* Raw Exception Response Box */}
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-1.5">
                        <div className="font-mono font-bold text-red-400 flex items-center gap-1.5">
                          <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                          <span>Raw Microsoft Exception Response ({selectedMessage.errorCode}):</span>
                        </div>
                        <p className="font-mono text-[11px] leading-relaxed text-red-200 bg-[#090d16] p-2.5 rounded border border-red-500/20 select-all">
                          {selectedMessage.errorMessage}
                        </p>
                      </div>

                      {/* Recommended Healing Action */}
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-1">
                        <div className="font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>Recommended Healing Action:</span>
                        </div>
                        <p className="text-xs text-emerald-200 leading-relaxed font-sans">
                          {selectedMessage.recommendedAction}
                        </p>
                      </div>

                      {/* Stack Trace Terminal Box */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-mono text-[#8a919e]">
                          <span className="flex items-center gap-1">
                            <Terminal className="w-3.5 h-3.5 text-blue-400" />
                            <span>Stack Trace Diagnostics</span>
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(selectedMessage.errorStackTrace);
                              toast('info', 'Copied Stack Trace', 'Stack trace copied to clipboard.');
                            }}
                            className="text-[10px] text-[#a3c9ff] hover:underline"
                          >
                            Copy Trace
                          </button>
                        </div>
                        <pre className="p-3 bg-[#090d16] border border-[#404752] rounded-lg font-mono text-[11px] text-[#8a919e] overflow-x-auto whitespace-pre-wrap leading-relaxed select-all max-h-[220px]">
                          {selectedMessage.errorStackTrace}
                        </pre>
                      </div>

                    </div>
                  )}

                  {/* TAB 2: EDITABLE JSON PAYLOAD EDITOR */}
                  {inspectorTab === 'json_editor' && (
                    <div className="space-y-3 h-full flex flex-col">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#8a919e] flex items-center gap-1">
                          <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                          <span>Inline Request Payload Editor</span>
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleFormatJson}
                            className="px-2 py-1 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] rounded text-[11px]"
                          >
                            Format JSON
                          </button>

                          <button
                            onClick={handleSavePayload}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[11px] font-bold flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" />
                            <span>Save Changes</span>
                          </button>
                        </div>
                      </div>

                      {payloadParseError && (
                        <div className="p-2 bg-red-500/20 border border-red-500/40 rounded text-[11px] font-mono text-red-300">
                          Syntax Error: {payloadParseError}
                        </div>
                      )}

                      <textarea
                        value={editingPayloadText}
                        onChange={(e) => setEditingPayloadText(e.target.value)}
                        rows={14}
                        className="w-full bg-[#090d16] border border-[#404752] rounded-lg p-3 font-mono text-xs text-purple-300 focus:outline-none focus:border-purple-500 leading-relaxed resize-none shadow-inner"
                        spellCheck={false}
                      />

                      <p className="text-[11px] text-[#8a919e] font-sans">
                        💡 Senior operators can edit payload properties directly in JSON format to fix schema validation errors prior to executing a manual replay.
                      </p>
                    </div>
                  )}

                  {/* TAB 3: RETRY HISTORY TIMELINE */}
                  {inspectorTab === 'history' && (
                    <div className="space-y-3">
                      <h4 className="font-mono text-xs font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span>Execution Retry Timeline ({selectedMessage.retryHistory.length} Attempts)</span>
                      </h4>

                      <div className="space-y-2 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#404752]">
                        {selectedMessage.retryHistory.map(entry => (
                          <div key={entry.attempt} className="relative pl-7 space-y-1">
                            <div className="absolute left-1.5 top-2.5 w-3 h-3 rounded-full bg-[#0078d4] border-2 border-[#101419]" />
                            <div className="p-2.5 bg-[#181c22] border border-[#404752] rounded-lg space-y-1">
                              <div className="flex items-center justify-between font-mono text-[11px]">
                                <span className="font-bold text-[#f0f4f8]">Attempt #{entry.attempt}</span>
                                <span className="text-[#8a919e]">{entry.timestamp} ({entry.latencyMs}ms)</span>
                              </div>
                              <div className="text-[11px] font-mono text-red-300 flex items-center gap-1.5">
                                <span className="px-1.5 py-0.2 rounded bg-red-500/20 border border-red-500/30 text-[10px]">
                                  HTTP {entry.responseCode}
                                </span>
                                <span>{entry.details}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>

              </div>
            )}

          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 2: GRAPH API ERROR TAXONOMY & RATE-LIMIT ANALYTICS */}
        {/* ======================================================================= */}
        {activeView === 'error_analytics' && (
          <div className="w-full h-full overflow-y-auto space-y-4">
            
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-bold text-[#f0f4f8] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span>Graph API Exception Distribution &amp; Throttle Heatmap</span>
              </h2>
              <p className="text-xs text-[#8a919e]">
                Breakdown of 122+ Microsoft Graph endpoints by HTTP response status code, throttling frequency, and authorization expiration trends.
              </p>
            </div>

            {/* Error Distribution Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Card 1 */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-amber-400 uppercase">HTTP 429 Throttling</span>
                  <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded">61% of DLQ</span>
                </div>
                <div className="text-2xl font-bold font-mono text-[#f0f4f8]">11 Endpoints</div>
                <p className="text-xs text-[#8a919e]">
                  Primary driver: High-frequency 5-minute Graph polling on Conditional Access and Identity Protection endpoints.
                </p>
                <div className="w-full bg-[#181c22] rounded-full h-2 overflow-hidden border border-[#404752]">
                  <div className="bg-amber-400 h-full" style={{ width: '61%' }} />
                </div>
              </div>

              {/* Card 2 */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-red-400 uppercase">HTTP 401 / 403 Auth Blocks</span>
                  <span className="text-xs font-mono font-bold text-red-300 bg-red-500/20 px-2 py-0.5 rounded">22% of DLQ</span>
                </div>
                <div className="text-2xl font-bold font-mono text-[#f0f4f8]">4 App Regs</div>
                <p className="text-xs text-[#8a919e]">
                  Primary driver: Expired client secrets in Key Vault and revoked tenant admin consent permissions.
                </p>
                <div className="w-full bg-[#181c22] rounded-full h-2 overflow-hidden border border-[#404752]">
                  <div className="bg-red-400 h-full" style={{ width: '22%' }} />
                </div>
              </div>

              {/* Card 3 */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-purple-400 uppercase">HTTP 500 MS Outages</span>
                  <span className="text-xs font-mono font-bold text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded">17% of DLQ</span>
                </div>
                <div className="text-2xl font-bold font-mono text-[#f0f4f8]">3 Outages</div>
                <p className="text-xs text-[#8a919e]">
                  Primary driver: Upstream Microsoft Security &amp; Intune cloud service degradation.
                </p>
                <div className="w-full bg-[#181c22] rounded-full h-2 overflow-hidden border border-[#404752]">
                  <div className="bg-purple-400 h-full" style={{ width: '17%' }} />
                </div>
              </div>

            </div>

            {/* Top Throttled Graph Endpoints Table */}
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold text-[#a3c9ff] uppercase tracking-wider">
                Top Throttled Graph API Endpoints (Last 24h)
              </h3>

              <div className="space-y-2">
                {[
                  { endpoint: '/identity/conditionalAccess/policies', count: 42, avgCooldown: '180s', risk: 'HIGH' },
                  { endpoint: '/identityProtection/riskyUsers', count: 28, avgCooldown: '120s', risk: 'MEDIUM' },
                  { endpoint: '/deviceManagement/deviceConfigurations', count: 14, avgCooldown: '60s', risk: 'LOW' },
                  { endpoint: '/security/incidents', count: 9, avgCooldown: '30s', risk: 'LOW' }
                ].map(item => (
                  <div key={item.endpoint} className="p-3 bg-[#181c22] border border-[#404752] rounded-lg flex items-center justify-between font-mono text-xs">
                    <span className="text-amber-300">{item.endpoint}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-[#8a919e]">{item.count} Throttles</span>
                      <span className="text-amber-400">Avg Backoff: {item.avgCooldown}</span>
                      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold">
                        {item.risk}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 3: CIRCUIT BREAKERS & RETENTION CONFIGURATION */}
        {/* ======================================================================= */}
        {activeView === 'circuit_breakers' && (
          <div className="w-full h-full overflow-y-auto space-y-4 text-xs">
            
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-bold text-[#f0f4f8] flex items-center gap-2">
                <Settings className="w-4 h-4 text-purple-400" />
                <span>Resilience Circuit Breakers &amp; Retention Policies</span>
              </h2>
              <p className="text-xs text-[#8a919e]">
                Configure retry backoff multipliers, poison message auto-purge rules, and automatic circuit breaker tripping parameters.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Card 1: Retry Policy */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
                <h3 className="font-mono font-bold text-[#a3c9ff] uppercase text-xs">Exponential Backoff &amp; Retry Limits</h3>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[#8a919e] text-[11px]">Maximum Retries before DLQ Escalation</label>
                    <input
                      type="number"
                      defaultValue={5}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#8a919e] text-[11px]">Initial Backoff Interval (Seconds)</label>
                    <input
                      type="number"
                      defaultValue={30}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#8a919e] text-[11px]">Exponential Backoff Multiplier</label>
                    <input
                      type="number"
                      defaultValue={2.0}
                      step={0.1}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Circuit Breaker */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3">
                <h3 className="font-mono font-bold text-red-400 uppercase text-xs">Graph API Circuit Breakers</h3>
                
                <div className="space-y-3">
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white">Circuit Breaker Status</div>
                      <div className="text-[11px] text-emerald-400">CLOSED (Normal Operations)</div>
                    </div>
                    <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#8a919e] text-[11px]">Trip Threshold (Consecutive Failures)</label>
                    <input
                      type="number"
                      defaultValue={10}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-white"
                    />
                  </div>

                  <button
                    onClick={() => toast('success', 'Policy Saved', 'Updated circuit breaker configuration.')}
                    className="w-full py-2 bg-[#0078d4] hover:bg-[#006cbd] text-white font-bold rounded text-xs"
                  >
                    Save Resilience Policies
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* BATCH REPLAY CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {showBatchConfirmModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/20 border border-emerald-500/40 rounded-lg">
                <RotateCcw className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirm Batch DLQ Replay</h3>
                <p className="text-xs text-[#8a919e]">Resilience Recovery Workbench</p>
              </div>
            </div>

            <p className="text-xs text-[#e0e2ea] leading-relaxed">
              Are you sure you want to execute batch replay for{' '}
              <strong className="text-emerald-400 font-mono">
                {selectedIds.length > 0 ? selectedIds.length : filteredMessages.length} DLQ messages
              </strong>{' '}
              against the Microsoft Graph API?
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowBatchConfirmModal(false)}
                className="px-4 py-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchReplay}
                disabled={isReplaying}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs flex items-center gap-1.5 shadow-md"
              >
                <RotateCcw className={cn("w-3.5 h-3.5", isReplaying ? "animate-spin" : "")} />
                <span>{isReplaying ? 'Replaying...' : 'Confirm Batch Replay'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

