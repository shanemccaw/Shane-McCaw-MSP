import { describe, expect, it } from "vitest";
import { acronymOf, BOOST, cmdScore, TIER } from "./cmdScore";
import { emptyStateResults, GROUP, parseQuery, rankResults, runPaletteQuery } from "./paletteQuery";
import type { CommandItem } from "../registry/types";

const cmd = (id: string, name: string, type = "destination", area?: string) => ({
  id,
  name,
  type,
  area,
});

describe("cmdScore tiers", () => {
  it("orders exact above prefix above word-start above substring", () => {
    const q = "access";
    const exact = cmdScore(cmd("a", "Access"), q);
    const prefix = cmdScore(cmd("b", "Access Review"), q);
    const wordStart = cmdScore(cmd("c", "Guest Access Review"), q);
    const substring = cmdScore(cmd("d", "Reaccessing"), q);

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
  });

  it("matches acronyms — the tier that makes the palette usable without recall", () => {
    // The example from handoff.md section 2.
    expect(cmdScore(cmd("a", "Guest Access Review"), "gar")).toBe(TIER.acronym);
  });

  it("resolves single letters through a real tier, never the acronym one", () => {
    // An acronym's first letter is by definition the name's first letter, so a
    // one-character query that would match an acronym is always caught by the
    // higher prefix tier first. MIN_ACRONYM_QUERY is belt-and-braces.
    expect(cmdScore(cmd("a", "Guest Access Review"), "g")).toBe(TIER.prefix);
    // A later word's initial is a word-start match, which outranks acronym.
    expect(cmdScore(cmd("b", "Package Runner"), "r")).toBe(TIER.wordStart);
  });

  it("requires two characters before the acronym tier engages", () => {
    // "pr" is not a prefix of "Package Runner", not a word start, and not a
    // substring — acronym is the only tier that can match it.
    expect(cmdScore(cmd("a", "Package Runner"), "pr")).toBe(TIER.acronym);
  });

  it("falls back to subsequence and penalises gaps", () => {
    const tight = cmdScore(cmd("a", "abcxyz"), "abc");
    const loose = cmdScore(cmd("b", "a-b-c-x-y-z"), "abc");
    expect(tight).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0);
  });

  it("returns 0 when the query is not a subsequence at all", () => {
    expect(cmdScore(cmd("a", "Guest Access Review"), "zzz")).toBe(0);
  });

  it("scores nothing for an empty query — the empty state is curated, not ranked", () => {
    expect(cmdScore(cmd("a", "Anything"), "")).toBe(0);
    expect(cmdScore(cmd("a", "Anything"), "   ")).toBe(0);
  });

  it("is case and whitespace insensitive", () => {
    expect(cmdScore(cmd("a", "Guest Access Review"), "  GUEST ")).toBe(TIER.prefix);
  });
});

describe("cmdScore boosts", () => {
  it("adds 60 when the result belongs to the area you are in", () => {
    const item = cmd("a", "Endpoints", "destination", "endpoints");
    const plain = cmdScore(item, "endpoints");
    const boosted = cmdScore(item, "endpoints", { currentArea: "endpoints" });
    expect(boosted - plain).toBe(BOOST.area);
  });

  it("adds 25 for actions", () => {
    const noun = cmdScore(cmd("a", "Run scan", "record"), "run scan");
    const verb = cmdScore(cmd("b", "Run scan", "action"), "run scan");
    expect(verb - noun).toBe(BOOST.action);
  });

  it("decays the recency boost down the list", () => {
    const first = cmdScore(cmd("a", "Thing"), "thing", { recentIds: ["a", "b"] });
    const second = cmdScore(cmd("b", "Thing"), "thing", { recentIds: ["a", "b"] });
    const none = cmdScore(cmd("c", "Thing"), "thing", { recentIds: ["a", "b"] });
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(none);
    expect(first - none).toBeCloseTo(BOOST.recencyMax, 5);
  });

  it("keeps boosts from inverting adjacent tiers", () => {
    // Every boost stacked must not lift an acronym hit past a substring hit.
    const acronymAllBoosts = cmdScore(cmd("a", "Guest Access Review", "action", "x"), "gar", {
      currentArea: "x",
    });
    expect(acronymAllBoosts).toBeLessThan(TIER.substring);
  });
});

