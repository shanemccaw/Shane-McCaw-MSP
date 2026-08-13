/**
 * warRoomBriefing.test.ts — #332 (War Room epic #302).
 *
 * The verification the issue actually asks for is behavioural: the confirmation
 * loop works against mock data, and `enterRoom()` / `startArrivals()` cannot fire
 * until the scene is genuinely finished. The second half of that is a predicate —
 * `isBriefingComplete()` — so it is testable directly, and these tests drive the
 * loop the way a customer does: confirm one, reject one, regenerate it, hit the
 * cap, describe it, and check the gate only opens at the end.
 *
 * The catalog below is shaped like a real `ResolvedQuizCatalog` persona level;
 * the roster this scene shows is real catalog content, so the tests exercise the
 * real read (`buildBriefingPersonas` filtering by picked ids) rather than a
 * hand-built persona array.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIEFING_BEATS,
  BRIEFING_DRAFT_VARIANTS,
  BRIEFING_MAX_REGENERATIONS,
  briefingDraft,
  briefingProgress,
  buildBriefingPersonas,
  canRegenerate,
  confirmPersona,
  describePersona,
  isBriefingComplete,
  nextUnsettledIndex,
  regeneratePersona,
  rejectPersona,
  rejectionOptions,
  type BriefingPersona,
} from "./warRoomBriefing.ts";

/** A catalog shaped like a real resolved persona level. */
const CATALOG = {
  clusters: [],
  personas: [
    { id: "mission-ops", title: "Mission Operations", description: "Runs the day-to-day flight and ground operations schedule." },
    { id: "research", title: "Research & Analysis", description: "Produces technical analysis and long-form findings." },
    { id: "programme", title: "Programme Management", description: "Owns schedule, cost and reporting across the portfolio." },
    { id: "support", title: "Support & Service Desk", description: "First line for everyone else in the tenant." },
  ],
  useCases: [],
  outcomes: [],
} as any;

const byId = (list: readonly BriefingPersona[], id: string) => list.find((p) => p.id === id)!;

test("the roster is the customer's own picks, in catalog terms", () => {
  const personas = buildBriefingPersonas(CATALOG, ["research", "mission-ops"]);
  assert.equal(personas.length, 2);
  // Catalog order, not click order — the scene reads a level, it does not replay a click log.
  assert.deepEqual(personas.map((p) => p.id), ["mission-ops", "research"]);
  assert.equal(personas[0].name, "Mission Operations");
  assert.equal(personas[0].role, "Runs the day-to-day flight and ground operations schedule.");
  assert.equal(personas[0].status, "pending");
  assert.equal(personas[0].regenerations, 0);
  assert.equal(personas[0].ownWords, "");
});

test("picking no personas falls back to real catalog rows, never to invented ones", () => {
  const personas = buildBriefingPersonas(CATALOG, []);
  assert.equal(personas.length, 3);
  assert.deepEqual(personas.map((p) => p.id), ["mission-ops", "research", "programme"]);
  // Every one of them is a real catalog row.
  personas.forEach((p) => {
    assert.ok(CATALOG.personas.some((c: any) => c.id === p.id && c.title === p.name));
  });
});

test("an empty or missing catalog yields an empty roster rather than throwing", () => {
  assert.deepEqual(buildBriefingPersonas(null, ["research"]), []);
  assert.deepEqual(buildBriefingPersonas({ personas: [] } as any, []), []);
});

test("no draft claims to be AI-generated in this build", () => {
  const personas = buildBriefingPersonas(CATALOG, ["research"]);
  assert.equal(personas[0].draft.generated, false);
  for (let v = 0; v < BRIEFING_DRAFT_VARIANTS + 2; v++) {
    assert.equal(briefingDraft("Research & Analysis", "desc", v).generated, false);
  }
});

test("a draft only ever quotes the persona's own real catalog description", () => {
  const draft = briefingDraft("Research & Analysis", "Produces technical analysis and long-form findings.", 0);
  assert.ok(draft.dayToDay.includes("Produces technical analysis and long-form findings."));
  // Nothing in the placeholder bank invents a headcount for the role.
  const joined = [draft.headline, draft.dayToDay, draft.copilotFit, draft.watchFor].join(" ");
  assert.ok(!/\b\d[\d,]*\s*(seats?|users?|people|licen[cs]es?)\b/i.test(joined));
});

test("variants wrap rather than running off the end of the bank", () => {
  const wrapped = briefingDraft("X", "y", BRIEFING_DRAFT_VARIANTS);
  const first = briefingDraft("X", "y", 0);
  assert.equal(wrapped.variant, 0);
  assert.deepEqual(wrapped, first);
});

