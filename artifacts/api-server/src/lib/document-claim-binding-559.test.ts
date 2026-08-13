/**
 * document-claim-binding-559.test.ts — Git #559
 *
 * The property this file exists to pin:
 *
 *   A document that states the OPPOSITE of the scan data it cites is never
 *   saved and never served, and a document that states it correctly is not
 *   harmed by the gate that catches the first one.
 *
 * ── Where the fixtures come from ─────────────────────────────────────────────
 * These are not invented. They are the real generated documents from Shane's
 * five-run reproduction (commit `6339200a`, `docs/1.html` … `docs/5.html`):
 * five Force-Regenerate runs of `governance_maturity_report` against tenant
 * c4c814d4 and one scan, of which FOUR inverted the Teams-ownership finding.
 *
 *   - `DOC_5_INVERTED_HTML` — run 5, the cleanest statement of the mechanism.
 *     It prints the CORRECT raw number and then draws the opposite conclusion
 *     from it inside the same sentence.
 *   - `DOC_4_CORRECT_HTML` — run 4, the one that got it right. It is the
 *     negative control, and it is a demanding one: it contains the number 26
 *     for ownerless GROUPS and the number 18 for Teams in the same passage,
 *     which is exactly the adjacency the other four documents collapsed.
 *
 * They are inlined rather than read from `docs/*.html` on purpose — that
 * directory is a scratch dump that later sessions overwrite, and a fixture that
 * can be silently replaced is not a fixture.
 *
 * ── What this suite can and cannot assert ────────────────────────────────────
 * Stated plainly, because the difference matters: there is no `ANTHROPIC_API_KEY`
 * in this environment, so these tests do NOT exercise the auditor model's own
 * judgment. What they pin is everything around it, which is where the design
 * decisions actually live:
 *
 *   - that the two facts an auditor needs to catch run 5 (the inverted sentence,
 *     and `ownerlessTeamCount: 0`) both genuinely reach it in the prompt;
 *   - that a numeric spot-check — the fix #559 originally proposed — passes the
 *     bad document, which is the whole reason this is a model call (see the
 *     "why not a numeric matcher" test below, which runs one and watches it
 *     find nothing);
 *   - that a mismatch verdict rejects the document with a specific, actionable
 *     error, and a clean verdict on run 4 does not;
 *   - that every degraded path (unreadable verdict, thrown audit call) lets the
 *     document through rather than destroying it.
 *
 * Whether the live auditor returns "mismatch" for run 5 is Shane's to confirm
 * against the real API, alongside the post-fix 5x regeneration.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-claim-binding-559
 */

import { describe, it, expect, vi } from "vitest";

import {
  assertClaimBindingsConsistent,
  buildClaimBindingAuditPrompt,
  buildClaimBindingErrorMessage,
  parseClaimBindingVerdict,
  stripHtmlToText,
  DocumentClaimBindingError,
  CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS,
  CLAIM_BINDING_TRUNCATION_MARKER,
  type ClaimBindingLogger,
} from "./document-claim-binding.ts";
import { extractAiHtml, firstTextBlock } from "./sow-pricing.ts";

// ── Real source data ──────────────────────────────────────────────────────────

/**
 * The `{{profileSample}}` block, in the exact `  <checkKey>.<property>: <value>`
 * shape `document-engine.ts` assembles, carrying the real values verified
 * against `tenant_monitor_profiles` in the issue.
 *
 * The four 18s against one 0 are the point. This is the ratio that makes 18 the
 * "obvious" number for any Teams-wide sentence, and it is why every number in
 * the false claim is genuinely present in the source.
 */
const REAL_PROFILE_SAMPLE = [
  "  teams:ownerless-teams.ownerlessTeamCount: 0",
  "  teams:guest-membership.teamsWithGuestsCount: 18",
  "  teams:meeting-policy-coverage.meetingPolicyAssignedCount: 18",
  "  teams:messaging-policy-coverage.messagingPolicyAssignedCount: 18",
  "  teams:inventory.teamCount: 18",
  "  teams:public-teams.publicTeamCount: 1",
  "  groups:ownerless-groups.ownerlessGroupCount: 26",
  "  groups:inventory.groupCount: 104",
  "  groups:expiration-policy.expirationPolicyConfigured: false",
  "  identity:access-reviews.accessReviewCount: 0",
].join("\n");

