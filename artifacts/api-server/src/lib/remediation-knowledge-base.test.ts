/**
 * remediation-knowledge-base.test.ts
 *
 * Git #493. Locks the two things this subsystem exists to guarantee:
 *
 *   1. PROVENANCE ROUTING — a finding whose check has a published
 *      `remediation_knowledge_base` row is rendered from that row and makes NO
 *      model call. Only an uncovered finding reaches the AI generator.
 *   2. VISUAL DISTINCTION — the AI branch's output carries the
 *      "AI-generated guidance — verify before running" banner, the amber
 *      surface, and per-command "unverified" tags; the verified branch carries
 *      none of them and instead names its reviewer and verification date. The
 *      brief was a distinction a customer cannot miss, so these are asserted as
 *      real substring/colour facts, not as "some marker exists somewhere".
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Rows the two batched lookups return, in the order they are issued (KB rows, then check labels). */
let selectQueue: unknown[][] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => selectQueue.shift() ?? [],
      }),
    }),
  },
  monitorChecksTable: { key: "key", label: "label" },
  remediationKnowledgeBaseTable: { checkKey: "check_key", status: "status" },
}));

// The real operators build SQL against real column objects; the stubs above are
// plain literals, so the operators are reduced to inert markers.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => parts,
  eq: (a: unknown, b: unknown) => [a, b],
  inArray: (a: unknown, b: unknown) => [a, b],
}));

const generateRemediationDetail = vi.fn();
vi.mock("./remediation-detail-generator", () => ({
  generateRemediationDetail: (...args: unknown[]) => generateRemediationDetail(...args),
}));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  buildRemediationAppendix,
  escapeHtml,
  renderAiFallbackRemediationBlock,
  renderVerifiedRemediationBlock,
  toIssueCategory,
  toIssueSeverity,
  REMEDIATION_APPENDIX_MAX_FINDINGS,
  type RemediationAppendixFinding,
} from "./remediation-knowledge-base.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Shaped exactly like a real `remediation_knowledge_base` select row. */
function kbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    checkKey: "identity:global-admin-count",
    title: "Reduce standing Global Administrator assignments",
    summary: "Microsoft recommends fewer than five permanent Global Administrators.",
    prerequisites: ["Global Administrator role", "Microsoft.Graph module installed"],
    adminCenterPath: "Microsoft Entra admin center > Identity > Roles & admins",
    adminCenterUrl: "https://entra.microsoft.com/",
    remediationSteps: [
      { text: "List the current holders.", code: "Get-MgDirectoryRoleMember -DirectoryRoleId $id", codeLanguage: "powershell" },
      { text: "Assign a least-privileged role instead." },
    ],
    expectedOutcome: "Fewer than five accounts hold Global Administrator.",
    validationStep: "Re-run the member list and confirm the count.",
    validationCommand: "(Get-MgDirectoryRoleMember -DirectoryRoleId $id).Count",
    sourceUrls: ["https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices"],
    verifiedAgainst: "Microsoft Learn, 2026-08",
    lastVerifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    verifiedBy: "Shane McCaw",
    status: "published",
    notes: null,
    createdAt: new Date("2026-08-06T00:00:00.000Z"),
    updatedAt: new Date("2026-08-06T00:00:00.000Z"),
    ...overrides,
  };
}

function finding(checkKey: string | null, overrides: Partial<RemediationAppendixFinding> = {}): RemediationAppendixFinding {
  return {
    text: `${checkKey ?? "script finding"}: high severity condition matched on latest monitoring scan (3 items)`,
    checkKey,
    severity: "high",
    itemCount: 3,
    categories: ["security"],
    ...overrides,
  };
}

const PARAMS = {
  mspCustomerId: 42,
  mspId: 7,
  docTypeKey: "remediation_plan",
  triggerSource: "test",
};

beforeEach(() => {
  selectQueue = [];
  generateRemediationDetail.mockReset();
  generateRemediationDetail.mockResolvedValue({
    detail: "This finding means your tenant is over-privileged.",
    steps: [{ text: "Audit the role holders.", code: "Get-MgDirectoryRole" }],
  });
});

// ── 1. Provenance routing ─────────────────────────────────────────────────────

