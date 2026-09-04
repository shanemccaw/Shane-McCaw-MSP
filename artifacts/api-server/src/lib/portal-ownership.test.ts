/**
 * Tests for the pure mapping layer behind `GET /api/portal/ownership`.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *
 * WHAT THESE PIN, AND WHY IT IS THIS AND NOT THE QUERY
 * ---------------------------------------------------
 * The interesting decisions on this route are all mapping decisions, and every
 * one of them is a decision about what NOT to claim:
 *
 *   • an unrecognised requester resolves to a GAP, not to an invented person
 *   • Consulted and Informed are never filled in
 *   • a person with no job title gets a readable role, never an enum spelling
 *   • the customer's real name is the `side`, never the design's "Halden"
 *
 * Each of those is one wrong line away from a page that looks more complete
 * than the database is, which is the specific failure this route exists to
 * avoid. They are tested here rather than through the handler because they do
 * not need a tenant to be true.
 */
import { describe, it, expect } from "vitest";
import {
  actorMayRespond,
  assignEventType,
  buildSources,
  crObject,
  emailIndex,
  formatOwnDate,
  holdWindowObject,
  initialAcceptance,
  isOwnRoleKey,
  messageCentreObject,
  personIdForUser,
  personRoleLabel,
  resolvePersonId,
  serviceObject,
  sidesFor,
  toWireAssignment,
  toWireDelegation,
  toWireEvent,
  toWirePerson,
  toWireRow,
  type OwnObjectType,
  type UserRow,
  type WireOwnPerson,
} from "./portal-ownership.ts";

const USERS: UserRow[] = [
  { id: 39, email: "buyer@example.com", name: "Buy Assessment", jobTitle: null, department: null, mspRole: "CustomerUser" },
  { id: 42, email: "joe@example.com", name: "Joe Joe", jobTitle: "IT Manager", department: null, mspRole: "CustomerUser" },
  { id: 55, email: "shane@example.com", name: null, jobTitle: null, department: "Operations", mspRole: "Assessment" },
];

const PEOPLE: WireOwnPerson[] = USERS.map((u) => toWirePerson(u, "Halden Materials"));
const EMAILS = emailIndex(USERS);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

describe("toWirePerson()", () => {
  it("prefixes the id so it cannot collide with a fixture person id", () => {
    // The fallback list ("priya", "dan", "desk") can be on screen in the same
    // session, because it renders until the fetch lands.
    expect(personIdForUser(39)).toBe("u39");
    expect(PEOPLE.map((p) => p.id)).toEqual(["u39", "u42", "u55"]);
  });

  it("falls back to the email when the account has no name", () => {
    expect(PEOPLE[2]!.name).toBe("shane@example.com");
  });

  it("carries the real customer name as the side, not the design's Halden", () => {
    expect(sidesFor("Halden Materials")).toEqual(["Halden Materials", "MSP", "External"]);
    expect(sidesFor("   ")).toEqual(["Your organisation", "MSP", "External"]);
  });

  it("reports available and uncovered, because no column records either", () => {
    // "" is the prototype's own word for available — `away` holds a RETURN
    // DATE, not a boolean — so this is a real answer rather than a null.
    expect(PEOPLE.every((p) => p.away === "" && p.deputy === "")).toBe(true);
  });
});

describe("personRoleLabel()", () => {
  it("prefers a real job title", () => {
    expect(personRoleLabel("IT Manager", "Operations", "CustomerUser")).toBe("IT Manager");
  });

  it("falls back to the department before the role", () => {
    expect(personRoleLabel(null, "Operations", "CustomerUser")).toBe("Operations");
  });

  it("never prints the enum spelling of a portal role", () => {
    expect(personRoleLabel(null, null, "CustomerUser")).toBe("Team member");
    expect(personRoleLabel(null, null, "Assessment")).toBe("Assessment access");
    expect(personRoleLabel(null, null, null)).toBe("Team member");
  });

  it("labels MSP staff readably (#1520)", () => {
    expect(personRoleLabel(null, null, "MSPAdmin")).toBe("MSP Admin");
    expect(personRoleLabel(null, null, "MSPOperator")).toBe("MSP Operator");
  });
});

// ---------------------------------------------------------------------------
// The MSP's own staff on the roster — available to every cell, assigned to
// none (#1520)
// ---------------------------------------------------------------------------

