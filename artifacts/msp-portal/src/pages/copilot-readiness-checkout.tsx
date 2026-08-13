/**
 * copilot-readiness-checkout.tsx — Screen 4 of the Copilot Readiness journey.
 *
 * Route: /copilot-readiness/checkout (bare path; the authenticated subtree is
 * already mounted under `<WouterRouter base={"/"+slug}>`, so nothing here builds
 * a slug prefix).
 *
 * THE QUIET CLOSE. The Reveal argues, the Documents evidence, the Proposal
 * decides — this screen only confirms. It is deliberately the least-decorated of
 * the four: no ShaneBot, no document switcher, no navigation rail, nothing
 * competing with the two things that matter, which are what was signed and what
 * it costs. `ShaneBotDock` is not imported here on purpose.
 *
 * WHY THIS SCREEN REFUSES TO RENDER WITHOUT A SIGNATURE
 * ----------------------------------------------------
 * Screen 3 writes the signed scope into `sessionStorage` under
 * `cj_signed_scope` at the moment the customer signs. Without it there is no
 * signature, no signer and no signed selection — and a checkout for a scope
 * nobody signed is exactly the failure mode this journey exists to avoid. So the
 * absence of that key is an unavailable state with a route back to the proposal,
 * not a blank form.
 *
 * WHERE THE MONEY COMES FROM
 * --------------------------
 * `withAdjustments(computeTotals(scope, selection), adjustmentsUsd)` in
 * `journeyPricing.ts` / `journeyScopeFromSow.ts`, over the same scope and the
 * same selection the proposal used, folded the same way. Not a second arithmetic
 * — the whole reason those modules exist outside a component is so this screen
 * and the proposal's summary rail cannot disagree about what a customer signed.
 *
 * The AUTHORITY, though, is the server: `GET
 * /portal/assessment/sow/payment-options` returns `total` for the active scope,
 * and `computePayInFullOffer()` charges exactly that. So on a live render the
 * figure on the button is the endpoint's, and the client arithmetic only breaks
 * it into rows.
 *
 * WHAT THE PHASED PLAN IS, AND IS NOT
 * ----------------------------------
 * It is not a deposit plan. `payment-options` returns `phased: { selfServe:
 * false }` with an informational per-phase breakdown and no deposit percentage
 * of any kind, and `POST .../sow/checkout` on `paymentPlan: "phased"` inserts an
 * `awaiting_provider_setup` agreement and returns `provider_setup` WITHOUT
 * calling Stripe. Nothing is charged. Every deposit figure, deposit percentage
 * and dated invoice term on this screen therefore lives behind `?preview=design`
 * and is drawn from the fixture; the live render says only what the endpoint
 * says.
 *
 * WHAT THE PAYMENT FORM ACTUALLY IS
 * ---------------------------------
 * A frame, and only a frame. This repository contains no Stripe Elements at all
 * (no `@stripe/react-stripe-js`, no `@stripe/stripe-js`, no `loadStripe`, no
 * `CardElement`/`PaymentElement`) — every payment path in the platform creates a
 * Checkout Session server-side and redirects to Stripe's hosted page. So the
 * field frames below are inert: they are `div`s, not inputs, and no card number
 * can enter this DOM even by accident. The real action posts to
 * `/api/portal/assessment/sow/checkout` and follows the `url` it returns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Check, Clock, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useVersionInfo } from "@/hooks/useVersionInfo";
import { reportClientEvent } from "@/lib/report-client-event";

import {
  CheckoutOrderSummary,
  type OrderAdjustmentRow,
  type OrderPhaseRow,
  type OrderRecurringRow,
} from "@/components/copilot-journey/CheckoutOrderSummary";
import {
  CheckoutPaymentChoice,
  type PaymentPlan,
  type PhasedTerms,
} from "@/components/copilot-journey/CheckoutPaymentChoice";
import { CheckoutKickoff } from "@/components/copilot-journey/CheckoutKickoff";
import {
  BrandMark,
  JourneyUnavailable,
  PreviewBadge,
} from "@/components/copilot-journey/JourneyPrimitives";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import { formatJourneyDate, tenantStrip } from "@/components/copilot-journey/journeyModel.ts";
import {
  computeTotals,
  depositAmountUsd,
  isPhaseIncluded,
  money,
  monthlyLabel,
  payInFullOfferFromWire,
  phasedSchedule,
  type JourneyPhase,
  type JourneyScopeInput,
  type JourneySelection,
  type PayInFullOffer,
  type ScheduleRow,
} from "@/components/copilot-journey/journeyPricing.ts";
import {
  journeyScopeFromSow,
  withAdjustments,
  type JourneyAdjustmentLine,
  type WireSowState,
} from "@/components/copilot-journey/journeyScopeFromSow.ts";
import {
  PREVIEW_DEPOSIT_PCT,
  PREVIEW_QUOTE_HOLD_DATE,
  PREVIEW_SCOPE,
  PREVIEW_SIGNER,
  PREVIEW_TENANT,
} from "@/components/copilot-journey/journeyPreviewFixture.ts";
import {
  BRAND,
  INK,
  JOURNEY_DESIGN_DOCUMENT_COUNT,
  PILLAR_KEYS,
  RADIUS,
  SEVERITY_ON_DARK,
  TABULAR,
  type PillarKey,
} from "@/components/copilot-journey/journeyTokens.ts";
import "@/components/copilot-journey/copilot-journey.css";

const JOURNEY_CHANNEL = "engine.dashboard";
const SOW_URL = "/api/portal/assessment/sow";
/** The cheapest existing source for the customer's real company name — the same
 *  endpoint Screen 3 reads, so the two headers cannot name the tenant
 *  differently across one navigation. */
const DASHBOARD_URL = "/api/portal/dashboard";
/** What the platform will actually charge, and on what terms. */
const PAYMENT_OPTIONS_URL = "/api/portal/assessment/sow/payment-options";
const PROPOSAL_ROUTE = "/copilot-readiness/proposal";
const DOCUMENTS_ROUTE = "/copilot-readiness/documents";

const CARD_BORDER = "1px solid rgba(30,41,59,.95)";

/* ------------------------------------------------------------------ *
 * The Screen 3 → Screen 4 handoff.
 *
 * Exported so the proposal writes exactly what this screen reads — one shape,
 * one key, declared once. `scope` is optional and preferred when present: it is
 * the snapshot of what the customer actually looked at while signing, which is
 * strictly more truthful than re-deriving the scope from a live endpoint that
 * may have moved underneath them.
 * ------------------------------------------------------------------ */

