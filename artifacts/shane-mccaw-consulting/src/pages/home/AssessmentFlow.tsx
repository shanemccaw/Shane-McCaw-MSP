import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./dsComponents";
import { useConsentScopes } from "@/hooks/useConsentScopes";

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
 * ── Where the flow deliberately stops ─────────────────────────────────────────
 * It ends at a real payment confirmation. The account-creation steps that used
 * to follow (six-digit email code, password, MFA) were placeholder UI with no
 * backend, and are tracked as #437/#438/#439; the scan-telemetry panel is #436.
 * They are not rendered here, because sitting them immediately after a real
 * card charge would show a paying customer fabricated progress.
 */

/** Steps that always run, in order, with the #432 branch spliced in at index 3. */
type StepKey =
  | "details"
  | "consent"
  | "compliance"
  | "self-add"
  | "write-consent"
  | "payment"
  | "done";

type CompliancePath = "self_add" | "delegate_write" | "declined";

const STEP_LABEL: Record<StepKey, string> = {
  details: "Details",
  consent: "Consent",
  compliance: "Compliance",
  "self-add": "Group",
  "write-consent": "Write access",
  payment: "Payment",
  done: "Confirmed",
};

/** The flow's step list, which #432's decision reshapes mid-flow. */
function stepsFor(path: CompliancePath | null): StepKey[] {
  const branch: StepKey[] =
    path === "self_add" ? ["self-add"] : path === "delegate_write" ? ["write-consent"] : [];
  return ["details", "consent", "compliance", ...branch, "payment", "done"];
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

interface FlowStatus {
  sessionStatus: string;
  tenantConnected: boolean;
  graph: string | null;
  sharepoint: string | null;
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
 * Opens a Microsoft consent screen without navigating this page away. Must be
 * called synchronously from the click handler or the popup blocker eats it —
 * hence the URL is fetched up-front and this only opens an already-known one.
 */
function openConsentPopup(url: string): Window | null {
  return window.open(url, "smc-consent", "width=640,height=780,menubar=no,toolbar=no");
}

// ── stripe.js (#435) ──────────────────────────────────────────────────────────
// Loaded from Stripe's own domain rather than bundled — required by Stripe and
// the reason no @stripe/* npm package is needed for the Payment Element.

interface StripeElement {
  mount: (target: HTMLElement) => void;
  destroy: () => void;
}
interface StripeElements {
  create: (type: "payment", options?: Record<string, unknown>) => StripeElement;
}
interface StripeInstance {
  elements: (options: Record<string, unknown>) => StripeElements;
  confirmPayment: (options: {
    elements: StripeElements;
    redirect: "if_required";
    confirmParams?: Record<string, unknown>;
  }) => Promise<{
    error?: { message?: string };
    paymentIntent?: { id: string; status: string };
  }>;
}
declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

const STRIPE_JS_SRC = "https://js.stripe.com/v3/";

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("stripe.js failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = STRIPE_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("stripe.js failed to load"));
    document.head.appendChild(script);
  });
}

