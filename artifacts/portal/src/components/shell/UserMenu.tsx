import { Link } from "wouter";
import { CreditCard, Webhook, Settings, ShieldCheck, LogOut } from "lucide-react";
import type { AuthUser, MspRole } from "@/lib/auth-context";
import { comingSoonHref } from "./moduleNav";

const HAIRLINE = "rgba(255,255,255,.10)";

/**
 * Real-role → display label. Not a fabricated value: it reflects the actual
 * `mspRole` claim on the signed-in JWT (auth-context.tsx). Falls back to the
 * coarser `role` claim only when `mspRole` genuinely isn't present.
 */
const MSP_ROLE_LABEL: Partial<Record<MspRole, string>> = {
  CustomerUser: "Customer",
  MSPAdmin: "MSP Admin",
  MSPOperator: "MSP Operator",
  PlatformAdmin: "Platform Admin",
  ServiceAccount: "Service Account",
  Free: "Free",
  Assessment: "Assessment",
};

function roleLabel(user: AuthUser): string {
  if (user.mspRole && MSP_ROLE_LABEL[user.mspRole]) return MSP_ROLE_LABEL[user.mspRole]!;
  return user.role === "admin" ? "Admin" : "Customer";
}

interface MenuRowProps {
  readonly href: string;
  readonly icon: typeof CreditCard;
  readonly label: string;
  readonly sub?: string;
  readonly testId: string;
  readonly onNavigate: () => void;
}

function MenuRow({ href, icon: Icon, label, sub, testId, onNavigate }: MenuRowProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      onClick={onNavigate}
      className="flex items-center rounded-lg transition-colors hover:bg-white/[.04]"
      style={{ padding: "8px 10px", gap: 11 }}
    >
      <Icon size={15} strokeWidth={1.75} color="#94a3b8" />
      <span className="flex flex-col">
        <span className="text-[13px]" style={{ color: "#cbd5e1" }}>
          {label}
        </span>
        {sub ? (
          <span className="text-[10.5px]" style={{ color: "#64748b" }}>
            {sub}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function Divider() {
  return <div className="my-1 h-px" style={{ background: HAIRLINE }} />;
}

/**
 * The top-right user menu (README "Popovers (top right)" — User menu, and
 * "Settings container" / "Your data" — export/deletion moved out of this
 * menu into Settings → Your data, so it must not carry them, per that same
 * section).
 *
 * Scope per #1820: identity, sign-out, and links out to the surfaces that
 * own their own controls. Billing, Webhooks and Settings have no page in
 * `artifacts/portal` yet, so they route through the same honest
 * `/coming-soon?feature=` state #1819 established rather than a dead link.
 * Account security is #1595's own Feature — not yet built either, so it
 * routes the same way; this dropdown never duplicates password/MFA/session
 * controls itself. Per #1751, the signed-in e-mail is NOT presented as a
 * verified M365 identity — it's the account's own contact e-mail.
 */
export function UserMenu({ user, onClose, onSignOut }: { user: AuthUser; onClose: () => void; onSignOut: () => void }) {
  return (
    <div
      data-testid="user-menu-popover"
      role="menu"
      className="absolute right-0 z-50 overflow-hidden rounded-[14px] border"
      style={{
        top: "calc(100% + 8px)",
        width: 304,
        borderColor: HAIRLINE,
        background: "#0b1220",
        boxShadow: "0 12px 32px rgba(0,0,0,.45)",
      }}
    >
      <div className="flex items-center gap-[10px]" style={{ padding: "14px 14px 12px" }}>
        <div
          className="flex size-9 items-center justify-center rounded-full text-[13px] font-semibold text-white"
          style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
        >
          {(user.name?.[0] ?? user.email[0]).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-semibold text-[#f8fafc]">
            {user.name ?? user.email}
          </span>
          <span className="truncate text-xs text-[#64748b]">{user.email}</span>
        </div>
        <span
          className="ml-auto shrink-0 rounded-full px-2 py-[2px] text-[10.5px] font-semibold"
          style={{ background: "rgba(255,255,255,.06)", color: "#94a3b8", border: `1px solid ${HAIRLINE}` }}
        >
          {roleLabel(user)}
        </span>
      </div>
      <Divider />
      <div style={{ padding: "4px 6px" }}>
        <MenuRow
          href={comingSoonHref("Billing", "account")}
          icon={CreditCard}
          label="Billing"
          testId="user-menu-billing"
          onNavigate={onClose}
        />
        <MenuRow
          href={comingSoonHref("Webhooks", "account")}
          icon={Webhook}
          label="Webhooks"
          testId="user-menu-webhooks"
          onNavigate={onClose}
        />
        <MenuRow
          href={comingSoonHref("Settings", "account")}
          icon={Settings}
          label="Settings"
          sub="Alert preferences"
          testId="user-menu-settings"
          onNavigate={onClose}
        />
      </div>
      <Divider />
      <div style={{ padding: "4px 6px" }}>
        <MenuRow
          href={comingSoonHref("Account security", "account")}
          icon={ShieldCheck}
          label="Account security"
          sub="Password · MFA · active sessions"
          testId="user-menu-account-security"
          onNavigate={onClose}
        />
      </div>
      <Divider />
      <div style={{ padding: "4px 6px 6px" }}>
        <button
          type="button"
          data-testid="user-menu-sign-out"
          onClick={onSignOut}
          className="flex w-full items-center rounded-lg text-left transition-colors hover:bg-white/[.04]"
          style={{ padding: "8px 10px", gap: 11 }}
        >
          <LogOut size={15} strokeWidth={1.75} color="#94a3b8" />
          <span className="text-[13px]" style={{ color: "#cbd5e1" }}>
            Sign out
          </span>
        </button>
      </div>
      <div
        className="border-t text-center text-[10.5px]"
        style={{ borderColor: HAIRLINE, color: "#64748b", padding: "8px 0" }}
      >
        Managed by Shane McCaw
      </div>
    </div>
  );
}
