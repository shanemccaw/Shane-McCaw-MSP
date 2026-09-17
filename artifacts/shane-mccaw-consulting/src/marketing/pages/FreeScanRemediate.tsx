import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FreeScanFlowStrip } from "../components/FreeScanFlowStrip";
import { FreeScanAccountSetup, type FreeScanCredential } from "../components/FreeScanAccountSetup";
import { FREE_SCAN_SESSION_STORAGE_KEY } from "./FreeScan";
import { logger } from "../../lib/logger";

/**
 * /scan/remediate — step 5 of 5 of the Free Scan flow (Git #1375, Phase of
 * Feature #1352).
 *
 * Three screens behind one route, chosen by real server state, never by a stored
 * UI step:
 *
 *   0. The account step (Git #4329) — the design's `{{ acctScreen }}` block
 *      (emailed code → password → second factor), rendered by
 *      components/FreeScanAccountSetup.tsx at the server's `account` stage. It
 *      creates the Prospect's SCOPED login: their engagement page (/scan/account)
 *      with their own results and signed SOW — not the customer Portal, which
 *      stays behind a real entitlement (#656). Both of this page's "you can do it
 *      later" promises point there.
 *   1. The write-consent gate — the `{{ writeStage }}` block of the confirmed
 *      design `Design/marketing/marketing_handoff/Marketing Checkout.dc.html`,
 *      recreated verbatim: the amber eyebrow, the headline, the explanation,
 *      the "Scopes requested" card, the two actions and the footnote. Every
 *      user-facing string on it is the design's own.
 *   2. The remediation guide — the design's `{{ paid }}` done block, followed
 *      by this tenant's REAL open findings. The design file carries no export
 *      for the guide list itself (its state chain ends at `paid`), so the list
 *      is built against the written spec in this repo's existing visual
 *      language, matching FreeScanReview.tsx's own cards rather than inventing
 *      a third one.
 *
 * ── Nothing on this page is a fixture ─────────────────────────────────────────
 * There is no `*Data.ts` module behind this file and no scope, permission,
 * finding or figure written into it. The whole page is one payload from
 * `POST /api/public/free-scan/remediate/read`:
 *
 *   • `scopes` is DERIVED per Prospect — the phases they actually bought in the
 *     Review step (#1374), mapped through their own scan's open findings to the
 *     active config packs that fix them, to those packs' real Graph writes, to
 *     the application permission Microsoft documents for each one. A Prospect
 *     who bought one phase sees the permissions that phase alone consumes.
 *   • `guide` is `lib/remediation-checklist.ts` (#1538) — the same
 *     findings-derived items, fix routes and knowledge-base content the
 *     authenticated Portal serves, reached through the Prospect's own door.
 *   • the money on the done screen is read back off the engagement's captured
 *     figures, not recomputed here.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────
 * Same doors as Results (#1358), the return link (#1359) and Review (#1374):
 * the live flow's checkout sessionId out of sessionStorage, or the emailed
 * return token, both in the request BODY — or, with neither, the signed-in
 * engagement account's own session cookie (#4329, `accountSession: true`). A
 * Free Scan Prospect holds no Portal JWT (#656) and paying for a SOW does not
 * create one.
 *
 * ── The consent itself happens on Microsoft's domain ──────────────────────────
 * "Grant write access" opens the real admin-consent popup. This page never
 * navigates away; it polls `/read` until the server reports the grant actually
 * landed — which only happens after Microsoft issues a real write-app token for
 * the tenant (#4197, in the shared callback). A closed popup with no grant
 * leaves the page exactly where it was, which is the honest outcome.
 */

const log = logger.child({ channel: "auth" });

// ── The wire shape `POST /api/public/free-scan/remediate/read` returns ────────

interface WriteScope {
  permission: string;
  why: string;
  phaseSlugs: string[];
  phaseNames: string[];
  checkKeys: string[];
}

