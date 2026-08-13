// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MessageSquare,
  Send,
  Paperclip,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  FileText,
  PhoneCall,
  Video,
  MoreVertical,
  Sparkles,
  ChevronRight,
  AlertOctagon,
  Shield,
  User,
  Check,
  Plus,
  Phone,
  ExternalLink,
  Lock,
  KeyRound,
  Laptop,
  Flame,
  Building2,
  Activity,
  X,
  Radio,
  FileCode,
  ArrowUpRight,
  CornerDownRight,
  Maximize2,
  Minimize2,
  HelpCircle,
  Smile,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface ActionCardData {
  id: string;
  title: string;
  description: string;
  type: 'authorization' | 'mfa_reset' | 'password_reset' | 'session_revoke' | 'ticket_converted' | 'device_wipe';
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  metadata?: Record<string, string>;
  actionLabel?: string;
  executedAt?: string;
  executedBy?: string;
}

export interface ChatMessage {
  id: string;
  senderType: 'client' | 'tech' | 'system';
  senderName: string;
  senderAvatar?: string;
  text: string;
  timestamp: string;
  actionCard?: ActionCardData | null;
  attachments?: { name: string; size: string; type: string }[];
}

export interface ChatThread {
  id: string;
  clientName: string;
  clientUpn: string;
  clientAvatar: string;
  clientRole: string;
  tenantId: string;
  tenantName: string;
  tenantTier: 'Enterprise VIP' | 'Standard Managed' | 'Premium Gold' | 'Co-Managed';
  status: 'unassigned' | 'active' | 'resolved';
  assignedTechUpn: string | null;
  assignedTechName: string | null;
  lastMessage: string;
  updatedAt: string;
  unreadCount: number;
  userMfaStatus: 'Enforced 🟢' | 'Disabled 🔴' | 'Conditional 🟡';
  tenantActiveAlerts: number;
  tenantHealthScore: number;
  slaClockSeconds: number;
  psaTicketId?: string | null;
  userLocation?: string;
  userIp?: string;
  assignedDevices?: string[];
  messages: ChatMessage[];
}

interface SupportChatConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
}