export const SIGNED_SCOPE_KEY = "cj_signed_scope";

export interface SignedScopeHandoff {
  readonly signerName: string;
  readonly role: string;
  /** `data:image/...` PNG from the signature pad. The server re-validates it. */
  readonly signatureData: string;
  readonly selection: JourneySelection;
  /** ISO timestamp of the signature. */
  readonly signedAt: string;
  /** Snapshot of the scope as signed. Preferred over a live re-fetch. */
  readonly scope?: JourneyScopeInput;
  /** ISO `pricing.validUntil` from the SOW payload — the real 30-day expiry. */
  readonly quoteHoldUntil?: string;
  /**
   * The platform's mandatory price lines as signed.
   *
   * They are NOT in `scope.phases` — `journeyScopeFromSow()` deliberately keeps
   * them out, because an adjustment is a price modifier rather than a workstream
   * and the server's integrity check compares workstream titles only. But their
   * money is unconditionally part of what is charged (`effectiveSowTotals()`),
   * so a checkout that ignored them would under-state the bill. Carried across
   * the handoff for that reason.
   */
  readonly adjustments?: readonly JourneyAdjustmentLine[];
}

function readSignedScope(): SignedScopeHandoff | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(SIGNED_SCOPE_KEY);
  } catch {
    // Private-mode / storage-disabled browsers throw on access rather than
    // returning null. Treated the same as "nothing was signed in this tab".
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignedScopeHandoff>;
    if (
      typeof parsed?.signerName !== "string" ||
      typeof parsed?.signatureData !== "string" ||
      typeof parsed?.signedAt !== "string" ||
      !parsed?.selection ||
      typeof parsed.selection !== "object"
    ) {
      return null;
    }
    return {
      signerName: parsed.signerName,
      role: typeof parsed.role === "string" ? parsed.role : "",
      signatureData: parsed.signatureData,
      selection: {
        phases: parsed.selection.phases ?? {},
        addons: parsed.selection.addons ?? {},
        tiers: parsed.selection.tiers ?? {},
      },
      signedAt: parsed.signedAt,
      scope: parsed.scope,
      quoteHoldUntil: typeof parsed.quoteHoldUntil === "string" ? parsed.quoteHoldUntil : undefined,
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : undefined,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Live scope, when the handoff did not carry one.
 *
 * The mapping itself is NOT written here. `slugify`, the pillar-inference table
 * and the SOW → phases mapper all live in `journeyScopeFromSow.ts`, shared with
 * the proposal, because both were verbatim copies and the phase id space is what
 * the signed selection is keyed by: two screens slugifying differently would read
 * every phase as deselected and bill for nothing.
 *
 * Adopting it also fixes the defect that made this screen unpayable. The local
 * copy pushed the platform's mandatory ADJUSTMENT lines into `scope.phases`, and
 * `submit()` sends every included phase title as `selectedWorkstreamTitles`;
 * server-side `adjustmentLinesOf` and `workstreamLinesOf` are disjoint and the
 * integrity check is exact set equality, so any tenant with a single adjustment
 * line got `409 {code:"scope_changed"}` — and the error told them to go back and
 * re-sign, which resubmitted the identical wrong set. An infinite loop on the
 * screen where money changes hands.
 * ------------------------------------------------------------------ */

interface CheckoutScope {
  /** Real workstreams only. Adjustments are money, not phases. */
  readonly scope: JourneyScopeInput;
  /** The platform's mandatory price lines. Always charged, never toggleable. */
  readonly adjustments: readonly JourneyAdjustmentLine[];
  readonly adjustmentsUsd: number;
  /** phase id → pillar. Absent where the platform does not say which. */
  readonly pillarById: Readonly<Partial<Record<string, PillarKey>>>;
  /** ISO date the quoted pricing holds until, when the platform provides one. */
  readonly quoteHoldIso: string | null;
  /** The platform's own record of what the active SOW includes. */
  readonly serverSelectedTitles: readonly string[] | null;
}

function scopeFromSowPayload(body: WireSowState): CheckoutScope | null {
  const built = journeyScopeFromSow(body);
  if (!built) return null;
  return {
    scope: built.scope,
    adjustments: built.adjustments,
    adjustmentsUsd: built.adjustmentsUsd,
    pillarById: built.pillarById,
    quoteHoldIso: built.quoteHoldIso,
    serverSelectedTitles: built.serverSelectedTitles,
  };
}

function scopeFromHandoff(
  scope: JourneyScopeInput,
  adjustments: readonly JourneyAdjustmentLine[] = [],
  quoteHoldUntil?: string,
): CheckoutScope {
  const pillarById: Record<string, PillarKey> = {};
  scope.phases.forEach((p) => {
    // A handed-across scope carries a real pillar per phase — the proposal took
    // it from the same payload it drew the phase card from.
    if ((PILLAR_KEYS as readonly string[]).includes(p.pillar)) pillarById[p.id] = p.pillar;
  });
  return {
    scope,
    adjustments,
    adjustmentsUsd: adjustments.reduce((sum, a) => sum + a.priceUsd, 0),
    pillarById,
    quoteHoldIso: quoteHoldUntil ?? null,
    serverSelectedTitles: null,
  };
}

/* ------------------------------------------------------------------ *
 * What the platform will actually charge.
 *
 * `GET /portal/assessment/sow/payment-options` — the endpoint whose own header
 * comment reads "Everything the payment step needs", and which this screen was
 * not calling at all. It is the only source for four things the checkout cannot
 * honestly invent: the effective `total` the server charges, the active
 * document's `selectedWorkstreamTitles` (what the integrity check compares
 * against), the real `pricing.validUntil`, and the phased terms — which are
 * `selfServe: false` with an informational breakdown and NO deposit percentage.
 * ------------------------------------------------------------------ */

interface WirePaymentOptions {
  readonly ready?: boolean;
  /** Selected workstreams + all adjustments, in dollars. What Stripe charges. */
  readonly total?: number;
  readonly adjustmentsTotal?: number;
  readonly selectedWorkstreamTitles?: readonly string[];
  readonly pricing?: { readonly validUntil?: string };
  /**
   * The live pay-in-full discount. Real money: the server builds a genuine
   * Stripe coupon from it, but only when the checkout request opts in with
   * `applyPayInFull`. Every field is the server's own — nothing here is
   * recomputed client-side, because a second arithmetic path on a discount is a
   * second chance to quote a figure Stripe will not honour.
   */
  readonly payInFull?: {
    readonly active?: boolean;
    readonly discountedTotal?: number | null;
    readonly savings?: number | null;
    readonly variant?: "percentage_off" | "adjustments_waived" | null;
    readonly discountPct?: number | null;
  };
  readonly phased?: {
    /** Always false today: milestone billing is provider-arranged. */
    readonly selfServe?: boolean;
    readonly phases?: readonly { readonly title: string; readonly amount: number }[];
    readonly total?: number;
  };
}

/**
 * The server's own scope key, character for character.
 *
 * `normalizeSet` in `portal-assessment.ts` is `[...new Set(titles)].sort().join("")`.
 * Reproduced exactly rather than approximated, because this decides whether the
 * screen believes the signed scope still matches the active document — and a
 * separator the server does not use could disagree with the server's own verdict.
 */
function normalizeTitleSet(titles: readonly string[]): string {
  return [...new Set(titles)].sort().join("");
}

/**
 * The selection to bill against.
 *
 * The handed selection is the customer's own, and it wins whenever its phase ids
 * belong to this scope. When the scope had to be rebuilt from the SOW endpoint
 * the two id spaces can genuinely differ, and a selection whose keys match
 * nothing would silently zero the order — so that case falls back to the
 * platform's own record of the active SOW, which is what the server will check
 * the submission against anyway.
 */
function reconcileSelection(
  built: CheckoutScope,
  handed: JourneySelection,
): JourneySelection {
  const ids = new Set(built.scope.phases.map((p) => p.id));
  const overlaps = Object.keys(handed.phases).some((k) => ids.has(k));
  if (overlaps) return handed;

  const serverTitles = new Set(built.serverSelectedTitles ?? []);
  const phases: Record<string, boolean> = {};
  built.scope.phases.forEach((p) => {
    // Keyed on the title, because `selectedWorkstreamTitles` is the platform's
    // own id space — the slug only exists on this side of the wire.
    phases[p.id] = serverTitles.size > 0 ? serverTitles.has(p.title) : true;
  });
  return { phases, addons: {}, tiers: {} };
}

/* ------------------------------------------------------------------ *
 * CAPTCHA — the same Cloudflare Turnstile gate every other real checkout in
 * this app uses, with the same dev bypass the server's `verifyCaptchaToken`
 * honours when Turnstile is unconfigured. No token can be produced client-side
 * without it, and inventing one would be rejected server-side anyway.
 * ------------------------------------------------------------------ */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void },
  ) => string;
  remove: (widgetId: string) => void;
}

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