test("confirming a persona settles it and moves the cursor on", () => {
  let personas = buildBriefingPersonas(CATALOG, ["mission-ops", "research"]);
  assert.equal(nextUnsettledIndex(personas), 0);
  personas = confirmPersona(personas, "mission-ops");
  assert.equal(byId(personas, "mission-ops").status, "confirmed");
  assert.equal(nextUnsettledIndex(personas), 1);
  // The other persona is untouched.
  assert.equal(byId(personas, "research").status, "pending");
});

test("regeneration produces genuinely different copy and returns the persona for re-review", () => {
  let personas = buildBriefingPersonas(CATALOG, ["research"]);
  const before = byId(personas, "research").draft;
  personas = rejectPersona(personas, "research");
  assert.equal(byId(personas, "research").status, "rejected");

  personas = regeneratePersona(personas, "research");
  const after = byId(personas, "research");
  assert.notEqual(after.draft.headline, before.headline);
  assert.notEqual(after.draft.dayToDay, before.dayToDay);
  assert.equal(after.status, "pending", "a regenerated persona is asked about again, not auto-accepted");
  assert.equal(after.regenerations, 1);
});

test("regeneration is capped, and the cap opens the describe-it-yourself resolution", () => {
  let personas = buildBriefingPersonas(CATALOG, ["research"]);
  assert.equal(rejectionOptions(byId(personas, "research")), "choose");

  for (let i = 0; i < BRIEFING_MAX_REGENERATIONS; i++) {
    personas = rejectPersona(personas, "research");
    assert.equal(rejectionOptions(byId(personas, "research")), "choose");
    personas = regeneratePersona(personas, "research");
  }

  personas = rejectPersona(personas, "research");
  const spent = byId(personas, "research");
  assert.equal(spent.regenerations, BRIEFING_MAX_REGENERATIONS);
  assert.equal(canRegenerate(spent), false);
  assert.equal(rejectionOptions(spent), "describe-only");

  // A stale button cannot spend a cycle the scene has stopped offering.
  const after = regeneratePersona(personas, "research");
  assert.deepEqual(after, personas);
});

test("the customer's own description settles the persona and is kept verbatim", () => {
  let personas = buildBriefingPersonas(CATALOG, ["support"]);
  const placeholder = byId(personas, "support").draft;
  personas = rejectPersona(personas, "support");
  personas = describePersona(personas, "support", "  They run change approvals, not the service desk.  ");

  const p = byId(personas, "support");
  assert.equal(p.ownWords, "They run change approvals, not the service desk.");
  assert.equal(p.source, "customer");
  assert.equal(p.status, "confirmed");
  // Open question (1): the placeholder is kept alongside, so the customer's words
  // can later be read either as the content or as grounding for a real attempt.
  assert.deepEqual(p.draft, placeholder);
});

test("an empty description does not settle a persona", () => {
  let personas = buildBriefingPersonas(CATALOG, ["support"]);
  personas = rejectPersona(personas, "support");
  const same = describePersona(personas, "support", "   ");
  assert.deepEqual(same, personas);
  assert.equal(isBriefingComplete(same), false);
});

test("the room stays shut until every persona is settled", () => {
  let personas = buildBriefingPersonas(CATALOG, ["mission-ops", "research", "support"]);
  assert.equal(isBriefingComplete(personas), false);
  assert.equal(briefingProgress(personas).settled, 0);

  personas = confirmPersona(personas, "mission-ops");
  assert.equal(isBriefingComplete(personas), false);

  personas = rejectPersona(personas, "research");
  assert.equal(isBriefingComplete(personas), false, "rejecting is not settling");

  personas = regeneratePersona(personas, "research");
  assert.equal(isBriefingComplete(personas), false, "a fresh attempt still has to be accepted");

  personas = confirmPersona(personas, "research");
  assert.equal(isBriefingComplete(personas), false);
  assert.equal(briefingProgress(personas).settled, 2);

  personas = describePersona(personas, "support", "Mostly contractors, on Teams only.");
  assert.equal(isBriefingComplete(personas), true);

  const done = briefingProgress(personas);
  assert.deepEqual({ settled: done.settled, total: done.total, complete: done.complete }, { settled: 3, total: 3, complete: true });
  assert.equal(done.fraction, 1);
});

test("an empty roster does not strand the customer on a scene with nothing in it", () => {
  assert.equal(isBriefingComplete([]), true);
  assert.equal(nextUnsettledIndex([]), -1);
  assert.equal(briefingProgress([]).fraction, 1);
});

test("Shane's tutorial is real content, not a stub", () => {
  assert.ok(BRIEFING_BEATS.length >= 3);
  BRIEFING_BEATS.forEach((beat) => {
    assert.ok(beat.id && beat.tag && beat.title);
    assert.ok(beat.lines.length > 0);
    beat.lines.forEach((line) => assert.ok(line.trim().length > 40));
  });
  // The last beat is the hand-off into the persona loop.
  assert.equal(BRIEFING_BEATS[BRIEFING_BEATS.length - 1].id, "personas");
});