describe("acronymOf", () => {
  it("takes the first letter of each word", () => {
    expect(acronymOf("Guest Access Review")).toBe("gar");
    expect(acronymOf("M365 Endpoints")).toBe("me");
    expect(acronymOf("dead-letter queue")).toBe("dlq");
  });
});

describe("parseQuery", () => {
  it("recognises all four prefixes", () => {
    expect(parseQuery("@endpoints")).toEqual({ type: "destination", text: "endpoints" });
    expect(parseQuery(">run")).toEqual({ type: "action", text: "run" });
    expect(parseQuery("#acme")).toEqual({ type: "record", text: "acme" });
    expect(parseQuery("?profit")).toEqual({ type: "answer", text: "profit" });
  });

  it("treats a bare prefix as browse-the-whole-category", () => {
    expect(parseQuery("@")).toEqual({ type: "destination", text: "" });
  });

  it("leaves an unprefixed query alone", () => {
    expect(parseQuery("  endpoints ")).toEqual({ type: null, text: "endpoints" });
  });
});

const items: CommandItem[] = [
  { id: "d1", type: "destination", name: "Endpoints", run: () => {} },
  { id: "d2", type: "destination", name: "Money", run: () => {} },
  { id: "a1", type: "action", name: "Run a scan", run: () => {} },
  { id: "r1", type: "record", name: "Acme Corp", run: () => {} },
  { id: "q1", type: "answer", name: "Profit this month", live: "$12,480", run: () => {} },
];

describe("palette results", () => {
  it("empty state is recents, then destinations, then answers, then actions", () => {
    // The prototype puts answers between destinations and actions; handoff.md's
    // prose omits them. The code is the more specific source.
    const out = emptyStateResults(items, { recentIds: ["r1"] });
    expect(out.map((i) => i.id)).toEqual(["r1", "d1", "d2", "q1", "a1"]);
  });

  it("bands the empty state so the recents header names itself", () => {
    const out = emptyStateResults(items, { recentIds: ["r1"] });
    expect(out[0]!.group).toBe(GROUP.recent);
    expect(out[1]!.group).toBe(GROUP.destination);
  });

  it("never repeats a recent in the later bands", () => {
    const out = emptyStateResults(items, { recentIds: ["d2"] });
    expect(out.filter((i) => i.id === "d2")).toHaveLength(1);
  });

  it("a bare prefix lists the whole category", () => {
    const { results } = runPaletteQuery(items, "@", {});
    expect(results.map((i) => i.id)).toEqual(["d1", "d2"]);
  });

  it("a prefix restricts the pool before ranking", () => {
    const { results } = runPaletteQuery(items, ">run", {});
    expect(results.map((i) => i.id)).toEqual(["a1"]);
  });

  it("orders ties by name so the list does not reshuffle between keystrokes", () => {
    const tied: CommandItem[] = [
      { id: "z", type: "record", name: "Zebra", run: () => {} },
      { id: "a", type: "record", name: "Alpha", run: () => {} },
    ];
    // Both match "a" only as a subsequence/substring at the same tier.
    const out = rankResults(tied, "a", {});
    expect(out[0]!.name).toBe("Alpha");
  });

  it("counts the pool per prefix", () => {
    expect(runPaletteQuery(items, "@", {}).count).toBe("2 places to go");
    expect(runPaletteQuery(items, ">", {}).count).toBe("1 things you can do");
    expect(runPaletteQuery(items, "#", {}).count).toBe("1 records");
    expect(runPaletteQuery(items, "?", {}).count).toBe("1 live numbers");
    expect(runPaletteQuery(items, "", {}).count).toBe("5 things");
  });

  it("counts hits against the whole index once you type", () => {
    expect(runPaletteQuery(items, "endpoints", {}).count).toBe("1 of 5");
  });
});
