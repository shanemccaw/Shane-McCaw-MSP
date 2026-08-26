import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  HelpCircle,
  KeyRound,
  Smartphone,
  Lock,
  Mail,
  User,
  ChevronDown,
  Bot,
  X,
} from "lucide-react";

// Sign-in Help page (/login/help) — Git #1349.
// Faithful recreation of Design/access-pages-export/Customer Portal Sign-in Help.dc.html.
// Copy is final (do not reword). The 5-item FAQ + the two static cards are pure
// client-side content — no backend. Only ShaneBot's "Raise the ticket" hits a
// real endpoint (POST /api/portal/sign-in-help/ticket), which creates a real
// Zoho Desk ticket and returns a real reference. The "signed in but portal is
// empty" state is deliberately NOT offered here — a scan gate holds the portal
// closed until the first scan completes, so that state doesn't exist.

interface FaqItem {
  key: string;
  Icon: typeof KeyRound;
  color: string;
  title: string;
  hint: string;
  body: string;
  steps: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    key: "password",
    Icon: KeyRound,
    color: "#a78bfa",
    title: "My password is not being accepted",
    hint: "Or you have never set one",
    body: "Portal passwords are separate from your Microsoft 365 password. Changing one does not change the other.",
    steps: [
      "Check for a trailing space if you pasted it from a password manager.",
      "If your account was created for you, the invite email held a one-time password that expires after 7 days.",
      "Use the reset button below. The code lands in your inbox within a minute.",
    ],
    ctaLabel: "Reset my password",
    ctaHref: "/login",
  },
  {
    key: "mfa",
    Icon: Smartphone,
    color: "#60a5fa",
    title: "My MFA code is rejected, or I lost my authenticator",
    hint: "New phone, wiped app, wrong clock",
    body: "Codes are time-based, so a phone clock that has drifted more than 30 seconds will produce codes we reject.",
    steps: [
      "Set your phone clock to automatic and try the next code, not the one already on screen.",
      "A code only works once. If you retried a code you already submitted, wait for the next one.",
      "New phone with no authenticator: use one of the ten recovery codes issued when you enrolled.",
      "No recovery codes either? Email us and we will re-enrol you after identity checks.",
    ],
    ctaLabel: "Use a recovery code",
    ctaHref: "/login",
  },
  {
    key: "locked",
    Icon: Lock,
    color: "#fb7185",
    title: "I am locked out after too many attempts",
    hint: "Five failures locks the account",
    body: "The lock is automatic and lifts itself after 30 minutes. Nothing is deleted and no data is at risk.",
    steps: [
      "Wait 30 minutes, or reset your password now, which clears the lock immediately.",
      "If you did not make those attempts, tell us. Repeated failures against your account are worth a look.",
    ],
    ctaLabel: "Reset and clear the lock",
    ctaHref: "/login",
  },
  {
    key: "nocode",
    Icon: Mail,
    color: "#22d3ee",
    title: "The reset code never arrived",
    hint: "Check spam, then check the address",
    body: "Codes send from no-reply@shanemccaw.com and arrive within a minute. They expire after 15 minutes and work once.",
    steps: [
      "Search your mail for the sender rather than the subject line. Filters often bury it.",
      "The code only goes to the address on your portal account, which may not be the one you typed.",
      "Corporate mail filtering can hold it. Ask your IT team to allow no-reply@shanemccaw.com.",
    ],
    ctaLabel: "Send a new code",
    ctaHref: "/login",
  },
  {
    key: "nouser",
    Icon: User,
    color: "#fbbf24",
    title: "I do not know my username, or I have no account",
    hint: "It is your work email address",
    body: "Your username is the work email address your access was granted to. Accounts are created by whoever owns the engagement at your organisation.",
    steps: [
      "Try the address that receives your monthly tenant report.",
      "New starter? Your own portal admin can add you in Settings, People, in under a minute.",
      "No engagement with us yet? Start with a free diagnostic and an account comes with it.",
    ],
    ctaLabel: "Run a free diagnostic",
    ctaHref: "/scan",
    ctaExternal: true,
  },
];

// Matches the server-side catalog in routes/portal-sign-in-help.ts (keys +
// labels). Priority/note shown in the confirmation come from the API response,
// not from here — the client only sends the key.
const BOT_ISSUES: { key: string; label: string }[] = [
  { key: "mfa", label: "Lost my authenticator, no recovery codes" },
  { key: "locked", label: "Locked out and resetting did not clear it" },
  { key: "nocode", label: "Reset codes never arrive at all" },
  { key: "other", label: "Something else entirely" },
];

