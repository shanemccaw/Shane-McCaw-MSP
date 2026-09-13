import { useEffect } from "react";
import { getMspAuthMeQueryKey, useMspAuthMe, type MspUserProfile } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Icon, type IconName } from "./icons";
import { ConsoleShell } from "./ConsoleShell";
import { border, shadow, signal, surface, text } from "./tokens";

/** Where SignInPage sends a caller back to once they're signed in again. */
const RETURN_TO_KEY = "smcReturnTo";

/** MSP roles that clear the console's operator gate — the front-of-house mirror
 * of the backend's `requireCapability("ladder.msp-operator")` (operator+). */
const OPERATOR_ROLES = new Set(["PlatformAdmin", "MSPAdmin", "MSPOperator"]);

function isOperator(p: MspUserProfile): boolean {
  // The single legacy `role === "admin"` user is promoted to the top rung by the
  // backend's effectiveLegacyRole; mirror that here.
  return p.role === "admin" || (!!p.mspRole && OPERATOR_ROLES.has(p.mspRole));
}

export function AuthGate() {
  const { isLoading: sessionLoading } = useAuth();
  const me = useMspAuthMe({ query: { queryKey: getMspAuthMeQueryKey(), enabled: !sessionLoading, retry: false } });

  if (sessionLoading || me.isLoading) return <LoadingScreen />;

  if (me.isError) {
    const status = (me.error as { status?: number } | null)?.status;
    if (status === 403) {
      return (
        <GatePanel
          icon="shield-alert"
          tone={signal.critical}
          title="This session can't open the console"
          body="Your account is authenticated but does not clear the MSP operator scope. The console's routes resolve scope from your session's own MSP claim; ask a PlatformAdmin to grant you an operator role."
          wire={'requireCapability("ladder.msp-operator") · 403'}
        />
      );
    }
    return <SignInRequired />;
  }

  const profile = me.data;
  if (!profile) return <SignInRequired />;
  if (!isOperator(profile)) {
    return (
      <GatePanel
        icon="shield-alert"
        tone={signal.warning}
        title="Operator access required"
        body={`You're signed in as ${profile.email}, but the MSP Console is for MSP operators and above. Nothing here is available to your current role.`}
        wire={'requireCapability("ladder.msp-operator")'}
      />
    );
  }

  return <ConsoleShell profile={profile} />;
}

function CenteredCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: surface.canvas, color: text.body, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      {children}
    </div>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#0078D4,#00B4D8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, color: "#fff" }}>SM</div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.01em", color: "#fff" }}>Shane McCaw</span>
        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".14em", color: signal.brandSub }}>MSP CONSOLE</span>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <CenteredCanvas>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Brand />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220 }}>
          {["88%", "64%", "72%"].map((w, i) => (
            <div key={i} style={{ height: 12, borderRadius: 6, background: "rgba(148,163,184,.12)", width: w, animation: "smcPulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
        <span style={{ fontSize: 12, color: text.label }}>Resolving your session…</span>
      </div>
    </CenteredCanvas>
  );
}

function SignInRequired() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Remember where the caller actually was so SignInPage can send them back
  // instead of always dropping them at /tenants — a session expiring three
  // levels deep in a tenant page should not cost the operator their place.
  useEffect(() => {
    const rel = window.location.pathname.replace(base, "") + window.location.search;
    if (rel && rel !== "/" && !rel.startsWith("/login")) {
      sessionStorage.setItem(RETURN_TO_KEY, rel);
    }
  }, [base]);

  return (
    <GatePanel
      icon="key-round"
      tone={signal.info}
      title="Sign in to the MSP Console"
      body="Your session has expired or you're not signed in. Sign in with your operator account to continue."
      action={{ label: "Go to sign in", onClick: () => window.location.replace(`${base}/login`) }}
    />
  );
}

function GatePanel({
  icon, tone, title, body, wire, action,
}: {
  icon: IconName;
  tone: { strong: string; text: string; tint: string; border: string };
  title: string;
  body: string;
  wire?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <CenteredCanvas>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "min(460px,92%)" }}>
        <Brand />
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, boxShadow: shadow.popover, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
            <Icon name={icon} size={20} color={tone.text} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
          <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
          {action && (
            <button
              onClick={action.onClick}
              style={{ height: 34, padding: "0 13px", borderRadius: 8, background: "#2563eb", border: "1px solid #2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px rgba(37,99,235,.28)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#3b82f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#2563eb")}
            >
              {action.label}
            </button>
          )}
          {wire && (
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
          )}
        </div>
      </div>
    </CenteredCanvas>
  );
}
