import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./dsComponents";
import { useConsentScopes } from "@/hooks/useConsentScopes";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import {
  trackCheckoutStarted,
  trackCheckoutCompleted,
  identifyLead,
  trackEvent,
  getGa4ClientId,
  getAnalyticsSessionId,
} from "@/lib/analytics";
// #1306 — the inline Stripe Payment Element (stripe.js boot, iframe theming,
// mount/confirm lifecycle) was extracted from this file into the reusable
// component, along with the field-styling constants both sides share (#482's
// single-source rule: our own fields and the iframe's must read from the same
// numbers, so they now live with the component and are imported back here).
import {
  StripePaymentElement,
  PAY_PANEL,
  PAY_PANEL_ACCENT,
  PAY_PANEL_HEAD,
  PAY_PANEL_FOOT,
  SECURE_BADGE,
  LockIcon,
  PaymentSkeleton,
  FIELD_BG,
  FIELD_BORDER,
  FIELD_RADIUS,
  FIELD_PADDING,
  FIELD_FONT_SIZE,
  TEXT_STRONG,
  TEXT_MUTED,
  DANGER,
} from "@/components/StripePaymentElement";

/**
 * The real Copilot Readiness Assessment purchase flow, embedded on the Home
 * page (#427 phase 2 — #434 sequencing, #432 Compliance branch, #430 single
 * price, #435 embedded Stripe Payment Element).
 *
 * This is NOT the illustrative mockup it started life as. Every step below
 * talks to the live API: it creates a real checkout session, opens the real
 * Microsoft admin-consent screens, records a real Compliance Center decision on
 * the tenant, and takes a real card payment. Nothing is simulated.
 *
 * ── Why consent happens in a popup (#434) ─────────────────────────────────────
 * The requirement is that the buyer "lands back at this exact spot in the flow
 * and auto-advances". A same-tab redirect to Microsoft cannot satisfy that: the
 * consent callback lands on the portal's own consent-success page, and coming
 * back means a fresh page load that has lost the flow's position. So each
 * consent opens in a popup on Microsoft's domain while this page stays exactly
 * where it was, and polls GET /api/public/flow/consent-status until the grant
 * lands — at which point the flow advances itself. Same reason the payment step
 * is in-page (#435): the buyer never leaves the site.
 *
 * ── Account creation happens HERE, inline (#436/#437/#438) ────────────────────
 * Phase 2 ended this flow at payment and deferred account setup to an email
 * ("we'll email you with your account details and a link to them"). That
 * deferral is gone. The buyer now finishes their account before leaving the
 * page: Verify (six-digit code to the address the order was placed under, shown
 * alongside their REAL scan telemetry) then Password, then Done.
 *
 * These steps are no longer placeholder UI — every one of them talks to a real
 * endpoint in public-assessment-account.ts. The scan panel shows the actual
 * msp_diagnostic_runs row the consent callback started minutes earlier, the code
 * is really generated and really mailed through Exchange Online, and the
 * password is really bcrypt-hashed onto the account that consent time created.
 *
 * MFA (#439) is deliberately NOT in this pass. It is held back for a separate,
 * final pre-deployment build so that development test runs are not gated behind
 * an MFA enrolment on every refresh.
 */

/** Steps that always run, in order, with the #432 branch spliced in at index 3. */
type StepKey =
  | "details"
  | "consent"
  | "compliance"
  | "self-add"
  | "write-consent"
  | "rescan"
  | "payment"
  | "verify"
  | "password"
  | "done";

type CompliancePath = "self_add" | "delegate_write" | "declined";

const STEP_LABEL: Record<StepKey, string> = {
  details: "Details",
  consent: "Consent",
  compliance: "Compliance",
  "self-add": "Group",
  "write-consent": "Write access",
  rescan: "Rescan",
  payment: "Payment",
  verify: "Verify",
  password: "Password",
  done: "Confirmed",
};

/**
 * #467 — the top-level indicator groups steps into a handful of stages
 * instead of one flat entry per StepKey (that flat row wraps even on large
 * screens once the #432 branch is spliced in). "Authorize" bundles Consent +
 * Compliance + the branch step: they're all one conceptual phase (Microsoft
 * consent/authorization), so they render as a single stage node with its own
 * sub-progress ticks rather than three separate dots.
 *
 * #480 asked whether removing the SharePoint consent screen should shrink these
 * ticks. It should not, and the reason is that they were never counting it: a
 * tick is one StepKey, and SharePoint was a stage INSIDE the single `consent`
 * StepKey, never a StepKey of its own. Authorize therefore still holds 2 ticks
 * on the "Skip it" path and 3 on either branch path, exactly as before. What
 * did change is that the Consent step no longer carries its own competing
 * "1 of 2 / 2 of 2" counter, so the ticks are now the only progress claim being
 * made inside this stage rather than one of two disagreeing ones.
 */
type StageKey = "details" | "authorize" | "payment" | "account" | "confirmed";

const STAGE_ORDER: StageKey[] = ["details", "authorize", "payment", "account", "confirmed"];

const STAGE_LABEL: Record<StageKey, string> = {
  details: "Details",
  authorize: "Authorize",
  payment: "Payment",
  account: "Account",
  confirmed: "Confirmed",
};

const STAGE_OF: Record<StepKey, StageKey> = {
  details: "details",
  consent: "authorize",
  compliance: "authorize",
  "self-add": "authorize",
  "write-consent": "authorize",
  // #490 — the rescan add-on decision belongs to the Payment stage rather than
  // to a sixth top-level stage: it is part of deciding what is being bought,
  // and the stage row already wraps at five entries on small screens. The same
  // generic sub-progress ticks the Authorize stage uses cover it for free.
  rescan: "payment",
  payment: "payment",
  verify: "account",
  password: "account",
  done: "confirmed",
};

type StageProgress = {
  stage: StageKey;
  keys: StepKey[];
  status: "done" | "active" | "upcoming";
  /** Index of the current step within `keys`, only meaningful when active. */
  activePos: number;
};

/** Groups the flat, branch-aware `steps` list into the fixed 5 top-level stages. */
function stageProgressFor(steps: StepKey[], stepIdx: number): StageProgress[] {
  return STAGE_ORDER.map((stage) => {
    const entries = steps.map((k, i) => ({ k, i })).filter(({ k }) => STAGE_OF[k] === stage);
    const indices = entries.map((e) => e.i);
    const status: StageProgress["status"] = indices.includes(stepIdx)
      ? "active"
      : indices.length > 0 && indices.every((i) => i < stepIdx)
        ? "done"
        : "upcoming";
    return {
      stage,
      keys: entries.map((e) => e.k),
      status,
      activePos: status === "active" ? indices.indexOf(stepIdx) : -1,
    };
  });
}

/**
 * The flow's step list, which #432's decision reshapes mid-flow.
 *
 * `verify` and `password` (#436/#437/#438) sit AFTER payment: the account is
 * completed inline rather than deferred to an email. No `mfa` step — #439 is
 * held for a separate final pre-deployment build.
 *
 * `rescan` (#490) is present only when the add-on is genuinely sellable — i.e.
 * a Product Catalog row for it exists with a real price. There is no such row
 * as of #490 shipping, so the default shape of this flow is unchanged and the
 * step appears the moment the catalog says it can be sold.
 */
function stepsFor(path: CompliancePath | null, withRescan: boolean): StepKey[] {
  const branch: StepKey[] =
    path === "self_add" ? ["self-add"] : path === "delegate_write" ? ["write-consent"] : [];
  const rescan: StepKey[] = withRescan ? ["rescan"] : [];
  return ["details", "consent", "compliance", ...branch, ...rescan, "payment", "verify", "password", "done"];
}

// ── Recurring rescan add-on (#490) ────────────────────────────────────────────

/**
 * What GET /api/public/flow/rescan-addon reports.
 *
 * Every field that costs money comes from here — the Product Catalog, resolved
 * server-side on each call. Nothing in this file names a price, and `available:
 * false` (no catalog row, or a row with no price) is a normal answer that
 * removes the step rather than a failure to paper over with a placeholder.
 */
interface RescanOffer {
  available: boolean;
  name?: string;
  description?: string | null;
  priceCents?: number;
  interval?: "month";
  included?: string[];
  /** null until the buyer has answered; the resume path reads this. */
  optIn: boolean | null;
}

/** Display-only formatter — no amount originates here. */
function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Fallback "what you get" list, used only when the catalog row carries no
 * inclusions/features/deliverables of its own. Marketing copy, not pricing —
 * the price itself never appears here and always comes from the catalog.
 */
const INCLUDES_FALLBACK = [
  "Read-only Graph scan of all six pillars",
  "Whole tenant, no seat tiers or sampling",
  "Eight reports, generated in under thirty minutes",
  "Your Copilot Gate status and blast radius",
  "Evidence behind every finding, not just scores",
  "Remediation sequence, phase by phase",
];

const INDUSTRIES = [
  "Healthcare",
  "Financial Services",
  "Government / Public Sector",
  "Legal",
  "Technology",
  "Manufacturing",
  "Retail",
  "Education",
  "Nonprofit",
  "Other",
];

/** Survives a mid-flow reload; only the opaque session UUID is ever stored. */
const SESSION_KEY = "smc_home_flow_session";

function loadSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function saveSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* private browsing */
  }
}
function clearSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing */
  }
}

// ── Consent status polling ────────────────────────────────────────────────────

