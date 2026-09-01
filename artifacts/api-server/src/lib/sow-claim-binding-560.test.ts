/**
 * sow-claim-binding-560.test.ts — Git #560
 *
 * The property this file exists to pin:
 *
 *   A SOW that bills a real price against the wrong workstream is never saved
 *   and never served, and a correct SOW — including one whose line prices sit
 *   close together — is not harmed by the gate that catches the first one.
 *
 * ── Why the central fixture is constructed, not captured ─────────────────────
 * #559 could replay real generations: Shane's five Force-Regenerate runs were
 * in git. There is no equivalent corpus for SOW — no reproduction has been run
 * against this engine, which the issue itself notes. So `SWAPPED_PRICES_HTML`
 * is a CONSTRUCTED instance of the failure, and it is constructed to be the
 * hardest version of it rather than a convenient one:
 *
 *   - every dollar figure in it is a real Sales Offer Engine price;
 *   - each figure appears exactly once, as it should;
 *   - the line items sum to the engine's total, to the penny;
 *   - only the PAIRING of two figures to two workstreams is crossed.
 *
 * That is the #559 mechanism in SOW's vocabulary: right values, wrong binding.
 * It is also the case that defeats every cheap check, which the first describe
 * block below demonstrates by running those checks and watching them pass the
 * bad document.
 *
 * ── What this suite can and cannot assert ────────────────────────────────────
 * Stated plainly, because the difference matters: there is no `ANTHROPIC_API_KEY`
 * in this environment, so these tests do NOT exercise the auditor model's own
 * judgment. What they pin is everything around it, which is where the design
 * decisions live:
 *
 *   - that the facts an auditor needs (the authoritative workstream-to-price
 *     table, and the warning that a correct total proves nothing) genuinely
 *     reach it in the prompt;
 *   - that the arithmetic check anyone would reach for first passes the bad
 *     document, which is the whole reason this is a model call;
 *   - that a mismatch verdict rejects the SOW with a specific, actionable,
 *     money-naming error, and a clean verdict on a correct SOW does not;
 *   - that every degraded path (unreadable verdict, thrown audit call, nothing
 *     priced, empty document) lets the document through or skips rather than
 *     destroying it.
 *
 * Whether the live auditor returns "mismatch" for a real crossed SOW is Shane's
 * to confirm against the real API.
 *
 * Run: pnpm --filter @workspace/api-server run test -- sow-claim-binding-560
 */

import { describe, it, expect, vi } from "vitest";

import {
  assertSowClaimBindingsConsistent,
  buildSowClaimBindingAuditPrompt,
  buildSowClaimBindingErrorMessage,
  parseSowClaimBindingVerdict,
  formatUsd,
  SowClaimBindingError,
  type SowClaimBindingLogger,
  type SowClaimBindingSource,
  type SowPricedLine,
} from "./sow-claim-binding.ts";

// ── Real source shape ─────────────────────────────────────────────────────────

/**
 * The authoritative workstream-to-price table, in the shape
 * `document-engine-sow.ts` builds from the Sales Offer Engine's candidates
 * (`title` + `adjustedPriceCents / 100`).
 *
 * The two middle prices are deliberately NOT close to each other. A swap
 * between them is a $7,600 error on one line — the kind of mistake that is
 * obvious once the binding is checked and completely invisible until it is.
 */
const ENGINE_LINES: SowPricedLine[] = [
  { title: "Identity & Access Hardening", priceUsd: 12400 },
  { title: "SharePoint External Sharing Remediation", priceUsd: 4800 },
  { title: "Copilot Readiness Enablement", priceUsd: 9750 },
];

const ENGINE_TOTAL = 26950;

const PRICING_FORMULA =
  "Price each workstream at exactly the adjusted price provided by the Sales Offer Engine. " +
  "Do not apply additional markup or discounting beyond what is shown. Present a pricing table " +
  "listing each workstream and its price, summing to a total engagement price.";

const PRIOR_FINDINGS = [
  "1. 26 of 104 groups have no owner assigned.",
  "2. External sharing is set to Anyone on 12 of 99 sites.",
  "3. Copilot readiness scored 61 against a go-live threshold of 82.",
].join("\n");

