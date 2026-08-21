/**
 * ownershipModel.test.ts — pins the five counters and the lists behind them.
 *
 * The counters are the page's argument: it leads with what is MISSING before
 * it shows a total. Every one is derived from the same object list, so a wrong
 * derivation produces a confident wrong number AND a wrong panel under it, with
 * nothing else on the page to disagree. These cases pin the seeded values.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OWN_ESC_DAYS_SEED, OWN_PEOPLE_SEED } from "./settingsData";
import { MISSING_OBJECTS, OWN_OBJECTS, ROUTING_RULES } from "./ownershipData";
import {
  acceptanceOf,
  activeDelegations,
  addToRows,
  addedObject,
  allObjects,
  allObjectsWith,
  assignAcceptLabel,
  cellMark,
  cellTitle,
  counterOn,
  counters,
  coverageRows,
  coverLine,
  customObject,
  delNote,
  delegationFor,
  delegationOn,
  deliveryLine,
  deliverySent,
  escLateCount,
  escLine,
  escalationLate,
  escalationOf,
  gapRows,
  gapsOf,
  groupedByType,
  handoverBlocked,
  handoverSubmitLabel,
  isLate,
  isNamedOn,
  loadRows,
  loadWarnRows,
  matrixMeta,
  nextPanel,
  noRowsLine,
  ownerOf,
  personCounts,
  personDelText,
  priorHolders,
  provLine,
  provenanceOf,
  riskButtonLabel,
  routingLabel,
  routingRuleLive,
  rowDetailDrives,
  rowDrivesLabel,
  rowRoleDuties,
  rowSub,
  shownObjects,
  sodRows,
  type Delegation,
} from "./ownershipModel";

const obj = (id: string) => {
  const o = OWN_OBJECTS.find((x) => x.id === id);
  if (!o) throw new Error(`no seeded object ${id}`);
  return o;
};
const person = (id: string) => {
  const p = OWN_PEOPLE_SEED.find((x) => x.id === id);
  if (!p) throw new Error(`no seeded person ${id}`);
  return p;
};

describe("ownerOf", () => {
  it("reads the fixture when there is no override", () => {
    assert.equal(ownerOf(obj("svc-exo"), "r"), "priya");
  });

  it("treats an override of empty string as a REAL clear, not a miss", () => {
    // The whole un-assign flow depends on this: `?? obj[k]` would silently
    // restore the fixture's owner and the gap would never appear.
    assert.equal(ownerOf(obj("svc-exo"), "r", { "svc-exo:r": "" }), "");
  });

  it("applies a replacement override", () => {
    assert.equal(ownerOf(obj("svc-exo"), "r", { "svc-exo:r": "marcus" }), "marcus");
  });
});

describe("gapsOf", () => {
  it("names the missing roles in column order", () => {
    assert.deepEqual(gapsOf(obj("svc-copilot")), ["Responsible"]);
    assert.deepEqual(gapsOf(obj("CR-0149")), ["Accountable"]);
    assert.deepEqual(gapsOf(obj("ANN-teams-recap")), ["Informed"]);
  });

  it("returns nothing for a fully owned row", () => {
    assert.deepEqual(gapsOf(obj("svc-exo")), []);
  });

  it("returns all four for a row promoted from the coverage list", () => {
    const added = addedObject("CR-0151");
    assert.ok(added);
    assert.deepEqual(gapsOf(added), ["Responsible", "Accountable", "Consulted", "Informed"]);
  });
});

describe("the gaps counter and its panel", () => {
  it("counts the six seeded gaps", () => {
    const rows = gapRows(OWN_OBJECTS, {}, {});
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["ANN-copilot", "ANN-share", "ANN-teams-recap", "CR-0149", "RSK-004", "svc-copilot"],
    );
  });

  it("uses the written consequence where one exists", () => {
    const rows = gapRows(OWN_OBJECTS, {}, {});
    const copilot = rows.find((r) => r.id === "svc-copilot");
    assert.equal(
      copilot?.risk,
      "Every Copilot change lands with nobody to action it, and the pilot group has no route to ask.",
    );
  });

  it("generates the fallback sentence where none does", () => {
    // ANN-teams-recap has no GAP_RISK entry, so the sentence is built.
    const rows = gapRows(OWN_OBJECTS, {}, {});
    const ann = rows.find((r) => r.id === "ANN-teams-recap");
    assert.equal(ann?.risk, "No informed named.");
    assert.equal(ann?.action, "Assign informed");
    assert.equal(ann?.roleKey, "i");
  });

  it("drops an object recorded as knowingly unowned", () => {
    const rows = gapRows(OWN_OBJECTS, {}, { "svc-copilot": "accepted Priya, 20 Aug" });
    assert.ok(!rows.some((r) => r.id === "svc-copilot"));
  });

  it("counts a NEW gap created by clearing an owner", () => {
    const rows = gapRows(OWN_OBJECTS, { "svc-exo:r": "" }, {});
    assert.ok(rows.some((r) => r.id === "svc-exo"));
  });
});

describe("the duty-conflict counter", () => {
  it("flags responsible and accountable being the same person", () => {
    // CE-AUTH has Shane McCaw in both.
    const rows = sodRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    const same = rows.find((r) => r.id === "CE-AUTH:same");
    assert.ok(same);
    assert.match(same.detail, /Shane McCaw would be approving their own work/);
    assert.equal(same.action, "Split it");
  });

  it("flags a Group holding Responsible, because one person has to do it", () => {
    // INC-2274 has the Service desk group as Responsible.
    const rows = sodRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    const kind = rows.find((r) => r.id === "INC-2274:kind");
    assert.ok(kind);
    assert.match(kind.detail, /Responsible is a group \(Service desk\)/);
    assert.equal(kind.action, "Name a person");
  });

  it("flags one person accountable for more than HALF the estate", () => {
    // Dan Whitlock is accountable for 14 of the 24 seeded objects — the next
    // highest is Priya on 4. This is the seeded estate's headline conflict.
    const rows = sodRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    const load = rows.find((r) => r.id === "dan:load");
    assert.ok(load, "Dan holds a majority of Accountable and must be flagged");
    assert.match(load.detail, /Accountable for 14 of 24 objects/);
    assert.equal(load.kind, "people");
  });

  it("flags ONLY the over-concentrated person, not everyone with a few", () => {
    const rows = sodRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    const loadRowIds = rows.filter((r) => r.kind === "people").map((r) => r.id);
    assert.deepEqual(loadRowIds, ["dan:load"]);
  });

  it("uses a STRICT majority — exactly half is not a conflict", () => {
    const two = [obj("svc-exo"), obj("svc-teams")];
    // dan is accountable for both -> 2/2 = 1.0, flagged.
    assert.ok(sodRows(two, {}, OWN_PEOPLE_SEED).some((r) => r.id === "dan:load"));
    // Clear one, and dan holds exactly 1/2 = 0.5, which is NOT > 0.5.
    assert.ok(!sodRows(two, { "svc-teams:a": "" }, OWN_PEOPLE_SEED).some((r) => r.id === "dan:load"));
  });
});

describe("the carrying-too-much counter", () => {
  it("flags only away + no deputy + still responsible", () => {
    // Marcus is away ("Back 22 September") but HAS a deputy (priya), so the
    // seeded estate warns about nobody. That zero is the correct answer, and
    // pinning it stops a looser check quietly inventing warnings.
    assert.deepEqual(loadWarnRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED), []);
  });

  it("warns once cover is removed from someone away and responsible", () => {
    const noCover = OWN_PEOPLE_SEED.map((p) => (p.id === "marcus" ? { ...p, deputy: "" } : p));
    const rows = loadWarnRows(OWN_OBJECTS, {}, noCover);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Marcus Lee");
    assert.equal(rows[0].detail, "Away with no cover, and still responsible for live work.");
  });

  it("does not warn about someone away with no cover who is responsible for nothing", () => {
    const idleAway = OWN_PEOPLE_SEED.map((p) =>
      p.id === "ruth" ? { ...p, away: "Back Monday", deputy: "" } : p,
    );
    assert.ok(!loadWarnRows(OWN_OBJECTS, {}, idleAway).some((w) => w.name === "Ruth Okafor"));
  });
});

describe("the not-in-the-matrix counter", () => {
  it("starts at the four seeded coverage items", () => {
    assert.equal(coverageRows([]).length, MISSING_OBJECTS.length);
    assert.equal(coverageRows([]).length, 4);
  });

  it("drops one once it has been given a row", () => {
    assert.ok(!coverageRows(["CR-0151"]).some((c) => c.id === "CR-0151"));
  });

  it("giving something a row RAISES the gap count — a row is not an owner", () => {
    const before = gapRows(allObjects([]), {}, {}).length;
    const after = gapRows(allObjects(["CR-0151"]), {}, {}).length;
    assert.equal(after, before + 1);
  });
});

describe("counters", () => {
  it("singularises only the two labels that have a singular", () => {
    const one = counters({ gaps: 1, sod: 1, load: 1, coverage: 1, total: 1 });
    assert.equal(one[0].label, "ownership gap");
    assert.equal(one[1].label, "duty conflict");
    assert.equal(one[2].label, "carrying too much");
    assert.equal(one[3].label, "not in the matrix");
    assert.equal(one[4].label, "objects owned here");
  });

  it("pluralises at zero as well as at many", () => {
    const none = counters({ gaps: 0, sod: 0, load: 0, coverage: 0, total: 0 });
    assert.equal(none[0].label, "ownership gaps");
    assert.equal(none[1].label, "duty conflicts");
  });

  it("is always exactly five, which is what lets the row be a fixed 5-column grid", () => {
    assert.equal(counters({ gaps: 3, sod: 2, load: 0, coverage: 4, total: 23 }).length, 5);
  });
});

describe("counter selection", () => {
  it("lights the total when no panel is open, so exactly one box is always lit", () => {
    assert.equal(counterOn("all", null), true);
    assert.equal(counterOn("gaps", null), false);
  });

  it("moves the light to whichever panel is open", () => {
    assert.equal(counterOn("gaps", "gaps"), true);
    assert.equal(counterOn("all", "gaps"), false);
  });

  it("toggles a panel off when its own box is clicked again", () => {
    assert.equal(nextPanel("gaps", null), "gaps");
    assert.equal(nextPanel("gaps", "gaps"), null);
  });

  it("makes the total a close-everything button rather than a fifth panel", () => {
    assert.equal(nextPanel("all", "sod"), null);
    assert.equal(nextPanel("all", null), null);
  });
});

describe("acceptance and the escalation clock", () => {
  it("gives Consulted and Informed no acceptance state at all", () => {
    assert.equal(acceptanceOf("svc-exo", "c"), "");
    assert.equal(acceptanceOf("svc-exo", "i"), "");
  });

  it("marks the five seeded cells pending and everything else accepted", () => {
    assert.equal(acceptanceOf("svc-entra", "r"), "pending");
    assert.equal(acceptanceOf("svc-exo", "r"), "accepted");
  });

  it("is late only STRICTLY past the threshold", () => {
    assert.equal(escalationOf("CR-0142", "a"), 7);
    assert.equal(isLate("CR-0142", "a", OWN_ESC_DAYS_SEED), true);
    assert.equal(isLate("MC1049877", "r", OWN_ESC_DAYS_SEED), false);
    // Exactly at the threshold is NOT late.
    assert.equal(isLate("CR-0142", "a", 7), false);
    assert.equal(isLate("CR-0142", "a", 6), true);
  });

  it("raising the escalation days in Settings clears a late mark", () => {
    assert.equal(isLate("ANN-teams-recap", "r", 5), true);
    assert.equal(isLate("ANN-teams-recap", "r", 10), false);
  });
});

describe("cellMark", () => {
  it("ranks late above pending above away", () => {
    // CR-0142:a is both pending AND 7 days late -> late wins.
    assert.equal(cellMark({ objectId: "CR-0142", k: "a", person: person("dan"), escDays: 5 }), "late");
  });

  it("shows pending when not late", () => {
    assert.equal(cellMark({ objectId: "svc-entra", k: "r", person: person("shane"), escDays: 5 }), "pending");
  });

  it("shows away only when neither late nor pending", () => {
    // MC1042318:r is Marcus, who is away, and has no pending/escalation entry.
    assert.equal(cellMark({ objectId: "MC1042318", k: "r", person: person("marcus"), escDays: 5 }), "away");
  });

  it("marks nothing on an empty cell", () => {
    assert.equal(cellMark({ objectId: "svc-copilot", k: "r", person: null, escDays: 5 }), null);
  });
});

describe("cellTitle", () => {
  it("says who nobody is, for a gap", () => {
    assert.equal(
      cellTitle({ obj: obj("svc-copilot"), k: "r", roleLabel: "Responsible", person: null, escDays: 5 }),
      "Nobody is responsible for this",
    );
  });

  it("states provenance, and defaults it where the fixture has none", () => {
    assert.equal(
      cellTitle({ obj: obj("svc-exo"), k: "r", roleLabel: "Responsible", person: person("priya"), escDays: 5 }),
      "Priya Raman — set by Shane McCaw on 12 Aug 2026",
    );
  });

  it("stacks away, not-accepted and the clock in one sentence", () => {
    const t = cellTitle({
      obj: obj("MC1049877"),
      k: "r",
      roleLabel: "Responsible",
      person: person("marcus"),
      escDays: 2,
    });
    assert.match(t, /away, Back 22 September/);
    assert.match(t, /has not accepted yet/);
    assert.match(t, /3 days with no movement/);
    assert.match(t, /set by Priya Raman on 18 Aug 2026/);
  });
});

describe("provenanceOf", () => {
  it("falls back to the initial-scan record", () => {
    assert.deepEqual(provenanceOf("svc-teams", "r"), {
      by: "Shane McCaw",
      at: "12 Aug 2026",
      why: "Initial matrix, built from the tenant scan",
      from: "12 Aug 2026",
    });
  });

  it("keeps a per-cell reason where one is recorded", () => {
    assert.equal(
      provenanceOf("MC1042318", "r").why,
      "Marcus owns the Bay 3 hardware, so he owns this one, not Exchange as a whole",
    );
  });
});

describe("filtering", () => {
  it("filters by type", () => {
    const shown = shownObjects(OWN_OBJECTS, {}, "service", null);
    assert.equal(shown.length, 6);
    assert.ok(shown.every((o) => o.type === "service"));
  });

  it("filters by person across ALL FOUR roles, not just responsible", () => {
    // Aisha is Informed on svc-entra, not Responsible for it.
    const shown = shownObjects(OWN_OBJECTS, {}, "all", "aisha");
    assert.ok(shown.some((o) => o.id === "svc-entra"));
    assert.ok(isNamedOn(obj("svc-entra"), "aisha"));
  });

  it("combines both filters", () => {
    // All four controls name Aisha somewhere — three as Responsible or
    // Consulted, and RSK-004 as Informed, which is exactly why the person
    // filter has to read all four cells and not just the work ones.
    const shown = shownObjects(OWN_OBJECTS, {}, "control", "aisha");
    assert.deepEqual(shown.map((o) => o.id).sort(), ["CE-AUTH", "CMP-011", "ISO-A942", "RSK-004"]);
  });

  it("drops an empty category rather than rendering a bare header", () => {
    const groups = groupedByType(shownObjects(OWN_OBJECTS, {}, "freeze", null), {});
    assert.equal(groups.length, 1);
    assert.equal(groups[0].type.key, "freeze");
  });

  it("states 'fully owned' rather than leaving the meta blank", () => {
    const groups = groupedByType(shownObjects(OWN_OBJECTS, {}, "freeze", null), {});
    assert.equal(groups[0].meta, "2 · fully owned");
  });

  it("counts gaps per category", () => {
    const groups = groupedByType(shownObjects(OWN_OBJECTS, {}, "announce", null), {});
    assert.equal(groups[0].meta, "3 · 3 with a gap");
  });
});

describe("rowSub", () => {
  it("shows the object's own sub-line normally", () => {
    assert.equal(rowSub(obj("svc-copilot"), {}), "No licences assigned · pilot only");
  });

  it("replaces it once the gap is a recorded decision", () => {
    assert.equal(
      rowSub(obj("svc-copilot"), { "svc-copilot": "accepted Priya, 20 Aug" }),
      "Unowned by choice · accepted Priya, 20 Aug",
    );
  });
});

describe("the load sidebar", () => {
  it("lists only people who are actually named on something", () => {
    const rows = loadRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED, "");
    assert.ok(rows.every((r) => OWN_OBJECTS.some((o) => isNamedOn(o, r.person.id))));
  });

  it("counts R and A separately, which is what makes the concentration visible", () => {
    // Dan does none of the work and answers for most of it: R on 0, A on 14.
    // A single combined "named on N" number would hide exactly that shape.
    const rows = loadRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED, "");
    const dan = rows.find((r) => r.person.id === "dan");
    assert.ok(dan);
    assert.equal(dan.r, 0);
    assert.equal(dan.a, 14);
    assert.equal(dan.meta, "R on 0 · A on 14");
  });

  it("searches name and role, case-insensitively", () => {
    assert.equal(loadRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED, "priya").length, 1);
    assert.ok(loadRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED, "compliance").some((r) => r.person.id === "aisha"));
    assert.equal(loadRows(OWN_OBJECTS, {}, OWN_PEOPLE_SEED, "nobody at all").length, 0);
  });
});

describe("personCounts", () => {
  it("gives the four RACI totals for one person", () => {
    const counts = personCounts(OWN_OBJECTS, {}, "dan");
    assert.deepEqual(
      counts.map((c) => [c.role.k, c.value]),
      [
        ["r", "0"],
        ["a", "14"],
        ["c", "0"],
        ["i", "2"],
      ],
    );
  });
});

describe("copy", () => {
  it("states the shown/total split on the matrix header", () => {
    assert.equal(matrixMeta(6, 23), "6 of 23 shown · click any name to change it");
  });

  it("says something different when a person filter is on and empty", () => {
    assert.equal(noRowsLine("Ruth Okafor"), "Ruth Okafor is not named on anything in this category.");
    assert.equal(noRowsLine(null), "Nothing in this category yet — add a row and give it four names.");
  });
});

/* ── Part 10: the assign slide-over, delegation, routing and row detail ──── */

