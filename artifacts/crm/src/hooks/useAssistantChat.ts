import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface PortalSnapshot {
  projects: { title: string; status: string; progress: number }[];
  invoices: { status: string; amount: number; dueDate: string | null }[];
  m365Completion: number;
  unreadMessages: number;
}

function nextId() {
  return Math.random().toString(36).slice(2);
}

function buildResponse(input: string, snap: PortalSnapshot): string {
  const q = input.toLowerCase().trim();

  if (q.match(/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/)) {
    return "Hi there! I'm your portal assistant. I can answer questions about your projects, billing, M365 profile, and more. What can I help you with?";
  }

  if (q.match(/\bproject(s)?\b/) && q.match(/\bhow many|count|total\b/)) {
    const active = snap.projects.filter(p => p.status !== "completed").length;
    const completed = snap.projects.filter(p => p.status === "completed").length;
    return `You have **${active} active project${active !== 1 ? "s" : ""}** and **${completed} completed** project${completed !== 1 ? "s" : ""}. ${active > 0 ? `Overall average progress is ${Math.round(snap.projects.filter(p => p.status !== "completed").reduce((s, p) => s + p.progress, 0) / Math.max(active, 1))}%.` : ""}`;
  }

  if (q.match(/\bproject(s)?\b/) && q.match(/\bstatus|progress|update\b/)) {
    if (snap.projects.length === 0) return "You don't have any active projects yet. Check the Projects page or contact Shane to get started.";
    const lines = snap.projects
      .filter(p => p.status !== "completed")
      .slice(0, 4)
      .map(p => `• **${p.title}** — ${p.progress}% complete (${p.status.replace(/_/g, " ")})`);
    return `Here's a quick status of your active projects:\n\n${lines.join("\n")}`;
  }

  if (q.match(/\b(invoice|billing|payment|owe|outstanding|unpaid)\b/)) {
    const unpaid = snap.invoices.filter(i => i.status === "unpaid" || i.status === "pending");
    const paid = snap.invoices.filter(i => i.status === "paid");
    if (unpaid.length === 0 && paid.length === 0) return "No invoice records found. Head to the Billing page for a full history.";
    if (unpaid.length === 0) return `All ${paid.length} invoice${paid.length !== 1 ? "s" : ""} are paid — you're all caught up! 🎉`;
    const total = unpaid.reduce((s, i) => s + i.amount, 0);
    return `You have **${unpaid.length} unpaid invoice${unpaid.length !== 1 ? "s" : ""}** totalling **$${(total / 100).toLocaleString()}**. Head to the Billing page to pay.`;
  }

  if (q.match(/\b(m365|microsoft 365|profile|tenant|license)\b/)) {
    if (snap.m365Completion === 0) return "Your M365 profile hasn't been started yet. Completing it helps Shane tailor recommendations for your environment.";
    if (snap.m365Completion < 50) return `Your M365 profile is **${snap.m365Completion}% complete**. Filling it in more helps Shane deliver better-targeted recommendations.`;
    if (snap.m365Completion < 100) return `Your M365 profile is **${snap.m365Completion}% complete** — almost there! Head to the M365 Profile page to finish the remaining sections.`;
    return "Your M365 profile is fully complete. Shane has everything he needs to deliver tailored recommendations.";
  }

  if (q.match(/\b(message(s)?|unread|inbox)\b/)) {
    if (snap.unreadMessages === 0) return "No unread messages right now. Head to the Messages page to view your full conversation history with Shane.";
    return `You have **${snap.unreadMessages} unread message${snap.unreadMessages !== 1 ? "s" : ""}** from Shane. Head to the Messages page to read and reply.`;
  }

  if (q.match(/\b(security|secure|safe|mfa|defender|compliance)\b/)) {
    return "Your security posture is tracked under the **Security** and **M365 Profile → Security & Compliance** pages. Shane reviews this regularly and will flag any gaps during your engagement.";
  }

  if (q.match(/\b(copilot|ai|artificial intelligence)\b/)) {
    return "Copilot readiness is assessed as part of your M365 Profile. Head to **M365 Profile → Copilot Readiness** to review or update your Copilot environment details. Shane will provide recommendations based on your current posture.";
  }

  if (q.match(/\b(sharepoint|teams|onedrive|exchange)\b/)) {
    return "Your Microsoft 365 service usage is captured in your **M365 Profile → Licensing & Apps** section. Shane uses this to tailor SharePoint, Teams, and OneDrive recommendations for your engagement.";
  }

  if (q.match(/\b(report|status report|weekly)\b/)) {
    return "Status reports are delivered per project and need your review and acceptance. You can find them on the Dashboard — any pending report will appear as a banner. Head to a Project detail page to see the full reports history.";
  }

  if (q.match(/\b(book|meeting|schedule|appointment|call)\b/)) {
    return "You can book a meeting with Shane directly from the **Book a Meeting** page. It's linked in your portal sidebar. Shane typically responds within one business day.";
  }

  if (q.match(/\b(contract|agreement|sign|signature)\b/)) {
    return "Contracts are managed per project. You can view and sign contracts from any **Project Detail** page under the Contracts tab, or from the Billing section.";
  }

  if (q.match(/\b(automat|azure|power(shell|automate)|script)\b/)) {
    return "Automation is set up through the **Automation Setup** page. You'll need to connect your Azure tenant so Shane can run PowerShell scripts and provisioning scripts on your behalf.";
  }

  if (q.match(/\b(retainer|subscription|monthly|renewal)\b/)) {
    return "Your retainer details are available in the **Billing** section under Subscriptions. Retainers are billed monthly and give you ongoing access to Shane's advisory and support hours.";
  }

  if (q.match(/\b(journey|lifecycle|stage|onboard)\b/)) {
    return "Your client journey map is available at **Journey Map** in the sidebar. It shows all eight lifecycle stages — from onboarding through to renewal — and your current progress through each one.";
  }

  if (q.match(/\b(insight|analytics|trend|benchmark)\b/)) {
    return "The **Insights** page in the sidebar shows cross-project analytics, bottleneck detection, your responsiveness score, SLA indicators, and benchmarking comparisons against Microsoft best practices.";
  }

  if (q.match(/\b(help|what can you|what do you|support)\b/)) {
    return "I can help with:\n• **Project status** — progress, health, and what's next\n• **Billing** — invoices, payments, and subscriptions\n• **M365 Profile** — completion and environment details\n• **Security** — posture and compliance overview\n• **Meetings** — how to book time with Shane\n• **Automation** — Azure tenant setup\n\nJust ask in plain English!";
  }

  if (q.match(/\b(thank|thanks|great|awesome|perfect|nice)\b/)) {
    return "Happy to help! Let me know if you have any other questions about your portal or engagement.";
  }

  return "I'm not sure I understood that. Try asking about your **projects**, **billing**, **M365 profile**, **security**, or **meetings** — or type **help** to see what I can do.";
}

