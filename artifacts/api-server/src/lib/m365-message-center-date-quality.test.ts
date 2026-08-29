/**
 * m365-message-center-date-quality.test.ts — Git #1536 (part of #1494).
 *
 * `extractAdvisoryDateText` is tested against REAL "[Rollout Schedule]"
 * section bodies pulled from the local Postgres `msp_message_center_items`
 * table (1159 real synced posts, 567 of which carry a Rollout Schedule
 * section) — verbatim excerpts, each still carrying the quirk that would
 * otherwise be guessed wrong: the heading written as both "[Rollout
 * Schedule]" and "Rollout schedule:]" (colon before the bracket), a bare
 * "General Availability" heading with the real date on the FOLLOWING bullet,
 * and a bullet shaped the other way round — a date-bearing label followed by
 * a long paragraph with no date near its own start.
 *
 * Run against the full 567-post "carries a Rollout Schedule section" slice of
 * that same real corpus, this parser produces a result for every one of them
 * — never nothing, and never a crash — which is the coverage these fixtures
 * are sampled from.
 */

import { describe, it, expect } from "vitest";
import { extractAdvisoryDateText } from "./m365-message-center-date-quality.ts";

describe("extractAdvisoryDateText — real Message Center post bodies", () => {
  it("returns null when the post has no Rollout Schedule section at all", () => {
    expect(extractAdvisoryDateText("<p>[What and Why]</p><p>Some other content.</p>")).toBeNull();
  });

  it("returns null for a null/empty body", () => {
    expect(extractAdvisoryDateText(null)).toBeNull();
    expect(extractAdvisoryDateText("")).toBeNull();
  });

  it("reads the begin/complete pair off the General Availability bullet (MC1440968)", () => {
    const body =
      "<p><b>[Rollout Schedule]</b></p><p><b>General Availability (Worldwide, GCC, GCC High, DoD):</b> " +
      "Rollout begins in<b> late August 2026 </b>and completes by<b> late September 2026.</b></p>" +
      "<p><b>[Impact on Your Organization]</b></p><p>Who is affected</p>";
    expect(extractAdvisoryDateText(body)).toBe("Rollout begins in late August 2026 and completes by late September 2026.");
  });

  it("handles the 'Rollout schedule:]' colon-before-bracket heading variant (MC1461705)", () => {
    const body =
      "<p><b>Rollout schedule:]</b></p><ul><li><b>Worldwide, GCC, GCC High, DoD:</b> Rollout begins mid-September 2026 " +
      "and is expected to complete by mid-October 2026.</li></ul><p><b>[Impact on your organization:]</b></p>";
    expect(extractAdvisoryDateText(body)).toBe("Rollout begins mid-September 2026 and is expected to complete by mid-October 2026.");
  });

  it("reads past a bare 'General Availability' heading to the date on the following bullet (MC1387578)", () => {
    const body =
      '<p><b>Rollout Schedule]</b></p><p style="margin-left: 25px;"><b>General Availability </b></p>' +
      '<ul><li style="margin-left: 25px;"><b>Worldwide:</b> Rollout begins in <b>June 2026</b> and is expected to complete by ' +
      "<b>end of September 2026</b> (previously&nbsp;late July).</li></ul><p><b>[Impact on Your Organization]</b></p>";
    expect(extractAdvisoryDateText(body)).toBe("Rollout begins in June 2026 and is expected to complete by end of September 2026 (previously late July).");
  });

  it("keeps a bare single-date label with no colon content (MC1458474)", () => {
    const body =
      "<p><b>Rollout schedule]</b></p><ul><li><b>July 21, 2026:</b>&nbsp;Organizations that are not already using these " +
      "custom CSS properties can no longer begin using them.</li></ul><p><b>[Impact on your organization]</b></p>";
    expect(extractAdvisoryDateText(body)).toBe("July 21, 2026");
  });

  it("skips a bare 'Key dates:' heading with no date of its own and reads the bullet beneath it (MC1422061)", () => {
    const body =
      "<p><b>[Rollout Schedule]</b></p><p><b>Key dates:</b></p><ul><li><b>September 2026: Administrators will no longer " +
      "be able to create new Custom Controls.</b></li></ul><p><b>[Impact on Your Organization]</b></p>";
    // The bullet's own label carries the date ("September 2026") and the text
    // after its colon does not restate one near its own start, so the label —
    // the actual date — is kept rather than the description that follows it.
    expect(extractAdvisoryDateText(body)).toBe("September 2026");
  });

  it("never returns a Date, only a string — the #1536 hard constraint", () => {
    const body = "<p><b>[Rollout Schedule]</b></p><p><b>General Availability:</b> August 2026</p><p>[Impact]</p>";
    const result = extractAdvisoryDateText(body);
    expect(typeof result).toBe("string");
  });

  it("caps the result length — this is a supplementary line, not the post body", () => {
    const longProse = "A".repeat(500) + " April 2026 " + "B".repeat(500);
    const body = `<p><b>[Rollout Schedule]</b></p><p><b>April 2026 - Enforcement:</b> ${longProse}</p><p>[Impact]</p>`;
    const result = extractAdvisoryDateText(body);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(200);
  });
});