describe("acceptance and provenance overrides", () => {
  it("lets a local override win over the seeded acceptance", () => {
    assert.equal(acceptanceOf("svc-exo", "r", {}), "accepted");
    assert.equal(acceptanceOf("svc-exo", "r", { "svc-exo:r": "pending" }), "pending");
    // Consulted still carries none, override or not.
    assert.equal(acceptanceOf("svc-exo", "c", { "svc-exo:c": "pending" }), "");
  });

  it("lets a provenance override win over fixture and default", () => {
    const ov = { "svc-exo:r": { by: "Priya Raman", at: "20 Aug 2026", why: "Changed on the ownership page", from: "20 Aug 2026" } };
    assert.equal(provenanceOf("svc-exo", "r", ov).by, "Priya Raman");
    assert.equal(provenanceOf("svc-exo", "r", ov).why, "Changed on the ownership page");
  });

  it("threads the acceptance override into the cell mark", () => {
    // Priya is not away and svc-exo:r is normally accepted -> no mark; a pending
    // override makes the same cell read as not accepted.
    assert.equal(cellMark({ objectId: "svc-exo", k: "r", person: person("priya"), escDays: 5 }), null);
    assert.equal(
      cellMark({ objectId: "svc-exo", k: "r", person: person("priya"), escDays: 5, accOv: { "svc-exo:r": "pending" } }),
      "pending",
    );
  });
});