interface BoughtPhase {
  slug: string;
  name: string;
  pillar: string;
}

interface PhaseWithoutWrite {
  slug: string;
  name: string;
  reason: "no_open_findings" | "no_executable_fix";
}

interface KbStep {
  title?: string;
  detail?: string;
  command?: string;
  [key: string]: unknown;
}

interface GuideItem {
  checkKey: string;
  findingId: string;
  severity: "critical" | "warning";
  title: string;
  description: string | null;
  fixRoute: "we_can_run" | "you_must_run" | "admin_center_only";
  affordance: "execute" | "copy" | "link";
  hasVerifiedContent: boolean;
  summary: string | null;
  remediationSteps: KbStep[];
  adminCenterPath: string | null;
  adminCenterUrl: string | null;
  validationCommand: string | null;
  status: string;
  completedAt: string | null;
  verificationState: string;
  verifiedAt: string | null;
  phaseSlug: string | null;
  phaseName: string | null;
}

interface RemediateState {
  stage: "not_paid" | "account" | "write_consent" | "guide";
  sowReference: string;
  paymentPlan: "full" | "phased";
  phaseSlugs: string[];
  chargedCents: number;
  agreedServicesCents: number;
  runId: string | null;
  boughtPhases: BoughtPhase[];
  scopes: WriteScope[];
  phasesWithoutWrite: PhaseWithoutWrite[];
  grantedBeyondScope: string[];
  writeConsent: {
    status: string | null;
    consentedAt: string | null;
    decision: "requested" | "granted" | "declined" | null;
    decidedAt: string | null;
    available: boolean;
  };
  guide: GuideItem[] | null;
}

interface ConsentUrlResponse {
  consentUrl: string;
  expiresAt: string;
  scopes: WriteScope[];
  grantedBeyondScope: string[];
}

// ── Credential ────────────────────────────────────────────────────────────────
// Identical resolution to FreeScanReview.tsx — deliberately the same order and
// the same storage keys, so a Prospect landing here straight off the Review page
// is the same Prospect by the same evidence.

type Credential = FreeScanCredential;

const RETURN_TOKEN_STORAGE_KEY = "freeScanReturnToken";

function readCredential(): Credential | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get("sessionId");
  if (fromQuery) return { sessionId: fromQuery };
  try {
    const stored = sessionStorage.getItem(FREE_SCAN_SESSION_STORAGE_KEY);
    if (stored) return { sessionId: stored };
    const token = sessionStorage.getItem(RETURN_TOKEN_STORAGE_KEY);
    if (token) return { returnToken: token };
  } catch {
    // Storage blocked — fall through to the account session.
  }
  // #4329 — no flow credential in this tab: a signed-in engagement account's
  // httpOnly cookie is the remaining door. The server answers
  // `account_signin_required` when there is none.
  return { accountSession: true };
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// ── Icons, matching FreeScanReview.tsx's own set ──────────────────────────────

const icon = (children: React.ReactNode, size: number, stroke = "currentColor") => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const iconTick = (size: number) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4L19 7" />
  </svg>
);
const iconArrow = icon(
  <>
    <line x1={4} y1={12} x2={20} y2={12} />
    <polyline points="14 6 20 12 14 18" />
  </>,
  15,
);
const iconShield = (size: number) =>
  icon(<path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6z" />, size);

// ── Design style fragments (the `{{ writeStage }}` block, verbatim) ───────────

const PAGE: React.CSSProperties = {
  background: "#020617",
  color: "#f8fafc",
  fontFamily: "Inter, system-ui, sans-serif",
  minHeight: "100vh",
};
const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#fbbf24",
};
const CARD_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};
const CARD: React.CSSProperties = {
  border: "1px solid rgba(30,41,59,.95)",
  borderRadius: 16,
  background: "#0b1524",
  padding: "20px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 13,
};
const PRIMARY_BTN: React.CSSProperties = {
  padding: "12px 24px",
  border: 0,
  borderRadius: 11,
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  color: "#fff",
  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
  cursor: "pointer",
};
const SECONDARY_BTN: React.CSSProperties = {
  padding: "12px 22px",
  borderRadius: 11,
  fontFamily: "inherit",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#cbd5e1",
  background: "transparent",
  border: "1px solid rgba(148,163,184,.25)",
  cursor: "pointer",
};

