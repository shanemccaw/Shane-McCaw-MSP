/**
 * ownershipWire.test.ts — pins the seam between the endpoint and the matrix.
 *
 * This file is small, and every case in it guards the same class of mistake:
 * the page rendering a CLAIM ABOUT OWNERSHIP that the data did not make.
 *
 * The matrix draws an empty cell as a gap and counts it — a gap is a real
 * statement ("nobody is answerable for this"), not a blank. So a payload that
 * arrives malformed, half-parsed, or empty must never reach the matrix looking
 * like data: a dropped field would read as an unowned object, and an empty
 * live read would read as a tenant that owns nothing at all. Both are
 * indistinguishable on screen from the real thing, which is exactly why they
 * are decided here, once, rather than in a component.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OWN_OBJECTS } from "./ownershipData";
import { OWN_PEOPLE_SEED, OWN_SIDES } from "./settingsData";
import {
  EMPTY_OVERLAY,
  OWNERSHIP_FIXTURE,
  toOwnObject,
  toOwnPerson,
  toOwnershipData,
  toOwnershipOverlay,
} from "./ownershipWire";

const PERSON = {
  id: "u42",
  name: "Joe Joe",
  role: "IT Manager",
  side: "Halden Materials",
  kind: "Person",
  away: "",
  deputy: "",
};

const OBJECT = {
  type: "cr",
  id: "CR-2026-103",
  name: "Disable SMTP AUTH on the scanner mailbox",
  sub: "Pending approval · Thu 27 Aug",
  r: "u39",
  a: "",
  c: "",
  i: "",
  link: "CR →",
};

function payload(over: Record<string, unknown> = {}) {
  return {
    customer: { id: 1, name: "Halden Materials" },
    sides: ["Halden Materials", "MSP", "External"],
    people: [PERSON],
    objects: [OBJECT],
    sources: [],
    currentUserId: "u42",
    currentUserName: "Joe Joe",
    tenantScoped: true,
    ...over,
  };
}

describe("toOwnObject()", () => {
  it("carries a well-formed row through unchanged", () => {
    const obj = toOwnObject(OBJECT);
    assert.equal(obj?.id, "CR-2026-103");
    assert.equal(obj?.type, "cr");
    assert.equal(obj?.r, "u39");
    assert.equal(obj?.a, "");
  });

  it("rejects a type the matrix does not group by", () => {
    // `groupedByType` walks OBJECT_TYPES, so an unknown type would vanish from
    // the matrix while still counting towards every total printed above it.
    assert.equal(toOwnObject({ ...OBJECT, type: "invoice" }), null);
  });

  it("rejects a row with no id and a row with no name", () => {
    assert.equal(toOwnObject({ ...OBJECT, id: "" }), null);
    assert.equal(toOwnObject({ ...OBJECT, name: "" }), null);
  });

  it("rejects what is not an object at all", () => {
    assert.equal(toOwnObject(null), null);
    assert.equal(toOwnObject("CR-2026-103"), null);
  });

  it("only sets the optional fields the payload actually carries", () => {
    const bare = toOwnObject(OBJECT);
    assert.equal("when" in (bare as object), false);
    assert.equal("svc" in (bare as object), false);
    assert.equal("over" in (bare as object), false);

    const change = toOwnObject({
      type: "change",
      id: "MC1458474",
      name: "Retirement of custom CSS layout",
      sub: "Microsoft Entra",
      r: "",
      a: "",
      c: "",
      i: "",
      when: "26 October 2026",
      link: "Notice →",
    });
    assert.equal(change?.when, "26 October 2026");
  });
});

describe("toOwnPerson()", () => {
  it("carries a well-formed person through unchanged", () => {
    const p = toOwnPerson(PERSON);
    assert.equal(p?.id, "u42");
    assert.equal(p?.side, "Halden Materials");
    assert.equal(p?.kind, "Person");
  });

  it("defaults an unrecognised kind to Person", () => {
    // Responsible may not be a Group ("One name, never a group") and the load
    // panel splits people from groups, so an unknown kind would quietly change
    // what the page is willing to assign.
    assert.equal(toOwnPerson({ ...PERSON, kind: "Robot" })?.kind, "Person");
    assert.equal(toOwnPerson({ ...PERSON, kind: "Vendor" })?.kind, "Vendor");
  });

  it("rejects a person with no id or no name", () => {
    assert.equal(toOwnPerson({ ...PERSON, id: "" }), null);
    assert.equal(toOwnPerson({ ...PERSON, name: "" }), null);
  });
});

describe("toOwnershipData()", () => {
  it("returns the live payload when it carries both people and objects", () => {
    const data = toOwnershipData(payload());
    assert.equal(data?.objects.length, 1);
    assert.equal(data?.people.length, 1);
    assert.equal(data?.customerName, "Halden Materials");
    assert.equal(data?.tenantScoped, true);
  });

  it("returns null for a read with no objects, so the fixture stays on screen", () => {
    // An empty matrix and a broken matrix look identical; the fixture at least
    // explains what the page is for.
    assert.equal(toOwnershipData(payload({ objects: [] })), null);
  });

  it("returns null for a read with no people", () => {
    // Every assign flow reads that list, so an empty one is a page whose
    // controls all open onto nothing.
    assert.equal(toOwnershipData(payload({ people: [] })), null);
  });

  it("returns null for a read whose rows are all malformed", () => {
    assert.equal(toOwnershipData(payload({ objects: [{ type: "invoice" }] })), null);
  });

  it("returns null for no payload at all", () => {
    assert.equal(toOwnershipData(null), null);
  });

  it("drops only the malformed rows when some are good", () => {
    const data = toOwnershipData(payload({ objects: [OBJECT, { type: "invoice" }, null] }));
    assert.equal(data?.objects.length, 1);
  });

  it("falls back to the fixture's side list when the payload sends none", () => {
    const data = toOwnershipData(payload({ sides: [], customer: { id: 1, name: "" } }));
    assert.deepEqual(data?.sides, OWN_SIDES);
  });
});

describe("OWNERSHIP_FIXTURE", () => {
  it("is the design's own estate, unchanged", () => {
    // The fallback has to stay literally the fixture: the module's standalone
    // behaviour and every existing unit assertion are written against it.
    assert.equal(OWNERSHIP_FIXTURE.objects, OWN_OBJECTS);
    assert.equal(OWNERSHIP_FIXTURE.people, OWN_PEOPLE_SEED);
    assert.equal(OWNERSHIP_FIXTURE.tenantScoped, false);
    assert.equal(OWNERSHIP_FIXTURE.overlay, EMPTY_OVERLAY);
  });
});

describe("toOwnershipOverlay()", () => {
  it("is an empty overlay for a missing or non-object block", () => {
    for (const raw of [undefined, null, "nope", 7]) {
      const ov = toOwnershipOverlay(raw);
      assert.deepEqual(ov.overrides, {});
      assert.deepEqual(ov.acceptance, {});
      assert.deepEqual(ov.provenance, {});
      assert.deepEqual(ov.delegations, []);
      assert.deepEqual(ov.customRows, []);
      assert.deepEqual(ov.addedCoverage, []);
    }
  });

  it("maps an assignment into overrides/acceptance/provenance keyed objectId:roleKey", () => {
    const ov = toOwnershipOverlay({
      assignments: [
        {
          objectId: "CR-2026-148",
          roleKey: "a",
          ownerPersonId: "u39",
          acceptance: "pending",
          setBy: "Shane McCaw",
          setAt: "21 Aug 2026",
          setWhy: "Changed on the ownership page",
        },
      ],
    });
    assert.equal(ov.overrides["CR-2026-148:a"], "u39");
    assert.equal(ov.acceptance["CR-2026-148:a"], "pending");
    assert.deepEqual(ov.provenance["CR-2026-148:a"], {
      by: "Shane McCaw",
      at: "21 Aug 2026",
      why: "Changed on the ownership page",
      from: "21 Aug 2026",
    });
  });

  it("KEEPS an empty owner — a cleared cell is a real gap, not a dropped row", () => {
    // ownerOf treats an override of "" as "cleared to a gap"; losing it here
    // would silently fall the cell back to whatever the read computed.
    const ov = toOwnershipOverlay({
      assignments: [{ objectId: "svc-9", roleKey: "r", ownerPersonId: "" }],
    });
    assert.equal(ov.overrides["svc-9:r"], "");
    assert.ok("svc-9:r" in ov.overrides);
  });

  it("drops an assignment with no objectId or a role that is not r/a/c/i", () => {
    const ov = toOwnershipOverlay({
      assignments: [
        { objectId: "", roleKey: "r", ownerPersonId: "u1" },
        { objectId: "svc-1", roleKey: "x", ownerPersonId: "u1" },
        null,
      ],
    });
    assert.deepEqual(ov.overrides, {});
  });

  it("maps a delegation and drops one missing any of from/to/until", () => {
    const ov = toOwnershipOverlay({
      delegations: [
        { fromPersonId: "u1", toPersonId: "u2", until: "22 September", scope: "cr", done: false },
        { fromPersonId: "u3", toPersonId: "", until: "1 Oct", scope: "all", done: false },
      ],
    });
    assert.equal(ov.delegations.length, 1);
    assert.deepEqual(ov.delegations[0], {
      from: "u1",
      to: "u2",
      until: "22 September",
      scope: "cr",
      done: false,
    });
  });

  it("defaults a delegation's blank scope to 'all'", () => {
    const ov = toOwnershipOverlay({
      delegations: [{ fromPersonId: "u1", toPersonId: "u2", until: "soon", scope: "" }],
    });
    assert.equal(ov.delegations[0].scope, "all");
  });

  it("splits added rows into custom rows (valid type only) and coverage ids", () => {
    const ov = toOwnershipOverlay({
      rows: [
        { rowId: "own-1", source: "custom", objType: "service", name: "Power BI", sub: "14 spaces" },
        { rowId: "own-2", source: "custom", objType: "not-a-type", name: "Bad", sub: "" },
        { rowId: "cov-x", source: "coverage" },
        { rowId: "", source: "custom", objType: "service", name: "No id" },
      ],
    });
    assert.equal(ov.customRows.length, 1);
    assert.deepEqual(ov.customRows[0], { id: "own-1", type: "service", name: "Power BI", sub: "14 spaces" });
    assert.deepEqual(ov.addedCoverage, ["cov-x"]);
  });
});