describe("the assign slide-over surface", () => {
  it("prints the one-line provenance, with the effective date only when it differs", () => {
    assert.equal(
      provLine(provenanceOf("svc-teams", "r")),
      "Set by Shane McCaw on 12 Aug 2026 — Initial matrix, built from the tenant scan",
    );
    assert.equal(
      provLine(provenanceOf("MC1049877", "r")),
      "Set by Priya Raman on 18 Aug 2026 · effective 1 Sep 2026 — Sales tenders are the only thing affected and Marcus holds the tenant setting",
    );
  });

  it("labels the acceptance chip: pending, a recorded date, or nothing", () => {
    assert.equal(assignAcceptLabel("svc-entra", "r", "shane"), "Not accepted yet");
    assert.equal(assignAcceptLabel("svc-exo", "r", "priya"), "Accepted 12 Aug");
    assert.equal(assignAcceptLabel("svc-teams", "a", "dan"), "Accepted");
    assert.equal(assignAcceptLabel("svc-exo", "c", "shane"), "");
    assert.equal(assignAcceptLabel("svc-copilot", "r", ""), "");
  });

  it("shows the away/cover line only when the named person is away", () => {
    assert.equal(coverLine(person("marcus"), person("priya")), "Marcus Lee is away — back 22 september. Priya Raman covers.");
    assert.equal(coverLine(person("priya"), null), "");
  });

  it("states the escalation clock, or that nothing is waiting", () => {
    assert.equal(escLine(7, 5), "7 days with no movement. Escalates to the accountable name at 5.");
    assert.equal(escLine(0, 5), "Nothing waiting. The clock starts when a decision or approval lands here.");
  });

  it("reads the Informed delivery, and only for Informed", () => {
    assert.equal(deliveryLine("svc-exo", "i"), "Sent 13 Aug 2026 · opened by 3 of 4 · Legacy auth notice to the service desk");
    assert.equal(deliverySent("svc-exo"), true);
    assert.equal(deliveryLine("ANN-share", "i"), "Drafted, never sent — nothing has reached anyone.");
    assert.equal(deliverySent("ANN-share"), false);
    assert.equal(deliveryLine("svc-teams", "i"), "Nothing has been sent to the informed name for this yet.");
    assert.equal(deliveryLine("svc-exo", "r"), "");
  });

  it("labels the risk button both ways", () => {
    assert.equal(riskButtonLabel(false), "Accept it unowned");
    assert.equal(riskButtonLabel(true), "Unowned by choice — remove that");
  });

  it("lists who held it before, in from–to form", () => {
    assert.deepEqual(priorHolders("svc-exo", "r"), [
      { who: "Dan Whitlock", when: "Jan 2026 – 12 Aug 2026", why: "Held it while the IT manager role was vacant" },
    ]);
    assert.deepEqual(priorHolders("svc-teams", "r"), []);
  });
});