describe("buildRemediationAppendix — which source each finding is rendered from", () => {
  it("renders a covered finding from its knowledge-base row and makes NO AI call", async () => {
    selectQueue = [
      [kbRow()],                                                             // published KB rows
      [{ key: "identity:global-admin-count", label: "Global admin count" }], // check labels
    ];

    const result = await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: true,
      findings: [finding("identity:global-admin-count")],
    });

    expect(generateRemediationDetail).not.toHaveBeenCalled();
    expect(result.verifiedCount).toBe(1);
    expect(result.aiGeneratedCount).toBe(0);
    expect(result.coveredCheckKeys).toEqual(["identity:global-admin-count"]);
    expect(result.uncoveredCheckKeys).toEqual([]);
    expect(result.html).toContain("Verified remediation");
    expect(result.html).not.toContain("AI-generated guidance");
  });

  it("falls back to the AI generator ONLY for a finding with no knowledge-base row", async () => {
    selectQueue = [
      [kbRow()], // only identity:global-admin-count is covered
      [
        { key: "identity:global-admin-count", label: "Global admin count" },
        { key: "sharepoint:anonymous-links", label: "Anonymous sharing links" },
      ],
    ];

    const result = await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: true,
      findings: [finding("identity:global-admin-count"), finding("sharepoint:anonymous-links")],
    });

    expect(generateRemediationDetail).toHaveBeenCalledTimes(1);
    expect(result.verifiedCount).toBe(1);
    expect(result.aiGeneratedCount).toBe(1);
    expect(result.uncoveredCheckKeys).toEqual(["sharepoint:anonymous-links"]);
    // Both provenances present in ONE document — the case the visual
    // distinction exists for.
    expect(result.html).toContain("Verified remediation");
    expect(result.html).toContain("AI-generated guidance");
  });

  it("routes a finding with no check key at all (a script-run finding) to the labelled fallback, never to the KB", async () => {
    selectQueue = [[], []];

    const result = await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: true,
      findings: [finding(null, { severity: null, itemCount: null, categories: [] })],
    });

    expect(generateRemediationDetail).toHaveBeenCalledTimes(1);
    expect(result.verifiedCount).toBe(0);
    expect(result.aiGeneratedCount).toBe(1);
    // No check key to report as uncovered — the backlog list stays honest.
    expect(result.uncoveredCheckKeys).toEqual([]);
  });

  it("makes no AI call at all when the fallback is disallowed (the dry-run/preview path)", async () => {
    selectQueue = [[], [{ key: "sharepoint:anonymous-links", label: "Anonymous sharing links" }]];

    const result = await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: false,
      findings: [finding("sharepoint:anonymous-links")],
    });

    expect(generateRemediationDetail).not.toHaveBeenCalled();
    expect(result.pendingCount).toBe(1);
    expect(result.aiGeneratedCount).toBe(0);
    expect(result.html).toContain("No model call was made for this preview");
  });

  it("renders an explicit 'not available' block when the AI fallback throws, rather than dropping the finding or failing the document", async () => {
    selectQueue = [[], [{ key: "security:open-incidents", label: "Open security incidents" }]];
    generateRemediationDetail.mockRejectedValue(new Error("model returned unparseable JSON"));

    const result = await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: true,
      findings: [finding("security:open-incidents")],
    });

    expect(result.failedCount).toBe(1);
    expect(result.aiGeneratedCount).toBe(0);
    expect(result.html).toContain("Guidance not available");
    // The finding is still represented — the narrative discusses it, so the
    // appendix must not silently omit it.
    expect(result.html).toContain("Open security incidents");
  });

  it("reports the cap instead of silently covering only part of the finding set", async () => {
    const many = Array.from({ length: REMEDIATION_APPENDIX_MAX_FINDINGS + 3 }, (_, i) => finding(`check:${i}`));
    selectQueue = [[], []];

    const result = await buildRemediationAppendix({ ...PARAMS, allowAiFallback: false, findings: many });

    expect(result.truncatedCount).toBe(3);
    expect(result.pendingCount).toBe(REMEDIATION_APPENDIX_MAX_FINDINGS);
  });

  it("returns an empty appendix (and issues no query) for a document with no findings", async () => {
    const result = await buildRemediationAppendix({ ...PARAMS, allowAiFallback: true, findings: [] });
    expect(result.html).toBe("");
    expect(generateRemediationDetail).not.toHaveBeenCalled();
  });

  it("passes the check's REAL label and item count to the AI generator, not the raw finding string", async () => {
    selectQueue = [[], [{ key: "sharepoint:anonymous-links", label: "Anonymous sharing links" }]];

    await buildRemediationAppendix({
      ...PARAMS,
      allowAiFallback: true,
      findings: [finding("sharepoint:anonymous-links", { itemCount: 7 })],
    });

    expect(generateRemediationDetail).toHaveBeenCalledWith(
      { label: "Anonymous sharing links (7 items flagged)", category: "blocker", severity: "High" },
      undefined,
      { mspId: 7, customerId: 42, triggerSource: "test" },
    );
  });
});

// ── 2. Visual distinction ─────────────────────────────────────────────────────

