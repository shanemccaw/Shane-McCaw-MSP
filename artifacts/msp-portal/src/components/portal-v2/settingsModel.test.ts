/**
 * settingsModel.test.ts — pins every derived value on the Settings page.
 *
 * The page has no API behind it yet, so nothing else in the build would catch a
 * transcription slip in these: a wrong signature count in `ccMasterNote` or a
 * miscounted "outside" in `ownPeopleFoot` would render as a confident sentence
 * with nothing on the page to contradict it. Each case below is checked against
 * the prototype's own output for the seeded fixture, not against a value
 * re-derived here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CC_POLICY_SEED,
  OWN_PEOPLE_SEED,
  type OwnPerson,
} from "./settingsData";
import {
  awayLabel,
  ccMasterNote,
  ccMasterTitle,
  cycleDeputy,
  cycleKind,
  cycleSide,
  deptSrcLabel,
  deputyLabel,
  initialsOf,
  newOwnPerson,
  ownPeopleFoot,
  routingRuleOn,
  toggleApprover,
  toggleAway,
} from "./settingsModel";

const byId = (id: string): OwnPerson => {
  const p = OWN_PEOPLE_SEED.find((x) => x.id === id);
  if (!p) throw new Error(`no seeded person ${id}`);
  return p;
};

describe("ownPeopleFoot", () => {
  it("splits the seeded nine into 7 at Halden and 2 outside", () => {
    // Shane McCaw is MSP and R. Court is External, so "outside" is TWO, not one
    // — the count folds both non-Halden sides together (prototype 19996).
    assert.equal(ownPeopleFoot(OWN_PEOPLE_SEED), "9 people · 7 at Halden, 2 outside");
  });

  it("counts an empty list without dividing by anything", () => {
    assert.equal(ownPeopleFoot([]), "0 people · 0 at Halden, 0 outside");
  });
});

describe("awayLabel", () => {
  it("prints the return date verbatim when someone is away", () => {
    assert.equal(awayLabel(byId("marcus")), "Back 22 September");
  });

  it("prints Available for an empty away field", () => {
    assert.equal(awayLabel(byId("priya")), "Available");
  });
});

describe("deputyLabel", () => {
  it("takes the FIRST WORD of the deputy's name", () => {
    assert.equal(deputyLabel(byId("priya"), OWN_PEOPLE_SEED), "Cover · Marcus");
  });

  it("truncates a two-word group the same way", () => {
    // Jo's deputy is the Service desk group — "Cover · Service", not "Service desk".
    assert.equal(deputyLabel(byId("jo"), OWN_PEOPLE_SEED), "Cover · Service");
  });

  it("says No cover when the field is empty", () => {
    assert.equal(deputyLabel(byId("aisha"), OWN_PEOPLE_SEED), "No cover");
  });

  it("falls back to No cover when the deputy has been removed", () => {
    const without = OWN_PEOPLE_SEED.filter((p) => p.id !== "marcus");
    assert.equal(deputyLabel(byId("priya"), without), "No cover");
  });
});

describe("cycleSide / cycleKind", () => {
  it("advances one place and wraps at the end", () => {
    assert.equal(cycleSide("Halden"), "MSP");
    assert.equal(cycleSide("MSP"), "External");
    assert.equal(cycleSide("External"), "Halden");
  });

  it("cycles kind through Person, Group, Vendor", () => {
    assert.equal(cycleKind("Person"), "Group");
    assert.equal(cycleKind("Group"), "Vendor");
    assert.equal(cycleKind("Vendor"), "Person");
  });
});

describe("toggleAway", () => {
  it("clears an existing away note", () => {
    assert.equal(toggleAway(byId("marcus")), "");
  });

  it("writes the default note when turning away on", () => {
    assert.equal(toggleAway(byId("priya")), "Away, back in a week");
  });
});

describe("cycleDeputy", () => {
  it("skips Groups and Vendors — only a Person can be cover", () => {
    // Candidates for Priya: the six other Persons, then "". `desk` (Group) and
    // `court` (Vendor) never appear.
    const seen: string[] = [];
    let cur = byId("priya");
    for (let i = 0; i < 8; i++) {
      const next = cycleDeputy(cur, OWN_PEOPLE_SEED);
      seen.push(next);
      cur = { ...cur, deputy: next };
    }
    assert.ok(!seen.includes("desk"), "a Group must never be offered as cover");
    assert.ok(!seen.includes("court"), "a Vendor must never be offered as cover");
  });

  it("offers no-cover as a real stop in the cycle", () => {
    assert.ok(cycleDeputy({ ...byId("priya"), deputy: "shane" }, OWN_PEOPLE_SEED) === "");
  });

  it("wraps from no-cover back to the first eligible person", () => {
    assert.equal(cycleDeputy({ ...byId("priya"), deputy: "" }, OWN_PEOPLE_SEED), "dan");
  });

  it("starts from the beginning when the current deputy is not an eligible candidate", () => {
    // Jo's seeded deputy is `desk`, a Group. indexOf is -1, so (-1+1)%len === 0.
    // Pinned because it is the prototype's behaviour (19990), not an accident
    // of this port — see the note on cycleDeputy.
    assert.equal(cycleDeputy(byId("jo"), OWN_PEOPLE_SEED), "priya");
  });
});

describe("newOwnPerson", () => {
  it("carries EVERY field the row renders, including the three the prototype omits", () => {
    // The prototype pushes only { id, name, role, side }, which renders a blank
    // kind button in the wrong colour — the same blank-label defect Round Two
    // fixed on the runbook step list. Fixed here on purpose.
    const p = newOwnPerson("p1");
    assert.deepEqual(p, {
      id: "p1",
      name: "New person",
      role: "Role",
      side: "Halden",
      kind: "Person",
      away: "",
      deputy: "",
    });
  });

  it("renders a non-empty kind label and no cover", () => {
    const p = newOwnPerson("p1");
    assert.equal(p.kind, "Person");
    assert.equal(awayLabel(p), "Available");
    assert.equal(deputyLabel(p, [p]), "No cover");
  });
});

describe("routingRuleOn", () => {
  it("treats an absent key as ON, so the empty seed leaves all six live", () => {
    assert.equal(routingRuleOn({}, "notify"), true);
  });

  it("only an explicit false turns a rule off", () => {
    assert.equal(routingRuleOn({ notify: false }, "notify"), false);
    assert.equal(routingRuleOn({ notify: true }, "notify"), true);
  });
});

describe("ccMasterTitle / ccMasterNote", () => {
  it("states the signature count from the policy, not a fixed number", () => {
    assert.equal(ccMasterTitle(CC_POLICY_SEED), "Change control is on");
    assert.equal(
      ccMasterNote(CC_POLICY_SEED),
      "Nothing this portal can execute runs without a change request behind it and 2 signatures on the record.",
    );
  });

  it("rewrites the sentence when the signature count changes", () => {
    assert.match(ccMasterNote({ ...CC_POLICY_SEED, approvals: 3 }), /and 3 signatures/);
  });

  it("switches to the off copy, which still promises the record", () => {
    const off = { ...CC_POLICY_SEED, on: false };
    assert.equal(ccMasterTitle(off), "Change control is off");
    assert.equal(
      ccMasterNote(off),
      "Actions run the moment you click them. Each one still lands in the register marked run without approval, so the history stays complete.",
    );
  });
});

describe("toggleApprover", () => {
  it("adds an id that is not on the band", () => {
    assert.deepEqual(toggleApprover(["dw", "pr"], "sm"), ["dw", "pr", "sm"]);
  });

  it("removes an id that is", () => {
    assert.deepEqual(toggleApprover(["dw", "pr"], "dw"), ["pr"]);
  });

  it("can empty a band completely — the design offers no floor", () => {
    assert.deepEqual(toggleApprover(["dw"], "dw"), []);
  });
});

describe("initialsOf", () => {
  it("keeps only the parts that start with a capital", () => {
    assert.equal(initialsOf("Priya Raman"), "PR");
    // "desk" is lowercase, so it is skipped rather than initialised.
    assert.equal(initialsOf("Service desk"), "S");
  });

  it("splits on middots as well as spaces", () => {
    assert.equal(initialsOf("R. Court"), "RC");
  });

  it("falls back to an em-dash when nothing qualifies", () => {
    assert.equal(initialsOf(""), "—");
    assert.equal(initialsOf("service desk"), "—");
  });
});

describe("deptSrcLabel", () => {
  it("distinguishes a mapped group from the Entra attribute", () => {
    assert.equal(deptSrcLabel("group"), "Set by group");
    assert.equal(deptSrcLabel("attribute"), "From the attribute");
  });
});