function CaptchaGate({ onVerify }: { readonly onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) {
      onVerify("DEV_BYPASS_TOKEN");
      return undefined;
    }
    if (!turnstileApi()) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    let widgetId: string | undefined;
    let cancelled = false;
    let retry: number | undefined;
    const renderWidget = () => {
      if (cancelled) return;
      const api = turnstileApi();
      if (api && containerRef.current) {
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
        });
      } else {
        retry = window.setTimeout(renderWidget, 100);
      }
    };
    renderWidget();
    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
      const api = turnstileApi();
      if (widgetId && api) api.remove(widgetId);
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />;
}

/* ------------------------------------------------------------------ *
 * Payment details — a frame around nothing.
 * ------------------------------------------------------------------ */

/**
 * A field frame that cannot take input, because it is not an input.
 *
 * The design draws Stripe's own field arrangement so the customer recognises
 * what is coming. Rendering real `<input>`s here — even disabled ones — would
 * put a box on screen that looks like it takes a card number while silently
 * discarding it. These are `div`s: there is no value to discard, and no card
 * data can reach this origin.
 */
function FieldFrame({
  hint,
  radius,
  borderLeft = true,
}: {
  readonly hint: string;
  readonly radius: string;
  readonly borderLeft?: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: "rgba(2,6,23,.7)",
        border: "1px solid rgba(51,65,85,.9)",
        borderLeft: borderLeft ? "1px solid rgba(51,65,85,.9)" : "none",
        borderRadius: radius,
        padding: "9px 11px",
        fontSize: 13.5,
        fontWeight: 500,
        color: INK.deemphasised,
        minHeight: 38,
      }}
    >
      {hint}
    </div>
  );
}

function FieldLabel({ children }: { readonly children: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: INK.bodyDark,
      }}
    >
      {children}
    </span>
  );
}

