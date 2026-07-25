import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Siren,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  FileText,
  Sparkles,
  ChevronRight,
  Terminal,
  Users,
  Monitor,
  Mail,
  KeyRound,
  Copy,
  ExternalLink,
  Shield,
  Clock,
  ArrowUpRight,
  Flame,
  Check,
  RotateCcw,
  Building2,
  WifiOff,
  UserX,
  Ban,
  X,
  Eye,
  Sliders,
  Send,
  Radio,
  Layers,
  Cpu,
  HelpCircle,
  Play,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
export type WorkloadType = 'Entra ID' | 'Defender EDR' | 'Intune' | 'Exchange Online' | 'SharePoint / Teams';
export type MitigationStatus = 'Pending Action' | 'Isolated' | 'Session Revoked' | 'Remediated' | 'In Progress' | 'Auto-Healed';

export interface TimelineEvent {
  timestamp: string;
  action: string;
  actor: string;
  status: 'success' | 'warning' | 'info' | 'failed';
}

export interface SecurityIncident {
  id: string;
  incidentNumber: string;
  tenantId: string;
  tenantName: string;
  title: string;
  severity: SeverityLevel;
  workload: WorkloadType;
  status: 'Active' | 'Investigating' | 'Auto-Healed' | 'Resolved' | 'Dismissed';
  createdTimestamp: string;
  lastUpdatedTimestamp: string;
  affectedUserUPN?: string;
  affectedDeviceId?: string;
  affectedDeviceName?: string;
  threatCategory: 'Identity Compromise' | 'Ransomware Activity' | 'Phishing / Token Theft' | 'Privilege Escalation' | 'Data Exfiltration' | 'Malware Execution';
  mitigationStatus: MitigationStatus;
  attackTechniqueId: string; // MITRE ATT&CK ID e.g. T1078.004
  attackVector: string;
  riskScore: number; // 0-100
  evidenceCount: number;
  description: string;
  graphAlertId: string; // Microsoft Graph Alert v2 GUID
  recommendedActions: string[];
  timeline: TimelineEvent[];
}

export interface SecurityPostureBaseline {
  tenantId: string;
  tenantName: string;
  secureScore: number;
  maxScore: number;
  zeroTrustAlignmentPercent: number;
  mfaEnforcementPercent: number;
  conditionalAccessBaselineStatus: 'Enforced' | 'Drift Detected' | 'Audit Mode' | 'Non-Compliant';
  defenderEdrCoveragePercent: number;
  intuneCompliancePercent: number;
  activeHighCriticalAlerts: number;
  autoHealedThreats24h: number;
  lastAssessed: string;
}

interface SecurityPillarConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
}

// ==========================================
// MOCK DATA SEEDS
// ==========================================

const INITIAL_POSTURE_BASELINES: SecurityPostureBaseline[] = [
  {
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    secureScore: 742,
    maxScore: 850,
    zeroTrustAlignmentPercent: 94,
    mfaEnforcementPercent: 98,
    conditionalAccessBaselineStatus: 'Enforced',
    defenderEdrCoveragePercent: 99,
    intuneCompliancePercent: 95,
    activeHighCriticalAlerts: 2,
    autoHealedThreats24h: 18,
    lastAssessed: '2 mins ago',
  },
  {
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    secureScore: 580,
    maxScore: 850,
    zeroTrustAlignmentPercent: 78,
    mfaEnforcementPercent: 82,
    conditionalAccessBaselineStatus: 'Drift Detected',
    defenderEdrCoveragePercent: 88,
    intuneCompliancePercent: 81,
    activeHighCriticalAlerts: 3,
    autoHealedThreats24h: 11,
    lastAssessed: '5 mins ago',
  },
  {
    tenantId: 't-northwind-03',
    tenantName: 'Northwind Traders',
    secureScore: 810,
    maxScore: 850,
    zeroTrustAlignmentPercent: 97,
    mfaEnforcementPercent: 100,
    conditionalAccessBaselineStatus: 'Enforced',
    defenderEdrCoveragePercent: 100,
    intuneCompliancePercent: 98,
    activeHighCriticalAlerts: 0,
    autoHealedThreats24h: 9,
    lastAssessed: '1 min ago',
  },
  {
    tenantId: 't-litware-04',
    tenantName: 'Litware Systems',
    secureScore: 620,
    maxScore: 850,
    zeroTrustAlignmentPercent: 81,
    mfaEnforcementPercent: 89,
    conditionalAccessBaselineStatus: 'Audit Mode',
    defenderEdrCoveragePercent: 92,
    intuneCompliancePercent: 86,
    activeHighCriticalAlerts: 1,
    autoHealedThreats24h: 6,
    lastAssessed: '8 mins ago',
  },
  {
    tenantId: 't-adventure-05',
    tenantName: 'AdventureWorks',
    secureScore: 715,
    maxScore: 850,
    zeroTrustAlignmentPercent: 91,
    mfaEnforcementPercent: 96,
    conditionalAccessBaselineStatus: 'Enforced',
    defenderEdrCoveragePercent: 97,
    intuneCompliancePercent: 93,
    activeHighCriticalAlerts: 1,
    autoHealedThreats24h: 4,
    lastAssessed: '4 mins ago',
  },
  {
    tenantId: 't-woodgrove-06',
    tenantName: 'Woodgrove Bank',
    secureScore: 835,
    maxScore: 850,
    zeroTrustAlignmentPercent: 99,
    mfaEnforcementPercent: 100,
    conditionalAccessBaselineStatus: 'Enforced',
    defenderEdrCoveragePercent: 100,
    intuneCompliancePercent: 99,
    activeHighCriticalAlerts: 0,
    autoHealedThreats24h: 14,
    lastAssessed: 'Just now',
  },
];