describe("delegation", () => {
  const dels: Delegation[] = [{ from: "priya", to: "marcus", until: "22 September", scope: "all", done: false }];

  it("finds the live handover from a person, and drops done ones", () => {
    assert.equal(delegationFor(dels, "priya")?.to, "marcus");
    assert.equal(delegationFor(dels, "dan"), null);
    assert.deepEqual(activeDelegations([{ from: "a", to: "b", until: "x", scope: "all", done: true }]), []);
  });

  it("respects scope when deciding whether a handover covers an object", () => {
    assert.ok(delegationOn(dels, obj("svc-exo"), "priya"));
    const scoped: Delegation[] = [{ from: "priya", to: "marcus", until: "x", scope: "service", done: false }];
    assert.ok(delegationOn(scoped, obj("svc-exo"), "priya"));
    assert.equal(delegationOn(scoped, obj("CR-0142"), "priya"), null);
  });

  it("writes the assign-slide-over note and the person-band chip", () => {
    assert.equal(delNote(dels, obj("svc-exo"), "priya", OWN_PEOPLE_SEED), "Handed to Marcus Lee until 22 September.");
    assert.equal(delNote(dels, obj("svc-exo"), "dan", OWN_PEOPLE_SEED), "");
    assert.equal(personDelText(dels, "priya", OWN_PEOPLE_SEED), "Handed to Marcus Lee until 22 September");
    assert.equal(
      personDelText([{ from: "priya", to: "marcus", until: "x", scope: "service", done: false }], "priya", OWN_PEOPLE_SEED),
      "Handed to Marcus Lee until x · service only",
    );
  });
});

