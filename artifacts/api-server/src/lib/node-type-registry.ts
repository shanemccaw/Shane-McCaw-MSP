/**
 * node-type-registry.ts
 *
 * Central reference for portal workflow node type metadata.
 *
 * isAIDependent: true  — this node type invokes an LLM or AI service.
 *                        AI-blocked MSPs will have this node return
 *                        { aiBlocked: true, outcome: "ai_blocked" } instead
 *                        of executing.
 *
 * aiCostOwner: "msp"      — usage is billed against the MSP's credit allowance.
 *                           Document/report/SOW generation, chat messages.
 *             "platform"  — always runs; platform bears the cost. Never
 *                           decrements an MSP's balance. Upsell / recommendation
 *                           generation.
 *
 * Non-AI node types (isAIDependent: false):
 *   - check_script_output — pure data collection, deterministic
 *   - start, http_call, db_write, emit_event, wait, condition — no AI
 *   - All monitoring/data-collection paths are non-AI
 *
 * The monitoring engine's data-collection path MUST always run regardless of
 * an MSP's AI balance. Only nodes with isAIDependent: true are gated.
 */

export interface NodeTypeMeta {
  nodeType: string;
  isAIDependent: boolean;
  aiCostOwner?: "msp" | "platform";
  description?: string;
}

const NODE_TYPE_REGISTRY: NodeTypeMeta[] = [
  // ── Foundation / structural nodes ──────────────────────────────────────────
  {
    nodeType: "start",
    isAIDependent: false,
    description: "Workflow entry point — passes trigger payload downstream",
  },
  {
    nodeType: "http_call",
    isAIDependent: false,
    description: "Generic outbound HTTP request",
  },
  {
    nodeType: "db_write",
    isAIDependent: false,
    description: "Parameterized SQL write",
  },
  {
    nodeType: "emit_event",
    isAIDependent: false,
    description: "Dispatches a canonical event to the event bus",
  },
  {
    nodeType: "wait",
    isAIDependent: false,
    description: "No-op delay",
  },
  {
    nodeType: "condition",
    isAIDependent: false,
    description: "Safe JS condition evaluator for branching",
  },

  // ── Monitoring / data collection ── NEVER AI-gated ────────────────────────
  {
    nodeType: "check_script_output",
    isAIDependent: false,
    description: "Evaluates script run output — deterministic, never AI",
  },
  {
    nodeType: "collect_diagnostics",
    isAIDependent: false,
    description: "Reads M365 diagnostics data — deterministic",
  },
  {
    nodeType: "poll_tenant_health",
    isAIDependent: false,
    description: "Polls tenant health scores — deterministic",
  },
  {
    nodeType: "update_customer_status",
    isAIDependent: false,
    description: "Updates customer record fields — no AI",
  },
  {
    nodeType: "provision_sharepoint_site",
    isAIDependent: false,
    description: "Provisions SharePoint site via Graph API — no AI",
  },
  {
    nodeType: "send_notification",
    isAIDependent: false,
    description: "Sends an in-app or email notification — no AI",
  },
  {
    nodeType: "send_email",
    isAIDependent: false,
    description: "Sends a transactional email — no AI",
  },
  {
    nodeType: "create_fulfillment_entry",
    isAIDependent: false,
    description: "Creates a fulfillment queue entry — no AI",
  },
  {
    nodeType: "create_operator_task",
    isAIDependent: false,
    description: "Creates an operator task — no AI",
  },
  {
    nodeType: "execute_script",
    isAIDependent: false,
    description: "Executes a PowerShell script via Azure Automation — no AI",
  },
  {
    nodeType: "msp_dunning_advance",
    isAIDependent: false,
    description: "Advances MSP dunning states for past-due subscriptions — no AI",
  },
  {
    nodeType: "msp_overage_meter",
    isAIDependent: false,
    description: "Meters MSP tenant overage for billing — no AI",
  },

  // ── AI-dependent — billed to MSP ──────────────────────────────────────────
  {
    nodeType: "generate_document",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated consulting document / report / SOW",
  },
  {
    nodeType: "generate_report",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated MSP report from a report definition — PDF pipeline + optional email delivery",
  },
  {
    nodeType: "generate_sow",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated Statement of Work",
  },
  {
    nodeType: "generate_executive_summary",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated executive summary report",
  },
  {
    nodeType: "generate_remediation_plan",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated remediation plan",
  },
  {
    nodeType: "analyze_script_output",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI scoring of script run output (health engine)",
  },
  {
    nodeType: "chat_message",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI Support Assistant chat response — billed to MSP",
  },

  // ── AI-dependent — billed to platform ─────────────────────────────────────
  {
    nodeType: "generate_upsell_recommendation",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI upsell / recommendation — always runs, platform cost",
  },
  {
    nodeType: "score_lead",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI lead scoring — platform cost",
  },
  {
    nodeType: "generate_insight",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI insight generation for dashboard tiles — platform cost",
  },
];

const registryMap = new Map<string, NodeTypeMeta>(
  NODE_TYPE_REGISTRY.map((m) => [m.nodeType, m]),
);

/**
 * Retrieve metadata for a node type.
 * Unknown node types default to non-AI-dependent (safe fallback).
 */
export function getNodeTypeMeta(nodeType: string): NodeTypeMeta {
  return (
    registryMap.get(nodeType) ?? {
      nodeType,
      isAIDependent: false,
      description: "Unknown node type — treated as non-AI (safe default)",
    }
  );
}

/**
 * Returns true if this node type requires an AI inference call.
 * Non-AI nodes always run regardless of MSP balance.
 */
export function isAIDependent(nodeType: string): boolean {
  return getNodeTypeMeta(nodeType).isAIDependent;
}

/**
 * Returns the cost owner for an AI-dependent node type.
 * "msp"      → usage debits the MSP's credit allowance.
 * "platform" → usage is always billed to the platform; never blocks.
 */
export function getAiCostOwner(nodeType: string): "msp" | "platform" {
  const meta = getNodeTypeMeta(nodeType);
  if (!meta.isAIDependent) {
    throw new Error(`getAiCostOwner: node type '${nodeType}' is not AI-dependent`);
  }
  return meta.aiCostOwner ?? "msp";
}

export { NODE_TYPE_REGISTRY };
