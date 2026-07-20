/**
 * AppShell — shared layout for all authenticated MSP Portal pages.
 *
 * Provides:
 *   - Role-aware sidebar navigation
 *   - Tenant/customer switcher for MSPAdmins and PlatformAdmins
 *   - Real white-label branding from /api/msp/profile (MSP name, logo, primary color)
 *   - Persistent credibility footer (non-removable)
 *   - Cmd+K command palette
 *   - Mobile-responsive with collapsible sidebar
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, type MspRole } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { useSupportChat, type SupportChatMessage } from "@/lib/support-chat-context";
import { useTheme } from "@/lib/theme-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  Bell,
  BookOpen,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cog,
  CreditCard,
  Download,
  FileBarChart2,
  FileText,
  FolderOpen,
  FolderSync,
  Gauge,
  Gift,
  GitBranch,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Loader2,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Moon,
  Package,
  Play,
  Plus,
  Receipt,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  Timer,
  Trash2,
  User,
  Users,
  Webhook,
  X,
  XCircle,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  roles?: MspRole[];
}

interface MspProfile {
  id: number;
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  status: string;
}

function getInitials(name?: string | null, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    return email.substring(0, 2).toUpperCase();
  }
  return "U";
}

// ── Support Chat Slide-Out Sheet ───────────────────────────────────────────────

const SUPPORT_STARTER_PROMPTS = [
  "What is my current plan status?",
  "What signals have fired recently?",
  "What's the status of my active services?",
  "When is the next monitoring run?",
];

function SupportMessageBubble({ message }: { message: SupportChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-[11px] text-amber-500">
          <AlertCircle className="size-3 shrink-0" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`shrink-0 size-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className={`flex flex-col gap-1 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-xs"
              : "bg-muted text-foreground rounded-tl-xs"
          }`}
        >
          {message.content}
          {message.escalated && (
            <div className="mt-1.5 pt-1.5 border-t border-amber-500/30 flex items-center gap-1 text-[10px] text-amber-500">
              <AlertCircle className="size-3 shrink-0" />
              <span>Escalated to human support</span>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/60 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

function DockedSupportPanel() {
  const {
    setSupportOpen,
    messages,
    input,
    setInput,
    sending,
    escalating,
    everEscalated,
    savedChats,
    activeChatId,
    sendMessage,
    handleExplicitEscalate,
    loadChat,
    startNewChat,
    deleteChat,
  } = useSupportChat();

  const [view, setView] = useState<"chat" | "history">("chat");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view === "chat") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, view]);

  const isEmpty = messages.filter((m) => m.role === "user").length === 0;

  if (view === "history") {
    return (
      <aside className="w-80 md:w-96 shrink-0 border-l border-border bg-background flex flex-col h-screen sticky top-0 z-20 shadow-xl transition-all duration-300">
        {/* Header */}
        <div className="p-3.5 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setView("chat")}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mr-1 shrink-0"
              title="Back to chat"
            >
              <ArrowLeft className="size-4" />
            </button>
            <h2 className="text-sm font-semibold text-foreground truncate">Chat History</h2>
          </div>
          <button
            onClick={() => setSupportOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Close chat panel"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {savedChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <History className="size-8 text-muted-foreground/45 mb-2" />
              <p className="text-xs font-medium text-muted-foreground">No saved chats</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[200px]">
                Your support chats will appear here once you send a message.
              </p>
            </div>
          ) : (
            savedChats.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-start justify-between gap-2 p-3 rounded-lg border text-left cursor-pointer transition-all hover:bg-muted/50 ${
                  activeChatId === chat.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-border"
                }`}
                onClick={() => {
                  loadChat(chat.id);
                  setView("chat");
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {chat.title || "Support Query"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/75 mt-1">
                    {new Date(chat.timestamp).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {chat.everEscalated && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-amber-500 mt-1 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      Escalated
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChat(chat.id);
                  }}
                  className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  title="Delete chat"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 md:w-96 shrink-0 border-l border-border bg-background flex flex-col h-full z-20 shadow-xl transition-all duration-300">
      {/* Header */}
      <div className="p-3.5 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-primary shrink-0">
            <MessageSquare className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">Support Chat</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              AI-assisted • Grounded in platform data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* New Chat Button */}
          <button
            onClick={() => {
              startNewChat();
              toast.success("Started a new chat session");
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors animate-in fade-in"
            title="Start new chat"
          >
            <Plus className="size-4" />
          </button>
          
          {/* History Button */}
          <button
            onClick={() => setView("history")}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View chat history"
          >
            <History className="size-4" />
          </button>

          <button
            onClick={() => setSupportOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close chat panel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.map((msg) => (
          <SupportMessageBubble key={msg.id} message={msg} />
        ))}
        {sending && (
          <div className="flex gap-2.5">
            <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Bot className="size-3.5 text-muted-foreground" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-xs px-3 py-2 flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Starter Prompts */}
      {isEmpty && !sending && (
        <div className="p-3 border-t border-border/60 bg-muted/20 shrink-0">
          <p className="text-[11px] text-muted-foreground mb-2 font-medium">Suggested questions:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORT_STARTER_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => void sendMessage(p)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-border/70 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground text-left"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Escalation notification */}
      {everEscalated && (
        <div className="px-4 py-2 bg-green-500/10 border-t border-green-500/20 flex items-center gap-2 text-xs text-green-500 shrink-0">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Support team has been notified and will follow up.
        </div>
      )}

      {/* Footer / Input */}
      <div className="p-3 border-t border-border bg-background shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="flex gap-2 items-center"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Ask a question..."
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none text-xs py-2 px-3"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || sending}
            className="size-9 shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </form>
        <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-muted-foreground">
          <span>Press Enter to send</span>
          <button
            type="button"
            onClick={() => void handleExplicitEscalate()}
            disabled={escalating}
            className="hover:underline text-amber-500/80 hover:text-amber-500 transition-colors"
          >
            {escalating ? "Escalating..." : "Talk to human support"}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Navigation config ─────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        href: "/dashboard",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: LayoutDashboard,
        label: "Widget Dashboard",
        href: "/msp-dashboard",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: LayoutDashboard,
        label: "Dashboard Designer",
        href: "/dashboard-designer",
        roles: ["MSPAdmin", "MSPOperator"],
      },
    ],
  },
  {
    label: "My Portal",
    items: [
      {
        icon: Home,
        label: "Home",
        href: "/customer-home",
        roles: ["CustomerUser"],
      },
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        href: "/customer-dashboard",
        roles: ["CustomerUser"],
      },
      {
        icon: Sparkles,
        label: "Executive Mode",
        href: "/executive-mode",
        roles: ["CustomerUser"],
      },
      {
        icon: FileText,
        label: "Documents",
        href: "/customer-documents",
        roles: ["CustomerUser"],
      },
      {
        icon: Zap,
        label: "Diagnostics & Offers",
        href: "/customer-diagnostics",
        roles: ["CustomerUser"],
      },
      {
        icon: History,
        label: "Activity Timeline",
        href: "/customer-timeline",
        roles: ["CustomerUser"],
      },
      {
        icon: Gift,
        label: "My Offers",
        href: "/customer-offers",
        roles: ["CustomerUser"],
      },
      {
        icon: Store,
        label: "Marketplace",
        href: "/marketplace",
        // Shared across roles — Assessment reaches it via the sidebar; CustomerUser
        // (who uses CustomerTopBar, not the sidebar) reaches it via the avatar menu.
        roles: ["Assessment", "CustomerUser"],
      },
      {
        icon: ShieldCheck,
        label: "Service Levels",
        href: "/customer-sla",
        roles: ["CustomerUser"],
      },
      {
        icon: FolderSync,
        label: "Project Scope",
        href: "/customer-scope",
        roles: ["CustomerUser"],
      },
      {
        icon: MessageCircle,
        label: "Support",
        href: "/support",
        roles: ["CustomerUser"],
      },
      {
        icon: Users,
        label: "Team Members",
        href: "/customer-team",
        roles: ["CustomerUser"],
      },
      {
        icon: CreditCard,
        label: "Billing",
        href: "/customer-billing",
        roles: ["CustomerUser"],
      },
      {
        icon: Lock,
        label: "Privacy & Data",
        href: "/customer-privacy",
        roles: ["CustomerUser"],
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        icon: Users,
        label: "User Management",
        href: "/users",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
      {
        icon: Building2,
        label: "MSPs",
        href: "/msps",
        roles: ["PlatformAdmin"],
      },
      {
        icon: Gauge,
        label: "Executive Mode",
        href: "/executive",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Users,
        label: "Customers",
        href: "/customers",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: BookOpen,
        label: "Document Library",
        href: "/documents",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Bell,
        label: "Events",
        href: "/events",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Shield,
        label: "Audit Logs",
        href: "/audit",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
      {
        icon: Trash2,
        label: "Data Rights",
        href: "/data-rights",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
      {
        icon: AlertTriangle,
        label: "Alerts",
        href: "/alerts",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: History,
        label: "Timeline",
        href: "/msp-timeline",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Megaphone,
        label: "Message Center",
        href: "/message-center",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: FileText,
        label: "Customer Documents",
        href: "/documents-hub",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Timer,
        label: "SLA Dashboard",
        href: "/sla",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: GitBranch,
        label: "Scope Creep",
        href: "/scope-creep",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Package,
        label: "Sales Bundles",
        href: "/sales-bundles",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Sparkles,
        label: "Offer Pipeline",
        href: "/offers",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Receipt,
        label: "Chargeback",
        href: "/chargeback",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        icon: FileBarChart2,
        label: "Report Builder",
        href: "/reports",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        icon: ListTodo,
        label: "Operator Tasks",
        href: "/operator-tasks",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Check,
        label: "Approvals",
        href: "/pending-approvals",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Play,
        label: "Workflow Runs",
        href: "/runs",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: AlertCircle,
        label: "Dead Letter Queue",
        href: "/dlq",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
    ],
  },
  {
    label: "Support",
    items: [
      {
        icon: MessageCircle,
        label: "Support Chat",
        href: "/support",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        icon: FileText,
        label: "Offboarding",
        href: "/offboarding",
        roles: ["MSPAdmin", "CustomerUser"],
      },
      {
        icon: Webhook,
        label: "Webhooks",
        href: "/webhooks",
        roles: ["MSPAdmin", "CustomerUser"],
      },
      {
        icon: Cog,
        label: "Settings",
        href: "/settings",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
    ],
  },
];

const ROLE_COLORS: Record<MspRole, string> = {
  PlatformAdmin: "bg-primary text-primary-foreground",
  MSPAdmin: "bg-accent/20 text-accent",
  MSPOperator: "bg-secondary text-secondary-foreground",
  CustomerUser: "bg-muted text-muted-foreground",
  ServiceAccount: "bg-muted text-muted-foreground",
  Free: "bg-muted text-muted-foreground",
  Assessment: "bg-muted text-muted-foreground",
};

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function SidebarNavItem({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) {
  const [location] = useLocation();
  const active =
    item.href === "/dashboard"
      ? location === "/dashboard" || location === "/"
      : location.startsWith(item.href);

  const cls = [
    "flex items-center gap-2.5 rounded-md text-sm transition-colors w-full",
    collapsed ? "px-2 py-2 justify-center" : "px-3 py-2",
    active
      ? "bg-sidebar-accent text-sidebar-foreground font-medium"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  ].join(" ");

  return (
    <Link href={item.href}>
      <button className={cls} title={collapsed ? item.label : undefined}>
        <item.icon className="size-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </button>
    </Link>
  );
}

// ── Tenant/customer switcher ──────────────────────────────────────────────────

interface TenantEntry {
  id: number;
  name: string;
  type: "msp" | "customer";
  slug?: string;
}

function TenantSwitcher({
  profile,
  collapsed,
  fetchWithAuth,
  mspRole,
}: {
  profile: MspProfile | null;
  collapsed: boolean;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  mspRole: MspRole | undefined;
}) {
  const [, navigate] = useLocation();
  const [tenants, setTenants] = useState<TenantEntry[]>([]);
  const [open, setOpen] = useState(false);

  // PlatformAdmin can switch between MSPs; MSPAdmin and MSPOperator can switch customer context
  const canSwitch = mspRole === "PlatformAdmin" || mspRole === "MSPAdmin" || mspRole === "MSPOperator";

  useEffect(() => {
    if (!open || !canSwitch) return;
    const endpoint =
      mspRole === "PlatformAdmin" ? "/api/admin/msps?limit=20" : "/api/msp/customers?limit=20";
    fetchWithAuth(endpoint)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          msps?: Array<{ id: number; name: string; slug: string }>;
          customers?: Array<{ id: number; name: string }>;
        };
        const items: TenantEntry[] = [
          ...(data.msps ?? []).map((m) => ({ id: m.id, name: m.name, type: "msp" as const, slug: m.slug })),
          ...(data.customers ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            type: "customer" as const,
          })),
        ];
        setTenants(items);
      })
      .catch(() => {});
  }, [open, canSwitch, mspRole, fetchWithAuth]);

  if (!profile) {
    return (
      <div className={`px-3 py-2 rounded-md bg-sidebar-accent/30 animate-pulse flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
        <div className="size-3.5 rounded bg-sidebar-foreground/20 shrink-0" />
        {!collapsed && <div className="h-3 w-28 rounded bg-sidebar-foreground/20 shrink-0" />}
      </div>
    );
  }

  const displayName = profile.name;

  if (!canSwitch || collapsed) {
    return (
      <div
        className={`px-3 py-2 rounded-md bg-sidebar-accent/40 ${collapsed ? "flex justify-center" : ""}`}
        title={collapsed ? displayName : undefined}
      >
        {collapsed ? (
          <Building2 className="size-4 text-sidebar-foreground/60" />
        ) : (
          <p className="text-xs font-medium text-sidebar-foreground truncate">{displayName}</p>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/40 hover:bg-sidebar-accent/70 transition-colors text-left">
          <Building2 className="size-3.5 text-sidebar-foreground/60 shrink-0" />
          <span className="flex-1 text-xs font-medium text-sidebar-foreground truncate">
            {displayName}
          </span>
          <ChevronDown className="size-3 text-sidebar-foreground/40 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        className="w-56"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {mspRole === "PlatformAdmin" ? "Switch MSP" : "Switch Customer"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            Loading…
          </DropdownMenuItem>
        ) : (
          tenants.slice(0, 10).map((t) => (
            <DropdownMenuItem
              key={`${t.type}-${t.id}`}
              className="text-sm gap-2"
              onSelect={() => {
                if (t.type === "msp") {
                  fetchWithAuth(`/api/admin/msps/${t.id}/impersonate`, { method: "POST" })
                    .then(async (res) => {
                      if (!res.ok) return;
                      const data = (await res.json()) as { token?: string; targetSlug?: string };
                      if (data.token && data.targetSlug) {
                        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                        window.open(
                          `${base}/?impersonation_token=${encodeURIComponent(data.token)}&target_slug=${encodeURIComponent(data.targetSlug)}`,
                          "_blank",
                        );
                      }
                    })
                    .catch(() => {});
                  return;
                }
                // Customer impersonation: issue a single-use token, then open
                // the impersonated session in a NEW TAB so the current admin
                // session in this tab is left completely untouched.
                const mspId = profile?.id;
                if (!mspId) return;
                fetchWithAuth(`/api/msp/${mspId}/customers/${t.id}/impersonate`, {
                  method: "POST",
                })
                  .then(async (res) => {
                    if (!res.ok) return;
                    const data = (await res.json()) as { token?: string; targetSlug?: string };
                    if (data.token && data.targetSlug) {
                      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                      window.open(
                        `${base}/?impersonation_token=${encodeURIComponent(data.token)}&target_slug=${encodeURIComponent(data.targetSlug)}`,
                        "_blank",
                      );
                    }
                  })
                  .catch(() => {});
              }}
            >
              {t.type === "msp" ? (
                <Building2 className="size-3.5 text-muted-foreground" />
              ) : (
                <Users className="size-3.5 text-muted-foreground" />
              )}
              <span className="truncate">{t.name}</span>
              {profile && t.type === "msp" && t.id === profile.id && (
                <Check className="size-3.5 ml-auto text-primary" />
              )}
            </DropdownMenuItem>
          ))
        )}
        {mspRole === "PlatformAdmin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-muted-foreground gap-2"
              onSelect={() => navigate("/msps")}
            >
              <Building2 className="size-3.5" />
              View all MSPs
            </DropdownMenuItem>
          </>
        )}
        {(mspRole === "MSPAdmin" || mspRole === "MSPOperator") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-muted-foreground gap-2"
              onSelect={() => navigate("/customers")}
            >
              <Users className="size-3.5" />
              View all customers
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function ImpersonationBanner({ email }: { email: string }) {
  const handleExit = () => {
    if (window.opener) {
      window.close();
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-white flex items-center justify-between px-4 py-2 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        Admin Preview Mode — Viewing as <span className="underline underline-offset-2">{email}</span>
        <span className="text-amber-200 font-normal">(session expires in 30 min)</span>
      </div>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Exit Preview
      </button>
    </div>
  );
}


// ── Customer Documents slide-in panel ─────────────────────────────────────────
//
// Lightweight side panel over the SAME data the full Documents page reads
// (/api/portal/insights-documents + /api/portal/reports). It is a new view,
// not a new data source — no duplicated backend. Opened from the top-bar
// Documents icon (CustomerUser only). Empty state is handled gracefully.

interface PanelDocument {
  id: number;
  title: string;
  docType: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
}

interface PanelReport {
  id: number;
  title: string;
  period: string | null;
  createdAt: string | null;
}

function panelRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CustomerDocumentsPanel({
  open,
  onOpenChange,
  fetchWithAuth,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
}) {
  const [docs, setDocs] = useState<PanelDocument[]>([]);
  const [reports, setReports] = useState<PanelReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Fetch lazily the first time the panel is opened; keep results cached for
  // subsequent opens within the session.
  useEffect(() => {
    if (!open || loaded) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetchWithAuth("/api/portal/insights-documents")
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
      fetchWithAuth("/api/portal/reports")
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
    ])
      .then(([d, r]) => {
        if (!mounted) return;
        setDocs(Array.isArray(d) ? (d as PanelDocument[]) : []);
        setReports(Array.isArray(r) ? (r as PanelReport[]) : []);
        setLoaded(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, loaded, fetchWithAuth]);

  const isEmpty = !loading && docs.length === 0 && reports.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
        <SheetHeader className="px-5 py-4 border-b border-border text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            Documents &amp; Reports
          </SheetTitle>
          <SheetDescription className="text-xs">
            Your assessments, statements of work, and periodic reports.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-16 px-4">
              <FolderOpen className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No documents yet</p>
              <p className="text-xs text-muted-foreground/60 max-w-[240px]">
                Assessments, roadmaps, statements of work, and reports will appear
                here once your engagement begins.
              </p>
              <Link href="/customer-documents" onClick={() => onOpenChange(false)}>
                <Button variant="outline" size="sm" className="mt-2 h-7 text-xs">
                  Open Documents page
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {docs.length > 0 && (
                <div className="space-y-2">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Assessments &amp; SOWs
                  </p>
                  {docs.map((doc) => (
                    <Link
                      key={`doc-${doc.id}`}
                      href="/customer-documents"
                      onClick={() => onOpenChange(false)}
                    >
                      <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <FileText className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{doc.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {panelRelativeDate(doc.deliveredAt ?? doc.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {reports.length > 0 && (
                <div className="space-y-2">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Reports
                  </p>
                  {reports.map((report) => (
                    <Link
                      key={`rep-${report.id}`}
                      href="/customer-documents"
                      onClick={() => onOpenChange(false)}
                    >
                      <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <FileBarChart2 className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{report.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                            {report.period ? `${report.period} report` : "Report"} ·{" "}
                            {panelRelativeDate(report.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 shrink-0">
          <Link href="/customer-documents" onClick={() => onOpenChange(false)}>
            <button className="text-xs text-primary hover:underline">
              View all documents &amp; reports →
            </button>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Customer top bar (CustomerUser role only) ─────────────────────────────────
//
// Replaces the left-nav sidebar entirely for CustomerUser: all wayfinding lives
// in this persistent bar. Other roles keep the sidebar shell unchanged.

function CustomerTopBar({
  profile,
  brandName,
  user,
  mspRole,
  onSearch,
  onOpenDocs,
  onToggleSupport,
  supportOpen,
  isPlatformAdmin,
  onLogout,
  navigate,
}: {
  profile: MspProfile | null;
  brandName: string;
  user: ReturnType<typeof useAuth>["user"];
  mspRole: MspRole | undefined;
  onSearch: () => void;
  onOpenDocs: () => void;
  onToggleSupport: () => void;
  supportOpen: boolean;
  isPlatformAdmin: boolean;
  onLogout: () => void;
  navigate: (to: string) => void;
}) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur flex items-center gap-3 px-4 md:px-6 sticky top-0 z-10">
      {/* Tenant identity — MSP brand (white-label) + attribution.
          Reuses the same profile data the sidebar shell renders; no refetch. */}
      <Link href="/customer-home">
        <div className="flex items-center gap-2.5 min-w-0 cursor-pointer group">
          {profile?.logoUrl ? (
            <img src={profile.logoUrl} alt={brandName} className="size-6 object-contain shrink-0" />
          ) : (
            <Shield className="size-5 text-primary shrink-0" />
          )}
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {brandName || "Your Portal"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate hidden sm:block">
              Managed service portal
            </p>
          </div>
        </div>
      </Link>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {/* Search — ⌘K trigger. Visual/keyboard element only; no search backend
            yet (see CommandPalette wiring in AppShell). */}
        <button
          className="hidden sm:flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={onSearch}
          aria-label="Search"
        >
          <Search className="size-3.5" />
          <span>Search</span>
          <kbd className="text-[10px] bg-border px-1 rounded">⌘K</kbd>
        </button>
        <button
          className="sm:hidden rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={onSearch}
          aria-label="Search"
        >
          <Search className="size-4" />
        </button>

        {/* Notification bell — unchanged component */}
        <NotificationBell />

        {/* Documents — opens the slide-in panel */}
        <button
          className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={onOpenDocs}
          aria-label="Documents"
          title="Documents"
        >
          <FileText className="size-4" />
        </button>

        {/* Support chat — standalone icon (not a menu item) */}
        {!isPlatformAdmin && (
          <button
            className={`relative rounded-md p-2 transition-colors ${
              supportOpen
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            onClick={onToggleSupport}
            title={supportOpen ? "Close Support Chat" : "Open Support Chat"}
            aria-label="Support Chat"
          >
            <MessageSquare className="size-4" />
          </button>
        )}

        {/* Profile avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-transform active:scale-95 ml-0.5"
              aria-label="User profile menu"
              title={user?.name ?? user?.email ?? "User profile"}
            >
              <Avatar className="size-8 border border-border/60 shadow-sm">
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                  {getInitials(user?.name, user?.email)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-2">
            <DropdownMenuLabel className="font-normal p-2">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold leading-none text-foreground truncate">
                  {user?.name ?? user?.email ?? "User Account"}
                </p>
                <p className="text-xs leading-none text-muted-foreground truncate">
                  {user?.email}
                </p>
                {mspRole && (
                  <div className="pt-1">
                    <Badge className={`text-[10px] px-1.5 py-0 h-4 ${ROLE_COLORS[mspRole] ?? "bg-muted"}`}>
                      {mspRole}
                    </Badge>
                  </div>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Real pages */}
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/marketplace")}>
              <Store className="size-4 text-muted-foreground" />
              <span>Marketplace</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/customer-team")}>
              <Users className="size-4 text-muted-foreground" />
              <span>Manage Team</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/customer-documents")}>
              <FileText className="size-4 text-muted-foreground" />
              <span>Documents</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/customer-billing")}>
              <CreditCard className="size-4 text-muted-foreground" />
              <span>Billing</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/settings")}>
              <Cog className="size-4 text-muted-foreground" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/settings/security")}>
              <KeyRound className="size-4 text-muted-foreground" />
              <span>Password &amp; MFA</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/customer-notifications")}>
              <Bell className="size-4 text-muted-foreground" />
              <span>Notification Preferences</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/coming-soon/download-data")}>
              <Download className="size-4 text-muted-foreground" />
              <span>Download My Data</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2 py-2" onSelect={() => navigate("/customer-privacy")}>
              <Lock className="size-4 text-muted-foreground" />
              <span>Privacy &amp; Data</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Dark mode toggle — wired to the live ThemeProvider. Kept as a
                clickable row (not a nav) so selecting it doesn't close via
                navigation; onSelect preventDefault keeps the menu open. */}
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-2"
              onSelect={(e) => {
                e.preventDefault();
                setTheme(isDark ? "light" : "dark");
              }}
            >
              {isDark ? (
                <Sun className="size-4 text-muted-foreground" />
              ) : (
                <Moon className="size-4 text-muted-foreground" />
              )}
              <span className="flex-1">Dark Mode</span>
              <span
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  isDark ? "bg-primary" : "bg-muted-foreground/30"
                }`}
                aria-hidden="true"
              >
                <span
                  className={`inline-block size-3 rounded-full bg-white transition-transform ${
                    isDark ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="cursor-pointer gap-2 py-2 text-amber-600 dark:text-amber-400 focus:text-amber-600 focus:bg-amber-50 dark:focus:bg-amber-950/40"
              onSelect={() => navigate("/coming-soon/cancel-service")}
            >
              <XCircle className="size-4" />
              <span>Cancel Service</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-2 text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
              onSelect={onLogout}
            >
              <LogOut className="size-4" />
              <span>Log Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// ── Main AppShell ─────────────────────────────────────────────────────────────

interface AppShellProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}

let g_cachedMspProfile: MspProfile | null = null;

interface MspSuspensionState {
  suspended: boolean;
  daysSuspended: number | null;
}

export function AppShell({ children, title, actions }: AppShellProps) {
  const { user, logout, fetchWithAuth } = useAuth();
  const { supportOpen, setSupportOpen } = useSupportChat();
  const [, navigate] = useLocation();
  const slug = useMspSlug();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [docsPanelOpen, setDocsPanelOpen] = useState(false);
  const [profile, setProfile] = useState<MspProfile | null>(() => {
    if (g_cachedMspProfile) return g_cachedMspProfile;
    try {
      const saved = localStorage.getItem("msp_portal_cached_profile");
      if (saved) {
        const parsed = JSON.parse(saved) as MspProfile;
        g_cachedMspProfile = parsed;
        return parsed;
      }
    } catch {}
    return null;
  });
  const [suspension, setSuspension] = useState<MspSuspensionState | null>(null);
  const [customerStatus, setCustomerStatus] = useState<string | null>(null);

  const mspRole = user?.mspRole;
  // Support chat is tenant-scoped and not available to PlatformAdmin (the
  // backend rejects PlatformAdmin chat/escalate with 403). Hide the trigger and
  // the docked panel so the affordance never appears for them.
  const isPlatformAdmin = user?.role === "admin" || user?.mspRole === "PlatformAdmin";

  // Fetch MSP profile for real white-label branding.
  // For PlatformAdmin (no mspId on token), pass ?slug= so the backend can resolve the MSP.
  useEffect(() => {
    if (!user) return;
    const isPlatformAdmin = user.role === "admin" || user.mspRole === "PlatformAdmin";
    const url =
      isPlatformAdmin && slug
        ? `/api/msp/profile?slug=${encodeURIComponent(slug)}`
        : "/api/msp/profile";
    fetchWithAuth(url)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as MspProfile;
          g_cachedMspProfile = data;
          setProfile(data);
          try {
            localStorage.setItem("msp_portal_cached_profile", JSON.stringify(data));
          } catch {}
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.mspId, slug]);

  // Fetch MSP suspension state for CustomerUser only.
  // The banner appears on every customer-facing page after 7 days of suspension.
  useEffect(() => {
    if (mspRole !== "CustomerUser") return;
    fetchWithAuth("/api/portal/msp-suspension")
      .then(async (res) => {
        if (res.ok) setSuspension(await res.json() as MspSuspensionState);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mspRole, user?.mspId]);

  // Fetch customerStatus if CustomerUser
  useEffect(() => {
    if (mspRole !== "CustomerUser") return;
    fetchWithAuth("/api/portal/dashboard")
      .then(async (res) => {
        if (res.ok) {
          const d = await res.json() as { customerStatus?: string };
          setCustomerStatus(d.customerStatus ?? null);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mspRole]);
  useEffect(() => {
    if (!profile?.primaryColor) return;
    const safe = profile.primaryColor.replace(/[^a-zA-Z0-9#(),%.\s]/g, "");
    document.documentElement.style.setProperty("--msp-brand-color", safe);
    return () => {
      document.documentElement.style.removeProperty("--msp-brand-color");
    };
  }, [profile?.primaryColor]);

  function isVisible(item: NavItem) {
    if (!item.roles || item.roles.length === 0) return true;
    if (!mspRole) return false;
    return item.roles.includes(mspRole);
  }

  const isMspInactive = (mspRole === "MSPAdmin" || mspRole === "MSPOperator") && 
    (profile?.status === "inactive" || profile?.status === "disabled");

  const isCustomerInactive = mspRole === "CustomerUser" && 
    (customerStatus === "inactive" || customerStatus === "disabled");

  const isAccountInactive = isMspInactive || isCustomerInactive;

  // Cmd+K global keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const brandName = profile?.name ?? "";
  const sidebarWidth = collapsed ? "w-14" : "w-60";

  const sidebarContent = (
    <div
      className={`flex flex-col h-full bg-sidebar text-sidebar-foreground ${sidebarWidth} shrink-0 border-r border-sidebar-border transition-all duration-200`}
    >
      {/* Logo / brand */}
      <div
        className={`flex items-center border-b border-sidebar-border ${collapsed ? "px-2 py-4 justify-center" : "px-4 py-4 gap-2.5"}`}
      >
        {!profile ? (
          <>
            <Shield className="size-5 text-sidebar-primary shrink-0 animate-pulse" />
            {!collapsed && (
              <div className="h-4 w-28 bg-sidebar-accent/60 rounded-md animate-pulse shrink-0" />
            )}
          </>
        ) : (
          <>
            {profile.logoUrl ? (
              <img
                src={profile.logoUrl}
                alt={brandName}
                className="size-6 object-contain shrink-0"
              />
            ) : (
              <Shield className="size-5 text-sidebar-primary shrink-0" />
            )}
            {!collapsed && (
              <span className="font-semibold text-sm truncate flex-1 animate-in fade-in duration-200">
                {brandName}
              </span>
            )}
            {!collapsed && (
              <button
                className="text-sidebar-foreground/40 hover:text-sidebar-foreground shrink-0"
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Tenant/customer switcher */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <TenantSwitcher
            profile={profile}
            collapsed={collapsed}
            fetchWithAuth={fetchWithAuth}
            mspRole={mspRole}
          />
        </div>
      )}
      {collapsed && (
        <div className="px-2 pt-3 pb-1">
          <TenantSwitcher
            profile={profile}
            collapsed={collapsed}
            fetchWithAuth={fetchWithAuth}
            mspRole={mspRole}
          />
        </div>
      )}

      {/* Search trigger */}
      {!collapsed && (
        <div className="px-3 pt-2 pb-1">
          <button
            className="w-full flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/70 transition-colors"
            onClick={() => setCmdOpen(true)}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">Search customers…</span>
            <kbd className="text-[10px] bg-sidebar-border px-1 rounded">⌘K</kbd>
          </button>
        </div>
      )}
      {collapsed && (
        <div className="px-2 pt-2 pb-1">
          <button
            className="w-full flex justify-center rounded-md py-1.5 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
            onClick={() => setCmdOpen(true)}
            title="Search (⌘K)"
          >
            <Search className="size-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(isVisible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <SidebarNavItem key={item.href} item={item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User / sign-out */}
      <div className="px-2 py-3 border-t border-sidebar-border space-y-1">
        {!collapsed && (
          <div className="px-3 py-2 rounded-md bg-sidebar-accent/40">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {user?.name ?? user?.email}
            </p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate">{user?.email}</p>
            {mspRole && (
              <Badge
                className={`mt-1 text-[10px] px-1.5 py-0 h-4 ${ROLE_COLORS[mspRole] ?? "bg-muted"}`}
              >
                {mspRole}
              </Badge>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={`text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent ${collapsed ? "w-full justify-center px-2" : "w-full justify-start"}`}
          onClick={() => void logout()}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className={`size-4 ${collapsed ? "" : "mr-2"}`} />
          {!collapsed && "Sign out"}
        </Button>
        {collapsed && (
          <button
            className="w-full flex justify-center py-1.5 text-sidebar-foreground/40 hover:text-sidebar-foreground"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );

  const isCustomerUser = mspRole === "CustomerUser";

  // Shared page body — inactive/suspension banners, the routed page content,
  // and the persistent credibility footer. Identical for every role; only the
  // surrounding chrome (sidebar vs. customer top bar) differs.
  const pageBody = (
    <>
      {isAccountInactive && (
        <div
          role="alert"
          className="shrink-0 flex items-center justify-between gap-4 px-4 md:px-6 py-3 bg-rose-500/10 border-b border-rose-500/30 text-rose-800 dark:text-rose-300"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-rose-500" />
            <p className="text-sm">
              <span className="font-semibold">Subscription Inactive:&nbsp;</span>
              {mspRole === "CustomerUser"
                ? "Monitoring and telemetry services are currently paused for your organization."
                : "Telemetry estate monitoring has been paused."}
              {" "}Please resubscribe to reactivate your services.
            </p>
          </div>
          <Link href={mspRole === "CustomerUser" ? "/customer-billing" : "/settings/billing"}>
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white rounded-lg px-4 shrink-0">
              Resubscribe
            </Button>
          </Link>
        </div>
      )}

      {/* Day 7+ MSP-suspended banner — shown to CustomerUsers only, non-dismissible */}
      {/* Server already enforces the 7-day threshold; suspended===true means ≥7 days */}
      {mspRole === "CustomerUser" && suspension?.suspended && (
        <div
          role="alert"
          aria-live="polite"
          className="shrink-0 flex items-start gap-3 px-4 md:px-6 py-3 bg-amber-500/10 border-b border-amber-500/30 text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-semibold">Service provider notice:&nbsp;</span>
            There is an account issue on your service provider&apos;s side. No
            action is required from you — your data is safe and your projects
            remain accessible. If you have concerns, please contact{" "}
            <a
              href="mailto:support@shanemccawconsulting.com"
              className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
            >
              support
            </a>
            .
          </p>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 overflow-y-auto min-h-0">{children}</main>

      {/* Credibility footer — persistent, non-removable, fixed at bottom */}
      <footer className="shrink-0 border-t border-border bg-background/60 px-6 py-3 z-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Award className="size-3.5 text-primary shrink-0" />
            <span>
              Modernization delivered by a{" "}
              <span className="text-foreground font-medium">
                30-Year Microsoft Veteran &amp; M365 Architect for NASA
              </span>
            </span>
          </div>
          <span className="shrink-0">
            Powered by{" "}
            <span className="text-foreground font-medium">Shane McCaw Consulting</span>
          </span>
        </div>
      </footer>
    </>
  );

  // ── CustomerUser layout — no left sidebar; all wayfinding in the top bar ────
  if (isCustomerUser) {
    return (
      <>
        {user?.impersonatedBy && <ImpersonationBanner email={user.email} />}
        <div className={`flex h-screen max-h-screen overflow-hidden bg-background ${user?.impersonatedBy ? "pt-[42px]" : ""}`}>
          <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
            <CustomerTopBar
              profile={profile}
              brandName={brandName}
              user={user}
              mspRole={mspRole}
              onSearch={() => setCmdOpen(true)}
              onOpenDocs={() => setDocsPanelOpen(true)}
              onToggleSupport={() => setSupportOpen((v) => !v)}
              supportOpen={supportOpen}
              isPlatformAdmin={isPlatformAdmin}
              onLogout={() => void logout()}
              navigate={navigate}
            />
            {pageBody}
          </div>

          {/* Non-blocking Docked Support Panel on the Right */}
          {supportOpen && !isPlatformAdmin && <DockedSupportPanel />}

          <CustomerDocumentsPanel
            open={docsPanelOpen}
            onOpenChange={setDocsPanelOpen}
            fetchWithAuth={fetchWithAuth}
          />
          <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
        </div>
      </>
    );
  }

  return (
    <>
      {user?.impersonatedBy && <ImpersonationBanner email={user.email} />}
      <div className={`flex h-screen max-h-screen overflow-hidden bg-background ${user?.impersonatedBy ? "pt-[42px]" : ""}`}>
        {/* Desktop sidebar */}
        <div className="hidden md:flex flex-col h-full shrink-0">{sidebarContent}</div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute left-0 top-0 h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur flex items-center gap-3 px-4 md:px-6 sticky top-0 z-10">
          <button
            className="md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          {title && (
            <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
          )}

          <div className="ml-auto flex items-center gap-2">
            {actions}

            {/* 1. Search */}
            <button
              className="hidden sm:flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setCmdOpen(true)}
            >
              <Search className="size-3.5" />
              <span>Search</span>
              <kbd className="text-[10px] bg-border px-1 rounded">⌘K</kbd>
            </button>

            {/* 2. Bell */}
            <NotificationBell />

            {/* 3. Chat (Non-blocking docked panel trigger) — hidden for PlatformAdmin */}
            {!isPlatformAdmin && (
              <button
                className={`relative rounded-md p-2 transition-colors ${
                  supportOpen
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                onClick={() => setSupportOpen((v) => !v)}
                title={supportOpen ? "Close Support Chat" : "Open Support Chat"}
                aria-label="Support Chat"
              >
                <MessageSquare className="size-4" />
              </button>
            )}

            {/* 4. Profile Card */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-transform active:scale-95 ml-1"
                  aria-label="User profile menu"
                  title={user?.name ?? user?.email ?? "User profile"}
                >
                  <Avatar className="size-8 border border-border/60 shadow-sm">
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                      {getInitials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-2">
                <DropdownMenuLabel className="font-normal p-2">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-semibold leading-none text-foreground truncate">
                      {user?.name ?? user?.email ?? "User Account"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground truncate">
                      {user?.email}
                    </p>
                    {mspRole && (
                      <div className="pt-1">
                        <Badge
                          className={`text-[10px] px-1.5 py-0 h-4 ${
                            ROLE_COLORS[mspRole] ?? "bg-muted"
                          }`}
                        >
                          {mspRole}
                        </Badge>
                      </div>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* CustomerUser renders a dedicated top bar and never reaches
                    this menu, so these targets are the MSP/admin routes only. */}
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-2"
                  onSelect={() => navigate("/settings")}
                >
                  <Cog className="size-4 text-muted-foreground" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-2"
                  onSelect={() => navigate("/settings/billing")}
                >
                  <CreditCard className="size-4 text-muted-foreground" />
                  <span>Billing</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-2"
                  onSelect={() => navigate("/customer-privacy")}
                >
                  <Lock className="size-4 text-muted-foreground" />
                  <span>Privacy &amp; Data</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-2 text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                  onSelect={() => void logout()}
                >
                  <LogOut className="size-4" />
                  <span>Log Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {pageBody}
      </div>

      {/* Non-blocking Docked Support Panel on the Right — not for PlatformAdmin */}
      {supportOpen && !isPlatformAdmin && <DockedSupportPanel />}

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
    </>
  );
}
