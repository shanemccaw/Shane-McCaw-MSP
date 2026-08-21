/**
 * shellMenus.ts — the account menu and the New menu, as data. Kept apart from
 * shellData.ts because these carry `lucide-react` icon components and shellData
 * sits under the pure, `tsx --test`-run palette index.
 *
 * ── Full set now, on purpose ───────────────────────────────────────────────
 * These are CONTRACT surfaces other parts depend on Part 1 having built in full.
 * Part 12's prompt is explicit: "if the account menu needs new entries and Part
 * 1 has already rebuilt it, STOP rather than editing the shell." So both menus
 * are the design's complete set, and a handful of targets point at routes owned
 * by later parts — Billing / Webhooks / Alert preferences / Account security are
 * Part 12; Procedure (SOPs & Runbooks) is Part 6 — which resolve when their part
 * lands. The change-control entries deep-link into the Change Control module,
 * which exists. Copy and icon names are the prototype's verbatim (shell
 * 19242-19249 and 19302-19320), the `iconSvg` names mapped 1:1 to lucide-react.
 */

import {
  Bell,
  CheckCircle,
  CreditCard,
  GitCommit,
  Lock,
  LogOut,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { CC_BADGE_HREF } from "./shellData";

/* ── Account menu ─────────────────────────────────────────────────────────── */

export interface AccountMenuEntry {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Present for a navigating entry; absent on Sign out. */
  readonly href?: string;
  readonly danger?: boolean;
  readonly signOut?: boolean;
}

/** Account menu — shell 19242-19249. */
export const ACCOUNT_MENU: readonly AccountMenuEntry[] = [
  { key: "settings", label: "Settings", icon: CheckCircle, href: "/portal-v2/settings" },
  { key: "cc-settings", label: "Change control policy", icon: GitCommit, href: CC_BADGE_HREF },
  { key: "alert-preferences", label: "Alert preferences", icon: Bell, href: "/portal-v2/alert-preferences" },
  { key: "webhooks", label: "Webhooks", icon: Webhook, href: "/portal-v2/webhooks" },
  { key: "billing", label: "Billing", icon: CreditCard, href: "/portal-v2/billing" },
  { key: "account-security", label: "Account security", icon: Lock, href: "/portal-v2/account-security" },
  { key: "sign-out", label: "Sign out", icon: LogOut, danger: true, signOut: true },
];

/* ── New menu ─────────────────────────────────────────────────────────────── */

export interface NewMenuItem {
  readonly label: string;
  readonly sub: string;
  readonly tone: string;
  readonly href: string;
}

export interface NewMenuGroup {
  readonly label: string;
  readonly items: readonly NewMenuItem[];
}

/**
 * New menu — shell 19302-19320. The design primes cross-page intent (the CR
 * wizard mode, the SOP draft, the webhook add drawer); this phase only
 * navigates to the module, since priming another page is a wiring concern and
 * this part must not touch pages. Copy is the prototype's verbatim.
 */
export const NEW_MENU: readonly NewMenuGroup[] = [
  {
    label: "Change control",
    items: [
      { label: "Change request", sub: "Normal change — nine fields to get it on the register", tone: "#60a5fa", href: "/portal-v2/change-control" },
      { label: "Emergency change", sub: "Something is already broken — four fields, 24-hour clock", tone: "#f87171", href: "/portal-v2/change-control" },
      { label: "Standard change", sub: "From the pre-approved catalogue", tone: "#34d399", href: "/portal-v2/change-control" },
      { label: "Freeze window", sub: "Declare a period when nothing may ship", tone: "#fbbf24", href: "/portal-v2/change-control" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Procedure", sub: "Write an SOP or runbook for your team", tone: "#22d3ee", href: "/portal-v2/sop-hub" },
      { label: "Ownership row", sub: "Put a name against something the matrix does not cover", tone: "#2dd4bf", href: "/portal-v2/ownership" },
      { label: "Webhook endpoint", sub: "Send events to Sentinel, Teams or your own service", tone: "#a78bfa", href: "/portal-v2/webhooks" },
    ],
  },
];
