import { describe, expect, it } from "vitest";
import { parsePasteText } from "./buildTrackerPasteParser";

// The exact example Shane pasted when asking for this feature.
const SHANE_EXAMPLE = `Here's the real, complete remainder — 30 open items total, sorted by what actually matters:

**Currently building:**
- **#439** — MFA enforcement (in flight)

**Real, not-yet-fired, walkthrough findings:**
- #619 — consent-skip bug (worth re-checking, may already be resolved)
- #626/#627/#628 — Retainer/Monitoring tier + seat-count questions
- #660 — Share & Export entirely unwired
- #657 — Scenes page needs prioritization work
- #620 — remove Affirm
- #621 — email re-entered 3x
- #615/#616/#617/#618/#624/#640 — marketing copy/UX polish

**Real, deliberately deferred to later:**
- #611, #634, #636, #638, #646

**Big future epics, fully scoped, not urgent:**
- #647–652 (Remediation Tracker, 5 stages)
- #668–672 (White-Glove auto-provisioning, 4 stages)

**Background noise, not release-blocking:**
- #612, #654, #655

**Your admin panel side project:**
- #661, #662, #663, #664, #665

That's genuinely everything real and open right now. Nothing here is a showstopper — the actual product is live, sellable, and working end to end. This is all real polish, product depth, and future scope from here.`;

describe("parsePasteText", () => {
  it("groups bullets under their real bold header, in source order", () => {
    const groups = parsePasteText(SHANE_EXAMPLE);
    expect(groups.map((g) => g.label)).toEqual([
      "Currently building",
      "Real, not-yet-fired, walkthrough findings",
      "Real, deliberately deferred to later",
      "Big future epics, fully scoped, not urgent",
      "Background noise, not release-blocking",
      "Your admin panel side project",
    ]);
  });

  it("strips a bold single ref and keeps the description", () => {
    const [building] = parsePasteText(SHANE_EXAMPLE);
    expect(building.items).toEqual([{ numbers: [439], text: "MFA enforcement (in flight)" }]);
  });

  it("expands a slash list to individual numbers", () => {
    const [, findings] = parsePasteText(SHANE_EXAMPLE);
    const retainer = findings.items.find((i) => i.text.startsWith("Retainer"));
    expect(retainer?.numbers).toEqual([626, 627, 628]);

    const polish = findings.items.find((i) => i.text.includes("marketing copy"));
    expect(polish?.numbers).toEqual([615, 616, 617, 618, 624, 640]);
  });

  it("keeps a comma list as separate numbers with no leftover text", () => {
    const [, , deferred] = parsePasteText(SHANE_EXAMPLE);
    expect(deferred.items).toEqual([{ numbers: [611, 634, 636, 638, 646], text: "" }]);
  });

  it("expands an en-dash range to every number in between", () => {
    const [, , , epics] = parsePasteText(SHANE_EXAMPLE);
    expect(epics.items).toEqual([
      { numbers: [647, 648, 649, 650, 651, 652], text: "(Remediation Tracker, 5 stages)" },
      { numbers: [668, 669, 670, 671, 672], text: "(White-Glove auto-provisioning, 4 stages)" },
    ]);
  });

  it("drops leading prose and trailing prose that aren't headers or bullets", () => {
    const groups = parsePasteText(SHANE_EXAMPLE);
    const allText = groups.flatMap((g) => g.items.map((i) => i.text)).join(" ");
    expect(allText).not.toContain("genuinely everything real");
    expect(allText).not.toContain("sorted by what actually matters");
  });

  it("falls back to a single default group when there are bullets but no header", () => {
    const groups = parsePasteText("- #1 — first thing\n- #2 — second thing");
    expect(groups).toEqual([
      { label: "Items", items: [{ numbers: [1], text: "first thing" }, { numbers: [2], text: "second thing" }] },
    ]);
  });

  it("returns no groups for plain prose with no bullets at all", () => {
    expect(parsePasteText("Just some unrelated paragraph text.")).toEqual([]);
  });
});