describe("the escalation clock and routing rules", () => {
  it("lists every cell past the clock, using the object name", () => {
    const late = escalationLate(OWN_OBJECTS, {}, 5);
    assert.deepEqual(
      late.map((e) => [e.name, e.days, e.role]),
      [
        ["Disable legacy auth ahead of Microsoft", 7, "Accountable"],
        ["Teams toolbar and recap tab", 6, "Responsible"],
      ],
    );
    assert.equal(escLateCount(OWN_OBJECTS, {}, 5), 2);
    assert.equal(escLateCount(OWN_OBJECTS, {}, 10), 0);
  });

  it("generates the escalate rule live line and passes the rest through", () => {
    const escLate = escalationLate(OWN_OBJECTS, {}, 5);
    const escRule = ROUTING_RULES.find((r) => r.k === "escalate")!;
    assert.equal(
      routingRuleLive(escRule, 5, escLate),
      "Nothing moves for 5 days and it goes to the accountable name. 2 past it now: Disable legacy auth ahead (7d), Teams toolbar and recap (6d)",
    );
    const decRule = ROUTING_RULES.find((r) => r.k === "decisions")!;
    assert.equal(routingRuleLive(decRule, 5, escLate), decRule.live);
  });

  it("counts the live rules in the routing label", () => {
    assert.equal(routingLabel({ decisions: true, approvals: true, consulted: true, informed: true, digest: true, escalate: true }), "Routing · 6 of 6");
    assert.equal(routingLabel({ decisions: true, approvals: false, consulted: true, informed: true, digest: true, escalate: true }), "Routing · 5 of 6");
  });
});

