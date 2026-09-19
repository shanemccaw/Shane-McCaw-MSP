import { describe, it, expect } from "vitest";
import { computeSharePointStoragePercent } from "../monitor-executor.ts";

describe("computeSharePointStoragePercent (#4838)", () => {
  it("uses the latest report row and MB quota", () => {
    const r = computeSharePointStoragePercent(1000, [
      { "Report Date": "2026-09-16", "Storage Used (Byte)": "1" },
      { "Report Date": "2026-09-18", "Storage Used (Byte)": String(1048576 * 10) },
    ]);
    expect(r.sharepointStorageUsagePercent).toBe(1);
    expect(r.sharepointStorageQuotaBytes).toBe(1000 * 1048576);
  });
  it("throws instead of fabricating 0", () => {
    expect(() => computeSharePointStoragePercent(0, [{ "Storage Used (Byte)": "5" }])).toThrow();
    expect(() => computeSharePointStoragePercent(1000, [])).toThrow();
    expect(() => computeSharePointStoragePercent("mccawsoft2.sharepoint.com", [{ "Storage Used (Byte)": "5" }])).toThrow();
  });
});