describe("MSP staff as real people, side MSP", () => {
  const MSP_STAFF: UserRow[] = [
    { id: 90, email: "priya@msp.example.com", name: "Priya Raman", jobTitle: null, department: null, mspRole: "MSPAdmin" },
    { id: 91, email: "dan@msp.example.com", name: "Dan Kessler", jobTitle: null, department: null, mspRole: "MSPOperator" },
  ];
  const mspPeople = MSP_STAFF.map((u) => toWirePerson(u, "MSP"));

  it("uses the same real-person shape as a customer's own team, just a different side", () => {
    expect(mspPeople.map((p) => p.side)).toEqual(["MSP", "MSP"]);
    expect(mspPeople.map((p) => p.id)).toEqual(["u90", "u91"]);
    expect(mspPeople.map((p) => p.role)).toEqual(["MSP Admin", "MSP Operator"]);
  });

  it("id-spaces cannot collide with the customer's own roster — one users table, one id space", () => {
    const combined = [...PEOPLE, ...mspPeople];
    expect(new Set(combined.map((p) => p.id)).size).toBe(combined.length);
  });

  it("resolves by email or name identically to a customer team member, once merged onto the roster", () => {
    const combinedRows = [...USERS, ...MSP_STAFF];
    const combinedPeople = [...PEOPLE, ...mspPeople];
    const combinedEmails = emailIndex(combinedRows);
    expect(resolvePersonId("priya@msp.example.com", combinedPeople, combinedEmails)).toBe("u90");
    expect(resolvePersonId("Dan Kessler", combinedPeople, combinedEmails)).toBe("u91");
  });
});

// ---------------------------------------------------------------------------
// Resolving a stored name to a person — the invented-person guard
// ---------------------------------------------------------------------------

