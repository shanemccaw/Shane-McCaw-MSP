/**
 * portal-pii-governance.test.ts — the PURE transform behind the customer PII
 * Governance read. The live testbed tenant has NO ok-status rows for any backing
 * check (all four report a Security & Compliance session error), so the
 * "findings" branches are only exercisable here, against synthetic rows.
 */

import { describe, it, expect } from "vitest";

import {
  buildPiiGovernance,
  severityFromBand,
  PII_GOVERNANCE_CHECKS,
  type PiiCheckRow,
} from "./portal-pii-governance";

const AT = new Date("2026-08-19T08:04:00.000Z");
const EARLIER = new Date("2026-08-18T01:00:00.000Z");

function row(partial: Partial<PiiCheckRow> & { checkKey: string; status: string }): PiiCheckRow {
  return {
    itemCount: null,
    severityMatched: null,
    severityLabel: null,
    extractedProperties: null,
    errorMessage: null,
    collectedAt: AT,
    ...partial,
  };
}

function mapOf(...rows: PiiCheckRow[]): Map<string, PiiCheckRow> {
  return new Map(rows.map((r) => [r.checkKey, r]));
}

describe("severityFromBand", () => {
  it("maps critical→High, warning→Medium, everything else→Low", () => {
    expect(severityFromBand("critical")).toBe("High");
    expect(severityFromBand("CRITICAL")).toBe("High");
    expect(severityFromBand("warning")).toBe("Medium");
    expect(severityFromBand("info")).toBe("Low");
    expect(severityFromBand(null)).toBe("Low");
    expect(severityFromBand("")).toBe("Low");
  });
});

describe("buildPiiGovernance", () => {
  it("empty input → Not collected, no findings, one not_collected coverage per check", () => {
    const out = buildPiiGovernance(new Map());
    expect(out.status).toBe("Not collected");
    expect(out.findings).toEqual([]);
    expect(out.scanned).toBeNull();
    expect(out.cadence).toBe("Daily");
    expect(out.coverage).toHaveLength(PII_GOVERNANCE_CHECKS.length);
    expect(out.coverage.every((c) => c.status === "not_collected")).toBe(true);
    expect(out.coverage.every((c) => c.count === null)).toBe(true);
  });

  it("errored checks are coverage, never findings, and carry the real error message", () => {
    const out = buildPiiGovernance(
      mapOf(
        row({
          checkKey: "compliance:missing-labels",
          status: "error",
          errorMessage: "Could not establish a Security & Compliance session for the target tenant.",
        }),
      ),
    );
    expect(out.findings).toEqual([]);
    expect(out.status).toBe("Not collected");
    const cov = out.coverage.find((c) => c.key === "compliance:missing-labels")!;
    expect(cov.status).toBe("error");
    expect(cov.reason).toContain("Security & Compliance session");
    expect(cov.count).toBeNull();
  });

  it("license_gap surfaces the Microsoft feature name from extractedProperties", () => {
    const out = buildPiiGovernance(
      mapOf(
        row({
          checkKey: "compliance:dlp-incidents",
          status: "license_gap",
          extractedProperties: {
            _licenseGap: true,
            _licenseGapCode: "cmdlet_unavailable",
            _licenseGapFeature: "Microsoft Purview Data Loss Prevention",
          },
        }),
      ),
    );
    expect(out.findings).toEqual([]);
    const cov = out.coverage.find((c) => c.key === "compliance:dlp-incidents")!;
    expect(cov.status).toBe("license_gap");
    expect(cov.reason).toBe("Requires a licence: Microsoft Purview Data Loss Prevention");
  });

  it("an ok run that found nothing is Monitored, not a finding, count 0 in coverage", () => {
    const out = buildPiiGovernance(
      mapOf(row({ checkKey: "compliance:weak-dlp-policies", status: "ok", itemCount: 0 })),
    );
    expect(out.findings).toEqual([]);
    expect(out.status).toBe("Monitored");
    const cov = out.coverage.find((c) => c.key === "compliance:weak-dlp-policies")!;
    expect(cov.status).toBe("ok");
    expect(cov.count).toBe(0);
    expect(out.scanned).toBe(AT.toISOString());
  });

  it("an ok critical run with a count becomes a High finding using the interpolated label + names", () => {
    const out = buildPiiGovernance(
      mapOf(
        row({
          checkKey: "compliance:missing-labels",
          status: "ok",
          itemCount: 3,
          severityMatched: "critical",
          severityLabel: "Multiple sensitivity labels are defined but disabled",
          extractedProperties: { disabledLabelNames: ["Confidential", "Highly Confidential", "Internal"] },
        }),
      ),
    );
    expect(out.status).toBe("At risk");
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.id).toBe("compliance:missing-labels");
    expect(f.sev).toBe("High");
    expect(f.count).toBe(3);
    expect(f.unit).toBe("labels disabled");
    expect(f.detail).toBe("Multiple sensitivity labels are defined but disabled");
    expect(f.names).toEqual(["Confidential", "Highly Confidential", "Internal"]);
  });

  it("falls back to the static detail when a run carries no interpolated label", () => {
    const out = buildPiiGovernance(
      mapOf(
        row({
          checkKey: "compliance:weak-dlp-policies",
          status: "ok",
          itemCount: 1,
          severityMatched: "warning",
          severityLabel: null,
        }),
      ),
    );
    const f = out.findings[0];
    expect(f.sev).toBe("Medium");
    expect(f.detail).toContain("not in an enforcing mode");
  });

  it("scanned is the LATEST ok collection time across checks", () => {
    const out = buildPiiGovernance(
      mapOf(
        row({ checkKey: "compliance:missing-labels", status: "ok", itemCount: 0, collectedAt: EARLIER }),
        row({ checkKey: "compliance:weak-dlp-policies", status: "ok", itemCount: 0, collectedAt: AT }),
        // an errored run is NOT counted as a scan time even if newer
        row({ checkKey: "compliance:dlp-incidents", status: "error", collectedAt: new Date("2026-08-20T00:00:00.000Z") }),
      ),
    );
    expect(out.scanned).toBe(AT.toISOString());
  });
});