const REAL_FINDINGS = [
  "26 of 104 Microsoft 365 groups have no owner (groups:ownerless-groups)",
  "No group expiration policy is configured (groups:expiration-policy)",
  "No access reviews are configured (identity:access-reviews)",
].join("\n");

const REAL_SOURCE = { profileSample: REAL_PROFILE_SAMPLE, findings: REAL_FINDINGS };

// ── Real generated documents ──────────────────────────────────────────────────

/**
 * Run 5 — INVERTED. Note the second sentence: the count of zero is stated
 * CORRECTLY and then read as meaning the exact opposite of what it means. This
 * is the sentence the gate exists for.
 */
const DOC_5_INVERTED_HTML = `<section>
  <h3>All 18 Teams workspaces are formally ownerless</h3>
  <p>The scan recorded an ownerless Teams count of zero &mdash; meaning no Team currently has a
  designated owner in the way the platform tracks ownership for governance purposes. All 18 Teams
  (ATRIO, Small Parts Manufacturing, Roofing CRM, Netropole, TARR, Terminal Transfer, TCMS, Template,
  LifeWorksNW, Hunter Davisson, Vigilant, Sales, Columbia River Carbonates, Barricade MSP, NASA,
  Test NASA, Finance, and Shane McCaw Consulting - Templates) are in this state.</p>
  <p>Twenty-six of the tenant's 104 groups have no owner assigned.</p>
</section>`;

/**
 * Run 4 — CORRECT, and correct for the right reason: it names the distinction
 * ("tracked separately") that the other four documents collapsed.
 */
const DOC_4_CORRECT_HTML = `<section>
  <h3>All 18 Teams have an assigned owner</h3>
  <p>Every one of the tenant's 18 Teams &mdash; including ATRIO, Barricade MSP, Columbia River
  Carbonates, Finance, NASA, Roofing CRM, Sales, TARR, TCMS, Template, Terminal Transfer,
  LifeWorksNW, Hunter Davisson, Vigilant, Netropole, Test NASA, and Shane McCaw Consulting -
  Templates &mdash; has at least one owner recorded. This is clean. The gap is that those Teams are
  backed by Microsoft 365 groups, and the group layer is where the ownerless count of 26 sits.
  Teams ownership and group ownership are tracked separately.</p>
</section>`;

// ── Verdicts a correct auditor returns for each document ──────────────────────

const MISMATCH_VERDICT_FOR_DOC_5 = JSON.stringify({
  mismatches: [
    {
      claim: "The scan recorded an ownerless Teams count of zero — meaning no Team currently has a designated owner",
      property: "ownerlessTeamCount",
      sourceValue: "0",
      statedValue: "18 (all Teams ownerless)",
      confidence: "certain",
      explanation:
        "teams:ownerless-teams.ownerlessTeamCount is 0, which means no Team LACKS an owner. The document reads the same 0 as meaning no Team HAS an owner, and binds the Teams inventory count of 18 to the ownerless property.",
    },
  ],
});

const CLEAN_VERDICT = JSON.stringify({ mismatches: [] });

// ── Helpers ───────────────────────────────────────────────────────────────────

function testLogger(): ClaimBindingLogger & {
  infos: unknown[][]; warns: unknown[][]; errors: unknown[][];
} {
  const infos: unknown[][] = [];
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    infos, warns, errors,
    info: (b, m) => { infos.push([b, m]); },
    warn: (b, m) => { warns.push([b, m]); },
    error: (b, m) => { errors.push([b, m]); },
  };
}

const CTX = {
  docTypeKey: "governance_maturity_report",
  documentId: 4242,
  mspCustomerId: 42,
  source: "document-engine",
};