interface RaisedTicket {
  reference: string;
  priority: string;
  routingNote: string;
  email: string;
}

interface StatusResponse {
  status: "operational" | "degraded" | "outage";
}

function useServiceStatus(): StatusResponse["status"] | null {
  const [status, setStatus] = useState<StatusResponse["status"] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StatusResponse | null) => {
        if (!cancelled && data?.status) setStatus(data.status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

// ── ShaneBot chat message model ────────────────────────────────────────────────

interface BotLine {
  from: "bot" | "you";
  text: string;
}

function ShaneBot({ onClose }: { onClose: () => void }) {
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState<RaisedTicket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pickedLabel = BOT_ISSUES.find((q) => q.key === issueKey)?.label ?? null;

  const lines: BotLine[] = useMemo(() => {
    const out: BotLine[] = [
      {
        from: "bot",
        text: "Hello. I raise sign-in tickets so you do not have to write one. What is holding you up?",
      },
    ];
    if (pickedLabel) {
      out.push({ from: "you", text: pickedLabel });
      out.push({
        from: "bot",
        text: "Understood. What is the email address on your portal account? I will attach your last ten sign-in attempts to the ticket.",
      });
    }
    if (ticket) out.push({ from: "you", text: ticket.email });
    return out;
  }, [pickedLabel, ticket]);

  // CRITICAL (Git #1349): pin the scroll region to the bottom after every update
  // via el.scrollTop = el.scrollHeight — NOT scrollIntoView, which would push the
  // confirmation below the fold and defeat the whole flow.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, ticket, error, submitting]);

  async function submit() {
    if (!/.+@.+\..+/.test(email)) {
      setError("I need a valid email address to find your account.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/sign-in-help/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), issueKey }),
      });
      const json = (await res.json()) as (RaisedTicket & { error?: string }) | { error?: string };
      if (!res.ok || !("reference" in json)) {
        setError((json as { error?: string }).error ?? "Something went wrong. Please try again.");
        return;
      }
      setTicket(json as RaisedTicket);
    } catch {
      setError("A network error stopped me raising the ticket. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setTicket(null);
    setIssueKey(null);
    setEmail("");
    setError("");
  }

  const asksIssue = !issueKey;
  const asksEmail = !!issueKey && !ticket;

  return (
    <div
      style={{
        position: "fixed",
        right: 26,
        bottom: 26,
        zIndex: 60,
        width: 352,
        maxWidth: "calc(100vw - 40px)",
        borderRadius: 14,
        background: "#0b1524",
        border: "1px solid rgba(139,92,246,.3)",
        boxShadow: "0 26px 60px rgba(2,6,23,.7)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 15px",
          background: "linear-gradient(160deg,rgba(139,92,246,.16),rgba(11,21,36,.4))",
          borderBottom: "1px solid rgba(139,92,246,.22)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            flex: "0 0 28px",
            borderRadius: 8,
            background: "linear-gradient(135deg,#8b5cf6,#0078D4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10.5,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          SB
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#f8fafc" }}>ShaneBot</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#2dd4bf" }}>Online · raises tickets directly</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close ShaneBot"
          style={{
            flex: "0 0 26px",
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "1px solid rgba(148,163,184,.16)",
            background: "transparent",
            color: "#94a3b8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={scrollRef}
        data-testid="shanebot-scroll"
        style={{
          padding: "14px 15px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: "52vh",
          overflowY: "auto",
        }}
      >
        {lines.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.from === "bot" ? "flex-start" : "flex-end" }}>
            <span
              style={
                m.from === "bot"
                  ? {
                      maxWidth: "88%",
                      padding: "9px 12px",
                      borderRadius: "10px 10px 10px 3px",
                      background: "#071324",
                      border: "1px solid rgba(139,92,246,.22)",
                      fontSize: 12,
                      color: "#cbd5e1",
                      lineHeight: 1.6,
                    }
                  : {
                      maxWidth: "88%",
                      padding: "9px 12px",
                      borderRadius: "10px 10px 3px 10px",
                      background: "rgba(0,120,212,.16)",
                      border: "1px solid rgba(0,120,212,.4)",
                      fontSize: 12,
                      color: "#e2e8f0",
                      lineHeight: 1.6,
                      fontWeight: 600,
                    }
              }
            >
              {m.text}
            </span>
          </div>
        ))}

        {asksIssue && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
            {BOT_ISSUES.map((q) => (
              <button
                key={q.key}
                data-testid={`shanebot-issue-${q.key}`}
                onClick={() => {
                  setIssueKey(q.key);
                  setError("");
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,.18)",
                  background: "#071324",
                  color: "#cbd5e1",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {asksEmail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 2 }}>
            <input
              value={email}
              data-testid="shanebot-email"
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="you@company.com"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                background: "#071324",
                border: "1px solid rgba(148,163,184,.18)",
                color: "#f8fafc",
                fontFamily: "inherit",
                fontSize: 12.5,
                outline: "none",
              }}
            />
            {error && <span style={{ fontSize: 11, color: "#fb7185", fontWeight: 600 }}>{error}</span>}
            <button
              onClick={() => void submit()}
              disabled={submitting}
              data-testid="shanebot-raise"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 6,
                border: "none",
                background: "#0078D4",
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Raising…" : "Raise the ticket"}
            </button>
          </div>
        )}

        {ticket && (
          <>
            <div
              data-testid="shanebot-confirmation"
              style={{
                padding: "13px 15px",
                borderRadius: 10,
                background: "rgba(45,212,191,.07)",
                border: "1px solid rgba(45,212,191,.3)",
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#2dd4bf",
                }}
              >
                Ticket raised
              </span>
              <span
                data-testid="shanebot-reference"
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#f8fafc",
                  fontFamily: "Menlo,'SF Mono',Consolas,monospace",
                  letterSpacing: "-.01em",
                }}
              >
                {ticket.reference}
              </span>
              <span style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.55 }}>
                {ticket.priority} · {ticket.routingNote} Confirmation is on its way to {ticket.email}.
              </span>
            </div>
            <button
              onClick={reset}
              data-testid="shanebot-reset"
              style={{
                alignSelf: "flex-start",
                padding: "8px 13px",
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,.18)",
                background: "transparent",
                color: "#94a3b8",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Raise another
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── FAQ accordion row ──────────────────────────────────────────────────────────

function FaqRow({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  const { Icon } = item;
  return (
    <div
      style={{
        borderRadius: 12,
        background: "#0b1524",
        border: "1px solid rgba(30,41,59,.9)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        data-testid={`faq-toggle-${item.key}`}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "15px 17px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            flex: "0 0 30px",
            width: 30,
            height: 30,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${item.color}1A`,
            border: `1px solid ${item.color}33`,
          }}
        >
          <Icon size={16} color={item.color} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#f8fafc" }}>{item.title}</span>
          <span style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>{item.hint}</span>
        </span>
        <span
          style={{
            flex: "0 0 auto",
            display: "flex",
            color: "#475569",
            transition: "transform .18s",
            transform: `rotate(${open ? "180deg" : "0deg"})`,
          }}
        >
          <ChevronDown size={16} />
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 17px 16px 55px", display: "flex", flexDirection: "column", gap: 11 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "#cbd5e1", lineHeight: 1.7, maxWidth: "64ch" }}>{item.body}</p>
          {item.steps.map((st, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                style={{
                  flex: "0 0 auto",
                  marginTop: 5,
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#a78bfa",
                }}
              />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6 }}>{st}</span>
            </div>
          ))}
          {item.ctaExternal ? (
            <a
              href={item.ctaHref}
              style={{
                alignSelf: "flex-start",
                padding: "9px 15px",
                borderRadius: 6,
                background: "#0078D4",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {item.ctaLabel}
            </a>
          ) : (
            <Link
              href={item.ctaHref}
              style={{
                alignSelf: "flex-start",
                padding: "9px 15px",
                borderRadius: 6,
                background: "#0078D4",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {item.ctaLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PortalSignInHelpPage() {
  const [open, setOpen] = useState(0);
  const [botShown, setBotShown] = useState(false);
  const status = useServiceStatus();

  const operational = status === null || status === "operational";
  const statusText = operational
    ? "Portal and sign-in are operational. No known incidents."
    : status === "degraded"
      ? "Some services are degraded. We are on it."
      : "We are investigating an active incident.";
  const statusColor = operational ? "#2dd4bf" : status === "degraded" ? "#fbbf24" : "#fb7185";

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        overflow: "hidden",
        background: "#020617",
        color: "#f8fafc",
        fontFamily: "Inter,system-ui,-apple-system,sans-serif",
        padding: "40px 32px 56px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle 820px at 24% -8%, rgba(139,92,246,.15), rgba(2,6,23,0) 62%), radial-gradient(circle 640px at 88% 18%, rgba(0,120,212,.10), rgba(2,6,23,0) 60%)",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: 880,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "linear-gradient(135deg,#0078D4,#00B4D8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "-.02em",
              color: "#fff",
              flex: "0 0 32px",
            }}
          >
            SM
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>
              Shane McCaw
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#64748b",
                letterSpacing: ".08em",
                textTransform: "uppercase",
              }}
            >
              Tenant Monitoring
            </span>
          </div>
        </div>

        {/* Heading */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            href="/login"
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: "#64748b",
            }}
          >
            <ArrowLeft size={13} />
            Back to sign in
          </Link>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#a78bfa",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#a78bfa",
                boxShadow: "0 0 0 3px rgba(139,92,246,.18)",
              }}
            />{" "}
            Sign-in help
          </span>
          <h1
            style={{
              fontSize: 31,
              fontWeight: 800,
              letterSpacing: "-.03em",
              lineHeight: 1.12,
              color: "#f8fafc",
              margin: 0,
              maxWidth: "22ch",
            }}
          >
            Trouble signing in
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "#94a3b8",
              lineHeight: 1.65,
              maxWidth: "64ch",
            }}
          >
            Nine times in ten it is one of the five things below, and you can fix it yourself in under a minute. If it
            isn&#8217;t, the card at the bottom gets you a human.
          </p>
        </div>

        {/* Service status strip — reuses the existing /api/status check (Git #1350 owns the full status page). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 16px",
            borderRadius: 8,
            background: "rgba(45,212,191,.06)",
            border: "1px solid rgba(45,212,191,.26)",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              flex: "0 0 7px",
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 0 3px ${statusColor}29`,
            }}
          />
          <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#cbd5e1" }}>
            {statusText}
          </span>
          <a href="/status" style={{ flex: "0 0 auto", fontSize: 11.5, fontWeight: 700, color: "#5eead4", whiteSpace: "nowrap" }}>
            Service status &#8594;
          </a>
        </div>

        {/* FAQ accordion */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {FAQ_ITEMS.map((item, i) => (
            <FaqRow key={item.key} item={item} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>

        {/* Two static cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          <div
            style={{
              padding: "18px 20px",
              borderRadius: 12,
              background: "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.6))",
              border: "1px solid rgba(139,92,246,.24)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#a78bfa",
              }}
            >
              Still locked out
            </span>
            <p style={{ margin: 0, fontSize: 12.5, color: "#cbd5e1", lineHeight: 1.65 }}>
              Email us from the address on your account. Include your tenant domain and roughly when it stopped working
              &#8212; that is enough for us to find you in the logs.
            </p>
            <button
              onClick={() => setBotShown(true)}
              data-testid="open-shanebot"
              style={{
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 2,
                padding: "10px 15px",
                borderRadius: 6,
                border: "none",
                background: "#0078D4",
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Bot size={15} />
              Open ShaneBot
            </button>
            <span style={{ fontSize: 11.5, color: "#64748b" }}>
              ShaneBot raises the ticket for you. Answered inside 4 business hours. Retainer clients: 1 hour.
            </span>
          </div>
          <div
            style={{
              padding: "18px 20px",
              borderRadius: 12,
              background: "#0b1524",
              border: "1px solid rgba(30,41,59,.9)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              What we will never ask for
            </span>
            <p style={{ margin: 0, fontSize: 12.5, color: "#94a3b8", lineHeight: 1.65 }}>
              Your password, your MFA code, or remote control of your machine. Anyone asking for those is not us. Forward
              it to us instead &#8212; that counts as a security finding.
            </p>
          </div>
        </div>

        {/* Footer links */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            paddingTop: 6,
            fontSize: 11.5,
          }}
        >
          <Link href="/login" style={{ color: "#94a3b8", fontWeight: 600 }}>
            Back to sign in
          </Link>
          <span style={{ width: 1, height: 11, background: "rgba(148,163,184,.22)" }} />
          <a href="/status" style={{ color: "#94a3b8", fontWeight: 600 }}>
            Status
          </a>
          <span style={{ width: 1, height: 11, background: "rgba(148,163,184,.22)" }} />
          <Link href="/trust" style={{ color: "#94a3b8", fontWeight: 600 }}>
            Privacy
          </Link>
        </div>

        {/* Inline help icon watermark cue (accessible label only) */}
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          <HelpCircle aria-hidden />
        </span>
      </div>

      {botShown && <ShaneBot onClose={() => setBotShown(false)} />}
    </div>
  );
}
