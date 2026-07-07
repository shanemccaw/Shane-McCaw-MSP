/**
 * patternRegistry.ts
 *
 * Static registry of best-practice workflow patterns.
 * Each pattern is a self-contained sub-graph (nodes + edges) that can be
 * spliced into the canvas at the currently selected insertion point.
 *
 * To add a new pattern: append an entry to PATTERNS below.  No UI code needs
 * to change.  Node IDs inside a pattern must be unique within the pattern;
 * the insertion logic re-maps them to fresh node-N IDs before merging.
 */

export interface PatternNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface PatternEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface WorkflowPattern {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "HTTP" | "Approval" | "Parallel" | "AI" | "CRM" | "Scheduling";
  tags: string[];
  nodes: PatternNode[];
  edges: PatternEdge[];
}

export const PATTERNS: WorkflowPattern[] = [
  // ── 1. HTTP with Retry & Error Handler ──────────────────────────────────────
  {
    id: "http-retry-error",
    name: "HTTP with Retry & Error Handler",
    description: "Makes an HTTP call and routes failures to a dedicated error-handler action rather than crashing the workflow.",
    icon: "🌐",
    category: "HTTP",
    tags: ["http", "retry", "error", "resilience"],
    nodes: [
      {
        id: "p1-http",
        type: "http_request",
        position: { x: 0, y: 0 },
        data: { nodeType: "http_request", label: "HTTP Request", method: "GET", url: "{{url}}" },
      },
      {
        id: "p1-ok",
        type: "action",
        position: { x: 0, y: 100 },
        data: { nodeType: "action", label: "Process Response" },
      },
      {
        id: "p1-err",
        type: "action",
        position: { x: 240, y: 100 },
        data: { nodeType: "action", label: "Handle HTTP Error", annotation: "Log or notify on failure" },
      },
    ],
    edges: [
      { id: "p1-e1", source: "p1-http", target: "p1-ok" },
      { id: "p1-e2", source: "p1-http", target: "p1-err", sourceHandle: "onError" },
    ],
  },

  // ── 2. Approval Gate with Timeout Fallback ───────────────────────────────────
  {
    id: "approval-gate-timeout",
    name: "Approval Gate with Timeout Fallback",
    description: "Pauses execution waiting for manual approval.  If no response within the timeout, routes to an auto-escalation branch.",
    icon: "✋",
    category: "Approval",
    tags: ["approval", "human", "timeout", "escalation"],
    nodes: [
      {
        id: "p2-gate",
        type: "approval_gate",
        position: { x: 0, y: 0 },
        data: { nodeType: "approval_gate", label: "Approval Gate", timeoutHours: 24 },
      },
      {
        id: "p2-approved",
        type: "action",
        position: { x: 0, y: 100 },
        data: { nodeType: "action", label: "Continue (Approved)" },
      },
      {
        id: "p2-rejected",
        type: "action",
        position: { x: 240, y: 100 },
        data: { nodeType: "action", label: "Handle Rejection" },
      },
      {
        id: "p2-timeout",
        type: "action",
        position: { x: 480, y: 100 },
        data: { nodeType: "action", label: "Auto-Escalate (Timeout)", annotation: "Notify manager and re-request approval" },
      },
    ],
    edges: [
      { id: "p2-e1", source: "p2-gate", target: "p2-approved", sourceHandle: "approved" },
      { id: "p2-e2", source: "p2-gate", target: "p2-rejected", sourceHandle: "rejected" },
      { id: "p2-e3", source: "p2-gate", target: "p2-timeout", sourceHandle: "timeout" },
    ],
  },

  // ── 3. Fan-out + Join ────────────────────────────────────────────────────────
  {
    id: "fanout-join",
    name: "Fan-out + Join",
    description: "Runs three branches in parallel and waits for all to complete before continuing.",
    icon: "⑂",
    category: "Parallel",
    tags: ["parallel", "fan-out", "join", "concurrency"],
    nodes: [
      {
        id: "p3-par",
        type: "parallel",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "parallel",
          label: "Fan-out",
          branches: [
            { key: "branch1", label: "Branch A", wait: true, color: "#3B82F6" },
            { key: "branch2", label: "Branch B", wait: true, color: "#10B981" },
            { key: "branch3", label: "Branch C", wait: true, color: "#A855F7" },
          ],
        },
      },
      {
        id: "p3-a",
        type: "action",
        position: { x: -200, y: 140 },
        data: { nodeType: "action", label: "Branch A Work" },
      },
      {
        id: "p3-b",
        type: "action",
        position: { x: 0, y: 140 },
        data: { nodeType: "action", label: "Branch B Work" },
      },
      {
        id: "p3-c",
        type: "action",
        position: { x: 200, y: 140 },
        data: { nodeType: "action", label: "Branch C Work" },
      },
      {
        id: "p3-join",
        type: "join",
        position: { x: 0, y: 260 },
        data: { nodeType: "join", label: "Join" },
      },
      {
        id: "p3-cont",
        type: "action",
        position: { x: 0, y: 360 },
        data: { nodeType: "action", label: "Continue after Join" },
      },
    ],
    edges: [
      { id: "p3-e1", source: "p3-par", target: "p3-a", sourceHandle: "branch1" },
      { id: "p3-e2", source: "p3-par", target: "p3-b", sourceHandle: "branch2" },
      { id: "p3-e3", source: "p3-par", target: "p3-c", sourceHandle: "branch3" },
      { id: "p3-e4", source: "p3-a", target: "p3-join" },
      { id: "p3-e5", source: "p3-b", target: "p3-join" },
      { id: "p3-e6", source: "p3-c", target: "p3-join" },
      { id: "p3-e7", source: "p3-join", target: "p3-cont" },
    ],
  },

  // ── 4. AI Summarise + Publish ────────────────────────────────────────────────
  {
    id: "ai-summarise-publish",
    name: "AI Summarise + Publish",
    description: "Uses Ask AI to draft content, generates an article, and publishes it — wired with an error fallback.",
    icon: "✨",
    category: "AI",
    tags: ["ai", "article", "publish", "content"],
    nodes: [
      {
        id: "p4-ai",
        type: "ask_ai",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "ask_ai",
          label: "AI Draft",
          prompt: "Write a concise summary of: {{topic}}",
          model: "claude-haiku-4-5",
          outputVar: "draft",
        },
      },
      {
        id: "p4-article",
        type: "generate_article",
        position: { x: 0, y: 100 },
        data: { nodeType: "generate_article", label: "Generate Article", topic: "{{topic}}", content: "{{draft}}" },
      },
      {
        id: "p4-publish",
        type: "publish_article",
        position: { x: 0, y: 200 },
        data: { nodeType: "publish_article", label: "Publish Article" },
      },
      {
        id: "p4-err",
        type: "action",
        position: { x: 260, y: 150 },
        data: { nodeType: "action", label: "Handle Publish Error", annotation: "Alert Shane on failure" },
      },
    ],
    edges: [
      { id: "p4-e1", source: "p4-ai", target: "p4-article" },
      { id: "p4-e2", source: "p4-article", target: "p4-publish" },
      { id: "p4-e3", source: "p4-publish", target: "p4-err", sourceHandle: "onError" },
    ],
  },

  // ── 5. Lead Score → Branch → Notify ─────────────────────────────────────────
  {
    id: "lead-score-branch-notify",
    name: "Lead Score → Branch → Notify",
    description: "Scores an incoming lead then routes to a high-value fast-track or a nurture sequence, with email notification.",
    icon: "⭐",
    category: "CRM",
    tags: ["lead", "score", "condition", "email", "crm"],
    nodes: [
      {
        id: "p5-score",
        type: "score_lead",
        position: { x: 0, y: 0 },
        data: { nodeType: "score_lead", label: "Score Lead", leadId: "{{leadId}}", threshold: 70 },
      },
      {
        id: "p5-cond",
        type: "condition",
        position: { x: 0, y: 100 },
        data: {
          nodeType: "condition",
          label: "Qualified?",
          conditions: [
            { key: "yes", label: "Qualified", expression: "{{qualified}} == true" },
            { key: "no",  label: "Not yet", expression: "true" },
          ],
        },
      },
      {
        id: "p5-high",
        type: "send_email",
        position: { x: -160, y: 220 },
        data: {
          nodeType: "send_email",
          label: "Hot-Lead Email",
          to: "{{leadEmail}}",
          subject: "Exclusive offer for {{leadName}}",
          body: "Hi {{leadName}}, based on your score of {{score}} we have a priority offer…",
        },
      },
      {
        id: "p5-stage",
        type: "assign_pipeline_stage",
        position: { x: -160, y: 340 },
        data: { nodeType: "assign_pipeline_stage", label: "Move to Hot", targetType: "lead", stage: "Hot", leadId: "{{leadId}}" },
      },
      {
        id: "p5-nurture",
        type: "send_email",
        position: { x: 160, y: 220 },
        data: {
          nodeType: "send_email",
          label: "Nurture Email",
          to: "{{leadEmail}}",
          subject: "Resources for {{leadName}}",
          body: "Hi {{leadName}}, here are some resources to get you started…",
        },
      },
    ],
    edges: [
      { id: "p5-e1", source: "p5-score", target: "p5-cond" },
      { id: "p5-e2", source: "p5-cond", target: "p5-high", sourceHandle: "yes" },
      { id: "p5-e3", source: "p5-high", target: "p5-stage" },
      { id: "p5-e4", source: "p5-cond", target: "p5-nurture", sourceHandle: "no" },
    ],
  },

  // ── 6. Scheduled Batch Loop ──────────────────────────────────────────────────
  {
    id: "scheduled-batch-loop",
    name: "Scheduled Batch Loop",
    description: "Fetches a list of items and iterates over each one, processing in a For Each loop with a delay between batches.",
    icon: "🔄",
    category: "Scheduling",
    tags: ["schedule", "loop", "batch", "foreach"],
    nodes: [
      {
        id: "p6-fetch",
        type: "sql_query",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "sql_query",
          label: "Fetch Batch",
          query: "SELECT id FROM items WHERE processed = false LIMIT 100",
          outputVar: "items",
        },
      },
      {
        id: "p6-loop",
        type: "foreach",
        position: { x: 0, y: 100 },
        data: { nodeType: "foreach", label: "For Each Item", listExpr: "{{items}}", itemVar: "item" },
      },
      {
        id: "p6-process",
        type: "action",
        position: { x: 0, y: 200 },
        data: { nodeType: "action", label: "Process Item", annotation: "Replace with your processing logic" },
      },
      {
        id: "p6-delay",
        type: "delay",
        position: { x: 0, y: 300 },
        data: { nodeType: "delay", label: "Rate-limit Delay", durationMs: 500 },
      },
      {
        id: "p6-done",
        type: "action",
        position: { x: 0, y: 420 },
        data: { nodeType: "action", label: "Batch Complete", annotation: "Notify or log completion" },
      },
    ],
    edges: [
      { id: "p6-e1", source: "p6-fetch", target: "p6-loop" },
      { id: "p6-e2", source: "p6-loop", target: "p6-process", sourceHandle: "item" },
      { id: "p6-e3", source: "p6-process", target: "p6-delay" },
      { id: "p6-e4", source: "p6-loop", target: "p6-done", sourceHandle: "done" },
    ],
  },
];

/** Alias used by WorkflowBuilderPage — same array, exported under the legacy name. */
export const WORKFLOW_PATTERNS = PATTERNS;