const SOURCE: SowClaimBindingSource = {
  lines: ENGINE_LINES,
  totalUsd: ENGINE_TOTAL,
  pricingFormula: PRICING_FORMULA,
  priorFindings: PRIOR_FINDINGS,
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * The defect. Identity & Access Hardening is billed at SharePoint's price and
 * SharePoint at Identity's. Both figures are real, both belong to the
 * engagement, and the total is exactly right.
 *
 * `data-line="workstream"` on the line rows is a test affordance, so the cheap
 * checks below extract line items without a fragile regex — the point of those
 * checks is what they conclude, not how well they parse.
 */
const SWAPPED_PRICES_HTML = `
<h1>Statement of Work</h1>
<p>This engagement addresses the governance and readiness gaps identified in the
prior assessment for the 2026 remediation programme.</p>
<h2>Scope and Pricing</h2>
<table>
  <thead><tr><th>Workstream</th><th>Scope</th><th>Price</th></tr></thead>
  <tbody>
    <tr data-line="workstream">
      <td>Identity &amp; Access Hardening</td>
      <td>Remediate ownerless groups and tighten conditional access.</td>
      <td>$4,800.00</td>
    </tr>
    <tr data-line="workstream">
      <td>SharePoint External Sharing Remediation</td>
      <td>Reduce Anyone-links across the 99 site collections in scope.</td>
      <td>$12,400.00</td>
    </tr>
    <tr data-line="workstream">
      <td>Copilot Readiness Enablement</td>
      <td>Close the readiness gap from 61 to the 82 go-live threshold.</td>
      <td>$9,750.00</td>
    </tr>
  </tbody>
  <tfoot><tr><td colspan="2">Total engagement</td><td>$26,950.00</td></tr></tfoot>
</table>
<p>Identity &amp; Access Hardening is delivered first at $4,800.00, followed by
SharePoint External Sharing Remediation at $12,400.00.</p>
`;

/** The same SOW, correct. The negative control. */
const CORRECT_HTML = SWAPPED_PRICES_HTML
  .replace(/\$4,800\.00/g, "@@A@@")
  .replace(/\$12,400\.00/g, "$4,800.00")
  .replace(/@@A@@/g, "$12,400.00");

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const log: SowClaimBindingLogger = { info, warn, error };
  return { log, info, warn, error };
}

const CTX = {
  docTypeKey: "sow",
  documentId: 4821,
  mspCustomerId: 77,
  source: "document-engine-sow",
} as const;

/** An auditor that reports the swap as certain — what a working audit returns. */
function swapVerdictAudit() {
  return vi.fn(async () =>
    JSON.stringify({
      mismatches: [
        {
          workstream: "Identity & Access Hardening",
          claim: "Identity & Access Hardening ... $4,800.00",
          sourcePrice: "$12,400.00",
          statedPrice: "$4,800.00",
          kind: "price_bound_to_wrong_workstream",
          confidence: "certain",
          explanation:
            "$4,800.00 is the engine price for SharePoint External Sharing Remediation, not for this workstream.",
        },
        {
          workstream: "SharePoint External Sharing Remediation",
          claim: "SharePoint External Sharing Remediation ... $12,400.00",
          sourcePrice: "$4,800.00",
          statedPrice: "$12,400.00",
          kind: "price_bound_to_wrong_workstream",
          confidence: "certain",
          explanation: "The two workstreams carry each other's prices.",
        },
      ],
    }),
  );
}

// ── The cheap checks, and why they are not the gate ───────────────────────────

/** Sums the line-item figures in a rendered SOW pricing table. */
function sumLineItems(html: string): number {
  const rows: string[] = html.match(/<tr data-line="workstream">[\s\S]*?<\/tr>/g) ?? [];
  return rows.reduce((sum, row) => {
    const money = row.match(/\$([\d,]+\.\d{2})/);
    return sum + (money ? Number(money[1].replace(/,/g, "")) : 0);
  }, 0);
}

/** Every dollar figure the document bills, as plain numbers. */
function billedFigures(html: string): number[] {
  const rows = html.match(/<tr data-line="workstream">[\s\S]*?<\/tr>/g) ?? [];
  return rows.flatMap((row) => {
    const money = row.match(/\$([\d,]+\.\d{2})/);
    return money ? [Number(money[1].replace(/,/g, ""))] : [];
  });
}

