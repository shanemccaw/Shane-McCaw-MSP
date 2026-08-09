/**
 * Active Directory — screen registration.
 *
 * MSPs → Tenants (Customers) → Users, RBAC Groups, and OU placeholders, as a
 * real directory browser over the platform's own `msps`/`tenants`/`users`
 * tables — the adminv2-shell front end for the initiative documented at
 * `docs/build-plans/active-directory.md` (all 10 phases Done against the old
 * admin panel's own `ActiveDirectoryPage.tsx`). Every read and write here
 * calls the exact same real backend routes that page already used
 * (`admin-active-directory.ts`, `consent.ts`, `msp-diagnostics.ts`,
 * `msp-admin-settings.ts`) — this is new shell chrome over shipped data, not
 * new fabricated data.
 *
 * `msp`/`user`/`group`/`ou` were added to `PEEK_KINDS` (`registry/types.ts`)
 * for this screen, and `ScreenRenderContext` grew a `kind` field so one
 * screen can host five distinct record types — see those files' comments.
 *
 * Known gap, matching the shell's own "Known gaps" convention in SHELL.md:
 * no live count is wired onto the Watch tab for this screen (e.g. tenants
 * not connected, MSPs past due). Doing that honestly needs a background
 * poll independent of whether anyone has opened this screen; out of scope
 * here, and better done once a screen actually needs the Watch tab.
 */

import {
  Briefcase,
  FolderPlus,
  KeyRound,
  Link as LinkIcon,
  LogIn,
  Plus,
  ShieldCheck,
  ShieldOff,
  Users,
  UserCircle,
} from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, ContextualTabSpec } from "../../registry/types";
import { AdCanvas } from "./AdCanvas";
import { AdExplorerTree } from "./AdExplorerTree";
import { AdProperties } from "./AdProperties";
import { getAdAdminFetch } from "./adAuthBridge";
import { createAdMsp, createAdOu } from "./adApi";
import { getAdCacheSize, getAdCachedRecord, getAllAdCachedRecords, type AdCacheKind } from "./adNameCache";
import { requestAdRecordAction, requestAdTreeRefresh } from "./adEvents";

function toneHex(tone: "good" | "warn" | "bad" | undefined): string | undefined {
  if (tone === "good") return ACCENT.greenSoft;
  if (tone === "warn") return ACCENT.amber;
  if (tone === "bad") return ACCENT.danger;
  return undefined;
}

function openAdRecord(kind: AdCacheKind, id: string, label: string) {
  getShellApi()?.navigate("/ad");
  getShellApi()?.openDoc({ kind, id, screenId: "ad", label });
}

async function onNewMsp() {
  const adminFetch = getAdAdminFetch();
  if (!adminFetch) return;
  const name = window.prompt("New MSP name:");
  if (!name?.trim()) return;
  const suggestedSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = window.prompt("Slug (used in URLs, cannot change afterwards):", suggestedSlug);
  if (!slug?.trim()) return;
  const domain = window.prompt("Primary domain (optional):", "") ?? undefined;
  try {
    const msp = await createAdMsp(adminFetch, { name: name.trim(), slug: slug.trim(), domain: domain?.trim() || undefined });
    requestAdTreeRefresh();
    openAdRecord("msp", String(msp.id), msp.name);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Failed to create the MSP.");
  }
}

async function onNewOu() {
  const adminFetch = getAdAdminFetch();
  if (!adminFetch) return;
  const name = window.prompt("New organizational unit name:");
  if (!name?.trim()) return;
  try {
    const ou = await createAdOu(adminFetch, name.trim());
    requestAdTreeRefresh();
    openAdRecord("ou", String(ou.id), ou.name);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Failed to create the OU.");
  }
}

