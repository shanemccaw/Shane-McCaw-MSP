// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Webhook,
  Send,
  Radio,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  KeyRound,
  RotateCcw,
  Terminal,
  Zap,
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
  Copy,
  Plus,
  Check,
  Activity,
  ArrowUpRight,
  Lock,
  ShieldCheck,
  Layers,
  ExternalLink,
  AlertTriangle,
  Eye,
  EyeOff,
  Server,
  Database,
  Cpu,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export interface WebhookEndpoint {
  id: string;
  code: string;
  name: string;
  direction: 'inbound' | 'outbound';
  targetUrl: string;
  targetSystem: 'halo_psa' | 'connectwise' | 'graph_api' | 'slack' | 'custom_https' | 'datadog' | 'aws_s3';
  eventSubscriptions: string[];
  status: 'active' | 'paused' | 'failed';
  successRate: number;
  ttlMinutesRemaining: number | null; // For Graph API Subscriptions
  secretKey: string;
  createdAt: string;
  tenantName?: string;
  lastDeliveredAt?: string;
  deliveries24h?: number;
  authType?: 'hmac' | 'bearer' | 'basic';
  customHeaders?: Record<string, string>;
  latencyHistory?: number[]; // Array of last 20 latencies in ms
}

export interface WebhookDeliveryAttempt {
  id: string;
  endpointId: string;
  endpointName: string;
  direction: 'inbound' | 'outbound';
  eventType: string;
  statusCode: number;
  statusText: string;
  latencyMs: number;
  timestamp: string;
  requestHeaders: Record<string, string>;
  requestBody: Record<string, any>;
  responseHeaders: Record<string, string>;
  responseBody: string;
  signatureVerified: boolean;
  retryCount: number;
}

interface WebhooksConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onTestWebhookEndpoint?: (id: string) => void;
  onReplayWebhookDelivery?: (attemptId: string) => void;
}

// ==========================================
// MOCK DATA SEEDS
// ==========================================

const INITIAL_ENDPOINTS: WebhookEndpoint[] = [
  {
    id: 'ep-101',
    code: 'HOOK-PSA-01',
    name: 'HaloPSA Security Incident Auto-Ticket Forwarder',
    direction: 'outbound',
    targetUrl: 'https://halopsa.msp-global.com/api/webhooks/v1/incidents',
    targetSystem: 'halo_psa',
    eventSubscriptions: ['alert.critical', 'ca_policy.drift', 'offboarding.completed'],
    status: 'active',
    successRate: 100.0,
    ttlMinutesRemaining: null,
    secretKey: 'whsec_8f92a1b49e830172cda65e21901ab29c4e883a',
    createdAt: '2026-03-12',
    tenantName: 'Contoso Corp',
    lastDeliveredAt: '12 seconds ago',
    deliveries24h: 12450,
    authType: 'hmac',
    customHeaders: {
      'X-MSP-Vendor': 'MSP-Nexus-Core',
      'X-Halo-Tenant': 'CONTOSO-PROD',
    },
    latencyHistory: [112, 120, 108, 145, 98, 115, 130, 105, 110, 125, 118, 95, 102, 110, 135, 122, 109, 114, 101, 108],
  },
  {
    id: 'ep-102',
    code: 'HOOK-GRAPH-02',
    name: 'MS Graph API Directory Audit & Delta Listener',
    direction: 'inbound',
    targetUrl: 'https://api.msp-nexus.cloud/v1/webhooks/graph/directoryAudits',
    targetSystem: 'graph_api',
    eventSubscriptions: ['user.updated', 'user.created', 'group.modified', 'role.assigned'],
    status: 'active',
    successRate: 99.8,
    ttlMinutesRemaining: 1420, // ~23 hours
    secretKey: 'whsec_9912bc784a912e0394850cda1122aef91209cc',
    createdAt: '2026-01-05',
    tenantName: 'Fabrikam Inc',
    lastDeliveredAt: '2 minutes ago',
    deliveries24h: 28910,
    authType: 'hmac',
    customHeaders: {
      'Client-State': 'secretClientState-2026-prod',
    },
    latencyHistory: [45, 52, 48, 61, 55, 42, 50, 49, 58, 60, 44, 51, 53, 47, 49, 56, 52, 48, 50, 46],
  },
  {
    id: 'ep-103',
    code: 'HOOK-CW-03',
    name: 'ConnectWise Manage Service Ticket Sync',
    direction: 'outbound',
    targetUrl: 'https://api-na.connectwisedev.com/v4_6_release/apis/3.0/service/tickets/webhook',
    targetSystem: 'connectwise',
    eventSubscriptions: ['dlq.item_quarantined', 'backup.failed', 'sla.breached'],
    status: 'active',
    successRate: 99.4,
    ttlMinutesRemaining: null,
    secretKey: 'whsec_110948572019485726384950192837465',
    createdAt: '2026-02-18',
    tenantName: 'Northwind Traders',
    lastDeliveredAt: '8 minutes ago',
    deliveries24h: 3820,
    authType: 'bearer',
    customHeaders: {
      'Authorization': 'Bearer cw_live_token_7719283',
      'X-CW-CompanyId': 'NorthwindTraders',
    },
    latencyHistory: [210, 195, 230, 245, 188, 202, 215, 220, 198, 205, 212, 190, 225, 235, 208, 215, 200, 210, 195, 205],
  },
  {
    id: 'ep-104',
    code: 'HOOK-SLACK-04',
    name: 'Slack #soc-alerts Escalation Channel Bot',
    direction: 'outbound',
    targetUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXX',
    targetSystem: 'slack',
    eventSubscriptions: ['alert.critical', 'threat.ransomware_suspected', 'ca_policy.drift'],
    status: 'active',
    successRate: 100.0,
    ttlMinutesRemaining: null,
    secretKey: 'whsec_slack_channel_secret_991827364',
    createdAt: '2026-04-01',
    tenantName: 'Litware Systems',
    lastDeliveredAt: '15 minutes ago',
    deliveries24h: 1420,
    authType: 'hmac',
    latencyHistory: [88, 92, 85, 99, 90, 87, 94, 91, 89, 93, 86, 95, 90, 88, 91, 93, 89, 87, 92, 90],
  },
  {
    id: 'ep-105',
    code: 'HOOK-GRAPH-05',
    name: 'Entra ID Risk Signal Real-Time Webhook (Defender)',
    direction: 'inbound',
    targetUrl: 'https://api.msp-nexus.cloud/v1/webhooks/entra/riskEvents',
    targetSystem: 'graph_api',
    eventSubscriptions: ['riskUser.updated', 'impossibleTravel.detected', 'mfa.bypassed'],
    status: 'failed',
    successRate: 84.2,
    ttlMinutesRemaining: 18, // EXPIRING SOON!
    secretKey: 'whsec_entra_risk_sec_8812736450192',
    createdAt: '2026-05-10',
    tenantName: 'AdventureWorks',
    lastDeliveredAt: '1 hour ago',
    deliveries24h: 110,
    authType: 'hmac',
    customHeaders: {
      'Client-State': 'riskSignalState-adv-05',
    },
    latencyHistory: [450, 520, 890, 1200, 502, 502, 502, 480, 502, 1100, 490, 502, 502, 850, 920, 502, 502, 490, 510, 502],
  },
  {
    id: 'ep-106',
    code: 'HOOK-S3-06',
    name: 'AWS S3 Immutable SIEM Audit Trail Webhook Stream',
    direction: 'outbound',
    targetUrl: 'https://siem-ingest.s3.us-east-1.amazonaws.com/msp-logs/raw-events',
    targetSystem: 'aws_s3',
    eventSubscriptions: ['*'],
    status: 'active',
    successRate: 99.99,
    ttlMinutesRemaining: null,
    secretKey: 'whsec_s3_log_stream_key_992817263544',
    createdAt: '2026-01-10',
    tenantName: 'Woodgrove Bank',
    lastDeliveredAt: '1 second ago',
    deliveries24h: 154200,
    authType: 'hmac',
    latencyHistory: [35, 38, 42, 36, 39, 37, 40, 34, 38, 36, 41, 35, 39, 37, 36, 40, 38, 35, 37, 36],
  },
];