// Default initial mock threads
const INITIAL_THREADS: ChatThread[] = [
  {
    id: 'thread-101',
    clientName: 'Sarah Jenkins',
    clientUpn: 'ciso@contoso.com',
    clientAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    clientRole: 'Chief Information Security Officer',
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    tenantTier: 'Enterprise VIP',
    status: 'active',
    assignedTechUpn: 'shane@msp-global.com',
    assignedTechName: 'Shane McCaw (Global Admin)',
    lastMessage: 'Requesting emergency remote session revocation due to impossible travel alert on domain admin account.',
    updatedAt: '2m ago',
    unreadCount: 2,
    userMfaStatus: 'Enforced 🟢',
    tenantActiveAlerts: 3,
    tenantHealthScore: 88,
    slaClockSeconds: 180, // 3 minutes remaining
    userLocation: 'Seattle, WA, USA',
    userIp: '104.28.14.9',
    assignedDevices: ['LT-9912 (Win11 Ent)', 'iPhone 15 Pro'],
    messages: [
      {
        id: 'msg-1',
        senderType: 'client',
        senderName: 'Sarah Jenkins',
        senderAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
        text: 'Hello NOC team, Defender SOC flagged an impossible travel alert on my account (ciso@contoso.com). Sign-in originated from Frankfurt, Germany while I am currently in Seattle.',
        timestamp: '10:42 AM',
      },
      {
        id: 'msg-2',
        senderType: 'tech',
        senderName: 'Shane McCaw (Global Admin)',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        text: 'Understood Sarah. Checking Microsoft Graph API telemetry right now. I see 4 active OAuth refresh tokens issued in Europe.',
        timestamp: '10:43 AM',
      },
      {
        id: 'msg-3',
        senderType: 'tech',
        senderName: 'Shane McCaw (Global Admin)',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        text: 'I am sending an authorization card to revoke all active sign-in sessions and enforce an immediate password reset.',
        timestamp: '10:44 AM',
        actionCard: {
          id: 'card-101',
          title: 'Graph API Emergency Session Revocation',
          description: 'Authorize global OAuth token invalidation and force re-authentication across all M365 endpoints for ciso@contoso.com.',
          type: 'session_revoke',
          status: 'pending',
          actionLabel: 'Approve & Revoke Sessions',
          metadata: {
            TargetUPN: 'ciso@contoso.com',
            Tenant: 'Contoso Corp',
            Severity: 'CRITICAL',
          },
        },
      },
      {
        id: 'msg-4',
        senderType: 'client',
        senderName: 'Sarah Jenkins',
        senderAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
        text: 'Requesting emergency remote session revocation due to impossible travel alert on domain admin account.',
        timestamp: '10:45 AM',
      },
    ],
  },
  {
    id: 'thread-102',
    clientName: 'Alex Rivera',
    clientUpn: 'a.rivera@fabrikam.io',
    clientAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    clientRole: 'VP of Finance',
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    tenantTier: 'Premium Gold',
    status: 'unassigned',
    assignedTechUpn: null,
    assignedTechName: null,
    lastMessage: 'Cannot access SharePoint Finance repository following license migration to E5.',
    updatedAt: '8m ago',
    unreadCount: 1,
    userMfaStatus: 'Conditional 🟡',
    tenantActiveAlerts: 1,
    tenantHealthScore: 94,
    slaClockSeconds: 420,
    userLocation: 'Austin, TX, USA',
    userIp: '172.56.21.104',
    assignedDevices: ['DESKTOP-FIN-04', 'iPad Air 5th Gen'],
    messages: [
      {
        id: 'msg-201',
        senderType: 'client',
        senderName: 'Alex Rivera',
        senderAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
        text: 'Cannot access SharePoint Finance repository following license migration to E5. Error code: 0x8004010F.',
        timestamp: '10:37 AM',
      },
      {
        id: 'msg-202',
        senderType: 'system',
        senderName: 'System Bot',
        text: 'Thread assigned SLA tier: 15-minute response. Awaiting MSP Technician claim.',
        timestamp: '10:38 AM',
      },
    ],
  },
  {
    id: 'thread-103',
    clientName: 'Marcus Vance',
    clientUpn: 'm.vance@northwind.com',
    clientAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    clientRole: 'IT Operations Director',
    tenantId: 't-northwind-03',
    tenantName: 'Northwind Traders',
    tenantTier: 'Standard Managed',
    status: 'active',
    assignedTechUpn: 'shane@msp-global.com',
    assignedTechName: 'Shane McCaw (Global Admin)',
    lastMessage: 'Intune wipe executed on stolen laptop LT-9912. Confirmation received from Graph API.',
    updatedAt: '22m ago',
    unreadCount: 0,
    userMfaStatus: 'Enforced 🟢',
    tenantActiveAlerts: 0,
    tenantHealthScore: 98,
    slaClockSeconds: 840,
    psaTicketId: 'HALO-89210',
    userLocation: 'Chicago, IL, USA',
    userIp: '198.51.100.44',
    assignedDevices: ['LT-9912 (Lost/Stolen)', 'LT-9913 (Replacement)'],
    messages: [
      {
        id: 'msg-301',
        senderType: 'client',
        senderName: 'Marcus Vance',
        senderAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
        text: 'Laptop LT-9912 was reported stolen from an employee vehicle. We need an immediate Intune Remote Wipe + BitLocker key backup verification.',
        timestamp: '10:15 AM',
      },
      {
        id: 'msg-302',
        senderType: 'tech',
        senderName: 'Shane McCaw (Global Admin)',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        text: 'Action dispatched via Graph API. Here is the confirmation authorization record.',
        timestamp: '10:18 AM',
        actionCard: {
          id: 'card-301',
          title: 'Intune Remote Wipe - LT-9912',
          description: 'Factory reset and crypto-erase dispatched to Intune MDM for device LT-9912.',
          type: 'device_wipe',
          status: 'executed',
          actionLabel: 'Executed ⚡',
          executedAt: '10:19 AM',
          executedBy: 'Shane McCaw',
          metadata: {
            DeviceID: 'LT-9912',
            BitLockerKey: 'Backup Verified 🟢',
            Status: 'Crypto-Erase Dispatched',
          },
        },
      },
      {
        id: 'msg-303',
        senderType: 'client',
        senderName: 'Marcus Vance',
        senderAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
        text: 'Intune wipe executed on stolen laptop LT-9912. Confirmation received from Graph API.',
        timestamp: '10:20 AM',
      },
    ],
  },
  {
    id: 'thread-104',
    clientName: 'Elena Rostova',
    clientUpn: 'elena@litware.com',
    clientAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    clientRole: 'HR Generalist',
    tenantId: 't-litware-04',
    tenantName: 'Litware Systems',
    tenantTier: 'Co-Managed',
    status: 'resolved',
    assignedTechUpn: 'shane@msp-global.com',
    assignedTechName: 'Shane McCaw (Global Admin)',
    lastMessage: 'VIP Onboarding completed for VP of Engineering. License assigned and MFA setup email sent.',
    updatedAt: '1h ago',
    unreadCount: 0,
    userMfaStatus: 'Enforced 🟢',
    tenantActiveAlerts: 0,
    tenantHealthScore: 100,
    slaClockSeconds: 0,
    psaTicketId: 'HALO-89195',
    userLocation: 'Boston, MA, USA',
    userIp: '64.233.160.1',
    assignedDevices: ['LT-8801'],
    messages: [
      {
        id: 'msg-401',
        senderType: 'client',
        senderName: 'Elena Rostova',
        senderAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
        text: 'New onboarding request for Dr. Aris Thorne (VP of Engineering). Needs M365 E5 + Teams Phone + PIM Role authorization.',
        timestamp: '09:20 AM',
      },
      {
        id: 'msg-402',
        senderType: 'system',
        senderName: 'System Bot',
        text: 'Converted conversation to HaloPSA Ticket #HALO-89195. Priority: Normal.',
        timestamp: '09:22 AM',
      },
      {
        id: 'msg-403',
        senderType: 'tech',
        senderName: 'Shane McCaw (Global Admin)',
        senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        text: 'VIP Onboarding completed for VP of Engineering. License assigned and MFA setup email sent.',
        timestamp: '09:45 AM',
      },
    ],
  },
];