describe("#560 — why a numeric check cannot be the gate for a SOW", () => {
  it("the swapped document's line items sum to the engine total, to the penny", () => {
    // This is the whole problem. An arithmetic validator — the obvious first
    // idea on a pricing document, and one the engine already has the inputs for
    // (`sowTotalPrice`) — reconciles perfectly against a wrong SOW.
    expect(sumLineItems(SWAPPED_PRICES_HTML)).toBe(ENGINE_TOTAL);
    expect(sumLineItems(SWAPPED_PRICES_HTML)).toBe(sumLineItems(CORRECT_HTML));
  });

  it("every figure the swapped document bills is a real Sales Offer Engine price", () => {
    // And so a presence/set check passes it too: the defect introduces no new
    // number, invents nothing, and drops nothing.
    const enginePrices = new Set(ENGINE_LINES.map((l) => l.priceUsd));
    const billed = billedFigures(SWAPPED_PRICES_HTML);
    expect(billed).toHaveLength(ENGINE_LINES.length);
    for (const figure of billed) expect(enginePrices.has(figure)).toBe(true);
    // The multiset of billed figures is identical to the engine's, which is
    // exactly why nothing short of reading the binding can tell them apart.
    expect([...billed].sort()).toEqual([...enginePrices].sort());
  });

  it("the swapped and correct documents are indistinguishable by their numbers alone", () => {
    expect(billedFigures(SWAPPED_PRICES_HTML).sort()).toEqual(
      billedFigures(CORRECT_HTML).sort(),
    );
    // ...and yet they say different things about who is billed what.
    expect(SWAPPED_PRICES_HTML).not.toBe(CORRECT_HTML);
  });
});

// ── The prompt ────────────────────────────────────────────────────────────────

describe("#560 — the audit prompt carries what the auditor needs", () => {
  const prompt = buildSowClaimBindingAuditPrompt({
    documentText: "Identity & Access Hardening $4,800.00",
    source: SOURCE,
    docTypeKey: "sow",
  });

  it("gives the authoritative workstream-to-price table explicitly, pair by pair", () => {
    // The adaptation from #559: this auditor does not mine prose for the source
    // values, it is handed them.
    expect(prompt).toContain("Identity & Access Hardening = $12,400.00");
    expect(prompt).toContain("SharePoint External Sharing Remediation = $4,800.00");
    expect(prompt).toContain("Copilot Readiness Enablement = $9,750.00");
  });

  it("warns that a correct total is not evidence, and says why", () => {
    // Without this the obvious reasoning path — "the numbers add up, so the
    // pricing is fine" — clears the exact document the gate exists to stop.
    expect(prompt).toContain("A correct total is NOT evidence that the pricing is correct");
    expect(prompt).toContain("still sum to exactly the right total");
    expect(prompt).toContain("do NOT reason from the total to the lines");
  });

  it("asks about bindings rather than about whether a figure appears anywhere", () => {
    expect(prompt).toContain("You are checking BINDINGS, not arithmetic");
    expect(prompt).toContain("Do NOT check whether a figure appears somewhere in the table");
  });

  it("forbids the auditor re-pricing anything on its own judgment", () => {
    // An auditor with an opinion about market rates rejects correct SOWs.
    expect(prompt).toContain("Do NOT re-price anything");
    expect(prompt).toContain("sole pricing authority");
  });

  it("carries the total as context, and both source blocks the generator saw", () => {
    expect(prompt).toContain("Engagement total (context only, not a test): $26,950.00");
    expect(prompt).toContain(PRICING_FORMULA);
    expect(prompt).toContain(PRIOR_FINDINGS);
  });

  it("names the document type and holds the `certain` bar high", () => {
    expect(prompt).toContain('auditing a generated "sow" Statement of Work');
    expect(prompt).toContain('Use `confidence: "certain"` ONLY when');
  });

  it("says so when the document was cut for the audit, rather than implying it saw all of it", () => {
    const long = "x".repeat(90_000);
    const cut = buildSowClaimBindingAuditPrompt({ documentText: long, source: SOURCE, docTypeKey: "sow" });
    expect(cut).toContain("not the complete document");
  });

  it("does not claim truncation when the document fits", () => {
    expect(prompt).not.toContain("not the complete document");
  });

  it("states honestly when the pricing engine scoped nothing", () => {
    const empty = buildSowClaimBindingAuditPrompt({
      documentText: "anything",
      source: { ...SOURCE, lines: [], totalUsd: 0 },
      docTypeKey: "sow",
    });
    expect(empty).toContain("the pricing engine scoped no workstreams");
  });
});

