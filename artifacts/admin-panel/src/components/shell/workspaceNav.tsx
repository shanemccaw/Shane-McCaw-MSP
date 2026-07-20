import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Receipt,
  FileText,
  Settings,
  Workflow,
  BarChart3,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Presentation,
  Terminal,
  PlayCircle,
  Megaphone,
  Bot,
  Search,
  Send,
  ClipboardList,
  PenLine,
  Flag,
  CheckSquare,
  Link2,
  UserPlus,
  HelpCircle,
  Target,
  Building2,
  BrainCircuit,
  Share2,
  FolderKanban,
  Layers,
  Activity,
  Database,
  Radio,
  Inbox as InboxIcon,
  ListChecks,
  ListFilter,
  Package,
  Gauge,
  FileStack,
  Boxes,
  History,
  Zap,
  FileJson,
  CloudDownload,
  FileBadge,
  Tags,
  BookOpen,
  Briefcase,
  MailPlus,
  FileSignature,
  Library,
  FolderOpen,
  ShieldCheck,
  AlertTriangle,
  Bug,
  MonitorDot,
  DollarSign,
  Handshake,
  FlaskConical,
  SlidersHorizontal,
  FileSearch,
  Server,
  CreditCard,
  TicketPercent,
  PieChart,
  FileCheck2,
  MessagesSquare,
  Star,
  Rocket,
  Film,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TreeItem {
  id: string;
  label: string;
  /** Absolute app path (may include a ?tab= query). Group nodes may omit it. */
  path?: string;
  icon?: LucideIcon;
  /** Nested children — one extra level; group nodes expand/collapse. */
  children?: TreeItem[];
  /** Key into live badge counts provided by the shell (e.g. unread email). */
  badgeKey?: "unreadEmail";
}

export interface TreeSection {
  id: string;
  label: string;
  items: TreeItem[];
  defaultOpen?: boolean;
}

export interface WorkspaceDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Path prefix that marks this workspace active. */
  prefix: string;
  /** Extra prefixes owned by this workspace (legacy/detail routes). */
  extraPrefixes?: string[];
  defaultPath: string;
  sections: TreeSection[];
  badgeKey?: "unreadEmail";
}

// ─── Marketing subtree (mirrors the grouping proven inside the old IDEShell) ──

const MARKETING = "/command/marketing";

const MARKETING_ITEMS: TreeItem[] = [
  { id: "mkt-dashboard", label: "Dashboard", path: MARKETING, icon: LayoutDashboard },
  {
    id: "mkt-leads", label: "Leads", icon: UserPlus,
    children: [
      { id: "mkt-recommendations", label: "AI Leads", path: `${MARKETING}?tab=recommendations`, icon: Bot },
      { id: "mkt-lead-finder", label: "Lead Finder", path: `${MARKETING}?tab=lead-finder`, icon: Search },
    ],
  },
  {
    id: "mkt-outreach-group", label: "Outreach", icon: Send,
    children: [
      { id: "mkt-outreach", label: "Outreach", path: `${MARKETING}?tab=outreach`, icon: Send },
      { id: "mkt-templates", label: "Templates", path: `${MARKETING}?tab=templates`, icon: ClipboardList },
    ],
  },
  { id: "mkt-content", label: "Content Hub", path: `${MARKETING}?tab=content`, icon: PenLine },
  { id: "mkt-campaigns", label: "Campaigns", path: `${MARKETING}?tab=campaigns`, icon: Flag },
  { id: "mkt-analytics", label: "Analytics", path: `${MARKETING}?tab=analytics`, icon: BarChart3 },
  { id: "mkt-tasks", label: "Tasks", path: `${MARKETING}?tab=tasks`, icon: CheckSquare },
  {
    id: "mkt-more", label: "More", icon: SlidersHorizontal,
    children: [
      { id: "mkt-connections", label: "Connections", path: `${MARKETING}?tab=connections`, icon: Link2 },
      { id: "mkt-settings", label: "Settings", path: `${MARKETING}?tab=settings`, icon: Settings },
    ],
  },
];

// ─── Delivery engines ─────────────────────────────────────────────────────────

const ENGINE_KEYS = ["priority", "pricing", "health", "security", "drift", "forecasting", "crm", "msp", "sla", "monitoring", "sales_offer", "scope_creep"] as const;
const ENGINE_LABELS: Record<(typeof ENGINE_KEYS)[number], string> = {
  priority: "Priority Engine",
  pricing: "Pricing Engine",
  health: "Health Engine",
  security: "Security Engine",
  drift: "Drift Engine",
  forecasting: "Forecasting Engine",
  crm: "CRM Engine",
  msp: "MSP Engine",
  sla: "SLA Engine",
  monitoring: "Monitoring Engine",
  sales_offer: "Sales Offer Engine",
  scope_creep: "Scope Creep",
};

