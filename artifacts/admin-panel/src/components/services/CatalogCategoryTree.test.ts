/**
 * CatalogCategoryTree.test.ts
 *
 * Tests for the buildTree utility and category reparent path-computation logic.
 * Run with: pnpm --filter @workspace/admin-panel run test (vitest)
 */

import { describe, it, expect } from "vitest";
import { buildTree } from "./CatalogCategoryTree";
import type { ServiceRow } from "@/hooks/useServices";

function makeService(overrides: Partial<ServiceRow> & { id: number; name: string }): ServiceRow {
  return {
    slug: null,
    description: null,
    category: null,
    deliverables: null,
    price: null,
    basePrice: null,
    maxPrice: null,
    durationDays: null,
    turnaround: null,
    billingType: "one_time",
    isPublic: true,
    visibility: "public",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serviceType: null,
    tagline: null,
    targetAudience: null,
    inclusions: null,
    features: null,
    badge: null,
    highlighted: false,
    hoursPerMonth: null,
    iconName: null,
    pageHref: null,
    sortOrder: 0,
    tier: null,
    orderWorkflow: null,
    workflowTemplateId: null,
    overviewPdfKey: null,
    overviewPdfGeneratedAt: null,
    requiredAppPermissions: null,
    categoryPath: null,
    tags: null,
    customerAgreementTemplate: null,
    isFreeOffering: false,
    fulfillmentTypeKey: null,
    triggeringSignalKeys: null,
    ...overrides,
  };
}

describe("buildTree", () => {
  it("returns empty array when no services have a categoryPath", () => {
    const services = [makeService({ id: 1, name: "A" }), makeService({ id: 2, name: "B" })];
    expect(buildTree(services)).toEqual([]);
  });

  it("builds a single root node from a flat categoryPath", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: "Consulting" }),
      makeService({ id: 2, name: "Svc2", categoryPath: "Consulting" }),
    ];
    const tree = buildTree(services);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Consulting");
    expect(tree[0]!.path).toBe("Consulting");
    expect(tree[0]!.serviceCount).toBe(2);
    expect(tree[0]!.totalCount).toBe(2);
    expect(tree[0]!.children).toHaveLength(0);
  });

  it("builds nested children for slash-delimited paths", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: "Consulting/M365" }),
      makeService({ id: 2, name: "Svc2", categoryPath: "Consulting/SharePoint" }),
      makeService({ id: 3, name: "Svc3", categoryPath: "Consulting" }),
    ];
    const tree = buildTree(services);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.name).toBe("Consulting");
    expect(root.serviceCount).toBe(1);
    expect(root.totalCount).toBe(3);
    expect(root.children).toHaveLength(2);
    const childNames = root.children.map(c => c.name).sort();
    expect(childNames).toEqual(["M365", "SharePoint"]);
  });

  it("handles deeply nested paths", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: "A/B/C" }),
    ];
    const tree = buildTree(services);
    expect(tree[0]!.name).toBe("A");
    expect(tree[0]!.children[0]!.name).toBe("B");
    expect(tree[0]!.children[0]!.children[0]!.name).toBe("C");
    expect(tree[0]!.children[0]!.children[0]!.serviceCount).toBe(1);
  });

  it("falls back to service.category when categoryPath is null", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: null, category: "Legacy" }),
    ];
    const tree = buildTree(services);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Legacy");
    expect(tree[0]!.serviceCount).toBe(1);
  });

  it("totalCount includes services in descendant nodes", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: "A" }),
      makeService({ id: 2, name: "Svc2", categoryPath: "A/Sub" }),
      makeService({ id: 3, name: "Svc3", categoryPath: "A/Sub" }),
    ];
    const tree = buildTree(services);
    const root = tree[0]!;
    expect(root.serviceCount).toBe(1);
    expect(root.totalCount).toBe(3);
    expect(root.children[0]!.serviceCount).toBe(2);
    expect(root.children[0]!.totalCount).toBe(2);
  });

  it("builds multiple sibling roots", () => {
    const services = [
      makeService({ id: 1, name: "Svc1", categoryPath: "Alpha" }),
      makeService({ id: 2, name: "Svc2", categoryPath: "Beta" }),
    ];
    const tree = buildTree(services);
    expect(tree).toHaveLength(2);
    const names = tree.map(n => n.name).sort();
    expect(names).toEqual(["Alpha", "Beta"]);
  });
});