describe("resolvePersonId()", () => {
  it("matches the stored email, which is what the live rows actually hold", () => {
    expect(resolvePersonId("buyer@example.com", PEOPLE, EMAILS)).toBe("u39");
  });

  it("is case-insensitive, because the column is unconstrained free text", () => {
    expect(resolvePersonId("Buyer@Example.com", PEOPLE, EMAILS)).toBe("u39");
  });

  it("matches a display name too", () => {
    expect(resolvePersonId("Joe Joe", PEOPLE, EMAILS)).toBe("u42");
  });

  it("returns a GAP for someone who is not on the team", () => {
    // The important one. A matrix cell naming a person absent from the roster
    // is unactionable; an honest blank is the page's own "gap", which it counts
    // and makes loud.
    expect(resolvePersonId("someone.who.left@example.com", PEOPLE, EMAILS)).toBe("");
  });

  it("returns a gap for null and for whitespace", () => {
    expect(resolvePersonId(null, PEOPLE, EMAILS)).toBe("");
    expect(resolvePersonId("   ", PEOPLE, EMAILS)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

describe("crObject()", () => {
  const row = {
    id: 3,
    title: "Disable SMTP AUTH on the scanner mailbox",
    status: "pending_approval",
    scheduledFor: "Thu 27 Aug · 07:00–09:00",
    requestedBy: "buyer@example.com",
    approvedBy: null,
  };

  it("carries the requester as Responsible and an unsigned CR as an Accountable gap", () => {
    const obj = crObject(
      row,
      "CR-2026-103",
      "Pending approval",
      resolvePersonId(row.requestedBy, PEOPLE, EMAILS),
      resolvePersonId(row.approvedBy, PEOPLE, EMAILS),
    );
    expect(obj.r).toBe("u39");
    expect(obj.a).toBe("");
  });

  it("never guesses Consulted or Informed", () => {
    const obj = crObject(row, "CR-2026-103", "Pending approval", "u39", "");
    expect(obj.c).toBe("");
    expect(obj.i).toBe("");
  });

  it("puts the status and the booked window on the sub-line", () => {
    const obj = crObject(row, "CR-2026-103", "Pending approval", "u39", "");
    expect(obj.sub).toBe("Pending approval · Thu 27 Aug · 07:00–09:00");
    expect(obj.id).toBe("CR-2026-103");
    expect(obj.link).toBe("CR →");
  });

  it("omits the separator when no window is booked", () => {
    const obj = crObject({ ...row, scheduledFor: "" }, "CR-2026-103", "Pending approval", "u39", "");
    expect(obj.sub).toBe("Pending approval");
  });
});

describe("messageCentreObject()", () => {
  const row = {
    graphMessageId: "MC1458474",
    title: "Microsoft Entra ID: Retirement of custom CSS layout",
    category: "planForChange",
    isMajorChange: true,
    services: ["Microsoft Entra"],
    actionRequiredByDateTime: "2026-10-26T07:00:00Z",
  };

  it("keeps the Microsoft id as the row id and formats the deadline", () => {
    const obj = messageCentreObject(row);
    expect(obj.id).toBe("MC1458474");
    expect(obj.when).toBe("26 October 2026");
    expect(obj.sub).toBe("Microsoft Entra · Major change");
  });

  it("falls back to the category when it is not a major change", () => {
    const obj = messageCentreObject({ ...row, isMajorChange: false, services: [] });
    expect(obj.sub).toBe("planForChange");
  });

  it("has no owner, because nothing records one", () => {
    const obj = messageCentreObject(row);
    expect([obj.r, obj.a, obj.c, obj.i]).toEqual(["", "", "", ""]);
  });
});

describe("serviceObject() / holdWindowObject()", () => {
  it("titles a service from the catalogue and states its status", () => {
    const obj = serviceObject({ id: 7, name: "Copilot Readiness", status: "active", nextMilestone: "Pilot review" });
    expect(obj.id).toBe("svc-7");
    expect(obj.name).toBe("Copilot Readiness");
    expect(obj.sub).toBe("Active · Pilot review");
  });

  it("keeps the hold window's own stable key as the row id", () => {
    const obj = holdWindowObject({ id: 4, holdKey: "hold-ca01", title: "Guest owner confirmation", gates: "Gates step 5" });
    expect(obj.id).toBe("hold-ca01");
    expect(obj.type).toBe("freeze");
    expect(obj.sub).toBe("Gates step 5");
  });
});

describe("formatOwnDate()", () => {
  it("uses the design's own format", () => {
    expect(formatOwnDate("2026-10-01T00:00:00Z")).toBe("1 October 2026");
  });

  it("answers empty for null and for an unparseable value", () => {
    expect(formatOwnDate(null)).toBe("");
    expect(formatOwnDate("not a date")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

describe("buildSources()", () => {
  const counts: Record<OwnObjectType, number> = {
    workload: 3,
    service: 1,
    change: 15,
    cr: 7,
    freeze: 4,
    control: 0,
    incident: 0,
    announce: 0,
  };

  it("says which three types have no table rather than hiding the group", () => {
    const dead = buildSources(counts).filter((s) => !s.live).map((s) => s.type);
    expect(dead).toEqual(["control", "incident", "announce"]);
    expect(buildSources(counts).every((s) => s.note.length > 0)).toBe(true);
  });

  it("reports the real counts for the five it serves", () => {
    const live = buildSources(counts).filter((s) => s.live);
    expect(live.map((s) => [s.type, s.count])).toEqual([
      ["workload", 3],
      ["service", 1],
      ["change", 15],
      ["cr", 7],
      ["freeze", 4],
    ]);
  });
});

/**
 * The WRITE side's pure pieces — the same "never claim more than the data does"
 * rule, now applied to what a customer's own edit means.
 */
describe("isOwnRoleKey", () => {
  it("admits exactly the four RACI keys", () => {
    for (const k of ["r", "a", "c", "i"]) expect(isOwnRoleKey(k)).toBe(true);
  });
  it("rejects anything else, including near-misses and non-strings", () => {
    for (const k of ["R", "x", "", "ra", 0, null, undefined, {}]) {
      expect(isOwnRoleKey(k)).toBe(false);
    }
  });
});

describe("initialAcceptance", () => {
  it("starts a newly-named Responsible/Accountable cell as pending in strict mode — the accept clock", () => {
    expect(initialAcceptance("u39", "r", "strict")).toBe("pending");
    expect(initialAcceptance("u39", "a", "strict")).toBe("pending");
  });
  it("is effective immediately, no pending, in loose mode (#2162)", () => {
    expect(initialAcceptance("u39", "r", "loose")).toBe("");
    expect(initialAcceptance("u39", "a", "loose")).toBe("");
  });
  it("carries no acceptance for Consulted/Informed — being told is not accepted, in either mode", () => {
    expect(initialAcceptance("u39", "c", "strict")).toBe("");
    expect(initialAcceptance("u39", "i", "strict")).toBe("");
    expect(initialAcceptance("u39", "c", "loose")).toBe("");
    expect(initialAcceptance("u39", "i", "loose")).toBe("");
  });
  it("carries no acceptance for a cleared cell — a gap accepts nothing, in either mode", () => {
    expect(initialAcceptance("", "r", "strict")).toBe("");
    expect(initialAcceptance("", "a", "strict")).toBe("");
    expect(initialAcceptance("", "r", "loose")).toBe("");
    expect(initialAcceptance("", "a", "loose")).toBe("");
  });
});

describe("actorMayRespond", () => {
  it("passes any actor in loose mode — there is no acceptance step to gate", () => {
    expect(actorMayRespond("loose", "u39", "u40")).toBe(true);
    expect(actorMayRespond("loose", "", "u40")).toBe(true);
  });
  it("requires the actor to BE the named holder in strict mode", () => {
    expect(actorMayRespond("strict", "u39", "u39")).toBe(true);
    expect(actorMayRespond("strict", "u39", "u40")).toBe(false);
    expect(actorMayRespond("strict", "", "u40")).toBe(false);
  });
});

describe("toWireAssignment", () => {
  it("passes the stored cell through and normalises nulls to empty strings", () => {
    expect(
      toWireAssignment({
        objectId: "CR-2026-148",
        roleKey: "a",
        ownerPersonId: null,
        acceptance: null,
        setBy: null,
        setAt: null,
        setWhy: null,
      }),
    ).toEqual({
      objectId: "CR-2026-148",
      roleKey: "a",
      ownerPersonId: "",
      acceptance: "",
      setBy: "",
      setAt: "",
      setWhy: "",
      order: 0,
      respondedBy: "",
      respondedAt: "",
      declineReason: "",
    });
  });

  it("passes the stored precedence through (#1517) — a missing orderRank defaults to 0, not to a truthy default", () => {
    expect(
      toWireAssignment({
        objectId: "CR-2026-148",
        roleKey: "a",
        ownerPersonId: "u7",
        acceptance: "pending",
        setBy: "Priya",
        setAt: "1 October 2026",
        setWhy: "Changed on the ownership page",
        orderRank: 2,
      }),
    ).toEqual({
      objectId: "CR-2026-148",
      roleKey: "a",
      ownerPersonId: "u7",
      acceptance: "pending",
      setBy: "Priya",
      setAt: "1 October 2026",
      setWhy: "Changed on the ownership page",
      order: 2,
      respondedBy: "",
      respondedAt: "",
      declineReason: "",
    });
  });
});

describe("toWireDelegation", () => {
  it("defaults a null scope to 'all' and preserves done", () => {
    expect(
      toWireDelegation({ fromPersonId: "u1", toPersonId: "u2", until: "1 Oct", scope: null, done: true }),
    ).toEqual({ fromPersonId: "u1", toPersonId: "u2", until: "1 Oct", scope: "all", done: true });
  });
});

describe("toWireRow", () => {
  it("normalises the nullable custom/coverage fields to empty strings", () => {
    expect(
      toWireRow({ rowId: "cov-x", source: "coverage", objType: null, name: null, sub: null }),
    ).toEqual({ rowId: "cov-x", source: "coverage", objType: "", name: "", sub: "" });
  });
});

describe("assignEventType (#1522)", () => {
  it("is 'cleared' for an empty owner, new row or not — a gap is a gap either way", () => {
    expect(assignEventType("", false)).toBe("cleared");
    expect(assignEventType("", true)).toBe("cleared");
  });
  it("is 'assigned' the first time a real holder appears in the cell", () => {
    expect(assignEventType("u39", false)).toBe("assigned");
  });
  it("is 'reassigned' when that exact holder's row already existed", () => {
    expect(assignEventType("u39", true)).toBe("reassigned");
  });
});

describe("toWireEvent (#1522)", () => {
  it("passes a stored event through and formats its timestamp", () => {
    expect(
      toWireEvent({
        objectId: "CR-2026-148",
        roleKey: "a",
        ownerPersonId: "u7",
        eventType: "accepted",
        actor: "Priya",
        reason: "",
        createdAt: new Date(Date.UTC(2026, 9, 1)),
      }),
    ).toEqual({
      objectId: "CR-2026-148",
      roleKey: "a",
      ownerPersonId: "u7",
      eventType: "accepted",
      actor: "Priya",
      reason: "",
      at: "1 October 2026",
    });
  });
});