describe("assign to more, handover and add-a-row", () => {
  it("offers only objects a person is not already named on, with the short type", () => {
    const rows = addToRows(OWN_OBJECTS, "ruth", {});
    assert.ok(!rows.some((r) => r.id === "svc-spo")); // ruth is consulted there
    const cr = rows.find((r) => r.id === "CR-0142");
    assert.ok(cr);
    assert.equal(cr.type, "CR");
  });

  it("blocks and labels the handover submit as the two fields fill", () => {
    assert.equal(handoverBlocked("", ""), true);
    assert.equal(handoverBlocked("marcus", "  "), true);
    assert.equal(handoverBlocked("marcus", "22 September"), false);
    assert.equal(handoverSubmitLabel("", ""), "Pick who covers");
    assert.equal(handoverSubmitLabel("marcus", ""), "Give it an end date");
    assert.equal(handoverSubmitLabel("marcus", "22 September"), "Start the handover");
  });

  it("builds a custom row with four gaps and appends it to the list", () => {
    const c = customObject({ id: "own-x", type: "service", name: "Power BI workspaces", sub: "" });
    assert.equal(c.sub, "Added by hand · nobody named yet");
    assert.deepEqual([c.r, c.a, c.c, c.i], ["", "", "", ""]);
    assert.equal(allObjectsWith([], [{ id: "own-x", type: "service", name: "N", sub: "s" }]).length, OWN_OBJECTS.length + 1);
  });
});