registerScreen({
  id: "ad",
  title: "Active Directory",
  area: "ad",
  icon: Users,
  route: "/ad",
  render: (ctx) => <AdCanvas {...ctx} />,
  left: { title: "Explorer", render: () => <AdExplorerTree /> },
  right: { title: "Properties", render: () => <AdProperties /> },

  ribbon: [
    {
      tab: "home",
      order: 40,
      group: {
        label: "Active Directory",
        large: [
          {
            label: "Open Active Directory",
            icon: Users,
            intent: "open",
            onSelect: () => getShellApi()?.navigate("/ad"),
          },
        ],
        small: [
          { label: "New MSP", icon: Plus, intent: "create", onSelect: () => void onNewMsp() },
          { label: "New organizational unit", icon: FolderPlus, intent: "create", onSelect: () => void onNewOu() },
        ],
      },
    },
  ],

  contextualTab: (ctx): ContextualTabSpec | null => {
    if (!ctx.kind || !ctx.recordId) return null;
    const id = ctx.recordId;

    if (ctx.kind === "customer") {
      return {
        id: "ad-tenant-tools",
        label: "Tenant Tools",
        groups: [
          {
            label: "Tenant",
            large: [
              {
                label: "Run scan",
                icon: ShieldCheck,
                intent: "record",
                onSelect: () => requestAdRecordAction({ action: "run-scan", kind: "customer", id }),
              },
            ],
            small: [
              {
                label: "Revoke Graph consent",
                icon: ShieldOff,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => requestAdRecordAction({ action: "revoke-graph-consent", kind: "customer", id }),
              },
              {
                label: "Copy re-consent link",
                icon: LinkIcon,
                intent: "record",
                onSelect: () => requestAdRecordAction({ action: "copy-reconsent-link", kind: "customer", id }),
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "user") {
      return {
        id: "ad-account-tools",
        label: "Account Tools",
        groups: [
          {
            label: "Accounts",
            large: [
              {
                label: "Impersonate",
                icon: LogIn,
                intent: "record",
                onSelect: () => requestAdRecordAction({ action: "impersonate", kind: "user", id }),
              },
            ],
            small: [
              {
                label: "Force password reset",
                icon: KeyRound,
                intent: "record",
                onSelect: () => requestAdRecordAction({ action: "force-password-reset", kind: "user", id }),
              },
              {
                label: "Reset MFA",
                icon: ShieldOff,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => requestAdRecordAction({ action: "reset-mfa", kind: "user", id }),
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "msp") {
      const cached = getAdCachedRecord("msp", id);
      const suspended = cached?.tag === "suspended";
      return {
        id: "ad-msp-tools",
        label: "MSP Tools",
        groups: [
          {
            label: "Billing",
            large: [
              {
                label: suspended ? "Reactivate" : "Suspend",
                icon: Briefcase,
                intent: "record",
                color: suspended ? ACCENT.green : ACCENT.danger,
                onSelect: () =>
                  requestAdRecordAction({ action: suspended ? "reactivate-msp" : "suspend-msp", kind: "msp", id }),
              },
            ],
          },
        ],
      };
    }

    return null;
  },

  peeks: {
    msp: (id) => {
      const c = getAdCachedRecord("msp", id);
      if (!c) return null;
      return {
        kind: "msp",
        title: c.title,
        sub: c.sub,
        icon: Briefcase,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openAdRecord("msp", id, c.title),
      };
    },
    customer: (id) => {
      const c = getAdCachedRecord("customer", id);
      if (!c) return null;
      return {
        kind: "customer",
        title: c.title,
        sub: c.sub,
        icon: Users,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openAdRecord("customer", id, c.title),
      };
    },
    user: (id) => {
      const c = getAdCachedRecord("user", id);
      if (!c) return null;
      return {
        kind: "user",
        title: c.title,
        sub: c.sub,
        icon: UserCircle,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openAdRecord("user", id, c.title),
      };
    },
    group: (id) => {
      const c = getAdCachedRecord("group", id);
      if (!c) return null;
      return {
        kind: "group",
        title: c.title,
        sub: c.sub,
        icon: ShieldCheck,
        tone: ACCENT.info,
        open: () => openAdRecord("group", id, c.title),
      };
    },
    ou: (id) => {
      const c = getAdCachedRecord("ou", id);
      if (!c) return null;
      return {
        kind: "ou",
        title: c.title,
        icon: FolderPlus,
        tone: ACCENT.info,
        open: () => openAdRecord("ou", id, c.title),
      };
    },
  },

  commands: () => {
    const items: CommandItem[] = [
      {
        id: "act:ad-new-msp",
        type: "action",
        kind: "run",
        name: "New MSP",
        sub: "Creates an empty MSP",
        area: "ad",
        run: () => void onNewMsp(),
      },
      {
        id: "act:ad-new-ou",
        type: "action",
        kind: "run",
        name: "New organizational unit",
        sub: "Placeholder container, no policy yet",
        area: "ad",
        run: () => void onNewOu(),
      },
      {
        id: "ans:ad-msp-count",
        type: "answer",
        name: "MSPs in the directory",
        live: String(getAdCacheSize("msp")),
        area: "ad",
        run: () => getShellApi()?.navigate("/ad"),
      },
      {
        id: "ans:ad-tenant-count",
        type: "answer",
        name: "Tenants in the directory",
        live: String(getAdCacheSize("customer")),
        area: "ad",
        run: () => getShellApi()?.navigate("/ad"),
      },
    ];

    for (const { id, record } of getAllAdCachedRecords("msp")) {
      items.push({
        id: `rec:ad-msp-${id}`,
        type: "record",
        kind: "msp",
        name: record.title,
        sub: record.sub,
        tag: record.tag,
        area: "ad",
        run: () => openAdRecord("msp", id, record.title),
      });
    }
    for (const { id, record } of getAllAdCachedRecords("customer")) {
      items.push({
        id: `rec:ad-customer-${id}`,
        type: "record",
        kind: "customer",
        name: record.title,
        sub: record.sub,
        tag: record.tag,
        area: "ad",
        run: () => openAdRecord("customer", id, record.title),
      });
    }
    for (const { id, record } of getAllAdCachedRecords("user")) {
      items.push({
        id: `rec:ad-user-${id}`,
        type: "record",
        kind: "user",
        name: record.title,
        sub: record.sub,
        area: "ad",
        run: () => openAdRecord("user", id, record.title),
      });
    }
    for (const { id, record } of getAllAdCachedRecords("group")) {
      items.push({
        id: `rec:ad-group-${id}`,
        type: "record",
        kind: "group",
        name: `${record.title} (role)`,
        sub: record.sub,
        area: "ad",
        run: () => openAdRecord("group", id, record.title),
      });
    }

    return items;
  },
});