describe("buildTree — virtual paths", () => {
  it("shows an empty virtual category node with serviceCount 0 and isVirtual true", () => {
    const services: ServiceRow[] = [];
    const tree = buildTree(services, ["NewCategory"]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("NewCategory");
    expect(tree[0]!.serviceCount).toBe(0);
    expect(tree[0]!.isVirtual).toBe(true);
  });

  it("creates nested virtual path nodes", () => {
    const services: ServiceRow[] = [];
    const tree = buildTree(services, ["A/B/C"]);
    expect(tree[0]!.name).toBe("A");
    expect(tree[0]!.children[0]!.name).toBe("B");
    expect(tree[0]!.children[0]!.children[0]!.name).toBe("C");
  });

  it("virtual category becomes non-virtual once a service is assigned to it", () => {
    const services = [makeService({ id: 1, name: "Svc", categoryPath: "NewCategory" })];
    const tree = buildTree(services, ["NewCategory"]);
    expect(tree[0]!.isVirtual).toBe(false);
    expect(tree[0]!.serviceCount).toBe(1);
  });

  it("virtual category appears alongside real categories", () => {
    const services = [makeService({ id: 1, name: "Svc", categoryPath: "Real" })];
    const tree = buildTree(services, ["Virtual"]);
    expect(tree).toHaveLength(2);
    const names = tree.map(n => n.name).sort();
    expect(names).toEqual(["Real", "Virtual"]);
  });
});

describe("reparent path computation — drag-onto-node semantics", () => {
  /**
   * When a node is dragged onto another node (overId), it becomes a CHILD of
   * that node (toParentPath = overId). The server then computes:
   *   newPath = toParentPath + "/" + lastName(fromPath)
   */
  function computeNewPath(fromPath: string, toParentPath: string | null): string {
    const lastName = fromPath.includes("/") ? fromPath.split("/").pop()! : fromPath;
    return toParentPath ? `${toParentPath}/${lastName}` : lastName;
  }

  function reparentServicePath(serviceCategoryPath: string, fromPath: string, newPath: string): string {
    if (serviceCategoryPath === fromPath) return newPath;
    if (serviceCategoryPath.startsWith(fromPath + "/")) {
      return newPath + serviceCategoryPath.slice(fromPath.length);
    }
    return serviceCategoryPath;
  }

  it("dropping node A onto node B makes A a child of B", () => {
    const newPath = computeNewPath("A", "B");
    expect(newPath).toBe("B/A");
  });

  it("dropping A/Sub onto B makes B/Sub", () => {
    const newPath = computeNewPath("A/Sub", "B");
    expect(newPath).toBe("B/Sub");
  });

  it("dropping A/Sub onto B/Other makes B/Other/Sub", () => {
    const newPath = computeNewPath("A/Sub", "B/Other");
    expect(newPath).toBe("B/Other/Sub");
  });

  it("dropping a nested node to root (toParentPath=null) extracts the last segment", () => {
    const newPath = computeNewPath("Services/Consulting", null);
    expect(newPath).toBe("Consulting");
  });

  it("cycle guard: cannot drop onto self", () => {
    // Component guard: overId === activeId → skip
    const activeId = "A";
    const overId = "A";
    expect(overId === activeId || overId.startsWith(activeId + "/")).toBe(true);
  });

  it("cycle guard: cannot drop onto own descendant", () => {
    const activeId = "A";
    const overId = "A/Sub";
    expect(overId === activeId || overId.startsWith(activeId + "/")).toBe(true);
  });

  it("cycle guard allows dropping onto unrelated nodes", () => {
    const activeId = "A";
    const overId = "B";
    expect(overId === activeId || overId.startsWith(activeId + "/")).toBe(false);
  });

  it("reparents all descendant service paths correctly", () => {
    const from = "A/Sub";
    // User drops A/Sub onto B → toParentPath = B → newPath = B/Sub
    const newPath = computeNewPath(from, "B");
    const paths = ["A/Sub", "A/Sub/Deep", "A/Other", "A/Sub/Deep/Deeper"];
    const updated = paths.map(p => reparentServicePath(p, from, newPath));
    expect(updated[0]).toBe("B/Sub");
    expect(updated[1]).toBe("B/Sub/Deep");
    expect(updated[2]).toBe("A/Other");
    expect(updated[3]).toBe("B/Sub/Deep/Deeper");
  });
});

describe("QuickJump filter logic", () => {
  const services: ServiceRow[] = [
    makeService({ id: 1, name: "M365 Migration", categoryPath: "Consulting/M365", tags: ["microsoft", "cloud"] }),
    makeService({ id: 2, name: "SharePoint Setup", categoryPath: "Consulting/SharePoint", tags: ["sharepoint"] }),
    makeService({ id: 3, name: "Power BI Dashboard", categoryPath: "Analytics", tags: ["powerbi", "analytics"] }),
    makeService({ id: 4, name: "Quick Win Package", categoryPath: null, tags: null }),
  ];

  function filterServices(services: ServiceRow[], query: string): ServiceRow[] {
    if (!query) return services;
    const q = query.toLowerCase();
    return services.filter(s => {
      const inName = s.name.toLowerCase().includes(q);
      const inCategory = (s.categoryPath ?? s.category ?? "").toLowerCase().includes(q);
      const inTags = (s.tags ?? []).some(t => t.toLowerCase().includes(q));
      return inName || inCategory || inTags;
    });
  }

  it("returns all services when query is empty", () => {
    expect(filterServices(services, "")).toHaveLength(4);
  });

  it("filters by name (case-insensitive)", () => {
    const results = filterServices(services, "sharepoint");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(2);
  });

  it("filters by categoryPath", () => {
    const results = filterServices(services, "analytics");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(3);
  });

  it("filters by tag", () => {
    const results = filterServices(services, "cloud");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(1);
  });

  it("matches services with null categoryPath and null tags when name matches", () => {
    const results = filterServices(services, "quick");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(4);
  });

  it("returns empty when no service matches", () => {
    expect(filterServices(services, "zzznomatch")).toHaveLength(0);
  });
});