// ── The verdict parser ────────────────────────────────────────────────────────

describe("#560 — reading the auditor's verdict", () => {
  it("reports a mismatch when any finding is `certain`", () => {
    const v = parseSowClaimBindingVerdict(
      '{"mismatches":[{"workstream":"A","confidence":"certain","kind":"price_bound_to_wrong_workstream"}]}',
    );
    expect(v.status).toBe("mismatch");
    expect(v.mismatches[0].kind).toBe("price_bound_to_wrong_workstream");
  });

  it("reports clean on an empty mismatch list", () => {
    expect(parseSowClaimBindingVerdict('{"mismatches":[]}').status).toBe("clean");
  });

  it("does not reject on `likely` or `unsure` alone", () => {
    const v = parseSowClaimBindingVerdict(
      '{"mismatches":[{"workstream":"A","confidence":"likely"},{"workstream":"B","confidence":"unsure"}]}',
    );
    expect(v.status).toBe("clean");
    // Reported but not gating — the signal that would tell us the bar is wrong.
    expect(v.mismatches).toHaveLength(2);
  });

  it("reads JSON out of a fenced or prefaced response rather than discarding it", () => {
    const v = parseSowClaimBindingVerdict(
      'Here is my verdict:\n```json\n{"mismatches":[{"workstream":"A","confidence":"certain"}]}\n```',
    );
    expect(v.status).toBe("mismatch");
  });

  it("downgrades an unrecognised confidence rather than promoting it", () => {
    const v = parseSowClaimBindingVerdict('{"mismatches":[{"workstream":"A","confidence":"definitely"}]}');
    expect(v.mismatches[0].confidence).toBe("unsure");
    expect(v.status).toBe("clean");
  });

  it("keeps a mismatch whose `kind` it does not recognise, as `other`", () => {
    // The kind shapes the message; it must never be the reason a real mismatch
    // is discarded.
    const v = parseSowClaimBindingVerdict(
      '{"mismatches":[{"workstream":"A","confidence":"certain","kind":"invented_kind"}]}',
    );
    expect(v.status).toBe("mismatch");
    expect(v.mismatches[0].kind).toBe("other");
  });

  it.each([
    ["an empty response", ""],
    ["prose with no JSON at all", "The pricing all looks fine to me."],
    ["malformed JSON", "{\"mismatches\": [ }"],
    ["JSON with no mismatches array", '{"verdict":"ok"}'],
  ])("is inconclusive, never clean, on %s", (_label, raw) => {
    const v = parseSowClaimBindingVerdict(raw);
    expect(v.status).toBe("inconclusive");
    expect(v.inconclusiveReason).toBeTruthy();
  });
});

// ── The gate ──────────────────────────────────────────────────────────────────

describe("#560 — the gate on a confirmed pricing mismatch", () => {
  it("rejects the swapped SOW and never returns it", async () => {
    const { log, error } = makeLogger();
    await expect(
      assertSowClaimBindingsConsistent(
        { documentHtml: SWAPPED_PRICES_HTML, source: SOURCE, ctx: CTX },
        log,
        swapVerdictAudit(),
      ),
    ).rejects.toBeInstanceOf(SowClaimBindingError);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("carries the workstream and both figures in the thrown message", async () => {
    const { log } = makeLogger();
    const err = await assertSowClaimBindingsConsistent(
      { documentHtml: SWAPPED_PRICES_HTML, source: SOURCE, ctx: CTX },
      log,
      swapVerdictAudit(),
    ).then(
      () => { throw new Error("expected assertSowClaimBindingsConsistent to throw"); },
      (e) => e as SowClaimBindingError,
    );

    expect(err).toBeInstanceOf(SowClaimBindingError);
    // Specific, not "validation failed" — an admin can check this against the
    // Sales Offer Engine without reading a log.
    expect(err.message).toContain("Identity & Access Hardening");
    expect(err.message).toContain("$12,400.00");
    expect(err.message).toContain("$4,800.00");
    expect(err.message).toContain("was NOT saved");
    expect(err.mismatches).toHaveLength(2);
    expect(err.docTypeKey).toBe("sow");
  });

  it("keeps the message inside the errorMessage column budget", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      workstream: `Workstream ${i} with a deliberately long descriptive name`,
      claim: "x".repeat(400),
      sourcePrice: "$12,400.00",
      statedPrice: "$4,800.00",
      kind: "price_bound_to_wrong_workstream" as const,
      confidence: "certain" as const,
      explanation: "y".repeat(400),
    }));
    const msg = buildSowClaimBindingErrorMessage("sow", many);
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(msg).toContain("(+11 more)");
  });

  it("reads differently for a workstream the engine never scoped", () => {
    const msg = buildSowClaimBindingErrorMessage("sow", [{
      workstream: "Managed Detection & Response",
      claim: "Managed Detection & Response — $18,000.00",
      sourcePrice: "",
      statedPrice: "$18,000.00",
      kind: "workstream_not_scoped",
      confidence: "certain",
      explanation: "Not in the engine's candidate list.",
    }]);
    expect(msg).toContain("did not scope");
    expect(msg).toContain("Managed Detection & Response");
  });
});

