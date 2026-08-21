/**
 * secEvidenceModel.test.ts — pins evidence-page slug resolution and tones.
 *
 * One template serves three pages off the URL slug, so the failure to guard
 * against is a slug resolving to the wrong page (or to nothing when it should
 * resolve). These cases pin all three real slugs, an unknown slug, and the
 * tone/source maps the stat cards and provenance chips read.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evidencePageFor, evSrc, evTone, evTopRisksCount } from "./secEvidenceModel";

describe("evidencePageFor", () => {
  it("resolves each real slug to its heading", () => {
    assert.equal(evidencePageFor("oauth")?.heading, "OAuth Apps & Consent Grants");
    assert.equal(evidencePageFor("legacy-auth")?.heading, "Legacy Authentication");
    assert.equal(evidencePageFor("email")?.heading, "Email Security");
  });

  it("returns null for an unknown or absent slug", () => {
    assert.equal(evidencePageFor("mfa"), null);
    assert.equal(evidencePageFor(undefined), null);
  });

  it("exposes the top-risks count each page carries", () => {
    assert.equal(evTopRisksCount(evidencePageFor("oauth")!), 5);
    assert.equal(evTopRisksCount(evidencePageFor("email")!), 6);
  });
});

describe("tone and source maps", () => {
  it("map tones and sources to their hex / label", () => {
    assert.equal(evTone("red"), "#f87171");
    assert.equal(evTone("slate"), "#94a3b8");
    assert.equal(evSrc("graph").label, "Graph");
    assert.equal(evSrc("exo").label, "Exchange / Defender");
  });
});