describe("visual distinction between verified and AI-generated content", () => {
  const verified = () => renderVerifiedRemediationBlock("Global admin count", kbRow() as never);
  const ai = () =>
    renderAiFallbackRemediationBlock("Anonymous sharing links", "Some AI detail.", [
      { text: "Run this.", code: "Get-Thing -Id <SiteId>" },
    ]);

  it("gives the AI block the verify-before-running banner and the verified block nothing like it", () => {
    expect(ai()).toContain("AI-generated guidance &mdash; verify before running");
    expect(verified()).not.toContain("verify before running");
  });

  it("states plainly, in the AI block, that no human reviewed it", () => {
    const html = ai();
    expect(html).toContain("not</strong> reviewed by a human");
    expect(html).toContain("test it outside production");
    expect(html).toContain("No verified knowledge-base entry exists for this finding yet");
  });

  it("tags every command in the AI block as unverified, and no command in the verified block", () => {
    expect(ai()).toContain("Unverified command");
    expect(verified()).not.toContain("Unverified command");
  });

  it("uses two different colour identities, not one style with a caption swapped", () => {
    // Amber rail/banner vs green rail/banner. Asserted because "a small caption
    // that is easy to miss" was the explicitly rejected outcome.
    expect(ai()).toContain("#b45309");
    expect(ai()).not.toContain("#047857");
    expect(verified()).toContain("#047857");
    expect(verified()).not.toContain("#b45309");
  });

  it("names the reviewer and the verification date on verified content", () => {
    const html = verified();
    expect(html).toContain("Last verified 2026-08-06 by Shane McCaw");
    expect(html).toContain("Microsoft Learn, 2026-08");
    expect(html).toContain("learn.microsoft.com");
  });

  it("carries every verified field the schema promises through to the document", () => {
    const html = verified();
    expect(html).toContain("Microsoft recommends fewer than five permanent Global Administrators.");
    expect(html).toContain("Microsoft.Graph module installed");
    expect(html).toContain("Microsoft Entra admin center");
    expect(html).toContain("Get-MgDirectoryRoleMember -DirectoryRoleId $id");
    expect(html).toContain("Fewer than five accounts hold Global Administrator.");
    expect(html).toContain("Re-run the member list and confirm the count.");
  });

  it("renders both branches through the same card shell, so the ONLY difference a reader sees is provenance", () => {
    for (const html of [verified(), ai()]) {
      expect(html).toContain("<h3");
      expect(html).toContain("Steps");
      expect(html).toContain("<pre");
    }
  });
});

// ── 3. Escaping ───────────────────────────────────────────────────────────────

describe("escaping", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  });

  it("escapes hand-authored KB text, so a PowerShell comparison operator cannot become markup", () => {
    const html = renderVerifiedRemediationBlock(
      "Heading",
      kbRow({
        summary: "Accounts where <Count> -gt 5 & unreviewed",
        remediationSteps: [{ text: "Filter it.", code: `Where-Object { $_.Count -gt 5 -and $_.Name -like "<prefix>*" }` }],
      }) as never,
    );
    expect(html).toContain("&lt;Count&gt;");
    expect(html).toContain("&lt;prefix&gt;");
    expect(html).not.toContain("<Count>");
  });

  it("escapes AI output too — it is model-authored text, not trusted markup", () => {
    const html = renderAiFallbackRemediationBlock("H", "<script>alert(1)</script>", []);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

// ── 4. Vocabulary mapping onto the AI generator's fixed input type ────────────

describe("mapping the platform's severity/pillar vocabulary onto the generator's", () => {
  it("maps the severities the live corpus actually uses", () => {
    expect(toIssueSeverity("critical")).toBe("High");
    expect(toIssueSeverity("HIGH")).toBe("High");
    expect(toIssueSeverity("info")).toBe("Low");
    expect(toIssueSeverity("warning")).toBe("Medium");
  });

  it("defaults an unknown or absent severity to Medium — never to Low", () => {
    // `severity_rules.severity` is free text and 100% DB-resident, so unknown
    // values are expected. An unrecognised severity is not evidence of a
    // low-severity finding.
    expect(toIssueSeverity("chartreuse")).toBe("Medium");
    expect(toIssueSeverity(null)).toBe("Medium");
    expect(toIssueSeverity("")).toBe("Medium");
  });

  it("maps only the two pillars with an honest counterpart, and never invents 'sensitivity'", () => {
    expect(toIssueCategory(["copilot"])).toBe("friction");
    expect(toIssueCategory(["adoption"])).toBe("friction");
    expect(toIssueCategory(["security"])).toBe("blocker");
    expect(toIssueCategory(["governance", "compliance"])).toBe("blocker");
    expect(toIssueCategory([])).toBe("blocker");
    expect(["blocker", "friction"]).toContain(toIssueCategory(["licensing"]));
  });
});