// ── Styling helpers (unchanged from the original design) ──────────────────────

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 15px",
    borderRadius: 10,
    border: "1px solid rgba(51,65,85,.9)",
    background: "rgba(2,6,23,.6)",
    color: "#f1f5f9",
    fontFamily: "inherit",
    fontSize: 15,
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
    color: "#64748b",
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

  // Which consent the Consent step is currently on (#434: Graph, then SharePoint).
  const [consentStage, setConsentStage] = useState<"graph" | "sharepoint">("graph");
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  /** Bumped to force a fresh consent link (a declined grant spends the old one). */
  const [consentNonce, setConsentNonce] = useState(0);

  const { scopes, loading: scopesLoading } = useConsentScopes();

  const setField = (key: keyof FlowForm, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Poll only while a consent grant is genuinely outstanding.
  const polling =
    !!sessionId && (step === "consent" || step === "write-consent");
  const status = useFlowStatus(sessionId, polling);

  const includeList = includes && includes.length > 0 ? includes : INCLUDES_FALLBACK;
  const steps = stepsFor(compliancePath);
  const stepIdx = Math.max(0, steps.indexOf(step));

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
    fetch(`/api/public/flow/consent-status?sessionId=${encodeURIComponent(stored)}`)
      .then((r) => (r.ok ? (r.json() as Promise<FlowStatus>) : Promise.reject(new Error("gone"))))
      .then((s) => {
        if (cancelled) return;
        if (s.sessionStatus === "paid") {
          setStep("done");
          return;
        }
        if (s.complianceGroup) {
          setCompliancePath(s.complianceGroup.path);
          if (s.complianceGroup.path === "self_add" && !s.complianceGroup.confirmed) setStep("self-add");
          else if (s.complianceGroup.path === "delegate_write" && s.writeBack !== "granted") setStep("write-consent");
          else setStep("payment");
          return;
        }
        if (s.sharepoint === "granted") setStep("compliance");
        else if (s.graph === "granted") {
          setConsentStage("sharepoint");
          setStep("consent");
        }
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
  useEffect(() => {
    if (!status) return;
    if (step === "consent") {
      if (consentStage === "graph" && status.graph === "granted") {
        setConsentStage("sharepoint");
        setConsentUrl(null);
        setError(null);
      } else if (consentStage === "sharepoint" && status.sharepoint === "granted") {
        setStep("compliance");
        setError(null);
      }
    } else if (step === "write-consent" && status.writeBack === "granted") {
      setStep("payment");
      setError(null);
    }
  }, [status, step, consentStage]);

  // Surface a declined grant rather than polling forever behind a silent UI —
  // and mint a FRESH consent link for the retry. The SharePoint and write-app
  // callbacks burn their single-use token on the decline path too, so the URL
  // already in hand is spent; reusing it would fail with "already used". The
  // ref keeps this to one re-fetch per decline instead of one per poll tick.
  const declineHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const stage = step === "consent" ? consentStage : step;
    const declined =
      (step === "consent" && consentStage === "graph" && status.graph === "declined") ||
      (step === "consent" && consentStage === "sharepoint" && status.sharepoint === "declined") ||
      (step === "write-consent" && status.writeBack === "declined");
    if (declined && declineHandledRef.current !== stage) {
      declineHandledRef.current = stage;
      setError("The Microsoft permission screen was declined. Try again below, or go back and choose a different option.");
      setConsentNonce((n) => n + 1);
    }
  }, [status, step, consentStage]);

  // Fetch the consent URL for whichever grant is outstanding, so the click
  // handler has one ready and the popup opens synchronously.
  useEffect(() => {
    if (!sessionId) return;
    const endpoint =
      step === "consent" && consentStage === "graph"
        ? `/api/public/consent-url?sessionId=${encodeURIComponent(sessionId)}`
        : step === "consent" && consentStage === "sharepoint"
          ? `/api/public/flow/sharepoint-consent-url?sessionId=${encodeURIComponent(sessionId)}`
          : step === "write-consent"
            ? `/api/public/flow/write-consent-url?sessionId=${encodeURIComponent(sessionId)}`
            : null;
    if (!endpoint) return;

    let cancelled = false;
    setConsentUrl(null);
    fetch(endpoint)
      .then((r) => r.json() as Promise<{ url?: string | null; consentUrl?: string | null; error?: string }>)
      .then((d) => {
        if (cancelled) return;
        const url = d.consentUrl ?? d.url ?? null;
        setConsentUrl(url);
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
  }, [sessionId, step, consentStage, consentNonce]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function submitDetails() {
    if (detailsInvalid || !productSlug) return;
    setBusy(true);
    setError(null);
    try {
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
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "We could not start your order. Please try again.");
        return;
      }
      const { sessionId: id } = (await res.json()) as { sessionId: string };
      saveSessionId(id);
      setSessionId(id);
      setConsentStage("graph");
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
      setCompliancePath(path);
      setStep(path === "self_add" ? "self-add" : path === "delegate_write" ? "write-consent" : "payment");
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
      setStep("payment");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Stable — PaymentStep's setup effect depends on it, and an inline closure
  // here would give that effect a new identity on every render, re-creating the
  // PaymentIntent in a loop.
  const goDone = useCallback(() => setStep("done"), []);

  const restartFlow = useCallback(() => {
    clearSessionId();
    setSessionId(null);
    setStep("details");
    setCompliancePath(null);
    setConsentStage("graph");
    setConsentUrl(null);
    setError(null);
    setForm({});
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginBottom: 34 }}>
        {steps.map((key, i) => {
          const ring = i === stepIdx ? "#3B82F6" : i < stepIdx ? "rgba(37,99,235,.5)" : "rgba(51,65,85,.9)";
          const fill = i === stepIdx ? "#3B82F6" : i < stepIdx ? "rgba(37,99,235,.14)" : "transparent";
          const numColor = i === stepIdx ? "#f8fafc" : i < stepIdx ? "#93c5fd" : "#475569";
          const color = i === stepIdx ? "#f1f5f9" : i < stepIdx ? "#93c5fd" : "#475569";
          return (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 9 }}>
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
                {i < stepIdx ? "✓" : String(i + 1)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color }}>
                {STEP_LABEL[key]}
              </span>
            </span>
          );
        })}
      </div>

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
        <div style={TWO_COL}>
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

      {/* ── Step 2 — Consent: read-only Graph, then read-only SharePoint ────── */}
      {step === "consent" && (
        <div style={{ maxWidth: 620 }}>
          <span style={EYEBROW}>
            Step 2 — Microsoft consent {consentStage === "graph" ? "(1 of 2)" : "(2 of 2)"}
          </span>
          <h3 style={H3}>
            {consentStage === "graph"
              ? "Grant read-only access to your tenant."
              : "Now grant read-only access to SharePoint."}
          </h3>
          <p style={BODY}>
            {consentStage === "graph"
              ? "This opens the Microsoft admin consent screen in a new window. An account with Global Administrator or Privileged Role Administrator can approve it. The scan reads; it never writes, never moves a file, and never changes a policy."
              : "SharePoint Online is a separate approval on the same app registration, so it is a second trip to the Microsoft consent screen. Same read-only footing — site inventory and sharing configuration, nothing written."}
          </p>

          {consentStage === "graph" && (
            <div style={{ ...CARD, borderRadius: 14, padding: "20px 22px", marginBottom: 26 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>
                Scopes requested
              </span>
              {scopes.length > 0 ? (
                <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                  {scopes.map((scope) => (
                    <span
                      key={scope}
                      style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "Menlo,ui-monospace,monospace", fontSize: 12.5, color: "#cbd5e1" }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#60a5fa", flexShrink: 0 }} />
                      {scope}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: "#475569", margin: "14px 0 0" }}>
                  {scopesLoading ? "Loading requested scopes…" : "Scope list is temporarily unavailable."}
                </p>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Button size="lg" onClick={grantConsent} disabled={!consentUrl}>
              {consentStage === "graph" ? "Grant Consent in Microsoft 365" : "Grant SharePoint Access"}
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

      {/* ── Payment — embedded Stripe Payment Element (#435) + single price (#430) */}
      {step === "payment" && sessionId && (
        <PaymentStep
          sessionId={sessionId}
          fee={fee}
          company={f.company}
          includes={includeList}
          compliancePath={compliancePath}
          onPaid={goDone}
        />
      )}

      {/* ── Confirmed ───────────────────────────────────────────────────────── */}
      {step === "done" && (
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", maxWidth: 640 }}>
          <StepIcon />
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "0 0 10px" }}>
              Payment received{f.first ? `, ${f.first}` : ""}. Your scan is already running.
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 20px" }}>
              Consent is live against {f.company || "your tenant"} and the read-only scan started the moment it was granted — before you
              paid, not after. Your reports are generated from that scan and land in the portal; we'll email {f.email || "you"} with your
              account details and a link to them.
            </p>
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
  onPaid: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);

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
      onPaid();
    },
    [sessionId, onPaid],
  );

  // Create the intent, boot stripe.js, mount the Payment Element.
  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;

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
        };
        if (cancelled) return;
        setIntentId(data.paymentIntentId);

        // Recovered an intent that already succeeded (paid, then reloaded
        // before the callback landed) — finish the flow rather than asking
        // for a second card.
        if (data.alreadyPaid) {
          await confirmOnServer(data.paymentIntentId);
          return;
        }

        await loadStripeJs();
        if (cancelled || !window.Stripe || !mountRef.current) return;

        const stripe = window.Stripe(data.publishableKey);
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret: data.clientSecret,
          appearance: {
            theme: "night",
            variables: {
              colorPrimary: "#3B82F6",
              colorBackground: "#0b1220",
              colorText: "#e2e8f0",
              colorDanger: "#f87171",
              fontFamily: "inherit",
              borderRadius: "10px",
            },
          },
        });
        elementsRef.current = elements;
        element = elements.create("payment");
        element.mount(mountRef.current);
        setReady(true);
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : "Could not load the payment form.");
      }
    })();

    return () => {
      cancelled = true;
      try {
        element?.destroy();
      } catch {
        /* already torn down */
      }
    };
  }, [sessionId, confirmOnServer]);

  async function pay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    try {
      // redirect: "if_required" keeps the buyer on this page for every payment
      // method that does not genuinely need a bank redirect.
      const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
      if (result.error) {
        setPayError(result.error.message ?? "Your payment could not be completed.");
        return;
      }
      const id = result.paymentIntent?.id ?? intentId;
      if (!id || result.paymentIntent?.status !== "succeeded") {
        setPayError("Your payment is still processing. We'll email you as soon as it clears.");
        return;
      }
      await confirmOnServer(id);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Something went wrong taking the payment.");
    } finally {
      setPaying(false);
    }
  }

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
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              paddingTop: 16,
              borderTop: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <span style={{ fontSize: 13, color: "#94a3b8" }}>Total due today</span>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc" }}>{fee}</span>
          </div>
        </div>

        {initError ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "#fca5a5", maxWidth: 480 }}>{initError}</div>
        ) : (
          <>
            <div style={{ maxWidth: 480, minHeight: 210 }}>
              <div ref={mountRef} />
              {!ready && <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>Loading secure card fields…</p>}
            </div>

            {payError && (
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fca5a5", margin: "14px 0 0", maxWidth: 480 }}>{payError}</p>
            )}

            <div style={{ marginTop: 20 }}>
              {/* No price on the button — #430: it is shown once, above. */}
              <Button size="lg" onClick={pay} disabled={!ready || paying}>
                {paying ? "Processing…" : "Pay securely"}
              </Button>
            </div>
          </>
        )}

        <p style={FOOTNOTE}>
          Card details go straight to Stripe from your browser and never touch our servers. You stay on this page the whole way through.
        </p>
      </div>

      {/* RIGHT — what the money buys (#430: a value list, not a second price). */}
      <ValueCard
        includes={includes}
        heading="What you're paying for"
        note="One scan of your whole tenant, and the reports that come out of it. No subscription, no hourly billing afterwards, no per-seat maths."
      />
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

function ChoiceCard({
  title,
  body,
  action,
  onClick,
  disabled,
  muted,
}: {
  title: string;
  body: string;
  action: string;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
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
