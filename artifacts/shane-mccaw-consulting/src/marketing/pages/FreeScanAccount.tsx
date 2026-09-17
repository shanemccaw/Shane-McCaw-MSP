import { useCallback, useEffect, useState } from "react";
import { FreeScanFlowStrip } from "../components/FreeScanFlowStrip";
import { logger } from "../../lib/logger";

/**
 * /scan/account — a paid Free Scan Prospect's engagement page (Git #4329,
 * Feature #1352).
 *
 * This is the destination the Remediate step's promises point at ("Open your
 * engagement", and "you can grant it from your engagement page whenever you
 * want"), and the SCOPED login the design's `acctScreen` block creates. Per
 * Shane's correction on #4329 it opens one engagement — that Prospect's own scan
 * results and the SOW they signed, plus the Remediate step behind it — and is
 * not the customer Portal: the account never holds a Portal password or a
 * `client_services` entitlement (#656 stays closed).
 *
 * Two states, chosen by the server:
 *   • signed out — email + password, then the second factor enrolled at setup
 *     (authenticator code, or a code texted to the enrolled number);
 *   • signed in  — the engagement read from `GET /api/public/free-scan/account/me`,
 *     with links into the three existing free-scan pages, each of which accepts
 *     this account's session as its identity when the tab holds nothing else.
 *
 * No design export exists for this page. It is built in the Remediate step's own
 * visual language (the acctScreen card for sign-in, the done screen's cards for
 * the engagement) rather than inventing a third look. Every figure on it is the
 * engagement row's own captured value.
 */

const log = logger.child({ channel: "auth" });

interface Me {
  email: string;
  mfaMethod: "totp" | "sms" | null;
  tenant: { name: string | null; domain: string | null };
  engagement: {
    sowReference: string;
    status: string;
    paymentPlan: "full" | "phased";
    phaseCount: number;
    signerName: string | null;
    signedAt: string | null;
    paidAt: string | null;
    chargedCents: number;
    agreedServicesCents: number;
    agreedRecurringMonthlyCents: number;
  };
  writeConsent: { status: string | null; decision: "requested" | "granted" | "declined" | null };
}

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
  color: "#34d399",
};
const H1: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(22px,2.7vw,29px)",
  fontWeight: 800,
  letterSpacing: "-.03em",
  lineHeight: 1.18,
  color: "#f8fafc",
};
const BODY: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.65, color: "#94a3b8" };
const CARD: React.CSSProperties = {
  border: "1px solid rgba(30,41,59,.95)",
  borderRadius: 16,
  background: "#0b1524",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const INPUT: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: 10,
  padding: "11px 13px",
  fontFamily: "inherit",
  fontSize: 13.5,
  color: "#f1f5f9",
  outline: "none",
};
const btn = (ready: boolean): React.CSSProperties => ({
  width: "100%",
  padding: 12,
  border: 0,
  borderRadius: 10,
  fontFamily: "inherit",
  fontSize: 13.5,
  fontWeight: 700,
  color: "#fff",
  cursor: ready ? "pointer" : "not-allowed",
  background: ready ? "linear-gradient(90deg,#3b82f6,#8b5cf6)" : "rgba(71,85,105,.4)",
});

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const longDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid_credentials: "That email and password don't match an engagement account.",
  account_locked: "Too many attempts. Wait fifteen minutes and try again.",
  code_invalid: "That code doesn't match. Try again.",
  code_expired: "That code has expired. Start again to get a new one.",
  too_many_attempts: "Too many tries on that code. Start again to get a new one.",
  challenge_invalid: "Your sign-in timed out. Start again.",
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `request_failed_${res.status}`);
  return data;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<{ token: string; method: "totp" | "sms" | null; phoneLast4: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => {
    const key = err instanceof Error ? err.message : "";
    log.error({ err, key }, "free-scan account: sign-in failed");
    setError(SIGN_IN_ERRORS[key] ?? "We couldn't sign you in just now. Please try again.");
    if (key === "challenge_invalid" || key === "code_expired" || key === "too_many_attempts") {
      setChallenge(null);
      setCode("");
    }
  };

  const credentialsReady = /\S+@\S+/.test(email) && password.length > 0 && !busy;
  const codeReady = code.length === 6 && !busy;

  const submitPassword = async () => {
    if (!credentialsReady) return;
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ challenge: string; method: "totp" | "sms" | null; phoneLast4: string | null }>(
        "/api/public/free-scan/account/login",
        { email, password },
      );
      setPassword("");
      setChallenge({ token: data.challenge, method: data.method, phoneLast4: data.phoneLast4 });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!challenge || !codeReady) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/public/free-scan/account/login/verify", { challenge: challenge.token, code });
      onSignedIn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "64px 32px 96px", display: "flex", flexDirection: "column", gap: 20 }} data-testid="freescan-account-signin">
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={EYEBROW}>Your engagement</span>
        <h1 style={H1}>{challenge ? "Enter your second factor" : "Sign in to your engagement"}</h1>
        <p style={BODY}>
          {challenge
            ? challenge.method === "sms"
              ? `We texted a code to the number ending ${challenge.phoneLast4 ?? ""}.`
              : "Enter the six-digit code your authenticator app shows."
            : "Your scan results and signed statement of work. Use the email and password you set after paying."}
        </p>
      </div>
      <form
        style={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          void (challenge ? submitCode() : submitPassword());
        }}
      >
        {challenge ? (
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="Six-digit code"
            autoFocus
            data-testid="freescan-account-signin-code"
            style={{ ...INPUT, padding: 14, fontSize: 26, fontWeight: 700, letterSpacing: ".42em", textAlign: "center", fontFamily: "Menlo,Consolas,monospace" }}
          />
        ) : (
          <>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="username" style={INPUT} data-testid="freescan-account-signin-email" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" style={INPUT} data-testid="freescan-account-signin-password" />
          </>
        )}
        <button type="submit" disabled={challenge ? !codeReady : !credentialsReady} style={btn(challenge ? codeReady : credentialsReady)} data-testid="freescan-account-signin-submit">
          {challenge ? "Sign in" : "Continue"}
        </button>
        {error ? (
          <span style={{ fontSize: 12, lineHeight: 1.55, color: "#f87171", textAlign: "center" }} data-testid="freescan-account-signin-error">
            {error}
          </span>
        ) : null}
        {challenge ? (
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
            style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, color: "#60a5fa", cursor: "pointer" }}
          >
            Start again
          </button>
        ) : (
          <span style={{ fontSize: 11, color: "#475569", lineHeight: 1.5, textAlign: "center" }}>
            Not set up yet? The account is created on the remediation step, right after your statement of work is paid.
          </span>
        )}
      </form>
    </div>
  );
}

