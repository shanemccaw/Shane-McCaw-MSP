// Pattern registry — a static catalogue of reusable workflow sub-trees that
// users can insert onto the canvas from the Patterns library tab or the global
// node-search palette. Each entry carries a name, description, tags, and a
// minimal node+edge graph that insertPattern() grafts onto the canvas.
//
// This file is the canonical import path so both the Patterns tab and the
// search palette call the same insertion code from the same data source.
// When #2541 ships its dynamic registry API, replace the export below with
// a fetch-backed async loader and keep the same PatternEntry shape.

export type PatternEntry = {
  name: string;
  description: string;
  tags: readonly string[];
  nodes: ReadonlyArray<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: ReadonlyArray<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
  }>;
};

export const WORKFLOW_PATTERNS: readonly PatternEntry[] = [
  {
    name: "Error Handler Guard",
    description: "Wraps an action with an on-error branch that logs the failure and sends an admin notification.",
    tags: ["error", "guard", "resilience", "handler"],
    nodes: [
      { id: "p-action", type: "action", position: { x: 0, y: 0 }, data: { nodeType: "action", label: "Main Action" } },
      { id: "p-error", type: "error", position: { x: 180, y: 0 }, data: { nodeType: "error", label: "On Error" } },
    ],
    edges: [{ id: "p-e1", source: "p-action", target: "p-error", sourceHandle: "error" }],
  },
  {
    name: "Approval Gate",
    description: "Pauses execution and waits for human approval before continuing downstream steps.",
    tags: ["approval", "human-in-the-loop", "review", "gate"],
    nodes: [
      { id: "p-req", type: "action", position: { x: 0, y: 0 }, data: { nodeType: "action", label: "Request Approval" } },
      { id: "p-cond", type: "condition", position: { x: 0, y: 120 }, data: { nodeType: "condition", label: "Approved?" } },
    ],
    edges: [{ id: "p-e1", source: "p-req", target: "p-cond" }],
  },
  {
    name: "Scheduled Digest",
    description: "Runs on a schedule, iterates over an array, and sends a summary email for each item.",
    tags: ["schedule", "email", "digest", "foreach", "loop"],
    nodes: [
      { id: "p-loop", type: "foreach", position: { x: 0, y: 0 }, data: { nodeType: "foreach", label: "For Each Item" } },
      { id: "p-send", type: "action", position: { x: 0, y: 120 }, data: { nodeType: "send_email", label: "Send Digest Email" } },
    ],
    edges: [{ id: "p-e1", source: "p-loop", target: "p-send", sourceHandle: "body" }],
  },
  {
    name: "Lead Intake → Proposal",
    description: "Triggered on lead creation: sends a welcome email, delays 2 days, then creates a CRM presentation.",
    tags: ["lead", "crm", "proposal", "onboarding", "email"],
    nodes: [
      { id: "p-email", type: "action", position: { x: 0, y: 0 }, data: { nodeType: "send_email", label: "Welcome Email" } },
      { id: "p-delay", type: "delay", position: { x: 0, y: 120 }, data: { nodeType: "delay", label: "Wait 2 Days" } },
      { id: "p-pres", type: "action", position: { x: 0, y: 240 }, data: { nodeType: "create_presentation", label: "Create Presentation" } },
    ],
    edges: [
      { id: "p-e1", source: "p-email", target: "p-delay" },
      { id: "p-e2", source: "p-delay", target: "p-pres" },
    ],
  },
  {
    name: "Retry with Backoff",
    description: "Tries an action up to 3 times with a delay between attempts before hitting a final error handler.",
    tags: ["retry", "backoff", "resilience", "error"],
    nodes: [
      { id: "p-try", type: "action", position: { x: 0, y: 0 }, data: { nodeType: "action", label: "Attempt Action", retryLimit: 3, retryDelayMs: 5000 } },
      { id: "p-err", type: "error", position: { x: 180, y: 0 }, data: { nodeType: "error", label: "Final Failure" } },
    ],
    edges: [{ id: "p-e1", source: "p-try", target: "p-err", sourceHandle: "error" }],
  },
] as const;