const INITIAL_INCIDENTS: SecurityIncident[] = [
  {
    id: 'inc-9901',
    incidentNumber: 'INC-2026-9901',
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    title: 'CRITICAL: Suspicious Token Replay & Impossible Travel Detected',
    severity: 'CRITICAL',
    workload: 'Entra ID',
    status: 'Active',
    createdTimestamp: '2026-07-24 08:42:10',
    lastUpdatedTimestamp: '2026-07-24 09:05:00',
    affectedUserUPN: 'adele.vance@contoso.com',
    affectedDeviceId: 'dev-win11-8812',
    affectedDeviceName: 'DESKTOP-FIN-09',
    threatCategory: 'Phishing / Token Theft',
    mitigationStatus: 'Pending Action',
    attackTechniqueId: 'T1550.004',
    attackVector: 'AitM Phishing Proxy (Evilginx2 framework signature)',
    riskScore: 96,
    evidenceCount: 14,
    description:
      'Entra ID Protection triggered High User Risk alert for Adele Vance. Session cookie replay detected simultaneously from Lagos, Nigeria (IP 197.210.8.12) and Seattle, WA within 90 seconds. Primary ESTSAuth token used to query M365 Mailbox and Graph API contacts.',
    graphAlertId: 'a89f12bc-9901-4912-8812-102938475612',
    recommendedActions: [
      'Revoke all active Entra ID user refresh tokens immediately',
      'Enforce Password Reset & FIDO2 re-registration',
      'Isolate registered device DESKTOP-FIN-09 via Defender EDR',
      'Audit inbox rule additions created in past 24 hours',
    ],
    timeline: [
      {
        timestamp: '08:42:10',
        action: 'Alert generated by Entra ID Protection (Risk Score 96)',
        actor: 'Microsoft Defender for Identity',
        status: 'warning',
      },
      {
        timestamp: '08:43:00',
        action: 'Automated SOC ticket created in HaloPSA (#HALO-88120)',
        actor: 'MSP Sync Engine',
        status: 'info',
      },
      {
        timestamp: '08:45:12',
        action: 'User risk elevated to HIGH in Entra ID Tenant Directory',
        actor: 'Entra Risk Engine',
        status: 'warning',
      },
    ],
  },
  {
    id: 'inc-9902',
    incidentNumber: 'INC-2026-9902',
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    title: 'CRITICAL: Cobalt Strike Beacon Memory Injection Activity',
    severity: 'CRITICAL',
    workload: 'Defender EDR',
    status: 'Active',
    createdTimestamp: '2026-07-24 08:15:33',
    lastUpdatedTimestamp: '2026-07-24 08:50:12',
    affectedUserUPN: 'm.vance@fabrikam.com',
    affectedDeviceId: 'dev-srv-0091',
    affectedDeviceName: 'DC01-FABRIKAM-PROD',
    threatCategory: 'Ransomware Activity',
    mitigationStatus: 'Pending Action',
    attackTechniqueId: 'T1055.001',
    attackVector: 'Process Hollowing in lsass.exe via PowerShell Stager',
    riskScore: 98,
    evidenceCount: 22,
    description:
      'Defender for Endpoint detected suspicious DLL reflective injection into lsass.exe on domain controller DC01-FABRIKAM-PROD. C2 traffic observed communicating with 185.220.101.5:443 matching Cobalt Strike malleable profile.',
    graphAlertId: 'b77c34de-8812-421b-[#8a919e]-991827364501',
    recommendedActions: [
      'Isolate endpoint DC01-FABRIKAM-PROD immediately from corporate subnet',
      'Initiate Automated Defender EDR Investigation & Memory Scan',
      'Block egress IP 185.220.101.5 on perimeter firewall',
      'Reset KRBTGT and Domain Admin credentials',
    ],
    timeline: [
      {
        timestamp: '08:15:33',
        action: 'Process Injection Detected in lsass.exe by MDE Sensor',
        actor: 'Defender EDR Agent v10.82',
        status: 'warning',
      },
      {
        timestamp: '08:16:05',
        action: 'Automated Playbook #PB-EDR-09 Triggered',
        actor: 'MSP Security SOAR',
        status: 'info',
      },
    ],
  },
  {
    id: 'inc-9903',
    incidentNumber: 'INC-2026-9903',
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    title: 'HIGH: Mass Exfiltration via External OneDrive Anonymous Sharing Link',
    severity: 'HIGH',
    workload: 'SharePoint / Teams',
    status: 'Active',
    createdTimestamp: '2026-07-24 07:30:00',
    lastUpdatedTimestamp: '2026-07-24 08:10:44',
    affectedUserUPN: 'j.smith@fabrikam.com',
    threatCategory: 'Data Exfiltration',
    mitigationStatus: 'Pending Action',
    attackTechniqueId: 'T1567.002',
    attackVector: 'Anonymous Anyone Link Creation on Financial Folder',
    riskScore: 84,
    evidenceCount: 8,
    description:
      'Purview DLP sensor flagged 1,420 sensitive PDF files containing PCI & SSN records downloaded in bulk via an anonymous share link created on John Smith OneDrive. Over 4.2 GB downloaded from unexpected IP ranges in Eastern Europe.',
    graphAlertId: 'c11d45ef-0012-491a-9912-881273645012',
    recommendedActions: [
      'Revoke all anonymous sharing links on affected OneDrive site',
      'Enforce Purview DLP hard blocking policy on PCI data',
      'Restrict external sharing permissions to existing guests only',
    ],
    timeline: [
      {
        timestamp: '07:30:00',
        action: 'DLP High Volume Exfiltration Alert Fired',
        actor: 'Microsoft Purview DLP',
        status: 'warning',
      },
    ],
  },
  {
    id: 'inc-9904',
    incidentNumber: 'INC-2026-9904',
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    title: 'HIGH: Unvalidated OAuth App Consent with Mail.ReadWrite Granted',
    severity: 'HIGH',
    workload: 'Entra ID',
    status: 'Investigating',
    createdTimestamp: '2026-07-24 06:12:00',
    lastUpdatedTimestamp: '2026-07-24 08:30:15',
    affectedUserUPN: 'p.allen@contoso.com',
    threatCategory: 'Privilege Escalation',
    mitigationStatus: 'In Progress',
    attackTechniqueId: 'T1528',
    attackVector: 'OAuth Application Consent Phish (AppName: "PDF Helper Pro")',
    riskScore: 79,
    evidenceCount: 5,
    description:
      'User consented to unverified multi-tenant app "PDF Helper Pro" (AppId: 00192837-1102) requesting offline_access, Mail.ReadWrite, and Contacts.Read. App publisher domain is unverified.',
    graphAlertId: 'd22e56fa-1123-481b-8812-771829304152',
    recommendedActions: [
      'Revoke OAuth consent grant for App ID 00192837-1102 across tenant',
      'Disable user consent for unverified apps in Entra Enterprise Apps',
      'Audit app service principal permissions',
    ],
    timeline: [
      {
        timestamp: '06:12:00',
        action: 'OAuth Consent Granted by User',
        actor: 'Entra Audit Log',
        status: 'info',
      },
      {
        timestamp: '06:14:00',
        action: 'Flagged by Admin Consent Workflow Policy',
        actor: 'Entra Security Engine',
        status: 'warning',
      },
    ],
  },
  {
    id: 'inc-9905',
    incidentNumber: 'INC-2026-9905',
    tenantId: 't-litware-04',
    tenantName: 'Litware Systems',
    title: 'HIGH: Intune Endpoint Non-Compliant - BitLocker Disabled & EDR Stopped',
    severity: 'HIGH',
    workload: 'Intune',
    status: 'Active',
    createdTimestamp: '2026-07-24 05:40:11',
    lastUpdatedTimestamp: '2026-07-24 07:12:00',
    affectedDeviceId: 'dev-lit-9912',
    affectedDeviceName: 'LAPTOP-EXEC-01',
    affectedUserUPN: 'e.miller@litware.com',
    threatCategory: 'Malware Execution',
    mitigationStatus: 'Pending Action',
    attackTechniqueId: 'T1562.001',
    attackVector: 'Local Administrator tampering with Sense service & Volume Encryption',
    riskScore: 76,
    evidenceCount: 6,
    description:
      'Intune compliance engine reported BitLocker encryption status turned off and Windows Defender Antivirus service stopped on LAPTOP-EXEC-01. Conditional Access policy blocked M365 cloud access due to non-compliance state.',
    graphAlertId: 'e33f67ab-2234-471c-9912-661728394012',
    recommendedActions: [
      'Initiate Remote Wipe or Lock via Intune MDM API',
      'Force Defender EDR service restart via Sense MDM payload',
      'Re-enable BitLocker policy remotely',
    ],
    timeline: [
      {
        timestamp: '05:40:11',
        action: 'Compliance status set to Non-Compliant',
        actor: 'Microsoft Intune MDM',
        status: 'warning',
      },
    ],
  },
  {
    id: 'inc-9906',
    incidentNumber: 'INC-2026-9906',
    tenantId: 't-adventure-05',
    tenantName: 'AdventureWorks',
    title: 'MED: Malicious Inbox Rule Created Targeting External Gmail Address',
    severity: 'MED',
    workload: 'Exchange Online',
    status: 'Auto-Healed',
    createdTimestamp: '2026-07-23 22:15:00',
    lastUpdatedTimestamp: '2026-07-23 22:16:30',
    affectedUserUPN: 't.wilson@adventureworks.com',
    threatCategory: 'Phishing / Token Theft',
    mitigationStatus: 'Auto-Healed',
    attackTechniqueId: 'T1114.003',
    attackVector: 'Exchange Web Services (EWS) Rule Injection',
    riskScore: 58,
    evidenceCount: 4,
    description:
      'Inbox rule "..." created with condition "Subject contains Invoice or Payment" and action "Forward to exfil.sec99@gmail.com and Delete". Automated Defender for Office 365 playbook auto-deleted rule and revoked session.',
    graphAlertId: 'f44a78bc-3345-461d-8812-551627384901',
    recommendedActions: ['Review user audit history', 'Confirm MFA enforcement'],
    timeline: [
      {
        timestamp: '22:15:00',
        action: 'Suspicious Forwarding Rule Detected',
        actor: 'Defender for Office 365',
        status: 'warning',
      },
      {
        timestamp: '22:16:30',
        action: 'Rule hard deleted & session revoked automatically',
        actor: 'MSP Auto-Heal SOAR Engine',
        status: 'success',
      },
    ],
  },
  {
    id: 'inc-9907',
    incidentNumber: 'INC-2026-9907',
    tenantId: 't-woodgrove-06',
    tenantName: 'Woodgrove Bank',
    title: 'MED: Brute-Force Password Spray Attack on Privileged Admin Accounts',
    severity: 'MED',
    workload: 'Entra ID',
    status: 'Resolved',
    createdTimestamp: '2026-07-23 18:00:00',
    lastUpdatedTimestamp: '2026-07-24 02:10:00',
    affectedUserUPN: 'admin.global@woodgrove.com',
    threatCategory: 'Identity Compromise',
    mitigationStatus: 'Remediated',
    attackTechniqueId: 'T1110.003',
    attackVector: 'Distributed Password Spray via Tor Exit Nodes',
    riskScore: 52,
    evidenceCount: 340,
    description:
      'Over 4,500 failed sign-in attempts targeting 12 admin UPNs from 82 distinct Tor exit node IPs. All attempts blocked by Conditional Access location policy and Smart Lockout.',
    graphAlertId: 'g55b89cd-4456-451e-9912-441526374890',
    recommendedActions: ['Block Tor exit node range on CA Location policy', 'Verify PIM activation logs'],
    timeline: [
      {
        timestamp: '18:00:00',
        action: 'Smart Lockout triggered for 12 accounts',
        actor: 'Entra Smart Lockout',
        status: 'success',
      },
    ],
  },
  {
    id: 'inc-9908',
    incidentNumber: 'INC-2026-9908',
    tenantId: 't-northwind-03',
    tenantName: 'Northwind Traders',
    title: 'LOW: Legacy Authentication Protocol Attempt Blocked by CA Policy',
    severity: 'LOW',
    workload: 'Entra ID',
    status: 'Resolved',
    createdTimestamp: '2026-07-23 14:10:00',
    lastUpdatedTimestamp: '2026-07-23 14:10:05',
    affectedUserUPN: 'b.davis@northwind.com',
    threatCategory: 'Identity Compromise',
    mitigationStatus: 'Remediated',
    attackTechniqueId: 'T1078.004',
    attackVector: 'IMAP4 / POP3 Basic Auth Attempt',
    riskScore: 25,
    evidenceCount: 2,
    description:
      'Legacy IMAP authentication attempt blocked automatically by Conditional Access baseline rule "CA001-Block-Legacy-Auth". User notified to switch to Modern Auth client.',
    graphAlertId: 'h66c90de-5567-441f-9912-331425364789',
    recommendedActions: ['No further action required'],
    timeline: [
      {
        timestamp: '14:10:05',
        action: 'Blocked by Policy CA001-Block-Legacy-Auth',
        actor: 'Entra CA Engine',
        status: 'success',
      },
    ],
  },
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export const SecurityPillarConsole: React.FC<SecurityPillarConsoleProps> = ({
  tenants = [],
  onShowToast,
  onExecuteWorkflow,
}) => {
  // Navigation View Sub-Tab inside Security Pillar
  const [activeViewTab, setActiveViewTab] = useState<'incidents' | 'posture' | 'ca_baselines'>('incidents');

  // Core Data States
  const [incidents, setIncidents] = useState<SecurityIncident[]>(INITIAL_INCIDENTS);
  const [postureBaselines] = useState<SecurityPostureBaseline[]>(INITIAL_POSTURE_BASELINES);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('inc-9901');

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [workloadFilter, setWorkloadFilter] = useState<string>('ALL');
  const [mitigationFilter, setMitigationFilter] = useState<string>('ALL');

  // UI Interactive States
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExecutingGraphAction, setIsExecutingGraphAction] = useState(false);
  const [actionProgressMessage, setActionProgressMessage] = useState<string | null>(null);
  const [showJsonInspector, setShowJsonInspector] = useState(false);

  // Helper Toast Trigger
  const triggerToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // Currently Selected Incident Object
  const selectedIncident = useMemo(() => {
    return incidents.find((inc) => inc.id === selectedIncidentId) || incidents[0];
  }, [incidents, selectedIncidentId]);

  // Filtered Incidents List
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Search
      const matchesSearch =
        searchTerm === '' ||
        inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inc.incidentNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inc.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inc.affectedUserUPN && inc.affectedUserUPN.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inc.affectedDeviceName && inc.affectedDeviceName.toLowerCase().includes(searchTerm.toLowerCase()));

      // Tenant
      const matchesTenant = tenantFilter === 'ALL' || inc.tenantId === tenantFilter;

      // Severity
      const matchesSeverity = severityFilter === 'ALL' || inc.severity === severityFilter;

      // Workload
      const matchesWorkload = workloadFilter === 'ALL' || inc.workload === workloadFilter;

      // Mitigation
      const matchesMitigation = mitigationFilter === 'ALL' || inc.mitigationStatus === mitigationFilter;

      return matchesSearch && matchesTenant && matchesSeverity && matchesWorkload && matchesMitigation;
    });
  }, [incidents, searchTerm, tenantFilter, severityFilter, workloadFilter, mitigationFilter]);

  // Aggregate Metrics for Header
  const aggregateMetrics = useMemo(() => {
    const totalMax = postureBaselines.reduce((acc, b) => acc + b.maxScore, 0);
    const totalEarned = postureBaselines.reduce((acc, b) => acc + b.secureScore, 0);
    const avgSecureScorePct = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0;

    const activeHighCritical = incidents.filter(
      (inc) => (inc.severity === 'CRITICAL' || inc.severity === 'HIGH') && inc.status !== 'Resolved' && inc.status !== 'Auto-Healed'
    ).length;

    const avgZeroTrust = Math.round(
      postureBaselines.reduce((acc, b) => acc + b.zeroTrustAlignmentPercent, 0) / postureBaselines.length
    );

    const autoHealed24h = postureBaselines.reduce((acc, b) => acc + b.autoHealedThreats24h, 0);

    return {
      avgSecureScorePct,
      totalEarned,
      totalMax,
      activeHighCritical,
      avgZeroTrust,
      autoHealed24h,
    };
  }, [postureBaselines, incidents]);

  // Handler: Manual Refresh Telemetry
  const handleRefreshTelemetry = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      triggerToast('success', 'Security Telemetry Refreshed', 'Synced latest Defender EDR v2 alerts and Entra Risk signals across 25 tenants.');
    }, 600);
  };

  // Handler: Execute Graph Action (e.g., Revoke Sessions, Isolate Device, Block Sender)
  const handleExecuteGraphAction = (
    actionType: 'REVOKE_SESSIONS' | 'ISOLATE_DEVICE' | 'BLOCK_SENDER' | 'ELEVATE_USER_RISK',
    target: string
  ) => {
    if (!selectedIncident) return;

    setIsExecutingGraphAction(true);
    setActionProgressMessage(`Executing Microsoft Graph API: ${actionType} on target ${target}...`);

    setTimeout(() => {
      let actionLabel = '';
      let newMitigationStatus: MitigationStatus = 'Remediated';

      if (actionType === 'REVOKE_SESSIONS') {
        actionLabel = `Revoked all Entra ID sessions for ${target}`;
        newMitigationStatus = 'Session Revoked';
      } else if (actionType === 'ISOLATE_DEVICE') {
        actionLabel = `Isolated device ${target} via Defender EDR Agent`;
        newMitigationStatus = 'Isolated';
      } else if (actionType === 'BLOCK_SENDER') {
        actionLabel = `Added ${target} to Tenant Blocked Senders List`;
        newMitigationStatus = 'Remediated';
      } else if (actionType === 'ELEVATE_USER_RISK') {
        actionLabel = `Forced High Risk state & Password Reset on ${target}`;
        newMitigationStatus = 'In Progress';
      }

      // Update incident state locally
      const updatedTimelineEvent: TimelineEvent = {
        timestamp: new Date().toTimeString().substring(0, 8),
        action: `${actionLabel} (Graph API HTTP 200 OK)`,
        actor: 'Shane McCaw (SOC Director)',
        status: 'success',
      };

      setIncidents((prev) =>
        prev.map((inc) => {
          if (inc.id === selectedIncident.id) {
            return {
              ...inc,
              mitigationStatus: newMitigationStatus,
              status: 'Investigating',
              timeline: [updatedTimelineEvent, ...inc.timeline],
            };
          }
          return inc;
        })
      );

      setIsExecutingGraphAction(false);
      setActionProgressMessage(null);

      triggerToast('success', '1-Click Remediation Applied', `${actionLabel}. Graph endpoint responded in 180ms.`);

      if (onExecuteWorkflow) {
        onExecuteWorkflow(actionType, {
          incidentId: selectedIncident.id,
          tenantId: selectedIncident.tenantId,
          target,
        });
      }
    }, 1000);
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & ZERO TRUST KPI AGGREGATE BAR */}
      <div className="bg-[#101419] border-b border-[#272f3d] px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        {/* Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-inner">
            <ShieldAlert className="w-5 h-5 text-red-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">Zero Trust &amp; Threat Protection Console</h1>
              <span className="bg-red-500/20 text-red-300 border border-red-500/40 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Siren className="w-2.5 h-2.5 text-red-400 animate-bounce" /> DEFENDER V2 GRAPH API
              </span>
            </div>
            <p className="text-[11px] text-[#8a919e] font-medium">
              Real-time M365 Security Posture, EDR Threat Isolation &amp; Automated Conditional Access Governance
            </p>
          </div>
        </div>

        {/* Global KPI Summary Cards */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Secure Score Aggregate */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Aggregate Secure Score</div>
              <div className="text-xs font-bold text-emerald-400 font-mono">
                {aggregateMetrics.avgSecureScorePct}% <span className="text-[10px] text-[#8a919e]">({aggregateMetrics.totalEarned}/{aggregateMetrics.totalMax})</span>
              </div>
            </div>
          </div>

          {/* Active High/Critical Alerts */}
          <div className="bg-[#181c22] border border-red-500/30 rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Active High/Critical</div>
              <div className="text-xs font-bold text-red-400 font-mono">
                {aggregateMetrics.activeHighCritical} Incidents Requiring SOC
              </div>
            </div>
          </div>

          {/* Zero Trust Alignment */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Zero Trust Alignment</div>
              <div className="text-xs font-bold text-cyan-300 font-mono">
                {aggregateMetrics.avgZeroTrust}% Compliant
              </div>
            </div>
          </div>

          {/* 24h Auto-Healed Threats */}
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">24h Auto-Healed</div>
              <div className="text-xs font-bold text-amber-300 font-mono">
                {aggregateMetrics.autoHealed24h} Threats Mitigated
              </div>
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefreshTelemetry}
            disabled={isRefreshing}
            className="bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#c0c7d4] hover:text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 text-cyan-400', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Syncing...' : 'Sync Graph Feed'}
          </button>
        </div>
      </div>

      {/* 2. SUB-TAB VIEW NAVIGATION & MULTI-FILTER ROW */}
      <div className="bg-[#0c1018] border-b border-[#272f3d] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Navigation Sub-Tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveViewTab('incidents')}
            className={cn(
              'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all',
              activeViewTab === 'incidents'
                ? 'bg-[#0078d4] text-white shadow'
                : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
            )}
          >
            <Siren className="w-3.5 h-3.5 text-red-300" />
            Active Threat Telemetry &amp; Incidents ({filteredIncidents.length})
          </button>

          <button
            onClick={() => setActiveViewTab('posture')}
            className={cn(
              'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-all',
              activeViewTab === 'posture'
                ? 'bg-[#0078d4] text-white shadow'
                : 'bg-[#141a26] text-[#8a919e] hover:text-white border border-[#272f3d]'
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            Tenant Zero Trust Posture Matrix ({postureBaselines.length})
          </button>
        </div>

        {/* Filter Controls (Only when in Incidents view) */}
        {activeViewTab === 'incidents' && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search UPN, Device, Incident #..."
                className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
              />
            </div>

            {/* Tenant Filter */}
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="bg-[#181c22] border border-[#272f3d] text-xs text-white rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
            >
              <option value="ALL">All Managed Tenants</option>
              {postureBaselines.map((b) => (
                <option key={b.tenantId} value={b.tenantId}>
                  {b.tenantName}
                </option>
              ))}
            </select>

            {/* Severity Filter */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-[#181c22] border border-[#272f3d] text-xs text-white rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">🔴 CRITICAL</option>
              <option value="HIGH">🟠 HIGH</option>
              <option value="MED">🟡 MED</option>
              <option value="LOW">🔵 LOW</option>
            </select>

            {/* Workload Filter */}
            <select
              value={workloadFilter}
              onChange={(e) => setWorkloadFilter(e.target.value)}
              className="bg-[#181c22] border border-[#272f3d] text-xs text-white rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
            >
              <option value="ALL">All Workloads</option>
              <option value="Entra ID">Entra ID</option>
              <option value="Defender EDR">Defender EDR</option>
              <option value="Intune">Intune MDM</option>
              <option value="Exchange Online">Exchange Online</option>
              <option value="SharePoint / Teams">SharePoint / Teams</option>
            </select>

            {/* Mitigation Status Filter */}
            <select
              value={mitigationFilter}
              onChange={(e) => setMitigationFilter(e.target.value)}
              className="bg-[#181c22] border border-[#272f3d] text-xs text-white rounded-md px-2.5 py-1.5 focus:outline-none focus:border-[#0078d4]"
            >
              <option value="ALL">All Mitigations</option>
              <option value="Pending Action">Pending Action</option>
              <option value="Isolated">Isolated</option>
              <option value="Session Revoked">Session Revoked</option>
              <option value="In Progress">In Progress</option>
              <option value="Remediated">Remediated</option>
              <option value="Auto-Healed">Auto-Healed</option>
            </select>
          </div>
        )}
      </div>

      {/* 3. SPLIT-PANE WORKSPACE / TAB CONTENT */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeViewTab === 'incidents' && (
          <div className="h-full flex flex-col md:flex-row min-h-0">
            {/* LEFT PANE (60%): Active Security Incidents Table / Matrix */}
            <div className="w-full md:w-[60%] border-r border-[#272f3d] flex flex-col min-h-0 bg-[#0d111a]">
              {/* Header Info Bar */}
              <div className="bg-[#141a26] border-b border-[#272f3d] px-3.5 py-2 flex items-center justify-between text-xs shrink-0">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  Defender v2 Live Incident Stream ({filteredIncidents.length} items)
                </span>
                <span className="text-[10px] text-[#8a919e] font-mono">Sorted by Risk Score &amp; Recency</span>
              </div>

              {/* Incidents List Container */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {filteredIncidents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-[#8a919e] space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    <p className="text-xs">No active threat incidents matching selected filter criteria.</p>
                  </div>
                ) : (
                  filteredIncidents.map((inc) => {
                    const isSelected = inc.id === selectedIncidentId;

                    return (
                      <div
                        key={inc.id}
                        onClick={() => setSelectedIncidentId(inc.id)}
                        className={cn(
                          'p-3 rounded-lg border transition-all cursor-pointer relative space-y-2',
                          isSelected
                            ? 'bg-[#182234] border-[#0078d4] shadow-md ring-1 ring-[#0078d4]'
                            : 'bg-[#101419] border-[#272f3d] hover:border-cyan-500/40 hover:bg-[#141a24]'
                        )}
                      >
                        {/* Row Header: Badges & Tenant */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Severity Badge */}
                            <span
                              className={cn(
                                'text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase',
                                inc.severity === 'CRITICAL' && 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse',
                                inc.severity === 'HIGH' && 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                                inc.severity === 'MED' && 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
                                inc.severity === 'LOW' && 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                              )}
                            >
                              {inc.severity}
                            </span>

                            {/* Workload Tag */}
                            <span className="bg-[#1e2636] text-[#a3c9ff] border border-[#2f3b52] text-[10px] px-2 py-0.5 rounded font-mono font-semibold">
                              {inc.workload}
                            </span>

                            {/* MITRE ATT&CK Tag */}
                            <span className="bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[10px] px-1.5 py-0.5 rounded font-mono">
                              {inc.attackTechniqueId}
                            </span>
                          </div>

                          {/* Risk Score */}
                          <div className="flex items-center gap-1 text-[11px] font-mono font-bold">
                            <span className="text-[#8a919e]">Risk:</span>
                            <span className={cn(inc.riskScore > 80 ? 'text-red-400' : 'text-amber-400')}>
                              {inc.riskScore}/100
                            </span>
                          </div>
                        </div>

                        {/* Title */}
                        <h3 className="text-xs font-bold text-white leading-snug line-clamp-2">{inc.title}</h3>

                        {/* Metadata Footer */}
                        <div className="flex items-center justify-between text-[11px] text-[#8a919e] pt-1 border-t border-[#1e2532] font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-[#0078d4]" />
                              {inc.tenantName}
                            </span>
                            {inc.affectedUserUPN && (
                              <span className="truncate max-w-[160px] text-[#a3c9ff]">
                                👤 {inc.affectedUserUPN}
                              </span>
                            )}
                          </div>

                          <span className="text-[10px]">{inc.createdTimestamp.substring(11, 16)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT PANE (40%): Incident Inspector & 1-Click Graph Remediation Actions */}
            <div className="w-full md:w-[40%] flex flex-col min-h-0 bg-[#101419] overflow-y-auto p-4 space-y-4">
              {selectedIncident ? (
                <>
                  {/* Selected Incident Header Card */}
                  <div className="bg-[#181c22] border border-[#272f3d] rounded-lg p-4 space-y-3 shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono text-cyan-400 font-bold">{selectedIncident.incidentNumber}</span>
                          <span className="text-[10px] font-mono text-[#8a919e]">GUID: {selectedIncident.id}</span>
                        </div>
                        <h2 className="text-sm font-bold text-white leading-snug">{selectedIncident.title}</h2>
                      </div>

                      <button
                        onClick={() => setShowJsonInspector(true)}
                        className="bg-[#222832] hover:bg-[#2c3442] text-[#a3c9ff] p-1.5 rounded border border-[#272f3d] transition-all"
                        title="View Raw Microsoft Graph Alert v2 JSON"
                      >
                        <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      </button>
                    </div>

                    <p className="text-xs text-[#c0c7d4] leading-relaxed bg-[#0d111a] p-2.5 rounded border border-[#272f3d]">
                      {selectedIncident.description}
                    </p>

                    {/* Threat Details Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-[#0d111a] p-2 rounded border border-[#272f3d]">
                        <div className="text-[10px] text-[#8a919e]">Tenant Context</div>
                        <div className="text-white font-bold truncate">{selectedIncident.tenantName}</div>
                      </div>

                      <div className="bg-[#0d111a] p-2 rounded border border-[#272f3d]">
                        <div className="text-[10px] text-[#8a919e]">Mitigation State</div>
                        <div className="text-amber-300 font-bold">{selectedIncident.mitigationStatus}</div>
                      </div>

                      {selectedIncident.affectedUserUPN && (
                        <div className="bg-[#0d111a] p-2 rounded border border-[#272f3d]">
                          <div className="text-[10px] text-[#8a919e]">Target Account UPN</div>
                          <div className="text-[#a3c9ff] truncate">{selectedIncident.affectedUserUPN}</div>
                        </div>
                      )}

                      {selectedIncident.affectedDeviceName && (
                        <div className="bg-[#0d111a] p-2 rounded border border-[#272f3d]">
                          <div className="text-[10px] text-[#8a919e]">Target Endpoint</div>
                          <div className="text-emerald-300 truncate">{selectedIncident.affectedDeviceName}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 1-CLICK GRAPH REMEDIATION ACTION PANEL */}
                  <div className="bg-[#181c22] border border-cyan-500/30 rounded-lg p-4 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                      <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        Graph API 1-Click SOC Remediation Actions
                      </h3>
                      <span className="text-[10px] font-mono text-emerald-400">OAuth GDAP Authorized</span>
                    </div>

                    {actionProgressMessage && (
                      <div className="bg-cyan-500/10 border border-cyan-500/40 p-2.5 rounded text-xs text-cyan-300 font-mono flex items-center gap-2 animate-pulse">
                        <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                        <span>{actionProgressMessage}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {/* Action 1: Revoke User Sessions */}
                      {selectedIncident.affectedUserUPN && (
                        <button
                          onClick={() => handleExecuteGraphAction('REVOKE_SESSIONS', selectedIncident.affectedUserUPN!)}
                          disabled={isExecutingGraphAction}
                          className="w-full bg-[#1e283a] hover:bg-[#27354d] text-cyan-300 border border-cyan-500/40 p-2.5 rounded-md text-xs font-bold flex items-center justify-between transition-all disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <UserX className="w-4 h-4 text-cyan-400" />
                            <span>Revoke All Active Entra ID Sessions</span>
                          </div>
                          <span className="text-[10px] font-mono bg-cyan-500/20 px-2 py-0.5 rounded text-cyan-200">
                            POST /users/revokeSignInSessions
                          </span>
                        </button>
                      )}

                      {/* Action 2: Isolate Device */}
                      {selectedIncident.affectedDeviceName && (
                        <button
                          onClick={() => handleExecuteGraphAction('ISOLATE_DEVICE', selectedIncident.affectedDeviceName!)}
                          disabled={isExecutingGraphAction}
                          className="w-full bg-[#2a1a1a] hover:bg-[#3d2222] text-red-300 border border-red-500/40 p-2.5 rounded-md text-xs font-bold flex items-center justify-between transition-all disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <WifiOff className="w-4 h-4 text-red-400" />
                            <span>Isolate Endpoint via Defender EDR</span>
                          </div>
                          <span className="text-[10px] font-mono bg-red-500/20 px-2 py-0.5 rounded text-red-200">
                            POST /machines/isolate
                          </span>
                        </button>
                      )}

                      {/* Action 3: Elevate User Risk & Force Reset */}
                      {selectedIncident.affectedUserUPN && (
                        <button
                          onClick={() => handleExecuteGraphAction('ELEVATE_USER_RISK', selectedIncident.affectedUserUPN!)}
                          disabled={isExecutingGraphAction}
                          className="w-full bg-[#2c2014] hover:bg-[#3d2c1c] text-amber-300 border border-amber-500/40 p-2.5 rounded-md text-xs font-bold flex items-center justify-between transition-all disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <Lock className="w-4 h-4 text-amber-400" />
                            <span>Force High Risk &amp; Password Reset</span>
                          </div>
                          <span className="text-[10px] font-mono bg-amber-500/20 px-2 py-0.5 rounded text-amber-200">
                            POST /riskyUsers/confirmCompromised
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Incident Attack Timeline & Audit Trail */}
                  <div className="bg-[#181c22] border border-[#272f3d] rounded-lg p-4 space-y-3 shadow-md">
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5 border-b border-[#272f3d] pb-2">
                      <Clock className="w-3.5 h-3.5 text-purple-400" />
                      Attack Evidence &amp; Graph Audit Timeline
                    </h3>

                    <div className="space-y-2 text-xs">
                      {selectedIncident.timeline.map((event, idx) => (
                        <div key={idx} className="flex items-start gap-2.5 bg-[#0d111a] p-2 rounded border border-[#272f3d]">
                          <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1 shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-[10px] text-[#8a919e] font-mono">
                              <span>{event.actor}</span>
                              <span>{event.timestamp}</span>
                            </div>
                            <p className="text-xs text-white font-medium">{event.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-[#8a919e] text-xs">
                  Select an incident to inspect details.
                </div>
              )}
            </div>
          </div>
        )}

        {/* POSTURE MATRIX SUB-TAB VIEW */}
        {activeViewTab === 'posture' && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-4 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Multi-Tenant Zero Trust Security Posture Directory
              </h2>
              <p className="text-xs text-[#8a919e]">
                Real-time Microsoft Secure Score, Conditional Access enforcement status, and Defender EDR agent coverage across customer tenants.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#141a26] text-[#8a919e] uppercase text-[10px] tracking-wider font-mono border-b border-[#272f3d]">
                    <tr>
                      <th className="py-2.5 px-3">Customer Tenant</th>
                      <th className="py-2.5 px-3">Secure Score</th>
                      <th className="py-2.5 px-3">Zero Trust %</th>
                      <th className="py-2.5 px-3">MFA Enforcement</th>
                      <th className="py-2.5 px-3">Conditional Access</th>
                      <th className="py-2.5 px-3">Defender EDR</th>
                      <th className="py-2.5 px-3">24h Auto-Healed</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2532]">
                    {postureBaselines.map((b) => (
                      <tr key={b.tenantId} className="hover:bg-[#161f2e] transition-colors text-[#c0c7d4]">
                        <td className="py-3 px-3 font-bold text-white">{b.tenantName}</td>
                        <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                          {b.secureScore} / {b.maxScore}
                        </td>
                        <td className="py-3 px-3 font-mono text-cyan-300">{b.zeroTrustAlignmentPercent}%</td>
                        <td className="py-3 px-3 font-mono text-purple-300">{b.mfaEnforcementPercent}%</td>
                        <td className="py-3 px-3">
                          <span
                            className={cn(
                              'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                              b.conditionalAccessBaselineStatus === 'Enforced' && 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                              b.conditionalAccessBaselineStatus === 'Drift Detected' && 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                              b.conditionalAccessBaselineStatus === 'Audit Mode' && 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                            )}
                          >
                            {b.conditionalAccessBaselineStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-emerald-400">{b.defenderEdrCoveragePercent}% Covered</td>
                        <td className="py-3 px-3 font-mono text-amber-300">{b.autoHealedThreats24h} Threats</td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => {
                              setTenantFilter(b.tenantId);
                              setActiveViewTab('incidents');
                            }}
                            className="p-1 bg-[#181c22] border border-[#272f3d] hover:bg-[#0078d4] text-[#a3c9ff] hover:text-white rounded transition-all text-[11px] px-2 font-semibold"
                          >
                            View Alerts
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

      {/* RAW GRAPH API JSON INSPECTOR MODAL */}
      {showJsonInspector && selectedIncident && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-3.5 border-b border-[#272f3d] flex items-center justify-between">
              <span className="text-xs font-bold text-white font-mono flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Microsoft Graph API /security/alerts_v2/{selectedIncident.graphAlertId}
              </span>
              <button onClick={() => setShowJsonInspector(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto font-mono text-[11px] bg-[#090d16] text-cyan-300">
              <pre>{JSON.stringify(selectedIncident, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