describe("#560 — the gate on a correct SOW", () => {
  it("passes a correct SOW through and logs it as consistent", async () => {
    const { log, info, error } = makeLogger();
    const audit = vi.fn(async () => '{"mismatches":[]}');
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: SOURCE, ctx: CTX },
      log,
      audit,
    );
    expect(verdict.status).toBe("clean");
    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("does not reject a SOW the auditor merely suspects", async () => {
    const { log, error } = makeLogger();
    const audit = vi.fn(async () =>
      '{"mismatches":[{"workstream":"Copilot Readiness Enablement","confidence":"likely"}]}',
    );
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: SOURCE, ctx: CTX },
      log,
      audit,
    );
    expect(verdict.status).toBe("clean");
    expect(error).not.toHaveBeenCalled();
  });

  it("puts the document's readable text, not its markup, in front of the auditor", async () => {
    const { log } = makeLogger();
    let seen = "";
    await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: SOURCE, ctx: CTX },
      log,
      async (p) => { seen = p; return '{"mismatches":[]}'; },
    );
    expect(seen).not.toContain("<td>");
    // The entity in "Identity &amp; Access Hardening" has to be decoded, or the
    // auditor is asked to match a workstream name the engine never used.
    expect(seen).toContain("Identity & Access Hardening");
    expect(seen).toContain("$12,400.00");
  });
});

// ── Degraded paths never destroy a document ───────────────────────────────────

describe("#560 — a broken audit is not a rejection", () => {
  it("lets the SOW through when the audit call throws", async () => {
    const { log, warn, error } = makeLogger();
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: SOURCE, ctx: CTX },
      log,
      async () => { throw new Error("529 overloaded"); },
    );
    expect(verdict.status).toBe("inconclusive");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("lets the SOW through when the verdict cannot be read", async () => {
    const { log, warn } = makeLogger();
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: SOURCE, ctx: CTX },
      log,
      async () => "I could not determine anything useful.",
    );
    expect(verdict.status).toBe("inconclusive");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("spends no model call at all when the pricing engine scoped nothing", async () => {
    // A real, expected state — not an audit failure, and not something to pay
    // Anthropic for.
    const { log, info } = makeLogger();
    const audit = vi.fn(async () => '{"mismatches":[]}');
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: CORRECT_HTML, source: { ...SOURCE, lines: [], totalUsd: 0 }, ctx: CTX },
      log,
      audit,
    );
    expect(audit).not.toHaveBeenCalled();
    expect(verdict.status).toBe("inconclusive");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("treats an empty document as inconclusive, never as a clean pricing check", async () => {
    const { log, warn } = makeLogger();
    const audit = vi.fn(async () => '{"mismatches":[]}');
    const verdict = await assertSowClaimBindingsConsistent(
      { documentHtml: "<div></div>", source: SOURCE, ctx: CTX },
      log,
      audit,
    );
    expect(verdict.status).toBe("inconclusive");
    expect(audit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ── Money formatting ──────────────────────────────────────────────────────────

describe("#560 — formatUsd renders the shape {{candidates}} and SOW tables use", () => {
  it.each([
    [12400, "$12,400.00"],
    [4800, "$4,800.00"],
    [9750.5, "$9,750.50"],
    [0, "$0.00"],
    [1234567.89, "$1,234,567.89"],
    [999, "$999.00"],
  ])("renders %s as %s", (input, expected) => {
    expect(formatUsd(input as number)).toBe(expected);
  });

  it("does not throw on a non-finite price", () => {
    expect(formatUsd(Number.NaN)).toBe("$?");
  });
});
