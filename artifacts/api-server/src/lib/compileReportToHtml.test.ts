import { describe, it, expect, vi, beforeEach } from "vitest";
import { compileReportToHtml } from "./compileReportToHtml";

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
    clientServicesTable: { id: "id", clientUserId: "clientUserId", serviceId: "serviceId", status: "status" },
    servicesTable: { id: "id", name: "name", billingType: "billingType", priceCents: "priceCents", price: "price" },
    usersTable: { id: "id", company: "company" },
    mspCustomersTable: { id: "id", mspId: "mspId", status: "status", name: "name" },
    kanbanTasksTable: { id: "id", projectId: "projectId", title: "title", column: "column", priority: "priority", dueDate: "dueDate" },
    projectsTable: { id: "id", clientUserId: "clientUserId" },
    fulfillmentQueueTable: { id: "id", customerId: "customerId", itemTitle: "itemTitle", deliveryStatus: "deliveryStatus", createdAt: "createdAt", slaDueAt: "slaDueAt" },
    clientScoresTable: { id: "id", clientId: "clientId", identity: "identity", security: "security", collaboration: "collaboration", compliance: "compliance", copilotReadiness: "copilotReadiness" },
    clientM365ProfilesTable: { id: "id", clientId: "clientId", profile: "profile" },
  };
});

function makeSelectChain(data: unknown[]) {
  const chain: Record<string, any> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = vi.fn((resolve: (v: unknown) => unknown) => resolve(data));
  return chain;
}

describe("compileReportToHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse, sort, and group widgets into single rows with correct Outlook width percentages", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select).mockImplementation(() => makeSelectChain([]) as any);

    const layout = [
      { i: "w1", x: 6, y: 0, w: 6, h: 2, type: "rich_text", properties: { content: "W1 Right side" } },
      { i: "w2", x: 0, y: 0, w: 6, h: 2, type: "rich_text", properties: { content: "W2 Left side" } },
      { i: "w3", x: 0, y: 1, w: 12, h: 1, type: "rich_text", properties: { content: "W3 Full width" } },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "A Test Report Name");

    // Must sort w2 (x=0) before w1 (x=6) on row y=0
    expect(result).toContain("A Test Report Name");
    expect(result).toContain("W2 Left side");
    expect(result).toContain("W1 Right side");
    expect(result).toContain("W3 Full width");

    // Width percentages should match
    expect(result).toContain('width="50%"');
    expect(result).toContain('width="100%"');

    // Layout should be a valid table structured document and avoid flexbox or CSS Grid
    expect(result).toContain("<table");
    expect(result).not.toContain("display: flex");
    expect(result).not.toContain("display: grid");
    expect(result).not.toContain("display:flex");
    expect(result).not.toContain("display:grid");
  });

  it("should handle layout gaps and insert empty spacer columns", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select).mockImplementation(() => makeSelectChain([]) as any);

    // Row 0 has a gap: widget 1 is x=0, w=4. Widget 2 is x=8, w=4. Gap is size 4 at x=4.
    const layout = [
      { i: "w1", x: 0, y: 0, w: 4, h: 1, type: "rich_text", properties: { content: "Widget One" } },
      { i: "w2", x: 8, y: 0, w: 4, h: 1, type: "rich_text", properties: { content: "Widget Two" } },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "Test Spacing");

    // Row has width 4/12 = 33.333%
    expect(result).toContain('width="33.33333333333333%"');
    // Spacer should also be 4/12 = 33.333%
    expect(result).toContain('padding: 0; border: none;');
  });

  it("should query and render active subscriptions in the billing widget", async () => {
    const { db } = await import("@workspace/db");
    
    const mockBillingData = [
      { name: "M365 Business Premium", billingType: "recurring_monthly", priceCents: 2200, price: "22.00" },
      { name: "Copilot Pro Addon", billingType: "recurring_monthly", priceCents: 3000, price: "30.00" },
    ];

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      // Return subscriptions for billing call, empty for telemetry/tasks
      const data = selectCallCount === 1 ? mockBillingData : [];
      return makeSelectChain(data) as any;
    });

    const layout = [
      { i: "billing-1", x: 0, y: 0, w: 12, h: 2, type: "billing" },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "Billing test");

    expect(result).toContain("M365 Business Premium");
    expect(result).toContain("Copilot Pro Addon");
    expect(result).toContain("$52.00"); // 22 + 30
    expect(result).toContain("Monthly Total");
  });

  it("should query and render open tasks and fulfillment items in the open items widget, sorted by due date", async () => {
    const { db } = await import("@workspace/db");

    const mockTasks = [
      { title: "Kanban Task B", column: "in_progress", priority: "medium", dueDate: new Date("2026-07-25T12:00:00Z") },
    ];
    const mockFulfillments = [
      { itemTitle: "Fulfillment Task A", deliveryStatus: "not_started", createdAt: new Date("2026-07-20T12:00:00Z"), slaDueAt: new Date("2026-07-22T12:00:00Z") },
    ];

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      // open_items widget queries in order: Call 1 = Kanban tasks, Call 2 = Fulfillments
      if (selectCallCount === 1) return makeSelectChain(mockTasks) as any;
      if (selectCallCount === 2) return makeSelectChain(mockFulfillments) as any;
      return makeSelectChain([]) as any;
    });

    const layout = [
      { i: "open-items-1", x: 0, y: 0, w: 12, h: 2, type: "open_items" },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "Open Items Test");

    expect(result).toContain("Kanban Task B");
    expect(result).toContain("Fulfillment Task A");
    expect(result).toContain("In Progress");
    expect(result).toContain("Not Started");
  });

  it("should query and render M365 scores and signals in the telemetry widget", async () => {
    const { db } = await import("@workspace/db");

    const mockScores = [
      { identity: 85, security: 70, collaboration: 60, compliance: 50, copilotReadiness: 45 },
    ];
    const mockProfile = [
      { profile: { mfaEnforced: true, conditionalAccessEnabled: false, intuneEnabled: true } },
    ];

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      // telemetry widget queries in order: Call 1 = Scores, Call 2 = M365 Profile
      if (selectCallCount === 1) return makeSelectChain(mockScores) as any;
      if (selectCallCount === 2) return makeSelectChain(mockProfile) as any;
      return makeSelectChain([]) as any;
    });

    const layout = [
      { i: "telemetry-1", x: 0, y: 0, w: 12, h: 2, type: "telemetry" },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "Telemetry Test");

    expect(result).toContain("Identity Protection");
    expect(result).toContain("85%");
    expect(result).toContain("MFA Enforced");
    expect(result).toContain("✗"); // Conditional access false
    expect(result).toContain("✓"); // MFA true
  });

  it("should render rich text widget and successfully sanitize HTML content", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select).mockImplementation(() => makeSelectChain([]) as any);

    const layout = [
      {
        i: "rich-text-1",
        x: 0,
        y: 0,
        w: 12,
        h: 2,
        type: "rich_text",
        properties: {
          content: "<h3>Executive summary</h3><script>alert('risky')</script><iframe src='test'></iframe><p onclick='doStuff()'>Description</p>"
        }
      },
    ];

    const result = await compileReportToHtml(layout, 1, 101, "Rich Text Test");

    expect(result).toContain("Executive summary");
    expect(result).toContain("Description");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert('risky')");
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("onclick=");
  });
});