export function useAssistantChat() {
  const { fetchWithAuth } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: "assistant",
      content: "👋 Hi! I'm your portal assistant. I can answer questions about your projects, billing, M365 environment, and more. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const snapRef = useRef<PortalSnapshot | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (snapRef.current) return snapRef.current;
    try {
      const [projectsRes, invoicesRes, m365Res, messagesRes] = await Promise.all([
        fetchWithAuth("/api/portal/projects").then(r => r.ok ? r.json() : []),
        fetchWithAuth("/api/portal/invoices").then(r => r.ok ? r.json() : []),
        fetchWithAuth("/api/portal/m365-profile").then(r => r.ok ? r.json() : {}),
        fetchWithAuth("/api/portal/messages").then(r => r.ok ? r.json() : []),
      ]) as [
        { title: string; status: string; progress: number }[],
        { status: string; amount: number; dueDate: string | null }[],
        Record<string, unknown>,
        { isRead: boolean }[],
      ];

      const BOOL_FIELDS = [
        "mfaEnforced","conditionalAccessEnabled","intuneEnabled","hasAADP1orP2",
        "hasDefender","hasDLP","usesComplianceCenter","sensitivityLabelsConfigured",
        "hasRetentionPolicies","isMicrosoftPartner","allUsersLicensed",
      ];
      const STR_FIELDS = [
        "orgName","industry","employeeCount","licensedUserCount","tenantDomain",
        "itContactName","itContactEmail","activeUserPercent","authMethod",
        "engagementStartDate","estimatedDuration","engagementType","budgetRange",
        "decisionMakerName","decisionMakerEmail","businessGoals",
      ];
      let filled = 0;
      const total = BOOL_FIELDS.length + STR_FIELDS.length;
      BOOL_FIELDS.forEach(k => { if (typeof m365Res[k] === "boolean") filled++; });
      STR_FIELDS.forEach(k => { if (typeof m365Res[k] === "string" && (m365Res[k] as string).length > 0) filled++; });

      const snap: PortalSnapshot = {
        projects: Array.isArray(projectsRes) ? projectsRes : [],
        invoices: Array.isArray(invoicesRes) ? invoicesRes : [],
        m365Completion: Math.round((filled / total) * 100),
        unreadMessages: Array.isArray(messagesRes) ? messagesRes.filter((m: { isRead: boolean }) => !m.isRead).length : 0,
      };
      snapRef.current = snap;
      return snap;
    } catch {
      return { projects: [], invoices: [], m365Completion: 0, unreadMessages: 0 };
    }
  }, [fetchWithAuth]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const snap = await loadSnapshot();
      await new Promise(r => setTimeout(r, 350 + Math.random() * 300));
      const response = buildResponse(text, snap);
      const assistantMsg: ChatMessage = { id: nextId(), role: "assistant", content: response, timestamp: new Date() };
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }, [loading, loadSnapshot]);

  const reset = useCallback(() => {
    snapRef.current = null;
    setMessages([{
      id: nextId(),
      role: "assistant",
      content: "👋 Hi! I'm your portal assistant. I can answer questions about your projects, billing, M365 environment, and more. What would you like to know?",
      timestamp: new Date(),
    }]);
  }, []);

  return { messages, loading, sendMessage, reset };
}
