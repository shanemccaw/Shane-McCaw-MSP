/**
 * cmpAreaModel.test.ts — pins the Compliance area drill-down resolution (Git #1388).
 *
 * The 14 Compliance cluster cards all share one URL space
 * (`/portal-v2/compliance/<slug>`), fed by the `:area` wildcard route. The two
 * things that must not drift are: (1) every real card slug resolves (so no card
 * is a 404 again), and (2) a finding-backed card resolves to the CORRECT finding
 * while an inert card resolves to no finding rather than the wrong one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cmpAreaFor } from "./cmpAreaModel";
import { CMP_AREA_LINKS } from "./cmpDashboardData";

describe("cmpAreaFor", () => {
  it("resolves every area-card slug — no card is a 404", () => {
    for (const link of CMP_AREA_LINKS) {
      const slug = link.key.replace(/^compliance-/, "");
      const r = cmpAreaFor(slug);
      assert.ok(r, `slug "${slug}" should resolve`);
      assert.equal(r?.link.key, link.key);
    }
  });

  it("resolves a finding-backed slug to its correct finding", () => {
    // retention-coverage carries finding index 0 → CMP-01.
    const r = cmpAreaFor("retention-coverage");
    assert.equal(r?.link.label, "Retention Coverage");
    assert.equal(r?.finding?.id, "CMP-01");
    assert.match(r?.finding?.title ?? "", /12 mailboxes are not covered/);

    // disposition carries finding index 4 → CMP-05, proving the index is the
    // finding position (not the card position) and does not off-by-one.
    const d = cmpAreaFor("disposition");
    assert.equal(d?.finding?.id, "CMP-05");
  });

  it("resolves an inert (no-finding) slug to a card with a null finding", () => {
    // Subject Requests / dsr has no finding index and no producing check.
    const r = cmpAreaFor("dsr");
    assert.equal(r?.link.label, "Subject Requests");
    assert.equal(r?.finding, null);
  });

  it("returns null for an unknown or absent slug", () => {
    assert.equal(cmpAreaFor("not-a-real-area"), null);
    assert.equal(cmpAreaFor(undefined), null);
    // The literal sub-routes are NOT area cards; they must not resolve here so
    // the wildcard never shadows their own explicit routes.
    assert.equal(cmpAreaFor("open-gaps"), null);
    assert.equal(cmpAreaFor("decisions"), null);
    assert.equal(cmpAreaFor("obligations"), null);
  });
});
