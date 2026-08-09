/**
 * sowLiveScope.ts — the Statement of Work's priced scope, computed live from
 * this tenant's own fired signals, with NO stored document row behind it.
 *
 * WHY THIS EXISTS
 * ---------------
 * #292 gave the SOW a live path, but that path read `GET
 * /api/portal/assessment/sow` — which is `loadSowDocs()` over
 * `insights_generated_documents`, i.e. it only answers once
 * `document-engine-sow.ts` has run an AI generation for the tenant and written a
 * row. So the one document the customer signs was the one document that could
 * not be read until a generation pipeline had succeeded, while the other seven
 * render from the scan itself. Shane's direction is that it works like the rest
 * of them: real content computed live, no stored document row.
 *
 * WHY THE SALES OFFER ENGINE IS THE RIGHT SOURCE, AND NOT A SUBSTITUTE FOR ONE
 * ---------------------------------------------------------------------------
 * This is not a second pricing mechanism standing in for the real one. It is the
 * SAME authority the stored document is built from, read without the AI layer in
 * between. `document-engine-sow.ts` says so in its own words, immediately above
 * its `runSalesOfferEngineForTenant()` call:
 *
 *   "The Sales Offer Engine is the sole authority on which projects to scope and
 *    what to charge for them — never engagement_projects/triggeredBy matching,
 *    and never pricing re-extracted from rendered HTML afterward."
 *
 * The generator hands those candidates to Claude as `{{candidates}}` with the
 * instruction not to invent projects or adjust prices, then `injectMissingWorkstreams`
 * / `reconcileEngineValues` / `validateSowPricing` force the engine's real figures
 * back into whatever the model produced. `sow_pricing_lines` is therefore the
 * engine's own output plus AI prose. Reading the engine directly drops the prose,
 * not the arithmetic.
 *
 * `GET /api/portal/assessment/recommended-offers` is that read, and it already
 * existed: it runs `runSalesOfferEngineForTenant()` in pure-compute mode for the
 * caller's own tenant, persists nothing, touches no offer state machine, and is
 * already consumed by `assessment-test.tsx`. No new route was added for this.
 *
 * WHAT IS LOST WITHOUT THE STORED DOCUMENT, AND WHY EACH LOSS IS DECLARED
 * RATHER THAN FILLED IN
 * ----------------------------------------------------------------------
 *   • Per-phase delivery DATES. Those are written by the AI at generation
 *     time (`assignDeliveryDates()` runs over lines the model produced) and
 *     have no equivalent here at all.
 *   • Per-phase week ESTIMATES — no longer lost, as of #593. The engine
 *     still quotes only a price, never a duration itself, but each catalog
 *     row now carries its own real `durationWeeks` in `type_attributes`
 *     (2026-08-08-sow-phase-stage-duration-593.sql), which
 *     `journeyScopeFromOffers()` reads straight through. `weeksQuoted` is
 *     `null` only for a service this migration never tagged (an add_on that
 *     isn't a bounded-duration phase, or a genuinely Continuous one) — NOT
 *     `0` — so nothing can render "approx. 0 weeks" over a phase that
 *     honestly has no bounded duration. See `sowLiveContract.ts`'s
 *     `resolveTimeline`.
 *   • Adjustment lines. `sow-pricing.ts` writes rows literally titled "Price
 *     Adjustments" / "Tenant Size Adjustment Factor" into `sow_pricing_lines`,
 *     but the engine does not emit them as lines at all — it folds every fired
 *     pricing rule group's percentage straight into `adjustedPriceCents`. The
 *     adjustment is already IN each price here, so listing a separate
 *     "Included adjustments" block would double-count it. `adjustments` is `[]`.
 *   • The 30-day quote-hold date. That window is anchored on the earliest
 *     non-failed SOW row's `createdAt`. With no row there is no anchor, and a
 *     date derived from anything else (the scan, today) would be a hold this
 *     platform has not actually committed to. `quoteHoldIso` is `null`, which
 *     `resolveValidity` already renders as "No fixed hold date is quoted for
 *     this scope".
 *   • The document reference. `sowReference(null)` is "SOW-DRAFT", which is what
 *     this is: a priced scope, not an issued document number.
 *
 * WHY THIS RETURNS `JourneySowScope` AND NOT A SHAPE OF ITS OWN
 * ------------------------------------------------------------
 * Because `StatementOfWorkBody` must not learn a second scope shape. One
 * component rendering two structurally different contracts is how the preview
 * and the live copy came to disagree in the first place. `journeyScopeFromSow()`
 * remains the mapping for the stored-document surfaces that still need it (the
 * proposal screen, the checkout, the assessment wizard's selector — all of which
 * lead to a payment that is FK'd to `sow_documents.id` and genuinely cannot work
 * without the row); this is the same target type reached from the engine.
 */

import { PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import { inferPillar, slugify, type JourneySowPhase, type JourneySowScope } from "./journeyScopeFromSow.ts";
import type { JourneyAddon, JourneyPhaseStage, JourneyTier } from "./journeyPricing.ts";

/**
 * Git #593 — the only 4 stages the Gantt's dependency model recognises. An
 * unrecognised wire string (a future stage value this client predates, or a
 * malformed row) becomes `null` — an unstaged bar the Gantt renders
 * sequentially — rather than a guess at which of the four it meant.
 */
const KNOWN_STAGES: ReadonlySet<string> = new Set<JourneyPhaseStage>([
  "foundation",
  "parallel-eligible",
  "closeout",
  "continuous",
]);

export function normalizeStage(raw: string | null | undefined): JourneyPhaseStage | null {
  return typeof raw === "string" && KNOWN_STAGES.has(raw) ? (raw as JourneyPhaseStage) : null;
}

/**
 * `document_types.key` for the Statement of Work — the real seeded catalogue key
 * (`lib/db/migrations/manual/2026-07-20-document-types.sql`, label "Statement of
 * Work"), and the same string `portal-assessment.ts` filters `loadSowDocs()` on
 * as its own `SOW_DOC_TYPE`.
 *
 * It lives here rather than in `journeyTokens.ts`'s `JOURNEY_LIVE_DOCUMENTS`
 * because the SOW is deliberately NOT in that registry: every entry there is a
 * `(props: { view }) => ReactElement` report body that `LIVE_BODY` can hold, and
 * the SOW is an interactive contract taking `onSigned`. It still has to be
 * CONSTRUCTED into a document set the same way those are — see
 * `withLiveDocuments()` — and this is the key that construction joins on.
 */
export const SOW_DOC_TYPE = "sow";

/* ------------------------------------------------------------------ *
 * Wire shapes — the subset of `GET /portal/assessment/recommended-offers`
 * this document reads. Every field optional: a partial or older payload
 * degrades to fewer phases, never to a throw.
 * ------------------------------------------------------------------ */

export interface WireRecommendedOffer {
  readonly serviceId?: number;
  /** The catalogue product's real name — the phase title on a contract. */
  readonly serviceName?: string;
  /** The engine's display title, `"{name} — recommended for your environment"`. */
  readonly title?: string;
  /** The engine's own customer-facing rationale, the same text `/portal/offers` shows. */
  readonly rationale?: string | null;
  /** `adjustedPriceCents` — base catalogue price with every fired pricing rule already applied. */
  readonly priceCents?: number;
  /** Health pillars of the signals that fired this offer. Free strings on the wire. */
  readonly pillars?: readonly string[];
  /** Git #593 — free string on the wire; validated by `normalizeStage()` before use. */
  readonly stage?: string | null;
  /** Git #593 — `services.type_attributes.durationWeeks`, or `null` where untagged. */
  readonly durationWeeks?: number | null;
}

/**
 * A real optional service — Tenant Monitoring or the Architect Retainer, both
 * resolved server-side (`sow-monitoring-addon.ts`) from real catalog rows.
 * `tiers` is Tenant Monitoring's real Basic/Enhanced/Premium quality tiers
 * (each already priced at this tenant's real seat count), or the Architect
 * Retainer's single real row. Never invented client-side.
 */
export interface WireSowAddonTier {
  readonly id?: string;
  readonly label?: string;
  readonly upfrontUsd?: number;
  readonly monthlyUsd?: number;
  readonly detail?: string;
  readonly emphasis?: "seat-match" | "recommended" | null;
}

export interface WireSowAddon {
  readonly id?: string;
  readonly title?: string;
  readonly blurb?: string;
  readonly defaultOn?: boolean;
  readonly defaultTierId?: string | null;
  readonly tiers?: readonly WireSowAddonTier[];
  /** Git #593 — `"continuous"` for Tenant Monitoring; absent for the Architect Retainer (no stage claim). */
  readonly stage?: string | null;
}

export interface WireRecommendedOffers {
  readonly offers?: readonly WireRecommendedOffer[];
  readonly addons?: readonly WireSowAddon[];
}

/**
 * Map the wire's add-ons onto `JourneyAddon[]` — dropping any entry missing
 * the fields a real toggleable, priced card needs (an id, a title, at least
 * one tier with a positive price) rather than rendering a broken card.
 */
export function journeyAddonsFromWire(addons: readonly WireSowAddon[] | undefined): JourneyAddon[] {
  const out: JourneyAddon[] = [];
  for (const a of addons ?? []) {
    const id = (a.id ?? "").trim();
    const title = (a.title ?? "").trim();
    if (!id || !title) continue;

    const tiers: JourneyTier[] = [];
    for (const t of a.tiers ?? []) {
      const tierId = (t.id ?? "").trim();
      const label = (t.label ?? "").trim();
      const upfrontUsd = typeof t.upfrontUsd === "number" && Number.isFinite(t.upfrontUsd) ? t.upfrontUsd : 0;
      const monthlyUsd = typeof t.monthlyUsd === "number" && Number.isFinite(t.monthlyUsd) ? t.monthlyUsd : 0;
      if (!tierId || !label || (upfrontUsd <= 0 && monthlyUsd <= 0)) continue;
      tiers.push({
        id: tierId,
        label,
        upfrontUsd,
        monthlyUsd,
        detail: t.detail ?? "",
        emphasis: t.emphasis === "seat-match" || t.emphasis === "recommended" ? t.emphasis : undefined,
      });
    }
    if (tiers.length === 0) continue;

    const defaultTierId = tiers.some((t) => t.id === a.defaultTierId) ? (a.defaultTierId as string) : null;
    out.push({
      id,
      title,
      blurb: a.blurb ?? "",
      tiers,
      defaultOn: a.defaultOn === true,
      defaultTierId,
      ...(normalizeStage(a.stage) === "continuous" ? { stage: "continuous" as const } : {}),
    });
  }
  return out;
}

const PILLAR_KEY_SET: ReadonlySet<string> = new Set<string>(PILLAR_KEYS);

/**
 * The pillar to attribute a phase to.
 *
 * The route's own `pillars` array is the REAL answer where it has one: it is
 * built from the `signal_derivation_rules.pillar` of the signals that actually
 * fired this offer, which is a typed link back to the check, not a reading of
 * prose. Only when that is empty or carries nothing this journey recognises does
 * this fall back to `inferPillar()`, the title-pattern guess the stored-document
 * path has to use because `sow_pricing_lines` has no pillar column at all.
 *
 * `null` when neither knows. An unattributed phase renders with no swatch, which
 * says "we are not claiming a pillar here" — a guessed colour would say
 * something false about what the customer is buying.
 */
export function pillarForOffer(offer: WireRecommendedOffer, title: string): PillarKey | null {
  for (const p of offer.pillars ?? []) {
    if (PILLAR_KEY_SET.has(p)) return p as PillarKey;
  }
  return inferPillar(title);
}

/**
 * Map the engine's candidates onto the journey's priced scope, or `null` when
 * this tenant has no candidates at all.
 *
 * `null` is a real state and not an error: the engine returns nothing when no
 * eligibility rule group fired, or when every candidate scored under
 * `minScore`. The caller renders that as "no priced remediation scope" — it
 * never falls back to the fixture's prices.
 */
export function journeyScopeFromOffers(body: WireRecommendedOffers): JourneySowScope | null {
  const phases: JourneySowPhase[] = [];
  const pillarById: Record<string, PillarKey> = {};
  // Two catalogue services can slugify to the same id (the phase id space is
  // `slugify(title)` because the signed selection crosses the navigation keyed
  // by it). A collision would make one card toggle the other, so the second
  // occurrence is suffixed rather than silently dropped or left to collide.
  const seen = new Map<string, number>();

  for (const offer of body.offers ?? []) {
    // `serviceName` over `title`: the engine's `title` is decorated
    // ("Identity Hardening — recommended for your environment"), which reads as
    // a sales line rather than a phase of work on a document the customer signs.
    const title = (offer.serviceName ?? offer.title ?? "").trim();
    if (!title) continue;
    const cents = offer.priceCents;
    if (typeof cents !== "number" || !Number.isFinite(cents)) continue;

    const base = slugify(title) || title;
    const priorCount = seen.get(base) ?? 0;
    seen.set(base, priorCount + 1);
    const id = priorCount === 0 ? base : `${base}-${priorCount + 1}`;

    const pillarShown = pillarForOffer(offer, title);
    if (pillarShown) pillarById[id] = pillarShown;

    // Git #593: real per-phase duration, off the catalog row's own
    // type_attributes (see sales-offer-engine.ts) — replaces the `null`
    // this used to be unconditionally, back when the engine genuinely had no
    // duration concept at all (see this file's own header note above).
    const durationWeeks =
      typeof offer.durationWeeks === "number" && Number.isFinite(offer.durationWeeks) ? offer.durationWeeks : null;

    phases.push({
      id,
      title,
      // Never read where `pillarShown` is null; the shared type needs a
      // `PillarKey` regardless. Same arrangement `journeyScopeFromSow.toPhase()`
      // makes, for the same reason.
      pillar: pillarShown ?? PILLAR_KEYS[0],
      pillarShown,
      // The real `services.id` this candidate prices against — carried through
      // (rather than dropped, as it was before #602) so a signature on this
      // scope can name exactly these rows in `POST .../sow/checkout-session`'s
      // `selectedPhaseServiceIds`, the same id space that endpoint's own
      // `candidatesById` keys on.
      serviceId: typeof offer.serviceId === "number" ? offer.serviceId : null,
      scope: (offer.rationale ?? "").trim(),
      // `priceCents` is the platform's canonical money unit; `JourneyPhase.priceUsd`
      // is the one documented place the cents rule does not hold, so the
      // conversion happens here, once, rather than at every render.
      priceUsd: cents / 100,
      // Flat: the engine quotes a price, never a projected pillar score. Both
      // ends equal means no card draws a "44 -> 44" movement that achieves
      // nothing, and `projectedFromPhases()` reads the flatness to decline to
      // state a projection at all.
      scoreFrom: 0,
      scoreTo: 0,
      addresses: "",
      // No mandatory workstreams exist on this wire. The platform's only
      // "shown, never toggleable" money is the pricing adjustment, and that is
      // already inside `priceUsd` above rather than a row of its own.
      locked: false,
      weeks: durationWeeks ?? 0,
      weeksQuoted: durationWeeks,
      stage: normalizeStage(offer.stage),
    });
  }

  if (phases.length === 0) return null;

  // Optional services — Tenant Monitoring + Architect Retainer — are real
  // catalog rows this same endpoint now carries (`sow-monitoring-addon.ts`),
  // not invented client-side and not a second pricing path.
  const addons = journeyAddonsFromWire(body.addons);

  return {
    scope: { phases, addons },
    phases,
    adjustments: [],
    adjustmentsUsd: 0,
    pillarById,
    quoteHoldIso: null,
    serverSelectedTitles: null,
    docId: null,
  };
}
