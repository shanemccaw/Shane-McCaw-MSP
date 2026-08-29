/**
 * m365-cloud-instance.test.ts — Git #1537 (part of #1494).
 *
 * Pure-logic tests against the real cloud-instance vocabulary Microsoft's own
 * feed ships — including the exact live sample #1530 verified against the
 * public v1 endpoint: `["Worldwide (Standard Multi-Tenant)", "GCC"]`.
 */

import { describe, it, expect } from "vitest";
import {
  isGovCloudInstance,
  hasGovCloudInstance,
  matchesCloudInstanceFilter,
  filterByCloudInstance,
  parseCloudInstanceFilterMode,
} from "./m365-cloud-instance.ts";

describe("isGovCloudInstance", () => {
  it("recognizes the real gov/DoD tags Microsoft ships", () => {
    expect(isGovCloudInstance("GCC")).toBe(true);
    expect(isGovCloudInstance("GCC High")).toBe(true);
    expect(isGovCloudInstance("DoD")).toBe(true);
  });

  it("does not match Worldwide", () => {
    expect(isGovCloudInstance("Worldwide (Standard Multi-Tenant)")).toBe(false);
  });
});

describe("matchesCloudInstanceFilter", () => {
  // The exact live sample verified against the real public feed in #1530.
  const worldwideAndGcc = ["Worldwide (Standard Multi-Tenant)", "GCC"];
  const govOnly = ["GCC High", "DoD"];
  const unclassified: string[] = [];

  it("worldwide mode keeps an item that also ships to GCC alongside Worldwide", () => {
    expect(matchesCloudInstanceFilter(worldwideAndGcc, "worldwide")).toBe(true);
  });

  it("worldwide mode excludes a gov-only item (the standing GCC exclusion, enforced from real data)", () => {
    expect(matchesCloudInstanceFilter(govOnly, "worldwide")).toBe(false);
  });

  it("worldwide mode keeps an unclassified item — absent data is not assumed out of scope", () => {
    expect(matchesCloudInstanceFilter(unclassified, "worldwide")).toBe(true);
  });

  it("gov mode keeps a gov-only item and a mixed item, drops a worldwide-only item", () => {
    expect(matchesCloudInstanceFilter(govOnly, "gov")).toBe(true);
    expect(matchesCloudInstanceFilter(worldwideAndGcc, "gov")).toBe(true);
    expect(matchesCloudInstanceFilter(["Worldwide (Standard Multi-Tenant)"], "gov")).toBe(false);
  });

  it("gov mode drops an unclassified item — no data is noise, not signal, for the NASA extraction", () => {
    expect(matchesCloudInstanceFilter(unclassified, "gov")).toBe(false);
  });

  it("all mode never filters anything", () => {
    expect(matchesCloudInstanceFilter(govOnly, "all")).toBe(true);
    expect(matchesCloudInstanceFilter(unclassified, "all")).toBe(true);
  });
});

describe("filterByCloudInstance", () => {
  const items = [
    { id: 1, cloudInstances: ["Worldwide (Standard Multi-Tenant)", "GCC"] },
    { id: 2, cloudInstances: ["GCC High", "DoD"] },
    { id: 3, cloudInstances: [] as string[] },
  ];

  it("worldwide mode drops only the gov-only item", () => {
    expect(filterByCloudInstance(items, "worldwide").map((i) => i.id)).toEqual([1, 3]);
  });

  it("gov mode keeps only items with a real gov tag", () => {
    expect(filterByCloudInstance(items, "gov").map((i) => i.id)).toEqual([1, 2]);
  });

  it("all mode passes everything through unfiltered", () => {
    expect(filterByCloudInstance(items, "all").map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe("parseCloudInstanceFilterMode", () => {
  it("accepts a recognized mode", () => {
    expect(parseCloudInstanceFilterMode("gov")).toBe("gov");
    expect(parseCloudInstanceFilterMode("all")).toBe("all");
  });

  it("falls back to the platform default (worldwide) for anything unrecognized, rather than throwing", () => {
    expect(parseCloudInstanceFilterMode(undefined)).toBe("worldwide");
    expect(parseCloudInstanceFilterMode("bogus")).toBe("worldwide");
    expect(parseCloudInstanceFilterMode(42)).toBe("worldwide");
  });
});

describe("hasGovCloudInstance", () => {
  it("is true iff at least one tag is gov", () => {
    expect(hasGovCloudInstance(["Worldwide (Standard Multi-Tenant)", "GCC High"])).toBe(true);
    expect(hasGovCloudInstance(["Worldwide (Standard Multi-Tenant)"])).toBe(false);
    expect(hasGovCloudInstance([])).toBe(false);
  });
});