// ── The reproduction, replayed ────────────────────────────────────────────────

describe("Git #559 — the real 5-run reproduction, replayed through the gate", () => {
  it("rejects run 5 (the inversion) and never lets it be served", async () => {
    const log = testLogger();
    const audit = vi.fn(async () => MISMATCH_VERDICT_FOR_DOC_5);

    await expect(
      assertClaimBindingsConsistent(
        { documentHtml: DOC_5_INVERTED_HTML, source: REAL_SOURCE, ctx: CTX },
        log,
        audit,
      ),
    ).rejects.toBeInstanceOf(DocumentClaimBindingError);

    expect(log.errors).toHaveLength(1);
  });

  it("does NOT reject run 4 (the correct version) — the negative control", async () => {
    const log = testLogger();
    const audit = vi.fn(async () => CLEAN_VERDICT);

    const verdict = await assertClaimBindingsConsistent(
      { documentHtml: DOC_4_CORRECT_HTML, source: REAL_SOURCE, ctx: CTX },
      log,
      audit,
    );

    expect(verdict.status).toBe("clean");
    expect(log.errors).toHaveLength(0);
    expect(log.infos).toHaveLength(1);
  });

  it("gives the admin a specific error naming the property and both values, not 'validation failed'", async () => {
    const log = testLogger();
    let thrown: unknown;
    try {
      await assertClaimBindingsConsistent(
        { documentHtml: DOC_5_INVERTED_HTML, source: REAL_SOURCE, ctx: CTX },
        log,
        async () => MISMATCH_VERDICT_FOR_DOC_5,
      );
    } catch (err) {
      thrown = err;
    }

    const message = (thrown as Error).message;
    expect(message).toContain("ownerlessTeamCount");
    expect(message).toContain("governance_maturity_report");
    expect(message).toMatch(/NOT saved/);
    // The column it has to fit in.
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

// ── Why this had to be a model call ───────────────────────────────────────────

describe("Git #559 — a numeric spot-check cannot catch this (the design's premise)", () => {
  /**
   * The validator #559 originally proposed, implemented honestly: pull every
   * number out of the document and confirm each one appears in the source data.
   * If this test ever shows it catching run 5, the LLM auditor is unnecessary
   * and this whole module should be replaced by twelve lines.
   */
  function numericSpotCheck(documentHtml: string, profileSample: string): string[] {
    const sourceNumbers = new Set(
      (profileSample.match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) => n),
    );
    const documentNumbers = (stripHtmlToText(documentHtml).match(/-?\d+(?:\.\d+)?/g) ?? []);
    return documentNumbers.filter((n) => !sourceNumbers.has(n));
  }

  it("passes the INVERTED document cleanly — every number in the false claim is real", () => {
    expect(numericSpotCheck(DOC_5_INVERTED_HTML, REAL_PROFILE_SAMPLE)).toEqual([]);
  });

  /**
   * Sharper than "it can't tell them apart", and it fell out of actually
   * running it: the numeric check is INVERTED relative to the truth. It passes
   * the wrong document silently, and its only complaint about the RIGHT one is
   * the 365 in "Microsoft 365" — a product name, not a claim.
   *
   * So the cheap validator would have shipped every bad document and raised a
   * false alarm on the good one. That is not a weaker version of this gate; it
   * is a gate pointing the wrong way.
   */
  it("is inverted: it flags the CORRECT document and passes the wrong one", () => {
    const onBadDocument = numericSpotCheck(DOC_5_INVERTED_HTML, REAL_PROFILE_SAMPLE);
    const onGoodDocument = numericSpotCheck(DOC_4_CORRECT_HTML, REAL_PROFILE_SAMPLE);

    expect(onBadDocument).toEqual([]);
    expect(onGoodDocument).toEqual(["365"]);
    expect(stripHtmlToText(DOC_4_CORRECT_HTML)).toContain("Microsoft 365 groups");
  });

  it("confirms the trap: 18 is a genuinely correct value for four other Teams properties", () => {
    const eighteens = REAL_PROFILE_SAMPLE.split("\n").filter((l) => l.trim().endsWith(": 18"));
    expect(eighteens).toHaveLength(4);
    expect(REAL_PROFILE_SAMPLE).toContain("ownerlessTeamCount: 0");
  });
});

// ── The prompt actually carries what the auditor needs ────────────────────────

describe("Git #559 — the audit prompt", () => {
  it("puts the inverted sentence and the contradicting source value in front of the auditor", () => {
    const prompt = buildClaimBindingAuditPrompt({
      documentText: stripHtmlToText(DOC_5_INVERTED_HTML),
      source: REAL_SOURCE,
      docTypeKey: "governance_maturity_report",
    });

    expect(prompt).toContain("ownerless Teams count of zero");
    expect(prompt).toContain("no Team currently has a designated owner");
    expect(prompt).toContain("teams:ownerless-teams.ownerlessTeamCount: 0");
  });

  it("directs the auditor at bindings, and explicitly away from value-presence checking", () => {
    const prompt = buildClaimBindingAuditPrompt({
      documentText: "x", source: REAL_SOURCE, docTypeKey: "governance_maturity_report",
    });
    expect(prompt).toContain("BINDINGS, not values");
    expect(prompt).toContain("Do NOT check whether a number appears somewhere in the data");
    // The conservatism instruction that keeps run 4 from being flagged.
    expect(prompt).toContain("Two different properties having different values is normal");
  });

  it("tells the auditor when it is only seeing part of the document", () => {
    const huge = "The tenant has 18 Teams. ".repeat(
      Math.ceil((CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS + 5000) / 25),
    );
    const prompt = buildClaimBindingAuditPrompt({
      documentText: huge, source: REAL_SOURCE, docTypeKey: "governance_maturity_report",
    });
    expect(prompt).toContain(CLAIM_BINDING_TRUNCATION_MARKER.trim());
  });
});

// ── The confidence bar, and the degraded paths ────────────────────────────────

describe("Git #559 — only a certain mismatch rejects", () => {
  it.each(["likely", "unsure"])("does not reject on a %s mismatch", async (confidence) => {
    const log = testLogger();
    const verdict = await assertClaimBindingsConsistent(
      { documentHtml: DOC_4_CORRECT_HTML, source: REAL_SOURCE, ctx: CTX },
      log,
      async () => JSON.stringify({
        mismatches: [{ claim: "c", property: "p", sourceValue: "0", statedValue: "18", confidence, explanation: "e" }],
      }),
    );
    expect(verdict.status).toBe("clean");
    // Reported, though — a suspicion that is never logged cannot tell us the
    // bar is in the wrong place.
    expect(verdict.mismatches).toHaveLength(1);
    expect(log.infos[0]?.[0]).toMatchObject({ subThresholdCount: 1 });
  });

  it("downgrades an unrecognised confidence rather than promoting it", () => {
    const verdict = parseClaimBindingVerdict(JSON.stringify({
      mismatches: [{ claim: "c", property: "p", confidence: "CERTAIN!!", explanation: "e" }],
    }));
    expect(verdict.mismatches[0]?.confidence).toBe("unsure");
    expect(verdict.status).toBe("clean");
  });
});

describe("Git #559 — a broken audit is never a rejection, and never a pass", () => {
  it("lets the document through when the audit call throws", async () => {
    const log = testLogger();
    const verdict = await assertClaimBindingsConsistent(
      { documentHtml: DOC_5_INVERTED_HTML, source: REAL_SOURCE, ctx: CTX },
      log,
      async () => { throw new Error("529 overloaded"); },
    );
    expect(verdict.status).toBe("inconclusive");
    expect(log.warns).toHaveLength(1);
    expect(log.errors).toHaveLength(0);
  });

  it.each([
    ["empty response", ""],
    ["prose with no JSON", "The document looks fine to me."],
    ["malformed JSON", '{"mismatches": [ oops }'],
    ["JSON without a mismatches array", '{"verdict":"ok"}'],
  ])("reports %s as inconclusive, not clean", async (_label, raw) => {
    const log = testLogger();
    const verdict = await assertClaimBindingsConsistent(
      { documentHtml: DOC_5_INVERTED_HTML, source: REAL_SOURCE, ctx: CTX },
      log,
      async () => raw,
    );
    expect(verdict.status).toBe("inconclusive");
    expect(log.warns).toHaveLength(1);
  });

  it("still reads a real verdict that arrived wrapped in a code fence", () => {
    const verdict = parseClaimBindingVerdict(
      "Here is my analysis:\n```json\n" + MISMATCH_VERDICT_FOR_DOC_5 + "\n```",
    );
    expect(verdict.status).toBe("mismatch");
  });

  it("treats an empty document as inconclusive rather than as a passing audit", async () => {
    const log = testLogger();
    const audit = vi.fn(async () => CLEAN_VERDICT);
    const verdict = await assertClaimBindingsConsistent(
      { documentHtml: "   <div></div>  ", source: REAL_SOURCE, ctx: CTX },
      log,
      audit,
    );
    expect(verdict.status).toBe("inconclusive");
    // And it did not pay for an audit of nothing.
    expect(audit).not.toHaveBeenCalled();
  });
});

// ── FIX 1's fallout: thinking blocks come first in `content` ──────────────────

describe("Git #559 — adaptive thinking moves the document out of content[0]", () => {
  const THINKING_RESPONSE = {
    content: [
      { type: "thinking", thinking: "The ownerless count is 0, so every Team HAS an owner." },
      { type: "text", text: "<html><body><h1>Report</h1></body></html>" },
    ],
  };

  it("extractAiHtml still finds the document behind a leading thinking block", () => {
    expect(extractAiHtml(THINKING_RESPONSE)).toBe("<html><body><h1>Report</h1></body></html>");
  });

  it("would have returned an EMPTY document under the old content[0] read", () => {
    // The exact expression that used to be in extractAiHtml, kept as the
    // regression's own witness: this is what would have been written to
    // html_content with thinking on, silently and without an error.
    const oldBehaviour = (THINKING_RESPONSE.content[0] as { text?: string }).text ?? "";
    expect(oldBehaviour).toBe("");
  });

  it("firstTextBlock tolerates the untyped { text } blocks this repo's fixtures use", () => {
    expect(firstTextBlock({ content: [{ text: "bare" }] })).toBe("bare");
    expect(firstTextBlock({ content: [{ type: "thinking", thinking: "t" }] })).toBeNull();
  });
});

// ── Text extraction ───────────────────────────────────────────────────────────

describe("Git #559 — stripHtmlToText", () => {
  it("drops HTML comments whole so section markers are not read as prose", () => {
    const text = stripHtmlToText("<!-- Finding: Ownerless Teams --><p>Real sentence.</p>");
    expect(text).not.toContain("Finding: Ownerless Teams");
    expect(text).toContain("Real sentence.");
  });

  it("keeps the claim under audit intact through entity decoding", () => {
    expect(stripHtmlToText(DOC_5_INVERTED_HTML)).toContain(
      "ownerless Teams count of zero — meaning no Team currently has a",
    );
  });
});

describe("Git #559 — buildClaimBindingErrorMessage", () => {
  it("stays inside the errorMessage column budget even on a pathological claim", () => {
    const message = buildClaimBindingErrorMessage("governance_maturity_report", [
      {
        claim: "x".repeat(4000), property: "y".repeat(200), sourceValue: "0",
        statedValue: "18", confidence: "certain", explanation: "z".repeat(4000),
      },
    ]);
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("says how many other claims were wrong when there is more than one", () => {
    const one = {
      claim: "c", property: "p", sourceValue: "0", statedValue: "18",
      confidence: "certain" as const, explanation: "e",
    };
    expect(buildClaimBindingErrorMessage("d", [one, one, one])).toContain("+2 more");
  });
});