/**
 * The fields of /api/public/flow/consent-status this flow acts on. The endpoint
 * also still returns `sharepoint` — the historical grant key, kept server-side
 * for tenants that consented SharePoint separately before it was merged into
 * the read registration (#480). Nothing here reads it any more, so it is
 * deliberately not declared: no branch of this flow may depend on it again.
 */
interface FlowStatus {
  sessionStatus: string;
  tenantConnected: boolean;
  graph: string | null;
  writeBack: string | null;
  complianceGroup: { path: CompliancePath; confirmed: boolean } | null;
}

/**
 * Polls the flow's consent status while `active`. This is what makes the
 * popup-based consent auto-advance: the grant is recorded server-side by
 * Microsoft's callback, and this is how the page finds out.
 */
function useFlowStatus(sessionId: string | null, active: boolean): FlowStatus | null {
  const [status, setStatus] = useState<FlowStatus | null>(null);

  useEffect(() => {
    if (!sessionId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/public/flow/consent-status?sessionId=${encodeURIComponent(sessionId)}`);
        if (res.ok && !cancelled) setStatus((await res.json()) as FlowStatus);
      } catch {
        /* transient — the next tick retries */
      }
      if (!cancelled) timer = setTimeout(tick, 3000);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, active]);

  return status;
}

/**
 * Reads the #490 add-on offer for a session. Resolves to null on any failure —
 * a flow that cannot reach the offer endpoint must still be able to sell the
 * assessment, so "unknown" is treated as "not offered", never as an error the
 * buyer has to deal with.
 */
async function fetchRescanOffer(sessionId: string): Promise<RescanOffer | null> {
  try {
    const res = await fetch(`/api/public/flow/rescan-addon?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return (await res.json()) as RescanOffer;
  } catch {
    return null;
  }
}

/**
 * Opens a Microsoft consent screen without navigating this page away. Must be
 * called synchronously from the click handler or the popup blocker eats it —
 * hence the URL is fetched up-front and this only opens an already-known one.
 */
function openConsentPopup(url: string): Window | null {
  return window.open(url, "smc-consent", "width=640,height=780,menubar=no,toolbar=no");
}

// ── Styling helpers (unchanged from the original design) ──────────────────────
// The field/accent/text constants themselves moved to StripePaymentElement.tsx
// with the Payment Element theming (#1306) and are imported above.

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: FIELD_PADDING,
    borderRadius: FIELD_RADIUS,
    border: `1px solid ${FIELD_BORDER}`,
    background: FIELD_BG,
    color: TEXT_STRONG,
    fontFamily: "inherit",
    fontSize: FIELD_FONT_SIZE,
    outline: "none",
  };
}

function labelStyle(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: TEXT_MUTED,
    marginBottom: 7,
  };
}

const EYEBROW: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#60a5fa",
};
const H3: React.CSSProperties = {
  fontSize: "clamp(21px,3.7vw,26px)",
  fontWeight: 700,
  letterSpacing: "-.018em",
  color: "#f8fafc",
  margin: "14px 0 10px",
  lineHeight: 1.22,
};
const BODY: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: "#94a3b8",
  margin: "0 0 26px",
  maxWidth: 520,
};
const FOOTNOTE: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "#475569",
  margin: "18px 0 0",
  maxWidth: 520,
};
const CARD: React.CSSProperties = {
  border: "1px solid rgba(30,41,59,.9)",
  borderRadius: 16,
  background: "rgba(2,6,23,.5)",
  padding: 24,
};
const TWO_COL: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,270px),1fr))",
  gap: "clamp(26px,4vw,44px)",
  alignItems: "start",
};

interface FlowForm {
  first?: string;
  last?: string;
  company?: string;
  email?: string;
  industry?: string;
  terms?: boolean;
}

export interface AssessmentFlowProps {
  /** Display price, already formatted from the catalog by the caller. */
  fee: string;
  /** The catalog slug this flow purchases. Absent → the flow cannot transact. */
  productSlug: string | null;
  /** Real catalog inclusions; falls back to marketing copy when empty. */
  includes?: string[] | null;
}

