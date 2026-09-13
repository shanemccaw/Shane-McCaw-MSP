import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, Clock, Lock, Mail } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { logger } from "../../lib/logger";

// Route /scan/results — the Free Scan "view your results" return link (Git #1359, Phase 7 of #1352).
//
// A Free Scan Prospect has no password and no portal access, by design (#656). The email sent at
// consent time carries a link to this page with a narrowly-scoped token in the URL FRAGMENT
// (#t=fsr_…) — fragments are never sent to a server or leaked in a Referer. The page trades that
// token for exactly one thing: POST /api/public/free-scan/results, the summary of that Prospect's
// own scan. It is not a login, sets no session, and has no route into the portal.
//
// Every number shown comes from that endpoint (the latest real msp_diagnostic_runs row and its
// findings). No Claude Design export exists for this page; it uses the site's MarketingLayout shell,
// and the full locked/teaser results presentation is #1358's.

const log = logger.child({ channel: "auth" });

const TOKEN_STORAGE_KEY = "freeScanReturnToken";
const POLL_MS = 10_000;

interface ResultsPayload {
  company: string | null;
  everScanned: boolean;
  run: {
    status: string;
    active: boolean;
    checksTotal: number;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    startedAt: string;
    completedAt: string | null;
  } | null;
  severityCounts: { critical: number; warning: number; info: number; ok: number } | null;
  topFindings: Array<{ checkLabel: string | null; severity: string; title: string | null }>;
}

type LoadState =
  | { kind: "no_token" }
  | { kind: "loading" }
  | { kind: "error"; code: "link_invalid" | "link_expired" | "link_not_applicable" | "failed" }
  | { kind: "ok"; data: ResultsPayload };

function readToken(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const fromHash = new URLSearchParams(hash).get("t");
  if (fromHash) {
    // Keep it for this tab only, and take it out of the address bar so it is not bookmarked or
    // screenshotted along with the page.
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fromHash);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromHash;
  }
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

const SEVERITY_ROWS = [
  { key: "critical", label: "Critical", color: "#f87171" },
  { key: "warning", label: "Warning", color: "#fbbf24" },
  { key: "info", label: "Worth knowing", color: "#60a5fa" },
  { key: "ok", label: "Passing", color: "#4ade80" },
] as const;

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(30,41,59,.9)",
  background: "#0b1524",
  padding: "20px 22px",
};

export default function FreeScanResults() {
  const [token] = useState<string | null>(() => (typeof window === "undefined" ? null : readToken()));
  const [state, setState] = useState<LoadState>(() => (token ? { kind: "loading" } : { kind: "no_token" }));

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const res = await fetch("/api/public/free-scan/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<ResultsPayload> & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          const code =
            body.error === "link_invalid" || body.error === "link_expired" || body.error === "link_not_applicable"
              ? body.error
              : "failed";
          if (code !== "failed") sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          setState({ kind: "error", code });
          return;
        }
        const data = body as ResultsPayload;
        setState({ kind: "ok", data });
        if (!data.everScanned || data.run?.active) {
          timer = window.setTimeout(load, POLL_MS);
        }
      } catch (err) {
        log.warn({ err }, "free-scan results: request failed");
        if (!cancelled) setState({ kind: "error", code: "failed" });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [token]);

  return (
    <MarketingLayout current="none">
      <div data-testid="freescan-return-page" style={{ padding: "44px 32px 64px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {state.kind === "loading" && (
            <p style={{ color: "#94a3b8", fontSize: 14 }}>Loading your scan results…</p>
          )}
          {state.kind === "ok" && <Results data={state.data} />}
          {state.kind === "no_token" && (
            <Notice
              title="Your scan results link"
              body="Open the link from the email we sent when you ran your free scan. If you can't find it, we can send a new one."
            />
          )}
          {state.kind === "error" && state.code === "link_expired" && (
            <Notice title="This link has expired" body="Results links last 14 days, and a newer link replaces an older one. Enter your email and we'll send a fresh one." />
          )}
          {state.kind === "error" && state.code === "link_invalid" && (
            <Notice title="We couldn't open that link" body="The link may have been copied incompletely. Enter your email and we'll send a fresh one." />
          )}
          {state.kind === "error" && state.code === "link_not_applicable" && (
            <Notice
              title="Your account has moved on from the free scan"
              body="This link only works for free scan results. Sign in to your portal to see your tenant."
              action={<Link href="/login" style={{ color: "#60a5fa", fontWeight: 600 }}>Sign in</Link>}
            />
          )}
          {state.kind === "error" && state.code === "failed" && (
            <Notice title="Something went wrong loading your results" body="Please refresh the page in a moment." />
          )}
          {(state.kind === "no_token" ||
            (state.kind === "error" && (state.code === "link_expired" || state.code === "link_invalid"))) && <RequestLink />}
        </div>
      </div>
    </MarketingLayout>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={cardStyle} data-testid="freescan-return-notice">
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
        <AlertTriangle size={16} color="#fbbf24" />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: 0 }}>{title}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: "#94a3b8", lineHeight: 1.65, margin: 0 }}>{body}</p>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