export const SupportChatConsole: React.FC<SupportChatConsoleProps> = ({
  tenants = [],
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [threads, setThreads] = useState<ChatThread[]>(INITIAL_THREADS);
  const [selectedThreadId, setSelectedThreadId] = useState<string>('thread-101');
  const [techPresence, setTechPresence] = useState<'available' | 'busy'>('available');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unassigned' | 'active' | 'resolved' | 'critical'>('all');
  const [inputText, setInputText] = useState('');
  const [showQuickTemplates, setShowQuickTemplates] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showActionCardModal, setShowActionCardModal] = useState(false);

  // Ticket Modal Form State
  const [ticketQueue, setTicketQueue] = useState<'Service Desk' | 'SOC Security' | 'Escalations'>('SOC Security');
  const [ticketPriority, setTicketPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('High');
  const [ticketSubject, setTicketSubject] = useState('');

  // Action Card Modal Form State
  const [actionType, setActionType] = useState<ActionCardData['type']>('authorization');
  const [actionTitle, setActionTitle] = useState('');
  const [actionDescription, setActionDescription] = useState('');

  // Auto scroll chat stream
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Active thread calculation
  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === selectedThreadId) || threads[0];
  }, [threads, selectedThreadId]);

  // SLA Timers effect
  useEffect(() => {
    const timer = setInterval(() => {
      setThreads((prev) =>
        prev.map((thread) => {
          if (thread.status === 'active' && thread.slaClockSeconds > 0) {
            return { ...thread, slaClockSeconds: thread.slaClockSeconds - 1 };
          }
          return thread;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages]);

  // KPI Metrics Calculations
  const metrics = useMemo(() => {
    const activeCount = threads.filter((t) => t.status === 'active').length;
    const criticalCount = threads.filter((t) => t.tenantActiveAlerts > 0 || t.slaClockSeconds < 300).length;
    const ticketCount = threads.filter((t) => t.psaTicketId).length + 8; // Including historical today
    return {
      activeCount,
      avgResponse: '42s First Response',
      criticalCount,
      ticketCount,
    };
  }, [threads]);

  // Filtered Threads List
  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const matchesSearch =
        t.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.clientUpn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.lastMessage.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === 'unassigned') return t.status === 'unassigned';
      if (statusFilter === 'active') return t.status === 'active';
      if (statusFilter === 'resolved') return t.status === 'resolved';
      if (statusFilter === 'critical') return t.tenantActiveAlerts > 0 || t.slaClockSeconds < 300;

      return true;
    });
  }, [threads, searchQuery, statusFilter]);

  // Format SLA Seconds to MM:SS
  const formatSlaClock = (seconds: number) => {
    if (seconds <= 0) return 'EXPIRED';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Toast Helper
  const triggerToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // Handlers
  const handleSendMessage = () => {
    if (!inputText.trim() || !activeThread) return;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderType: 'tech',
      senderName: 'Shane McCaw (Global Admin)',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      text: inputText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id === activeThread.id) {
          return {
            ...thread,
            lastMessage: newMessage.text,
            updatedAt: 'Just now',
            messages: [...thread.messages, newMessage],
          };
        }
        return thread;
      })
    );

    setInputText('');
    setShowQuickTemplates(false);
  };

  const handleSimulateClientReply = () => {
    if (!activeThread) return;

    const mockReplies = [
      'Thanks for the fast update! I have confirmed the prompt on my Authenticator app.',
      'Could you also check if our Exchange Online transport rules were affected by this change?',
      'Awesome! The Intune compliance error has cleared up on my surface laptop.',
      'Approve, please proceed with the Graph API workflow execution.',
    ];
    const randomText = mockReplies[Math.floor(Math.random() * mockReplies.length)];

    const clientReply: ChatMessage = {
      id: `msg-client-${Date.now()}`,
      senderType: 'client',
      senderName: activeThread.clientName,
      senderAvatar: activeThread.clientAvatar,
      text: randomText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id === activeThread.id) {
          return {
            ...thread,
            lastMessage: randomText,
            updatedAt: 'Just now',
            unreadCount: thread.id === selectedThreadId ? 0 : thread.unreadCount + 1,
            messages: [...thread.messages, clientReply],
          };
        }
        return thread;
      })
    );

    triggerToast('info', `New Message from ${activeThread.clientName}`, randomText);
  };

  const handleClaimNextChat = () => {
    const unassigned = threads.find((t) => t.status === 'unassigned');
    if (!unassigned) {
      triggerToast('info', 'Queue Clean', 'No unassigned support chat threads in queue.');
      return;
    }

    const systemMsg: ChatMessage = {
      id: `msg-sys-${Date.now()}`,
      senderType: 'system',
      senderName: 'System Engine',
      text: 'Technician Shane McCaw (Global Admin) claimed this session.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === unassigned.id) {
          return {
            ...t,
            status: 'active',
            assignedTechUpn: 'shane@msp-global.com',
            assignedTechName: 'Shane McCaw (Global Admin)',
            messages: [...t.messages, systemMsg],
          };
        }
        return t;
      })
    );

    setSelectedThreadId(unassigned.id);
    triggerToast('success', 'Session Claimed', `You have claimed ${unassigned.clientName} (${unassigned.tenantName}).`);
  };

  const handleApproveActionCard = (cardId: string) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThread.id) {
          const updatedMessages = t.messages.map((m) => {
            if (m.actionCard && m.actionCard.id === cardId) {
              return {
                ...m,
                actionCard: {
                  ...m.actionCard,
                  status: 'executed' as const,
                  actionLabel: 'Executed ⚡',
                  executedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  executedBy: 'Shane McCaw (Global Admin)',
                },
              };
            }
            return m;
          });

          const systemMsg: ChatMessage = {
            id: `msg-exec-${Date.now()}`,
            senderType: 'system',
            senderName: 'Graph API Engine',
            text: `Action "${cardId}" executed successfully across ${t.tenantName} Graph API endpoints. Status: 200 OK.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };

          return {
            ...t,
            messages: [...updatedMessages, systemMsg],
          };
        }
        return t;
      })
    );

    triggerToast('success', 'Graph API Remediation Executed', `Action card approved & executed for ${activeThread.tenantName}.`);
  };

  const handleQuickRemediation = (actionName: string) => {
    if (!activeThread) return;

    let cardType: ActionCardData['type'] = 'authorization';
    let desc = `Executing 1-click Graph API remediation: ${actionName} for ${activeThread.clientUpn}.`;

    if (actionName.includes('MFA')) cardType = 'mfa_reset';
    if (actionName.includes('Sessions')) cardType = 'session_revoke';
    if (actionName.includes('Password')) cardType = 'password_reset';
    if (actionName.includes('Intune')) cardType = 'device_wipe';

    const actionMsg: ChatMessage = {
      id: `msg-card-${Date.now()}`,
      senderType: 'tech',
      senderName: 'Shane McCaw (Global Admin)',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      text: `Dispatching Quick Remediation: ${actionName}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actionCard: {
        id: `card-quick-${Date.now()}`,
        title: `${actionName} Authorization`,
        description: desc,
        type: cardType,
        status: 'pending',
        actionLabel: `Approve ${actionName}`,
        metadata: {
          TargetUPN: activeThread.clientUpn,
          Tenant: activeThread.tenantName,
          InitiatedBy: 'Shane McCaw',
        },
      },
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThread.id) {
          return {
            ...t,
            lastMessage: `Dispatched ${actionName} action card`,
            messages: [...t.messages, actionMsg],
          };
        }
        return t;
      })
    );

    triggerToast('info', 'Action Card Generated', `Sent ${actionName} interactive authorization card into chat thread.`);
  };

  const handleCreatePsaTicket = () => {
    if (!activeThread) return;

    const ticketId = `HALO-${Math.floor(10000 + Math.random() * 90000)}`;

    const sysMsg: ChatMessage = {
      id: `msg-tkt-${Date.now()}`,
      senderType: 'system',
      senderName: 'PSA Connector (HaloPSA)',
      text: `Chat thread bound to Ticket #${ticketId} (${ticketQueue} - Priority: ${ticketPriority}). Full chat transcript attached.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThread.id) {
          return {
            ...t,
            psaTicketId: ticketId,
            messages: [...t.messages, sysMsg],
          };
        }
        return t;
      })
    );

    setShowTicketModal(false);
    triggerToast('success', 'PSA Ticket Created', `Ticket #${ticketId} generated with transcript bound to ${activeThread.tenantName}.`);
  };

  const handleCreateCustomActionCard = () => {
    if (!actionTitle.trim() || !activeThread) return;

    const customCardMsg: ChatMessage = {
      id: `msg-custom-${Date.now()}`,
      senderType: 'tech',
      senderName: 'Shane McCaw (Global Admin)',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      text: `Drafted Action Card: ${actionTitle}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actionCard: {
        id: `card-custom-${Date.now()}`,
        title: actionTitle,
        description: actionDescription || 'Please authorize this MSP administrative workflow execution.',
        type: actionType,
        status: 'pending',
        actionLabel: 'Approve & Execute',
        metadata: {
          TargetUPN: activeThread.clientUpn,
          Tenant: activeThread.tenantName,
        },
      },
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThread.id) {
          return {
            ...t,
            lastMessage: `Created action card: ${actionTitle}`,
            messages: [...t.messages, customCardMsg],
          };
        }
        return t;
      })
    );

    setShowActionCardModal(false);
    setActionTitle('');
    setActionDescription('');
    triggerToast('success', 'Action Card Sent', `Action card "${actionTitle}" added to thread.`);
  };

  const handleResolveSession = () => {
    if (!activeThread) return;

    const endMsg: ChatMessage = {
      id: `msg-end-${Date.now()}`,
      senderType: 'system',
      senderName: 'System Engine',
      text: `Session marked RESOLVED by Shane McCaw. Transcript archived into ${activeThread.tenantName} compliance audit log.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThread.id) {
          return {
            ...t,
            status: 'resolved',
            messages: [...t.messages, endMsg],
          };
        }
        return t;
      })
    );

    triggerToast('success', 'Session Resolved', `Support chat session with ${activeThread.clientName} closed.`);
  };

  // Canned response selection
  const handleSelectQuickTemplate = (templateText: string) => {
    setInputText(templateText);
    setShowQuickTemplates(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-[#e0e2ea] overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & SUPPORT QUEUE METRICS BAR */}
      <div className="bg-[#101419] border-b border-[#272f3d] px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-md">
        {/* Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center text-[#a3c9ff] shadow-inner">
            <MessageSquare className="w-5 h-5 text-[#0078d4] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">MSP Live Support & Escalation Hub</h1>
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Radio className="w-2.5 h-2.5 animate-ping text-emerald-400" /> GRAPH API LIVE
              </span>
            </div>
            <p className="text-[11px] text-[#8a919e] font-medium">
              Real-Time M365 Client Admin Chat &amp; 1-Click Graph Remediations
            </p>
          </div>
        </div>

        {/* Support Queue KPI Summary Cards */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Active Chats</div>
              <div className="text-xs font-bold text-white font-mono">{metrics.activeCount} Open Sessions</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">Avg SLA First Resp</div>
              <div className="text-xs font-bold text-emerald-400 font-mono">{metrics.avgResponse}</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">High Priority</div>
              <div className="text-xs font-bold text-red-400 font-mono">{metrics.criticalCount} Critical Alerts</div>
            </div>
          </div>

          <div className="bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-1.5 flex items-center gap-2.5">
            <Ticket className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a919e] font-semibold">PSA Tickets Today</div>
              <div className="text-xs font-bold text-purple-300 font-mono">{metrics.ticketCount} Converted</div>
            </div>
          </div>
        </div>

        {/* Technician Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Presence Toggle */}
          <button
            onClick={() => {
              const newStatus = techPresence === 'available' ? 'busy' : 'available';
              setTechPresence(newStatus);
              triggerToast('info', 'Presence Changed', `Technician status set to ${newStatus.toUpperCase()}`);
            }}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 border transition-all',
              techPresence === 'available'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
            )}
            title="Toggle Technician Availability Status"
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                techPresence === 'available' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
              )}
            />
            {techPresence === 'available' ? '🟢 Available / Accepting Chats' : '🔴 Away / Busy'}
          </button>

          {/* Claim Next Unassigned */}
          <button
            onClick={handleClaimNextChat}
            className="bg-[#0078d4] hover:bg-[#0063b1] text-white px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
          >
            <UserCheck className="w-3.5 h-3.5" />
            Claim Next Chat
          </button>

          {/* Simulate Client Message */}
          <button
            onClick={handleSimulateClientReply}
            className="bg-[#1f293d] hover:bg-[#2a3752] text-[#a3c9ff] border border-[#374151] px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all"
            title="Simulate incoming client message in real-time"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Simulate Client Reply
          </button>

          {/* Refresh Queue */}
          <button
            onClick={() => triggerToast('info', 'Queue Refreshed', 'SSE Stream synchronized with M365 tenant endpoints.')}
            className="p-1.5 bg-[#181c22] border border-[#272f3d] hover:bg-[#222832] text-[#8a919e] hover:text-white rounded-md transition-all"
            title="Refresh Queue"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. MAIN DUAL-PANE CHAT WORKSPACE */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* --- LEFT COLUMN (30% Width): Conversation Queue List --- */}
        <div className="w-[30%] min-w-[280px] max-w-[380px] bg-[#0c1018] border-r border-[#272f3d] flex flex-col h-full shrink-0">
          {/* Search & Filter Header */}
          <div className="p-3 border-b border-[#272f3d] space-y-2 bg-[#101419]/50">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8a919e]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search UPN, client, or tenant..."
                className="w-full bg-[#181c22] border border-[#272f3d] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4] transition-colors"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar text-[10px] font-semibold">
              {(['all', 'active', 'unassigned', 'critical', 'resolved'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={cn(
                    'px-2 py-1 rounded-md capitalize whitespace-nowrap transition-all border',
                    statusFilter === filter
                      ? 'bg-[#0078d4] text-white border-[#0078d4]'
                      : 'bg-[#181c22] text-[#8a919e] border-[#272f3d] hover:text-white'
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Threads List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#1e2532]">
            {filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-[#8a919e] text-xs space-y-2">
                <MessageSquare className="w-8 h-8 mx-auto text-[#374151]" />
                <p>No chat threads matching query.</p>
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isSelected = thread.id === activeThread.id;
                const isCritical = thread.tenantActiveAlerts > 0 || thread.slaClockSeconds < 300;

                return (
                  <div
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={cn(
                      'p-3 cursor-pointer transition-all border-l-4 relative group',
                      isSelected
                        ? 'bg-[#161f2e] border-l-[#0078d4] text-white'
                        : 'border-l-transparent hover:bg-[#121722] text-[#c0c7d4]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      {/* Avatar + Client Info */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <img
                            src={thread.clientAvatar}
                            alt={thread.clientName}
                            className="w-8 h-8 rounded-full object-cover border border-[#374151]"
                          />
                          <span
                            className={cn(
                              'w-2.5 h-2.5 rounded-full absolute -bottom-0.5 -right-0.5 border-2 border-[#0c1018]',
                              thread.status === 'active'
                                ? 'bg-emerald-400'
                                : thread.status === 'unassigned'
                                ? 'bg-amber-400'
                                : 'bg-gray-500'
                            )}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs truncate text-white">{thread.clientName}</span>
                            {thread.tenantTier === 'Enterprise VIP' && (
                              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] px-1 rounded font-mono">
                                VIP
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#8a919e] truncate">{thread.tenantName}</div>
                        </div>
                      </div>

                      {/* SLA Clock Pill */}
                      <div className="text-right shrink-0">
                        <div
                          className={cn(
                            'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 border',
                            isCritical
                              ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                              : 'bg-[#181c22] text-[#a3c9ff] border-[#272f3d]'
                          )}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          {formatSlaClock(thread.slaClockSeconds)}
                        </div>
                        <div className="text-[9px] text-[#8a919e] mt-1">{thread.updatedAt}</div>
                      </div>
                    </div>

                    {/* Last Message Snippet */}
                    <p className="text-[11px] text-[#8a919e] line-clamp-2 mt-1.5 pr-2 group-hover:text-[#c0c7d4] transition-colors">
                      {thread.lastMessage}
                    </p>

                    {/* Status & Unread Badge */}
                    <div className="flex items-center justify-between mt-2 pt-1 border-t border-[#1a212d]">
                      <span className="text-[10px] font-mono text-[#8a919e] flex items-center gap-1">
                        {thread.status === 'unassigned' ? (
                          <span className="text-amber-400 font-bold">⚠️ Unassigned</span>
                        ) : thread.assignedTechName ? (
                          <span className="text-blue-400">👤 {thread.assignedTechName.split(' ')[0]}</span>
                        ) : (
                          <span>Resolved</span>
                        )}
                      </span>

                      {thread.unreadCount > 0 && (
                        <span className="bg-[#0078d4] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* --- CENTER COLUMN (45% Width): Active Chat Conversation Window --- */}
        <div className="flex-1 bg-[#090d16] flex flex-col h-full min-w-[360px] border-r border-[#272f3d]">
          {/* Thread Header */}
          <div className="p-3 bg-[#101419] border-b border-[#272f3d] flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <img
                src={activeThread.clientAvatar}
                alt={activeThread.clientName}
                className="w-10 h-10 rounded-full object-cover border border-[#374151]"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">{activeThread.clientName}</h2>
                  <span className="bg-[#181c22] border border-[#272f3d] text-[#a3c9ff] text-[10px] px-2 py-0.5 rounded font-mono font-semibold">
                    {activeThread.tenantName}
                  </span>
                  <span className="bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] text-[10px] px-2 py-0.5 rounded font-mono">
                    {activeThread.tenantTier}
                  </span>
                </div>
                <div className="text-[11px] text-[#8a919e] flex items-center gap-2 mt-0.5">
                  <span>{activeThread.clientUpn}</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-medium">{activeThread.clientRole}</span>
                </div>
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTicketModal(true)}
                className="bg-[#1c2333] hover:bg-[#252f45] text-purple-300 border border-purple-500/30 px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
                title="Convert chat thread to PSA Ticket"
              >
                <Ticket className="w-3.5 h-3.5 text-purple-400" />
                {activeThread.psaTicketId ? activeThread.psaTicketId : 'Convert to Ticket'}
              </button>

              <button
                onClick={() => setShowActionCardModal(true)}
                className="bg-[#0078d4]/20 hover:bg-[#0078d4]/30 text-[#a3c9ff] border border-[#0078d4]/40 px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all"
                title="Draft custom action/authorization card"
              >
                <Zap className="w-3.5 h-3.5 text-[#0078d4]" />
                Action Card
              </button>

              <button
                onClick={handleResolveSession}
                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all"
                title="Mark session as resolved"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                End Session
              </button>
            </div>
          </div>

          {/* Message Stream Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#090d16]">
            {activeThread.messages.map((message) => {
              if (message.senderType === 'system') {
                return (
                  <div key={message.id} className="flex justify-center my-2">
                    <div className="bg-[#141a26] border border-[#272f3d] text-[#a3c9ff] text-[11px] font-mono py-1 px-3 rounded-full flex items-center gap-2 shadow-sm">
                      <Shield className="w-3 h-3 text-[#0078d4]" />
                      <span>{message.text}</span>
                      <span className="text-[#8a919e] text-[9px]">({message.timestamp})</span>
                    </div>
                  </div>
                );
              }

              const isTech = message.senderType === 'tech';

              return (
                <div
                  key={message.id}
                  className={cn('flex items-start gap-2.5 max-w-[85%]', isTech ? 'ml-auto flex-row-reverse' : 'mr-auto')}
                >
                  <img
                    src={
                      message.senderAvatar ||
                      (isTech
                        ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
                        : activeThread.clientAvatar)
                    }
                    alt={message.senderName}
                    className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#374151]"
                  />

                  <div className="space-y-1">
                    {/* Sender Label & Timestamp */}
                    <div className={cn('flex items-center gap-2 text-[10px] text-[#8a919e]', isTech && 'justify-end')}>
                      <span className="font-semibold text-white">{message.senderName}</span>
                      <span>{message.timestamp}</span>
                    </div>

                    {/* Bubble Content */}
                    <div
                      className={cn(
                        'p-3 rounded-xl text-xs leading-relaxed shadow-md border',
                        isTech
                          ? 'bg-[#0078d4] text-white rounded-tr-none border-[#0063b1]'
                          : 'bg-[#141a26] text-[#e0e2ea] rounded-tl-none border-[#272f3d]'
                      )}
                    >
                      <p>{message.text}</p>

                      {/* INLINE ACTION CARD (If present) */}
                      {message.actionCard && (
                        <div className="mt-3 bg-[#0c1018] border border-amber-500/40 rounded-lg p-3 text-white space-y-2 shadow-inner">
                          <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
                              <span className="font-bold text-xs text-amber-300">{message.actionCard.title}</span>
                            </div>
                            <span
                              className={cn(
                                'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                                message.actionCard.status === 'executed'
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              )}
                            >
                              {message.actionCard.status.toUpperCase()}
                            </span>
                          </div>

                          <p className="text-[11px] text-[#c0c7d4]">{message.actionCard.description}</p>

                          {/* Metadata Grid */}
                          {message.actionCard.metadata && (
                            <div className="bg-[#141a26] p-2 rounded text-[10px] font-mono grid grid-cols-2 gap-1 text-[#8a919e]">
                              {Object.entries(message.actionCard.metadata).map(([k, v]) => (
                                <div key={k}>
                                  <span className="text-[#a3c9ff]">{k}:</span> {v}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Action Buttons inside Card */}
                          <div className="pt-1 flex items-center gap-2">
                            {message.actionCard.status === 'pending' ? (
                              <>
                                <button
                                  onClick={() => handleApproveActionCard(message.actionCard!.id)}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded flex items-center gap-1 shadow transition-all"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {message.actionCard.actionLabel || 'Approve & Execute'}
                                </button>

                                <button
                                  onClick={() =>
                                    triggerToast('warning', 'Action Rejected', 'User rejected action execution card.')
                                  }
                                  className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs px-2.5 py-1.5 rounded transition-all"
                                >
                                  Reject
                                </button>
                              </>
                            ) : (
                              <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                Executed by {message.actionCard.executedBy} at {message.actionCard.executedAt}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messageEndRef} />
          </div>

          {/* Quick Response Templates Dropdown */}
          {showQuickTemplates && (
            <div className="bg-[#101419] border-t border-[#272f3d] p-3 space-y-2 shadow-2xl">
              <div className="flex items-center justify-between text-xs font-bold text-[#a3c9ff]">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Quick MSP Response Templates
                </span>
                <button
                  onClick={() => setShowQuickTemplates(false)}
                  className="text-[#8a919e] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
                {[
                  'Requesting admin credential authorization for MFA reset.',
                  'Graph API session revocation initiated. Please re-authenticate.',
                  'Remote Intune diagnostic package requested for device LT-9912.',
                  'Creating HaloPSA Ticket with high severity tier for tier-2 escalation.',
                  'Confirmed impossible travel alert; initiating step-up MFA verification.',
                ].map((tpl, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectQuickTemplate(tpl)}
                    className="p-2 bg-[#181c22] hover:bg-[#202630] border border-[#272f3d] rounded text-left text-[#c0c7d4] hover:text-white transition-all text-[11px]"
                  >
                    {tpl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-3 bg-[#101419] border-t border-[#272f3d] shrink-0">
            <div className="flex items-center gap-2">
              {/* Quick Template Picker Toggle */}
              <button
                onClick={() => setShowQuickTemplates(!showQuickTemplates)}
                className="p-2 bg-[#181c22] hover:bg-[#252d3a] border border-[#272f3d] text-[#a3c9ff] rounded-md transition-all text-xs font-bold font-mono"
                title="Canned Quick Responses (/)"
              >
                /
              </button>

              {/* Attachment Button */}
              <button
                onClick={() => triggerToast('info', 'File Selector', 'Select log file or screenshot attachment.')}
                className="p-2 bg-[#181c22] hover:bg-[#252d3a] border border-[#272f3d] text-[#8a919e] hover:text-white rounded-md transition-all"
                title="Attach Log File"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Text Input */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a support message or press '/' for canned templates..."
                className="flex-1 bg-[#181c22] border border-[#272f3d] rounded-md px-3 py-2 text-xs text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4] transition-colors"
              />

              {/* Send Button */}
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className="bg-[#0078d4] hover:bg-[#0063b1] disabled:opacity-50 text-white px-4 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
              >
                <span>Send</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* --- RIGHT COLUMN (25% Width): Live Tenant Context & Quick Actions --- */}
        <div className="w-[25%] min-w-[260px] max-w-[340px] bg-[#0c1018] border-l border-[#272f3d] flex flex-col h-full overflow-y-auto shrink-0 p-3 space-y-4">
          {/* User Telemetry Card */}
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
              <span className="text-xs font-bold text-[#a3c9ff] flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#0078d4]" /> Target User Telemetry
              </span>
              <span className="bg-emerald-500/20 text-emerald-400 text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/30">
                Entra ID Live
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#8a919e]">UPN:</span>
                <span className="font-mono text-white text-[11px] truncate max-w-[150px]">{activeThread.clientUpn}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a919e]">Entra Role:</span>
                <span className="text-amber-300 font-semibold">{activeThread.clientRole}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a919e]">MFA Status:</span>
                <span className="font-mono text-emerald-400 font-bold">{activeThread.userMfaStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a919e]">Location / IP:</span>
                <span className="font-mono text-[#a3c9ff] text-[10px]">{activeThread.userLocation}</span>
              </div>
            </div>

            {/* Assigned Devices */}
            <div className="pt-2 border-t border-[#1e2532] space-y-1">
              <span className="text-[10px] uppercase font-bold text-[#8a919e] flex items-center gap-1">
                <Laptop className="w-3 h-3 text-[#0078d4]" /> Intune Managed Devices
              </span>
              <div className="space-y-1">
                {activeThread.assignedDevices?.map((dev, i) => (
                  <div
                    key={i}
                    className="bg-[#181c22] border border-[#272f3d] p-1.5 rounded text-[11px] font-mono text-[#c0c7d4] flex items-center justify-between"
                  >
                    <span>{dev}</span>
                    <span className="text-emerald-400 text-[9px]">Compliant</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tenant Telemetry Card */}
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-2">
              <span className="text-xs font-bold text-[#a3c9ff] flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-purple-400" /> Tenant Telemetry
              </span>
              <span className="bg-[#0078d4]/20 text-[#a3c9ff] text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#0078d4]/30">
                {activeThread.tenantTier}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#8a919e]">Tenant Name:</span>
                <span className="text-xs font-bold text-white">{activeThread.tenantName}</span>
              </div>

              {/* Health Score Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#8a919e]">Tenant Health Score:</span>
                  <span className="font-mono font-bold text-emerald-400">{activeThread.tenantHealthScore}/100</span>
                </div>
                <div className="w-full bg-[#181c22] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${activeThread.tenantHealthScore}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-[#8a919e]">Active Security Alerts:</span>
                <span
                  className={cn(
                    'font-mono text-xs font-bold px-1.5 py-0.5 rounded',
                    activeThread.tenantActiveAlerts > 0
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                      : 'bg-emerald-500/20 text-emerald-400'
                  )}
                >
                  {activeThread.tenantActiveAlerts} Active
                </span>
              </div>
            </div>
          </div>

          {/* Quick Remediation Toolbar */}
          <div className="bg-[#101419] border border-[#272f3d] rounded-lg p-3 space-y-2.5 shadow-md">
            <span className="text-xs font-bold text-white flex items-center gap-1.5 border-b border-[#272f3d] pb-2">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> 1-Click Graph Remediations
            </span>

            <div className="space-y-1.5">
              <button
                onClick={() => handleQuickRemediation('Reset User MFA')}
                className="w-full bg-[#181c22] hover:bg-[#202836] border border-[#272f3d] hover:border-[#0078d4] text-[#c0c7d4] hover:text-white p-2 rounded text-xs font-semibold flex items-center justify-between transition-all"
              >
                <span className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                  Reset User MFA
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#8a919e]" />
              </button>

              <button
                onClick={() => handleQuickRemediation('Revoke Active Sessions')}
                className="w-full bg-[#181c22] hover:bg-[#202836] border border-[#272f3d] hover:border-red-500/50 text-[#c0c7d4] hover:text-white p-2 rounded text-xs font-semibold flex items-center justify-between transition-all"
              >
                <span className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-red-400" />
                  Revoke Active Sessions
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#8a919e]" />
              </button>

              <button
                onClick={() => handleQuickRemediation('Send Password Reset Link')}
                className="w-full bg-[#181c22] hover:bg-[#202836] border border-[#272f3d] hover:border-emerald-500/50 text-[#c0c7d4] hover:text-white p-2 rounded text-xs font-semibold flex items-center justify-between transition-all"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Password Reset Token
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#8a919e]" />
              </button>

              <button
                onClick={() => handleQuickRemediation('Intune Device Scan')}
                className="w-full bg-[#181c22] hover:bg-[#202836] border border-[#272f3d] hover:border-purple-500/50 text-[#c0c7d4] hover:text-white p-2 rounded text-xs font-semibold flex items-center justify-between transition-all"
              >
                <span className="flex items-center gap-2">
                  <Laptop className="w-3.5 h-3.5 text-purple-400" />
                  Intune Device Scan
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#8a919e]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. MODALS / DRAWERS */}

      {/* PSA Ticket Modal */}
      {showTicketModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Convert to HaloPSA Ticket</h3>
              </div>
              <button onClick={() => setShowTicketModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">Target Tenant &amp; User</label>
                <input
                  type="text"
                  disabled
                  value={`${activeThread.clientName} (${activeThread.tenantName})`}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">PSA Service Queue</label>
                <select
                  value={ticketQueue}
                  onChange={(e) => setTicketQueue(e.target.value as any)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="SOC Security">SOC Security Queue</option>
                  <option value="Service Desk">Service Desk Tier 1</option>
                  <option value="Escalations">Escalations Tier 2/3</option>
                </select>
              </div>

              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">Priority</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value as any)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical (SLA 15m)</option>
                </select>
              </div>

              <div className="bg-[#181c22] p-2 rounded border border-[#272f3d] text-[11px] text-[#8a919e]">
                ℹ️ Full chat conversation transcript will be automatically attached to the HaloPSA ticket record.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowTicketModal(false)}
                className="px-3 py-1.5 bg-[#181c22] text-[#8a919e] hover:text-white rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePsaTicket}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded text-xs shadow"
              >
                Create &amp; Bind Ticket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Action Card Modal */}
      {showActionCardModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#101419] border border-[#272f3d] rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272f3d] pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Draft Interactive Action Card</h3>
              </div>
              <button onClick={() => setShowActionCardModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">Action Type</label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as any)}
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="authorization">Authorization Request</option>
                  <option value="session_revoke">Emergency Session Revocation</option>
                  <option value="mfa_reset">MFA Reset Authorization</option>
                  <option value="device_wipe">Intune Remote Device Wipe</option>
                  <option value="password_reset">Password Reset Token</option>
                </select>
              </div>

              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">Card Title</label>
                <input
                  type="text"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="e.g. Requesting authorization for Remote Session Wipe"
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="block text-[#8a919e] font-semibold mb-1">Description / Justification</label>
                <textarea
                  value={actionDescription}
                  onChange={(e) => setActionDescription(e.target.value)}
                  rows={3}
                  placeholder="Explain why this administrative workflow requires client authorization..."
                  className="w-full bg-[#181c22] border border-[#272f3d] rounded p-2 text-white placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowActionCardModal(false)}
                className="px-3 py-1.5 bg-[#181c22] text-[#8a919e] hover:text-white rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCustomActionCard}
                disabled={!actionTitle.trim()}
                className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#0063b1] disabled:opacity-50 text-white font-bold rounded text-xs shadow"
              >
                Send Action Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default SupportChatConsole;