export function AssessmentFlow({ fee, productSlug, includes }: AssessmentFlowProps) {
  const [step, setStep] = useState<StepKey>("details");
  const [form, setForm] = useState<FlowForm>({});
  const [sessionId, setSessionId] = useState<string | null>(() => loadSessionId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compliancePath, setCompliancePath] = useState<CompliancePath | null>(null);
  /**
   * #490 — the add-on offer, prefetched as soon as there is a session so the
   * step machine knows whether the step exists long before the buyer gets
   * there. null means "not answered yet by the server"; the flow treats that as
   * "do not offer", which is the safe default: skipping an add-on costs a sale
   * of an add-on, whereas stalling costs the whole purchase.
   */
  const [rescanOffer, setRescanOffer] = useState<RescanOffer | null>(null);
  /** Reported by /set-password — the real portal base, never a literal here. */
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  /**
   * #480 — there is no `consentStage` any more. The Consent step used to run a
   * two-stage machine ("graph" then "sharepoint") because SharePoint Online was
   * a separate approval on its own resource. Those permissions have since been
   * merged into the single read-only App Registration, so one admin-consent
   * grant covers the whole scan and Step 2 is one step with one URL again.
   */
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  /**
   * The permission list the CURRENT consent link's endpoint reported (#475).
   * The read step gets its scopes from useConsentScopes instead; this is for the
   * write app, whose permissions only its own endpoint knows. Stays [] when the
   * endpoint reports none, and the panel is then not rendered at all rather than
   * showing a placeholder that would contradict Microsoft's own consent screen.
   */
  const [consentPermissions, setConsentPermissions] = useState<string[]>([]);
  /** Bumped to force a fresh consent link (a declined grant spends the old one). */
  const [consentNonce, setConsentNonce] = useState(0);

  const { scopes, loading: scopesLoading } = useConsentScopes();
  const personalization = usePersonalizationState();

  const setField = (key: keyof FlowForm, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * #678 — carry an email already captured upstream (quiz or a logged-in
   * assessment session) forward onto this form, so a returning visitor never
   * has to retype it. Never overwrites an in-progress edit: both the tier
   * check and the eventual setForm re-check f.email at the moment they apply,
   * since the quiz-tier fetch below is async and the visitor may have already
   * started typing by the time it resolves.
   *
   * Assessment tier's email comes straight off context (AssessmentIdentity
   * already carries it via /api/auth/refresh in PersonalizationProvider).
   * Quiz tier's shared QuizIdentity deliberately excludes email for privacy
   * (#621), so this calls GET /api/public/personalization/state directly —
   * same endpoint Git #677 extended to return email for the quiz tier.
   */
  useEffect(() => {
    if (personalization.loading || form.email) return;

    if (personalization.tier === "assessment") {
      const email = personalization.assessment?.email;
      if (email) setForm((prev) => (prev.email ? prev : { ...prev, email }));
      return;
    }

    if (personalization.tier !== "quiz") return;

    let cancelled = false;
    (async () => {
      try {
        const sessionId = getAnalyticsSessionId();
        const res = await fetch(`/api/public/personalization/state?sessionId=${encodeURIComponent(sessionId)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tier?: string; email?: string };
        if (cancelled || data.tier !== "quiz" || !data.email) return;
        setForm((prev) => (prev.email ? prev : { ...prev, email: data.email as string }));
      } catch {
        // No prefill on failure — the field just stays blank.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalization.loading, personalization.tier]);

  // Poll only while a consent grant is genuinely outstanding.
  const polling =
    !!sessionId && (step === "consent" || step === "write-consent");
  const status = useFlowStatus(sessionId, polling);

  const includeList = includes && includes.length > 0 ? includes : INCLUDES_FALLBACK;
  const isMobile = useIsMobile();
  const rescanSellable = rescanOffer?.available === true;
  const steps = stepsFor(compliancePath, rescanSellable);
  const stepIdx = Math.max(0, steps.indexOf(step));
  const stageInfo = stageProgressFor(steps, stepIdx);

  /**
   * Where the flow goes once the #432 Compliance branch is settled: the add-on
   * step when there is a real, priced, not-yet-answered offer, and Payment —
   * exactly as before #490 — in every other case.
   */
  const afterCompliance: StepKey =
    rescanSellable && rescanOffer?.optIn == null ? "rescan" : "payment";

  const f = form;
  const detailsInvalid = !(
    f.first &&
    f.last &&
    f.company &&
    f.industry &&
    f.terms === true &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email || "") &&
    productSlug
  );

  // ── Resume a session recovered from sessionStorage ──────────────────────────
  // "Land back at the exact same spot" (#434) has to survive a reload too, not
  // just the consent popup. One shot at mount: ask the server what has already
  // landed for this session and start at the step that follows it. Runs only
  // for a session restored from storage — a session created in this mount is
  // already at the right step.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    const stored = loadSessionId();
    if (!stored) return;
    resumedRef.current = true;

    let cancelled = false;
    // #490 — the add-on offer is resolved alongside the consent status rather
    // than after it, so a resumed session that has not yet answered the add-on
    // question lands ON that step instead of skipping past a question it was
    // never asked. A failed offer lookup resolves to "no offer", which resumes
    // the pre-#490 shape.
    Promise.all([
      fetch(`/api/public/flow/consent-status?sessionId=${encodeURIComponent(stored)}`).then((r) =>
        r.ok ? (r.json() as Promise<FlowStatus>) : Promise.reject(new Error("gone")),
      ),
      fetchRescanOffer(stored),
    ])
      .then(([s, offer]) => {
        if (cancelled) return;
        setRescanOffer(offer);
        const resumeAfterCompliance: StepKey =
          offer?.available === true && offer.optIn == null ? "rescan" : "payment";
        // Paid, but the account may not be finished — a reload here resumes at
        // Verify rather than jumping to Done, because Done now means "account
        // complete", not merely "payment taken". Verify is safe to re-enter: a
        // code already proven returns `alreadyVerified`, and an account that
        // already has a password is reported as such by /set-password.
        if (s.sessionStatus === "paid") {
          setStep("verify");
          return;
        }
        if (s.complianceGroup) {
          setCompliancePath(s.complianceGroup.path);
          if (s.complianceGroup.path === "self_add" && !s.complianceGroup.confirmed) setStep("self-add");
          else if (s.complianceGroup.path === "delegate_write" && s.writeBack !== "granted") setStep("write-consent");
          else setStep(resumeAfterCompliance);
          return;
        }
        // One grant is the whole of Step 2 now (#480), so the read consent
        // having landed is exactly what "past the Consent step" means. This
        // also covers a session started before the merge that only ever reached
        // the old Graph stage: it resumes at Compliance rather than at a second
        // consent screen that no longer exists. A pre-merge tenant that also
        // carries a historical `sharepoint` grant resumes to the same place —
        // that grant is on the tenant and there is nothing left to ask for.
        if (s.graph === "granted") setStep("compliance");
        // Nothing granted yet — stay on Details; submitting there mints a fresh
        // session, which is correct for an abandoned one.
      })
      .catch(() => {
        // Expired or unknown — drop it rather than carrying a dead id forward.
        if (!cancelled) {
          clearSessionId();
          setSessionId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── #434 auto-advance ───────────────────────────────────────────────────────
  // The single place the flow moves itself forward off a landed consent grant.
  //
  // #480 removed the SharePoint stage and, with it, all of #448's machinery —
  // `graphStatusAtSharepointEntryRef` and `sharepointPreGranted`. That machinery
  // existed for one reason worth recording, because it is the reason it does NOT
  // need re-creating for the read grant: consent lives on the TENANT, not on the
  // checkout session (#99), so a tenant that had consented SharePoint in some
  // earlier order arrived at the SharePoint stage with the grant already on
  // file, and auto-advance tore the step away before the buyer could act on it.
  //
  // The read grant cannot be in that position. A checkout session's tenant GUID
  // is stamped by the read-consent callback itself, so until THIS order's own
  // Graph consent lands, the poll has no tenants row to read and reports
  // `graph: null` no matter what the buyer's tenant has consented before. The
  // "already granted on entry" case is therefore unreachable here, and the
  // absence of a pre-granted guard is deliberate rather than an oversight.
  useEffect(() => {
    if (!status) return;
    if (step === "consent" && status.graph === "granted") {
      trackEvent("consent_granted", { scope: "graph" });
      setStep("compliance");
      setError(null);
    } else if (step === "write-consent" && status.writeBack === "granted") {
      trackEvent("consent_granted", { scope: "write_back" });
      setStep(afterCompliance);
      setError(null);
    }
  }, [status, step, afterCompliance]);

  // Surface a declined grant rather than polling forever behind a silent UI —
  // and mint a FRESH consent link for the retry. The write-app callback burns
  // its single-use token on the decline path too, so the URL already in hand is
  // spent and reusing it would fail with "already used". The read link's state
  // is the checkout session UUID rather than a burnable token, so re-fetching it
  // is a harmless no-op — the retry is written once, for both. The ref keeps
  // this to one re-fetch per decline instead of one per poll tick.
  const declineHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const declined =
      (step === "consent" && status.graph === "declined") ||
      (step === "write-consent" && status.writeBack === "declined");
    if (declined && declineHandledRef.current !== step) {
      declineHandledRef.current = step;
      setError("The Microsoft permission screen was declined. Try again below, or go back and choose a different option.");
      setConsentNonce((n) => n + 1);
    }
  }, [status, step]);

  // Fetch the consent URL for whichever grant is outstanding, so the click
  // handler has one ready and the popup opens synchronously.
  useEffect(() => {
    if (!sessionId) return;
    const endpoint =
      step === "consent"
        ? `/api/public/consent-url?sessionId=${encodeURIComponent(sessionId)}`
        : step === "write-consent"
          ? `/api/public/flow/write-consent-url?sessionId=${encodeURIComponent(sessionId)}`
          : null;
    if (!endpoint) return;

    let cancelled = false;
    setConsentUrl(null);
    setConsentPermissions([]);
    fetch(endpoint)
      .then(
        (r) =>
          r.json() as Promise<{
            url?: string | null;
            consentUrl?: string | null;
            permissions?: string[] | null;
            error?: string;
          }>,
      )
      .then((d) => {
        if (cancelled) return;
        const url = d.consentUrl ?? d.url ?? null;
        setConsentUrl(url);
        setConsentPermissions(Array.isArray(d.permissions) ? d.permissions : []);
        if (!url) {
          setError(
            d.error === "session_expired" || d.error === "session_invalid"
              ? "This session has expired. Please start again."
              : "The Microsoft consent link is temporarily unavailable. Please try again shortly.",
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the consent service. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, step, consentNonce]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function submitDetails() {
    if (detailsInvalid || !productSlug) return;
    setBusy(true);
    setError(null);
    try {
      const ga4ClientId = await getGa4ClientId();
      const res = await fetch("/api/public/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug,
          fullName: `${f.first} ${f.last}`.trim(),
          email: f.email,
          company: f.company,
          industry: f.industry,
          seats: 1,
          ...(ga4ClientId ? { ga4ClientId } : {}),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; portalUrl?: string };
        if (err.error === "already_has_account" && err.portalUrl) {
          // Returning customer with a real password already set — send them to
          // sign in now, before they grant consent or pay again, rather than
          // letting them proceed and only finding out at set-password.
          window.location.href = err.portalUrl;
          return;
        }
        setError(err.error ?? "We could not start your order. Please try again.");
        return;
      }
      const { sessionId: id } = (await res.json()) as { sessionId: string };
      saveSessionId(id);
      setSessionId(id);
      // #490 — resolve the add-on offer now, at the START of the flow. The
      // buyer then spends a minute or more in Microsoft's consent screens, so
      // by the time the step machine has to decide whether the add-on step
      // exists, the answer is already in hand.
      void fetchRescanOffer(id).then((offer) => setRescanOffer(offer));
      // #458: this is the funnel's first confirmed email — identifyLead ties
      // the anonymous analytics session to it. (#457's Home-quiz lead capture
      // fires its own identifyLead too, for visitors who convert that way instead.)
      if (f.email) void identifyLead(f.email);
      setStep("consent");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function grantConsent() {
    if (!consentUrl) return;
    setError(null);
    // A new attempt — let a second decline be detected and re-minted too.
    declineHandledRef.current = null;
    const popup = openConsentPopup(consentUrl);
    setPopupBlocked(!popup);
  }

  async function chooseCompliancePath(path: CompliancePath) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/flow/compliance-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, path }),
      });
      if (!res.ok) {
        setError("We could not record that choice. Please try again.");
        return;
      }
      trackEvent("compliance_path_chosen", { path });
      setCompliancePath(path);
      setStep(path === "self_add" ? "self-add" : path === "delegate_write" ? "write-consent" : afterCompliance);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSelfAdd() {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/flow/compliance-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, path: "self_add", confirmed: true }),
      });
      if (!res.ok) {
        setError("We could not record your confirmation. Please try again.");
        return;
      }
      setStep(afterCompliance);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * #490 — records the add-on answer, then moves to Payment either way.
   *
   * A decline is deliberately still a recorded answer rather than a silent
   * skip: it is what stops a resumed session re-asking, and it is what tells
   * /payment-intent not to ask Stripe to save the buyer's card.
   *
   * A failed decline is not worth blocking the sale over (nothing is created by
   * a decline), but a failed OPT-IN is: proceeding would put the buyer through
   * a card form believing they had bought a monthly service that nothing had
   * recorded.
   */
  async function chooseRescanAddon(optIn: boolean) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/flow/rescan-addon-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, optIn }),
      });
      if (!res.ok && optIn) {
        setError("We could not add the recurring rescan to your order. Please try again, or continue without it.");
        return;
      }
      trackEvent("rescan_addon_decision", { opt_in: optIn });
      setRescanOffer((o) => (o ? { ...o, optIn } : o));
      setStep("payment");
    } catch {
      if (optIn) {
        setError("Network error. Check your connection and try again.");
        return;
      }
      setStep("payment");
    } finally {
      setBusy(false);
    }
  }

  // Stable — PaymentStep's setup effect depends on it, and an inline closure
  // here would give that effect a new identity on every render, re-creating the
  // PaymentIntent in a loop. It advances to Verify, not Done: account creation
  // now happens inline (#437/#438) instead of being deferred to an email.
  const goVerify = useCallback((warning?: string | null) => {
    // #490 — carries a failed add-on forward into the banner rather than
    // dropping it: the payment step unmounts here, so this is the last chance
    // to tell the buyer.
    if (warning) setError(warning);
    setStep("verify");
  }, []);
  const goPassword = useCallback(() => setStep("password"), []);
  const goDone = useCallback((url: string | null) => {
    trackEvent("account_created");
    setPortalUrl(url);
    setStep("done");
  }, []);

  const restartFlow = useCallback(() => {
    clearSessionId();
    setSessionId(null);
    setStep("details");
    setCompliancePath(null);
    setConsentUrl(null);
    setError(null);
    setForm({});
    setPortalUrl(null);
    setRescanOffer(null);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        marginTop: "clamp(30px,5vw,44px)",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 20,
        background: "rgba(2,6,23,.42)",
        padding: "clamp(22px,4vw,34px)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, marginBottom: 34 }}
        role="list"
        aria-label="Assessment progress"
      >
        {stageInfo.map((s, idx) => {
          const ring = s.status === "active" ? "#3B82F6" : s.status === "done" ? "rgba(37,99,235,.5)" : "rgba(51,65,85,.9)";
          const fill = s.status === "active" ? "#3B82F6" : s.status === "done" ? "rgba(37,99,235,.14)" : "transparent";
          const numColor = s.status === "active" ? "#f8fafc" : s.status === "done" ? "#93c5fd" : "#475569";
          const color = s.status === "active" ? "#f1f5f9" : s.status === "done" ? "#93c5fd" : "#475569";
          // On mobile only the active stage spells out its label; the rest stay as plain dots so the row never wraps.
          const showLabel = !isMobile || s.status === "active";
          return (
            <Fragment key={s.stage}>
              <span role="listitem" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: `1px solid ${ring}`,
                    background: fill,
                    color: numColor,
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {s.status === "done" ? "✓" : String(idx + 1)}
                </span>
                {showLabel && (
                  <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {STAGE_LABEL[s.stage]}
                    </span>
                    {/* Sub-progress ticks for the Authorize stage's bundled Consent/Compliance/branch steps. */}
                    {s.status === "active" && s.keys.length > 1 && (
                      <span
                        style={{ display: "flex", gap: 3 }}
                        title={`${STEP_LABEL[s.keys[s.activePos]]} (${s.activePos + 1} of ${s.keys.length})`}
                      >
                        {s.keys.map((k, i) => (
                          <span
                            key={k}
                            style={{
                              width: 12,
                              height: 3,
                              borderRadius: 2,
                              background: i <= s.activePos ? "#3B82F6" : "rgba(51,65,85,.9)",
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {idx < stageInfo.length - 1 && (
                <span
                  aria-hidden
                  style={{
                    flex: 1,
                    minWidth: 10,
                    height: 1,
                    background: s.status === "done" ? "rgba(37,99,235,.4)" : "rgba(51,65,85,.6)",
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* #468: temporary debug tooling, dev-only. Remove or confirm dev-gated before production release. */}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={restartFlow}
          style={{
            marginBottom: 22,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".05em",
            color: "#fca5a5",
            background: "rgba(127,29,29,.22)",
            border: "1px solid rgba(248,113,113,.35)",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          [DEBUG] Reset flow
        </button>
      )}

      {error && (
        <div
          style={{
            border: "1px solid rgba(248,113,113,.35)",
            background: "rgba(127,29,29,.22)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 22,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "#fca5a5",
            maxWidth: 620,
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* ── Step 1 — Details ───────────────────────────────────────────────── */}
      {step === "details" && (
        <div data-testid="assessment-flow-details-step" style={TWO_COL}>
          <div>
            <span style={EYEBROW}>One flat fee</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "14px 0 10px" }}>
              <span style={{ fontSize: "clamp(38px,9vw,52px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1, color: "#f8fafc" }}>
                {fee}
              </span>
              <span style={{ fontSize: 15, color: "#64748b" }}>every tenant, every size</span>
            </div>
            <p style={{ ...BODY, margin: "0 0 30px", maxWidth: 480 }}>
              Not priced per seat and not scoped by headcount. A hundred users or twenty thousand, the scan covers the whole tenant and all
              eight reports are the same price.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 14, maxWidth: 520 }}>
              <label>
                <span style={labelStyle()}>First name</span>
                <input value={f.first || ""} onChange={(e) => setField("first", e.target.value)} placeholder="First name" style={fieldStyle()} />
              </label>
              <label>
                <span style={labelStyle()}>Last name</span>
                <input value={f.last || ""} onChange={(e) => setField("last", e.target.value)} placeholder="Last name" style={fieldStyle()} />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Company</span>
                <input value={f.company || ""} onChange={(e) => setField("company", e.target.value)} placeholder="Company name" style={fieldStyle()} />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Work email</span>
                <input
                  type="email"
                  value={f.email || ""}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="you@yourcompany.com"
                  style={fieldStyle()}
                />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Industry</span>
                <select value={f.industry || ""} onChange={(e) => setField("industry", e.target.value)} style={fieldStyle()}>
                  <option value="">Select your industry</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Terms gate — must be accepted BEFORE the Microsoft admin-consent
                step is reachable, exactly as the standalone checkout does: no
                one grants real tenant access without first agreeing to the
                terms that govern how that tenant's data is processed. */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 18, maxWidth: 520, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={f.terms === true}
                onChange={(e) => setField("terms", e.target.checked)}
                style={{ marginTop: 3, accentColor: "#3B82F6", width: 16, height: 16, flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "#94a3b8" }}>
                I agree to the{" "}
                <a href="/legal/terms" style={{ color: "#60a5fa" }}>
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="/legal/privacy" style={{ color: "#60a5fa" }}>
                  Privacy Policy
                </a>
                . Agreement is required before granting Microsoft 365 access.
              </span>
            </label>

            <div style={{ marginTop: 22 }}>
              <Button size="lg" onClick={submitDetails} disabled={detailsInvalid || busy}>
                {busy ? "Starting…" : "Continue to Consent"}
              </Button>
            </div>
            <p style={FOOTNOTE}>
              {productSlug
                ? "Nothing is charged at this step. Consent comes next, payment after that."
                : "This assessment is not currently available for online purchase."}
            </p>
          </div>

          {/* #430: the value list, not a second copy of the price. */}
          <ValueCard includes={includeList} />
        </div>
      )}

      {/* ── Step 2 — Consent: one read-only grant, whole tenant (#480) ──────── */}
      {step === "consent" && (
        <div style={{ maxWidth: 620 }}>
          <span style={EYEBROW}>Step 2 — Microsoft consent</span>
          <h3 style={H3}>Grant read-only access to your tenant.</h3>
          <p style={BODY}>
            This opens the Microsoft admin consent screen in a new window. An account with Global Administrator or Privileged Role
            Administrator can approve it. The scan reads; it never writes, never moves a file, and never changes a policy.
          </p>
          {/* #480 — SharePoint used to be a second trip to this screen on its own
              resource. Its permissions now sit on this same registration, so one
              approval covers the whole scan. Said out loud because the earlier
              copy promised two screens and returning buyers will expect one. */}
          <p style={{ ...BODY, marginTop: -14 }}>
            One approval covers the whole scan, SharePoint Online included — there is no second consent screen.
          </p>

          <ScopesPanel scopes={scopes} loading={scopesLoading} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Button size="lg" onClick={grantConsent} disabled={!consentUrl}>
              Grant Consent in Microsoft 365
            </Button>
            <WaitingPulse
              label={
                consentUrl
                  ? "Waiting for approval — this page continues on its own"
                  : "Preparing your consent link…"
              }
            />
          </div>

          {popupBlocked && consentUrl && (
            <p style={{ ...FOOTNOTE, color: "#fbbf24" }}>
              Your browser blocked the popup.{" "}
              <a href={consentUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>
                Open the Microsoft consent screen in a new tab
              </a>{" "}
              — this page will still continue on its own once you approve.
            </p>
          )}

          <p style={FOOTNOTE}>
            Consent is revocable at any time from Entra ID → Enterprise applications. Revoking it stops all future scans immediately.
          </p>
        </div>
      )}

      {/* ── Step 3 — Compliance Center decision (#432) ──────────────────────── */}
      {step === "compliance" && (
        <div style={{ maxWidth: 720 }}>
          <span style={EYEBROW}>Step 3 — Compliance access</span>
          <h3 style={H3}>One thing read-only access alone cannot reach.</h3>
          <p style={{ ...BODY, maxWidth: 640 }}>
            Read-only consent covers five of the six pillars completely. Compliance is the exception: to read the full compliance picture,
            the app registration you just approved has to be a <strong style={{ color: "#cbd5e1" }}>member of a role group in the Microsoft
            Purview compliance portal</strong>. Adding it there is a change, not a read — so it is your call, not ours. Three ways forward,
            all of them fine.
          </p>

          <div style={{ display: "grid", gap: 14 }}>
            <ChoiceCard
              title="I'll add it myself"
              body="You add the app registration to the compliance role group in Purview, then tell us it's done. Nothing further is granted to us — you keep every write action in your own hands."
              action="Choose this"
              disabled={busy}
              onClick={() => void chooseCompliancePath("self_add")}
            />
            <ChoiceCard
              badge="Most Popular"
              title="You do it for me"
              body="You approve a second, separate app registration that holds the write permission needed to add the group membership. We do the addition once, and you can revoke that app independently at any time."
              action="Choose this"
              disabled={busy}
              onClick={() => void chooseCompliancePath("delegate_write")}
            />
            <ChoiceCard
              title="Skip it"
              body="Neither. Your report is delivered with the Compliance pillar excluded — the other five are unaffected, but your overall Copilot readiness score will be based on a partial picture and may read higher or lower than the truth."
              action="Skip Compliance"
              disabled={busy}
              muted
              onClick={() => void chooseCompliancePath("declined")}
            />
          </div>
        </div>
      )}

      {/* ── Step 4a — customer adds the group membership themselves ─────────── */}
      {step === "self-add" && (
        <div style={{ maxWidth: 620 }}>
          <span style={EYEBROW}>Step 4 — Compliance group</span>
          <h3 style={H3}>Add the app registration, then tell us.</h3>
          <p style={BODY}>
            In the Microsoft Purview compliance portal, open <strong style={{ color: "#cbd5e1" }}>Roles &amp; scopes → Permissions →
            Microsoft Purview solutions</strong>, choose the role group that grants compliance read access, and add the app registration you
            just approved as a member. Then confirm below — the Compliance pillar is read on your next scan pass.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Button size="lg" onClick={confirmSelfAdd} disabled={busy}>
              {busy ? "Saving…" : "I've added it — continue"}
            </Button>
            <LinkButton
              onClick={() => {
                setCompliancePath(null);
                setStep("compliance");
              }}
            >
              Choose a different option
            </LinkButton>
          </div>
          <p style={FOOTNOTE}>
            You can also do this after payment — nothing about the rest of the assessment waits on it. Confirming here just tells us to
            expect it.
          </p>
        </div>
      )}

      {/* ── Step 4b — customer consents to the write app so we do it ────────── */}
      {step === "write-consent" && (
        <div style={{ maxWidth: 620 }}>
          <span style={EYEBROW}>Step 4 — Write access</span>
          <h3 style={H3}>Approve the write app so we can add the membership.</h3>
          <p style={BODY}>
            This is a <strong style={{ color: "#cbd5e1" }}>separate app registration</strong> from the read-only one — a different entry in
            your Enterprise applications list, with its own consent and its own revoke. It exists so the one write we need (adding the read
            app to the compliance role group) never rides on the read app's permissions.
          </p>

          {/* #475 — say plainly what this consent is FOR, in mechanism terms. */}
          <div
            style={{
              ...CARD,
              borderRadius: 14,
              padding: "18px 20px",
              margin: "22px 0",
              borderColor: "rgba(251,191,36,.28)",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>
              What this consent does
            </span>
            <p style={{ ...BODY, fontSize: 13.5, margin: "12px 0 0" }}>
              Approving this lets us add the read-only app registration to a{" "}
              <strong style={{ color: "#cbd5e1" }}>role group in the Microsoft Purview compliance portal</strong>. That membership is the
              only thing that makes your{" "}
              <strong style={{ color: "#cbd5e1" }}>DLP (Data Loss Prevention) policies readable</strong>, which is what the Compliance
              pillar of your report is scored on. Purview role groups are a permission system of their own — Microsoft 365 admin consent,
              however broad, does not reach them, which is why this cannot be folded into the read-only approval you already gave.
            </p>
            <p style={{ ...FOOTNOTE, marginTop: 12 }}>
              It is one membership addition, made once. The scan itself stays read-only, and revoking this app in Entra ID stops it having
              any write ability at all.
            </p>
          </div>

          {/* Same grouped presentation as the read step (#447), for the write
              app's own permissions. Rendered only when the endpoint actually
              reports a list — see REQUIRED_WRITE_APP_PERMISSIONS in the API. */}
          {consentPermissions.length > 0 && (
            <>
              <ScopesPanel
                scopes={consentPermissions}
                loading={false}
                title="Permissions requested"
                note={`${consentPermissions.length} permission${consentPermissions.length === 1 ? "" : "s"} on a separate app`}
              />
              {/* Microsoft's admin-consent screen grants everything an app
                  registration declares, tenant-wide — saying so here keeps this
                  panel from reading as a narrower promise than it is. */}
              <p style={{ ...FOOTNOTE, marginTop: -14, marginBottom: 26 }}>
                Microsoft grants these tenant-wide when you approve the app, as it does for any consent — the group membership described
                above is the only thing we use them for.
              </p>
            </>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Button size="lg" onClick={grantConsent} disabled={!consentUrl}>
              Approve Write Access in Microsoft 365
            </Button>
            <WaitingPulse
              label={consentUrl ? "Waiting for approval — this page continues on its own" : "Preparing your consent link…"}
            />
          </div>
          {popupBlocked && consentUrl && (
            <p style={{ ...FOOTNOTE, color: "#fbbf24" }}>
              Your browser blocked the popup.{" "}
              <a href={consentUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>
                Open the Microsoft consent screen in a new tab
              </a>
              .
            </p>
          )}
          <div style={{ marginTop: 18 }}>
            <LinkButton
              onClick={() => {
                setCompliancePath(null);
                setStep("compliance");
              }}
            >
              Choose a different option
            </LinkButton>
          </div>
        </div>
      )}

      {/* ── Recurring rescan add-on — its own step before Payment (#490) ────── */}
      {step === "rescan" && rescanOffer?.available && (
        <div style={{ maxWidth: 720 }}>
          <span style={EYEBROW}>Before you pay — optional</span>
          <h3 style={H3}>Keep scanning, or take the one snapshot?</h3>
          <p style={{ ...BODY, maxWidth: 640 }}>
            The assessment you're buying is a single scan of your tenant as it is today. Tenants don't stay as they are today: a new
            sharing link, a changed policy, a license reassigned, and the picture you paid for is a month out of date. This add-on re-runs
            the <strong style={{ color: "#cbd5e1" }}>same read-only scan every week</strong> and keeps the results, so the change is
            visible instead of inferred.
          </p>

          {/* Said plainly, because the difference is worth real money to get
              wrong: this is passive tracking, NOT the Tenant Monitoring SOW. */}
          <div
            style={{
              ...CARD,
              borderRadius: 14,
              padding: "18px 20px",
              margin: "22px 0",
              borderColor: "rgba(251,191,36,.28)",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>
              What this is not
            </span>
            <p style={{ ...BODY, fontSize: 13.5, margin: "12px 0 0" }}>
              This is not Tenant Monitoring. Nobody is paged when something changes, no alert is raised, and no remediation work is
              included — it re-scans and it records, and you look when you want to. Monitoring with active alerting and hands-on
              remediation is a separate, ongoing engagement — not a bounded project, but a continuing relationship that runs until you
              cancel with 30 days — with its own scope and its own price, and buying this does not buy any part of it.
            </p>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <ChoiceCard
              badge={`${formatCents(rescanOffer.priceCents ?? 0)}/month`}
              title="Yes — keep scanning weekly"
              body={
                rescanOffer.description ??
                "Your tenant is re-scanned every week and each pass is kept, so drift shows up as a change over time rather than as a surprise on the next assessment. Billed monthly on the card you're about to enter, and cancellable at any time."
              }
              action="Add it to my order"
              disabled={busy}
              onClick={() => void chooseRescanAddon(true)}
            />
            <ChoiceCard
              title="No — just the one assessment"
              body="You get exactly what you came for: one full scan and the reports that come out of it. Nothing recurring, nothing on your card afterwards. You can add weekly rescanning later from your portal."
              action="Continue without it"
              disabled={busy}
              muted
              onClick={() => void chooseRescanAddon(false)}
            />
          </div>

          {/* Catalog-authored bullets, when the row carries any. */}
          {rescanOffer.included && rescanOffer.included.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "grid", gap: 8 }}>
              {rescanOffer.included.map((item) => (
                <li key={item} style={{ fontSize: 13.5, lineHeight: 1.55, color: "#94a3b8", paddingLeft: 18, position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, color: "#3B82F6" }}>·</span>
                  {item}
                </li>
              ))}
            </ul>
          )}

          {/* The badge above is a 10px uppercase pill — fine as a marker, not
              enough on its own for the number someone is agreeing to pay every
              month. It is stated again here in plain body text. */}
          <p style={FOOTNOTE}>
            {formatCents(rescanOffer.priceCents ?? 0)} a month. The first month is charged today alongside the assessment, as a separate
            line from the same card. Cancel any time from your portal — the assessment itself is yours regardless.
          </p>
        </div>
      )}

      {/* ── Payment — embedded Stripe Payment Element (#435) + single price (#430) */}
      {step === "payment" && sessionId && (
        <PaymentStep
          sessionId={sessionId}
          fee={fee}
          company={f.company}
          includes={includeList}
          compliancePath={compliancePath}
          onPaid={goVerify}
        />
      )}

      {/* ── Verify — real scan telemetry (#436) + six-digit email code (#437) ── */}
      {step === "verify" && sessionId && (
        <VerifyStep sessionId={sessionId} email={f.email} onVerified={goPassword} />
      )}

      {/* ── Password — completes the account inline (#438) ──────────────────── */}
      {step === "password" && sessionId && (
        <PasswordStep sessionId={sessionId} email={f.email} onComplete={goDone} />
      )}

      {/* ── Confirmed ───────────────────────────────────────────────────────── */}
      {step === "done" && (
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", maxWidth: 640 }}>
          <StepIcon />
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "0 0 10px" }}>
              You're all set{f.first ? `, ${f.first}` : ""}. Your scan is already running.
            </h3>
            {/* No emailed setup link is promised here any more (#436/#437/#438):
                the account was created on this page, so there is nothing left to
                send and saying otherwise would be a promise nothing keeps. */}
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 20px" }}>
              Consent is live against {f.company || "your tenant"} and the read-only scan started the moment it was granted — before you
              paid, not after. Your account is ready: sign in at the portal with {f.email || "your work email"} and the password you just
              set, and your reports appear there as the scan finishes.
            </p>
            {/* The portal base URL is whatever /set-password reported, not a
                literal baked in here. When the server could not supply one the
                button is simply absent — the sign-in instruction above still
                stands, and inventing a URL would be worse than omitting it. */}
            {portalUrl && (
              <div style={{ marginBottom: 20 }}>
                <Button size="lg" onClick={() => window.open(portalUrl, "_blank", "noopener")}>
                  Go to your portal
                </Button>
              </div>
            )}
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "#64748b", margin: 0 }}>
              Consent stays revocable from Entra ID → Enterprise applications at any time.
            </p>
            <div style={{ marginTop: 20 }}>
              <LinkButton onClick={restartFlow}>Start another assessment</LinkButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payment step ──────────────────────────────────────────────────────────────

/**
 * #435: the card is collected by Stripe's Payment Element mounted directly in
 * this page — no hosted redirect, no handoff. #430: the price appears exactly
 * once, on the left order card; the right column is what the money buys.
 */
function PaymentStep({
  sessionId,
  fee,
  company,
  includes,
  compliancePath,
  onPaid,
}: {
  sessionId: string;
  fee: string;
  company?: string;
  includes: string[];
  compliancePath: CompliancePath | null;
  onPaid: (warning?: string | null) => void;
}) {
  const [initError, setInitError] = useState<string | null>(null);
  /**
   * What the extracted StripePaymentElement (#1306) needs to boot: minted by
   * POST /payment-intent below, null until that lands. The Element itself —
   * stripe.js, theming, mount/confirm — lives in the component now.
   */
  const [intent, setIntent] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  /**
   * #490 — the order's real amounts, as the SERVER resolved them. `fee` above
   * is the catalog display string this component has always shown; these are
   * what the card is actually being charged, which is what a summary listing
   * two charges has to be built from.
   */
  const [baseCents, setBaseCents] = useState<number | null>(null);
  const [rescan, setRescan] = useState<{ priceCents: number; interval: string } | null>(null);

  // #458: fired once, on mount — mirrors Checkout.tsx's trackCheckoutStarted convention.
  useEffect(() => {
    trackCheckoutStarted("copilot-assessment");
  }, []);

  const confirmOnServer = useCallback(
    async (paymentIntentId: string) => {
      const res = await fetch("/api/public/flow/payment-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, paymentIntentId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error === "payment_not_succeeded"
            ? "Your bank has not confirmed the payment yet. Please wait a moment and try again."
            : "We took the payment but could not record it. Please contact us before paying again.",
        );
      }
      const data = (await res.json().catch(() => ({}))) as {
        amountCents?: number;
        rescanAddOn?: { status: string };
      };
      trackCheckoutCompleted("copilot-assessment", data.amountCents != null ? { amount_cents: data.amountCents } : {});
      // #490 — the assessment is paid for either way, so this never blocks the
      // flow. But a buyer who opted into a monthly charge that did not take is
      // told so rather than left to discover it from a missing invoice.
      onPaid(
        data.rescanAddOn?.status === "failed"
          ? "Your assessment payment went through. The recurring rescan add-on could not be set up — you have not been charged for it, and we'll be in touch to sort it out."
          : null,
      );
    },
    [sessionId, onPaid],
  );

  // Create the intent. Booting stripe.js and mounting the Payment Element is
  // the extracted component's job (#1306) — it starts the moment `intent` is
  // handed to it below.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/public/flow/payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          if (cancelled) return;
          setInitError(
            err.error === "payment_unavailable"
              ? "Card payment is temporarily unavailable. Please contact us and we'll take it from here."
              : err.error === "session_expired"
                ? "This session has expired. Please start again."
                : "We could not prepare the payment. Please try again shortly.",
          );
          return;
        }
        const data = (await res.json()) as {
          clientSecret: string;
          publishableKey: string;
          paymentIntentId: string;
          alreadyPaid: boolean;
          amountCents?: number;
          rescanAddOn?: { priceCents: number; interval: string } | null;
        };
        if (cancelled) return;
        if (typeof data.amountCents === "number") setBaseCents(data.amountCents);
        setRescan(data.rescanAddOn ?? null);

        // Recovered an intent that already succeeded (paid, then reloaded
        // before the callback landed) — finish the flow rather than asking
        // for a second card.
        if (data.alreadyPaid) {
          await confirmOnServer(data.paymentIntentId);
          return;
        }

        setIntent({ clientSecret: data.clientSecret, publishableKey: data.publishableKey });
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : "Could not load the payment form.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, confirmOnServer]);

  return (
    <div style={TWO_COL}>
      {/* LEFT — the order, priced exactly once, and the in-page card fields. */}
      <div>
        <span style={EYEBROW}>Payment</span>
        <h3 style={H3}>Complete your order.</h3>

        <div style={{ ...CARD, padding: 22, marginBottom: 22, maxWidth: 480 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Order</span>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#e2e8f0", margin: "14px 0 4px", fontWeight: 600 }}>
            Copilot Readiness Assessment
          </p>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 6px" }}>{company || "your tenant"}</p>
          <p style={{ fontSize: 12.5, color: "#64748b", margin: "0 0 18px" }}>
            {compliancePath === "declined"
              ? "Compliance pillar excluded at your request"
              : compliancePath === "self_add"
                ? "Compliance group membership: you're adding it"
                : compliancePath === "delegate_write"
                  ? "Compliance group membership: we'll add it"
                  : "All six pillars"}
          </p>
          {/* #490 — when the buyer opted into the recurring rescan the order is
              genuinely two things, so it is listed as two things. #430's "one
              price" rule is about not repeating the SAME price; it was never a
              reason to hide a second, real charge. */}
          {rescan && (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 14,
                marginBottom: 2,
                borderTop: "1px solid rgba(30,41,59,.9)",
              }}
            >
              <span style={{ fontSize: 13, color: "#94a3b8" }}>
                Recurring rescan
                <span style={{ display: "block", fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Weekly re-scan, billed monthly
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap" }}>
                {formatCents(rescan.priceCents)}/mo
              </span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              paddingTop: 16,
              borderTop: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{rescan ? "Charged today" : "Total due today"}</span>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc" }}>
              {/* Without the add-on this is unchanged: the catalog display
                  string. With it, the honest number is the server's own
                  amount plus the first month, so it is computed from the
                  server's figures rather than from the display string. */}
              {rescan && baseCents != null ? formatCents(baseCents + rescan.priceCents) : fee}
            </span>
          </div>
          {rescan && (
            <p style={{ fontSize: 12, lineHeight: 1.55, color: "#64748b", margin: "10px 0 0" }}>
              Appears as two entries from Stripe — the assessment, and the first month of rescanning. Then{" "}
              {formatCents(rescan.priceCents)} a month until you cancel.
            </p>
          )}
        </div>

        {initError ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: DANGER, maxWidth: 480 }}>{initError}</div>
        ) : intent ? (
          /* #482/#1306: the panel, theming and confirm lifecycle live in the
             extracted component; `confirmOnServer` rides its onSuccess so a
             recording failure surfaces in the panel's own error slot, exactly
             as before the extraction. */
          <StripePaymentElement
            clientSecret={intent.clientSecret}
            publishableKey={intent.publishableKey}
            onSuccess={confirmOnServer}
          />
        ) : (
          /* The intent is still being minted (or an alreadyPaid recovery is
             finishing) — the same panel shape the component is about to render,
             skeleton held and button disabled, so the payment surface does not
             pop in a beat after the order card. */
          <div style={PAY_PANEL}>
            <div style={PAY_PANEL_ACCENT} />
            <div style={PAY_PANEL_HEAD}>
              <span style={{ ...labelStyle(), marginBottom: 0 }}>Pay with</span>
              <span style={SECURE_BADGE}>
                <LockIcon />
                Secured by Stripe
              </span>
            </div>

            <div style={{ padding: "18px 20px 4px" }}>
              <div style={{ position: "relative", minHeight: 232 }}>
                <PaymentSkeleton />
              </div>
            </div>

            <div style={PAY_PANEL_FOOT}>
              {/* No price on the button — #430: it is shown once, above. */}
              <Button size="lg" disabled style={{ width: "100%" }}>
                Pay securely
              </Button>
            </div>
          </div>
        )}

        <p style={FOOTNOTE}>
          Card details go straight to Stripe from your browser and never touch our servers. You stay on this page the whole way through.
        </p>
      </div>

      {/* RIGHT — what the money buys (#430: a value list, not a second price). */}
      <ValueCard
        includes={includes}
        heading="What you're paying for"
        note={
          rescan
            ? "One scan of your whole tenant and the reports that come out of it, plus the weekly re-scan you added — billed monthly and cancellable at any time. No hourly billing, no per-seat maths."
            : "One scan of your whole tenant, and the reports that come out of it. No subscription, no hourly billing afterwards, no per-seat maths."
        }
      />
    </div>
  );
}

// ── Verify step (#436 scan telemetry + #437 six-digit code) ───────────────────

interface ScanTelemetry {
  everScanned: boolean;
  tenantConnected: boolean;
  run: {
    status: string;
    active: boolean;
    packageKey: string;
    checksTotal: number;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  severityCounts: { critical: number; warning: number; info: number; ok: number } | null;
  topFindings: Array<{ checkLabel: string; severity: string; title: string }>;
}

/**
 * The buyer proves the email address their order was placed under, while their
 * OWN scan reports itself alongside (#436).
 *
 * The scan panel is not decoration and not a progress animation: it renders the
 * real `msp_diagnostic_runs` row that the consent callback started minutes ago,
 * with the real check counts and the real finding titles. It polls while the run
 * is still active and stops the moment it is not. Every state it can be in —
 * including "no run has been recorded yet" — is stated plainly rather than
 * papered over, because a fabricated scan on the screen immediately after a real
 * card charge is precisely what #436 exists to prevent.
 */
function VerifyStep({
  sessionId,
  email,
  onVerified,
}: {
  sessionId: string;
  email?: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<ScanTelemetry | null>(null);

  const sendCode = useCallback(
    async (isResend: boolean) => {
      setSending(true);
      setErr(null);
      setNotice(null);
      try {
        const res = await fetch("/api/public/flow/send-verification-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
        if (!res.ok) {
          setErr(
            data.error === "email_send_failed"
              ? "We could not send the code to your email just now. Try again in a moment — your payment and your scan are unaffected."
              : data.error === "session_expired"
                ? "This session has expired. Your payment and scan are safe; contact us and we'll finish your account setup."
                : "We could not send your code. Please try again shortly.",
          );
          return;
        }
        setSent(true);
        setMaskedEmail(data.email ?? null);
        if (isResend) setNotice("A new code is on its way. The previous one no longer works.");
      } catch {
        setErr("Network error. Check your connection and try again.");
      } finally {
        setSending(false);
      }
    },
    [sessionId],
  );

  // One automatic send on arrival — the buyer should find the mail already
  // waiting rather than have to ask for it. The ref keeps React 18's double
  // effect invocation in dev from mailing two codes (the second would silently
  // supersede the first, so the one in the inbox would be the dead one).
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    autoSentRef.current = true;
    void sendCode(false);
  }, [sendCode]);

  // Poll the real scan while it is genuinely still running; one read otherwise.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/public/flow/scan-telemetry?sessionId=${encodeURIComponent(sessionId)}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as ScanTelemetry;
          setTelemetry(data);
          // Stop polling once the run is finished — but keep polling while no
          // run row exists yet, since the consent-time run may still be starting.
          if (data.run && !data.run.active) return;
        }
      } catch {
        /* transient — the next tick retries */
      }
      if (!cancelled) timer = setTimeout(tick, 5000);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  async function submitCode() {
    if (!/^\d{6}$/.test(code)) return;
    setChecking(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await fetch("/api/public/flow/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; attemptsRemaining?: number };
      if (!res.ok) {
        setErr(
          data.error === "code_incorrect"
            ? `That code is not right.${
                typeof data.attemptsRemaining === "number"
                  ? ` ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} left before you need a new one.`
                  : ""
              }`
            : data.error === "code_expired"
              ? "That code has expired. Send yourself a new one below."
              : data.error === "too_many_attempts"
                ? "Too many incorrect attempts on that code. Send yourself a new one below."
                : data.error === "no_code_issued"
                  ? "No code has been sent yet. Use the resend link below."
                  : "We could not check that code. Please try again.",
        );
        return;
      }
      onVerified();
    } catch {
      setErr("Network error. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={TWO_COL}>
      <div>
        <span style={EYEBROW}>Verify your email</span>
        <h3 style={H3}>Confirm it's you, then set a password.</h3>
        <p style={{ ...BODY, maxWidth: 480 }}>
          We've sent a six-digit code to <strong style={{ color: "#cbd5e1" }}>{maskedEmail || email || "your work email"}</strong>. Entering
          it proves the address is yours before we attach a password to your account. Your scan is running regardless — it started when you
          granted consent.
        </p>

        <label style={{ display: "block", maxWidth: 320 }}>
          <span style={labelStyle()}>Six-digit code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && /^\d{6}$/.test(code) && !checking) void submitCode();
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace", fontSize: 22, letterSpacing: ".38em", textAlign: "center" }}
          />
        </label>

        {err && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fca5a5", margin: "14px 0 0", maxWidth: 480 }}>{err}</p>}
        {notice && !err && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#93c5fd", margin: "14px 0 0", maxWidth: 480 }}>{notice}</p>}

        <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <Button size="lg" onClick={submitCode} disabled={!/^\d{6}$/.test(code) || checking}>
            {checking ? "Checking…" : "Verify and continue"}
          </Button>
          <LinkButton onClick={() => void sendCode(true)}>
            {sending ? "Sending…" : sent ? "Send a new code" : "Send my code"}
          </LinkButton>
        </div>

        <p style={FOOTNOTE}>
          The code expires in 15 minutes. Nothing else is charged at this step — your payment is already complete.
        </p>
      </div>

      <ScanTelemetryCard telemetry={telemetry} />
    </div>
  );
}

/**
 * #436's honest panel. Renders exactly one of four real states, and never
 * invents a score, a percentage or a pillar the payload did not carry.
 */
function ScanTelemetryCard({ telemetry }: { telemetry: ScanTelemetry | null }) {
  const heading = (
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
      Your scan, right now
    </span>
  );

  if (!telemetry) {
    return (
      <div style={CARD}>
        {heading}
        <p style={{ fontSize: 13, color: "#64748b", margin: "14px 0 0", lineHeight: 1.55 }}>Reading your scan…</p>
      </div>
    );
  }

  // No run row yet. The consent-time scan is fire-and-forget, so a buyer who
  // moved fast can genuinely arrive here before it has registered. Say that.
  if (!telemetry.everScanned || !telemetry.run) {
    return (
      <div style={CARD}>
        {heading}
        <p style={{ fontSize: 13.5, color: "#94a3b8", margin: "14px 0 0", lineHeight: 1.6 }}>
          {telemetry.tenantConnected
            ? "Your tenant is connected and the scan has been requested, but it hasn't reported its first check yet. This page keeps watching — nothing here is waiting on you."
            : "Your tenant connection isn't recorded against this order yet. Your payment is safe; we'll pick this up with you directly if it doesn't resolve."}
        </p>
      </div>
    );
  }

  const run = telemetry.run;
  const counted = run.checksOk + run.checksError + run.checksLicenseGap;
  const sev = telemetry.severityCounts;

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        {heading}
        <span style={{ fontSize: 11.5, color: run.active ? "#60a5fa" : "#34d399" }}>
          {run.active ? "Running" : run.status === "completed" ? "Complete" : run.status}
        </span>
      </div>

      <p style={{ fontSize: 13, color: "#64748b", margin: "14px 0 18px", lineHeight: 1.55 }}>
        {run.active
          ? "Live from the read-only scan that started when you granted consent."
          : "The read-only scan that started when you granted consent has finished."}
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        <TelemetryRow label="Checks run" value={`${counted}${run.checksTotal > 0 ? ` of ${run.checksTotal}` : ""}`} />
        <TelemetryRow label="Passed" value={String(run.checksOk)} color="#34d399" />
        {run.checksError > 0 && <TelemetryRow label="Errors" value={String(run.checksError)} color="#f87171" />}
        {run.checksLicenseGap > 0 && <TelemetryRow label="Blocked by licensing" value={String(run.checksLicenseGap)} color="#fbbf24" />}
        {sev && sev.critical > 0 && <TelemetryRow label="Critical findings" value={String(sev.critical)} color="#f87171" />}
        {sev && sev.warning > 0 && <TelemetryRow label="Warnings" value={String(sev.warning)} color="#fbbf24" />}
      </div>

      {telemetry.topFindings.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(30,41,59,.9)" }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>
            Already found
          </span>
          <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
            {telemetry.topFindings.map((finding, i) => (
              <span
                key={`${finding.checkLabel}-${i}`}
                style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, lineHeight: 1.45, color: "#cbd5e1" }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: finding.severity === "critical" ? "#f87171" : "#fbbf24",
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />
                {finding.title}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#475569", margin: "14px 0 0", lineHeight: 1.5 }}>
            A sample, not the report. The full set — with the evidence behind each one — is what lands in your portal.
          </p>
        </div>
      )}

      {run.checksTotal === 0 && counted === 0 && (
        <p style={{ fontSize: 12.5, color: "#475569", margin: "16px 0 0", lineHeight: 1.5 }}>
          The run is registered but has not reported any checks yet.
        </p>
      )}
    </div>
  );
}

function TelemetryRow({ label, value, color = "#e2e8f0" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, color: "#94a3b8" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

// ── Password step (#438) ──────────────────────────────────────────────────────

/**
 * Completes the account inline. The users row already exists — it was created at
 * consent time — so this attaches the credential and nothing more. The server
 * hashes with bcrypt; the password never leaves this component in any other
 * form and is never stored client-side.
 */
function PasswordStep({
  sessionId,
  email,
  onComplete,
}: {
  sessionId: string;
  email?: string;
  onComplete: (portalUrl: string | null) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const invalid = password.length < 8 || confirm !== password;

  async function save() {
    if (invalid) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/public/flow/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; portalUrl?: string };
      if (!res.ok) {
        if (data.error === "already_set") {
          // A returning buyer whose account predates this order. Not a failure —
          // their order is complete and their existing password still works.
          onComplete(data.portalUrl ?? null);
          return;
        }
        setErr(
          data.error === "email_not_verified"
            ? "We couldn't confirm your email was verified. Go back a step and request a new code."
            : data.error === "account_missing"
              ? "Your account record isn't ready yet. Your payment and scan are safe — contact us and we'll finish this off directly."
              : "We could not set your password. Please try again.",
        );
        return;
      }
      onComplete(data.portalUrl ?? null);
    } catch {
      setErr("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <span style={EYEBROW}>Set your password</span>
      <h3 style={H3}>One last thing — secure your account.</h3>
      <p style={BODY}>
        Your account was created against {email ? <strong style={{ color: "#cbd5e1" }}>{email}</strong> : "your work email"} when you
        granted consent. Set a password now and it's ready to sign into — no setup link to wait for, no email to go hunting through.
      </p>

      <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
        <label>
          <span style={labelStyle()}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            style={fieldStyle()}
          />
        </label>
        <label>
          <span style={labelStyle()}>Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !invalid && !busy) void save();
            }}
            autoComplete="new-password"
            placeholder="Type it again"
            style={fieldStyle()}
          />
        </label>
      </div>

      {tooShort && <p style={{ fontSize: 13, color: "#fbbf24", margin: "12px 0 0" }}>Passwords must be at least 8 characters.</p>}
      {mismatch && <p style={{ fontSize: 13, color: "#fbbf24", margin: "12px 0 0" }}>Those two don't match yet.</p>}
      {err && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fca5a5", margin: "14px 0 0", maxWidth: 480 }}>{err}</p>}

      <div style={{ marginTop: 22 }}>
        <Button size="lg" onClick={save} disabled={invalid || busy}>
          {busy ? "Saving…" : "Finish setup"}
        </Button>
      </div>

      <p style={FOOTNOTE}>
        Stored as a salted bcrypt hash — we never keep the password itself, and nobody here can read it back.
      </p>
    </div>
  );
}

// ── Small shared pieces ───────────────────────────────────────────────────────

function ValueCard({
  includes,
  heading = "Included",
  note = "Your whole tenant, scanned in full — no sampling, no seat tiers.",
}: {
  includes: string[];
  heading?: string;
  note?: string;
}) {
  return (
    <div style={CARD}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>{heading}</span>
      <p style={{ fontSize: 13, color: "#64748b", margin: "14px 0 20px", lineHeight: 1.55 }}>{note}</p>
      <div style={{ display: "grid", gap: 11 }}>
        {includes.map((item) => (
          <span key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, lineHeight: 1.45, color: "#cbd5e1" }}>
            <CheckIcon color="#60a5fa" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Scopes panel (#447) ────────────────────────────────────────────────────────
// The real app registration requests 25+ application permissions (#433 pulled
// them live off REQUIRED_MT_SCOPES); a flat bulleted list of that many items ran
// well past the viewport with no structure. Grouped into named categories behind
// native <details> disclosures instead — no extra JS state, works with the
// keyboard out of the box, and a stack of <details> is already a single mobile
// column with zero extra responsive work.

interface ScopeCategory {
  label: string;
  color: string;
}

const SCOPE_CATEGORIES = {
  identity: { label: "Identity & Access", color: "#60a5fa" },
  security: { label: "Security & Risk", color: "#f87171" },
  devices: { label: "Devices & Compliance", color: "#34d399" },
  collaboration: { label: "Collaboration & Content", color: "#fbbf24" },
  reporting: { label: "Reporting & Service Health", color: "#a78bfa" },
  other: { label: "Other", color: "#94a3b8" },
} satisfies Record<string, ScopeCategory>;

type ScopeCategoryKey = keyof typeof SCOPE_CATEGORIES;

/**
 * Maps each currently-known Graph application permission to a display
 * category. A scope not listed here (one added to REQUIRED_MT_SCOPES later,
 * before this map is updated) falls into "Other" rather than disappearing, so
 * the grouped view can never silently drop a permission the backend is
 * actually requesting.
 *
 * Covers the write app's permissions too (#475) — this map is keyed by
 * permission name and `groupScopes` is used by both consent steps, so the write
 * list would otherwise render under a bare "Other" heading.
 */
const SCOPE_CATEGORY_BY_NAME: Record<string, ScopeCategoryKey> = {
  "Directory.Read.All": "identity",
  "Policy.Read.All": "identity",
  "RoleEligibilitySchedule.Read.Directory": "identity",
  "AccessReview.Read.All": "identity",
  "Agreement.Read.All": "identity",
  "Application.Read.All": "identity",
  "DelegatedPermissionGrant.Read.All": "identity",
  // Write app (REQUIRED_WRITE_APP_PERMISSIONS) — both are directory-object
  // permissions, so they group with Identity & Access.
  "Application.ReadWrite.All": "identity",
  "Group.Create": "identity",
  "SecurityEvents.Read.All": "security",
  "AuditLog.Read.All": "security",
  "IdentityRiskyUser.Read.All": "security",
  "IdentityRiskyServicePrincipal.Read.All": "security",
  "InformationProtectionPolicy.Read.All": "security",
  "SensitivityLabels.Read.All": "security",
  "RecordsManagement.Read.All": "security",
  "DeviceManagementConfiguration.Read.All": "devices",
  "DeviceManagementManagedDevices.Read.All": "devices",
  "BitlockerKey.Read.All": "devices",
  "Exchange.ManageAsApp": "collaboration",
  "Sites.Read.All": "collaboration",
  "TeamSettings.Read.All": "collaboration",
  "Team.ReadBasic.All": "collaboration",
  "Community.Read.All": "collaboration",
  "SharePointTenantSettings.Read.All": "collaboration",
  "Reports.Read.All": "reporting",
  "ActivityFeed.Read": "reporting",
  "RealTimeActivityFeed.Read.All": "reporting",
  "ServiceMessage.Read.All": "reporting",
  "ServiceHealth.Read.All": "reporting",
};

const SCOPE_CATEGORY_ORDER: ScopeCategoryKey[] = ["identity", "security", "devices", "collaboration", "reporting", "other"];

function groupScopes(scopes: string[]): Array<{ key: ScopeCategoryKey; items: string[] }> {
  const buckets = new Map<ScopeCategoryKey, string[]>();
  for (const scope of scopes) {
    const key = SCOPE_CATEGORY_BY_NAME[scope] ?? "other";
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(scope);
  }
  return SCOPE_CATEGORY_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key)! }));
}

/**
 * `title`/`note` are parameterised (#475) so the write-consent step can reuse
 * this exact grouped presentation without inheriting the read step's
 * "all read-only" claim, which would be false for the write app.
 */
function ScopesPanel({
  scopes,
  loading,
  title = "Scopes requested",
  note,
}: {
  scopes: string[];
  loading: boolean;
  title?: string;
  note?: string;
}) {
  const groups = groupScopes(scopes);
  return (
    <div style={{ ...CARD, borderRadius: 14, padding: "20px 22px", marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>
          {title}
        </span>
        {scopes.length > 0 && (
          <span style={{ fontSize: 11.5, color: "#475569" }}>
            {note ?? `${scopes.length} permissions, all read-only`}
          </span>
        )}
      </div>

      {scopes.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {groups.map(({ key, items }, i) => {
            const cat = SCOPE_CATEGORIES[key];
            return (
              <details
                key={key}
                className="smc-scope-group"
                open={i === 0}
                style={{ borderRadius: 10, border: "1px solid rgba(51,65,85,.55)", background: "rgba(2,6,23,.35)", overflow: "hidden" }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#e2e8f0",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
                  <span>{cat.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>{items.length}</span>
                </summary>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))",
                    gap: 7,
                    padding: "4px 14px 14px",
                  }}
                >
                  {items.map((scope) => (
                    <span
                      key={scope}
                      style={{
                        fontFamily: "Menlo,ui-monospace,monospace",
                        fontSize: 11.5,
                        lineHeight: 1.4,
                        color: "#94a3b8",
                        background: "rgba(15,23,42,.6)",
                        border: "1px solid rgba(51,65,85,.5)",
                        borderRadius: 6,
                        padding: "5px 8px",
                        wordBreak: "break-word",
                      }}
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "#475569", margin: "14px 0 0" }}>
          {loading ? "Loading requested scopes…" : "Scope list is temporarily unavailable."}
        </p>
      )}
    </div>
  );
}

function ChoiceCard({
  title,
  body,
  action,
  onClick,
  disabled,
  muted,
  badge,
}: {
  title: string;
  body: string;
  action: string;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
  /** Optional eyebrow above the title, e.g. "Most Popular" (#480). */
  badge?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${muted ? "rgba(51,65,85,.7)" : "rgba(37,99,235,.32)"}`,
        borderRadius: 14,
        background: muted ? "rgba(2,6,23,.4)" : "rgba(2,6,23,.55)",
        padding: "18px 20px",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        {badge && (
          <span
            style={{
              display: "inline-block",
              marginBottom: 8,
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px solid rgba(59,130,246,.45)",
              background: "rgba(37,99,235,.16)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "#bfdbfe",
            }}
          >
            {badge}
          </span>
        )}
        <p style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", margin: "0 0 6px" }}>{title}</p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#94a3b8", margin: 0 }}>{body}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          flexShrink: 0,
          background: muted ? "transparent" : "rgba(37,99,235,.16)",
          border: `1px solid ${muted ? "rgba(71,85,105,.9)" : "rgba(59,130,246,.55)"}`,
          borderRadius: 10,
          padding: "10px 16px",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          color: muted ? "#94a3b8" : "#bfdbfe",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {action}
      </button>
    </div>
  );
}

function WaitingPulse({ label }: { label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#60a5fa",
          boxShadow: "0 0 10px #60a5fa",
          animation: "smcBreath 1.4s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
    </span>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, color: "#475569", cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StepIcon() {
  return (
    <span
      style={{
        flexShrink: 0,
        width: 40,
        height: 40,
        borderRadius: 12,
        background: "rgba(37,99,235,.14)",
        border: "1px solid rgba(37,99,235,.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