describe("row detail", () => {
  it("gives a service the changes it drives, and whether each inherits its owner", () => {
    const drives = rowDetailDrives(obj("svc-exo"), OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    assert.deepEqual(drives, [
      { id: "MC1042318", name: "Basic authentication disabled", when: "1 October 2026", own: "Marcus Lee", inherits: "has its own owner" },
    ]);
    assert.equal(rowDrivesLabel("service"), "What these names cover");
  });

  it("points a change back at the service its names come from", () => {
    const drives = rowDetailDrives(obj("MC1042318"), OWN_OBJECTS, {}, OWN_PEOPLE_SEED);
    assert.deepEqual(drives, [
      { id: "svc-exo", name: "Exchange Online & Apps", when: "service default", own: "Priya Raman", inherits: "where these names come from" },
    ]);
    assert.equal(rowDrivesLabel("change"), "Where these names come from");
  });

  it("drives nothing for a control, and names the per-role duties", () => {
    assert.deepEqual(rowDetailDrives(obj("CE-AUTH"), OWN_OBJECTS, {}, OWN_PEOPLE_SEED), []);
    assert.equal(rowRoleDuties("service", "r")[0], "Reads every Microsoft notice for this service against the tenant");
    assert.equal(rowRoleDuties("cr", "a")[0], "Approves it — nothing moves without this name");
  });
});
