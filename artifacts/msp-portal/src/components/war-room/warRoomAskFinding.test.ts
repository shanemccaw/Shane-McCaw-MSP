/**
 * warRoomAskFinding.test.ts — #328 (War Room epic #302).
 *
 * askFinding()'s non-governance branch used to set `qa: { who, text }` with
 * no `topicId`. The qa render (WarRoomLogic.tsx ~5842) does
 * `TOPICS[s.qa.topicId] || {}`, so a missing topicId meant every
 * non-Governance whiteboard click rendered against an empty topic object —
 * no metrics, no follow-ups, none of the real, already-authored TOPICS
 * content — while Governance clicks (which route through govSay/hobj, not
 * qa) always showed their real measured content.
 *
 * The fix has askFinding() resolve a real topicId via
 * `resolveFindingTopicId()`, the same finding-text categorization
 * WarRoomLogic's chat route() uses, so this test exercises that exact
 * shared function rather than a re-implementation of it. (WarRoomLogic.tsx
 * itself can't be imported under node's plain `--test` runner — it ends in
 * JSX, which is syntax node's native TS type-stripping does not transform —
 * so the fix was structured to keep the finding->topic resolution in the
 * plain .ts data module where it's actually testable.)
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { FINDINGS, TOPICS, resolveFindingTopicId } from "./data/warRoomData.ts";

test("every non-Governance pillar's findings resolve to a real, non-empty TOPICS entry", () => {
  for (const pillar of Object.keys(FINDINGS)) {
    if (pillar === "governance") continue; // governance dives through govSay/hobj, not qa/topicId
    for (const fx of FINDINGS[pillar]) {
      const topicId = resolveFindingTopicId(fx);
      assert.ok(topicId, `${pillar}/${fx.id} must resolve a topicId`);

      const topic = TOPICS[topicId];
      assert.ok(topic, `${pillar}/${fx.id} topicId "${topicId}" must be a real TOPICS key`);

      // The bug's symptom: TOPICS[undefined] || {} — an object with none of
      // this. Assert the resolved topic actually carries real content.
      assert.ok(topic.title, `${pillar}/${fx.id} resolved topic must have a real title`);
      assert.ok(Array.isArray(topic.metrics) && topic.metrics.length > 0,
        `${pillar}/${fx.id} resolved topic must carry real metrics, not the empty-object fallback`);
      assert.ok(Array.isArray(topic.bad) && topic.bad.length > 0,
        `${pillar}/${fx.id} resolved topic must carry real findings content, not the empty-object fallback`);
    }
  }
});

test("a specific Security finding (DLP) resolves to its real DLP topic, matching what Governance already shows", () => {
  const fx = FINDINGS.security.find(f => f.id === "f-sec-1");
  assert.ok(fx, "fixture f-sec-1 must exist");

  const topicId = resolveFindingTopicId(fx);
  assert.equal(topicId, "dlp");

  const topic = TOPICS[topicId];
  assert.equal(topic.title, "DLP Coverage & Gaps");
  // Specific, already-authored content — not generic fallback text.
  assert.ok(topic.ugly.some(line => /unscoped/i.test(line)));
  assert.ok(topic.metrics.some(m => m[0] === "Unscoped sets"));
});

test("a Compliance finding never falls back to an undefined topicId", () => {
  // Compliance findings don't hit any of the specific category regexes, so
  // this exercises the default branch — the exact case that used to leave
  // qa.topicId undefined for non-Governance findings.
  const fx = FINDINGS.compliance.find(f => f.id === "f-cmp-1");
  assert.ok(fx, "fixture f-cmp-1 must exist");

  const topicId = resolveFindingTopicId(fx);
  assert.notEqual(topicId, undefined);
  assert.ok(TOPICS[topicId], `topicId "${topicId}" must be a real TOPICS key, not undefined`);
});