function RequestLink() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/public/free-scan/return-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div style={cardStyle} data-testid="freescan-return-link-sent">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Mail size={16} color="#60a5fa" />
          <p style={{ fontSize: 13.5, color: "#cbd5e1", margin: 0 }}>
            If that address ran a free scan, a new results link is on its way.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        data-testid="freescan-return-email"
        style={{
          flex: "1 1 240px",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(51,65,85,.9)",
          background: "#020617",
          color: "#f8fafc",
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        data-testid="freescan-return-request"
        style={{
          padding: "10px 16px",
          borderRadius: 10,
          border: "none",
          background: "#2563eb",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: status === "sending" ? "default" : "pointer",
        }}
      >
        {status === "sending" ? "Sending…" : "Email me a new link"}
      </button>
      {status === "error" && (
        <p style={{ flexBasis: "100%", fontSize: 12.5, color: "#f87171", margin: 0 }}>
          That didn't go through. Check the address and try again.
        </p>
      )}
    </form>
  );
}

function Results({ data }: { data: ResultsPayload }) {
  const run = data.run;
  const done = run ? run.checksOk + run.checksError + run.checksLicenseGap : 0;
  const pct = run && run.checksTotal > 0 ? Math.min(100, Math.round((done / run.checksTotal) * 100)) : 0;
  const counts = data.severityCounts;
  const issues = counts ? counts.critical + counts.warning : 0;

  return (
    <>
      <div>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: ".12em",
            color: "#60a5fa",
            marginBottom: 10,
          }}
        >
          Free scan{data.company ? ` · ${data.company}` : ""}
        </div>
        <h1
          data-testid="freescan-return-heading"
          style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1.15, color: "#f8fafc", margin: 0 }}
        >
          {!run
            ? "Your scan is starting."
            : run.active
              ? "Your scan is still running."
              : `Your scan found ${issues} ${issues === 1 ? "issue" : "issues"} that need attention.`}
        </h1>
      </div>

      {run && (
        <div style={cardStyle} data-testid="freescan-return-run">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {run.active ? <Clock size={15} color="#fbbf24" /> : <Check size={15} color="#4ade80" />}
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>
              {run.active
                ? `${done} of ${run.checksTotal} checks done`
                : `Completed ${new Date(run.completedAt ?? run.startedAt).toLocaleString()} · ${run.checksTotal} checks`}
            </span>
          </div>
          {run.active && (
            <div style={{ height: 6, borderRadius: 999, background: "#1e293b", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "#3b82f6" }} />
            </div>
          )}
        </div>
      )}

      {counts && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          {SEVERITY_ROWS.map((row) => (
            <div
              key={row.key}
              data-testid={`freescan-return-count-${row.key}`}
              style={{ ...cardStyle, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#cbd5e1" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: row.color }} />
                {row.label}
              </span>
              <b style={{ fontSize: 16, fontWeight: 800, color: row.color }}>{counts[row.key]}</b>
            </div>
          ))}
        </div>
      )}

      {data.topFindings.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px" }}>The most serious findings</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.topFindings.map((f, i) => (
              <li key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13.5, color: "#cbd5e1" }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    color: f.severity === "critical" ? "#f87171" : "#fbbf24",
                    flexShrink: 0,
                  }}
                >
                  {f.severity}
                </span>
                <span>{f.title ?? f.checkLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Lock size={16} color="#94a3b8" style={{ marginTop: 2, flexShrink: 0 }} />
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.65, margin: 0 }}>
          This page shows your scan summary only. The affected accounts, files and settings behind each finding, and the
          fixes, are part of monitoring.{" "}
          <Link href="/monitoring" style={{ color: "#60a5fa", fontWeight: 600 }}>
            See how monitoring works
          </Link>
        </p>
      </div>
    </>
  );
}