const INITIAL_ATTEMPTS: WebhookDeliveryAttempt[] = [
  {
    id: 'att-801',
    endpointId: 'ep-101',
    endpointName: 'HaloPSA Security Incident Auto-Ticket Forwarder',
    direction: 'outbound',
    eventType: 'ca_policy.drift',
    statusCode: 200,
    statusText: 'OK',
    latencyMs: 108,
    timestamp: '2026-07-24 08:58:12',
    requestHeaders: {
      'Host': 'halopsa.msp-global.com',
      'Content-Type': 'application/json',
      'X-MSP-Signature': 'sha256=2f9b8c7e1d3a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f901a',
      'X-Event-Type': 'ca_policy.drift',
      'X-Event-ID': 'evt_9918273641',
      'User-Agent': 'MSP-Nexus-WebhookDispatcher/2.4',
    },
    requestBody: {
      eventId: 'evt_9918273641',
      eventType: 'ca_policy.drift',
      tenantId: 't-contoso-01',
      tenantName: 'Contoso Corp',
      severity: 'CRITICAL',
      timestamp: '2026-07-24T08:58:12.102Z',
      payload: {
        policyId: 'cap-9918-strict-mfa',
        policyName: 'Require MFA for All Admin Roles',
        driftDetected: 'State toggled from Enforced to Disabled',
        modifiedBy: 'alex.b@contoso.com',
        clientIp: '198.51.100.45',
        autoRemediationTriggered: true,
      },
    },
    responseHeaders: {
      'Date': 'Fri, 24 Jul 2026 08:58:12 GMT',
      'Content-Type': 'application/json; charset=utf-8',
      'Server': 'HaloPSA-Gateway/4.2',
      'X-Halo-Ticket-ID': 'INC-2026-88912',
    },
    responseBody: JSON.stringify(
      {
        status: 'SUCCESS',
        ticketId: 'INC-2026-88912',
        ticketUrl: 'https://halopsa.msp-global.com/tickets/INC-2026-88912',
        message: 'Incident ticket automatically generated and assigned to SOC Level 2 tier.',
      },
      null,
      2
    ),
    signatureVerified: true,
    retryCount: 0,
  },
  {
    id: 'att-802',
    endpointId: 'ep-102',
    endpointName: 'MS Graph API Directory Audit & Delta Listener',
    direction: 'inbound',
    eventType: 'user.updated',
    statusCode: 200,
    statusText: 'OK',
    latencyMs: 46,
    timestamp: '2026-07-24 08:56:45',
    requestHeaders: {
      'Host': 'api.msp-nexus.cloud',
      'Content-Type': 'application/json',
      'X-MS-Notification-Signature': 'sha256=11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
      'Client-State': 'secretClientState-2026-prod',
    },
    requestBody: {
      value: [
        {
          subscriptionId: 'sub-graph-directory-881',
          subscriptionExpirationDateTime: '2026-07-25T08:30:00.000Z',
          changeType: 'updated',
          resource: 'Users/david.v@fabrikam.io',
          resourceData: {
            id: 'david.v@fabrikam.io',
            '@odata.type': '#Microsoft.Graph.User',
            accountEnabled: false,
          },
          clientState: 'secretClientState-2026-prod',
          tenantId: 't-fabrikam-02',
        },
      ],
    },
    responseHeaders: {
      'Date': 'Fri, 24 Jul 2026 08:56:45 GMT',
      'Content-Type': 'application/json',
      'X-Nexus-Ack': 'ACK-200-OK',
    },
    responseBody: JSON.stringify({ status: 'ACCEPTED', processedCount: 1 }, null, 2),
    signatureVerified: true,
    retryCount: 0,
  },
  {
    id: 'att-803',
    endpointId: 'ep-105',
    endpointName: 'Entra ID Risk Signal Real-Time Webhook (Defender)',
    direction: 'inbound',
    eventType: 'impossibleTravel.detected',
    statusCode: 502,
    statusText: 'Bad Gateway',
    latencyMs: 502,
    timestamp: '2026-07-24 08:45:10',
    requestHeaders: {
      'Host': 'api.msp-nexus.cloud',
      'Content-Type': 'application/json',
      'Client-State': 'riskSignalState-adv-05',
    },
    requestBody: {
      eventId: 'risk-evt-7712',
      riskType: 'impossibleTravel',
      userPrincipalName: 'clara.m@adventureworks.com',
      riskLevel: 'high',
      details: {
        locationA: 'Seattle, USA (08:30:00)',
        locationB: 'Frankfurt, Germany (08:32:15)',
        distanceKm: 8120,
      },
    },
    responseHeaders: {
      'Date': 'Fri, 24 Jul 2026 08:45:10 GMT',
      'Content-Type': 'text/html',
      'Server': 'nginx/1.24.0',
    },
    responseBody: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1><p>Upstream microservice connection reset by peer.</p></center></body></html>',
    signatureVerified: false,
    retryCount: 3,
  },
  {
    id: 'att-804',
    endpointId: 'ep-103',
    endpointName: 'ConnectWise Manage Service Ticket Sync',
    direction: 'outbound',
    eventType: 'dlq.item_quarantined',
    statusCode: 200,
    statusText: 'OK',
    latencyMs: 195,
    timestamp: '2026-07-24 08:30:22',
    requestHeaders: {
      'Host': 'api-na.connectwisedev.com',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer cw_live_token_7719283',
    },
    requestBody: {
      dlqItemId: 'dlq-402',
      originWorkflow: 'Exchange Online Shared Mailbox Delegation',
      tenantName: 'Northwind Traders',
      errorDetail: '409 Conflict: LitigationHoldEnabled',
      quarantineTime: '2026-07-24T08:30:00Z',
    },
    responseHeaders: {
      'Date': 'Fri, 24 Jul 2026 08:30:22 GMT',
      'Content-Type': 'application/json',
    },
    responseBody: JSON.stringify({ id: 991823, summary: 'DLQ Item Quarantined: Northwind Traders', status: 'Open' }, null, 2),
    signatureVerified: true,
    retryCount: 0,
  },
  {
    id: 'att-805',
    endpointId: 'ep-104',
    endpointName: 'Slack #soc-alerts Escalation Channel Bot',
    direction: 'outbound',
    eventType: 'threat.ransomware_suspected',
    statusCode: 200,
    statusText: 'OK',
    latencyMs: 90,
    timestamp: '2026-07-24 08:15:00',
    requestHeaders: {
      'Host': 'hooks.slack.com',
      'Content-Type': 'application/json',
    },
    requestBody: {
      text: '🚨 *HIGH SEVERITY SOC ALERT*: Mass file encryption anomaly detected in Litware Systems tenant. 450 files modified in 30s. Host isolated.',
      attachments: [
        {
          color: '#ef4444',
          fields: [
            { title: 'Tenant', value: 'Litware Systems', short: true },
            { title: 'Host', value: 'WORKSTATION-DEVT-09', short: true },
            { title: 'Defender Action', value: 'Network Isolation Active', short: false },
          ],
        },
      ],
    },
    responseHeaders: {
      'Date': 'Fri, 24 Jul 2026 08:15:00 GMT',
      'Content-Type': 'text/plain',
    },
    responseBody: 'ok',
    signatureVerified: true,
    retryCount: 0,
  },
  {
    id: 'att-806',
    endpointId: 'ep-101',
    endpointName: 'HaloPSA Security Incident Auto-Ticket Forwarder',
    direction: 'outbound',
    eventType: 'offboarding.completed',
    statusCode: 200,
    statusText: 'OK',
    latencyMs: 112,
    timestamp: '2026-07-24 07:45:00',
    requestHeaders: {
      'Host': 'halopsa.msp-global.com',
      'Content-Type': 'application/json',
      'X-MSP-Signature': 'sha256=a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
    },
    requestBody: {
      runCode: 'OFF-2026-042',
      targetUserUpn: 'alex.b@contoso.com',
      status: 'COMPLETED',
      reclaimedSku: 'M365 E5 (+Entra P2)',
      monthlySavings: 57.0,
    },
    responseHeaders: {
      'Content-Type': 'application/json',
    },
    responseBody: JSON.stringify({ ticketId: 'INC-2026-88890', status: 'CLOSED_RESOLVED' }, null, 2),
    signatureVerified: true,
    retryCount: 0,
  },
];