function PaymentDetailsFrame() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          Payment details
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Lock size={12} strokeWidth={2} color={INK.micro} aria-hidden="true" />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: INK.micro }}>
            Processed by Stripe
          </span>
        </span>
      </div>
      <div
        style={{
          border: CARD_BORDER,
          borderRadius: RADIUS.cardLarge,
          background: "rgba(15,23,42,.5)",
          padding: "20px 20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Hidden from assistive tech wholesale: a screen reader announcing
            "Email, edit text" over something that is not a control would be a
            worse lie than the visual one. The sentence below is what AT reads
            instead, and it is the truth. */}
        <div
          aria-hidden="true"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <FieldLabel>Email</FieldLabel>
            <FieldFrame hint="Collected on Stripe" radius={`${RADIUS.control}px`} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <FieldLabel>Card information</FieldLabel>
            <FieldFrame
              hint="1234 1234 1234 1234"
              radius={`${RADIUS.control}px ${RADIUS.control}px 0 0`}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginTop: -1 }}>
              <FieldFrame hint="MM / YY" radius={`0 0 0 ${RADIUS.control}px`} />
              <FieldFrame hint="CVC" radius={`0 0 ${RADIUS.control}px 0`} borderLeft={false} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <FieldLabel>Name on card</FieldLabel>
            <FieldFrame hint="Collected on Stripe" radius={`${RADIUS.control}px`} />
          </div>
        </div>
        {/* Said out loud, not just in a code comment: the fields above are a
            preview of Stripe's page, not our form. */}
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
          These are placeholders. Card entry opens on Stripe's own hosted page when you confirm —
          nothing you type could be captured here.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function CopilotReadinessCheckoutPage() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const isPreview = params.get("preview") === "design";
  const returnedPaid = params.get("checkout_status") === "success";

  const [, navigate] = useLocation();
  const { fetchWithAuth, accessToken, logout } = useAuth();
  const versionInfo = useVersionInfo();

  // Carry `?preview=design` across every link out of this screen, so a design
  // review does not silently drop back onto live data one navigation later.
  // `checkout_status` deliberately does NOT travel — it is a statement about a
  // Stripe return to THIS route and would be a lie anywhere else.
  const withSearch = useCallback(
    (path: string) => (isPreview ? `${path}?preview=design` : path),
    [isPreview],
  );

  // The tenant's real company name, from the same endpoint Screen 3 reads.
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    fetchWithAuth(DASHBOARD_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        // Non-fatal — `tenantStrip()` degrades to the generic label.
      });
    return () => {
      cancelled = true;
    };
  }, [isPreview, fetchWithAuth]);

  const journeyOptions = useMemo(() => ({ tenantName: customerName }), [customerName]);
  const { view } = useCopilotJourney(journeyOptions);

  const [reducedMotion] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // The signed handoff is read once. It is a snapshot of an event that already
  // happened, so re-reading it on every render would only invite it to change
  // underneath a screen whose entire job is to be stable.
  const [signed] = useState<SignedScopeHandoff | null>(() => readSignedScope());

  const [plan, setPlan] = useState<PaymentPlan>("full");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paid, setPaid] = useState(returnedPaid);
  const [settledMessage, setSettledMessage] = useState<string | null>(null);

  const [liveScope, setLiveScope] = useState<CheckoutScope | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const [payOptions, setPayOptions] = useState<WirePaymentOptions | null>(null);

  const onCaptchaVerify = useCallback((token: string) => setCaptchaToken(token), []);

  /* -- Scope ------------------------------------------------------- */

  // The scope is fetched whenever the handoff did not carry one — including on a
  // return from Stripe in a tab that never held the handoff, where it is the only
  // way the kickoff can name the phase that starts in Week 1.
  const needsLiveScope = !isPreview && signed?.scope == null && (signed != null || returnedPaid);

  useEffect(() => {
    if (!needsLiveScope) {
      setScopeLoaded(true);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SOW_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`sow ${res.status}`);
        const body = (await res.json()) as WireSowState;
        if (!cancelled) setLiveScope(scopeFromSowPayload(body));
      } catch (e) {
        if (!cancelled) {
          reportClientEvent(
            accessToken,
            "CopilotCheckoutScopeFetchFailed",
            e instanceof Error ? e.message : String(e),
            JOURNEY_CHANNEL,
            { screen: "checkout" },
          );
        }
      } finally {
        if (!cancelled) setScopeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsLiveScope, fetchWithAuth, accessToken]);

  /**
   * The payment terms, from the platform rather than from a fixture.
   *
   * Fetched on every live render that could pay — the deposit percentage this
   * screen used to print came from `journeyPreviewFixture.ts` and was ungated,
   * so a real customer saw a 40% deposit, a deposit button and a deposit
   * schedule that no part of the platform has ever produced. Whatever this
   * returns is what gets rendered; whatever it does not return is not rendered.
   */
  useEffect(() => {
    if (isPreview || !signed) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(PAYMENT_OPTIONS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`payment-options ${res.status}`);
        const body = (await res.json()) as WirePaymentOptions;
        if (!cancelled && body?.ready === true) setPayOptions(body);
      } catch (e) {
        if (!cancelled) {
          // Non-fatal, and deliberately not backfilled: the deposit terms simply
          // stay unstated rather than reverting to the fixture's numbers.
          reportClientEvent(
            accessToken,
            "CopilotCheckoutPaymentOptionsFetchFailed",
            e instanceof Error ? e.message : String(e),
            JOURNEY_CHANNEL,
            { screen: "checkout" },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPreview, signed, fetchWithAuth, accessToken]);

  const checkoutScope: CheckoutScope | null = useMemo(() => {
    if (isPreview) return scopeFromHandoff(PREVIEW_SCOPE);
    if (signed?.scope) {
      return scopeFromHandoff(signed.scope, signed.adjustments ?? [], signed.quoteHoldUntil);
    }
    return liveScope;
  }, [isPreview, signed, liveScope]);

  const selection: JourneySelection | null = useMemo(() => {
    if (!checkoutScope) return null;
    if (isPreview) {
      // The preview has no signed handoff to reconcile against, so it renders
      // the fixture's own default scope — every phase, monitoring on.
      const phases: Record<string, boolean> = {};
      PREVIEW_SCOPE.phases.forEach((p) => {
        phases[p.id] = true;
      });
      const addons: Record<string, boolean> = {};
      const tiers: Record<string, string> = {};
      PREVIEW_SCOPE.addons.forEach((a) => {
        addons[a.id] = a.defaultOn;
        if (a.defaultTierId) tiers[a.id] = a.defaultTierId;
      });
      return { phases, addons, tiers };
    }
    // No handoff (a Stripe return in a fresh tab) means no signed selection to
    // honour, and the empty one below falls straight through to the platform's
    // own record of the active SOW inside `reconcileSelection`.
    return reconcileSelection(
      checkoutScope,
      signed?.selection ?? { phases: {}, addons: {}, tiers: {} },
    );
  }, [checkoutScope, isPreview, signed]);

  /**
   * ONE arithmetic, derived once, exactly as the proposal derives it.
   *
   * `computeTotals()` sums the selected workstreams and any optional service;
   * `withAdjustments()` folds in the platform's mandatory price lines, which is
   * precisely what `effectiveSowTotals()` does server-side before it charges.
   * Every figure on this screen reads this object.
   */
  const totals = useMemo(
    () =>
      checkoutScope && selection
        ? withAdjustments(
            computeTotals(checkoutScope.scope, selection),
            checkoutScope.adjustmentsUsd,
          )
        : null,
    [checkoutScope, selection],
  );

  const includedPhases: readonly JourneyPhase[] = useMemo(() => {
    if (!checkoutScope || !selection) return [];
    return checkoutScope.scope.phases.filter((p) =>
      isPhaseIncluded(checkoutScope.scope, selection, p.id),
    );
  }, [checkoutScope, selection]);

  const phaseRows: OrderPhaseRow[] = useMemo(
    () =>
      includedPhases.map((p) => ({
        id: p.id,
        title: p.title,
        pillar: checkoutScope?.pillarById[p.id] ?? null,
        priceUsd: p.priceUsd,
      })),
    [includedPhases, checkoutScope],
  );

  const recurringRows: OrderRecurringRow[] = useMemo(() => {
    if (!checkoutScope || !selection) return [];
    const rows: OrderRecurringRow[] = [];
    checkoutScope.scope.addons.forEach((a) => {
      if (!selection.addons[a.id]) return;
      const tier = a.tiers.find((t) => t.id === selection.tiers[a.id]) ?? a.tiers[0];
      if (!tier || tier.monthlyUsd <= 0) return;
      rows.push({
        id: a.id,
        // A single-tier service names itself; a multi-tier one has to say which
        // tier, because that is the number being charged.
        title: a.tiers.length > 1 ? `${a.title} · ${tier.label}` : a.title,
        detail: `Recurring · ${tier.detail} · cancel with 30 days`,
        monthlyUsd: tier.monthlyUsd,
      });
    });
    return rows;
  }, [checkoutScope, selection]);

  const adjustmentRows: OrderAdjustmentRow[] = useMemo(
    () =>
      (checkoutScope?.adjustments ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        scope: a.scope,
        priceUsd: a.priceUsd,
      })),
    [checkoutScope],
  );

  const recurringNames = useMemo(() => recurringRows.map((r) => r.title), [recurringRows]);

  /** Workstreams + mandatory adjustments — the one-off side of the order. */
  const oneOffUsd = totals?.oneOffUsd ?? 0;
  const monthlyUsd = totals?.monthlyUsd ?? 0;

  /**
   * The whole order, in dollars — what pay-in-full charges today, and what the
   * phased plan is invoiced for across its phases. One figure, because it is one
   * scope; only the timing differs between the plans.
   *
   * The server's `total` wins whenever the endpoint has answered, because
   * `computePayInFullOffer()` charges that exact figure — the client arithmetic
   * only exists to break it into rows. They agree by construction (same lines,
   * same rule); preferring the server's means a screen showing a number the
   * customer is about to be charged is showing the charged number.
   */
  const orderTotalUsd =
    !isPreview && typeof payOptions?.total === "number"
      ? payOptions.total
      : totals?.upfrontUsd ?? 0;

  /**
   * The live pay-in-full discount, or null.
   *
   * Never constructed under `?preview=design`: the offer depends on a real
   * `coupons` row and the SOW's real discount window, neither of which a design
   * fixture has, and inventing a saving on the preview would put a number in
   * front of a reviewer that no customer will ever be charged.
   *
   * Built only from fields the server actually sent, and only when it says
   * `active`. `savings > 0` is re-checked because a zero-saving "active" offer
   * would otherwise print a struck-through price identical to the one beside it.
   */
  const payInFullOffer = useMemo<PayInFullOffer | null>(
    () => payInFullOfferFromWire(payOptions?.payInFull, orderTotalUsd, isPreview),
    [isPreview, payOptions, orderTotalUsd],
  );

  /**
   * The phased terms.
   *
   * PREVIEW ONLY gets the deposit variant, and every figure in it comes from
   * `PREVIEW_DEPOSIT_PCT` in the fixture. The platform produces no deposit
   * percentage anywhere — not on `payment-options`, not on the agreement row —
   * so the live variant carries no deposit, no "today" amount and no dated
   * invoice terms. Its breakdown is the server's own `phased.phases`, falling
   * back to the signed rows so the panel still adds up when the endpoint has not
   * answered; either way it is labelled indicative, which is what the endpoint
   * calls it.
   */
  const phasedTerms: PhasedTerms = useMemo(() => {
    if (isPreview) {
      return {
        kind: "deposit",
        depositUsd: totals ? depositAmountUsd(totals, PREVIEW_DEPOSIT_PCT) : 0,
        depositPct: PREVIEW_DEPOSIT_PCT,
        schedule:
          checkoutScope && selection
            ? phasedSchedule(checkoutScope.scope, selection, PREVIEW_DEPOSIT_PCT)
            : [],
      };
    }
    const serverPhases = payOptions?.phased?.phases;
    const rows: ScheduleRow[] = serverPhases?.length
      ? serverPhases.map((p) => ({ when: p.title, amountUsd: Number(p.amount) || 0 }))
      : includedPhases.map((p) => ({ when: p.title, amountUsd: p.priceUsd }));
    // The server's breakdown lists workstreams only, so the adjustments are
    // added back as their own row rather than left out — a breakdown that does
    // not reach the total is worse than no breakdown.
    const adjustmentsUsd = checkoutScope?.adjustmentsUsd ?? 0;
    if (rows.length > 0 && adjustmentsUsd > 0) {
      rows.push({ when: "Included adjustments", amountUsd: adjustmentsUsd });
    }
    return { kind: "provider", totalUsd: orderTotalUsd, schedule: rows };
  }, [isPreview, totals, checkoutScope, selection, payOptions, includedPhases, orderTotalUsd]);

  /* -- Copy that depends on the numbers ---------------------------- */

  // The preview signs on the same day it scans — that is the prototype's own
  // "SOW signed 3 August 2026", and the fixture holds that date once rather than
  // twice, so the header reads it from `scannedOn`.
  const signedDate = isPreview
    ? PREVIEW_TENANT.scannedOn
    : formatJourneyDate(signed?.signedAt ?? null);
  const signerLine = isPreview
    ? PREVIEW_SIGNER
    : [signed?.signerName, signed?.role].filter((s) => Boolean(s && s.trim())).join(", ");

  /**
   * The real 30-day unpaid-SOW expiry — `pricing.validUntil`, from whichever
   * endpoint answered.
   *
   * There is NO computed fallback. `VALIDITY_WINDOW_MS` is anchored server-side
   * to the earliest real SOW row, not to the signature, so "signed date + 30
   * days" overstates the hold by however long the customer took to sign — and
   * the sentence it feeds tells them how long their price is held. Better to say
   * nothing than to quote a date the platform would not honour.
   */
  const quoteHoldLabel = useMemo(() => {
    if (isPreview) return PREVIEW_QUOTE_HOLD_DATE;
    const iso = checkoutScope?.quoteHoldIso ?? payOptions?.pricing?.validUntil ?? null;
    return iso ? formatJourneyDate(iso) : null;
  }, [isPreview, checkoutScope, payOptions]);

  const tenantName = isPreview ? PREVIEW_TENANT.name : view.tenant.name;
  const tenantLine = isPreview ? tenantStrip(PREVIEW_TENANT) : tenantStrip(view.tenant);

  /** Whether this render's chosen plan actually opens a card form on Stripe. */
  const showsCardEntry = isPreview || plan === "full";

  /**
   * The action rail.
   *
   * Pay-in-full is a real Stripe charge and says so, at the server's own figure.
   *
   * The live phased branch says nothing of the sort, because the platform makes
   * NO charge on it: `POST .../sow/checkout` inserts an
   * `awaiting_provider_setup` agreement and returns `provider_setup` without a
   * Stripe call anywhere in the branch. "Deposit today · $14,480 · Pay $14,480
   * deposit" described a payment that does not exist and an amount nobody had
   * quoted, on the one button in this journey that takes money. So the live
   * label names what the button does — record the signed plan — and the figure
   * beside it is the programme total, explicitly not a charge. The design's
   * deposit CTA survives under `?preview=design`, where the money is fictional.
   */
  const payCopy = useMemo(() => {
    if (plan === "full") {
      return {
        label: "Charged today",
        now: money(orderTotalUsd),
        sub:
          monthlyUsd > 0
            ? `Then ${money(monthlyUsd)} a month for ${recurringNames.join(" + ")}`
            : "One charge, nothing recurring.",
        foot:
          monthlyUsd > 0
            ? "One charge now. Monitoring starts billing at kickoff."
            : "One charge now.",
        btnLabel: `Pay ${money(orderTotalUsd)} and start`,
      };
    }
    if (isPreview) {
      const depositUsd = totals ? depositAmountUsd(totals, PREVIEW_DEPOSIT_PCT) : 0;
      return {
        label: "Deposit today",
        now: money(depositUsd),
        sub: `${money(oneOffUsd - depositUsd)} invoiced across phase sign-offs`,
        foot: "Deposit now. Every later invoice follows a phase you have signed off.",
        btnLabel: `Pay ${money(depositUsd)} deposit`,
      };
    }
    return {
      label: "Programme total",
      now: money(orderTotalUsd),
      sub: "Invoiced phase by phase, not charged here",
      foot: "Nothing is charged now. Confirming records your signed statement of work and hands it to your provider, who arranges billing for each phase.",
      btnLabel: "Confirm phased plan",
    };
  }, [plan, isPreview, totals, oneOffUsd, monthlyUsd, orderTotalUsd, recurringNames]);

  /**
   * The line the kickoff opens with.
   *
   * Pay-in-full is a real charge, so it says so. The phased plan is NOT charged
   * by this platform — `POST .../sow/checkout` records the signed agreement and
   * returns `provider_setup` without ever touching Stripe — so on a live phased
   * settlement `settledMessage` is always populated and always wins. The
   * prototype's "your deposit is paid" sentence is therefore reachable only
   * under `?preview=design`, where the amount is fixture money and no charge of
   * any kind occurred; printing it on a live phased confirmation would describe
   * a payment that did not happen.
   */
  const paidLine = useMemo(() => {
    if (settledMessage) return settledMessage;
    if (!totals) return null;
    if (isPreview && plan === "phased") {
      const depositUsd = depositAmountUsd(totals, PREVIEW_DEPOSIT_PCT);
      return `Your ${money(depositUsd)} deposit is paid and the engagement is open. The remaining ${money(
        oneOffUsd - depositUsd,
      )} invoices only as you sign off each phase.`;
    }
    return `${money(orderTotalUsd)} is paid in full and the engagement is open.`;
  }, [settledMessage, totals, isPreview, plan, oneOffUsd, orderTotalUsd]);

  const firstPhase = includedPhases.length
    ? { title: includedPhases[0].title, scope: includedPhases[0].scope }
    : null;

  /**
   * How many reports this tenant's assessment actually produces. `null` when the
   * platform has not said — `JOURNEY_DESIGN_DOCUMENT_COUNT` is the DESIGN's list
   * and an earlier revision had titles with no seeded `document_types` row
   * behind them, so it never reaches a live confirmation.
   */
  const documentCount = isPreview
    ? JOURNEY_DESIGN_DOCUMENT_COUNT
    : view.generation.total > 0
      ? view.generation.total
      : null;

  /* -- Does the signed scope still match the active document? ------- */

  /**
   * The titles this checkout will submit.
   *
   * Real workstreams only. Adjustments are excluded by construction now that
   * `journeyScopeFromSow()` keeps them out of `scope.phases`; the extra
   * `!p.locked` filter is belt-and-braces against a handed-across scope built by
   * an older proposal build that still marked rows locked.
   */
  const signedWorkstreamTitles = useMemo(
    () => includedPhases.filter((p) => !p.locked).map((p) => p.title),
    [includedPhases],
  );

  /** The platform's own record, from whichever endpoint answered. */
  const serverWorkstreamTitles: readonly string[] | null =
    payOptions?.selectedWorkstreamTitles ?? checkoutScope?.serverSelectedTitles ?? null;

  /**
   * The signature binds to a scope; the server charges the active document's.
   *
   * Screen 3's phase toggles are local — nothing posts to
   * `POST /portal/assessment/sow/select` — so a customer who de-scopes and signs
   * has a signed set the active document does not have. Submitting that is a
   * guaranteed `409 scope_changed`; submitting the SERVER's set instead would be
   * worse, silently charging for phases they removed. Neither is acceptable on a
   * payment screen, so the mismatch is stated and the order is not rendered at
   * signed prices that are not the prices.
   */
  // Compared unconditionally once the server has answered. An earlier version
  // also required `signedWorkstreamTitles.length > 0`, which left the worst case
  // unguarded: a customer who de-selects EVERY phase signs an empty set, the
  // empty set is not flagged, and the submit falls through to posting the
  // server's full list — so the screen shows an empty order and the server
  // charges `effectiveSowTotals` for the whole scope. That is precisely the
  // "order priced at numbers that are not the numbers" this guard exists to stop.
  const scopeDiverged =
    !isPreview &&
    serverWorkstreamTitles != null &&
    normalizeTitleSet(signedWorkstreamTitles) !== normalizeTitleSet(serverWorkstreamTitles);

  /* -- Submit ------------------------------------------------------ */

  const previewTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (previewTimer.current !== undefined) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  /**
   * Latched the moment a Stripe redirect is committed, and never cleared.
   *
   * `window.location.href = url` does not stop React: the assignment returns,
   * the `finally` runs, `setSubmitting(false)` tears down the "Confirming with
   * Stripe" overlay and re-enables the button — all while the navigation is
   * still in flight. A second click in that window creates a SECOND Checkout
   * Session and a second `pending_payment` agreement row against the same
   * document. So the redirect path keeps the overlay up and the button disabled
   * until the browser actually leaves.
   */
  const redirecting = useRef(false);

  const submit = useCallback(async () => {
    if (submitting || redirecting.current || !checkoutScope || !selection) return;

    // The design preview has no tenant, no signature and no agreement to record.
    // It plays the same two beats the prototype does so the composition can be
    // reviewed end to end, and it never touches a payment endpoint.
    if (isPreview) {
      setSubmitting(true);
      previewTimer.current = window.setTimeout(() => {
        setSubmitting(false);
        setPaid(true);
      }, 1700);
      return;
    }

    if (!signed || !captchaToken || scopeDiverged) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetchWithAuth("/api/portal/assessment/sow/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaToken,
          paymentPlan: plan,
          // Opt in to the discount the screen just showed. The server re-runs
          // `computePayInFullOffer` and ignores this unless the offer is
          // genuinely live for this scope right now, so the flag can only ever
          // ask — it cannot assert. Sent only when there IS an offer, so a
          // request that would produce no coupon does not claim to want one.
          ...(payInFullOffer && plan === "full" ? { applyPayInFull: true } : {}),
          signatureData: signed.signatureData,
          signerName: signed.signerName,
          // WORKSTREAMS ONLY. The server's integrity check is exact set equality
          // against `workstreamTitlesOf(activeDoc)`, and `adjustmentLinesOf` is
          // a disjoint set — one adjustment title in here and the customer can
          // never pay. The platform's own list is preferred where it is known
          // (the same thing `AssessmentPaymentPlan.tsx` submits) and is
          // guaranteed equal to the signed list by the divergence guard above.
          selectedWorkstreamTitles: serverWorkstreamTitles
            ? [...serverWorkstreamTitles]
            : signedWorkstreamTitles,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        outcome?: string;
        url?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setActionError(
          data.code === "scope_changed"
            ? "Your scope changed since you signed it. Go back to the proposal and sign the current version."
            : data.error ?? "We couldn't start that payment just now. Please try again.",
        );
        reportClientEvent(
          accessToken,
          "CopilotCheckoutRejected",
          data.error ?? `checkout ${res.status}`,
          JOURNEY_CHANNEL,
          { screen: "checkout", plan, status: res.status, code: data.code ?? null },
        );
        return;
      }
      if (data.outcome === "checkout" && data.url) {
        // Hosted Stripe Checkout. The card is entered there, never here. The
        // latch goes up BEFORE the assignment so the `finally` below cannot
        // re-open the button underneath a navigation that is already committed.
        redirecting.current = true;
        window.location.href = data.url;
        return;
      }
      // `provider_setup` (phased) and `free_activated` ($0 scope) settle inline
      // with no redirect — the design's own post-payment state, reached without
      // ever leaving this screen. The fallback is never null on purpose: an
      // empty `message` must not let the kickoff fall back to "paid in full".
      setSettledMessage(
        data.message ??
          "Your statement of work is signed. Your provider will be in touch to set up billing for each phase.",
      );
      setPaid(true);
    } catch (e) {
      setActionError("We couldn't start that payment just now. Please try again.");
      reportClientEvent(
        accessToken,
        "CopilotCheckoutFailed",
        e instanceof Error ? e.message : String(e),
        JOURNEY_CHANNEL,
        { screen: "checkout", plan },
      );
    } finally {
      // Deliberately NOT unconditional — see `redirecting` above.
      if (!redirecting.current) setSubmitting(false);
    }
  }, [
    submitting,
    checkoutScope,
    selection,
    isPreview,
    signed,
    captchaToken,
    plan,
    scopeDiverged,
    payInFullOffer,
    serverWorkstreamTitles,
    signedWorkstreamTitles,
    fetchWithAuth,
    accessToken,
  ]);

  /* -- Render ------------------------------------------------------ */

  const header = (
    <div
      style={{
        borderBottom: `1px solid ${INK.hairlineDark}`,
        padding: "15px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <BrandMark size={30} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: INK.micro,
            }}
          >
            Checkout
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: BRAND.offWhite,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tenantLine}
          </span>
        </div>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 18, flex: "none" }}>
        {signedDate && signerLine ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={13} strokeWidth={2.4} color={SEVERITY_ON_DARK.healthy} aria-hidden="true" />
            <span style={{ fontSize: 12, fontWeight: 600, color: INK.bodyDark }}>
              {`SOW signed ${signedDate} by ${signerLine}`}
            </span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: INK.micro,
            background: "none",
            border: 0,
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Sign out
        </button>
      </span>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <div
      className="cj-dark"
      style={{ minHeight: "100vh", background: BRAND.canvas, paddingBottom: 76 }}
    >
      {isPreview ? <PreviewBadge /> : null}
      {header}
      {children}
      <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 500, color: INK.deemphasised }}>
          v{versionInfo.display}
        </span>
      </div>
    </div>
  );

  // Nothing signed, nothing to confirm. This is the whole guard: a checkout is
  // only ever a confirmation of a signature that already exists.
  if (!isPreview && !signed && !returnedPaid) {
    return shell(
      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "38px 24px 0" }}>
        <JourneyUnavailable
          testId="cj-checkout-no-signed-scope"
          title="There is no signed scope to pay for yet."
          detail="Checkout confirms a statement of work you have already signed. Open your proposal, choose the phases you want and sign it — this screen will have something to confirm the moment you do."
          action={
            <Link href={withSearch(PROPOSAL_ROUTE)} style={{ fontSize: 13, fontWeight: 600 }}>
              Go to your proposal
            </Link>
          }
        />
      </div>,
    );
  }

  if (paid) {
    return shell(
      <CheckoutKickoff
        tenantName={tenantName}
        paidLine={paidLine}
        firstPhase={firstPhase}
        documentsHref={withSearch(DOCUMENTS_ROUTE)}
        documentCount={documentCount}
        // A receipt follows a charge. The only live path that charges is the
        // Stripe return; `provider_setup` and `free_activated` both settle here
        // without one, and both populate `settledMessage`.
        receiptExpected={isPreview || (returnedPaid && !settledMessage)}
        reducedMotion={reducedMotion}
      />,
    );
  }

  // The scope is signed but the platform has not handed one over — a real state
  // while `/portal/assessment/sow` is in flight, and a terminal one if the
  // active SOW document has gone away underneath the signature.
  if (!checkoutScope || !selection || !totals) {
    return shell(
      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "38px 24px 0" }}>
        {scopeLoaded ? (
          <JourneyUnavailable
            title="We can't find the scope you signed."
            detail="Your signature is recorded, but the statement of work behind it is no longer the active version. Reopen the proposal to check the current scope before paying."
            action={
              <Link href={withSearch(PROPOSAL_ROUTE)} style={{ fontSize: 13, fontWeight: 600 }}>
                Back to the proposal
              </Link>
            }
          />
        ) : (
          <span style={{ fontSize: 13, fontWeight: 500, color: INK.micro }}>
            Loading your signed scope…
          </span>
        )}
      </div>,
    );
  }

  // The signature is against one set of phases and the platform holds another.
  // Every price below would be the wrong price, and the submission would be
  // rejected outright — so the screen says which, rather than showing an order
  // it cannot honour.
  if (scopeDiverged) {
    return shell(
      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "38px 24px 0" }}>
        <JourneyUnavailable
          title="The scope on file is not the scope you signed."
          detail="Your statement of work has moved since you signed it, so the phases and the total on this screen would not be the ones charged. Reopen the proposal — it loads the version your provider currently holds — and sign that."
          action={
            <Link href={withSearch(PROPOSAL_ROUTE)} style={{ fontSize: 13, fontWeight: 600 }}>
              Review the current scope
            </Link>
          }
        />
      </div>,
    );
  }

  return shell(
    <>
      <div
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          padding: "38px 24px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: "30px 36px",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            flex: "1 1 480px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                color: INK.link,
              }}
            >
              Confirm and pay
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(25px,2.9vw,34px)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.16,
                color: BRAND.offWhite,
                textWrap: "pretty",
              }}
            >
              Everything below is exactly what you signed.
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: "60ch",
                fontSize: 15,
                fontWeight: 500,
                lineHeight: 1.6,
                color: INK.bodyDark,
                textWrap: "pretty",
              }}
            >
              Scope is locked here. If something needs changing, go back to the proposal — nothing
              on this screen adjusts what you are buying.
            </p>
          </div>

          <CheckoutOrderSummary
            phases={phaseRows}
            recurring={recurringRows}
            adjustments={adjustmentRows}
          />

          <CheckoutPaymentChoice
            plan={plan}
            onPlan={setPlan}
            payInFullUsd={orderTotalUsd}
            payInFullOffer={payInFullOffer}
            phased={phasedTerms}
            hasRecurring={monthlyUsd > 0}
          />

          {/* No card is entered on a live phased plan — that branch records an
              agreement and never opens Stripe — so the card frame and the
              Stripe reassurance beside it are not drawn for it. A payment form
              above a button that takes no payment is the same lie as the button
              label, told in pictures. */}
          {showsCardEntry ? <PaymentDetailsFrame /> : null}
        </div>

        <div
          style={{
            flex: "1 1 300px",
            minWidth: 0,
            position: "sticky",
            top: 26,
            display: "flex",
            flexDirection: "column",
            gap: 13,
          }}
        >
          <div
            style={{
              border: "1px solid rgba(0,120,212,.4)",
              borderRadius: RADIUS.panel,
              background: "linear-gradient(160deg,rgba(0,120,212,.12),rgba(15,23,42,.7))",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".22em",
                  textTransform: "uppercase",
                  color: INK.micro,
                }}
              >
                {payCopy.label}
              </span>
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  letterSpacing: "-0.035em",
                  lineHeight: 1,
                  color: BRAND.offWhite,
                  ...TABULAR,
                }}
              >
                {payCopy.now}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
                {payCopy.sub}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                paddingTop: 16,
                borderTop: `1px solid ${INK.hairlineDark}`,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
                  Remediation total
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: BRAND.offWhite, ...TABULAR }}
                >
                  {money(oneOffUsd)}
                </span>
              </span>
              {monthlyUsd > 0 ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
                    {`${recurringNames.join(" + ")}, from month one`}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.teal, ...TABULAR }}>
                    {monthlyLabel(monthlyUsd)}
                  </span>
                </span>
              ) : null}
              {/* The design's third row — "Offset by reclaimed licences
                  −$18,400/yr" — is not rendered. The platform has no typed
                  annual-saving figure for this tenant; the only place that
                  number exists is prose inside the licensing pillar's headline,
                  and parsing a currency out of display text to print it as a
                  financial offset on a screen someone pays from is exactly the
                  fabrication this journey refuses. */}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                paddingTop: 16,
                borderTop: `1px solid ${INK.hairlineDark}`,
              }}
            >
              {!isPreview ? <CaptchaGate onVerify={onCaptchaVerify} /> : null}
              {actionError ? (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.5,
                    color: SEVERITY_ON_DARK.critical,
                  }}
                >
                  {actionError}
                </span>
              ) : null}
              <Button
                size="lg"
                data-testid="cj-checkout-pay"
                onClick={() => void submit()}
                disabled={submitting || (!isPreview && !captchaToken)}
                style={{
                  width: "100%",
                  height: 44,
                  background: BRAND.blue,
                  color: BRAND.white,
                  border: "none",
                  borderRadius: RADIUS.control,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {payCopy.btnLabel}
              </Button>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.5,
                  color: INK.micro,
                  textAlign: "center",
                }}
              >
                {payCopy.foot}
              </span>
            </div>
          </div>

          <div
            style={{
              border: CARD_BORDER,
              borderRadius: RADIUS.cardLarge,
              background: "rgba(15,23,42,.4)",
              padding: "16px 18px",
              display: showsCardEntry || quoteHoldLabel ? "flex" : "none",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {showsCardEntry ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Lock
                  size={13}
                  strokeWidth={2}
                  color={BRAND.teal}
                  aria-hidden="true"
                  style={{ marginTop: 2, flex: "none" }}
                />
                <p
                  style={{ margin: 0, fontSize: 12, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}
                >
                  Card details go straight to Stripe. Shane McCaw Consulting never sees or stores
                  them.
                </p>
              </div>
            ) : null}
            {quoteHoldLabel ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Clock
                  size={13}
                  strokeWidth={2}
                  color={BRAND.teal}
                  aria-hidden="true"
                  style={{ marginTop: 2, flex: "none" }}
                />
                <p
                  style={{ margin: 0, fontSize: 12, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}
                >
                  {`Your signed scope holds its quoted pricing until ${quoteHoldLabel}. After that it needs re-quoting against a fresh scan.`}
                </p>
              </div>
            ) : null}
          </div>

          <a
            href={withSearch(PROPOSAL_ROUTE)}
            onClick={(e) => {
              e.preventDefault();
              navigate(withSearch(PROPOSAL_ROUTE));
            }}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}
          >
            Back to the signed proposal
          </a>
        </div>
      </div>

      {submitting ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(2,6,23,.86)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                border: "2px solid rgba(51,65,85,.9)",
                borderTopColor: BRAND.blue,
                animation: reducedMotion ? undefined : "cj-spin 900ms linear infinite",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: INK.bodyDark }}>
              {/* The live phased branch never reaches Stripe — it records an
                  agreement and hands it to the provider — so the overlay does
                  not name a processor that is not being contacted. */}
              {plan === "phased" && !isPreview ? "Recording your signed plan" : "Confirming with Stripe"}
            </span>
          </div>
        </div>
      ) : null}
    </>,
  );
}
