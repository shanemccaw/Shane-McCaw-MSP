/**
 * sowLiveScope.test.ts — the Statement of Work's priced scope, computed from the
 * Sales Offer Engine with no stored document row behind it.
 *
 * The bar these assertions hold is the one every live-rendered document in this
 * journey is held to: a figure the platform does not have must arrive as an
 * absence the renderer can SEE, never as a zero it will happily print. The two
 * that matter most on a page with prices on it are the duration (`weeksQuoted`,
 * which must stay `null` and never flatten to `0`) and the pillar attribution
 * (which must come from the real fired-signal pillars where they exist, and be
 * `null` rather than guessed where nothing knows).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  journeyAddonsFromWire,
  journeyScopeFromOffers,
  pillarForOffer,
  SOW_DOC_TYPE,
  type WireRecommendedOffer,
  type WireSowAddon,
} from "./sowLiveScope.ts";

const offer = (over: Partial<WireRecommendedOffer> = {}): WireRecommendedOffer => ({
  serviceId: 1,
  serviceName: "Identity & Access Hardening",
  title: "Identity & Access Hardening — recommended for your environment",
  rationale: "Your tenant fired 4 identity signals, including admins without MFA.",
  priceCents: 1_250_000,
  pillars: ["security"],
  ...over,
});

describe("SOW_DOC_TYPE", () => {
  it("is the real seeded catalogue key the server's own loadSowDocs filters on", () => {
    assert.equal(SOW_DOC_TYPE, "sow");
  });
});

describe("pillarForOffer", () => {
  it("prefers the route's real fired-signal pillars over reading the title", () => {
    // The title says "licence" (which `inferPillar` matches to `licensing`), but
    // the signals that actually fired it are governance ones. The typed link wins.
    assert.equal(pillarForOffer({ pillars: ["governance"] }, "Licence rationalisation"), "governance");
  });
  it("ignores a pillar this journey does not recognise and falls back to the title", () => {
    assert.equal(pillarForOffer({ pillars: ["copilot", "not_a_pillar"] }, "DLP and labelling"), "compliance");
  });
  it("falls back to title inference when no pillars are carried at all", () => {
    assert.equal(pillarForOffer({}, "Conditional Access rollout"), "security");
  });
  it("null when neither the signals nor the title say — no guessed swatch", () => {
    assert.equal(pillarForOffer({ pillars: [] }, "Quarterly business review"), null);
  });
});

describe("journeyScopeFromOffers", () => {
  it("null when the engine returned no candidates — an honest state, not an error", () => {
    assert.equal(journeyScopeFromOffers({ offers: [] }), null);
    assert.equal(journeyScopeFromOffers({}), null);
  });

  it("maps a candidate onto a real priced phase", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.equal(built.phases.length, 1);
    const p = built.phases[0]!;
    assert.equal(p.title, "Identity & Access Hardening");
    assert.equal(p.id, "identity-access-hardening");
    assert.equal(p.priceUsd, 12_500);
    assert.equal(p.scope, "Your tenant fired 4 identity signals, including admins without MFA.");
    assert.equal(p.pillarShown, "security");
    assert.equal(built.pillarById[p.id], "security");
  });

  it("uses serviceName, not the engine's decorated sales title", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.ok(!built.phases[0]!.title.includes("recommended for your environment"));
  });

  it("falls back to the decorated title only when serviceName is absent", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ serviceName: undefined })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.title, "Identity & Access Hardening — recommended for your environment");
  });

  it("quotes no duration, and says so with null rather than 0", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    // `weeks` is the flattened field `computeTotals()` sums and MUST be a number;
    // `weeksQuoted` is the one anything rendering a timeline has to consult.
    assert.equal(built.phases[0]!.weeks, 0);
    assert.equal(built.phases[0]!.weeksQuoted, null);
  });

  it("asserts no score movement — both ends flat, so nothing draws a fake delta", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.equal(built.phases[0]!.scoreFrom, built.phases[0]!.scoreTo);
  });

  it("emits no adjustment lines: the engine folds them into each price already", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.deepEqual(built.adjustments, []);
    assert.equal(built.adjustmentsUsd, 0);
  });

  it("claims no quote-hold date and no document id — there is no stored row to anchor either to", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.equal(built.quoteHoldIso, null);
    assert.equal(built.docId, null);
    assert.equal(built.serverSelectedTitles, null);
  });

  it("invents no optional services when the wire carries none", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.deepEqual(built.scope.addons, []);
  });

  it("maps real add-ons carried on the same wire onto scope.addons", () => {
    const built = journeyScopeFromOffers({
      offers: [offer()],
      addons: [
        {
          id: "tenant-monitoring",
          title: "Tenant Monitoring",
          blurb: "Six signal engines against your tenant every hour.",
          defaultOn: true,
          defaultTierId: "enhanced",
          tiers: [
            { id: "basic", label: "Basic", upfrontUsd: 0, monthlyUsd: 890, detail: "" },
            { id: "enhanced", label: "Enhanced", upfrontUsd: 0, monthlyUsd: 1480, detail: "", emphasis: "recommended" },
          ],
        },
      ],
    });
    assert.ok(built);
    assert.equal(built.scope.addons.length, 1);
    assert.equal(built.scope.addons[0]!.id, "tenant-monitoring");
    assert.equal(built.scope.addons[0]!.tiers.length, 2);
  });

  it("no phase is locked — nothing on this wire is a mandatory workstream", () => {
    const built = journeyScopeFromOffers({ offers: [offer(), offer({ serviceName: "Second" })] });
    assert.ok(built);
    assert.ok(built.phases.every((p) => !p.locked));
  });

  it("leaves an unattributable phase with no pillar rather than picking one", () => {
    const built = journeyScopeFromOffers({
      offers: [offer({ serviceName: "Quarterly business review", pillars: [] })],
    });
    assert.ok(built);
    assert.equal(built.phases[0]!.pillarShown, null);
    assert.equal(built.pillarById[built.phases[0]!.id], undefined);
  });

  it("skips a candidate with no usable title", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ serviceName: "   ", title: undefined }), offer()] });
    assert.ok(built);
    assert.equal(built.phases.length, 1);
  });

  it("skips a candidate with no usable price rather than quoting it at $0", () => {
    const built = journeyScopeFromOffers({
      offers: [offer({ serviceName: "No price", priceCents: undefined }), offer({ serviceName: "NaN", priceCents: Number.NaN })],
    });
    assert.equal(built, null);
  });

  it("a genuinely free candidate is kept — $0 is a price, absence is not", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ priceCents: 0 })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.priceUsd, 0);
  });

  it("disambiguates two services that slugify identically instead of colliding", () => {
    const built = journeyScopeFromOffers({
      offers: [offer({ serviceName: "Copilot Enablement" }), offer({ serviceName: "Copilot  enablement!" })],
    });
    assert.ok(built);
    assert.equal(built.phases.length, 2);
    assert.notEqual(built.phases[0]!.id, built.phases[1]!.id);
    assert.equal(new Set(built.phases.map((p) => p.id)).size, 2);
  });

  it("scope.phases is the same array the display fields hang off, so the two cannot drift", () => {
    const built = journeyScopeFromOffers({ offers: [offer()] });
    assert.ok(built);
    assert.equal(built.scope.phases[0], built.phases[0]);
  });

  it("preserves the engine's own score-ranked order", () => {
    const built = journeyScopeFromOffers({
      offers: [offer({ serviceName: "First" }), offer({ serviceName: "Second" }), offer({ serviceName: "Third" })],
    });
    assert.ok(built);
    assert.deepEqual(built.phases.map((p) => p.title), ["First", "Second", "Third"]);
  });

  it("an empty rationale renders as empty prose rather than the word undefined", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ rationale: null })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.scope, "");
  });

  it("Git #593: a real durationWeeks on the wire becomes the phase's weeksQuoted, not a flattened 0", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ durationWeeks: 2 })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.weeks, 2);
    assert.equal(built.phases[0]!.weeksQuoted, 2);
  });

  it("Git #593: a recognised stage passes through untouched", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ stage: "foundation" })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.stage, "foundation");
  });

  it("Git #593: an unrecognised stage string normalises to null rather than a guess", () => {
    const built = journeyScopeFromOffers({ offers: [offer({ stage: "not-a-real-stage" })] });
    assert.ok(built);
    assert.equal(built.phases[0]!.stage, null);
  });

  it("Git #593: a continuous phase (White-Glove) carries no durationWeeks but still reports its stage", () => {
    const built = journeyScopeFromOffers({
      offers: [offer({ serviceName: "White-Glove Copilot Adoption", stage: "continuous", durationWeeks: null })],
    });
    assert.ok(built);
    assert.equal(built.phases[0]!.stage, "continuous");
    assert.equal(built.phases[0]!.weeksQuoted, null);
  });
});

describe("journeyAddonsFromWire", () => {
  const monitoringAddon = (over: Partial<WireSowAddon> = {}): WireSowAddon => ({
    id: "tenant-monitoring",
    title: "Tenant Monitoring",
    blurb: "Six signal engines against your tenant every hour.",
    defaultOn: true,
    defaultTierId: "enhanced",
    tiers: [
      { id: "basic", label: "Basic", upfrontUsd: 0, monthlyUsd: 890, detail: "Baseline coverage." },
      { id: "enhanced", label: "Enhanced", upfrontUsd: 0, monthlyUsd: 1480, detail: "Most popular.", emphasis: "recommended" },
      { id: "premium", label: "Premium", upfrontUsd: 0, monthlyUsd: 2350, detail: "Full coverage." },
    ],
    ...over,
  });

  it("empty array when the wire carries no addons", () => {
    assert.deepEqual(journeyAddonsFromWire(undefined), []);
    assert.deepEqual(journeyAddonsFromWire([]), []);
  });

  it("maps a real addon's tiers through, preserving emphasis", () => {
    const [addon] = journeyAddonsFromWire([monitoringAddon()]);
    assert.ok(addon);
    assert.equal(addon.id, "tenant-monitoring");
    assert.equal(addon.tiers.length, 3);
    assert.equal(addon.tiers.find((t) => t.id === "enhanced")?.emphasis, "recommended");
    assert.equal(addon.tiers.find((t) => t.id === "basic")?.emphasis, undefined);
  });

  it("defaults to the tier the server named, and only when it actually exists among the mapped tiers", () => {
    const [good] = journeyAddonsFromWire([monitoringAddon()]);
    assert.equal(good?.defaultTierId, "enhanced");

    const [dangling] = journeyAddonsFromWire([monitoringAddon({ defaultTierId: "does-not-exist" })]);
    assert.equal(dangling?.defaultTierId, null);
  });

  it("drops an addon with no id or no title rather than rendering a broken card", () => {
    assert.deepEqual(journeyAddonsFromWire([monitoringAddon({ id: "" })]), []);
    assert.deepEqual(journeyAddonsFromWire([monitoringAddon({ title: "  " })]), []);
  });

  it("drops a tier missing an id, a label, or any positive price", () => {
    const [addon] = journeyAddonsFromWire([
      monitoringAddon({
        tiers: [
          { id: "basic", label: "Basic", upfrontUsd: 0, monthlyUsd: 890, detail: "" },
          { id: "", label: "No id", upfrontUsd: 0, monthlyUsd: 100, detail: "" },
          { id: "no-label", label: "", upfrontUsd: 0, monthlyUsd: 100, detail: "" },
          { id: "free", label: "Free", upfrontUsd: 0, monthlyUsd: 0, detail: "" },
        ],
      }),
    ]);
    assert.ok(addon);
    assert.deepEqual(addon.tiers.map((t) => t.id), ["basic"]);
  });

  it("drops the whole addon when every tier was unusable", () => {
    assert.deepEqual(
      journeyAddonsFromWire([monitoringAddon({ tiers: [{ id: "x", label: "X", upfrontUsd: 0, monthlyUsd: 0, detail: "" }] })]),
      [],
    );
  });

  it("a single-row addon (Architect Retainer) with one real tier maps through", () => {
    const [addon] = journeyAddonsFromWire([
      {
        id: "architect-retainer",
        title: "Architect Retainer",
        blurb: "Direct access to Shane for design decisions.",
        defaultOn: false,
        defaultTierId: "standard",
        tiers: [{ id: "standard", label: "Retainer", upfrontUsd: 0, monthlyUsd: 2000, detail: "" }],
      },
    ]);
    assert.ok(addon);
    assert.equal(addon.defaultOn, false);
    assert.equal(addon.tiers.length, 1);
    assert.equal(addon.tiers[0]!.monthlyUsd, 2000);
  });

  it("Git #593: carries a continuous stage through when the wire says so", () => {
    const [addon] = journeyAddonsFromWire([monitoringAddon({ stage: "continuous" })]);
    assert.ok(addon);
    assert.equal(addon.stage, "continuous");
  });

  it("Git #593: no stage field at all when the wire carries none (Architect Retainer)", () => {
    const [addon] = journeyAddonsFromWire([monitoringAddon({ stage: undefined })]);
    assert.ok(addon);
    assert.equal(addon.stage, undefined);
  });
});