const EVENT_SUBSCRIPTION_CATALOG = [
  { id: 'alert.critical', label: 'Defender & SOC Critical Alerts', category: 'Security & Defender' },
  { id: 'ca_policy.drift', label: 'Conditional Access Policy Drift', category: 'Security & Defender' },
  { id: 'threat.ransomware_suspected', label: 'Ransomware / File Anomaly Suspected', category: 'Security & Defender' },
  { id: 'user.updated', label: 'Entra ID User Attribute Modified', category: 'Identity & Graph' },
  { id: 'user.created', label: 'New Entra ID User Provisioned', category: 'Identity & Graph' },
  { id: 'offboarding.completed', label: '7-Step User Offboarding Completed', category: 'Identity & Graph' },
  { id: 'dlq.item_quarantined', label: 'DLQ Message Quarantined', category: 'System & Automation' },
  { id: 'sla.breached', label: 'Microsoft SLA Breached (>99.9% Impact)', category: 'System & Automation' },
  { id: 'backup.failed', label: 'M365 Backup Failure Notification', category: 'System & Automation' },
  { id: '* ', label: 'Wildcard Ingest (All System Events)', category: 'SIEM & Audit' },
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export const WebhooksConsole: React.FC<WebhooksConsoleProps> = ({
  tenants = [],
  onShowToast,
  onTestWebhookEndpoint,
  onReplayWebhookDelivery,
}) => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'endpoints' | 'delivery_stream' | 'sandbox'>('endpoints');

  // State
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>(INITIAL_ENDPOINTS);
  const [attempts, setAttempts] = useState<WebhookDeliveryAttempt[]>(INITIAL_ATTEMPTS);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>('ep-101');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string>('att-801');

  // Inspector States
  const [showSecretKey, setShowSecretKey] = useState<boolean>(false);
  const [payloadViewTab, setPayloadViewTab] = useState<'request' | 'response'>('request');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [targetFilter, setTargetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showGraphRenewModal, setShowGraphRenewModal] = useState(false);

  // New Endpoint Form State
  const [newEpName, setNewEpName] = useState('');
  const [newEpDirection, setNewEpDirection] = useState<'inbound' | 'outbound'>('outbound');
  const [newEpSystem, setNewEpSystem] = useState<WebhookEndpoint['targetSystem']>('halo_psa');
  const [newEpUrl, setNewEpUrl] = useState('');
  const [newEpTenant, setNewEpTenant] = useState('Contoso Corp');
  const [newEpAuth, setNewEpAuth] = useState<'hmac' | 'bearer' | 'basic'>('hmac');
  const [newEpSubscriptions, setNewEpSubscriptions] = useState<string[]>(['alert.critical', 'ca_policy.drift']);

  // Sandbox State
  const [sbEndpointId, setSbEndpointId] = useState<string>('ep-101');
  const [sbEventType, setSbEventType] = useState('ca_policy.drift');
  const [sbPayloadJson, setSbPayloadJson] = useState(
    JSON.stringify(
      {
        eventId: 'sim_evt_2026_9901',
        eventType: 'ca_policy.drift',
        tenantId: 't-contoso-01',
        tenantName: 'Contoso Corp',
        severity: 'CRITICAL',
        timestamp: new Date().toISOString(),
        payload: {
          policyId: 'cap-9918-strict-mfa',
          policyName: 'Require MFA for All Admin Roles',
          driftDetected: 'State toggled from Enforced to Disabled',
          modifiedBy: 'alex.b@contoso.com',
          clientIp: '198.51.100.45',
          autoRemediationTriggered: true,
        },
      },
      null,
      2
    )
  );
  const [sbIsDispatching, setSbIsDispatching] = useState(false);
  const [sbDispatchResult, setSbDispatchResult] = useState<any | null>(null);

  // Active Selected Models
  const activeEndpoint = useMemo(() => {
    return endpoints.find((e) => e.id === selectedEndpointId) || endpoints[0];
  }, [endpoints, selectedEndpointId]);

  const activeAttempt = useMemo(() => {
    return attempts.find((a) => a.id === selectedAttemptId) || attempts[0];
  }, [attempts, selectedAttemptId]);

  // Toast Helper
  const triggerToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const activeCount = endpoints.filter((e) => e.status === 'active').length;
    const totalDeliveries = endpoints.reduce((sum, e) => sum + (e.deliveries24h || 0), 0);
    const avgSuccess = (endpoints.reduce((sum, e) => sum + e.successRate, 0) / (endpoints.length || 1)).toFixed(1);
    const failedAttemptsCount = attempts.filter((a) => a.statusCode >= 400).length;

    return {
      activeEndpoints: `${activeCount} / ${endpoints.length} Active Hooks`,
      deliveries24h: `${totalDeliveries.toLocaleString()} Events`,
      successRate: `${avgSuccess}% Success`,
      failedCount: `${failedAttemptsCount} Failures`,
    };
  }, [endpoints, attempts]);

  // Filtered Endpoints
  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((ep) => {
      const matchesSearch =
        ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.targetUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.eventSubscriptions.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (directionFilter !== 'all' && ep.direction !== directionFilter) return false;
      if (targetFilter !== 'all' && ep.targetSystem !== targetFilter) return false;
      if (statusFilter !== 'all' && ep.status !== statusFilter) return false;
      if (tenantFilter !== 'all' && ep.tenantName !== tenantFilter) return false;

      return true;
    });
  }, [endpoints, searchQuery, directionFilter, targetFilter, statusFilter, tenantFilter]);

  // Filtered Delivery Attempts
  const filteredAttempts = useMemo(() => {
    return attempts.filter((att) => {
      const matchesSearch =
        att.endpointName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        att.eventType.toLowerCase().includes(searchQuery.toLowerCase()) ||
        att.statusCode.toString().includes(searchQuery) ||
        att.responseBody.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (directionFilter !== 'all' && att.direction !== directionFilter) return false;
      if (statusFilter === 'active' && att.statusCode >= 400) return false;
      if (statusFilter === 'failed' && att.statusCode < 400) return false;

      return true;
    });
  }, [attempts, searchQuery, directionFilter, statusFilter]);

  // Handlers
  const handleToggleSubscription = (subscriptionId: string) => {
    if (!activeEndpoint) return;

    setEndpoints((prev) =>
      prev.map((e) => {
        if (e.id === activeEndpoint.id) {
          const exists = e.eventSubscriptions.includes(subscriptionId);
          const updatedSubs = exists
            ? e.eventSubscriptions.filter((s) => s !== subscriptionId)
            : [...e.eventSubscriptions, subscriptionId];

          return { ...e, eventSubscriptions: updatedSubs };
        }
        return e;
      })
    );

    triggerToast('info', 'Subscription Updated', `Toggled event subscription '${subscriptionId}' for ${activeEndpoint.code}.`);
  };

  const handleTestEndpointAction = (endpointId: string) => {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;

    const newAttempt: WebhookDeliveryAttempt = {
      id: `att-${Date.now()}`,
      endpointId: ep.id,
      endpointName: ep.name,
      direction: ep.direction,
      eventType: ep.eventSubscriptions[0] || 'test.ping',
      statusCode: 200,
      statusText: 'OK',
      latencyMs: Math.floor(60 + Math.random() * 120),
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      requestHeaders: {
        'Host': new URL(ep.targetUrl.startsWith('http') ? ep.targetUrl : 'https://' + ep.targetUrl).hostname,
        'Content-Type': 'application/json',
        'X-MSP-Signature': `sha256=${Math.random().toString(16).substring(2)}`,
        'X-Nexus-Test': 'PING_TEST_VERIFICATION',
      },
      requestBody: {
        eventId: `test_${Date.now()}`,
        eventType: 'test.ping',
        message: 'Developer test webhook payload dispatched from MSP Nexus Webhooks Console.',
        timestamp: new Date().toISOString(),
      },
      responseHeaders: {
        'Date': new Date().toUTCString(),
        'Content-Type': 'application/json',
        'X-Endpoint-Ack': 'ACK-200-TEST-SUCCESS',
      },
      responseBody: JSON.stringify({ status: 'SUCCESS', testPassed: true, latencyMs: 92 }, null, 2),
      signatureVerified: true,
      retryCount: 0,
    };

    setAttempts([newAttempt, ...attempts]);
    setSelectedAttemptId(newAttempt.id);

    triggerToast('success', 'Test Event Dispatched', `Ping payload delivered to ${ep.name} (HTTP 200 OK).`);

    if (onTestWebhookEndpoint) {
      onTestWebhookEndpoint(endpointId);
    }
  };

  const handleReplayAttemptAction = (attemptId: string) => {
    const att = attempts.find((a) => a.id === attemptId);
    if (!att) return;

    const replayedAttempt: WebhookDeliveryAttempt = {
      id: `att-replay-${Date.now()}`,
      endpointId: att.endpointId,
      endpointName: att.endpointName,
      direction: att.direction,
      eventType: att.eventType,
      statusCode: 200,
      statusText: 'OK (Replayed)',
      latencyMs: Math.floor(70 + Math.random() * 100),
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      requestHeaders: {
        ...att.requestHeaders,
        'X-Nexus-Replay': 'TRUE',
        'X-Original-Attempt-ID': att.id,
      },
      requestBody: att.requestBody,
      responseHeaders: {
        'Date': new Date().toUTCString(),
        'Content-Type': 'application/json',
        'X-Replay-Status': 'ACCEPTED',
      },
      responseBody: JSON.stringify(
        {
          replayedFrom: att.id,
          status: 'SUCCESS',
          message: 'Payload successfully redelivered and accepted by downstream API target.',
        },
        null,
        2
      ),
      signatureVerified: true,
      retryCount: att.retryCount + 1,
    };

    setAttempts([replayedAttempt, ...attempts]);
    setSelectedAttemptId(replayedAttempt.id);

    triggerToast('success', 'Payload Redelivered', `Successfully replayed attempt ${att.id} to ${att.endpointName}.`);

    if (onReplayWebhookDelivery) {
      onReplayWebhookDelivery(attemptId);
    }
  };

  const handleRenewGraphSubscription = () => {
    if (!activeEndpoint) return;

    setEndpoints((prev) =>
      prev.map((e) => {
        if (e.id === activeEndpoint.id) {
          return {
            ...e,
            ttlMinutesRemaining: 4230, // 3 days max Graph TTL
            status: 'active' as const,
          };
        }
        return e;
      })
    );

    setShowGraphRenewModal(false);
    triggerToast('success', 'Graph API Subscription Renewed', `Extended TTL for ${activeEndpoint.code} by 4,230 minutes (+3 days).`);
  };

  const handleRegisterNewEndpoint = () => {
    if (!newEpName.trim() || !newEpUrl.trim()) return;

    const newCode = `HOOK-${newEpSystem.toUpperCase().replace('_', '')}-0${Math.floor(7 + Math.random() * 90)}`;
    const newEp: WebhookEndpoint = {
      id: `ep-${Date.now()}`,
      code: newCode,
      name: newEpName.trim(),
      direction: newEpDirection,
      targetUrl: newEpUrl.trim(),
      targetSystem: newEpSystem,
      eventSubscriptions: newEpSubscriptions,
      status: 'active',
      successRate: 100.0,
      ttlMinutesRemaining: newEpDirection === 'inbound' ? 4230 : null,
      secretKey: `whsec_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`,
      createdAt: new Date().toISOString().substring(0, 10),
      tenantName: newEpTenant,
      lastDeliveredAt: 'Just created',
      deliveries24h: 0,
      authType: newEpAuth,
      latencyHistory: [90, 85, 95, 100, 88, 92],
    };

    setEndpoints([newEp, ...endpoints]);
    setSelectedEndpointId(newEp.id);
    setShowRegisterModal(false);

    // Reset Form
    setNewEpName('');
    setNewEpUrl('');

    triggerToast('success', 'Webhook Endpoint Registered', `Created ${newCode} (${newEp.name}) with HMAC signing key.`);
  };

  const handleDispatchSandboxEvent = () => {
    setSbIsDispatching(true);

    try {
      const parsedBody = JSON.parse(sbPayloadJson);
      const targetEp = endpoints.find((e) => e.id === sbEndpointId) || endpoints[0];

      setTimeout(() => {
        setSbIsDispatching(false);
        const simResult = {
          statusCode: 200,
          statusText: 'OK',
          latencyMs: Math.floor(75 + Math.random() * 80),
          hmacSignatureCalculated: `sha256=${Math.random().toString(16).substring(2)}4a8b9c0d1e2f3a4b`,
          handshakeVerified: true,
          responseHeaders: {
            'Content-Type': 'application/json',
            'X-Sandbox-Response': 'MOCK_ACK_OK',
          },
          responseBody: JSON.stringify(
            {
              sandboxResult: 'ACCEPTED',
              endpointMatched: targetEp.code,
              targetUrl: targetEp.targetUrl,
              hmacVerification: 'PASSED',
              receivedFields: Object.keys(parsedBody),
            },
            null,
            2
          ),
        };

        setSbDispatchResult(simResult);

        // Inject into attempts list
        const newSimAttempt: WebhookDeliveryAttempt = {
          id: `att-sim-${Date.now()}`,
          endpointId: targetEp.id,
          endpointName: targetEp.name,
          direction: targetEp.direction,
          eventType: sbEventType,
          statusCode: 200,
          statusText: 'OK (Sandbox)',
          latencyMs: simResult.latencyMs,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          requestHeaders: {
            'Host': 'sandbox.msp-nexus.cloud',
            'Content-Type': 'application/json',
            'X-MSP-Signature': simResult.hmacSignatureCalculated,
          },
          requestBody: parsedBody,
          responseHeaders: simResult.responseHeaders,
          responseBody: simResult.responseBody,
          signatureVerified: true,
          retryCount: 0,
        };

        setAttempts((prev) => [newSimAttempt, ...prev]);

        triggerToast('success', 'Sandbox Payload Dispatched', `Sandbox event validated against HMAC secret for ${targetEp.code}.`);
      }, 600);
    } catch (err: any) {
      setSbIsDispatching(false);
      triggerToast('error', 'Invalid Sandbox JSON', 'Please fix the JSON syntax in the payload editor.');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & TELEMETRY KPI BAR */}
      <div className="bg-[#101419] border-b border-[#272f3d] px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-md">
        {/* Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-inner">
            <Webhook className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">M365 Event Subscription &amp; Webhook Dispatch Console</h1>
              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Radio className="w-2.5 h-2.5 animate-ping text-cyan-400" /> HMAC SHA-256 SECURE
              </span>
            </div>
            <p className="text-[11px] text-[#8a919e] font-medium">
              Graph Change Notifications, Defender Security Signals &amp; PSA Outbound Event Pipeline
            </p>
          </div>
        </div>

        {/* Telemetry KPI Cards */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Server className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Configured Endpoints</div>
              <div className="text-xs font-bold text-white font-mono">{metrics.activeEndpoints}</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Deliveries (24h)</div>
              <div className="text-xs font-bold text-emerald-400 font-mono">{metrics.deliveries24h}</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Success Rate</div>
              <div className="text-xs font-bold text-blue-300 font-mono">{metrics.successRate}</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <XCircle className="w-4 h-4 text-red-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Failed Deliveries</div>
              <div className="text-xs font-bold text-red-400 font-mono">{metrics.failedCount}</div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowRegisterModal(true)}
            className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shadow transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            + Register Webhook Endpoint
          </button>

          <button
            onClick={() => setActiveTab('sandbox')}
            className="bg-[#1f293d] hover:bg-[#2a3752] text-cyan-300 border border-cyan-500/30 px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            ⚡ Send Test Payload
          </button>

          <button
            onClick={() => {
              triggerToast('info', 'Delivery Stream Refreshed', 'Fetched latest Graph API & PSA webhook event logs.');
            }}
            className="p-1.5 bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#8a919e] hover:text-white rounded-md transition-all"
            title="Refresh Delivery Stream"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      <div className="bg-[#0c1018] border-b border-[#272f3d] px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search Bar */}
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Endpoint Name, Target URL, Event Type (user.updated), or Code..."
            className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4] transition-colors"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Direction */}
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All Directions</option>
            <option value="inbound">Inbound 📥 (From Graph/Defender)</option>
            <option value="outbound">Outbound 📤 (To PSA/SIEM)</option>
          </select>

          {/* Target System */}
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All Target Systems</option>
            <option value="graph_api">Microsoft Graph API</option>
            <option value="halo_psa">HaloPSA</option>
            <option value="connectwise">ConnectWise Manage</option>
            <option value="slack">Slack / Teams</option>
            <option value="aws_s3">AWS S3 / SIEM</option>
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#272f3d] text-[#c0c7d4] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
          >
            <option value="all">All States</option>
            <option value="active">Active 🟢</option>
            <option value="paused">Paused ⏸️</option>
            <option value="failed">Failed / Expired 🔴</option>
          </select>

          {/* Tenant Context */}
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
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
        </div>

        {/* Navigation Tabs Toggle */}
        <div className="flex items-center gap-1 bg-[#141a26] p-1 rounded-md border border-[#272f3d]">
          <button
            onClick={() => setActiveTab('endpoints')}
            className={cn(
              'px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all',
              activeTab === 'endpoints'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-white'
            )}
          >
            <Server className="w-3.5 h-3.5" />
            Endpoint Directory ({endpoints.length})
          </button>

          <button
            onClick={() => setActiveTab('delivery_stream')}
            className={cn(
              'px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all',
              activeTab === 'delivery_stream'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-white'
            )}
          >
            <Activity className="w-3.5 h-3.5" />
            Live Delivery Stream ({attempts.length})
          </button>

          <button
            onClick={() => setActiveTab('sandbox')}
            className={cn(
              'px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all',
              activeTab === 'sandbox'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-white'
            )}
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            Event Sandbox
          </button>
        </div>
      </div>

      {/* 3. MAIN CONTENT AREA */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'endpoints' && (
          /* TAB 1: ENDPOINT DIRECTORY (SPLIT-PANE: 55% List | 45% Inspector) */
          <div className="flex h-full overflow-hidden">
            {/* LEFT PANE (55% Width): Master Directory Table */}
            <div className="w-[55%] min-w-[340px] border-r border-[#272f3d] bg-[#0c1018] flex flex-col h-full shrink-0">
              <div className="p-2.5 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between text-xs font-semibold text-[#a3c9ff]">
                <span>Registered Webhook Endpoints ({filteredEndpoints.length})</span>
                <span className="text-[10px] text-[#8a919e] font-mono">Real-time Delivery Metrics</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider sticky top-0 border-b border-[#272f3d] font-mono">
                    <tr>
                      <th className="py-2.5 px-3">Direction &amp; Name</th>
                      <th className="py-2.5 px-3">Target Endpoint URI</th>
                      <th className="py-2.5 px-3">Subscriptions</th>
                      <th className="py-2.5 px-3">TTL / Health</th>
                      <th className="py-2.5 px-3">Success Rate</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {filteredEndpoints.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                          No endpoints match current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredEndpoints.map((ep) => {
                        const isSelected = ep.id === activeEndpoint.id;

                        return (
                          <tr
                            key={ep.id}
                            onClick={() => setSelectedEndpointId(ep.id)}
                            className={cn(
                              'cursor-pointer transition-all border-l-2',
                              isSelected
                                ? 'bg-[#161f2e] border-l-[#0078d4] text-white'
                                : 'border-l-transparent hover:bg-[#121722] text-[#c0c7d4]'
                            )}
                          >
                            {/* Direction & Name */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase shrink-0 border',
                                    ep.direction === 'inbound'
                                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                      : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                  )}
                                >
                                  {ep.direction === 'inbound' ? 'IN 📥' : 'OUT 📤'}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-bold text-xs text-white truncate max-w-[170px]" title={ep.name}>
                                    {ep.name}
                                  </div>
                                  <div className="text-[10px] text-[#8a919e] font-mono">{ep.code} • {ep.tenantName}</div>
                                </div>
                              </div>
                            </td>

                            {/* Target URI */}
                            <td className="py-2.5 px-3 font-mono text-[10px] text-[#8a919e]">
                              <div className="truncate max-w-[160px]" title={ep.targetUrl}>
                                {ep.targetUrl}
                              </div>
                            </td>

                            {/* Subscriptions Badges */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                {ep.eventSubscriptions.slice(0, 2).map((sub) => (
                                  <span
                                    key={sub}
                                    className="bg-[#181c22] border border-[#272f3d] text-[9px] text-[#a3c9ff] px-1.5 py-0.5 rounded font-mono"
                                  >
                                    {sub}
                                  </span>
                                ))}
                                {ep.eventSubscriptions.length > 2 && (
                                  <span className="text-[9px] text-[#8a919e] font-mono">
                                    +{ep.eventSubscriptions.length - 2}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* TTL / Health */}
                            <td className="py-2.5 px-3">
                              {ep.direction === 'inbound' && ep.ttlMinutesRemaining !== null ? (
                                <div className="space-y-0.5">
                                  <span
                                    className={cn(
                                      'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1',
                                      ep.ttlMinutesRemaining < 60
                                        ? 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse'
                                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    )}
                                  >
                                    <Clock className="w-2.5 h-2.5" />
                                    {ep.ttlMinutesRemaining}m TTL
                                  </span>
                                  {ep.ttlMinutesRemaining < 60 && (
                                    <div className="text-[9px] text-red-400 font-bold">Renewal Required</div>
                                  )}
                                </div>
                              ) : (
                                <span
                                  className={cn(
                                    'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border',
                                    ep.status === 'active'
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  )}
                                >
                                  {ep.status.toUpperCase()} 🟢
                                </span>
                              )}
                            </td>

                            {/* Success Rate */}
                            <td className="py-2.5 px-3">
                              <div className="font-mono text-xs font-bold text-emerald-400">
                                {ep.successRate.toFixed(1)}%
                              </div>
                              <div className="text-[9px] text-[#8a919e] font-mono">
                                {ep.deliveries24h?.toLocaleString()} req/24h
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTestEndpointAction(ep.id);
                                  }}
                                  className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-cyan-600 text-cyan-300 hover:text-white rounded transition-all"
                                  title="Test Hook Endpoint"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEndpointId(ep.id);
                                  }}
                                  className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-all"
                                  title="Inspect Endpoint Config"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
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

            {/* RIGHT PANE (45% Width): Endpoint Configuration & Secret Key Inspector */}
            <div className="flex-1 bg-[#090d16] flex flex-col h-full overflow-hidden">
              {/* Inspector Header */}
              <div className="p-3 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase border',
                        activeEndpoint.direction === 'inbound'
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      )}
                    >
                      {activeEndpoint.direction.toUpperCase()}
                    </span>
                    <h2 className="text-sm font-bold text-white truncate">{activeEndpoint.name}</h2>
                  </div>
                  <div className="text-[10px] text-[#8a919e] font-mono truncate mt-0.5">
                    {activeEndpoint.code} • Target: {activeEndpoint.targetUrl}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleTestEndpointAction(activeEndpoint.id)}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 shadow transition-all"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Send Test Event
                  </button>

                  {activeEndpoint.direction === 'inbound' && (
                    <button
                      onClick={() => setShowGraphRenewModal(true)}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 shadow transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Renew TTL
                    </button>
                  )}
                </div>
              </div>

              {/* Inspector Scrollable Body */}
              <div className="flex-1 p-4 overflow-y-auto space-y-5 bg-[#090d16]">
                {/* SECTION A: AUTHENTICATION & HMAC SECURITY */}
                <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <KeyRound className="w-4 h-4 text-amber-400" />
                      <span>Section A: Authentication &amp; HMAC SHA-256 Signing Key</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded">
                      AUTH STATUS: ENFORCED 🔒
                    </span>
                  </div>

                  {/* Secret Key Obfuscated Input */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[#8a919e]">HMAC SHA-256 Secret Key:</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showSecretKey ? 'text' : 'password'}
                          value={activeEndpoint.secretKey}
                          readOnly
                          className="w-full bg-[#181c22] border border-[#272f3d] text-amber-300 font-mono text-xs rounded px-3 py-1.5 focus:outline-none"
                        />
                        <button
                          onClick={() => setShowSecretKey(!showSecretKey)}
                          className="absolute right-2.5 top-2 text-[#8a919e] hover:text-white"
                          title={showSecretKey ? 'Hide Secret' : 'Reveal Secret'}
                        >
                          {showSecretKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(activeEndpoint.secretKey);
                          triggerToast('success', 'Secret Key Copied', 'HMAC secret key copied to clipboard.');
                        }}
                        className="bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-white px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-all"
                      >
                        <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        Copy
                      </button>

                      <button
                        onClick={() => {
                          const newKey = `whsec_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
                          setEndpoints((prev) =>
                            prev.map((e) => (e.id === activeEndpoint.id ? { ...e, secretKey: newKey } : e))
                          );
                          triggerToast('warning', 'Secret Key Regenerated', 'Generated new HMAC secret. Downstream clients must be updated.');
                        }}
                        className="bg-[#181c22] border border-[#272f3d] hover:bg-amber-600 text-amber-300 hover:text-white px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Rotate
                      </button>
                    </div>
                  </div>

                  {/* Custom Auth Headers */}
                  {activeEndpoint.customHeaders && (
                    <div className="space-y-1 pt-1">
                      <span className="text-[11px] font-semibold text-[#8a919e]">Configured Custom Headers:</span>
                      <div className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-xs font-mono space-y-1">
                        {Object.entries(activeEndpoint.customHeaders).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-[11px]">
                            <span className="text-cyan-300">{k}:</span>
                            <span className="text-[#8a919e]">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* SECTION B: SUBSCRIBED EVENT TYPES */}
                <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Section B: Subscribed Platform Event Types</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#8a919e]">
                      {activeEndpoint.eventSubscriptions.length} Events Selected
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {EVENT_SUBSCRIPTION_CATALOG.map((cat) => {
                      const isSubbed = activeEndpoint.eventSubscriptions.includes(cat.id);

                      return (
                        <div
                          key={cat.id}
                          onClick={() => handleToggleSubscription(cat.id)}
                          className={cn(
                            'p-2 rounded border cursor-pointer transition-all flex items-center justify-between text-xs',
                            isSubbed
                              ? 'bg-[#122033] border-[#0078d4] text-white'
                              : 'bg-[#181c22] border-[#272f3d] text-[#8a919e] hover:text-white'
                          )}
                        >
                          <div>
                            <div className="font-semibold text-xs">{cat.label}</div>
                            <div className="text-[10px] font-mono text-cyan-400">{cat.id}</div>
                          </div>
                          <div
                            className={cn(
                              'w-4 h-4 rounded flex items-center justify-center border text-[10px]',
                              isSubbed
                                ? 'bg-[#0078d4] border-[#0078d4] text-white'
                                : 'border-[#374151] bg-[#0c1018]'
                            )}
                          >
                            {isSubbed && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SECTION C: RECENT DELIVERY LATENCY & RESPONSE CHART */}
                <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      <span>Section C: Recent Delivery Latency &amp; Response Chart (Last 20 Requests)</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400">
                      Avg Latency:{' '}
                      {activeEndpoint.latencyHistory
                        ? Math.round(
                            activeEndpoint.latencyHistory.reduce((a, b) => a + b, 0) / activeEndpoint.latencyHistory.length
                          )
                        : 110}
                      ms
                    </span>
                  </div>

                  {/* Visual Latency Bar Chart */}
                  <div className="space-y-2">
                    <div className="h-24 flex items-end gap-1.5 pt-4 px-2 bg-[#181c22] rounded border border-[#272f3d]">
                      {(activeEndpoint.latencyHistory || [110, 120, 90, 100, 140]).map((lat, idx) => {
                        const maxLat = 500;
                        const heightPct = Math.min(100, Math.max(12, (lat / maxLat) * 100));

                        return (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col items-center gap-1 group relative"
                            title={`Req #${idx + 1}: ${lat}ms`}
                          >
                            <div
                              className={cn(
                                'w-full rounded-t transition-all',
                                lat > 400
                                  ? 'bg-red-500'
                                  : lat > 200
                                  ? 'bg-amber-400'
                                  : 'bg-emerald-400 group-hover:bg-cyan-300'
                              )}
                              style={{ height: `${heightPct}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#8a919e]">
                      <span>Older Requests (20 events ago)</span>
                      <span>Target SLA Threshold: &lt;500ms</span>
                      <span>Most Recent</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'delivery_stream' && (
          /* TAB 2: LIVE DELIVERY STREAM & PAYLOAD LOG (SPLIT-PANE: 50% Attempt List | 50% Payload Diff) */
          <div className="flex h-full overflow-hidden">
            {/* LEFT PANE (50% Width): Delivery Log Table */}
            <div className="w-1/2 border-r border-[#272f3d] bg-[#0c1018] flex flex-col h-full shrink-0">
              <div className="p-2.5 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between text-xs font-semibold text-[#a3c9ff]">
                <span>Live Delivery Stream ({filteredAttempts.length} Attempts Logged)</span>
                <span className="text-[10px] text-[#8a919e] font-mono">Sorted by Newest</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider sticky top-0 border-b border-[#272f3d] font-mono">
                    <tr>
                      <th className="py-2.5 px-3">Status Code</th>
                      <th className="py-2.5 px-3">Endpoint &amp; Event</th>
                      <th className="py-2.5 px-3">Latency</th>
                      <th className="py-2.5 px-3">Signature</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3 text-right">Replay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {filteredAttempts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[#8a919e]">
                          No delivery attempts match current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredAttempts.map((att) => {
                        const isSelected = att.id === activeAttempt.id;
                        const isSuccess = att.statusCode >= 200 && att.statusCode < 300;

                        return (
                          <tr
                            key={att.id}
                            onClick={() => setSelectedAttemptId(att.id)}
                            className={cn(
                              'cursor-pointer transition-all border-l-2',
                              isSelected
                                ? 'bg-[#161f2e] border-l-[#0078d4] text-white'
                                : 'border-l-transparent hover:bg-[#121722] text-[#c0c7d4]'
                            )}
                          >
                            {/* Status Code */}
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  'text-[10px] font-mono font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1',
                                  isSuccess
                                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                    : 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                                )}
                              >
                                {isSuccess ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                                HTTP {att.statusCode}
                              </span>
                            </td>

                            {/* Endpoint & Event */}
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-xs text-white truncate max-w-[160px]" title={att.endpointName}>
                                {att.endpointName}
                              </div>
                              <div className="text-[10px] text-cyan-400 font-mono">{att.eventType}</div>
                            </td>

                            {/* Latency */}
                            <td className="py-2.5 px-3 font-mono text-[11px] text-[#8a919e]">
                              {att.latencyMs}ms
                            </td>

                            {/* HMAC Signature Status */}
                            <td className="py-2.5 px-3">
                              {att.signatureVerified ? (
                                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-mono px-1.5 py-0.5 rounded">
                                  HMAC VERIFIED 🟢
                                </span>
                              ) : (
                                <span className="bg-red-500/20 text-red-300 border border-red-500/40 text-[9px] font-mono px-1.5 py-0.5 rounded">
                                  UNVERIFIED 🔴
                                </span>
                              )}
                            </td>

                            {/* Timestamp */}
                            <td className="py-2.5 px-3 font-mono text-[10px] text-[#8a919e]">
                              {att.timestamp.split(' ')[1] || att.timestamp}
                            </td>

                            {/* Replay Button */}
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReplayAttemptAction(att.id);
                                }}
                                className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-all"
                                title="Replay Delivery Attempt"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT PANE (50% Width): Payload & Header Inspector */}
            <div className="flex-1 bg-[#090d16] flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="p-3 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-white">Delivery Payload Inspector</h2>
                    <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/20 border border-cyan-500/40 px-2 py-0.5 rounded">
                      {activeAttempt.id}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8a919e] font-mono mt-0.5">
                    {activeAttempt.endpointName} • Event: {activeAttempt.eventType}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReplayAttemptAction(activeAttempt.id)}
                    className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shadow transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Replay Delivery Attempt
                  </button>
                </div>
              </div>

              {/* Sub-Tab Selector (Request Payload vs Response Payload) */}
              <div className="bg-[#141a26] border-b border-[#272f3d] px-4 py-1.5 flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPayloadViewTab('request')}
                    className={cn(
                      'px-3 py-1 rounded text-xs font-semibold transition-all',
                      payloadViewTab === 'request'
                        ? 'bg-[#0078d4] text-white'
                        : 'text-[#8a919e] hover:text-white'
                    )}
                  >
                    Request Headers &amp; Body JSON
                  </button>

                  <button
                    onClick={() => setPayloadViewTab('response')}
                    className={cn(
                      'px-3 py-1 rounded text-xs font-semibold transition-all',
                      payloadViewTab === 'response'
                        ? 'bg-[#0078d4] text-white'
                        : 'text-[#8a919e] hover:text-white'
                    )}
                  >
                    Response Headers &amp; Body Body
                  </button>
                </div>

                <div className="text-[10px] font-mono text-[#8a919e]">
                  Latency: {activeAttempt.latencyMs}ms | Retries: {activeAttempt.retryCount}
                </div>
              </div>

              {/* Monospace Code Inspector Container */}
              <div className="flex-1 p-4 overflow-y-auto bg-[#070a10] font-mono text-xs space-y-4">
                {payloadViewTab === 'request' ? (
                  <>
                    {/* Request Headers */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center justify-between">
                        <span>HTTP Request Headers</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(activeAttempt.requestHeaders, null, 2));
                            triggerToast('success', 'Headers Copied', 'Copied HTTP request headers.');
                          }}
                          className="text-[10px] text-[#8a919e] hover:text-white flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                      <pre className="bg-[#101419] border border-[#272f3d] rounded p-3 text-[#a3c9ff] overflow-x-auto text-[11px]">
                        {Object.entries(activeAttempt.requestHeaders)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n')}
                      </pre>
                    </div>

                    {/* Request Body JSON */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                        <span>JSON Request Body</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(activeAttempt.requestBody, null, 2));
                            triggerToast('success', 'Body Copied', 'Copied JSON request body.');
                          }}
                          className="text-[10px] text-[#8a919e] hover:text-white flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy JSON
                        </button>
                      </div>
                      <pre className="bg-[#101419] border border-[#272f3d] rounded p-3 text-emerald-300 overflow-x-auto text-[11px]">
                        {JSON.stringify(activeAttempt.requestBody, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Response Headers */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-purple-400 uppercase tracking-wider flex items-center justify-between">
                        <span>HTTP Response Headers</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(activeAttempt.responseHeaders, null, 2));
                            triggerToast('success', 'Headers Copied', 'Copied HTTP response headers.');
                          }}
                          className="text-[10px] text-[#8a919e] hover:text-white flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                      <pre className="bg-[#101419] border border-[#272f3d] rounded p-3 text-[#a3c9ff] overflow-x-auto text-[11px]">
                        {Object.entries(activeAttempt.responseHeaders)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n')}
                      </pre>
                    </div>

                    {/* Raw Response Body */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center justify-between">
                        <span>Raw HTTP Response Body</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(activeAttempt.responseBody);
                            triggerToast('success', 'Response Copied', 'Copied response body.');
                          }}
                          className="text-[10px] text-[#8a919e] hover:text-white flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy Body
                        </button>
                      </div>
                      <pre
                        className={cn(
                          'border rounded p-3 overflow-x-auto text-[11px]',
                          activeAttempt.statusCode >= 400
                            ? 'bg-[#1a0f12] border-red-500/40 text-red-300'
                            : 'bg-[#101419] border-[#272f3d] text-amber-200'
                        )}
                      >
                        {activeAttempt.responseBody}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sandbox' && (
          /* TAB 3: WEBHOOK EVENT SIMULATOR & SANDBOX */
          <div className="p-6 h-full overflow-y-auto bg-[#090d16] space-y-6">
            {/* Sandbox Banner */}
            <div className="bg-[#101419] border border-cyan-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Terminal className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Developer Webhook Event Simulator &amp; Sandbox</h2>
                  <p className="text-xs text-[#8a919e]">
                    Craft custom JSON event payloads and test real-time HMAC SHA-256 signature calculation &amp; endpoint handshake validation.
                  </p>
                </div>
              </div>

              <button
                onClick={handleDispatchSandboxEvent}
                disabled={sbIsDispatching}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-md text-xs font-bold flex items-center gap-2 shadow-lg transition-all"
              >
                {sbIsDispatching ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Dispatching...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" /> Dispatch Test Event
                  </>
                )}
              </button>
            </div>

            {/* Form & Editor Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Sandbox Config */}
              <div className="bg-[#101419] border border-[#272f3d] rounded-xl p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" /> Step 1: Target Endpoint &amp; Event Configuration
                </h3>

                {/* Target Endpoint Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#8a919e]">Select Target Webhook Endpoint:</label>
                  <select
                    value={sbEndpointId}
                    onChange={(e) => setSbEndpointId(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#272f3d] text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-[#0078d4]"
                  >
                    {endpoints.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.code} — {ep.name} ({ep.direction.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Event Type Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#8a919e]">Select Mock Event Type:</label>
                  <select
                    value={sbEventType}
                    onChange={(e) => setSbEventType(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#272f3d] text-white rounded px-3 py-2 text-xs focus:outline-none focus:border-[#0078d4]"
                  >
                    <option value="ca_policy.drift">ca_policy.drift (Conditional Access Policy Drift)</option>
                    <option value="alert.critical">alert.critical (Defender Critical SOC Alert)</option>
                    <option value="user.updated">user.updated (Entra ID User Attribute Change)</option>
                    <option value="offboarding.completed">offboarding.completed (7-Step User Offboarding Completed)</option>
                    <option value="threat.ransomware_suspected">threat.ransomware_suspected (Ransomware Anomaly)</option>
                  </select>
                </div>

                {/* Live HMAC Secret Preview */}
                <div className="bg-[#181c22] border border-[#272f3d] rounded p-3 space-y-1 text-xs">
                  <div className="text-[10px] font-mono text-[#8a919e]">Computed HMAC SHA-256 Signing Key:</div>
                  <div className="font-mono text-amber-300 font-bold truncate">
                    {endpoints.find((e) => e.id === sbEndpointId)?.secretKey || 'whsec_key_default'}
                  </div>
                </div>
              </div>

              {/* Right Column: JSON Payload Editor */}
              <div className="bg-[#101419] border border-[#272f3d] rounded-xl p-5 space-y-3 flex flex-col">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    <Code2 className="w-4 h-4" /> Step 2: JSON Payload Editor
                  </h3>
                  <button
                    onClick={() => {
                      setSbPayloadJson(
                        JSON.stringify(
                          {
                            eventId: `sim_evt_${Date.now()}`,
                            eventType: sbEventType,
                            timestamp: new Date().toISOString(),
                            payload: {
                              sampleKey: 'Sample Value',
                              status: 'TEST_DISPATCH',
                            },
                          },
                          null,
                          2
                        )
                      );
                    }}
                    className="text-[10px] text-[#8a919e] hover:text-white underline"
                  >
                    Reset Template
                  </button>
                </div>

                <textarea
                  value={sbPayloadJson}
                  onChange={(e) => setSbPayloadJson(e.target.value)}
                  rows={10}
                  className="w-full flex-1 bg-[#070a10] border border-[#272f3d] rounded p-3 font-mono text-xs text-emerald-300 focus:outline-none focus:border-[#0078d4] resize-none"
                />
              </div>
            </div>

            {/* Sandbox Results Container */}
            {sbDispatchResult && (
              <div className="bg-[#101419] border border-emerald-500/40 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Sandbox Dispatch Response Result (HTTP {sbDispatchResult.statusCode} OK)</span>
                  </div>
                  <span className="text-xs font-mono text-[#8a919e]">
                    Latency: {sbDispatchResult.latencyMs}ms | HMAC: {sbDispatchResult.hmacVerification}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="space-y-1">
                    <span className="text-[#8a919e] font-bold">Generated HMAC SHA-256 Signature Header:</span>
                    <div className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-cyan-300 truncate">
                      {sbDispatchResult.hmacSignatureCalculated}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[#8a919e] font-bold">Handshake Validation Status:</span>
                    <div className="bg-[#181c22] border border-[#272f3d] rounded p-2 text-emerald-400 font-bold">
                      VERIFIED 🟢 (Challenge Handshake Passed)
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-semibold text-[#8a919e]">Downstream API Response Body:</span>
                  <pre className="bg-[#070a10] border border-[#272f3d] rounded p-3 font-mono text-xs text-amber-200 overflow-x-auto">
                    {sbDispatchResult.responseBody}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. MODAL 1: REGISTER NEW WEBHOOK ENDPOINT WIZARD */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2 text-base font-bold text-white">
                <Plus className="w-5 h-5 text-[#0078d4]" />
                <span>Register New Webhook Endpoint</span>
              </div>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="text-[#8a919e] hover:text-white p-1 rounded"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Name */}
              <div className="space-y-1">
                <label className="font-semibold text-[#8a919e]">Endpoint Name:</label>
                <input
                  type="text"
                  value={newEpName}
                  onChange={(e) => setNewEpName(e.target.value)}
                  placeholder="e.g. HaloPSA Critical Threat Alert Forwarder"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              {/* Direction & System */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[#8a919e]">Direction:</label>
                  <select
                    value={newEpDirection}
                    onChange={(e) => setNewEpDirection(e.target.value as any)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="outbound">Outbound 📤 (To PSA/SIEM)</option>
                    <option value="inbound">Inbound 📥 (From Graph/Defender)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[#8a919e]">Target System:</label>
                  <select
                    value={newEpSystem}
                    onChange={(e) => setNewEpSystem(e.target.value as any)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="halo_psa">HaloPSA</option>
                    <option value="connectwise">ConnectWise Manage</option>
                    <option value="graph_api">Microsoft Graph API</option>
                    <option value="slack">Slack / Teams</option>
                    <option value="aws_s3">AWS S3 / SIEM</option>
                    <option value="custom_https">Custom HTTPS Endpoint</option>
                  </select>
                </div>
              </div>

              {/* Target URL */}
              <div className="space-y-1">
                <label className="font-semibold text-[#8a919e]">Target Webhook URL:</label>
                <input
                  type="text"
                  value={newEpUrl}
                  onChange={(e) => setNewEpUrl(e.target.value)}
                  placeholder="https://your-psa.com/api/webhooks/v1"
                  className="w-full bg-[#181c22] border border-[#272f3d] font-mono text-xs rounded px-3 py-2 text-cyan-300 focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              {/* Tenant & Auth Type */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[#8a919e]">Tenant Scope:</label>
                  <select
                    value={newEpTenant}
                    onChange={(e) => setNewEpTenant(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="Contoso Corp">Contoso Corp</option>
                    <option value="Fabrikam Inc">Fabrikam Inc</option>
                    <option value="Northwind Traders">Northwind Traders</option>
                    <option value="Litware Systems">Litware Systems</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[#8a919e]">Auth Protocol:</label>
                  <select
                    value={newEpAuth}
                    onChange={(e) => setNewEpAuth(e.target.value as any)}
                    className="w-full bg-[#181c22] border border-[#272f3d] rounded px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="hmac">HMAC SHA-256 Signature</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Credentials</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#272f3d] pt-4">
              <button
                onClick={() => setShowRegisterModal(false)}
                className="px-3 py-1.5 rounded bg-[#181c22] hover:bg-[#222832] text-xs font-semibold text-[#8a919e]"
              >
                Cancel
              </button>
              <button
                onClick={handleRegisterNewEndpoint}
                className="px-4 py-1.5 rounded bg-[#0078d4] hover:bg-[#0063b1] text-xs font-semibold text-white shadow"
              >
                Register &amp; Generate HMAC Secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL 2: GRAPH SUBSCRIPTION TTL RENEWAL CONFIRMATION */}
      {showGraphRenewModal && activeEndpoint && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-purple-500/40 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[#272f3d] pb-3">
              <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
              <div>
                <h3 className="text-base font-bold text-white">Renew Graph API Subscription</h3>
                <p className="text-xs text-[#8a919e] font-mono">{activeEndpoint.code}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-[#c0c7d4]">
                Microsoft Graph API Change Notifications require explicit renewal before expiration.
              </p>

              <div className="bg-[#181c22] border border-[#272f3d] rounded p-3 space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-[#8a919e]">Current Remaining TTL:</span>
                  <span className="text-amber-400 font-bold">{activeEndpoint.ttlMinutesRemaining} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8a919e]">Extension Duration:</span>
                  <span className="text-emerald-400 font-bold">+4,230 min (3 Days)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8a919e]">Validation Challenge:</span>
                  <span className="text-cyan-300">validationToken handshake</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#272f3d] pt-3">
              <button
                onClick={() => setShowGraphRenewModal(false)}
                className="px-3 py-1.5 rounded bg-[#181c22] text-xs text-[#8a919e]"
              >
                Cancel
              </button>
              <button
                onClick={handleRenewGraphSubscription}
                className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white shadow"
              >
                Renew Graph Subscription
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