// ─── The seven workspaces ─────────────────────────────────────────────────────

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: "command",
    label: "Command",
    description: "Overview, analytics & AI tools",
    icon: LayoutDashboard,
    prefix: "/command",
    extraPrefixes: ["/prompt-center"],
    defaultPath: "/command/overview",
    sections: [
      {
        id: "overview", label: "Overview", defaultOpen: true,
        items: [
          { id: "cmd-overview", label: "Overview", path: "/command/overview", icon: LayoutDashboard },
          { id: "cmd-analytics", label: "Analytics", path: "/command/analytics", icon: BarChart3 },
          { id: "cmd-session-replay", label: "Session Replay", path: "/command/session-replay", icon: Film },
          { id: "cmd-insights", label: "Insights", path: "/command/insights", icon: Lightbulb },
        ],
      },
      {
        id: "communications", label: "Communications", defaultOpen: true,
        items: [
          { id: "cmd-messages", label: "Messages", path: "/command/messages", icon: MessageSquare },
        ],
      },
      {
        id: "ai-tools", label: "AI Tools", defaultOpen: true,
        items: [
          { id: "cmd-prompts", label: "AI Prompts", path: "/command/prompts", icon: Sparkles },
          { id: "cmd-presentations", label: "Presentations", path: "/command/presentations", icon: Presentation },
        ],
      },
      {
        id: "scripts", label: "Scripts", defaultOpen: true,
        items: [
          { id: "cmd-scripts", label: "M365 Scripts", path: "/command/scripts", icon: Terminal },
          { id: "cmd-running-scripts", label: "Running Scripts", path: "/command/running-scripts", icon: PlayCircle },
        ],
      },
      {
        id: "marketing", label: "Marketing", defaultOpen: true,
        items: MARKETING_ITEMS,
      },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    description: "Leads, clients & opportunities",
    icon: Users,
    prefix: "/pipeline",
    extraPrefixes: ["/crm/leads/", "/crm/clients/", "/crm/opportunities/"],
    defaultPath: "/pipeline/leads",
    sections: [
      {
        id: "leads", label: "Leads", defaultOpen: true,
        items: [
          { id: "pipe-leads", label: "Leads", path: "/pipeline/leads", icon: UserPlus },
          { id: "pipe-quiz-leads", label: "Quiz Leads", path: "/pipeline/quiz-leads", icon: HelpCircle },
        ],
      },
      {
        id: "deals", label: "Deals", defaultOpen: true,
        items: [
          { id: "pipe-opportunities", label: "Opportunities", path: "/pipeline/opportunities", icon: Target },
        ],
      },
      {
        id: "accounts", label: "Accounts", defaultOpen: true,
        items: [
          { id: "pipe-clients", label: "Clients", path: "/pipeline/clients", icon: Building2 },
        ],
      },
      {
        id: "intelligence", label: "Intelligence", defaultOpen: true,
        items: [
          { id: "pipe-m365", label: "M365 Intelligence", path: "/pipeline/m365-intelligence", icon: BrainCircuit },
          { id: "pipe-diagnostic-shares", label: "Diagnostic Shares", path: "/pipeline/diagnostic-shares", icon: Share2 },
        ],
      },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    description: "Projects, workflows & activity",
    icon: ClipboardCheck,
    prefix: "/delivery",
    extraPrefixes: ["/crm/projects/", "/crm/documents", "/crm/status-reports", "/crm/testimonials"],
    defaultPath: "/delivery/projects",
    sections: [
      {
        id: "projects", label: "Projects", defaultOpen: true,
        items: [
          { id: "del-projects", label: "Projects", path: "/delivery/projects", icon: FolderKanban },
          { id: "del-engagement", label: "Engagement Projects", path: "/delivery/engagement-projects", icon: Layers },
          { id: "del-clients", label: "Clients", path: "/delivery/clients", icon: Building2 },
        ],
      },
      {
        id: "operations", label: "Operations", defaultOpen: true,
        items: [
          { id: "del-workflows", label: "Workflows", path: "/delivery/workflows", icon: Workflow },
          { id: "del-activity", label: "Activity Logs", path: "/delivery/activity-logs", icon: Activity },
          { id: "del-hub-storage", label: "Hub Storage", path: "/delivery/hub-storage", icon: Database },
          { id: "del-tenant-signals", label: "Tenant Signals", path: "/delivery/tenant-signals", icon: Radio },
          { id: "del-signal-rules", label: "Signal Rules", path: "/delivery/signal-rules", icon: ListFilter },
        ],
      },
      {
        id: "fulfillment", label: "Fulfillment", defaultOpen: true,
        items: [
          { id: "del-fulfillment-queue", label: "Fulfillment Queue", path: "/delivery/fulfillment-queue", icon: ListChecks },
          { id: "del-fulfillment-types", label: "Fulfillment Types", path: "/delivery/fulfillment-types", icon: Zap },
        ],
      },
      {
        id: "monitoring", label: "Monitoring", defaultOpen: true,
        items: [
          { id: "del-monitor-checks", label: "Monitor Checks", path: "/delivery/monitor-checks", icon: Gauge },
          { id: "del-monitoring-packages", label: "Monitoring Packages", path: "/delivery/monitoring-packages", icon: Package },
        ],
      },
      {
        id: "baseline", label: "Baseline Templates", defaultOpen: true,
        items: [
          { id: "del-bt-templates", label: "Templates", path: "/delivery/baseline-templates", icon: FileStack },
          { id: "del-bt-config-packs", label: "Config Packs", path: "/delivery/baseline-templates?tab=config-packs", icon: Boxes },
          { id: "del-bt-audit", label: "Audit Log", path: "/delivery/baseline-templates?tab=audit-log", icon: History },
        ],
      },
      {
        id: "engines", label: "Engines", defaultOpen: false,
        items: ENGINE_KEYS.map(key => ({
          id: `del-engine-${key}`,
          label: ENGINE_LABELS[key],
          path: `/delivery/engines/${key}`,
          icon: Zap,
        })),
      },
      {
        id: "client-records", label: "Client Records", defaultOpen: false,
        items: [
          { id: "del-documents", label: "Documents", path: "/crm/documents", icon: FolderOpen },
          { id: "del-status-reports", label: "Status Reports", path: "/crm/status-reports", icon: FileCheck2 },
          { id: "del-testimonials", label: "Testimonials", path: "/crm/testimonials", icon: Star },
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    description: "Invoices, purchases & contracts",
    icon: Receipt,
    prefix: "/finance",
    extraPrefixes: ["/crm/invoices/", "/crm/purchases/"],
    defaultPath: "/finance/invoices",
    sections: [
      {
        id: "billing", label: "Billing", defaultOpen: true,
        items: [
          { id: "fin-invoices", label: "Invoices", path: "/finance/invoices", icon: Receipt },
          { id: "fin-purchases", label: "Purchases", path: "/finance/purchases", icon: CreditCard },
        ],
      },
      {
        id: "agreements", label: "Agreements", defaultOpen: true,
        items: [
          { id: "fin-contracts", label: "Contracts", path: "/finance/contracts", icon: FileSignature },
        ],
      },
      {
        id: "promotions", label: "Promotions", defaultOpen: true,
        items: [
          { id: "fin-coupons", label: "Coupons", path: "/finance/coupons", icon: TicketPercent },
        ],
      },
      {
        id: "reporting", label: "Reporting", defaultOpen: true,
        items: [
          { id: "fin-reports", label: "Reports", path: "/finance/reports", icon: PieChart },
        ],
      },
    ],
  },
  {
    id: "content",
    label: "Content & Offers",
    description: "Articles, services & templates",
    icon: FileText,
    prefix: "/content",
    extraPrefixes: ["/asset-library"],
    defaultPath: "/content/articles",
    sections: [
      {
        id: "publishing", label: "Publishing", defaultOpen: true,
        items: [
          { id: "con-articles", label: "Articles", path: "/content/articles", icon: BookOpen },
        ],
      },
      {
        id: "offers", label: "Offers", defaultOpen: true,
        items: [
          { id: "con-services", label: "Services", path: "/content/services", icon: Briefcase },
          { id: "con-service-triggers", label: "Service Triggers", path: "/content/service-triggers", icon: Zap },
        ],
      },
      {
        id: "templates", label: "Templates", defaultOpen: true,
        items: [
          { id: "con-email-templates", label: "Email Templates", path: "/content/email-templates", icon: MailPlus },
          { id: "con-contract-templates", label: "Contract Templates", path: "/content/contract-templates", icon: FileSignature },
          { id: "con-template-library", label: "Template Library", path: "/content/template-library", icon: Library },
          { id: "con-dashboard-designer", label: "Dashboard Designer", path: "/content/dashboard-designer", icon: LayoutDashboard },
        ],
      },
      {
        id: "asset-library", label: "Asset Library", defaultOpen: true,
        items: [
          { id: "con-instruction-sets", label: "Instruction Sets", path: "/content/asset-library", icon: FileBadge },
          { id: "con-checklists", label: "Checklists", path: "/asset-library/checklists", icon: ListChecks },
          { id: "con-artifact-sets", label: "Artifact Sets", path: "/asset-library/artifact-sets", icon: Boxes },
          { id: "con-deliverable-sets", label: "Deliverable Sets", path: "/asset-library/deliverable-sets", icon: Package },
          { id: "con-categories", label: "Categories", path: "/asset-library/categories", icon: Tags },
        ],
      },
    ],
  },
  {
    id: "system",
    label: "System",
    description: "Inbox, security & settings",
    icon: Settings,
    prefix: "/system",
    extraPrefixes: ["/msp", "/labs"],
    defaultPath: "/system/inbox",
    badgeKey: "unreadEmail",
    sections: [
      {
        id: "communications", label: "Communications", defaultOpen: true,
        items: [
          { id: "sys-inbox", label: "Inbox", path: "/system/inbox", icon: InboxIcon, badgeKey: "unreadEmail" },
        ],
      },
      {
        id: "observability", label: "Observability", defaultOpen: true,
        items: [
          { id: "sys-observability", label: "Observability", path: "/system/observability", icon: MonitorDot },
          { id: "sys-alert-rules", label: "Alert Rules", path: "/system/alert-rules", icon: AlertTriangle },
          { id: "sys-exceptions", label: "Exceptions", path: "/system/exceptions", icon: Bug },
          { id: "sys-pcc", label: "Command Center (PCC)", path: "/system/pcc", icon: Server },
        ],
      },
      {
        id: "platform", label: "Platform", defaultOpen: true,
        items: [
          { id: "sys-platform-revenue", label: "Platform Revenue", path: "/system/platform-revenue", icon: DollarSign },
          { id: "sys-platform-agreements", label: "Platform Agreements", path: "/system/platform-agreements", icon: Handshake },
          { id: "sys-simulator", label: "Simulator Studio", path: "/system/simulator", icon: FlaskConical },
        ],
      },
      {
        id: "security-config", label: "Security & Config", defaultOpen: true,
        items: [
          { id: "sys-security", label: "Security", path: "/system/security", icon: ShieldCheck },
          { id: "sys-signal-mappings", label: "Signal Mappings", path: "/system/signal-mappings", icon: SlidersHorizontal },
          { id: "sys-sow-debug", label: "SOW Debug", path: "/system/sow-debug", icon: FileSearch },
        ],
      },
      {
        id: "msp-platform", label: "MSP Platform", defaultOpen: false,
        items: [
          { id: "msp-admin", label: "MSP Admin", path: "/msp", icon: Server },
          { id: "msp-plans", label: "Plan Management", path: "/msp/plans", icon: ClipboardList },
          { id: "msp-overrides", label: "Overrides", path: "/msp/overrides", icon: SlidersHorizontal },
          { id: "msp-reports", label: "Reports", path: "/msp/reports", icon: PieChart },
        ],
      },
      {
        id: "labs", label: "Labs", defaultOpen: false,
        items: [
          { id: "sys-factory-floor", label: "Factory Floor", path: "/labs/factory-floor", icon: Rocket },
        ],
      },
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    description: "Design, automate & monitor",
    icon: Workflow,
    prefix: "/workflows",
    defaultPath: "/workflows/list",
    sections: [
      {
        id: "design", label: "Design", defaultOpen: true,
        items: [
          { id: "wf-list", label: "Workflows", path: "/workflows/list", icon: Workflow },
          { id: "wf-triggers", label: "Triggers", path: "/workflows/triggers", icon: Zap },
          { id: "wf-json-viewer", label: "JSON Viewer", path: "/workflows/json-viewer", icon: FileJson },
        ],
      },
      {
        id: "monitor", label: "Monitor", defaultOpen: true,
        items: [
          { id: "wf-runs", label: "Run History", path: "/workflows/runs", icon: History },
          { id: "wf-graph-api", label: "Graph API Cache", path: "/workflows/graph-api-results", icon: CloudDownload },
        ],
      },
    ],
  },
];

// ─── Detail-page tab metadata (routes that are not tree leaves) ───────────────

const DETAIL_PREFIXES: Array<{ prefix: string; workspaceId: string; label: string; icon: LucideIcon }> = [
  { prefix: "/crm/leads/", workspaceId: "pipeline", label: "Lead", icon: UserPlus },
  { prefix: "/crm/clients/", workspaceId: "pipeline", label: "Client", icon: Building2 },
  { prefix: "/crm/opportunities/", workspaceId: "pipeline", label: "Opportunity", icon: Target },
  { prefix: "/crm/projects/", workspaceId: "delivery", label: "Project", icon: FolderKanban },
  { prefix: "/crm/invoices/", workspaceId: "finance", label: "Invoice", icon: Receipt },
  { prefix: "/crm/purchases/", workspaceId: "finance", label: "Purchase", icon: CreditCard },
  { prefix: "/prompt-center/", workspaceId: "command", label: "Prompt", icon: Sparkles },
  { prefix: "/workflows/builder/", workspaceId: "workflows", label: "Builder", icon: Workflow },
  { prefix: "/workflows/triggers/", workspaceId: "workflows", label: "Trigger", icon: Zap },
  { prefix: "/workflows/runs/", workspaceId: "workflows", label: "Run", icon: History },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

function flattenItems(items: TreeItem[]): TreeItem[] {
  return items.flatMap(item => (item.children ? [item, ...flattenItems(item.children)] : [item]));
}

/** All navigable leaves of a workspace (children flattened, group nodes without paths excluded). */
export function workspaceLeaves(ws: WorkspaceDef): TreeItem[] {
  return ws.sections.flatMap(s => flattenItems(s.items)).filter(i => !!i.path);
}

export function findWorkspace(pathname: string): WorkspaceDef | null {
  for (const ws of WORKSPACES) {
    if (pathname === ws.prefix || pathname.startsWith(ws.prefix + "/")) return ws;
  }
  for (const ws of WORKSPACES) {
    for (const p of ws.extraPrefixes ?? []) {
      if (pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/")) return ws;
    }
  }
  return null;
}

export interface TabMeta {
  label: string;
  icon: LucideIcon;
  workspaceId: string | null;
}

/** Resolve tab label + icon for a pathname (query ignored — one tab per page). */
export function resolveTabMeta(pathname: string): TabMeta {
  // Pages whose ?tab= sections share one tab get their canonical page label,
  // not the label of whichever section leaf happens to match first.
  if (pathname === "/command/marketing") return { label: "Marketing", icon: Megaphone, workspaceId: "command" };
  if (pathname === "/delivery/baseline-templates") return { label: "Baseline Templates", icon: FileStack, workspaceId: "delivery" };
  const ws = findWorkspace(pathname);
  // Exact leaf whose path (sans query) matches
  if (ws) {
    for (const leaf of workspaceLeaves(ws)) {
      const leafPath = (leaf.path ?? "").split("?")[0];
      if (leafPath === pathname) return { label: leaf.label, icon: leaf.icon ?? FileText, workspaceId: ws.id };
    }
  }
  // Detail pages
  for (const d of DETAIL_PREFIXES) {
    if (pathname.startsWith(d.prefix)) {
      const id = pathname.slice(d.prefix.length).split("/")[0];
      const label = id && /^\d+$/.test(id) ? `${d.label} #${id}` : `${d.label} Detail`;
      return { label, icon: d.icon, workspaceId: d.workspaceId };
    }
  }
  // Fallback: humanize last segment
  const seg = pathname.split("/").filter(Boolean).pop() ?? "Page";
  const label = seg.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { label, icon: FileText, workspaceId: ws?.id ?? null };
}

/** Is this tree item the active one for the current location? */
export function isItemActive(item: TreeItem, pathname: string, search: string): boolean {
  if (!item.path) return false;
  const [itemPath, itemQuery] = item.path.split("?");
  if (itemQuery) {
    if (pathname !== itemPath) return false;
    const want = new URLSearchParams(itemQuery).get("tab");
    const have = new URLSearchParams(search).get("tab");
    return want === have;
  }
  if (pathname !== itemPath && !pathname.startsWith(itemPath + "/")) return false;
  // A query-less leaf on a page that also has ?tab= siblings (e.g. Marketing
  // Dashboard) is only active when no sibling tab param is present.
  const have = new URLSearchParams(search).get("tab");
  if (have && (itemPath === "/command/marketing" || itemPath === "/delivery/baseline-templates")) {
    return false;
  }
  return true;
}

export interface CmdKEntry {
  id: string;
  label: string;
  section: string;
  path: string;
  icon?: LucideIcon;
}

/** Flattened Cmd+K jump list across every workspace. */
export function buildCmdKEntries(): CmdKEntry[] {
  const entries: CmdKEntry[] = [];
  for (const ws of WORKSPACES) {
    for (const leaf of workspaceLeaves(ws)) {
      entries.push({
        id: `${ws.id}:${leaf.id}`,
        label: leaf.label,
        section: ws.label,
        path: leaf.path!,
        icon: leaf.icon,
      });
    }
  }
  return entries;
}
