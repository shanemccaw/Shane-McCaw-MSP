/**
 * simulatorFullResponse.test.ts
 *
 * Simulator Studio Part A — Full Response mode's $select-stripping logic.
 * Run with: pnpm --filter @workspace/admin-panel run test (vitest)
 */

import { describe, it, expect } from "vitest";
import { stripSelectParam } from "./simulatorFullResponse";

describe("stripSelectParam", () => {
  it("returns the endpoint unchanged when there is no query string at all", () => {
    expect(stripSelectParam("/users")).toBe("/users");
  });

  it("strips a bare $select query string entirely", () => {
    expect(stripSelectParam("/users?$select=id,displayName")).toBe("/users");
  });

  it("strips $select but keeps $filter (which shapes the item set, not the fields)", () => {
    const url =
      "/security/alerts_v2?$filter=detectionSource eq 'microsoftInsiderRiskManagement'&$select=id,title,severity";
    expect(stripSelectParam(url)).toBe(
      "/security/alerts_v2?$filter=detectionSource eq 'microsoftInsiderRiskManagement'",
    );
  });

  it("strips $select regardless of position among other params", () => {
    expect(stripSelectParam("/users?$top=50&$select=id&$count=true")).toBe("/users?$top=50&$count=true");
  });

  it("is case-insensitive on the $select token", () => {
    expect(stripSelectParam("/users?$SELECT=id,displayName")).toBe("/users");
  });

  it("leaves $expand untouched", () => {
    expect(stripSelectParam("/roleManagement/directory/roleEligibilitySchedules?$expand=principal")).toBe(
      "/roleManagement/directory/roleEligibilitySchedules?$expand=principal",
    );
  });

  it("is a no-op when the URL has other params but no $select", () => {
    expect(stripSelectParam("/users?$filter=accountEnabled eq true")).toBe(
      "/users?$filter=accountEnabled eq true",
    );
  });
});