function LinkCard({ href, title, desc, testId }: { href: string; title: string; desc: string; testId: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      style={{
        border: "1px solid rgba(30,41,59,.95)",
        borderRadius: 14,
        background: "rgba(15,23,42,.45)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: 14.5, fontWeight: 700, color: "#f8fafc" }}>{title}</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#94a3b8" }}>{desc}</span>
    </a>
  );
}

function Engagement({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const e = me.engagement;
  const granted = me.writeConsent.status === "granted";

  const signOut = async () => {
    setSigningOut(true);
    try {
      await postJson("/api/public/free-scan/account/logout", {});
    } catch (err) {
      log.error({ err }, "free-scan account: sign-out failed");
    } finally {
      setSigningOut(false);
      onSignedOut();
    }
  };

  const paidLine =
    e.paymentPlan === "full"
      ? `${money(e.chargedCents)} paid in full across ${e.phaseCount} ${e.phaseCount === 1 ? "phase" : "phases"}.`
      : `${money(e.chargedCents)} deposit paid. The remaining ${money(Math.max(0, e.agreedServicesCents - e.chargedCents))} invoices as you sign off each phase.`;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "72px 32px 96px", display: "flex", flexDirection: "column", gap: 24 }} data-testid="freescan-account-engagement">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={EYEBROW} data-testid="freescan-account-sow-reference">
          Your engagement · {e.sowReference}
        </span>
        <h1 style={{ ...H1, fontSize: "clamp(26px,3.2vw,36px)" }}>{me.tenant.name ?? me.tenant.domain ?? "Your tenant"}</h1>
        <p style={{ ...BODY, fontSize: 15, maxWidth: "58ch" }}>
          {e.signerName && e.signedAt ? `Signed by ${e.signerName} on ${longDate(e.signedAt)}. ` : ""}
          {paidLine}
          {e.agreedRecurringMonthlyCents > 0 ? ` ${money(e.agreedRecurringMonthlyCents)} a month recurring from kickoff.` : ""}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <LinkCard href="/scan/results" title="Scan results" desc={`Your free scan${me.tenant.domain ? ` of ${me.tenant.domain}` : ""}, pillar by pillar.`} testId="freescan-account-link-results" />
        <LinkCard href="/scan/review" title="Statement of work" desc="The scope you signed, with the figures you agreed to." testId="freescan-account-link-sow" />
        <LinkCard
          href="/scan/remediate"
          title="Remediation guide"
          desc={granted ? "Your open findings. Write access is granted, so the ones we can apply for you are marked." : "Your open findings, worked through read-only."}
          testId="freescan-account-link-remediate"
        />
      </div>

      {!granted ? (
        <div
          style={{ border: "1px solid rgba(59,130,246,.28)", borderRadius: 14, background: "rgba(59,130,246,.06)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}
          data-testid="freescan-account-grant"
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#93c5fd" }}>Still read-only</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#94a3b8" }}>
            Grant write access whenever you want, and a phase can apply its fix directly — each change still needs your approval.
          </span>
          <span>
            <a
              href="/scan/remediate"
              style={{ display: "inline-flex", padding: "12px 24px", borderRadius: 11, fontSize: 14, fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", textDecoration: "none" }}
            >
              Grant write access
            </a>
          </span>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#64748b" }}>
        <span>Signed in as {me.email}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          data-testid="freescan-account-signout"
          style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: "#60a5fa", cursor: "pointer" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function FreeScanAccount() {
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<"loading" | "signed_out" | "signed_in" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/public/free-scan/account/me", { credentials: "same-origin" });
      if (res.status === 401) {
        setMe(null);
        setPhase("signed_out");
        return;
      }
      if (!res.ok) throw new Error(`account_read_${res.status}`);
      setMe((await res.json()) as Me);
      setPhase("signed_in");
    } catch (err) {
      log.error({ err }, "free-scan account: engagement read failed");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A signed-in engagement page is private; never let it be indexed.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  return (
    <div style={PAGE}>
      <FreeScanFlowStrip at={4} />
      {phase === "signed_out" ? <SignIn onSignedIn={() => void load()} /> : null}
      {phase === "signed_in" && me ? <Engagement me={me} onSignedOut={() => void load()} /> : null}
      {phase === "loading" || phase === "error" ? (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "#f8fafc" }}>
            {phase === "error" ? "We couldn't open your engagement" : "Opening your engagement"}
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "#94a3b8" }}>
            {phase === "error" ? "Please try again in a moment." : "One moment."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