/** The design's `{{ processing }}` overlay, with its own real label. */
function ProcessingOverlay({ label }: { label: string }) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(2,6,23,.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      data-testid="freescan-remediate-processing"
    >
      <style>{`@keyframes fsrSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            border: "2px solid rgba(51,65,85,.9)",
            borderTopColor: "#3b82f6",
            animation: reduced ? "none" : "fsrSpin 900ms linear infinite",
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>{label}</span>
      </div>
    </div>
  );
}

// ── The findings-driven guide ─────────────────────────────────────────────────

/**
 * #1539's three fix-route shapes, stated in the customer's terms. The vocabulary
 * is the server's (`fixRoute`); the sentence is what it means for the reader.
 */
const FIX_ROUTE_LABEL: Record<GuideItem["fixRoute"], string> = {
  we_can_run: "We can apply this for you",
  you_must_run: "Your team runs this",
  admin_center_only: "Admin centre only",
};

/**
 * The status vocabulary `remediation_tracker_steps` actually stores, with the
 * same labels the Remediation Tracker already uses for them
 * (`REMEDIATION_TRACKER_STATUS_LABELS`). `accepted_risk` is deliberately absent:
 * it requires a signed risk decision, which needs a Portal identity this
 * Prospect does not have, and the server rejects it from this door.
 */
const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "completed", label: "Completed" },
  { value: "already_handled", label: "Already handled another way" },
  { value: "not_applicable", label: "Not applicable to this tenant" },
  { value: "deferred", label: "Deferring to a later phase" },
  { value: "shane_handles", label: "Have Shane do this one" },
];

function GuideCard({
  item,
  saving,
  onStatus,
}: {
  item: GuideItem;
  saving: boolean;
  onStatus: (checkKey: string, status: string) => void;
}) {
  const critical = item.severity === "critical";
  return (
    <div
      style={{
        border: "1px solid rgba(30,41,59,.95)",
        borderRadius: 14,
        background: "rgba(15,23,42,.45)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      data-testid="freescan-remediate-guide-item"
      data-check-key={item.checkKey}
      data-fix-route={item.fixRoute}
      data-status={item.status}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 999,
            color: critical ? "#f87171" : "#fbbf24",
            border: `1px solid ${critical ? "rgba(248,113,113,.35)" : "rgba(251,191,36,.35)"}`,
            background: critical ? "rgba(248,113,113,.08)" : "rgba(251,191,36,.08)",
          }}
        >
          {critical ? "Critical" : "Warning"}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#22d3ee" }}>{FIX_ROUTE_LABEL[item.fixRoute]}</span>
        {item.phaseName ? (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#64748b" }}>{item.phaseName}</span>
        ) : null}
      </div>

      <span style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.4, color: "#f8fafc" }}>{item.title}</span>

      {item.description ? (
        <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#94a3b8" }}>{item.description}</span>
      ) : null}

      {item.hasVerifiedContent ? (
        <>
          {item.summary ? (
            <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#cbd5e1" }}>{item.summary}</span>
          ) : null}
          {item.remediationSteps.length > 0 ? (
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {item.remediationSteps.map((step, i) => (
                <li key={i} style={{ fontSize: 12, lineHeight: 1.55, color: "#94a3b8" }}>
                  {typeof step.title === "string" ? <strong style={{ color: "#e2e8f0", fontWeight: 600 }}>{step.title}</strong> : null}
                  {typeof step.title === "string" && typeof step.detail === "string" ? " — " : null}
                  {typeof step.detail === "string" ? step.detail : null}
                  {typeof step.command === "string" ? (
                    <code
                      style={{
                        display: "block",
                        marginTop: 5,
                        padding: "7px 9px",
                        borderRadius: 7,
                        background: "rgba(2,6,23,.7)",
                        border: "1px solid rgba(51,65,85,.9)",
                        fontFamily: "Menlo, Consolas, monospace",
                        fontSize: 11,
                        color: "#e2e8f0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {step.command}
                    </code>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {item.adminCenterUrl ? (
            <a
              href={item.adminCenterUrl}
              target="_blank"
              rel="noreferrer noopener"
              style={{ fontSize: 12, fontWeight: 600, color: "#60a5fa" }}
            >
              {item.adminCenterPath ?? "Open the admin centre"}
            </a>
          ) : null}
        </>
      ) : (
        // No published knowledge-base row for this check. Say so rather than
        // printing generic filler under a real finding.
        <span style={{ fontSize: 12, lineHeight: 1.55, color: "#64748b" }}>
          Step-by-step guidance for this finding is not published yet. Shane covers it directly in the phase that
          clears it.
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }} htmlFor={`status-${item.checkKey}`}>
          Your progress
        </label>
        <select
          id={`status-${item.checkKey}`}
          value={item.status}
          disabled={saving}
          onChange={(e) => onStatus(item.checkKey, e.target.value)}
          data-testid="freescan-remediate-guide-status"
          style={{
            background: "rgba(2,6,23,.7)",
            border: "1px solid rgba(51,65,85,.9)",
            borderRadius: 8,
            padding: "7px 9px",
            fontFamily: "inherit",
            fontSize: 12,
            color: "#f1f5f9",
            outline: "none",
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {item.verificationState === "verified" ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#34d399" }}>Verified by a rescan</span>
        ) : item.verificationState === "drift" ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#f87171" }}>A rescan still sees this</span>
        ) : (
          <span style={{ fontSize: 11, color: "#475569" }}>Not yet checked by a rescan</span>
        )}
      </div>
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────

export default function FreeScanRemediate() {
  const credential = useMemo(readCredential, []);
  const [state, setState] = useState<RemediateState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const post = useCallback(
    async <T,>(path: string, body: Record<string, unknown> = {}, method: "POST" | "PUT" = "POST"): Promise<T> => {
      if (!credential) throw new Error("no_credential");
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credential, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `request_failed_${res.status}`);
      return data;
    },
    [credential],
  );

  const read = useCallback(async (): Promise<RemediateState> => {
    const data = await post<RemediateState>("/api/public/free-scan/remediate/read");
    setState(data);
    setPhase("ready");
    return data;
  }, [post]);

  // Initial read.
  useEffect(() => {
    if (!credential) {
      setPhase("error");
      setErrorMessage(
        "We lost track of your scan. Open the results link we emailed you, or run a new free scan to pick this back up.",
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await post<RemediateState>("/api/public/free-scan/remediate/read");
        if (cancelled) return;
        setState(data);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        log.error({ err }, "free-scan remediate: read failed");
        setPhase("error");
        setErrorMessage(
          // #4329 — no flow credential in this tab and no signed-in engagement
          // account: the same "lost track" state such a visitor always got.
          err instanceof Error && err.message === "account_signin_required"
            ? "We lost track of your scan. Open the results link we emailed you, or run a new free scan to pick this back up."
            : "We couldn't open your remediation step. Open the results link we emailed you, or run a new free scan.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credential, post]);

  // ── Grant ───────────────────────────────────────────────────────────────────
  // The grant happens on Microsoft's own domain in a popup; this page stays put
  // and polls the server until the REAL `writeBack` grant lands. It is never
  // inferred from the popup closing — a closed popup proves nothing.
  const grantWrite = async () => {
    if (busyLabel) return;
    setActionError(null);
    setBusyLabel("Registering write access");
    try {
      const data = await post<ConsentUrlResponse>("/api/public/free-scan/remediate/write-consent-url");
      popupRef.current = window.open(data.consentUrl, "smc-write-consent", "width=620,height=760");
      if (!popupRef.current) {
        setBusyLabel(null);
        setActionError(
          "Your browser blocked the Microsoft consent window. Allow pop-ups for this site and try again.",
        );
        return;
      }

      // Poll for the real grant. Bounded: a consent that never completes leaves
      // the page on the consent screen with an honest message rather than
      // spinning indefinitely.
      const deadline = Date.now() + 5 * 60 * 1000;
      const tick = async (): Promise<void> => {
        if (Date.now() > deadline) {
          setBusyLabel(null);
          setActionError(
            "We didn't see the grant come back from Microsoft. If you approved it, refresh this page; if not, you can still carry on read-only.",
          );
          return;
        }
        try {
          const latest = await read();
          if (latest.writeConsent.status === "granted") {
            setBusyLabel(null);
            try {
              popupRef.current?.close();
            } catch {
              // Cross-origin popup that navigated away — nothing to close from here.
            }
            return;
          }
        } catch (err) {
          log.error({ err }, "free-scan remediate: consent poll failed");
        }
        window.setTimeout(() => void tick(), 2500);
      };
      window.setTimeout(() => void tick(), 2500);
    } catch (err) {
      setBusyLabel(null);
      const code = err instanceof Error ? err.message : "";
      log.error({ err }, "free-scan remediate: write-consent URL failed");
      setActionError(
        code === "write_app_not_configured"
          ? "Write access isn't available to grant right now. Shane will arrange it with you directly."
          : code === "read_consent_required"
          ? "We need the read-only connection in place first. Open your scan results and reconnect, then come back."
          : code === "no_write_scope_required"
          ? "Nothing in the scope you bought needs write access, so there is nothing to grant."
          : code === "payment_required"
          ? "This step opens once your statement of work is signed and paid."
          : "We couldn't open the Microsoft consent window. Please try again.",
      );
    }
  };

  const declineWrite = async () => {
    if (busyLabel) return;
    setActionError(null);
    setBusyLabel("Saving your choice");
    try {
      await post("/api/public/free-scan/remediate/decline-write");
      await read();
    } catch (err) {
      log.error({ err }, "free-scan remediate: decline failed");
      setActionError("We couldn't save that. Please try again.");
    } finally {
      setBusyLabel(null);
    }
  };

  const setItemStatus = async (checkKey: string, status: string) => {
    setSavingKey(checkKey);
    setActionError(null);
    // Optimistic, with a real rollback: the list repaints immediately and the
    // server's own read replaces it. A failed write restores the previous value
    // rather than leaving a status showing that was never stored.
    const previous = state;
    setState((s) =>
      s && s.guide ? { ...s, guide: s.guide.map((i) => (i.checkKey === checkKey ? { ...i, status } : i)) } : s,
    );
    try {
      await post(`/api/public/free-scan/remediate/checklist/${encodeURIComponent(checkKey)}`, { status }, "PUT");
    } catch (err) {
      log.error({ err, checkKey }, "free-scan remediate: checklist write failed");
      setState(previous);
      setActionError("That didn't save. Please try again.");
    } finally {
      setSavingKey(null);
    }
  };

  // ── Non-page states ─────────────────────────────────────────────────────────

  if (phase !== "ready" || !state) {
    return (
      <div style={PAGE}>
        <FreeScanFlowStrip at={4} />
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "#f8fafc" }}>
            {phase === "error" ? "We couldn't open your remediation step" : "Opening your remediation step"}
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "#94a3b8" }}>{errorMessage ?? "One moment."}</p>
          <span style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {phase === "error" ? (
              <a href="/scan/account" style={{ fontSize: 13.5, fontWeight: 600, color: "#60a5fa" }} data-testid="freescan-remediate-signin">
                Sign in to your engagement
              </a>
            ) : null}
            <a href="/scan" style={{ fontSize: 13.5, fontWeight: 600, color: "#60a5fa" }}>
              Back to your scan
            </a>
          </span>
        </div>
      </div>
    );
  }

  if (state.stage === "not_paid") {
    return (
      <div style={PAGE}>
        <FreeScanFlowStrip at={3} />
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "#f8fafc" }}>
            Your statement of work isn't signed and paid yet
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "#94a3b8" }}>
            This step opens once the scope is signed and payment has cleared. Everything you set on the review page is
            saved.
          </p>
          <a href="/scan/review" style={{ fontSize: 13.5, fontWeight: 600, color: "#60a5fa" }} data-testid="freescan-remediate-back-to-review">
            Back to your statement of work
          </a>
        </div>
      </div>
    );
  }

  // ── 0. The account step (the design's `{{ acctScreen }}`, #4329) ───────────

  if (state.stage === "account" && credential) {
    return (
      <div style={PAGE} data-testid="freescan-remediate-account">
        {/* The design keeps Review current until the account exists. */}
        <FreeScanFlowStrip at={3} />
        {busyLabel ? <ProcessingOverlay label={busyLabel} /> : null}
        <FreeScanAccountSetup credential={credential} onBusy={setBusyLabel} onComplete={() => void read()} />
      </div>
    );
  }

  // ── 1. The write-consent gate (the design's `{{ writeStage }}`) ─────────────

  if (state.stage === "write_consent") {
    const nothingToGrant = state.scopes.length === 0;
    return (
      <div style={PAGE} data-testid="freescan-remediate-write-consent">
        <FreeScanFlowStrip at={4} />
        {busyLabel ? <ProcessingOverlay label={busyLabel} /> : null}
        <div
          style={{
            maxWidth: 560,
            margin: "0 auto",
            padding: "64px 32px 96px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={EYEBROW}>Signed and paid · optional, and you can do it later</span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(22px,2.7vw,29px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.18,
                color: "#f8fafc",
                textWrap: "pretty" as React.CSSProperties["textWrap"],
              }}
            >
              Want the remediation applied for you, not just scoped?
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.65,
                color: "#94a3b8",
                textWrap: "pretty" as React.CSSProperties["textWrap"],
              }}
            >
              Your scan ran on the read-only app registration and it stays that way unless you say otherwise. Write
              access is what lets a phase close a finding directly instead of handing your team a checklist. Every
              change still needs your approval first.
            </p>
          </div>

          {nothingToGrant ? (
            // A real state, not an empty one: the scope they bought has nothing
            // this platform can execute, so there is no grant worth asking for.
            <div style={CARD} data-testid="freescan-remediate-no-scopes">
              <span style={CARD_LABEL}>Scopes requested</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#94a3b8" }}>
                Nothing in the scope you bought can be applied for you automatically, so there is no write access to
                ask for. Shane delivers these phases directly with you instead.
              </span>
              {state.phasesWithoutWrite.map((p) => (
                <span key={p.slug} style={{ fontSize: 11.5, lineHeight: 1.5, color: "#64748b" }}>
                  <strong style={{ color: "#cbd5e1", fontWeight: 600 }}>{p.name}</strong> —{" "}
                  {p.reason === "no_open_findings"
                    ? "your scan found nothing open on this pillar."
                    : "no runnable write pack covers the findings this phase clears."}
                </span>
              ))}
            </div>
          ) : (
            <div style={CARD} data-testid="freescan-remediate-scopes">
              <span style={CARD_LABEL}>Scopes requested</span>
              {state.scopes.map((s) => (
                <span key={s.permission} style={{ display: "flex", flexDirection: "column", gap: 3 }} data-testid="freescan-remediate-scope">
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#e2e8f0",
                      fontFamily: "Menlo, Consolas, monospace",
                    }}
                  >
                    {s.permission}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>{s.why}</span>
                </span>
              ))}
            </div>
          )}

          {state.grantedBeyondScope.length > 0 && !nothingToGrant ? (
            // Microsoft's admin-consent screen grants whatever the registration
            // declares — it takes no scope parameter. Saying so here is the
            // difference between a scoped list and a misleading one.
            <details
              style={{
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: 14,
                background: "rgba(11,21,36,.6)",
                padding: "13px 15px",
              }}
              data-testid="freescan-remediate-beyond-scope"
            >
              <summary style={{ fontSize: 11.5, color: "#94a3b8", cursor: "pointer", lineHeight: 1.55 }}>
                Microsoft grants the whole app registration in one click — {state.grantedBeyondScope.length} further
                permissions come with it
              </summary>
              <p style={{ margin: "9px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "#64748b" }}>
                The list above is what the phases you bought will actually use. Microsoft's consent screen has no way
                to approve part of an application, so these come with it and simply go unused until a phase needs
                them. You can withdraw the whole grant at any time.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 9 }}>
                {state.grantedBeyondScope.map((p) => (
                  <span key={p} style={{ fontSize: 11, fontFamily: "Menlo, Consolas, monospace", color: "#64748b" }}>
                    {p}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          {actionError ? (
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "#f87171" }} data-testid="freescan-remediate-error">
              {actionError}
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {!nothingToGrant && state.writeConsent.available ? (
              <button type="button" onClick={() => void grantWrite()} style={PRIMARY_BTN} data-testid="freescan-remediate-grant">
                Grant write access
              </button>
            ) : null}
            <button type="button" onClick={() => void declineWrite()} style={SECONDARY_BTN} data-testid="freescan-remediate-decline">
              Not now — stay read-only
            </button>
          </div>

          <span style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.55 }}>
            Decline and nothing is lost — you can grant it from your engagement page whenever you want.
          </span>
        </div>
      </div>
    );
  }

  // ── 2. The done screen + the real findings-driven guide ─────────────────────

  const granted = state.writeConsent.status === "granted";
  const savingCents = Math.max(0, state.agreedServicesCents - state.chargedCents);
  const doneLine =
    state.paymentPlan === "full"
      ? `${money(state.chargedCents)} is paid in full across ${state.phaseSlugs.length} ${
          state.phaseSlugs.length === 1 ? "phase" : "phases"
        }${savingCents > 0 ? `, with ${money(savingCents)} off for taking the full scope up front.` : "."}`
      : `Your ${money(state.chargedCents)} deposit is paid. The remaining ${money(
          savingCents,
        )} invoices only as you sign off each phase.`;
  const writeNote = granted
    ? "Write access is granted, so a phase can apply its fix directly — each change still needs your approval."
    : "Remediation stays read-only for now; you can grant write access from your engagement page whenever you want.";

  const guide = state.guide ?? [];
  const firstPhase = state.boughtPhases[0];
  const firstPhaseItems = firstPhase ? guide.filter((i) => i.phaseSlug === firstPhase.slug) : [];

  return (
    <div style={PAGE} data-testid="freescan-remediate-guide">
      <FreeScanFlowStrip at={4} />
      {busyLabel ? <ProcessingOverlay label={busyLabel} /> : null}
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "72px 32px 96px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "rgba(52,211,153,.12)",
              border: "1px solid rgba(52,211,153,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#34d399",
            }}
          >
            {iconTick(20)}
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(26px,3.2vw,36px)",
              fontWeight: 800,
              letterSpacing: "-.03em",
              lineHeight: 1.15,
              color: "#f8fafc",
              textWrap: "pretty" as React.CSSProperties["textWrap"],
            }}
          >
            Your engagement is open.
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: "58ch",
              fontSize: 15,
              lineHeight: 1.65,
              color: "#94a3b8",
              textWrap: "pretty" as React.CSSProperties["textWrap"],
            }}
            data-testid="freescan-remediate-write-note"
          >
            {doneLine} Your signed scope is filed with the scan findings that generated it. {writeNote}
          </p>
        </div>

        <div
          style={{
            border: "1px solid rgba(30,41,59,.95)",
            borderRadius: 14,
            background: "#0b1524",
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 15,
          }}
        >
          <span style={CARD_LABEL}>What happens next</span>
          <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#22d3ee", flex: "none", width: 74 }}>
              TODAY
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "#94a3b8" }}>
              Shane reviews the signed scope and confirms the Phase 1 window directly — an email within one business
              day, not a queue ticket.
            </span>
          </span>
          {firstPhase ? (
            <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#22d3ee", flex: "none", width: 74 }}>
                WEEK 1
              </span>
              {/* The phase name is the real catalog row and the items named are
                  this tenant's real open findings — never a worked example. */}
              <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "#94a3b8" }}>
                {firstPhase.name} starts
                {firstPhaseItems.length > 0
                  ? `: ${firstPhaseItems.slice(0, 3).map((i) => i.title).join(", ")}${
                      firstPhaseItems.length > 3 ? `, and ${firstPhaseItems.length - 3} more` : ""
                    }.`
                  : "."}
              </span>
            </span>
          ) : null}
          <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#22d3ee", flex: "none", width: 74 }}>
              ONGOING
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "#94a3b8" }}>
              Every phase is tracked in your Portal against the scan finding that generated it, with the score change
              recorded as it closes.
            </span>
          </span>
        </div>

        {/* The decline path's promise, made real: the same grant is still one
            click away, from here as well as from the engagement page (#4329). */}
        {!granted && state.writeConsent.available ? (
          <div
            style={{
              border: "1px solid rgba(59,130,246,.28)",
              borderRadius: 14,
              background: "rgba(59,130,246,.06)",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 11,
            }}
            data-testid="freescan-remediate-grant-later"
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#93c5fd" }}>
              {iconShield(15)} Still read-only
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#94a3b8" }}>
              Every item below shows what your team runs. Grant write access and the ones we can apply for you switch
              over — from here, or from your engagement page later.
            </span>
            {actionError ? <span style={{ fontSize: 12, color: "#f87171", lineHeight: 1.55 }}>{actionError}</span> : null}
            <span>
              <button type="button" onClick={() => void grantWrite()} style={PRIMARY_BTN} data-testid="freescan-remediate-grant-from-guide">
                Grant write access
              </button>
            </span>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={CARD_LABEL}>Your remediation guide</span>
            <span style={{ fontSize: 11.5, color: "#64748b" }} data-testid="freescan-remediate-guide-count">
              {guide.length} open {guide.length === 1 ? "finding" : "findings"} from your scan
            </span>
          </div>
          {guide.length === 0 ? (
            // A clean scan is a real answer, not a missing one.
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "#94a3b8" }} data-testid="freescan-remediate-guide-empty">
              Your latest scan raised nothing critical or warning-level. There is nothing to work through here — the
              next scan will add items if anything drifts.
            </p>
          ) : (
            guide.map((item) => (
              <GuideCard key={item.checkKey} item={item} saving={savingKey === item.checkKey} onStatus={(k, s) => void setItemStatus(k, s)} />
            ))
          )}
        </div>

        {actionError && guide.length > 0 ? (
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "#f87171" }}>{actionError}</p>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* #4329 — the Prospect's scoped engagement page, which their account opens.
              Not /portal/login: a paid Free Scan Prospect holds no Portal login. */}
          <a
            href="/scan/account"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "13px 24px",
              borderRadius: 11,
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              textDecoration: "none",
            }}
            data-testid="freescan-remediate-open-portal"
          >
            Open your engagement {iconArrow}
          </a>
          <a href="/" style={{ fontSize: 13, fontWeight: 600, color: "#60a5fa" }}>
            Back to the site
          </a>
        </div>
      </div>
    </div>
  );
}
